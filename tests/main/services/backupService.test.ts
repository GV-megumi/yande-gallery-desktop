import { describe, expect, it } from 'vitest';
import {
  BACKUP_RESTORE_ORDER,
  BACKUP_TABLES,
  isValidBackupData,
  summarizeBackupTables,
  type BackupTableName,
  type AppBackupData,
} from '../../../src/main/services/backupService';

function createEmptyTables(): Record<BackupTableName, Record<string, unknown>[]> {
  return BACKUP_TABLES.reduce((acc, table) => {
    acc[table] = [];
    return acc;
  }, {} as Record<BackupTableName, Record<string, unknown>[]>);
}

describe('backupService constants', () => {
  it('restore order should match backup tables order', () => {
    expect(BACKUP_RESTORE_ORDER).toEqual(BACKUP_TABLES);
  });

  it('backup tables should include saved searches and favorite groups', () => {
    expect(BACKUP_TABLES).toContain('booru_saved_searches');
    expect(BACKUP_TABLES).toContain('booru_favorite_groups');
  });
});

describe('isValidBackupData', () => {
  const validBackup: AppBackupData = {
    version: 1,
    exportedAt: '2026-03-15T00:00:00.000Z',
    config: {
      dataPath: 'data',
      database: { path: 'gallery.db', logging: true },
      downloads: { path: 'downloads', createSubfolders: true, subfolderFormat: ['tags'] },
      galleries: { folders: [] },
      thumbnails: { cachePath: 'thumbnails', maxWidth: 800, maxHeight: 800, quality: 92, format: 'webp' },
      app: { recentImagesCount: 100, pageSize: 50, defaultViewMode: 'grid', showImageInfo: true, autoScan: true, autoScanInterval: 30 },
      yande: { apiUrl: 'https://yande.re/post.json', pageSize: 20, downloadTimeout: 60, maxConcurrentDownloads: 5 },
      logging: { level: 'info', filePath: 'app.log', consoleOutput: true, maxFileSize: 10, maxFiles: 5 },
      network: { proxy: { enabled: false, protocol: 'http', host: '127.0.0.1', port: 7890 } },
      booru: {
        appearance: { gridSize: 330, previewQuality: 'auto', itemsPerPage: 20, paginationPosition: 'bottom', pageMode: 'pagination', spacing: 16, borderRadius: 8, margin: 24 },
        download: { filenameTemplate: '{id}.{extension}', tokenDefaults: {} },
      },
    },
    tables: createEmptyTables(),
  };

  it('accepts a complete backup payload', () => {
    expect(isValidBackupData(validBackup)).toBe(true);
  });

  it('rejects payloads missing required tables', () => {
    const invalid = {
      ...validBackup,
      tables: {
        ...validBackup.tables,
      },
    } as any;
    delete invalid.tables.booru_saved_searches;
    expect(isValidBackupData(invalid)).toBe(false);
  });

  it('rejects unknown versions', () => {
    expect(isValidBackupData({ ...validBackup, version: 2 })).toBe(false);
  });
});

describe('summarizeBackupTables', () => {
  it('returns counts for each backup table', () => {
    const backup = {
      version: 1,
      exportedAt: '2026-03-15T00:00:00.000Z',
      config: {} as AppBackupData['config'],
      tables: BACKUP_TABLES.reduce((acc, table) => {
        acc[table] = table === 'booru_sites' ? [{ id: 1 }] : [];
        return acc;
      }, {} as Record<BackupTableName, Record<string, unknown>[]>),
    } as AppBackupData;

    const summary = summarizeBackupTables(backup);
    expect(summary).toHaveLength(BACKUP_TABLES.length);
    expect(summary.find((item) => item.table === 'booru_sites')?.count).toBe(1);
    expect(summary.find((item) => item.table === 'booru_saved_searches')?.count).toBe(0);
  });
});
