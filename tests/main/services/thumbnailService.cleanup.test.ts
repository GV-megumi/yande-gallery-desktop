import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

/**
 * cleanupOrphanThumbnails（孤儿缩略图兜底清扫，真实临时目录）：
 * - 只处理形如 <32位hex>.<ext> 的文件；hash 段对账（不看扩展名，兼容历史格式切换）；
 * - 保护集 = images.filepath 的 md5 全集 ∪ invalid_images.thumbnailPath 的 hash 段
 *   （无效列表页仍展示这些缩略图，清掉会变破图）；
 * - 非缩略图命名的文件一概不动；目录不存在时安全返回零结果。
 */

const h = vi.hoisted(() => ({
  tmpDir: '',
  previewsDir: '',
  hqDir: '',
  imageRows: [] as Array<{ filepath: string }>,
  invalidRows: [] as Array<{ thumbnailPath: string | null }>,
}));

vi.mock('../../../src/main/services/config.js', () => ({
  getConfig: vi.fn(() => ({
    thumbnails: {
      maxWidth: 800, maxHeight: 800, quality: 92, format: 'webp', effort: 3,
      preview: { cachePath: 'previews', maxWidth: 1600, maxHeight: 1600, quality: 88, format: 'webp', effort: 3 },
    },
  })),
  getThumbnailsPath: vi.fn(() => h.tmpDir),
  getPreviewsPath: vi.fn(() => h.previewsDir),
  getHqPath: vi.fn(() => h.hqDir),
}));

vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(async () => ({})),
  all: vi.fn(async (_db: unknown, sql: string) => {
    if (sql.includes('FROM images')) return h.imageRows;
    if (sql.includes('invalid_images')) return h.invalidRows;
    return [];
  }),
}));

import { cleanupOrphanThumbnails } from '../../../src/main/services/thumbnailService';

function md5(s: string): string {
  return crypto.createHash('md5').update(s).digest('hex');
}

beforeEach(async () => {
  h.tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'thumb-cleanup-'));
  h.previewsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-cleanup-'));
  h.hqDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hq-cleanup-'));
  h.imageRows = [];
  h.invalidRows = [];
});

afterEach(async () => {
  await fs.rm(h.tmpDir, { recursive: true, force: true });
  await fs.rm(h.previewsDir, { recursive: true, force: true });
  await fs.rm(h.hqDir, { recursive: true, force: true });
});

describe('cleanupOrphanThumbnails', () => {
  it('删除库内无对应图片的孤儿缩略图；保护在库图片、无效项引用与非缩略图文件', async () => {
    const keepHash = md5('M:/lib/keep.jpg');
    const orphanHash = md5('M:/lib/gone.jpg');
    const orphanJpegHash = md5('M:/lib/gone2.jpg');
    const invalidHash = md5('M:/lib/invalid.jpg');

    await fs.writeFile(path.join(h.tmpDir, `${keepHash}.webp`), 'k');
    await fs.writeFile(path.join(h.tmpDir, `${orphanHash}.webp`), 'oooo');
    // 历史格式切换产物：hash 对账、扩展名不同也应识别为孤儿
    await fs.writeFile(path.join(h.tmpDir, `${orphanJpegHash}.jpeg`), 'oo');
    await fs.writeFile(path.join(h.tmpDir, `${invalidHash}.webp`), 'i');
    await fs.writeFile(path.join(h.tmpDir, 'notes.txt'), 'not a thumbnail');

    h.imageRows = [{ filepath: 'M:/lib/keep.jpg' }];
    h.invalidRows = [{ thumbnailPath: path.join(h.tmpDir, `${invalidHash}.webp`) }];

    const result = await cleanupOrphanThumbnails();

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ scanned: 4, deleted: 2, freedBytes: 6 });

    const remaining = (await fs.readdir(h.tmpDir)).sort();
    expect(remaining).toEqual([`${invalidHash}.webp`, `${keepHash}.webp`, 'notes.txt'].sort());
  });

  it('全部有主时零删除；缩略图目录不存在时安全返回零结果', async () => {
    const keepHash = md5('M:/lib/a.jpg');
    await fs.writeFile(path.join(h.tmpDir, `${keepHash}.webp`), 'k');
    h.imageRows = [{ filepath: 'M:/lib/a.jpg' }];

    const result = await cleanupOrphanThumbnails();
    expect(result.data).toEqual({ scanned: 1, deleted: 0, freedBytes: 0 });

    // 目录不存在
    h.tmpDir = path.join(h.tmpDir, 'not-exists');
    const missing = await cleanupOrphanThumbnails();
    expect(missing.success).toBe(true);
    expect(missing.data).toEqual({ scanned: 0, deleted: 0, freedBytes: 0 });
  });
});

