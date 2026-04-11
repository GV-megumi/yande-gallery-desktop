import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs/promises';

const state = {
  favoriteTags: [
    { id: 1, siteId: 1, tagName: 'tag_a', labels: '[]', queryType: 'tag', notes: null, sortOrder: 1, createdAt: '2024-01-01', updatedAt: '2024-01-01' },
    { id: 2, siteId: 1, tagName: 'tag_b', labels: '[]', queryType: 'tag', notes: null, sortOrder: 2, createdAt: '2024-01-01', updatedAt: '2024-01-01' },
  ] as Array<{ id: number; siteId: number | null; tagName: string; labels: string; queryType: string; notes: null; sortOrder: number; createdAt: string; updatedAt: string }>,
  blacklistedTags: [
    { id: 1, siteId: 1, tagName: 'aotsu_karin', reason: null, isActive: 1, createdAt: '2026-04-01' },
    { id: 2, siteId: 1, tagName: 'muku_apupop', reason: null, isActive: 1, createdAt: '2026-04-01' },
    { id: 3, siteId: null, tagName: 'kawaii_chibi', reason: null, isActive: 1, createdAt: '2026-04-01' },
    { id: 4, siteId: 2, tagName: 'another_site', reason: null, isActive: 1, createdAt: '2026-04-01' },
  ] as Array<{ id: number; siteId: number | null; tagName: string; reason: null; isActive: number; createdAt: string }>,
  bindings: [
    {
      id: 1,
      favoriteTagId: 1,
      galleryId: 10,
      downloadPath: 'D:/gallery/a',
      enabled: 1,
      autoCreateGallery: 0,
      autoSyncGalleryAfterDownload: 0,
      quality: 'original',
      perPage: 20,
      concurrency: 3,
      skipIfExists: 1,
      notifications: 1,
      blacklistedTags: '[]',
      lastTaskId: 'task-1',
      lastSessionId: 'session-1',
      lastStartedAt: '2024-01-02',
      lastCompletedAt: '2024-01-03',
      lastStatus: 'completed',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-03',
      galleryName: 'Gallery A',
    },
  ],
  galleries: [
    { id: 10, name: 'Gallery A', folderPath: 'D:/gallery/a' },
  ],
  sessions: [
    { id: 'session-1', taskId: 'task-1', status: 'completed', startedAt: '2024-01-02', completedAt: '2024-01-03', error: null, originType: 'favoriteTag', originId: 1, deletedAt: null },
  ],
};

/**
 * 模拟 booru_blacklisted_tags 的 WHERE/LIMIT/OFFSET 行为，
 * 使测试 mock 与 booruService.getBlacklistedTags 的真实 SQL 语义保持一致。
 * 根据 sql 中是否包含 siteId / LIKE 子句以及 params 的数量依次消费参数。
 */
function filterBlacklistedByParams(sql: string, params: any[] = []) {
  let rows = state.blacklistedTags.slice();
  let p = 0;

  if (sql.includes('siteId IS NULL') && !sql.includes('siteId = ?')) {
    rows = rows.filter(r => r.siteId === null);
  } else if (sql.includes('(siteId = ? OR siteId IS NULL)')) {
    const sid = params[p++];
    rows = rows.filter(r => r.siteId === sid || r.siteId === null);
  }

  if (sql.includes('tagName LIKE ?')) {
    const raw = String(params[p++] ?? '');
    const needle = raw.replace(/^%|%$/g, '').toLowerCase();
    rows = rows.filter(r => r.tagName.toLowerCase().includes(needle));
  }

  return { rows, nextParamIndex: p };
}

/**
 * 模拟 booru_favorite_tags 的 WHERE/LIMIT/OFFSET 行为，
 * 使测试 mock 与 booruService.getFavoriteTags 的真实 SQL 语义保持一致。
 */
function filterFavoriteTagsByParams(sql: string, params: any[] = []) {
  let rows = state.favoriteTags.slice();
  let p = 0;

  if (sql.includes('siteId IS NULL') && !sql.includes('siteId = ?')) {
    rows = rows.filter(r => r.siteId === null);
  } else if (sql.includes('(siteId = ? OR siteId IS NULL)')) {
    const sid = params[p++];
    rows = rows.filter(r => r.siteId === sid || r.siteId === null);
  }

  if (sql.includes('tagName LIKE ?')) {
    const raw = String(params[p++] ?? '');
    const needle = raw.replace(/^%|%$/g, '').toLowerCase();
    rows = rows.filter(r => r.tagName.toLowerCase().includes(needle));
  }

  return { rows, nextParamIndex: p };
}

