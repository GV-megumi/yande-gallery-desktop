import type sqlite3 from 'sqlite3';
import {
  bumpSyncDataVersion,
  getConfig,
  saveConfig,
  toRendererSafeUiConfig,
  type AppConfig,
  type ConfigSaveInput,
  type RendererSafeAppConfig,
} from './config.js';
import { all, getDatabase, run, runExclusive, runInTransaction } from './database.js';
import { normalizePath } from '../utils/path.js';
import { loadGalleryRoots } from './galleryRootRegistry.js';
import { getAllGalleryFolderPaths } from './galleryService.js';
import { emitAppDataRestored, emitConfigChanged } from './appEventPublisher.js';
import { IPC_CHANNELS } from '../ipc/channels.js';
import type { ConfigChangedSummary } from '../../shared/types.js';

export const BACKUP_TABLES = [
  'booru_sites',
  'booru_posts',
  'booru_tags',
  'booru_post_tags',
  'booru_favorite_groups',
  'booru_favorites',
  'booru_search_history',
  'booru_favorite_tag_labels',
  'booru_favorite_tags',
  'booru_blacklisted_tags',
  'booru_saved_searches',
  'galleries',
  // 图集解耦（gallery_folders + gallery_images）后，文件夹绑定与图片成员是图集数据的一部分，
  // 必须随备份导出/恢复，否则异机恢复只剩无文件夹、无成员的空壳图集且无法重扫重建。
  // 排在 galleries 之后：恢复正序先父后子、replace/回滚删除逆序先子后父，天然满足 FK 依赖；
  // 同时 replace 模式显式清这两张表，消除 FK OFF 下 DELETE galleries 不触发 CASCADE 留下的
  // 幽灵绑定（悬挂行会永久占用 folderPath 全局 UNIQUE、阻塞孤儿 GC、污染 app:// 白名单）。
  'gallery_folders',
  'gallery_images',
] as const;

// 旧版本（图集解耦前）导出的备份文件不含这两张表：格式校验时按可选处理（缺失视为空表），
// 避免历史备份被一刀切判为格式无效；恢复循环里对缺失表按空数组处理。
const OPTIONAL_BACKUP_TABLES: ReadonlySet<string> = new Set(['gallery_folders', 'gallery_images']);

export const BACKUP_RESTORE_ORDER = [...BACKUP_TABLES];

export type BackupTableName = (typeof BACKUP_TABLES)[number];

export interface AppBackupData {
  version: 1;
  exportedAt: string;
  config: RendererSafeAppConfig;
  tables: Record<BackupTableName, Record<string, unknown>[]>;
}

export interface BackupSummaryItem {
  table: BackupTableName;
  count: number;
}

export interface RestoreBackupOptions {
  mode?: 'merge' | 'replace';
}

export interface RestoreBackupResult {
  mode: 'merge' | 'replace';
  restoredTables: BackupSummaryItem[];
}

export function summarizeBackupTables(data: AppBackupData): BackupSummaryItem[] {
  return BACKUP_TABLES.map((table) => ({
    table,
    count: Array.isArray(data.tables[table]) ? data.tables[table].length : 0,
  }));
}

// 敏感列剔除表：按表名声明哪些字段不允许进入备份文件。
// 站点凭证(salt/apiKey/passwordHash)即便已被 renderer 端去敏
// 也绝不允许随备份导出，避免导出文件被明文分发或同步到云端。
const SENSITIVE_COLUMNS_BY_TABLE: Partial<Record<BackupTableName, readonly string[]>> = {
  booru_sites: ['salt', 'apiKey', 'passwordHash'] as const,
};

