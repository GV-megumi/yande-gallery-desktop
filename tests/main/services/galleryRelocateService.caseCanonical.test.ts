import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';
import os from 'os';
import fsSync from 'fs';

/**
 * 重定位写入侧大小写归一（win32）——canonicalizeRootPrefix 与 preview/apply 的字节一致性
 *
 * 缺陷背景：重定位对话框允许手输前缀。NTFS 大小写不敏感，但库内 folderPath/filepath
 * 的唯一性、已绑定判定与图片导入去重全部按字节精确比较（SQLite TEXT = / UNIQUE 为
 * BINARY）。若把手输的 `d:\art` 原样写库，之后系统对话框 / readdir 返回规范形态
 * `D:\art`，字节不等 → 同一物理文件夹被判为未绑定 → 重复绑定 + 整目录重复导入。
 *
 * 修复契约（本套件锁定）：
 *   1. preview 与 apply 都先经 canonicalizeRootPrefix 统一 old/new 前缀字节形态
 *      （盘符大写；磁盘存在时 realpathSync.native 取真实大小写），两侧走同一 helper——
 *      preview 展示的目标路径字节 == apply 实际写入的字节；
 *   2. 路径不存在（旧前缀迁移后通常已不在磁盘）→ 回退"归一化 + 盘符大写"，不抛错；
 *   3. preview 对"newPrefix 与库内既有行前缀仅大小写不同（compare key 相同、字节不同）"
 *      给出非阻断 warnings，apply 不受影响。
 *
 * 真实 :memory: sqlite；只 mock getDatabase（与 preview/apply 套件一致）。
 * 断言的是 win32 专属行为（非 win32 下 canonicalizeRootPrefix 仅做 normalizePath），
 * 故整套用例 runIf(win32)。
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('sqlite3').Database,
}));

vi.mock('../../../src/main/services/database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/services/database.js')>();
  return {
    ...actual,
    getDatabase: vi.fn(async () => h.db),
  };
});

// apply 成功后会发 gallery:paths-relocated（修复轮 U11），本套件不关心事件，mock 掉保持用例封闭
vi.mock('../../../src/main/services/appEventPublisher.js', () => ({
  emitGalleryPathsRelocated: vi.fn(),
}));

import { run, get } from '../../../src/main/services/database';
import { normalizePath } from '../../../src/main/utils/path';
import { loadGalleryRoots } from '../../../src/main/services/galleryRootRegistry';
import {
  canonicalizeRootPrefix,
  previewRelocateRoot,
  applyRelocateRoot,
} from '../../../src/main/services/galleryRelocateService';

const isWin = process.platform === 'win32';

/** 建迁移涉及的 5 张表（含各自 UNIQUE 约束），与 database.ts schema 对齐。 */
async function setupSchema(): Promise<void> {
  await run(h.db, `
    CREATE TABLE images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL UNIQUE,
      fileSize INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      format TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);
  await run(h.db, `
    CREATE TABLE galleries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folderPath TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);
  await run(h.db, `
    CREATE TABLE gallery_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      galleryId INTEGER NOT NULL,
      folderPath TEXT NOT NULL UNIQUE,
      recursive INTEGER NOT NULL DEFAULT 1,
      extensions TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (galleryId) REFERENCES galleries (id) ON DELETE CASCADE
    )
  `);
  await run(h.db, `
    CREATE TABLE gallery_ignored_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folderPath TEXT NOT NULL UNIQUE,
      note TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);
  await run(h.db, `
    CREATE TABLE booru_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      siteId INTEGER NOT NULL DEFAULT 1,
      postId INTEGER NOT NULL,
      fileUrl TEXT NOT NULL DEFAULT '',
      downloaded INTEGER DEFAULT 0,
      localPath TEXT,
      createdAt TEXT NOT NULL DEFAULT '2024-01-01',
      updatedAt TEXT NOT NULL DEFAULT '2024-01-01'
    )
  `);
  await run(h.db, `
    CREATE TABLE booru_favorite_tag_download_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      favoriteTagId INTEGER NOT NULL UNIQUE,
      galleryId INTEGER,
      downloadPath TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);
}

