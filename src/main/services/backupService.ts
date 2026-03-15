import { getConfig, saveConfig, type AppConfig } from './config.js';
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
  config: AppConfig;
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
    tables[table] = await all<Record<string, unknown>>(db, `SELECT * FROM ${table}`);
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    config: getConfig(),
    tables,
  };
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

  await saveConfig(backupData.config);
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
          const { sql, values } = buildInsertStatement(table, row);
          await run(db, sql, values as any[]);
        }
      }
    });
  } finally {
    await run(db, 'PRAGMA foreign_keys = ON');
  }

  return {
    mode,
    restoredTables: summarizeBackupTables(backupData),
  };
}
