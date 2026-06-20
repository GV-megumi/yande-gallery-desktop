import { beforeEach, describe, it, expect, vi } from 'vitest';

const db = {};
const getMock = vi.fn();
const allMock = vi.fn();

const favoriteState = {
  posts: [] as Array<Record<string, any>>,
  favorites: [] as Array<{ id: number; postId: number; siteId: number; groupId: number | null; createdAt: string }>,
};

function selectFavoriteRows(sql: string, params: any[] = []) {
  let paramIndex = 0;
  const siteId = params[paramIndex++];
  let rows = favoriteState.favorites
    .filter(favorite => favorite.siteId === siteId)
    .map(favorite => {
      const post = favoriteState.posts.find(item => item.id === favorite.postId);
      return post ? { ...post, favoriteGroupId: favorite.groupId, favoriteCreatedAt: favorite.createdAt } : null;
    })
    .filter((row): row is Record<string, any> => row !== null);

  if (sql.includes('f.groupId IS NULL')) {
    rows = rows.filter(row => row.favoriteGroupId == null);
  } else if (sql.includes('f.groupId = ?')) {
    const groupId = params[paramIndex++];
    rows = rows.filter(row => row.favoriteGroupId === groupId);
  }

  if (sql.includes('p.rating = ?')) {
    const rating = params[paramIndex++];
    rows = rows.filter(row => row.rating === rating);
  }

  return { rows: rows.sort((a, b) => String(b.favoriteCreatedAt).localeCompare(String(a.favoriteCreatedAt))), nextParamIndex: paramIndex };
}

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
  },
}));

vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(async () => db),
  get: (...args: any[]) => getMock(...args),
  all: (...args: any[]) => allMock(...args),
  run: vi.fn(),
  runWithChanges: vi.fn(),
  runInTransaction: async (_db: any, fn: () => Promise<any>) => fn(),
}));

vi.mock('../../../src/main/services/galleryService.js', () => ({
  createGallery: vi.fn(),
  getGallery: vi.fn(),
  updateGalleryStats: vi.fn(),
}));

vi.mock('../../../src/main/services/imageService.js', () => ({
  scanAndImportFolder: vi.fn(),
}));

vi.mock('../../../src/main/services/config.js', () => ({
  getConfig: vi.fn(() => ({ downloads: { path: 'D:/downloads' } })),
  getDownloadsPath: vi.fn(() => 'D:/downloads'),
  resolveConfigPath: (value: string) => value,
}));

vi.mock('../../../src/main/services/appEventPublisher.js', () => ({
  emitBooruBlacklistTagsChanged: vi.fn(),
  emitBooruFavoriteGroupsChanged: vi.fn(),
  emitBooruPostDownloadStateChanged: vi.fn(),
  emitBooruPostFavoriteChanged: vi.fn(),
  emitBooruPostServerFavoriteChanged: vi.fn(),
  emitBooruPostVoteChanged: vi.fn(),
  emitBooruSavedSearchesChanged: vi.fn(),
  emitBooruSearchHistoryChanged: vi.fn(),
  emitBooruSitesChanged: vi.fn(),
}));