/**
 * 模拟 booru_favorite_tags 的 UPDATE 行为。
 * 从 `UPDATE booru_favorite_tags SET a = ?, b = ? WHERE id = ?` 这种语句里提取
 * SET 列表中列的顺序，依次把 params 映射到 state.favoriteTags 中匹配行上。
 */
function applyFavoriteTagsUpdate(sql: string, params: any[] = []): void {
  const setMatch = sql.match(/SET\s+(.+?)\s+WHERE\s+id\s*=\s*\?/i);
  if (!setMatch) return;
  const columns = setMatch[1]
    .split(',')
    .map(segment => segment.trim().split('=')[0].trim());
  const id = params[params.length - 1];
  const row = state.favoriteTags.find(tag => tag.id === id);
  if (!row) return;
  columns.forEach((column, index) => {
    const value = params[index];
    if (column === 'siteId') {
      (row as any).siteId = value;
    } else if (column === 'tagName') {
      (row as any).tagName = value;
    } else if (column === 'labels') {
      (row as any).labels = value;
    } else if (column === 'queryType') {
      (row as any).queryType = value;
    } else if (column === 'notes') {
      (row as any).notes = value;
    } else if (column === 'sortOrder') {
      (row as any).sortOrder = value;
    } else if (column === 'updatedAt') {
      (row as any).updatedAt = value;
    }
  });
}

let lastInsertedFavoriteTagId = 0;