async function addImage(filepath: string): Promise<number> {
  await run(
    h.db,
    `INSERT INTO images (filename, filepath, fileSize, width, height, format, createdAt, updatedAt)
     VALUES (?, ?, 0, 0, 0, 'jpg', '2024-01-01', '2024-01-01')`,
    [path.basename(filepath), filepath]
  );
  const row = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
  return row!.id;
}

async function addGallery(folderPath: string): Promise<number> {
  await run(
    h.db,
    `INSERT INTO galleries (folderPath, name, createdAt, updatedAt) VALUES (?, 'g', '2024-01-01', '2024-01-01')`,
    [folderPath]
  );
  const row = await get<{ id: number }>(h.db, 'SELECT last_insert_rowid() as id');
  return row!.id;
}

async function addFolderBinding(galleryId: number, folderPath: string): Promise<void> {
  await run(
    h.db,
    `INSERT INTO gallery_folders (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
     VALUES (?, ?, 1, ?, '2024-01-01', '2024-01-01')`,
    [galleryId, folderPath, JSON.stringify(['.jpg'])]
  );
}

async function getFilepath(id: number): Promise<string | undefined> {
  const row = await get<{ filepath: string }>(h.db, 'SELECT filepath FROM images WHERE id = ?', [id]);
  return row?.filepath;
}

function countFor(
  affected: Array<{ table: string; column: string; count: number }>,
  table: string,
  column: string
): number {
  return affected.find((a) => a.table === table && a.column === column)?.count ?? 0;
}

/** 每个用例独享的随机段，避免撞上机器上真实存在的目录/其它用例遗留 */
function rand(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** 记录本用例创建的真实目录，afterEach 统一清理 */
const createdDirs: string[] = [];

/**
 * 在真实 tmp 下建一个名字含大小写字母的目录，返回其磁盘规范形态（已 normalizePath）。
 * os.tmpdir() 可能返回 8.3 短名（如 ADMINI~1），先 realpath 取规范底座再拼接。
 */
function makeRealDir(): string {
  const base = fsSync.realpathSync.native(os.tmpdir());
  const dir = path.join(base, `RelocCase${rand()}`);
  fsSync.mkdirSync(dir, { recursive: true });
  createdDirs.push(dir);
  return normalizePath(dir);
}

beforeEach(async () => {
  h.db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(database)));
  });
  await run(h.db, 'PRAGMA foreign_keys=ON');
  await setupSchema();
  loadGalleryRoots([]); // 复位单例，避免跨用例污染
  vi.clearAllMocks();
});

afterEach(async () => {
  loadGalleryRoots([]);
  for (const dir of createdDirs.splice(0)) {
    try {
      fsSync.rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言（tmp 下的一次性目录）
    }
  }
  await new Promise<void>((resolve, reject) => h.db.close((err) => (err ? reject(err) : resolve())));
});

describe.runIf(isWin)('canonicalizeRootPrefix — 单元（win32）', () => {
  it('路径不存在：盘符统一大写、其余字节保留，不抛错（回退分支）', () => {
    const suffix = rand();
    const input = path.join('q:', `zz_absent_${suffix}`, 'Sub');
    const expected = path.join('Q:', `zz_absent_${suffix}`, 'Sub');
    expect(canonicalizeRootPrefix(input)).toBe(expected);
  });

  it('盘符存在但路径不存在：同样走回退分支，尾随分隔符被归一', () => {
    // M: 盘在本仓库机器上必然存在（仓库就在 M:），子路径用随机段保证不存在
    const suffix = rand();
    const input = path.join('m:', `zz_absent_${suffix}`) + path.sep;
    const expected = path.join('M:', `zz_absent_${suffix}`);
    expect(canonicalizeRootPrefix(input)).toBe(expected);
  });

  it('磁盘上存在的目录：返回目录项的真实大小写形态（realpath 分支）', () => {
    const dir = makeRealDir(); // 目录名含大写字母 RelocCase...
    const twisted = dir.toLowerCase();
    expect(twisted).not.toBe(dir); // 前置：输入确实与磁盘形态大小写不同
    expect(canonicalizeRootPrefix(twisted)).toBe(dir);
  });

  it('8.3 短名被展开为长名规范形态', () => {
    // 本机 os.tmpdir() 返回 ADMINI~1 短名形态时应展开；已是长名时恒等，断言两种情形都成立
    const tmp = os.tmpdir();
    const real = normalizePath(fsSync.realpathSync.native(tmp));
    expect(canonicalizeRootPrefix(tmp)).toBe(real);
  });
});

