/**
 * 图库根路径重定位服务（跨机迁移，Phase 5，主进程专用）
 *
 * 使用场景：用户把 DB 与图片文件一起搬到另一台机器，整个库的路径前缀变了
 * （例如 N:\hk\yande_download\* → D:\art\*）。本服务把 DB 中所有存储路径的旧前缀
 * 无损改写为新前缀——不重新扫描、不丢失图片身份/标签/封面/Booru 关联，只改路径字符串。
 *
 * 安全是第一位的（relocateRoot 会横跨整库改路径）：
 *   - previewRelocateRoot 先做 dry-run 预检：统计会改多少行 + 检测 UNIQUE 冲突，不写库；
 *   - applyRelocateRoot 在单个事务内改写，任一 UNIQUE 冲突先于写入被发现则整体中止、零写入
 *     （UNIQUE 列两阶段改写：终态无重复的链式/互换/自包含映射不产生瞬时冲突，预检放行即可应用）；
 *   - 前缀匹配是"目录边界感知"的（M:\art 不匹配兄弟目录 M:\artists\x），
 *     且权威匹配在 JS 侧做，避免 SQL LIKE 的 _ / % / \ 通配符语义引入误判；
 *   - 写入侧大小写归一（win32）：preview 与 apply 都先经 canonicalizeRootPrefix 统一
 *     old/new 前缀的字节形态（盘符大写 + 磁盘存在时取 realpath 规范大小写）。重定位
 *     对话框允许手输前缀，而库内 folderPath/filepath 的唯一性、已绑定判定与图片导入
 *     去重全部按字节精确比较（SQLite BINARY）——手输 `d:\art` 原样写库后，系统对话框 /
 *     readdir 返回的规范形态 `D:\art` 字节不等，会导致同一物理文件夹被判为未绑定 →
 *     重复绑定 + 整目录重复导入。preview 另对"newPrefix 与库内既有路径仅大小写不同"
 *     给出非阻断 warnings，提示用户统一大小写。
 *
 * 涉及的 5 个 (表, 列) 改写点（均存归一化后的路径）：
 *   - gallery_folders.folderPath          （UNIQUE）
 *   - images.filepath                      （UNIQUE）
 *   - booru_posts.localPath               （可空，非唯一）
 *   - booru_favorite_tag_download_bindings.downloadPath （NOT NULL，非唯一）
 *   - gallery_ignored_folders.folderPath  （UNIQUE）
 *
 * 本期"有意不在范围内"的其它绝对路径列（避免误以为遗漏）：
 *   - invalid_images.filepath / invalid_images.thumbnailPath：失效图片记录，本就是"已不存在"的快照，
 *     不属于核心相册/Booru 完整性面；搬库后重扫即可自然刷新，无需改写。
 *   - yande_images.localPath：旧版 Yande 表（已被 booru_posts 取代），遗留死数据，不维护。
 *   - bulk_download_tasks.path / booru_download_queue.targetPath：下载目录配置，属于用户可随时
 *     重新配置的"去向"设置，而非已落盘资产的身份；不改写，由用户在新机自行设定。
 *   缩略图是按源 filepath 派生的缓存，同样不在改写范围（搬库后会按新路径惰性重建）。
 *
 * TOCTOU 说明（先扫描后事务之间若有并发改动，均为 fail-safe）：
 *   - 并发插入一个会撞目标路径的行 → 事务内 UPDATE 触发 UNIQUE 约束 → 整体回滚，零写入；
 *   - 并发删除某个待改写行 → `UPDATE ... WHERE id=?` 命中 0 行，无副作用，其余照常。
 */
import path from 'path';
import fs from 'fs/promises';
import { realpathSync } from 'fs';
import { getDatabase, all, runBatch, runInTransaction } from './database.js';
import { normalizePath } from '../utils/path.js';
import { loadGalleryRoots } from './galleryRootRegistry.js';
import { getAllGalleryFolderPaths } from './galleryService.js';
import { emitGalleryPathsRelocated } from './appEventPublisher.js';
import { bumpSyncDataVersion } from './config.js';