vi.mock('../../../src/main/services/database', () => ({
  getDatabase: vi.fn(async () => ({})),
  run: vi.fn(async (_db, sql: string, params?: any[]) => {
    if (/^\s*UPDATE\s+booru_favorite_tags\b/i.test(sql)) {
      applyFavoriteTagsUpdate(sql, params ?? []);
    }
    if (/^\s*INSERT\s+INTO\s+booru_favorite_tags\b/i.test(sql)) {
      // 与 addFavoriteTag 的 INSERT 列顺序保持一致：
      // (siteId, tagName, labels, queryType, notes, sortOrder, createdAt, updatedAt)
      const p = params ?? [];
      const existingIds = state.favoriteTags.map(t => t.id);
      const nextId = (existingIds.length > 0 ? Math.max(...existingIds) : 0) + 1;
      lastInsertedFavoriteTagId = nextId;
      state.favoriteTags.push({
        id: nextId,
        siteId: p[0] ?? null,
        tagName: p[1],
        labels: p[2] ?? '[]',
        queryType: p[3] ?? 'tag',
        notes: p[4] ?? null,
        sortOrder: p[5] ?? 0,
        createdAt: p[6],
        updatedAt: p[7],
      });
    }
    return undefined;
  }),
  runWithChanges: vi.fn(async () => ({ changes: 1 })),
  runInTransaction: vi.fn(async (_db, fn) => fn()),
  get: vi.fn(async (_db, sql: string, params?: any[]) => {
    if (sql.includes('FROM booru_favorite_tags WHERE id = ?')) {
      return state.favoriteTags.find(tag => tag.id === params?.[0]);
    }
    if (sql.includes('FROM booru_favorite_tag_download_bindings b') && sql.includes('WHERE b.favoriteTagId = ?')) {
      return state.bindings.find(binding => binding.favoriteTagId === params?.[0]);
    }
    if (sql.includes('FROM galleries WHERE id = ?')) {
      return state.galleries.find(gallery => gallery.id === params?.[0]);
    }
    if (sql.includes('FROM bulk_download_sessions') && sql.includes('WHERE id = ?')) {
      return state.sessions.find(session => session.id === params?.[0]);
    }
    if (sql.includes('SUM(CASE WHEN r.status =')) {
      return { status: 'completed', completed: 1, failed: 0, total: 1, completedAt: '2024-01-03' };
    }
    if (sql.includes('COUNT(*)') && sql.includes('booru_blacklisted_tags')) {
      const { rows } = filterBlacklistedByParams(sql, params ?? []);
      return { cnt: rows.length };
    }
    // isFavoriteTag: SELECT COUNT(*) as count FROM booru_favorite_tags WHERE siteId IS ? AND tagName = ?
    if (
      sql.includes('COUNT(*)')
      && sql.includes('booru_favorite_tags')
      && sql.includes('siteId IS ?')
      && sql.includes('tagName = ?')
    ) {
      const sid = params?.[0] ?? null;
      const name = params?.[1];
      const count = state.favoriteTags.filter(t => t.siteId === sid && t.tagName === name).length;
      return { count };
    }
    if (sql.includes('COUNT(*)') && sql.includes('booru_favorite_tags')) {
      const { rows } = filterFavoriteTagsByParams(sql, params ?? []);
      return { cnt: rows.length };
    }
    // addFavoriteTag: SELECT COALESCE(MAX(sortOrder), 0) as maxSort FROM booru_favorite_tags WHERE siteId IS ?
    if (sql.includes('MAX(sortOrder)') && sql.includes('booru_favorite_tags')) {
      const sid = params?.[0] ?? null;
      const maxSort = state.favoriteTags
        .filter(t => t.siteId === sid)
        .reduce((m, t) => Math.max(m, t.sortOrder), 0);
      return { maxSort };
    }
    // addFavoriteTag: SELECT last_insert_rowid() as id
    if (sql.includes('last_insert_rowid()')) {
      return { id: lastInsertedFavoriteTagId };
    }
    return undefined;
  }),
  all: vi.fn(async (_db, sql: string, params?: any[]) => {
    if (sql.includes('FROM booru_favorite_tags') && !sql.includes('booru_favorite_tag_download_bindings')) {
      const list = params ?? [];
      const { rows, nextParamIndex } = filterFavoriteTagsByParams(sql, list);
      let limit = Number.POSITIVE_INFINITY;
      let offset = 0;
      if (sql.includes('LIMIT ?')) {
        limit = Number(list[nextParamIndex] ?? Number.POSITIVE_INFINITY);
      }
      if (sql.includes('OFFSET ?')) {
        offset = Number(list[nextParamIndex + 1] ?? 0);
      }
      return rows.slice(offset, offset + limit);
    }
    if (sql.includes('FROM booru_favorite_tag_download_bindings b')) {
      return state.bindings;
    }
    if (sql.includes('FROM galleries') && sql.includes('WHERE id IN')) {
      return state.galleries;
    }
    if (sql.includes('FROM bulk_download_sessions') && sql.includes("originType = 'favoriteTag'")) {
      return state.sessions
        .filter(session => session.originId === params?.[0])
        .map(session => ({
          sessionId: session.id,
          taskId: session.taskId,
          status: session.status,
          startedAt: session.startedAt,
          completedAt: session.completedAt,
          error: session.error,
        }));
    }
    if (sql.includes('FROM booru_blacklisted_tags')) {
      const list = params ?? [];
      const { rows, nextParamIndex } = filterBlacklistedByParams(sql, list);
      // LIMIT ? OFFSET ? 会在 params 末尾追加两个值
      let limit = Number.POSITIVE_INFINITY;
      let offset = 0;
      if (sql.includes('LIMIT ?')) {
        limit = Number(list[nextParamIndex] ?? Number.POSITIVE_INFINITY);
      }
      if (sql.includes('OFFSET ?')) {
        offset = Number(list[nextParamIndex + 1] ?? 0);
      }
      return rows.slice(offset, offset + limit);
    }
    return [];
  }),
}));

vi.mock('../../../src/main/services/galleryService', () => ({
  createGallery: vi.fn(async () => ({ success: true, data: 10 })),
  getGallery: vi.fn(async () => ({ success: true, data: { id: 10, imageCount: 1 } })),
  updateGalleryStats: vi.fn(async () => ({ success: true })),
}));

vi.mock('../../../src/main/services/imageService', () => ({
  scanAndImportFolder: vi.fn(async () => ({ success: true, data: { imported: 1, skipped: 0 } })),
}));

vi.mock('../../../src/main/services/bulkDownloadService', () => ({
  createBulkDownloadTask: vi.fn(async () => ({ success: true, data: { id: 'task-1' } })),
  createBulkDownloadSession: vi.fn(async () => ({ success: true, data: { id: 'session-1' } })),
  startBulkDownloadSession: vi.fn(async () => ({ success: true })),
}));

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn(async () => undefined),
  },
}));

vi.mock('../../../src/main/services/config', () => ({
  getConfig: vi.fn(() => ({ downloads: { path: 'downloads' } })),
  resolveConfigPath: vi.fn((p: string) => `C:/config/${p}`),
}));

