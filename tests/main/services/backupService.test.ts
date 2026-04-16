import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mergeSensitiveConfig,
  normalizeConfigSaveInput,
  toRendererSafeUiConfig,
  type AppConfig,
} from '../../../src/main/services/config.js';
import {
  BACKUP_RESTORE_ORDER,
  BACKUP_TABLES,
  createBackupSafeConfig,
  sanitizeImportedBackupConfig,
  isValidBackupData,
  summarizeBackupTables,
  type BackupTableName,
  type AppBackupData,
} from '../../../src/main/services/backupService';

function createBackupPayload(): AppBackupData {
  return {
    version: 1,
    exportedAt: '2026-03-15T00:00:00.000Z',
    config: {
      dataPath: 'restored-data',
      database: { path: 'gallery.db', logging: true },
      downloads: { path: 'restored-downloads', createSubfolders: true, subfolderFormat: ['tags'] },
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
}

function createEmptyTables(): Record<BackupTableName, Record<string, unknown>[]> {
  return BACKUP_TABLES.reduce((acc, table) => {
    acc[table] = [];
    return acc;
  }, {} as Record<BackupTableName, Record<string, unknown>[]>);
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

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

describe('restoreAppBackupData', () => {
  it('数据库恢复失败时不应写入导入配置，避免配置和数据库进入半完成状态', async () => {
    const backupData = createBackupPayload();
    const currentConfig = {
      downloads: { path: 'current-downloads' },
      ui: { theme: 'dark' },
    };

    const saveConfigMock = vi.fn(async () => ({ success: true }));
    const allMock = vi.fn(async () => []);
    const runMock = vi.fn(async () => undefined);
    const runInTransactionMock = vi.fn(async (_db: unknown, callback: () => Promise<unknown>) => {
      await callback();
      throw new Error('restore table failed');
    });

    vi.doMock('../../../src/main/services/config.js', () => ({
      getConfig: vi.fn(() => currentConfig),
      saveConfig: saveConfigMock,
      toRendererSafeUiConfig,
    }));

    vi.doMock('../../../src/main/services/database.js', () => ({
      getDatabase: vi.fn(async () => ({})),
      all: allMock,
      run: runMock,
      runInTransaction: runInTransactionMock,
    }));

    const { restoreAppBackupData } = await import('../../../src/main/services/backupService');

    await expect(restoreAppBackupData(backupData, { mode: 'replace' })).rejects.toThrow('restore table failed');
    expect(allMock).toHaveBeenCalledTimes(BACKUP_TABLES.length);
    expect(saveConfigMock).not.toHaveBeenCalled();
    expect(runInTransactionMock).toHaveBeenCalledTimes(1);
  });

  it('配置写入失败时应回滚已恢复的数据库，避免配置和数据库分裂', async () => {
    const backupData = createBackupPayload();
    backupData.tables.booru_sites = [{ id: 1, name: 'restored-site' }];

    const currentConfig = {
      downloads: { path: 'current-downloads' },
      ui: { theme: 'dark' },
    };

    const saveConfigMock = vi
      .fn(async () => ({ success: true }))
      .mockResolvedValueOnce({ success: false, error: 'save imported config failed' });
    const allMock = vi
      .fn(async (_db: unknown, sql: string) => {
        if (sql === 'SELECT * FROM booru_sites') {
          return [{ id: 9, name: 'original-site' }];
        }
        return [];
      });
    const runMock = vi.fn(async () => undefined);
    const runInTransactionMock = vi.fn(async (_db: unknown, callback: () => Promise<unknown>) => {
      await callback();
    });

    vi.doMock('../../../src/main/services/config.js', () => ({
      getConfig: vi.fn(() => currentConfig),
      saveConfig: saveConfigMock,
      toRendererSafeUiConfig,
    }));

    vi.doMock('../../../src/main/services/database.js', () => ({
      getDatabase: vi.fn(async () => ({})),
      all: allMock,
      run: runMock,
      runInTransaction: runInTransactionMock,
    }));

    const { restoreAppBackupData } = await import('../../../src/main/services/backupService');

    await expect(restoreAppBackupData(backupData, { mode: 'replace' })).rejects.toThrow('save imported config failed');
    expect(saveConfigMock).toHaveBeenCalledTimes(1);
    expect(allMock).toHaveBeenCalledTimes(BACKUP_TABLES.length);
    expect(runInTransactionMock).toHaveBeenCalledTimes(2);

    const insertOriginalSiteCall = runMock.mock.calls.find(([_, sql, values]) =>
      typeof sql === 'string'
      && sql.includes('INSERT OR REPLACE INTO booru_sites')
      && Array.isArray(values)
      && values.includes('original-site')
    );
    expect(insertOriginalSiteCall).toBeTruthy();
  });
});

describe('booru_sites backup column sanitization', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('导出备份时应从 booru_sites 行中移除 salt / apiKey / passwordHash 等凭证列', async () => {
    const booruSitesRows = [
      {
        id: 1,
        name: 'Yande',
        url: 'https://yande.re',
        type: 'moebooru',
        salt: 'secret-salt',
        apiKey: 'secret-key',
        username: 'alice',
        passwordHash: 'secret-hash',
        favoriteSupport: 1,
        active: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ];

    vi.doMock('../../../src/main/services/config.js', () => ({
      getConfig: vi.fn(() => ({
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
      })),
      saveConfig: vi.fn(async () => ({ success: true })),
      toRendererSafeUiConfig,
    }));

    const allMock = vi.fn(async (_db: unknown, sql: string) => {
      if (sql === 'SELECT * FROM booru_sites') {
        return booruSitesRows;
      }
      return [];
    });

    vi.doMock('../../../src/main/services/database.js', () => ({
      getDatabase: vi.fn(async () => ({})),
      all: allMock,
      run: vi.fn(async () => undefined),
      runInTransaction: vi.fn(async (_db: unknown, callback: () => Promise<unknown>) => callback()),
    }));

    const { createAppBackupData } = await import('../../../src/main/services/backupService');
    const backup = await createAppBackupData();

    expect(backup.tables.booru_sites).toHaveLength(1);
    const exportedSite = backup.tables.booru_sites[0];
    expect(exportedSite).not.toHaveProperty('salt');
    expect(exportedSite).not.toHaveProperty('apiKey');
    expect(exportedSite).not.toHaveProperty('passwordHash');
    // 非敏感字段应保留，便于恢复站点元数据
    expect(exportedSite).toMatchObject({
      id: 1,
      name: 'Yande',
      url: 'https://yande.re',
      type: 'moebooru',
      username: 'alice',
      favoriteSupport: 1,
      active: 1,
    });
  });

  it('导入备份时若 booru_sites 行中仍残留 salt / apiKey / passwordHash，应丢弃这些字段，避免越界写回', async () => {
    const incomingRows = [
      {
        id: 5,
        name: 'Evil',
        url: 'https://evil.example',
        type: 'moebooru',
        salt: 'should-not-write',
        apiKey: 'should-not-write',
        username: 'eve',
        passwordHash: 'should-not-write',
        favoriteSupport: 1,
        active: 1,
      },
    ];

    const backupData: AppBackupData = {
      ...createBackupPayload(),
      tables: {
        ...createEmptyTables(),
        booru_sites: incomingRows,
      },
    };

    const saveConfigMock = vi.fn(async () => ({ success: true }));
    const runInTransactionMock = vi.fn(async (_db: unknown, callback: () => Promise<unknown>) => {
      await callback();
    });

    const runMock = vi.fn(async () => undefined);
    const allMock = vi.fn(async () => []);

    vi.doMock('../../../src/main/services/config.js', () => ({
      getConfig: vi.fn(() => ({})),
      saveConfig: saveConfigMock,
      toRendererSafeUiConfig,
    }));

    vi.doMock('../../../src/main/services/database.js', () => ({
      getDatabase: vi.fn(async () => ({})),
      all: allMock,
      run: runMock,
      runInTransaction: runInTransactionMock,
    }));

    const { restoreAppBackupData } = await import('../../../src/main/services/backupService');
    await restoreAppBackupData(backupData, { mode: 'replace' });

    const insertBooruSiteCall = runMock.mock.calls.find(([_, sql]) =>
      typeof sql === 'string' && sql.startsWith('INSERT OR REPLACE INTO booru_sites')
    );
    expect(insertBooruSiteCall).toBeTruthy();
    const insertSql = insertBooruSiteCall![1] as string;
    // 敏感列不应出现在实际写入 SQL 的列名中
    expect(insertSql).not.toMatch(/\bsalt\b/);
    expect(insertSql).not.toMatch(/\bapiKey\b/);
    expect(insertSql).not.toMatch(/\bpasswordHash\b/);
  });
});

describe('backup config sanitization', () => {
  const sourceConfig = {
    dataPath: 'data',
    database: { path: 'gallery.db', logging: true },
    downloads: { path: 'downloads', createSubfolders: true, subfolderFormat: ['tags'] },
    galleries: { folders: [] },
    thumbnails: { cachePath: 'thumbnails', maxWidth: 800, maxHeight: 800, quality: 92, format: 'webp' },
    app: { recentImagesCount: 100, pageSize: 50, defaultViewMode: 'grid', showImageInfo: true, autoScan: true, autoScanInterval: 30 },
    yande: { apiUrl: 'https://yande.re/post.json', pageSize: 20, downloadTimeout: 60, maxConcurrentDownloads: 5 },
    logging: { level: 'info', filePath: 'app.log', consoleOutput: true, maxFileSize: 10, maxFiles: 5 },
    network: {
      proxy: {
        enabled: true,
        protocol: 'http',
        host: '127.0.0.1',
        port: 7890,
        username: 'user',
        password: 'secret',
      },
    },
    google: {
      clientId: 'client-id',
      clientSecret: 'top-secret',
      drive: { enabled: true, defaultViewMode: 'grid', imageOnly: true, downloadPath: 'drive' },
      photos: { enabled: true, downloadPath: 'photos', uploadAlbumName: 'album', thumbnailSize: 256 },
    },
    booru: {
      appearance: { gridSize: 330, previewQuality: 'auto', itemsPerPage: 20, paginationPosition: 'bottom', pageMode: 'pagination', spacing: 16, borderRadius: 8, margin: 24 },
      download: { filenameTemplate: '{id}.{extension}', tokenDefaults: {} },
    },
    ui: {
      menuOrder: {
        main: ['gallery', 'booru', 'google'],
      },
      pinnedItems: [{ section: 'google', key: 'gdrive' }],
      pagePreferences: {
        favoriteTags: { keyword: 'keep-me' },
        appShell: {
          menuOrder: { booru: ['download', 'posts'] },
          pinnedItems: [{ section: 'booru', key: 'download', defaultTab: 'bulk' }],
        },
      },
    },
  } as any;

  it('导出备份时应移除敏感凭证字段，但保留可恢复的非敏感配置', () => {
    const result = createBackupSafeConfig(sourceConfig);

    expect(result.network.proxy).toEqual({
      enabled: true,
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
    });
    expect(result.google).toEqual({
      clientId: 'client-id',
      drive: sourceConfig.google.drive,
      photos: sourceConfig.google.photos,
    });
    expect(result.downloads).toEqual(sourceConfig.downloads);
    expect(result.network.proxy).not.toHaveProperty('username');
    expect(result.network.proxy).not.toHaveProperty('password');
    expect(result.google).not.toHaveProperty('clientSecret');
    expect(result.ui).toEqual({
      pagePreferences: {
        favoriteTags: { keyword: 'keep-me' },
      },
    });
    expect(result.ui).not.toHaveProperty('menuOrder');
    expect(result.ui).not.toHaveProperty('pinnedItems');
    expect(result.ui.pagePreferences).not.toHaveProperty('appShell');
  });

  it('导入备份时也应再次收口敏感凭证字段，避免备份内容越界写回', () => {
    const importedConfig = {
      ...createBackupSafeConfig(sourceConfig),
      network: {
        proxy: {
          enabled: true,
          protocol: 'http',
          host: '127.0.0.1',
          port: 7890,
          username: 'attacker',
          password: 'leak',
        },
      },
      google: {
        ...createBackupSafeConfig(sourceConfig).google!,
        clientSecret: 'should-not-pass-through',
      },
    } as any;

    const result = sanitizeImportedBackupConfig(importedConfig);

    expect(result.network?.proxy).toEqual({
      enabled: true,
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
    });
    expect(result.network?.proxy).not.toHaveProperty('username');
    expect(result.network?.proxy).not.toHaveProperty('password');
    expect(result.google).not.toHaveProperty('clientSecret');
  });

  it('导入安全备份时应保留当前已有敏感值，同时应用非敏感配置变更', () => {
    const currentConfig: AppConfig = {
      ...sourceConfig,
      network: {
        proxy: {
          enabled: true,
          protocol: 'http',
          host: '127.0.0.1',
          port: 7890,
          username: 'kept-user',
          password: 'kept-pass',
        },
      },
      google: {
        ...sourceConfig.google,
        clientSecret: 'kept-secret',
      },
    };

    const importedSafeConfig = sanitizeImportedBackupConfig({
      ...createBackupSafeConfig(sourceConfig),
      downloads: {
        ...sourceConfig.downloads,
        path: 'D:/restored-downloads',
      },
      google: {
        ...createBackupSafeConfig(sourceConfig).google!,
        clientId: 'restored-client-id',
      },
    });

    const normalized = normalizeConfigSaveInput(currentConfig, importedSafeConfig);
    const merged = mergeSensitiveConfig(currentConfig, normalized);

    expect(merged.downloads.path).toBe('D:/restored-downloads');
    expect(merged.google?.clientId).toBe('restored-client-id');
    expect(merged.network.proxy.username).toBe('kept-user');
    expect(merged.network.proxy.password).toBe('kept-pass');
    expect(merged.google?.clientSecret).toBe('kept-secret');
  });
});