describe.runIf(isWin)('applyRelocateRoot — 写入侧大小写归一', () => {
  it('手输小写盘符新前缀（磁盘不存在）→ 写库为盘符大写形态（finding 主场景）', async () => {
    const suffix = rand();
    const oldPrefix = path.join('N:', `zzsrc_${suffix}`);
    const typedNew = path.join('d:', `zzart_${suffix}`); // 手输小写盘符（对话框/readdir 返回的是大写）
    const canonicalNew = path.join('D:', `zzart_${suffix}`);

    const img = await addImage(path.join(oldPrefix, 'a', '1.jpg'));
    const g = await addGallery(path.join(oldPrefix, 'a'));
    await addFolderBinding(g, path.join(oldPrefix, 'a'));

    const result = await applyRelocateRoot([{ oldPrefix, newPrefix: typedNew }]);
    expect(result.success).toBe(true);

    // 写库字节必须是规范形态：盘符大写，后缀保留
    expect(await getFilepath(img)).toBe(path.join(canonicalNew, 'a', '1.jpg'));
    const folder = await get<{ folderPath: string }>(
      h.db,
      'SELECT folderPath FROM gallery_folders WHERE galleryId = ?',
      [g]
    );
    expect(folder?.folderPath).toBe(path.join(canonicalNew, 'a'));
  });

  it('新前缀在磁盘上真实存在 → 写库为磁盘规范大小写（realpath 分支端到端）', async () => {
    const dir = makeRealDir();
    const typedNew = dir.toLowerCase(); // 手输全小写
    const suffix = rand();
    const oldPrefix = path.join('N:', `zzold_${suffix}`);
    const img = await addImage(path.join(oldPrefix, '1.jpg'));

    const result = await applyRelocateRoot([{ oldPrefix, newPrefix: typedNew }]);
    expect(result.success).toBe(true);
    expect(await getFilepath(img)).toBe(path.join(dir, '1.jpg'));
  });

  it('preview 冲突项展示的目标路径字节 == apply 将写入的规范形态（两侧同一 helper）', async () => {
    const dir = makeRealDir();
    const typedNew = dir.toLowerCase();
    const suffix = rand();
    const oldPrefix = path.join('N:', `zzsrc3_${suffix}`);

    const srcImg = await addImage(path.join(oldPrefix, 'dup.jpg')); // 会被改写
    await addImage(path.join(dir, 'dup.jpg')); // 既有占位（规范字节）→ 目标冲突

    const preview = await previewRelocateRoot([{ oldPrefix, newPrefix: typedNew }]);
    expect(preview.success).toBe(true);
    expect(preview.data!.collisions.length).toBe(1);
    // 关键：冲突里展示的目标路径 = 规范化后的字节（而非手输小写形态）
    expect(preview.data!.collisions[0].path).toBe(path.join(dir, 'dup.jpg'));

    // apply 与 preview 同一 helper → 同样判定冲突 → 中止零写入
    const apply = await applyRelocateRoot([{ oldPrefix, newPrefix: typedNew }]);
    expect(apply.success).toBe(false);
    expect(await getFilepath(srcImg)).toBe(path.join(oldPrefix, 'dup.jpg'));
  });

  it('手输小写 oldPrefix 仍命中库内既有大小写形态的行（规范化不改变命中集合）', async () => {
    const suffix = rand();
    const storedOld = path.join('N:', `ZZOld_${suffix}`); // 库内混合大小写
    const typedOld = storedOld.toLowerCase(); // 手输全小写
    const newPrefix = path.join('M:', `zznew_${suffix}`); // 盘存在、路径不存在 → 回退分支保留字节

    const img = await addImage(path.join(storedOld, 'pic.jpg'));

    const result = await applyRelocateRoot([{ oldPrefix: typedOld, newPrefix }]);
    expect(result.success).toBe(true);
    expect(countFor(result.data!.affected, 'images', 'filepath')).toBe(1);
    expect(await getFilepath(img)).toBe(path.join(newPrefix, 'pic.jpg'));
  });
});