function sanitizeBackupRow(table: BackupTableName, row: Record<string, unknown>): Record<string, unknown> {
  const sensitive = SENSITIVE_COLUMNS_BY_TABLE[table];
  if (!sensitive || sensitive.length === 0) {
    return row;
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (sensitive.includes(key)) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function sanitizeBackupTableRows(
  table: BackupTableName,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const sensitive = SENSITIVE_COLUMNS_BY_TABLE[table];
  if (!sensitive || sensitive.length === 0) {
    return rows;
  }
  return rows.map((row) => sanitizeBackupRow(table, row));
}

function projectBackupSafeConfig(config: {
  dataPath?: AppConfig['dataPath'];
  database: AppConfig['database'];
  downloads: AppConfig['downloads'];
  thumbnails: AppConfig['thumbnails'];
  app: AppConfig['app'];
  yande: AppConfig['yande'];
  network: {
    proxy: {
      enabled: boolean;
      protocol: AppConfig['network']['proxy']['protocol'];
      host: string;
      port: number;
    };
  };
  ui?: AppConfig['ui'];
  booru?: AppConfig['booru'];
}): RendererSafeAppConfig {
  return {
    dataPath: config.dataPath,
    database: config.database,
    downloads: config.downloads,
    thumbnails: config.thumbnails,
    app: config.app,
    yande: config.yande,
    network: {
      proxy: {
        enabled: config.network.proxy.enabled,
        protocol: config.network.proxy.protocol,
        host: config.network.proxy.host,
        port: config.network.proxy.port,
      },
    },
    ui: toRendererSafeUiConfig(config.ui),
    booru: config.booru,
  };
}

export function createBackupSafeConfig(config: AppConfig): RendererSafeAppConfig {
  return projectBackupSafeConfig(config);
}

export function sanitizeImportedBackupConfig(config: RendererSafeAppConfig): ConfigSaveInput {
  return projectBackupSafeConfig(config);
}

export function isValidBackupData(value: unknown): value is AppBackupData {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<AppBackupData>;
  if (candidate.version !== 1 || typeof candidate.exportedAt !== 'string' || !candidate.config || !candidate.tables) {
    return false;
  }

  return BACKUP_TABLES.every((table) => {
    const rows = candidate.tables?.[table];
    // 旧版备份（图集解耦前导出）没有 gallery_folders / gallery_images：缺失时放行；
    // 若存在则仍必须是数组，防止畸形数据混进恢复流程。
    if (rows === undefined && OPTIONAL_BACKUP_TABLES.has(table)) {
      return true;
    }
    return Array.isArray(rows);
  });
}

/** 读目标表当前列集（PRAGMA table_info）。表名来自 BACKUP_TABLES 白名单，无注入风险。 */
async function getTableColumnSet(db: sqlite3.Database, table: BackupTableName): Promise<Set<string>> {
  const rows = await all<{ name: string }>(db, `PRAGMA table_info(${table})`);
  return new Set(rows.map((row) => row.name));
}

/**
 * 只保留目标表当前存在的列（通用防御）：
 * 1) 旧版备份可能携带已删除的列（如 contract 前的 galleries.folderPath/isWatching/
 *    recursive/extensions），直接拼进 INSERT 会让整个恢复事务失败；
 * 2) 列名来自备份文件这一外部输入，buildInsertStatement 会把它拼进 SQL，
 *    按当前表结构白名单过滤顺带杜绝列名注入。
 */
function pickKnownColumns(row: Record<string, unknown>, columns: Set<string>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (columns.has(key)) {
      picked[key] = value;
    }
  }
  return picked;
}

/** 旧版 galleries 行转写出的 gallery_folders 绑定（图集解耦前 folderPath 直接存在 galleries 上） */
interface LegacyGalleryFolderBinding {
  galleryId: number;
  folderPath: string;
  recursive: unknown;
  extensions: unknown;
  createdAt: string;
  updatedAt: string;
}

/**
 * 旧版（图集解耦前）备份的 galleries 行语义映射：
 * - isWatching → autoScan（列改名；NULL 回退 1，与 contractGalleriesTable 的 COALESCE(isWatching, 1) 一致）；
 * - folderPath(+recursive/extensions) 已不再是 galleries 的列，转写为一条 gallery_folders 绑定行
 *   （路径 normalizePath、INSERT OR IGNORE，与启动迁移 backfillGalleryFolders 的回填语义一致）。
 * 新格式行没有这些旧列，本函数直通返回。
 * 注意：旧备份没有 gallery_images 成员数据，恢复后 imageCount 重算为 0 是诚实结果——
 * 文件夹绑定已经恢复，用户重新扫描即可找回成员与计数。
 */
function mapLegacyGalleryRow(row: Record<string, unknown>): {
  row: Record<string, unknown>;
  binding: LegacyGalleryFolderBinding | null;
} {
  const hasLegacyWatch = 'isWatching' in row;
  const hasLegacyFolder = 'folderPath' in row;
  if (!hasLegacyWatch && !hasLegacyFolder) {
    return { row, binding: null };
  }

  const mapped: Record<string, unknown> = { ...row };
  if (hasLegacyWatch && !('autoScan' in mapped)) {
    const watching = mapped.isWatching;
    mapped.autoScan = watching === null || watching === undefined ? 1 : watching;
  }

  let binding: LegacyGalleryFolderBinding | null = null;
  const folderPath = row.folderPath;
  const galleryId = row.id;
  if (typeof folderPath === 'string' && folderPath.trim() !== '') {
    if (typeof galleryId === 'number') {
      const nowIso = new Date().toISOString();
      binding = {
        galleryId,
        folderPath: normalizePath(folderPath),
        recursive: row.recursive === null || row.recursive === undefined ? 1 : row.recursive,
        extensions: row.extensions ?? null,
        createdAt: typeof row.createdAt === 'string' ? row.createdAt : nowIso,
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : nowIso,
      };
    } else {
      // SELECT * 导出的行必带 id；缺失/非数字说明备份被人工改动，无法定位归属图集，只放弃绑定转写
      console.warn('[backupService] 旧版 galleries 行缺有效 id，folderPath 绑定未转写:', String(folderPath));
    }
  }

  return { row: mapped, binding };
}

function buildInsertStatement(table: BackupTableName, row: Record<string, unknown>): { sql: string; values: unknown[] } {
  const columns = Object.keys(row);
  if (columns.length === 0) {
    throw new Error(`备份表 ${table} 存在空行，无法恢复`);
  }

  const placeholders = columns.map(() => '?').join(', ');
  const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
  const values = columns.map((column) => row[column]);

  return { sql, values };
}

export async function createAppBackupData(): Promise<AppBackupData> {
  const db = await getDatabase();
  const tables = {} as Record<BackupTableName, Record<string, unknown>[]>;

  for (const table of BACKUP_TABLES) {
    const rawRows = await all<Record<string, unknown>>(db, `SELECT * FROM ${table}`);
    // 按表剔除敏感列，确保备份文件不会携带站点凭证等不应外流的字段。
    tables[table] = sanitizeBackupTableRows(table, rawRows);
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    config: createBackupSafeConfig(getConfig()),
    tables,
  };
}

async function snapshotCurrentBackupTables(db: sqlite3.Database): Promise<Record<BackupTableName, Record<string, unknown>[]>> {
  const tables = {} as Record<BackupTableName, Record<string, unknown>[]>;

  for (const table of BACKUP_TABLES) {
    tables[table] = await all<Record<string, unknown>>(db, `SELECT * FROM ${table}`);
  }

  return tables;
}

async function restoreBackupTablesSnapshot(
  db: sqlite3.Database,
  tables: Record<BackupTableName, Record<string, unknown>[]>
): Promise<void> {
  await runInTransaction(db, async () => {
    for (const table of [...BACKUP_RESTORE_ORDER].reverse()) {
      await run(db, `DELETE FROM ${table}`);
    }

    for (const table of BACKUP_RESTORE_ORDER) {
      const rows = tables[table] ?? [];
      for (const row of rows) {
        const { sql, values } = buildInsertStatement(table, row);
        await run(db, sql, values as any[]);
      }
    }
  });
}

type LegacyBroadcastWindow = {
  isDestroyed?: () => boolean;
  webContents?: { send?: (channel: string, payload: ConfigChangedSummary) => void };
};

// 兼容广播：把配置变更摘要发到旧的 IPC_CHANNELS.CONFIG_CHANGED 频道。
// 为何需要双通道广播——emitConfigChanged 只发新的 SYSTEM_APP_EVENT 事件总线，
// 而 preload 侧 config.onChanged / booruPreferences.onAppearanceChanged 等旧订阅方
// 仍监听旧频道、尚未迁移到新事件总线；若恢复备份后只发新总线，
// 这些订阅方会继续持有恢复前的过期配置。
// 负载形态与 configHandlers.broadcastConfigChanged 保持完全一致（ConfigChangedSummary 摘要），
// electron 采用动态导入（参照 rendererEventBus 的做法），保证纯 Node 测试环境下安全降级。
async function broadcastLegacyConfigChanged(summary: ConfigChangedSummary): Promise<void> {
  let getAllWindows: (() => unknown) | undefined;
  try {
    const electron = await import('electron');
    const browserWindow = (electron as { BrowserWindow?: { getAllWindows?: () => unknown } }).BrowserWindow;
    getAllWindows = typeof browserWindow?.getAllWindows === 'function'
      ? browserWindow.getAllWindows.bind(browserWindow)
      : undefined;
  } catch {
    getAllWindows = undefined;
  }

  let rawWindows: unknown = [];
  try {
    rawWindows = typeof getAllWindows === 'function' ? getAllWindows() : [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[backupService] 获取窗口列表失败，旧配置变更频道未广播:', message);
    return;
  }

  if (!Array.isArray(rawWindows)) {
    return;
  }

  for (const win of rawWindows as LegacyBroadcastWindow[]) {
    try {
      if (typeof win.isDestroyed === 'function' && win.isDestroyed()) {
        continue;
      }
      if (typeof win.webContents?.send !== 'function') {
        continue;
      }
      win.webContents.send(IPC_CHANNELS.CONFIG_CHANGED, summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[backupService] 旧配置变更频道广播失败:', message);
    }
  }
}

export async function restoreAppBackupData(
  backupData: AppBackupData,
  options: RestoreBackupOptions = {}
): Promise<RestoreBackupResult> {
  if (!isValidBackupData(backupData)) {
    throw new Error('备份文件格式无效');
  }

  const mode = options.mode ?? 'merge';
  const db = await getDatabase();
  const previousConfig = getConfig();
  const previousTables = await snapshotCurrentBackupTables(db);
  let importedConfigApplied = false;

  // FK 开关必须在事务外执行才生效，且必须与全部排队事务互斥（runExclusive）：
  // 若收尾的 PRAGMA ON 恰落进某个并发开放事务的窗口，SQLite 会静默忽略它，
  // 外键从此进程级保持 OFF——deleteGallery 依赖的 CASCADE 失效、悄然产生僵尸成员行。
  // 独占段内不能再用 runInTransaction（它在同一条队列上自等而死锁），改用裸
  // BEGIN/COMMIT + began 标志（防 BEGIN 失败还 ROLLBACK 掉别人的事务），
  // 与 contractGalleriesTable 同一模式。
  await runExclusive(db, async () => {
    await run(db, 'PRAGMA foreign_keys = OFF');
    try {
      let began = false;
      try {
        await run(db, 'BEGIN TRANSACTION');
        began = true;
        if (mode === 'replace') {
          for (const table of [...BACKUP_RESTORE_ORDER].reverse()) {
            await run(db, `DELETE FROM ${table}`);
          }
        }

        for (const table of BACKUP_RESTORE_ORDER) {
          const rows = backupData.tables[table] ?? [];
          if (rows.length === 0) {
            continue;
          }

          // 目标表当前列集：懒取（仅对有行的表查一次 PRAGMA），供插入前过滤备份行中的未知列。
          // 真实存在的表 PRAGMA table_info 必非空；空集只会出现在表缺失或测试 mock 环境，
          // 此时过滤没有意义（缺表时 INSERT 本就会失败），跳过过滤保持原行为。
          const columns = await getTableColumnSet(db, table);

          for (const row of rows) {
            // 即便备份文件中残留了 salt / apiKey / passwordHash 这类敏感列，
            // 恢复阶段也不应把它们写回数据库；只有用户后续主动重新登录时才能重建。
            let sanitized = sanitizeBackupRow(table, row);

            // 旧版（图集解耦前）备份的 galleries 行：isWatching→autoScan 语义映射，
            // folderPath/recursive/extensions 转写为 gallery_folders 绑定（见 mapLegacyGalleryRow）。
            let legacyBinding: LegacyGalleryFolderBinding | null = null;
            if (table === 'galleries') {
              const mapped = mapLegacyGalleryRow(sanitized);
              sanitized = mapped.row;
              legacyBinding = mapped.binding;
            }

            const filtered = columns.size > 0 ? pickKnownColumns(sanitized, columns) : sanitized;
            if (Object.keys(filtered).length === 0 && Object.keys(row).length > 0) {
              // 整行与当前表结构无共同列：跳过并告警，不让单行异构数据拖垮整个恢复事务。
              // （原始空行 {} 不走这里，仍由 buildInsertStatement 按坏数据抛错。）
              console.warn(`[backupService] 备份表 ${table} 行与当前表结构无共同列，已跳过该行`);
              continue;
            }

            const { sql, values } = buildInsertStatement(table, filtered);
            await run(db, sql, values as any[]);

            if (legacyBinding) {
              // INSERT OR IGNORE：folderPath 全局唯一，若该路径已被现有图集绑定则保留现状，
              // 与启动迁移 backfillGalleryFolders 的幂等回填语义一致。
              await run(
                db,
                `INSERT OR IGNORE INTO gallery_folders (galleryId, folderPath, recursive, extensions, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                  legacyBinding.galleryId,
                  legacyBinding.folderPath,
                  legacyBinding.recursive,
                  legacyBinding.extensions,
                  legacyBinding.createdAt,
                  legacyBinding.updatedAt,
                ] as any[]
              );
            }
          }
        }

        // images 表按机重建、不随备份走：异机（或清库后）恢复时，备份携带的 imageId 引用
        // 在本库不存在，FK OFF 期间会以悬挂引用落库。悬挂引用绝不能保留——后续重扫产生的
        // 新图片会复用 AUTOINCREMENT id，使这些引用静默指向完全无关的图片（成员错误归属、
        // 封面/下载关联错图）。统一在重算 imageCount 之前清理：成员行删除，SET NULL 语义的引用置空。
        await run(db, `DELETE FROM gallery_images WHERE imageId NOT IN (SELECT id FROM images)`);
        await run(db, `
          UPDATE galleries
             SET coverImageId = NULL
           WHERE coverImageId IS NOT NULL
             AND coverImageId NOT IN (SELECT id FROM images)
        `);
        // booru_posts.localImageId 同属指向 images 的引用（FK SET NULL）；
        // 老库/精简测试库可能没有该列，按列存在性守卫。
        const booruPostColumns = await getTableColumnSet(db, 'booru_posts');
        if (booruPostColumns.has('localImageId')) {
          await run(db, `
            UPDATE booru_posts
               SET localImageId = NULL
             WHERE localImageId IS NOT NULL
               AND localImageId NOT IN (SELECT id FROM images)
          `);
        }

        // §5.1 不变量：galleries.imageCount 是 gallery_images 成员数的缓存。
        // 备份行里携带的 imageCount 可能与恢复后的成员表不一致（merge 合并成员、
        // 旧版备份无成员数据、上方悬挂成员清理等），恢复末尾统一按成员表重算，避免恢复出陈旧计数。
        await run(db, `
          UPDATE galleries
             SET imageCount = (SELECT COUNT(*) FROM gallery_images WHERE gallery_images.galleryId = galleries.id)
        `);
        await run(db, 'COMMIT');
      } catch (error) {
        if (began) {
          try {
            await run(db, 'ROLLBACK');
          } catch (rollbackError) {
            console.error('[backupService] 恢复事务 ROLLBACK 失败:', rollbackError);
          }
        }
        throw error;
      }
    } finally {
      await run(db, 'PRAGMA foreign_keys = ON');
    }
  });

  // 表数据已提交后再落导入配置；保存失败用启动前快照回滚表数据并抛错。
  // restoreBackupTablesSnapshot 内部走 runInTransaction，必须在独占段之外调用。
  try {
    const importedConfigSaveResult = await saveConfig(sanitizeImportedBackupConfig(backupData.config));
    if (!importedConfigSaveResult.success) {
      await restoreBackupTablesSnapshot(db, previousTables);
      throw new Error(importedConfigSaveResult.error || 'save imported config failed');
    }
    importedConfigApplied = true;
  } catch (error) {
    if (importedConfigApplied) {
      await saveConfig(previousConfig);
    }
    throw error;
  }

  // 恢复直接改写了表，但 galleryRootRegistry 是进程内同步缓存（app:// 文件白名单来源），
  // 不会自动跟随 SQL 改写刷新。这里从 DB 重新装载，避免恢复后图库图片因白名单过期而无法通过 app:// 加载。
  // Phase 4：改从 gallery_folders 读全部绑定文件夹（含 bindFolder 追加 / changeFolderPath 重定位的），
  // 而非 galleries 旧列 folderPath，保证恢复后的白名单覆盖当前真实绑定集合。
  loadGalleryRoots(await getAllGalleryFolderPaths());

  // 备份恢复属破坏性数据变更：递增 dataVersion 让移动端全量重建镜像（spec §5.3）。
  // 位置在所有回滚点之后、结果构建之前：保存失败只 console.error，不回滚已恢复的数据。
  await bumpSyncDataVersion();

  const result: RestoreBackupResult = {
    mode,
    restoredTables: summarizeBackupTables(backupData),
  };
  emitAppDataRestored(result);
  // 同一份摘要同时发新事件总线和旧 IPC 频道，保证两侧订阅方看到一致的 version。
  const configChangedSummary: ConfigChangedSummary = {
    version: Date.now(),
    sections: ['database', 'galleries', 'booru', 'apiService', 'ui'],
  };
  emitConfigChanged(configChangedSummary);
  // 双通道广播：兼容尚未迁移到新事件总线的旧频道订阅方（详见 broadcastLegacyConfigChanged 注释）。
  // 这里等待广播完成，确保 IPC 恢复结果返回前旧订阅方已收到配置变更通知。
  await broadcastLegacyConfigChanged(configChangedSummary);
  return result;
}