beforeEach(() => {
  favoriteState.posts = [
    {
      id: 1,
      siteId: 1,
      postId: 101,
      fileUrl: 'https://mock/101.jpg',
      previewUrl: 'https://mock/101-preview.jpg',
      tags: 'safe_tag',
      rating: 'safe',
      downloaded: 0,
      isFavorited: 1,
      isLiked: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 2,
      siteId: 1,
      postId: 102,
      fileUrl: 'https://mock/102.jpg',
      previewUrl: 'https://mock/102-preview.jpg',
      tags: 'explicit_tag',
      rating: 'explicit',
      downloaded: 1,
      isFavorited: 1,
      isLiked: 0,
      createdAt: '2026-01-02',
      updatedAt: '2026-01-02',
    },
    {
      id: 3,
      siteId: 2,
      postId: 201,
      fileUrl: 'https://mock/201.jpg',
      previewUrl: 'https://mock/201-preview.jpg',
      tags: 'other_site',
      rating: 'safe',
      downloaded: 0,
      isFavorited: 1,
      isLiked: 0,
      createdAt: '2026-01-03',
      updatedAt: '2026-01-03',
    },
  ];
  favoriteState.favorites = [
    { id: 1, postId: 1, siteId: 1, groupId: null, createdAt: '2026-02-01' },
    { id: 2, postId: 2, siteId: 1, groupId: 7, createdAt: '2026-02-02' },
    { id: 3, postId: 3, siteId: 2, groupId: null, createdAt: '2026-02-03' },
  ];

  getMock.mockReset();
  getMock.mockImplementation(async (_db, sql: string, params?: any[]) => {
    if (sql.includes('COUNT(*)') && sql.includes('FROM booru_posts p') && sql.includes('booru_favorites f')) {
      const { rows } = selectFavoriteRows(sql, params ?? []);
      return { total: rows.length, count: rows.length, cnt: rows.length };
    }
    return undefined;
  });

  allMock.mockReset();
  allMock.mockImplementation(async (_db, sql: string, params?: any[]) => {
    if (sql.includes('FROM booru_posts p') && sql.includes('booru_favorites f')) {
      const list = params ?? [];
      const { rows, nextParamIndex } = selectFavoriteRows(sql, list);
      const limit = Number(list[nextParamIndex] ?? Number.POSITIVE_INFINITY);
      const offset = Number(list[nextParamIndex + 1] ?? 0);
      return rows.slice(offset, offset + limit);
    }
    return [];
  });
});

/**
 * booruService 纯逻辑测试
 * 由于 booruService 依赖数据库连接，
 * 这里测试其核心数据转换和验证逻辑
 */

describe('booruService - 布尔值转换', () => {
  // SQLite 返回 0/1，需要转换为 boolean
  function convertSiteBooleans(site: Record<string, any>) {
    return {
      ...site,
      favoriteSupport: Boolean(site.favoriteSupport),
      active: Boolean(site.active),
    };
  }

  it('SQLite 1 应转换为 true', () => {
    const site = { name: 'Test', favoriteSupport: 1, active: 1 };
    const result = convertSiteBooleans(site);
    expect(result.favoriteSupport).toBe(true);
    expect(result.active).toBe(true);
  });

  it('SQLite 0 应转换为 false', () => {
    const site = { name: 'Test', favoriteSupport: 0, active: 0 };
    const result = convertSiteBooleans(site);
    expect(result.favoriteSupport).toBe(false);
    expect(result.active).toBe(false);
  });

  it('null/undefined 应转换为 false', () => {
    const site = { name: 'Test', favoriteSupport: null, active: undefined };
    const result = convertSiteBooleans(site);
    expect(result.favoriteSupport).toBe(false);
    expect(result.active).toBe(false);
  });

  it('已是 boolean 的值应保持不变', () => {
    const site = { name: 'Test', favoriteSupport: true, active: false };
    const result = convertSiteBooleans(site);
    expect(result.favoriteSupport).toBe(true);
    expect(result.active).toBe(false);
  });
});

describe('booruService - 收藏分页统计', () => {
  it('getFavorites 应返回当前过滤条件下的 total 和当前页 items', async () => {
    const service = await import('../../../src/main/services/booruService.js');

    const firstPage = await service.getFavorites(1, 1, 1);
    expect(firstPage.total).toBe(2);
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0]).toMatchObject({
      postId: 102,
      favoriteGroupId: 7,
      downloaded: true,
      isFavorited: true,
      isLiked: false,
    });

    const safeOnly = await (service.getFavorites as any)(1, 1, 10, undefined, 'safe');
    expect(safeOnly.total).toBe(1);
    expect(safeOnly.items.map((post: any) => post.postId)).toEqual([101]);
  });
});

describe('booruService - 标签解析', () => {
  // Booru post 的 tags 是空格分隔的字符串
  function parseTags(tagString: string): string[] {
    if (!tagString || tagString.trim() === '') return [];
    return tagString.trim().split(/\s+/);
  }

  it('应正确解析空格分隔的标签', () => {
    expect(parseTags('girl blue_eyes long_hair')).toEqual(['girl', 'blue_eyes', 'long_hair']);
  });

  it('空字符串应返回空数组', () => {
    expect(parseTags('')).toEqual([]);
  });

  it('只有空格的字符串应返回空数组', () => {
    expect(parseTags('   ')).toEqual([]);
  });

  it('多余空格应被忽略', () => {
    expect(parseTags('  girl   blue_eyes  ')).toEqual(['girl', 'blue_eyes']);
  });

  it('单个标签应返回单元素数组', () => {
    expect(parseTags('solo')).toEqual(['solo']);
  });

  it('应处理大量标签', () => {
    const tags = Array.from({ length: 100 }, (_, i) => `tag_${i}`).join(' ');
    expect(parseTags(tags)).toHaveLength(100);
  });
});

