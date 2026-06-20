import type sqlite3 from 'sqlite3';
import {
  getConfig,
  saveConfig,
  toRendererSafeUiConfig,
  type AppConfig,
  type ConfigSaveInput,
  type RendererSafeAppConfig,
} from './config.js';
import { all, getDatabase, run, runInTransaction } from './database.js';
import { loadGalleryRoots } from './galleryRootRegistry.js';
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
] as const;

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

  return BACKUP_TABLES.every((table) => Array.isArray(candidate.tables?.[table]));
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

  await run(db, 'PRAGMA foreign_keys = OFF');

  try {
    await runInTransaction(db, async () => {
      if (mode === 'replace') {
        for (const table of [...BACKUP_RESTORE_ORDER].reverse()) {
          await run(db, `DELETE FROM ${table}`);
        }
      }

      for (const table of BACKUP_RESTORE_ORDER) {
        const rows = backupData.tables[table] ?? [];
        for (const row of rows) {
          // 即便备份文件中残留了 salt / apiKey / passwordHash 这类敏感列，
          // 恢复阶段也不应把它们写回数据库；只有用户后续主动重新登录时才能重建。
          const { sql, values } = buildInsertStatement(table, sanitizeBackupRow(table, row));
          await run(db, sql, values as any[]);
        }
      }
    });

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
  } finally {
    await run(db, 'PRAGMA foreign_keys = ON');
  }

  // 恢复直接改写了 galleries 表，但 galleryRootRegistry 是进程内同步缓存（app:// 文件白名单来源），
  // 不会自动跟随 SQL 改写刷新。这里从 DB 重新装载，避免恢复后图库图片因白名单过期而无法通过 app:// 加载。
  const restoredGalleryRows = await all<{ folderPath: string }>(db, 'SELECT folderPath FROM galleries');
  loadGalleryRoots(restoredGalleryRows.map((row) => row.folderPath).filter(Boolean));

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