describe('booruService integration-ish behavior', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('getFavoriteTagsWithDownloadState 应返回带 binding 和 galleryName 的 enriched 结果', async () => {
    const service = await import('../../../src/main/services/booruService');
    const { items } = await service.getFavoriteTagsWithDownloadState({ siteId: 1, limit: 0 });

    expect(items.length).toBeGreaterThan(0);
    expect(items[0].downloadBinding?.favoriteTagId).toBe(1);
    expect(items[0].galleryName).toBe('Gallery A');
    expect(items[1].resolvedDownloadPath?.replace(/\\/g, '/')).toBe('C:/config/downloads/tag_b');
  });

  it('getFavoriteTagDownloadHistory 应返回 favoriteTag 来源会话', async () => {
    const service = await import('../../../src/main/services/booruService');
    const history = await service.getFavoriteTagDownloadHistory(1);

    expect(history).toHaveLength(1);
    expect(history[0].sessionId).toBe('session-1');
  });

  it('getGallerySourceFavoriteTags 应反查绑定到 gallery 的 favorite tags', async () => {
    const service = await import('../../../src/main/services/booruService');
    const tags = await service.getGallerySourceFavoriteTags(10);

    expect(tags).toHaveLength(1);
    expect(tags[0].tagName).toBe('tag_a');
  });

  it('startFavoriteTagBulkDownload 启动前应确保下载目录存在', async () => {
    const service = await import('../../../src/main/services/booruService');
    await service.startFavoriteTagBulkDownload(1);

    expect(fs.mkdir).toHaveBeenCalledWith('D:/gallery/a', { recursive: true });
  });
});

describe('getBlacklistedTags — 分页与搜索', () => {
  beforeEach(() => {
    vi.resetModules();
    state.blacklistedTags = [
      { id: 1, siteId: 1, tagName: 'aotsu_karin', reason: null, isActive: 1, createdAt: '2026-04-01' },
      { id: 2, siteId: 1, tagName: 'muku_apupop', reason: null, isActive: 1, createdAt: '2026-04-01' },
      { id: 3, siteId: null, tagName: 'kawaii_chibi', reason: null, isActive: 1, createdAt: '2026-04-01' },
      { id: 4, siteId: 2, tagName: 'another_site', reason: null, isActive: 1, createdAt: '2026-04-01' },
    ];
  });

  it('默认参数返回所有行和 total', async () => {
    const { getBlacklistedTags } = await import('../../../src/main/services/booruService');
    const res = await getBlacklistedTags({});
    expect(res.total).toBe(4);
    expect(res.items.length).toBe(4);
  });

  it('keyword 模糊匹配且大小写不敏感', async () => {
    const { getBlacklistedTags } = await import('../../../src/main/services/booruService');
    const res = await getBlacklistedTags({ keyword: 'MUKU' });
    expect(res.total).toBe(1);
    expect(res.items[0].tagName).toBe('muku_apupop');
  });

  it('siteId=1 过滤只返回该站点及全局行', async () => {
    const { getBlacklistedTags } = await import('../../../src/main/services/booruService');
    const res = await getBlacklistedTags({ siteId: 1 });
    const names = res.items.map(t => t.tagName).sort();
    expect(names).toEqual(['aotsu_karin', 'kawaii_chibi', 'muku_apupop']);
    expect(res.total).toBe(3);
  });

  it('offset 和 limit 正确分页 total 不受影响', async () => {
    const { getBlacklistedTags } = await import('../../../src/main/services/booruService');
    const res = await getBlacklistedTags({ offset: 1, limit: 2 });
    expect(res.total).toBe(4);
    expect(res.items.length).toBe(2);
  });

  it('keyword + siteId 组合过滤', async () => {
    const { getBlacklistedTags } = await import('../../../src/main/services/booruService');
    const res = await getBlacklistedTags({ siteId: 1, keyword: 'karin' });
    expect(res.total).toBe(1);
    expect(res.items[0].tagName).toBe('aotsu_karin');
  });
});