describe('booruService - 下载队列优先级', () => {
  interface MockDownload {
    id: number;
    priority: number;
    createdAt: string;
  }

  // 按优先级排序（数字越大优先级越高），相同优先级按创建时间排序
  function sortByPriority(items: MockDownload[]): MockDownload[] {
    return [...items].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }

  it('应按优先级降序排列', () => {
    const items = [
      { id: 1, priority: 1, createdAt: '2024-01-01' },
      { id: 2, priority: 3, createdAt: '2024-01-01' },
      { id: 3, priority: 2, createdAt: '2024-01-01' },
    ];
    const sorted = sortByPriority(items);
    expect(sorted[0].id).toBe(2);
    expect(sorted[1].id).toBe(3);
    expect(sorted[2].id).toBe(1);
  });

  it('相同优先级应按创建时间排序（先创建先下载）', () => {
    const items = [
      { id: 1, priority: 0, createdAt: '2024-01-03' },
      { id: 2, priority: 0, createdAt: '2024-01-01' },
      { id: 3, priority: 0, createdAt: '2024-01-02' },
    ];
    const sorted = sortByPriority(items);
    expect(sorted[0].id).toBe(2);
    expect(sorted[1].id).toBe(3);
    expect(sorted[2].id).toBe(1);
  });
});

describe('booruService - MD5 去重检查', () => {
  function isDuplicate(md5: string, existingMd5Set: Set<string>): boolean {
    if (!md5) return false; // 没有 MD5 无法判断
    return existingMd5Set.has(md5);
  }

  it('已存在的 MD5 应判断为重复', () => {
    const existing = new Set(['abc123', 'def456']);
    expect(isDuplicate('abc123', existing)).toBe(true);
  });

  it('不存在的 MD5 不应判断为重复', () => {
    const existing = new Set(['abc123']);
    expect(isDuplicate('xyz789', existing)).toBe(false);
  });

  it('MD5 为空时不应判断为重复', () => {
    const existing = new Set(['abc123']);
    expect(isDuplicate('', existing)).toBe(false);
  });

  it('空集合不应有重复', () => {
    expect(isDuplicate('abc123', new Set())).toBe(false);
  });
});

describe('booruService - 搜索历史去重', () => {
  interface SearchHistory {
    query: string;
    createdAt: string;
  }

  // 去重逻辑：相同查询词只保留最新的
  function deduplicateHistory(history: SearchHistory[]): SearchHistory[] {
    const map = new Map<string, SearchHistory>();
    for (const item of history) {
      const existing = map.get(item.query);
      if (!existing || new Date(item.createdAt) > new Date(existing.createdAt)) {
        map.set(item.query, item);
      }
    }
    return Array.from(map.values());
  }

  it('相同查询词应只保留最新的', () => {
    const history = [
      { query: 'blue_eyes', createdAt: '2024-01-01' },
      { query: 'blue_eyes', createdAt: '2024-01-05' },
      { query: 'red_hair', createdAt: '2024-01-03' },
    ];
    const result = deduplicateHistory(history);
    expect(result).toHaveLength(2);
    const blueEyes = result.find(h => h.query === 'blue_eyes');
    expect(blueEyes?.createdAt).toBe('2024-01-05');
  });

  it('空历史应返回空数组', () => {
    expect(deduplicateHistory([])).toEqual([]);
  });

  it('无重复时应全部保留', () => {
    const history = [
      { query: 'a', createdAt: '2024-01-01' },
      { query: 'b', createdAt: '2024-01-02' },
    ];
    expect(deduplicateHistory(history)).toHaveLength(2);
  });
});

