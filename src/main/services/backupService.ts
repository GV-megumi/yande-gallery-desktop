import {
  getConfig,
  saveConfig,
  toRendererSafeUiConfig,
  type AppConfig,
  type ConfigSaveInput,
  type RendererSafeAppConfig,
} from './config.js';
import { all, getDatabase, run, runInTransaction } from './database.js';

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
  galleries: AppConfig['galleries'];
  thumbnails: AppConfig['thumbnails'];
  app: AppConfig['app'];
  yande: AppConfig['yande'];
  logging: AppConfig['logging'];
  network: {
    proxy: {
      enabled: boolean;
      protocol: AppConfig['network']['proxy']['protocol'];
      host: string;
      port: number;
    };
  };
  google?: {
    clientId: string;
    drive: NonNullable<AppConfig['google']>['drive'];
    photos: NonNullable<AppConfig['google']>['photos'];
  };
  ui?: AppConfig['ui'];
  booru?: AppConfig['booru'];
}): RendererSafeAppConfig {
  return {
    dataPath: config.dataPath,
    database: config.database,
    downloads: config.downloads,
    galleries: config.galleries,
    thumbnails: config.thumbnails,
    app: config.app,
    yande: config.yande,
    logging: config.logging,
    network: {
      proxy: {
        enabled: config.network.proxy.enabled,
        protocol: config.network.proxy.protocol,
        host: config.network.proxy.host,
        port: config.network.proxy.port,
      },
    },
    google: config.google
      ? {
          clientId: config.google.clientId,
          drive: config.google.drive,
          photos: config.google.photos,
        }
      : undefined,
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

  return {
    mode,
    restoredTables: summarizeBackupTables(backupData),
  };
}