describe.runIf(isWin)('previewRelocateRoot — 仅大小写差异的既有路径提示（warnings，非阻断）', () => {
  it('newPrefix 与库内既有行前缀 compare key 相同、字节不同 → 按 (表,列,前缀变体) 聚合提示，apply 照常', async () => {
    const suffix = rand();
    const oldPrefix = path.join('N:', `zzsrc4_${suffix}`);
    const typedNew = path.join('D:', `ZZCase_${suffix}`); // 磁盘不存在 → 回退分支保留手输字节
    const variantPrefix = path.join('D:', `zzcase_${suffix}`); // 库内既有行是全小写变体

    // 既有行（不在改写集合内）：images 2 行 + gallery_folders 1 行
    await addImage(path.join(variantPrefix, 'pics', '1.jpg'));
    await addImage(path.join(variantPrefix, 'pics', '2.jpg'));
    const gv = await addGallery(path.join(variantPrefix, 'pics'));
    await addFolderBinding(gv, path.join(variantPrefix, 'pics'));

    // 会被改写的行（映射非空转，warnings 有实际意义）
    const moved = await addImage(path.join(oldPrefix, 'x.jpg'));

    const preview = await previewRelocateRoot([{ oldPrefix, newPrefix: typedNew }]);
    expect(preview.success).toBe(true);
    expect(preview.data!.collisions).toEqual([]);

    const warnings = preview.data!.warnings;
    expect(warnings).toContainEqual({
      table: 'images',
      column: 'filepath',
      newPrefix: typedNew,
      existingPrefix: variantPrefix,
      count: 2,
    });
    expect(warnings).toContainEqual({
      table: 'gallery_folders',
      column: 'folderPath',
      newPrefix: typedNew,
      existingPrefix: variantPrefix,
      count: 1,
    });

    // 非阻断：apply 成功，被改写行按规范化后的 newPrefix 字节写入
    const apply = await applyRelocateRoot([{ oldPrefix, newPrefix: typedNew }]);
    expect(apply.success).toBe(true);
    expect(await getFilepath(moved)).toBe(path.join(typedNew, 'x.jpg'));
  });

  it('字节一致的既有行不提示；被改写行不计入（大小写统一型自迁移零误报）', async () => {
    const suffix = rand();
    const storedPrefix = path.join('D:', `ZZUni_${suffix}`);
    const typedNew = path.join('D:', `zzuni_${suffix}`); // 同一物理目录的另一种大小写写法

    const a = await addImage(path.join(storedPrefix, 'a.jpg'));
    const b = await addImage(path.join(storedPrefix, 'b.jpg'));

    // 自迁移（把库内前缀统一为另一种大小写）：两行都在改写集合内 → 不构成"既有变体"提示
    const preview = await previewRelocateRoot([{ oldPrefix: storedPrefix, newPrefix: typedNew }]);
    expect(preview.success).toBe(true);
    expect(preview.data!.warnings).toEqual([]);
    expect(preview.data!.collisions).toEqual([]);

    const apply = await applyRelocateRoot([{ oldPrefix: storedPrefix, newPrefix: typedNew }]);
    expect(apply.success).toBe(true);
    expect(await getFilepath(a)).toBe(path.join(typedNew, 'a.jpg'));
    expect(await getFilepath(b)).toBe(path.join(typedNew, 'b.jpg'));

    // 应用后库内前缀与 typedNew 字节完全一致 → 再预览同一 newPrefix 不再有任何提示
    const suffix2 = rand();
    const p2 = await previewRelocateRoot([
      { oldPrefix: path.join('N:', `zzabsent_${suffix2}`), newPrefix: typedNew },
    ]);
    expect(p2.success).toBe(true);
    expect(p2.data!.warnings).toEqual([]);
  });
});
