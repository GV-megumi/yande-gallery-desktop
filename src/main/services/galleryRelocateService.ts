/**
 * 图库根路径重定位服务（跨机迁移，Phase 5，主进程专用）
 *
 * 使用场景：用户把 DB 与图片文件一起搬到另一台机器，整个库的路径前缀变了
 * （例如 N:\hk\yande_download\* → D:\art\*）。本服务把 DB 中所有存储路径的旧前缀
 * 无损改写为新前缀——不重新扫描、不丢失图片身份/标签/封面/Booru 关联，只改路径字符串。
 *
 * 安全是第一位的（relocateRoot 会横跨整库改路径）：
 *   - previewRelocateRoot 先做 dry-run 预检：统计会改多少行 + 检测 UNIQUE 冲突，不写库；
 *   - applyRelocateRoot 在单个事务内改写，任一 UNIQUE 冲突先于写入被发现则整体中止、零写入；
 *   - 前缀匹配是"目录边界感知"的（M:\art 不匹配兄弟目录 M:\artists\x），
 *     且权威匹配在 JS 侧做，避免 SQL LIKE 的 _ / % / \ 通配符语义引入误判。
 *
 * 涉及的 5 个 (表, 列) 改写点（均存归一化后的路径）：
 *   - gallery_folders.folderPath          （UNIQUE）
 *   - images.filepath                      （UNIQUE）
 *   - booru_posts.localPath               （可空，非唯一）
 *   - booru_favorite_tag_download_bindings.downloadPath （NOT NULL，非唯一）
 *   - gallery_ignored_folders.folderPath  （UNIQUE）
 *
 * 缩略图是按源 filepath 派生的缓存，不在此改写范围内（搬库后会按新路径惰性重建）。
 */
import path from 'path';
import { getDatabase, all, run, runInTransaction } from './database.js';
import { normalizePath } from '../utils/path.js';
import { loadGalleryRoots } from './galleryRootRegistry.js';
import { getAllGalleryFolderPaths } from './galleryService.js';

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

/** previewRelocateRoot 的返回数据形态。 */
export interface RelocatePreviewData {
  /** 每个 (表, 列) 会被改写的行数。 */
  affected: Array<{ table: string; column: string; count: number }>;
  /** UNIQUE 列改写后会撞上既有行的冲突列表（存在任一则禁止 apply）。 */
  collisions: Array<{ table: string; column: string; path: string }>;
}

/** 单个站点的扫描结果（供 preview 计数与 apply 改写复用）。 */
interface SiteScan {
  site: RelocateSite;
  /** 命中前缀、需要改写的行：主键 id + 改写后的新路径。 */
  matched: Array<{ id: number; newPath: string }>;
  /** 改写后与既有行冲突的目标路径（仅 UNIQUE 列）。 */
  collisions: string[];
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

  const collisions: string[] = [];
  if (site.isUnique) {
    for (const m of matched) {
      const targetKey = toCompareKey(normalizePath(m.newPath));
      // 改写目标撞上某个既有行，且那个既有行自身不在被改写集合内 → UNIQUE 冲突。
      // （若既有行也会被改写走，则改写后不再占用该路径，不算冲突。）
      if (existingKeys.has(targetKey) && !matchedKeys.has(targetKey)) {
        collisions.push(m.newPath);
      }
    }
  }

  return { site, matched, collisions };
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
 */
export async function previewRelocateRoot(
  mappings: RelocateMapping[]
): Promise<{ success: boolean; data?: RelocatePreviewData; error?: string }> {
  try {
    const db = await getDatabase();
    const scans = await scanAllSites(db, mappings);

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

    return { success: true, data: { affected, collisions } };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[galleryRelocateService] previewRelocateRoot 失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}