describe('getFavoriteTags — 分页与搜索', () => {
  beforeEach(() => {
    vi.resetModules();
    state.favoriteTags = [
      { id: 1, siteId: 1, tagName: 'aoi_chizuru', labels: '[]', queryType: 'tag', notes: null, sortOrder: 1, createdAt: '2026-04-01', updatedAt: '2026-04-01' },
      { id: 2, siteId: 1, tagName: 'gin', labels: '[]', queryType: 'tag', notes: null, sortOrder: 2, createdAt: '2026-04-01', updatedAt: '2026-04-01' },
      { id: 3, siteId: null, tagName: 'hatsune_miku', labels: '[]', queryType: 'tag', notes: null, sortOrder: 3, createdAt: '2026-04-01', updatedAt: '2026-04-01' },
      { id: 4, siteId: 2, tagName: 'eryuhe', labels: '[]', queryType: 'tag', notes: null, sortOrder: 4, createdAt: '2026-04-01', updatedAt: '2026-04-01' },
    ];
  });

  it('默认参数返回所有行和 total', async () => {
    const { getFavoriteTags } = await import('../../../src/main/services/booruService');
    const res = await getFavoriteTags({});
    expect(res.total).toBe(4);
    expect(res.items.length).toBe(4);
  });

  it('keyword 搜索大小写不敏感', async () => {
    const { getFavoriteTags } = await import('../../../src/main/services/booruService');
    const res = await getFavoriteTags({ keyword: 'AOI' });
    expect(res.total).toBe(1);
    expect(res.items[0].tagName).toBe('aoi_chizuru');
  });

  it('siteId=1 含全局', async () => {
    const { getFavoriteTags } = await import('../../../src/main/services/booruService');
    const res = await getFavoriteTags({ siteId: 1 });
    expect(res.total).toBe(3);
  });

  it('siteId=null 只含全局', async () => {
    const { getFavoriteTags } = await import('../../../src/main/services/booruService');
    const res = await getFavoriteTags({ siteId: null });
    expect(res.total).toBe(1);
    expect(res.items[0].tagName).toBe('hatsune_miku');
  });

  it('分页切片正确', async () => {
    const { getFavoriteTags } = await import('../../../src/main/services/booruService');
    const res = await getFavoriteTags({ offset: 1, limit: 2 });
    expect(res.total).toBe(4);
    expect(res.items.length).toBe(2);
  });
});

describe('getFavoriteTagsWithDownloadState — 分页与搜索透传', () => {
  beforeEach(() => {
    vi.resetModules();
    state.favoriteTags = [
      { id: 1, siteId: 1, tagName: 'aoi_chizuru', labels: '[]', queryType: 'tag', notes: null, sortOrder: 1, createdAt: '2026-04-01', updatedAt: '2026-04-01' },
      { id: 2, siteId: 1, tagName: 'gin', labels: '[]', queryType: 'tag', notes: null, sortOrder: 2, createdAt: '2026-04-01', updatedAt: '2026-04-01' },
    ];
    state.bindings = [];
  });

  it('返回 PaginatedResult 结构', async () => {
    const { getFavoriteTagsWithDownloadState } = await import('../../../src/main/services/booruService');
    const res = await getFavoriteTagsWithDownloadState({});
    expect(res).toHaveProperty('items');
    expect(res).toHaveProperty('total');
    expect(Array.isArray(res.items)).toBe(true);
    expect(res.total).toBe(2);
  });

  it('keyword 过滤', async () => {
    const { getFavoriteTagsWithDownloadState } = await import('../../../src/main/services/booruService');
    const res = await getFavoriteTagsWithDownloadState({ keyword: 'aoi' });
    expect(res.total).toBe(1);
    expect(res.items[0].tagName).toBe('aoi_chizuru');
  });

  it('分页不影响 binding 富化', async () => {
    state.bindings = [
      { id: 1, favoriteTagId: 1, galleryId: null, downloadPath: '', enabled: 1, lastStatus: 'idle' } as any,
    ];
    const { getFavoriteTagsWithDownloadState } = await import('../../../src/main/services/booruService');
    const res = await getFavoriteTagsWithDownloadState({ limit: 1, offset: 0 });
    expect(res.items.length).toBe(1);
    expect(res.items[0].id).toBe(1);
    expect(res.items[0].downloadBinding).toBeDefined();
  });
});