describe('cleanupOrphanThumbnails 三档（previews + hq 目录联动）', () => {
  it('三档：孤儿在 thumbnails/previews/hq 均被删、命中 images.filepath 的保留，三目录计数聚合', async () => {
    const keepHash = md5('M:/lib/keep.jpg');
    const orphanHash = md5('M:/lib/gone.jpg');

    // thumbnails 目录：1 保留 + 1 孤儿（2 bytes）
    await fs.writeFile(path.join(h.tmpDir, `${keepHash}.webp`), 'k');
    await fs.writeFile(path.join(h.tmpDir, `${orphanHash}.webp`), 'oo');
    // previews 目录：1 保留 + 1 孤儿（3 bytes）——复用同一 validHashes 集合
    await fs.writeFile(path.join(h.previewsDir, `${keepHash}.webp`), 'k');
    await fs.writeFile(path.join(h.previewsDir, `${orphanHash}.webp`), 'ooo');
    // hq 目录：1 保留 + 1 孤儿（4 bytes）——同上复用同一 validHashes 集合
    await fs.writeFile(path.join(h.hqDir, `${keepHash}.jpg`), 'k');
    await fs.writeFile(path.join(h.hqDir, `${orphanHash}.jpg`), 'oooo');

    h.imageRows = [{ filepath: 'M:/lib/keep.jpg' }];

    const result = await cleanupOrphanThumbnails();

    expect(result.success).toBe(true);
    // scanned=2+2+2；deleted=1+1+1；freed=2+3+4——三目录聚合累加
    expect(result.data).toEqual({ scanned: 6, deleted: 3, freedBytes: 9 });

    expect((await fs.readdir(h.tmpDir)).sort()).toEqual([`${keepHash}.webp`]);
    expect((await fs.readdir(h.previewsDir)).sort()).toEqual([`${keepHash}.webp`]);
    expect((await fs.readdir(h.hqDir)).sort()).toEqual([`${keepHash}.jpg`]);
  });

  it('命中 invalid_images.thumbnailPath hash 段的 preview/hq 档同样被保留（Step 4f 写死语义）', async () => {
    const invalidHash = md5('M:/lib/invalid.jpg');
    // previews/hq 目录里以无效项 hash 命名的档（images 表为空——不复用保护集则会被误删）
    await fs.writeFile(path.join(h.previewsDir, `${invalidHash}.webp`), 'i');
    await fs.writeFile(path.join(h.hqDir, `${invalidHash}.jpg`), 'ii');
    h.invalidRows = [{ thumbnailPath: path.join(h.tmpDir, `${invalidHash}.webp`) }];

    const result = await cleanupOrphanThumbnails();

    expect(result.success).toBe(true);
    // thumbnails 空目录 scanned=0；previews/hq 各 1 个被扫描但保留
    expect(result.data).toEqual({ scanned: 2, deleted: 0, freedBytes: 0 });
    expect(await fs.readdir(h.previewsDir)).toEqual([`${invalidHash}.webp`]);
    expect(await fs.readdir(h.hqDir)).toEqual([`${invalidHash}.jpg`]);
  });
});