describe('booruService - 收藏标签 labels JSON 解析', () => {
  function parseLabels(labelsJson: string | null | undefined): string[] {
    if (!labelsJson) return [];
    try {
      const parsed = JSON.parse(labelsJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  it('应正确解析 JSON 数组', () => {
    expect(parseLabels('["group1","group2"]')).toEqual(['group1', 'group2']);
  });

  it('null 应返回空数组', () => {
    expect(parseLabels(null)).toEqual([]);
  });

  it('undefined 应返回空数组', () => {
    expect(parseLabels(undefined)).toEqual([]);
  });

  it('空字符串应返回空数组', () => {
    expect(parseLabels('')).toEqual([]);
  });

  it('非法 JSON 应返回空数组', () => {
    expect(parseLabels('not json')).toEqual([]);
  });

  it('JSON 对象而非数组应返回空数组', () => {
    expect(parseLabels('{"key":"value"}')).toEqual([]);
  });

  it('空 JSON 数组应返回空数组', () => {
    expect(parseLabels('[]')).toEqual([]);
  });
});

describe('booruService - 收藏标签下载规则', () => {
  function canStartFavoriteTagDownload(tag: { queryType: string; siteId: number | null }): { ok: boolean; reason?: string } {
    if (tag.queryType !== 'tag') {
      return { ok: false, reason: 'queryType' };
    }
    if (tag.siteId == null) {
      return { ok: false, reason: 'siteId' };
    }
    return { ok: true };
  }

  it('queryType=tag 且 siteId 有值时允许启动', () => {
    expect(canStartFavoriteTagDownload({ queryType: 'tag', siteId: 1 })).toEqual({ ok: true });
  });

  it('queryType=raw 时禁止启动', () => {
    expect(canStartFavoriteTagDownload({ queryType: 'raw', siteId: 1 })).toEqual({ ok: false, reason: 'queryType' });
  });

  it('queryType=list 时禁止启动', () => {
    expect(canStartFavoriteTagDownload({ queryType: 'list', siteId: 1 })).toEqual({ ok: false, reason: 'queryType' });
  });

  it('siteId 为 null 时禁止启动', () => {
    expect(canStartFavoriteTagDownload({ queryType: 'tag', siteId: null })).toEqual({ ok: false, reason: 'siteId' });
  });
});

describe('booruService - 自动图集绑定策略', () => {
  function resolveGalleryStrategy(binding: { galleryId?: number | null; autoCreateGallery?: boolean | null }) {
    if (binding.galleryId) {
      return 'use-existing-gallery';
    }
    if (binding.autoCreateGallery) {
      return 'auto-create-gallery';
    }
    return 'no-gallery-binding';
  }

  it('已有 galleryId 时应直接使用现有图集', () => {
    expect(resolveGalleryStrategy({ galleryId: 5, autoCreateGallery: true })).toBe('use-existing-gallery');
  });

  it('无 galleryId 且 autoCreateGallery=true 时应自动创建图集', () => {
    expect(resolveGalleryStrategy({ galleryId: null, autoCreateGallery: true })).toBe('auto-create-gallery');
  });

  it('无 galleryId 且未启用 autoCreateGallery 时不自动绑定图集', () => {
    expect(resolveGalleryStrategy({ galleryId: null, autoCreateGallery: false })).toBe('no-gallery-binding');
  });
});

describe('booruService - favorite tag 历史追踪规则', () => {
  function toHistorySession(session: { id: string; taskId: string; status: string; originType?: string; originId?: number }) {
    return session.originType === 'favoriteTag' && typeof session.originId === 'number'
      ? { tracked: true, favoriteTagId: session.originId, sessionId: session.id, taskId: session.taskId, status: session.status }
      : { tracked: false };
  }

  it('favoriteTag 来源会话应被识别为可追踪历史', () => {
    expect(toHistorySession({ id: 's1', taskId: 't1', status: 'completed', originType: 'favoriteTag', originId: 12 })).toEqual({
      tracked: true,
      favoriteTagId: 12,
      sessionId: 's1',
      taskId: 't1',
      status: 'completed',
    });
  });

  it('无来源元数据的会话不应归入 favorite tag 历史', () => {
    expect(toHistorySession({ id: 's1', taskId: 't1', status: 'completed' })).toEqual({ tracked: false });
  });
});