describe('updateFavoriteTag — siteId 修改规则', () => {
  beforeEach(() => {
    vi.resetModules();
    state.favoriteTags = [
      { id: 1, siteId: null, tagName: 'global_tag', labels: '[]', queryType: 'tag', notes: null, sortOrder: 1, createdAt: '2026-04-01', updatedAt: '2026-04-01' },
      { id: 2, siteId: 1, tagName: 'site1_tag', labels: '[]', queryType: 'tag', notes: null, sortOrder: 2, createdAt: '2026-04-01', updatedAt: '2026-04-01' },
    ];
  });

  it('global (siteId=null) 可以升级到具体站点', async () => {
    const { updateFavoriteTag } = await import('../../../src/main/services/booruService');
    await expect(updateFavoriteTag(1, { siteId: 1 })).resolves.not.toThrow();
    expect(state.favoriteTags.find(t => t.id === 1)!.siteId).toBe(1);
  });

  it('已绑定站点的不可改到另一个站点', async () => {
    const { updateFavoriteTag } = await import('../../../src/main/services/booruService');
    await expect(updateFavoriteTag(2, { siteId: 3 })).rejects.toThrow(/不允许修改站点/);
  });

  it('已绑定站点的不可改回 global', async () => {
    const { updateFavoriteTag } = await import('../../../src/main/services/booruService');
    await expect(updateFavoriteTag(2, { siteId: null })).rejects.toThrow(/不允许修改站点/);
  });

  it('updates 不含 siteId 时走原路径 (仅改 notes)', async () => {
    const { updateFavoriteTag } = await import('../../../src/main/services/booruService');
    await expect(updateFavoriteTag(2, { notes: 'hello' } as any)).resolves.not.toThrow();
    expect(state.favoriteTags.find(t => t.id === 2)!.notes).toBe('hello' as any);
    expect(state.favoriteTags.find(t => t.id === 2)!.siteId).toBe(1);
  });

  it('global → global 是 no-op 成功', async () => {
    const { updateFavoriteTag } = await import('../../../src/main/services/booruService');
    await expect(updateFavoriteTag(1, { siteId: null })).resolves.not.toThrow();
  });
});

describe('addFavoriteTagsBatch', () => {
  beforeEach(() => {
    vi.resetModules();
    lastInsertedFavoriteTagId = 0;
    state.favoriteTags = [
      { id: 1, siteId: 1, tagName: 'existing_tag', labels: '[]', queryType: 'tag', notes: null, sortOrder: 1, createdAt: '2026-04-01', updatedAt: '2026-04-01' },
    ];
  });

  it('换行分隔的输入', async () => {
    const { addFavoriteTagsBatch } = await import('../../../src/main/services/booruService');
    const res = await addFavoriteTagsBatch('new_a\nnew_b\nnew_c', 1);
    expect(res).toEqual({ added: 3, skipped: 0 });
  });

  it('换行 + 逗号混合', async () => {
    const { addFavoriteTagsBatch } = await import('../../../src/main/services/booruService');
    const res = await addFavoriteTagsBatch('a, b\nc,d', 1);
    expect(res.added).toBe(4);
  });

  it('已存在跳过', async () => {
    const { addFavoriteTagsBatch } = await import('../../../src/main/services/booruService');
    const res = await addFavoriteTagsBatch('existing_tag\nnew_tag', 1);
    expect(res).toEqual({ added: 1, skipped: 1 });
  });

  it('输入内部重复只计一次', async () => {
    const { addFavoriteTagsBatch } = await import('../../../src/main/services/booruService');
    const res = await addFavoriteTagsBatch('new_x\nnew_x\nnew_y', 1);
    expect(res.added).toBe(2);
  });

  it('空输入 added=0', async () => {
    const { addFavoriteTagsBatch } = await import('../../../src/main/services/booruService');
    const res = await addFavoriteTagsBatch('   \n,  ,', 1);
    expect(res).toEqual({ added: 0, skipped: 0 });
  });

  it('siteId=null 添加为全局', async () => {
    const { addFavoriteTagsBatch } = await import('../../../src/main/services/booruService');
    await addFavoriteTagsBatch('global_tag', null);
    const added = state.favoriteTags.find(t => t.tagName === 'global_tag');
    expect(added).toBeDefined();
    expect(added!.siteId).toBeNull();
  });

  it('labels 字符串按逗号拆分传到每条记录', async () => {
    const { addFavoriteTagsBatch } = await import('../../../src/main/services/booruService');
    await addFavoriteTagsBatch('a\nb', 1, '角色, 风格');
    const a = state.favoriteTags.find(t => t.tagName === 'a');
    expect(JSON.parse(a!.labels as any)).toEqual(['角色', '风格']);
  });
});