/** 单条前缀映射：把 oldPrefix 开头的存储路径改写为 newPrefix 开头。 */
export interface RelocateMapping {
  oldPrefix: string;
  newPrefix: string;
}

/** 需要参与重定位的 (表, 列) 站点。isUnique 决定是否做冲突检测。 */
interface RelocateSite {
  table: string;
  column: string;
  /** 该列是否带 UNIQUE 约束（改写后可能撞既有行）。 */
  isUnique: boolean;
}

const RELOCATE_SITES: RelocateSite[] = [
  { table: 'gallery_folders', column: 'folderPath', isUnique: true },
  { table: 'images', column: 'filepath', isUnique: true },
  { table: 'booru_posts', column: 'localPath', isUnique: false },
  { table: 'booru_favorite_tag_download_bindings', column: 'downloadPath', isUnique: false },
  { table: 'gallery_ignored_folders', column: 'folderPath', isUnique: true },
];

/**
 * win32 下路径比较大小写不敏感（与 index.ts normalizeControlledRoot /
 * imageService 既有判定一致）；其它平台大小写敏感。
 * 仅用于"是否匹配前缀"的比较，不改变实际存储的原始大小写。
 */
function toCompareKey(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

/**
 * 归一化"将参与改写的路径前缀"，并在 win32 下把大小写规范到磁盘真实形态。
 *
 * 为什么写入侧必须归一：重定位对话框允许手输前缀，NTFS 大小写不敏感，但库内
 * folderPath/filepath 的唯一性（UNIQUE）、已绑定判定（planScanFolder / bindFolder）
 * 与图片导入去重全部按字节精确比较。把手输的 `d:\art` 原样写库后，系统对话框 /
 * readdir 返回的规范形态 `D:\art` 字节不等 → 同一物理文件夹被判为未绑定 →
 * 重复绑定 + 整目录重复导入。故 oldPrefix/newPrefix 在 preview 与 apply 两侧
 * 都先经本函数归一（同一 helper，保证 preview 展示的目标字节 == apply 写入的字节）。
 *
 * 规则（win32）：
 *   1. normalizePath 归一分隔符与尾分隔符；
 *   2. 盘符统一大写（`d:` → `D:`，系统对话框与 readdir 返回的盘符恒为大写）；
 *   3. 路径在磁盘上存在时，用 fs.realpathSync.native 取目录项的真实大小写形态
 *      （同时会展开 8.3 短名）。取舍：realpath 会一并解析符号链接 / junction——
 *      若前缀本身是链接，得到的是链接目标的真实路径。迁移目标绝大多数是真实目录
 *      （realpath 仅校正大小写）；链接场景写入的真实路径与物理数据仍一致，接受该副作用；
 *   4. 失败（路径不存在——旧前缀在迁移后通常已不在磁盘——或不可访问）时回退
 *      第 1+2 步的形态，不阻断重定位。
 *
 * 非 win32：文件系统大小写敏感，用户输入的字节即真值，且 realpath 只会引入符号链接
 * 解析副作用（可能改写用户指定的前缀形态），故仅做 normalizePath。
 */
export function canonicalizeRootPrefix(p: string): string {
  const normalized = normalizePath(p);
  if (process.platform !== 'win32') {
    return normalized;
  }
  // 盘符统一大写：`d:\art` → `D:\art`（仅小写盘符需要改写；UNC 路径无盘符，原样跳过）
  let canonical = /^[a-z]:/.test(normalized)
    ? normalized[0].toUpperCase() + normalized.slice(1)
    : normalized;
  try {
    // 磁盘上存在 → 取目录项真实大小写形态（GetFinalPathNameByHandle 语义）
    canonical = normalizePath(realpathSync.native(canonical));
  } catch {
    // 路径不存在或不可访问：回退"归一化 + 盘符大写"的形态（迁移后的旧前缀走的就是这里）
  }
  return canonical;
}

/**
 * 把整批映射的 old/new 前缀统一规范化。preview 与 apply 必须共用本函数，
 * 保证两侧的匹配集合、冲突判定与最终写入字节完全一致。
 * （win32 匹配本就大小写不敏感，规范化 oldPrefix 不改变命中集合。）
 */
function canonicalizeMappings(mappings: RelocateMapping[]): RelocateMapping[] {
  return mappings.map((m) => ({
    oldPrefix: canonicalizeRootPrefix(m.oldPrefix),
    newPrefix: canonicalizeRootPrefix(m.newPrefix),
  }));
}

/**
 * 边界感知前缀匹配 + 改写。
 *
 * 存储路径 S 视为"在 oldPrefix 之下"当且仅当（win32 大小写不敏感）：
 *   norm(S) === norm(oldPrefix)            （恰好等于该前缀目录本身），或
 *   norm(S) 以 norm(oldPrefix) + path.sep 开头   （是该目录的真子路径）。
 * 这样 M:\art 不会误匹配兄弟目录 M:\artists\x。
 *
 * 命中后改写为：norm(newPrefix) + S.slice(norm(oldPrefix).length)，
 * 即保留 oldPrefix 之后的原始后缀（含原始大小写与分隔符）。
 *
 * 一条路径最多命中一个 mapping：按传入顺序取首个命中（first-match wins）。
 * 假定各 mapping 的 oldPrefix 互不重叠；若确有重叠，以先匹配者为准。
 *
 * @returns 命中时返回改写后的新路径；未命中任何 mapping 返回 null。
 */
export function rewritePathWithMappings(
  storedPath: string,
  mappings: RelocateMapping[]
): string | null {
  if (!storedPath) {
    return null;
  }
  const normStored = normalizePath(storedPath);
  const storedKey = toCompareKey(normStored);

  for (const mapping of mappings) {
    const normOld = normalizePath(mapping.oldPrefix);
    const normNew = normalizePath(mapping.newPrefix);
    const oldKey = toCompareKey(normOld);

    const isExact = storedKey === oldKey;
    const isUnder = storedKey.startsWith(oldKey + path.sep);
    if (isExact || isUnder) {
      // 用归一化后的 storedPath 取后缀：normOld 与 normStored 命中部分等长（仅大小写可能不同），
      // 故按 normOld.length 切片得到的后缀是 normStored 的尾部，保留原始大小写。
      return normNew + normStored.slice(normOld.length);
    }
  }
  return null;
}

/**
 * 仅大小写差异提示项（win32）：某映射规范化后的 newPrefix 与库内既有行的字节前缀
 * compare key 相同、字节不同。按 (表, 列, 既有前缀变体) 聚合，count 为该变体下的行数。
 */
export interface RelocateCaseWarning {
  table: string;
  column: string;
  /** 规范化后将写入的新前缀（字节形态） */
  newPrefix: string;
  /** 库内既有行（不在本次改写集合内）的字节前缀，与 newPrefix 仅大小写不同 */
  existingPrefix: string;
  /** 该 (table, column) 下前缀为 existingPrefix 的既有行数 */
  count: number;
}

/** previewRelocateRoot 的返回数据形态。 */
export interface RelocatePreviewData {
  /** 每个 (表, 列) 会被改写的行数。 */
  affected: Array<{ table: string; column: string; count: number }>;
  /** UNIQUE 列改写后会撞上既有行的冲突列表（存在任一则禁止 apply）。 */
  collisions: Array<{ table: string; column: string; path: string }>;
  /**
   * 非阻断提示：newPrefix 与库内既有路径前缀仅大小写不同（win32 才会出现）。
   * 不禁止 apply，但应用后库内会同时存在同一物理目录的两种大小写前缀——后续
   * byte-exact 判定（绑定唯一性 / 已绑定判定 / 图片导入去重）会把它们当成不同目录，
   * 建议用户把新前缀大小写改成与库内一致。
   */
  warnings: RelocateCaseWarning[];
}

/** 单个站点的扫描结果（供 preview 计数与 apply 改写复用）。 */
interface SiteScan {
  site: RelocateSite;
  /** 命中前缀、需要改写的行：主键 id + 改写后的新路径。 */
  matched: Array<{ id: number; newPath: string }>;
  /** 改写后与既有行冲突的目标路径（仅 UNIQUE 列）。 */
  collisions: string[];
  /** 与某映射 newPrefix 仅大小写不同的既有行前缀变体（非阻断，供 preview 提示）。 */
  caseVariants: Array<{ newPrefix: string; existingPrefix: string; count: number }>;
}

/**
 * 扫描某个站点：拉出该列全部非空行，在 JS 侧做权威的边界匹配，得到需要改写的行；
 * 对 UNIQUE 列再检测改写后是否与"未被改写的既有行"撞路径。
 *
 * 为什么用粗粒度预取（WHERE col IS NOT NULL）+ JS 精判，而不是 SQL LIKE：
 * 路径里可能含 LIKE 的元字符（_ / % / \\），用 `LIKE prefix%` 判断归属会误命中或漏命中，
 * 故 LIKE 只能用作"缩小范围"的预取，最终归属判定必须由 rewritePathWithMappings 决定。
 */
async function scanSite(
  db: Awaited<ReturnType<typeof getDatabase>>,
  site: RelocateSite,
  mappings: RelocateMapping[]
): Promise<SiteScan> {
  const rows = await all<{ id: number; value: string }>(
    db,
    `SELECT id, ${site.column} AS value FROM ${site.table} WHERE ${site.column} IS NOT NULL AND ${site.column} <> ''`
  );

  const matched: Array<{ id: number; newPath: string }> = [];
  // 现有路径集合（compare key）。用于：
  // 1) 判断改写目标是否撞既有行；2) 排除"既有行本身也被改写"的情形（那不算冲突）。
  const existingKeys = new Set<string>();
  const matchedKeys = new Set<string>();
  for (const row of rows) {
    existingKeys.add(toCompareKey(normalizePath(row.value)));
  }

  for (const row of rows) {
    const newPath = rewritePathWithMappings(row.value, mappings);
    if (newPath !== null) {
      matched.push({ id: row.id, newPath });
      matchedKeys.add(toCompareKey(normalizePath(row.value)));
    }
  }

  // 仅大小写差异提示（win32 才会出现：toCompareKey 相同、字节不同；非 win32 下
  // compare key 即字节本身，slice 出的前缀必然与 normNew 相等，天然不产生条目）：
  // 非改写行若落在某 mapping 的 newPrefix 之下（大小写不敏感）而字节前缀不同，
  // apply 后库内将同时存在同一物理目录的两种大小写前缀——后续 byte-exact 判定
  // （绑定唯一性 / planScanFolder 已绑定判定 / 图片导入去重）会把它们当成不同目录。
  // 改写行不计入：其前缀 apply 后即为规范化的 newPrefix 字节，不构成变体。
  const variantMap = new Map<string, { newPrefix: string; existingPrefix: string; count: number }>();
  for (const row of rows) {
    const normValue = normalizePath(row.value);
    const valueKey = toCompareKey(normValue);
    if (matchedKeys.has(valueKey)) {
      continue;
    }
    for (const mapping of mappings) {
      const normNew = normalizePath(mapping.newPrefix);
      const newKey = toCompareKey(normNew);
      if (valueKey !== newKey && !valueKey.startsWith(newKey + path.sep)) {
        continue;
      }
      // 命中 newPrefix 的 compare key：取该行等长的字节前缀与规范形态比对
      const existingPrefix = normValue.slice(0, normNew.length);
      if (existingPrefix !== normNew) {
        const dedupeKey = JSON.stringify([normNew, existingPrefix]);
        const entry = variantMap.get(dedupeKey);
        if (entry) {
          entry.count += 1;
        } else {
          variantMap.set(dedupeKey, { newPrefix: normNew, existingPrefix, count: 1 });
        }
      }
      break; // 一行只归入首个命中的 mapping（与改写的 first-match 语义一致）
    }
  }

  const collisions: string[] = [];
  if (site.isUnique) {
    // seenTargets：本批已经"占用"的改写目标。用于拦截批内多源→同一目标
    //（例如 src1\dup 与 src2\dup 都改写为 D:\dst\dup）——这种重复两行都在被改写集合内，
    // 撞既有非改写行的检查发现不了，必须靠批内去重，否则只能等 apply 期撞 SQLITE_CONSTRAINT。
    const seenTargets = new Set<string>();
    for (const m of matched) {
      const targetKey = toCompareKey(normalizePath(m.newPath));
      // 批内已有另一被改写行映射到同一目标 → 第二个起即为冲突。
      if (seenTargets.has(targetKey)) {
        collisions.push(m.newPath);
        continue;
      }
      seenTargets.add(targetKey);
      // 改写目标撞上某个既有行，且那个既有行自身不在被改写集合内 → UNIQUE 冲突。
      // （若既有行也会被改写走，则改写后不再占用该路径，不算冲突。）
      if (existingKeys.has(targetKey) && !matchedKeys.has(targetKey)) {
        collisions.push(m.newPath);
      }
    }
  }

  return { site, matched, collisions, caseVariants: [...variantMap.values()] };
}

/** 扫描全部 5 个站点（preview 与 apply 共用）。 */
async function scanAllSites(
  db: Awaited<ReturnType<typeof getDatabase>>,
  mappings: RelocateMapping[]
): Promise<SiteScan[]> {
  const scans: SiteScan[] = [];
  for (const site of RELOCATE_SITES) {
    scans.push(await scanSite(db, site, mappings));
  }
  return scans;
}

/**
 * 预检（dry-run，不写库）：统计每个 (表, 列) 会改多少行，并检测 UNIQUE 冲突。
 * 供 UI 在真正 apply 前展示影响面与风险。
 * 映射先经 canonicalizeMappings 规范化（与 apply 同一 helper），
 * 因此冲突项里展示的目标路径字节 == apply 实际写入的字节。
 */
export async function previewRelocateRoot(
  mappings: RelocateMapping[]
): Promise<{ success: boolean; data?: RelocatePreviewData; error?: string }> {
  try {
    const db = await getDatabase();
    const scans = await scanAllSites(db, canonicalizeMappings(mappings));

    const affected = scans.map((s) => ({
      table: s.site.table,
      column: s.site.column,
      count: s.matched.length,
    }));

    const collisions: Array<{ table: string; column: string; path: string }> = [];
    for (const s of scans) {
      for (const p of s.collisions) {
        collisions.push({ table: s.site.table, column: s.site.column, path: p });
      }
    }

    // 非阻断提示：newPrefix 与库内既有路径前缀仅大小写不同（详见 RelocateCaseWarning）
    const warnings: RelocateCaseWarning[] = [];
    for (const s of scans) {
      for (const v of s.caseVariants) {
        warnings.push({ table: s.site.table, column: s.site.column, ...v });
      }
    }

    return { success: true, data: { affected, collisions, warnings } };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[galleryRelocateService] previewRelocateRoot 失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/** applyRelocateRoot 的返回数据形态。 */
export interface RelocateApplyData {
  /** 每个 (表, 列) 实际改写的行数。 */
  affected: Array<{ table: string; column: string; count: number }>;
}

/**
 * 应用重定位（单事务、无损）。
 *
 * 流程：
 *   0. 映射先经 canonicalizeMappings 规范化（与 preview 同一 helper），写库字节 ==
 *      preview 展示字节，杜绝手输小写前缀以非规范字节整库落盘；
 *   1. 先扫描全部站点（== preview 的逻辑）；任一 UNIQUE 冲突 → 直接返回失败、不写任何行；
 *   2. 否则在单个 runInTransaction 内，对每个站点按主键 id 逐行 UPDATE 为 JS 预计算的新路径
 *      （per-row UPDATE keyed by id 最稳，不依赖 SQL 侧的边界正确性）；UNIQUE 站点分两阶段
 *      （先占位临时值、再写终值），链式/互换/自包含映射不会误撞瞬时 UNIQUE 约束；
 *   3. 提交后用 getAllGalleryFolderPaths 重新装载 app:// 白名单——直接 SQL 改了 folderPath，
 *      但 galleryRootRegistry 是进程内同步缓存，不会自动跟随，必须显式刷新
 *      （与 backupService.restore 的处理一致）；
 *   4. 白名单刷新后发 gallery:paths-relocated 全量失效事件（改写行数 > 0 才发）——
 *      重定位不动 updatedAt，常驻导航缓存的图库页靠既有增量事件（updatedAt 游标）
 *      感知不到任何变化，会继续展示旧破损路径与过期「文件夹丢失」标记；该事件
 *      与 backupService 恢复后的 app:data-restored 同强度，让订阅方整体重载。
 *      必须晚于白名单刷新：订阅方收到事件立即按新路径经 app:// 重载图片。
 *
 * 幂等：再次对同一映射调用时，已无行落在 oldPrefix 下，matched 为空 → 0 改写、不报错
 * （此时库内数据未变，也不发失效事件）。
 * 无损：只改路径字符串列，images.id / gallery_images / image_tags / 封面引用等均不动。
 */
export async function applyRelocateRoot(
  mappings: RelocateMapping[]
): Promise<{ success: boolean; data?: RelocateApplyData; error?: string }> {
  try {
    const db = await getDatabase();
    const scans = await scanAllSites(db, canonicalizeMappings(mappings));

    // 任一 UNIQUE 冲突 → 中止，零写入（先于事务发现，连 BEGIN 都不进）。
    const collisionCount = scans.reduce((sum, s) => sum + s.collisions.length, 0);
    if (collisionCount > 0) {
      const firstCollision = scans.find((s) => s.collisions.length > 0)!;
      const errorMessage =
        `relocateRoot 中止：检测到 ${collisionCount} 处 UNIQUE 路径冲突` +
        `（例如 ${firstCollision.site.table}.${firstCollision.site.column} → ${firstCollision.collisions[0]}）`;
      console.error('[galleryRelocateService] applyRelocateRoot:', errorMessage);
      return { success: false, error: errorMessage };
    }

    // 仅大小写差异的既有前缀变体不阻断（preview 已提示用户），这里留一条告警便于事后排查
    const caseVariantCount = scans.reduce((sum, s) => sum + s.caseVariants.length, 0);
    if (caseVariantCount > 0) {
      console.warn(
        `[galleryRelocateService] applyRelocateRoot: 检测到 ${caseVariantCount} 处与新前缀仅大小写不同的既有路径前缀（不阻断，建议统一大小写）`
      );
    }

    // 单事务内改写：任一失败整体回滚（runInTransaction 内部已处理 ROLLBACK）。
    //
    // UNIQUE 站点采用两阶段改写：SQLite 的 UNIQUE 约束按语句立即检查（不延迟到 COMMIT），
    // 若某行的改写目标恰是另一待改写行的"当前"路径——链式 [A→B, B→C]、互换 [A→B, B→A]、
    // 自包含 old=X → new=X\sub 都会出现——单遍逐行直写会在中间状态误撞 SQLITE_CONSTRAINT，
    // 尽管终态并无重复、preview 也已放行。故第一遍先把全部 matched 行占位为不可能与真实
    // 路径冲突的临时值（NUL 字符不可能出现在文件路径中，拼主键 id 保证批内唯一），
    // 腾空所有旧路径后第二遍再写入最终 newPath。这样凡 preview 判无冲突（终态无重复）
    // 的批次，应用必然成功；非 UNIQUE 列无约束可撞，维持单遍直写。
    // 逐行 UPDATE 走 runBatch 预编译复用：整库搬迁时 images.filepath 可达数十万行，
    // 两阶段再翻倍；prepare 一次逐行 run 把线程池往返降为约 1/3（逐行语义与顺序不变，
    // NUL 占位值经参数绑定传入，安全）。大库耗时预期仍是分钟级且事务持锁、其它写操作
    // 排队——维护型操作可接受，preview 已让用户知晓改写规模。
    await runInTransaction(db, async () => {
      for (const scan of scans) {
        const updateSql = `UPDATE ${scan.site.table} SET ${scan.site.column} = ? WHERE id = ?`;
        if (scan.site.isUnique) {
          // 第一阶段：全部占位为临时值，腾出所有旧路径
          await runBatch(db, updateSql,
            scan.matched.map((m) => [`\u0000relocate\u0000${m.id}`, m.id]));
        }
        // 第二阶段（非 UNIQUE 站点即唯一一遍）：写入最终新路径
        await runBatch(db, updateSql,
          scan.matched.map((m) => [m.newPath, m.id]));
      }
    });

    // 提交后刷新 app:// 白名单（gallery_folders.folderPath 已变）。
    loadGalleryRoots(await getAllGalleryFolderPaths());

    const affected = scans.map((s) => ({
      table: s.site.table,
      column: s.site.column,
      count: s.matched.length,
    }));

    // 步骤 4：发全量失效领域事件（详见函数头注释）。放在白名单刷新之后，
    // 订阅方（常驻缓存的图库页）收到事件会立即按新路径经 app:// 重载图片；
    // 幂等重跑 0 改写时库内数据未变，不发事件，避免无谓的整页重载。
    const totalCount = scans.reduce((sum, s) => sum + s.matched.length, 0);
    if (totalCount > 0) {
      console.log(`[galleryRelocateService] applyRelocateRoot: 改写 ${totalCount} 行，广播 gallery:paths-relocated`);
      // 根目录迁移不触碰 updatedAt（见上方注释），由 dataVersion 代际让移动端全量重建镜像（spec §5.3）。
      // 0 行改写的幂等重跑不进本守卫、不 bump。
      await bumpSyncDataVersion();
      emitGalleryPathsRelocated({ affected, totalCount });
    }
    return { success: true, data: { affected } };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[galleryRelocateService] applyRelocateRoot 失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 列出磁盘上不存在的绑定文件夹（只读，不改库）。
 *
 * 逐条检查 gallery_folders.folderPath 是否可 fs.access；不存在的行返回出来，
 * 供 UI 在搬库/迁移后高亮"需要重定位"的相册。一次 access 失败（含 ENOENT、
 * 权限等任何错误）都视为缺失——目标只是给用户一个需要关注的清单。
 * 附带相册名（galleryName）供重定位弹窗按行标注归属；LEFT JOIN 防御悬挂绑定行，
 * 相册缺失时回退空串。
 */
export async function getMissingGalleryFolders(): Promise<
  Array<{ galleryId: number; folderPath: string; galleryName: string }>
> {
  const db = await getDatabase();
  const rows = await all<{ galleryId: number; folderPath: string; galleryName: string | null }>(
    db,
    `SELECT gf.galleryId, gf.folderPath, g.name AS galleryName
       FROM gallery_folders gf
       LEFT JOIN galleries g ON g.id = gf.galleryId
      WHERE gf.folderPath IS NOT NULL AND gf.folderPath <> ''`
  );

  const missing: Array<{ galleryId: number; folderPath: string; galleryName: string }> = [];
  for (const row of rows) {
    try {
      // 入库值本已归一化，这里再过一遍 normalizePath 仅为与本文件其它路径处理保持一致，
      // 不改变行为；返回时仍回传 DB 原值 row.folderPath。
      await fs.access(normalizePath(row.folderPath));
    } catch {
      missing.push({ galleryId: row.galleryId, folderPath: row.folderPath, galleryName: row.galleryName ?? '' });
    }
  }
  return missing;
}
