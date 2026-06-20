import { Readable } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBooruRoutes } from '../../../src/main/api/routes/booruRoutes.js';
import type { ApiRequestContext, ApiRoute } from '../../../src/main/api/types.js';
import { ApiHttpError } from '../../../src/main/api/types.js';
import {
  addFavoriteTag,
  addToFavorites,
  getActiveBooruSite,
  getBooruPostBySiteAndId,
  getBooruSites,
  getDownloadQueue,
  getDownloadQueueForDisplay,
  getFavoriteTagDownloadBinding,
  getFavoriteTagsWithDownloadState,
  getFavorites,
  deleteFavoriteTagDownloadBinding,
  removeFavoriteTag,
  removeFromFavorites,
  searchBooruPosts,
  setPostLiked,
  startFavoriteTagBulkDownload,
  updateFavoriteTag,
  upsertFavoriteTagDownloadBinding,
} from '../../../src/main/services/booruService.js';
import {
  cancelBulkDownloadSession,
  getActiveBulkDownloadSessions,
  getBulkDownloadTaskById,
  getBulkDownloadTasks,
  pauseBulkDownloadSession,
  startBulkDownloadSession,
} from '../../../src/main/services/bulkDownloadService.js';
import type {
  BooruSiteRecord,
  BooruPost,
  BulkDownloadSession,
  FavoriteTagDownloadBinding,
  FavoriteTagWithDownloadState,
} from '../../../src/shared/types.js';

vi.mock('../../../src/main/services/booruService.js', () => ({
  getBooruSites: vi.fn(),
  getActiveBooruSite: vi.fn(),
  searchBooruPosts: vi.fn(),
  getBooruPostBySiteAndId: vi.fn(),
  getFavorites: vi.fn(),
  addToFavorites: vi.fn(),
  removeFromFavorites: vi.fn(),
  setPostLiked: vi.fn(),
  getDownloadQueue: vi.fn(),
  getDownloadQueueForDisplay: vi.fn(),
  getFavoriteTagsWithDownloadState: vi.fn(),
  addFavoriteTag: vi.fn(),
  updateFavoriteTag: vi.fn(),
  removeFavoriteTag: vi.fn(),
  getFavoriteTagDownloadBinding: vi.fn(),
  upsertFavoriteTagDownloadBinding: vi.fn(),
  deleteFavoriteTagDownloadBinding: vi.fn(),
  startFavoriteTagBulkDownload: vi.fn(),
}));

vi.mock('../../../src/main/services/bulkDownloadService.js', () => ({
  getBulkDownloadTasks: vi.fn(),
  getBulkDownloadTaskById: vi.fn(),
  getActiveBulkDownloadSessions: vi.fn(),
  pauseBulkDownloadSession: vi.fn(),
  startBulkDownloadSession: vi.fn(),
  cancelBulkDownloadSession: vi.fn(),
}));

const mockGetBooruSites = vi.mocked(getBooruSites);
const mockGetActiveBooruSite = vi.mocked(getActiveBooruSite);
const mockSearchBooruPosts = vi.mocked(searchBooruPosts);
const mockGetBooruPostBySiteAndId = vi.mocked(getBooruPostBySiteAndId);
const mockGetFavorites = vi.mocked(getFavorites);
const mockAddToFavorites = vi.mocked(addToFavorites);
const mockRemoveFromFavorites = vi.mocked(removeFromFavorites);
const mockSetPostLiked = vi.mocked(setPostLiked);
const mockGetDownloadQueue = vi.mocked(getDownloadQueue);
const mockGetDownloadQueueForDisplay = vi.mocked(getDownloadQueueForDisplay);
const mockGetFavoriteTagsWithDownloadState = vi.mocked(getFavoriteTagsWithDownloadState);
const mockAddFavoriteTag = vi.mocked(addFavoriteTag);
const mockUpdateFavoriteTag = vi.mocked(updateFavoriteTag);
const mockRemoveFavoriteTag = vi.mocked(removeFavoriteTag);
const mockGetFavoriteTagDownloadBinding = vi.mocked(getFavoriteTagDownloadBinding);
const mockUpsertFavoriteTagDownloadBinding = vi.mocked(upsertFavoriteTagDownloadBinding);
const mockDeleteFavoriteTagDownloadBinding = vi.mocked(deleteFavoriteTagDownloadBinding);
const mockStartFavoriteTagBulkDownload = vi.mocked(startFavoriteTagBulkDownload);
const mockGetBulkDownloadTasks = vi.mocked(getBulkDownloadTasks);
const mockGetBulkDownloadTaskById = vi.mocked(getBulkDownloadTaskById);
const mockGetActiveBulkDownloadSessions = vi.mocked(getActiveBulkDownloadSessions);
const mockPauseBulkDownloadSession = vi.mocked(pauseBulkDownloadSession);
const mockStartBulkDownloadSession = vi.mocked(startBulkDownloadSession);
const mockCancelBulkDownloadSession = vi.mocked(cancelBulkDownloadSession);

function findRoute(routes: ApiRoute[], pattern: string, method = 'GET'): ApiRoute {
  const route = routes.find((candidate) => candidate.method === method && candidate.pattern === pattern);
  if (!route) {
    throw new Error(`Missing route: ${method} ${pattern}`);
  }

  return route;
}

function context(options: {
  params?: Record<string, string>;
  query?: URLSearchParams;
  body?: unknown;
} = {}): ApiRequestContext {
  const req = options.body === undefined
    ? Readable.from([])
    : Readable.from([JSON.stringify(options.body)]);

  return {
    req: req as ApiRequestContext['req'],
    res: { setHeader: vi.fn() } as unknown as ApiRequestContext['res'],
    method: 'GET',
    pathname: '/',
    query: options.query ?? new URLSearchParams(),
    params: options.params ?? {},
    sourceIp: '127.0.0.1',
    permissionKey: null,
  };
}

function post(overrides: Partial<BooruPost> = {}): BooruPost {
  return {
    id: 1,
    siteId: 2,
    postId: 3,
    fileUrl: 'https://example.test/file.jpg',
    tags: 'cat dog',
    downloaded: false,
    isFavorited: false,
    isLiked: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function favoriteTag(overrides: Partial<FavoriteTagWithDownloadState> = {}): FavoriteTagWithDownloadState {
  return {
    id: 5,
    siteId: null,
    tagName: 'cat',
    labels: [],
    queryType: 'tag',
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function binding(overrides: Partial<FavoriteTagDownloadBinding> = {}): FavoriteTagDownloadBinding {
  return {
    id: 2,
    favoriteTagId: 6,
    galleryId: null,
    downloadPath: 'M:/downloads',
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function session(overrides: Partial<BulkDownloadSession> = {}): BulkDownloadSession {
  return {
    id: 's1',
    taskId: 'task-1',
    siteId: 1,
    status: 'paused',
    startedAt: '2026-01-01T00:00:00.000Z',
    currentPage: 1,
    ...overrides,
  };
}

function booruSiteRecord(overrides: Partial<BooruSiteRecord> = {}): BooruSiteRecord {
  return {
    id: 1,
    name: 'Yande',
    url: 'https://yande.re',
    type: 'moebooru',
    username: 'alice',
    salt: 'secret-salt',
    apiKey: 'secret-api-key',
    passwordHash: 'secret-password-hash',
    favoriteSupport: true,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('booru API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes all booru, favorite tag, and download route patterns', () => {
    const routeKeys = createBooruRoutes().map((route) => `${route.method} ${route.pattern}`);

    expect(routeKeys).toEqual([
      'GET /api/v1/booru-sites',
      'GET /api/v1/booru-sites/active',
      'GET /api/v1/booru-posts/search',
      'GET /api/v1/booru-posts/:siteId/:postId',
      'GET /api/v1/booru-posts/:siteId/:postId/tags',
      'GET /api/v1/booru-posts/:siteId/:postId/favorite-info',
      'GET /api/v1/favorites',
      'POST /api/v1/favorites/:siteId/:postId',
      'DELETE /api/v1/favorites/:siteId/:postId',
      'POST /api/v1/favorites/:siteId/:postId/like',
      'DELETE /api/v1/favorites/:siteId/:postId/like',
      'GET /api/v1/favorite-tags',
      'POST /api/v1/favorite-tags',
      'PATCH /api/v1/favorite-tags/:id',
      'DELETE /api/v1/favorite-tags/:id',
      'GET /api/v1/favorite-tags/:id/binding',
      'PUT /api/v1/favorite-tags/:id/binding',
      'DELETE /api/v1/favorite-tags/:id/binding',
      'POST /api/v1/favorite-tags/:id/bulk-download',
      'GET /api/v1/downloads/queue',
      'GET /api/v1/downloads/tasks',
      'GET /api/v1/downloads/tasks/:taskId',
      'GET /api/v1/downloads/sessions',
      'GET /api/v1/downloads/sessions/:sessionId',
      'POST /api/v1/downloads/sessions/:sessionId/pause',
      'POST /api/v1/downloads/sessions/:sessionId/resume',
      'POST /api/v1/downloads/sessions/:sessionId/cancel',
    ]);
  });

  it('delegates booru site reads', async () => {
    mockGetBooruSites.mockResolvedValue([]);
    mockGetActiveBooruSite.mockResolvedValue(null);
    const routes = createBooruRoutes();

    await expect(findRoute(routes, '/api/v1/booru-sites').handler(context())).resolves.toEqual([]);
    await expect(findRoute(routes, '/api/v1/booru-sites/active').handler(context())).resolves.toBeNull();
  });

  it('returns safe booru site DTOs without stored credentials', async () => {
    mockGetBooruSites.mockResolvedValue([
      booruSiteRecord(),
      booruSiteRecord({
        id: 2,
        name: 'Danbooru',
        url: 'https://danbooru.donmai.us',
        type: 'danbooru',
        username: 'bob',
        passwordHash: '',
        favoriteSupport: false,
        active: false,
      }),
    ]);
    const route = findRoute(createBooruRoutes(), '/api/v1/booru-sites');

    const result = await route.handler(context());

    expect(result).toEqual([
      {
        id: 1,
        name: 'Yande',
        url: 'https://yande.re',
        type: 'moebooru',
        username: 'alice',
        favoriteSupport: true,
        active: true,
        authenticated: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 2,
        name: 'Danbooru',
        url: 'https://danbooru.donmai.us',
        type: 'danbooru',
        username: 'bob',
        favoriteSupport: false,
        active: false,
        authenticated: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
    expect(result).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        salt: expect.anything(),
      }),
    ]));
    expect(result).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        apiKey: expect.anything(),
      }),
    ]));
    expect(result).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        passwordHash: expect.anything(),
      }),
    ]));
  });

  it('returns a safe active booru site DTO without stored credentials', async () => {
    mockGetActiveBooruSite.mockResolvedValue(booruSiteRecord({
      id: 3,
      name: 'Gelbooru',
      url: 'https://gelbooru.com',
      type: 'gelbooru',
      username: 'carol',
      favoriteSupport: true,
      active: true,
    }));
    const route = findRoute(createBooruRoutes(), '/api/v1/booru-sites/active');

    const result = await route.handler(context());

    expect(result).toEqual({
      id: 3,
      name: 'Gelbooru',
      url: 'https://gelbooru.com',
      type: 'gelbooru',
      username: 'carol',
      favoriteSupport: true,
      active: true,
      authenticated: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(result).not.toHaveProperty('salt');
    expect(result).not.toHaveProperty('apiKey');
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('parses booru search query parameters', async () => {
    mockSearchBooruPosts.mockResolvedValue([]);
    const route = findRoute(createBooruRoutes(), '/api/v1/booru-posts/search');

    await route.handler(context({
      query: new URLSearchParams([
        ['siteId', '1'],
        ['tags', 'cat   dog'],
        ['page', '2'],
      ]),
    }));

    expect(mockSearchBooruPosts).toHaveBeenCalledWith(1, ['cat', 'dog'], 2, 20);
  });

  it('maps missing booru posts to 404 and exposes tags and favorite info', async () => {
    const routes = createBooruRoutes();
    const detailRoute = findRoute(routes, '/api/v1/booru-posts/:siteId/:postId');
    mockGetBooruPostBySiteAndId.mockResolvedValueOnce(null);

    await expect(detailRoute.handler(context({ params: { siteId: '1', postId: '99' } }))).rejects.toMatchObject({
      name: 'ApiHttpError',
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Resource not found',
    });

    mockGetBooruPostBySiteAndId.mockResolvedValue(post({
      tags: 'cat  dog\nbird',
      isFavorited: 1 as unknown as boolean,
      isLiked: 0 as unknown as boolean,
    }));

    await expect(
      findRoute(routes, '/api/v1/booru-posts/:siteId/:postId/tags')
        .handler(context({ params: { siteId: '1', postId: '2' } })),
    ).resolves.toEqual({ tags: ['cat', 'dog', 'bird'] });
    await expect(
      findRoute(routes, '/api/v1/booru-posts/:siteId/:postId/favorite-info')
        .handler(context({ params: { siteId: '1', postId: '2' } })),
    ).resolves.toEqual({ isFavorited: true, isLiked: false });
  });

  it('uses real service argument order for favorites and likes', async () => {
    mockGetFavorites.mockResolvedValue({ items: [], total: 0 });
    mockAddToFavorites.mockResolvedValue(55);
    mockRemoveFromFavorites.mockResolvedValue(undefined);
    mockSetPostLiked.mockResolvedValue(undefined);
    mockGetBooruPostBySiteAndId.mockResolvedValue(post({ siteId: 3, postId: 44 }));
    const routes = createBooruRoutes();

    await expect(findRoute(routes, '/api/v1/favorites').handler(context({
      query: new URLSearchParams([
        ['siteId', '3'],
        ['page', '2'],
        ['limit', '15'],
        ['groupId', 'null'],
        ['rating', 'explicit'],
      ]),
    }))).resolves.toEqual({ items: [], total: 0 });
    await expect(
      findRoute(routes, '/api/v1/favorites/:siteId/:postId', 'POST')
        .handler(context({ params: { siteId: '3', postId: '45' }, body: {} })),
    ).resolves.toEqual({ id: 55 });
    await expect(
      findRoute(routes, '/api/v1/favorites/:siteId/:postId', 'POST')
        .handler(context({ params: { siteId: '3', postId: '44' }, body: { notes: 'keeper' } })),
    ).resolves.toEqual({ id: 55 });
    await expect(
      findRoute(routes, '/api/v1/favorites/:siteId/:postId', 'POST')
        .handler(context({ params: { siteId: '3', postId: '46' }, body: { notes: 123 } })),
    ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    await expect(
      findRoute(routes, '/api/v1/favorites/:siteId/:postId', 'POST')
        .handler(context({ params: { siteId: '3', postId: '47' }, body: { unknown: true } })),
    ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    await expect(
      findRoute(routes, '/api/v1/favorites/:siteId/:postId', 'DELETE')
        .handler(context({ params: { siteId: '3', postId: '44' } })),
    ).resolves.toEqual({ removed: true });
    mockGetBooruPostBySiteAndId.mockResolvedValueOnce(null);
    await expect(
      findRoute(routes, '/api/v1/favorites/:siteId/:postId', 'DELETE')
        .handler(context({ params: { siteId: '3', postId: '404' } })),
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    await expect(
      findRoute(routes, '/api/v1/favorites/:siteId/:postId/like', 'POST')
        .handler(context({ params: { siteId: '3', postId: '44' } })),
    ).resolves.toEqual({ liked: true });
    await expect(
      findRoute(routes, '/api/v1/favorites/:siteId/:postId/like', 'DELETE')
        .handler(context({ params: { siteId: '3', postId: '44' } })),
    ).resolves.toEqual({ liked: false });

    expect(mockGetFavorites).toHaveBeenCalledWith(3, 2, 15, null, 'explicit');
    expect(mockAddToFavorites).toHaveBeenNthCalledWith(1, 45, 3, undefined);
    expect(mockAddToFavorites).toHaveBeenNthCalledWith(2, 44, 3, 'keeper');
    expect(mockAddToFavorites).toHaveBeenCalledTimes(2);
    expect(mockGetBooruPostBySiteAndId).toHaveBeenCalledWith(3, 45);
    expect(mockGetBooruPostBySiteAndId).toHaveBeenCalledWith(3, 44);
    expect(mockGetBooruPostBySiteAndId).toHaveBeenCalledWith(3, 404);
    expect(mockRemoveFromFavorites).toHaveBeenCalledWith(44, 3);
    expect(mockRemoveFromFavorites).toHaveBeenCalledTimes(1);
    expect(mockSetPostLiked).toHaveBeenNthCalledWith(1, 3, 44, true);
    expect(mockSetPostLiked).toHaveBeenNthCalledWith(2, 3, 44, false);
  });

  it('returns 404 before favorite writes and likes when the target post does not exist', async () => {
    mockGetBooruPostBySiteAndId.mockResolvedValue(null);
    const routes = createBooruRoutes();

    await expect(
      findRoute(routes, '/api/v1/favorites/:siteId/:postId', 'POST')
        .handler(context({ params: { siteId: '3', postId: '404' }, body: {} })),
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    await expect(
      findRoute(routes, '/api/v1/favorites/:siteId/:postId/like', 'POST')
        .handler(context({ params: { siteId: '3', postId: '404' } })),
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    await expect(
      findRoute(routes, '/api/v1/favorites/:siteId/:postId/like', 'DELETE')
        .handler(context({ params: { siteId: '3', postId: '404' } })),
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });

    expect(mockAddToFavorites).not.toHaveBeenCalled();
    expect(mockSetPostLiked).not.toHaveBeenCalled();
  });

  it('parses favorite tag list filters and rejects excessive limits', async () => {
    mockGetFavoriteTagsWithDownloadState.mockResolvedValue({ items: [], total: 0 });
    const route = findRoute(createBooruRoutes(), '/api/v1/favorite-tags');

    await route.handler(context({
      query: new URLSearchParams([
        ['siteId', '7'],
        ['keyword', 'cat'],
        ['limit', '50'],
        ['offset', '10'],
        ['sortKey', 'tagName'],
        ['sortOrder', 'desc'],
      ]),
    }));

    expect(mockGetFavoriteTagsWithDownloadState).toHaveBeenCalledWith({
      siteId: 7,
      keyword: 'cat',
      limit: 50,
      offset: 10,
      sortKey: 'tagName',
      sortOrder: 'desc',
    });
    await expect(
      route.handler(context({ query: new URLSearchParams([['limit', '201']]) })),
    ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    await expect(
      route.handler(context({ query: new URLSearchParams([['sortKey', 'bad']]) })),
    ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    await expect(
      route.handler(context({ query: new URLSearchParams([['sortOrder', 'sideways']]) })),
    ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
  });

  it('validates and creates favorite tags with options', async () => {
    const expected = { id: 1, siteId: null, tagName: 'cat', labels: ['a'], queryType: 'raw', notes: 'note', sortOrder: 0 };
    mockAddFavoriteTag.mockResolvedValue(expected as Awaited<ReturnType<typeof addFavoriteTag>>);
    const route = findRoute(createBooruRoutes(), '/api/v1/favorite-tags', 'POST');

    await expect(route.handler(context({ body: { tagName: '   ' } }))).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
    await expect(route.handler(context({ body: { tagName: 'cat', queryType: 123 } }))).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
    await expect(route.handler(context({ body: { tagName: 'cat', queryType: 'invalid' } }))).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
    await expect(route.handler(context({ body: { tagName: 'cat', labels: 'not-array' } }))).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
    await expect(route.handler(context({ body: { tagName: 'cat', notes: 123 } }))).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
    await expect(route.handler(context({ body: { tagName: 'cat', unknown: true } }))).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
    await expect(route.handler(context({
      body: { tagName: 'cat', siteId: 9, labels: ['a'], queryType: 'raw', notes: 'note' },
    }))).resolves.toBe(expected);
    expect(mockAddFavoriteTag).toHaveBeenCalledWith(9, 'cat', {
      labels: ['a'],
      queryType: 'raw',
      notes: 'note',
    });
  });

  it('patches and removes favorite tags with stable responses', async () => {
    mockUpdateFavoriteTag.mockResolvedValue(undefined);
    mockRemoveFavoriteTag.mockResolvedValue(undefined);
    mockGetFavoriteTagsWithDownloadState.mockResolvedValue({ items: [favoriteTag({ id: 5 })], total: 1 });
    const routes = createBooruRoutes();

    await expect(
      findRoute(routes, '/api/v1/favorite-tags/:id', 'PATCH')
        .handler(context({ params: { id: '5' }, body: { notes: 'updated' } })),
    ).resolves.toEqual({ updated: true });
    await expect(
      findRoute(routes, '/api/v1/favorite-tags/:id', 'DELETE')
        .handler(context({ params: { id: '5' } })),
    ).resolves.toEqual({ removed: true });
    expect(mockUpdateFavoriteTag).toHaveBeenCalledWith(5, { notes: 'updated' });
    expect(mockRemoveFavoriteTag).toHaveBeenCalledWith(5);
  });

  it('validates favorite tag patch bodies and requires an existing tag', async () => {
    mockUpdateFavoriteTag.mockResolvedValue(undefined);
    mockGetFavoriteTagsWithDownloadState.mockResolvedValueOnce({ items: [], total: 0 });
    const route = findRoute(createBooruRoutes(), '/api/v1/favorite-tags/:id', 'PATCH');

    await expect(
      route.handler(context({ params: { id: '404' }, body: { notes: 'missing' } })),
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(mockUpdateFavoriteTag).not.toHaveBeenCalled();

    for (const body of [
      { queryType: 'invalid' },
      { labels: 'not-array' },
      { sortOrder: '1' },
      { unknown: true },
      {},
    ]) {
      mockGetFavoriteTagsWithDownloadState.mockResolvedValueOnce({ items: [favoriteTag({ id: 5 })], total: 1 });
      await expect(
        route.handler(context({ params: { id: '5' }, body })),
      ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    }

    mockGetFavoriteTagsWithDownloadState.mockResolvedValueOnce({ items: [favoriteTag({ id: 5 })], total: 1 });
    await expect(
      route.handler(context({
        params: { id: '5' },
        body: {
          tagName: ' dog ',
          labels: ['a', 'b'],
          queryType: 'list',
          notes: null,
          sortOrder: 2,
          siteId: null,
        },
      })),
    ).resolves.toEqual({ updated: true });
    expect(mockUpdateFavoriteTag).toHaveBeenLastCalledWith(5, {
      tagName: 'dog',
      labels: ['a', 'b'],
      queryType: 'list',
      notes: null,
      sortOrder: 2,
      siteId: null,
    });
  });

  it('returns 404 before upserting binding for a missing favorite tag', async () => {
    mockGetFavoriteTagsWithDownloadState.mockResolvedValueOnce({ items: [], total: 0 });
    const route = findRoute(createBooruRoutes(), '/api/v1/favorite-tags/:id/binding', 'PUT');

    await expect(
      route.handler(context({ params: { id: '6' }, body: { downloadPath: 'M:/downloads' } })),
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(mockGetFavoriteTagsWithDownloadState).toHaveBeenCalledWith({ limit: 0 });
    expect(mockUpsertFavoriteTagDownloadBinding).not.toHaveBeenCalled();
  });

  it('handles favorite tag bindings and forces route id on put', async () => {
    const expectedBinding = binding();
    mockGetFavoriteTagDownloadBinding.mockResolvedValueOnce(null);
    mockGetFavoriteTagsWithDownloadState.mockResolvedValue({ items: [favoriteTag({ id: 6 })], total: 1 });
    mockUpsertFavoriteTagDownloadBinding.mockResolvedValue(expectedBinding);
    mockDeleteFavoriteTagDownloadBinding.mockResolvedValue(undefined);
    const routes = createBooruRoutes();

    await expect(
      findRoute(routes, '/api/v1/favorite-tags/:id/binding')
        .handler(context({ params: { id: '6' } })),
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    await expect(
      findRoute(routes, '/api/v1/favorite-tags/:id/binding', 'PUT')
        .handler(context({ params: { id: '6' }, body: { favoriteTagId: 999, downloadPath: 'M:/downloads' } })),
    ).resolves.toBe(expectedBinding);
    mockGetFavoriteTagDownloadBinding.mockResolvedValueOnce(expectedBinding);
    await expect(
      findRoute(routes, '/api/v1/favorite-tags/:id/binding', 'DELETE')
        .handler(context({ params: { id: '6' } })),
    ).resolves.toEqual({ removed: true });

    expect(mockUpsertFavoriteTagDownloadBinding).toHaveBeenCalledWith({
      favoriteTagId: 6,
      downloadPath: 'M:/downloads',
    });
    expect(mockDeleteFavoriteTagDownloadBinding).toHaveBeenCalledWith(6);
  });

  it('returns 404 for missing binding deletes and validates binding put input', async () => {
    const route = findRoute(createBooruRoutes(), '/api/v1/favorite-tags/:id/binding', 'PUT');
    const deleteRoute = findRoute(createBooruRoutes(), '/api/v1/favorite-tags/:id/binding', 'DELETE');
    mockGetFavoriteTagDownloadBinding.mockResolvedValueOnce(null);
    mockGetFavoriteTagsWithDownloadState.mockResolvedValue({ items: [favoriteTag({ id: 6 })], total: 1 });

    await expect(deleteRoute.handler(context({ params: { id: '6' } }))).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    expect(mockDeleteFavoriteTagDownloadBinding).not.toHaveBeenCalled();

    for (const body of [
      { downloadPath: 'M:/downloads', galleryId: 'bad' },
      { downloadPath: 'M:/downloads', enabled: null },
      { downloadPath: 'M:/downloads', blacklistedTags: ['ok', 123] },
      { downloadPath: 'M:/downloads', favoriteTagId: 'bad' },
      { downloadPath: 'M:/downloads', favoriteTagId: 0 },
      { downloadPath: 'M:/downloads', unknown: true },
    ]) {
      await expect(
        route.handler(context({ params: { id: '6' }, body })),
      ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    }

    const expectedBinding = binding({ favoriteTagId: 6 });
    mockUpsertFavoriteTagDownloadBinding.mockResolvedValue(expectedBinding);
    await expect(route.handler(context({
      params: { id: '6' },
      body: {
        favoriteTagId: 999,
        downloadPath: 'M:/downloads',
        galleryId: null,
        enabled: true,
        autoCreateGallery: null,
        autoSyncGalleryAfterDownload: false,
        quality: null,
        perPage: 100,
        concurrency: 3,
        skipIfExists: true,
        notifications: false,
        blacklistedTags: ['bad_tag'],
      },
    }))).resolves.toBe(expectedBinding);
    expect(mockUpsertFavoriteTagDownloadBinding).toHaveBeenLastCalledWith({
      favoriteTagId: 6,
      downloadPath: 'M:/downloads',
      galleryId: null,
      enabled: true,
      autoCreateGallery: null,
      autoSyncGalleryAfterDownload: false,
      quality: null,
      perPage: 100,
      concurrency: 3,
      skipIfExists: true,
      notifications: false,
      blacklistedTags: ['bad_tag'],
    });
  });

  it('starts favorite tag bulk downloads', async () => {
    mockGetFavoriteTagDownloadBinding.mockResolvedValue(binding({ favoriteTagId: 6, enabled: true }));
    mockStartFavoriteTagBulkDownload.mockResolvedValue({ taskId: 'task-1', sessionId: 'session-1' });
    const route = findRoute(createBooruRoutes(), '/api/v1/favorite-tags/:id/bulk-download', 'POST');

    await expect(route.handler(context({ params: { id: '6' } }))).resolves.toEqual({
      taskId: 'task-1',
      sessionId: 'session-1',
    });
    expect(mockStartFavoriteTagBulkDownload).toHaveBeenCalledWith(6);
  });

  it('preflights favorite tag bulk downloads by binding state', async () => {
    const route = findRoute(createBooruRoutes(), '/api/v1/favorite-tags/:id/bulk-download', 'POST');
    mockGetFavoriteTagDownloadBinding.mockResolvedValueOnce(null);

    await expect(route.handler(context({ params: { id: '6' } }))).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    mockGetFavoriteTagDownloadBinding.mockResolvedValueOnce(binding({ enabled: false }));
    await expect(route.handler(context({ params: { id: '6' } }))).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
    expect(mockStartFavoriteTagBulkDownload).not.toHaveBeenCalled();
  });

  it('handles download queue, task, and session reads', async () => {
    const task = { id: 'task-1' };
    const session = { id: 'session-1' };
    mockGetDownloadQueueForDisplay.mockResolvedValue([]);
    mockGetBulkDownloadTasks.mockResolvedValue([task as Awaited<ReturnType<typeof getBulkDownloadTasks>>[number]]);
    mockGetBulkDownloadTaskById.mockResolvedValueOnce(null).mockResolvedValueOnce(
      task as Awaited<ReturnType<typeof getBulkDownloadTaskById>>,
    );
    mockGetActiveBulkDownloadSessions.mockResolvedValue([session as Awaited<ReturnType<typeof getActiveBulkDownloadSessions>>[number]]);
    const routes = createBooruRoutes();

    await expect(
      findRoute(routes, '/api/v1/downloads/queue').handler(context({ query: new URLSearchParams([['status', 'pending']]) })),
    ).resolves.toEqual([]);
    await expect(findRoute(routes, '/api/v1/downloads/tasks').handler(context())).resolves.toEqual([task]);
    await expect(
      findRoute(routes, '/api/v1/downloads/tasks/:taskId')
        .handler(context({ params: { taskId: 'missing' } })),
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    await expect(
      findRoute(routes, '/api/v1/downloads/tasks/:taskId')
        .handler(context({ params: { taskId: 'task-1' } })),
    ).resolves.toBe(task);
    await expect(findRoute(routes, '/api/v1/downloads/sessions').handler(context())).resolves.toEqual([session]);
    await expect(
      findRoute(routes, '/api/v1/downloads/sessions/:sessionId')
        .handler(context({ params: { sessionId: 'missing' } })),
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    await expect(
      findRoute(routes, '/api/v1/downloads/sessions/:sessionId')
        .handler(context({ params: { sessionId: 'session-1' } })),
    ).resolves.toBe(session);
    expect(mockGetDownloadQueueForDisplay).toHaveBeenCalledWith('pending');
    expect(mockGetDownloadQueue).not.toHaveBeenCalled();
  });

  it('unwraps download session control wrappers', async () => {
    const routes = createBooruRoutes();
    mockGetActiveBulkDownloadSessions.mockResolvedValue([session({ id: 's1' })]);
    mockPauseBulkDownloadSession.mockResolvedValueOnce({ success: false, error: 'secret path' });
    await expect(
      findRoute(routes, '/api/v1/downloads/sessions/:sessionId/pause', 'POST')
        .handler(context({ params: { sessionId: 's1' } })),
    ).rejects.toMatchObject({
      name: 'ApiHttpError',
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Download session control failed',
    });
    await expect(
      findRoute(routes, '/api/v1/downloads/sessions/:sessionId/pause', 'POST')
        .handler(context({ params: { sessionId: 's1' } })),
    ).rejects.not.toThrow(/secret path/);

    mockPauseBulkDownloadSession.mockResolvedValue({ success: true });
    mockStartBulkDownloadSession.mockResolvedValue({ success: true, queued: true });
    mockCancelBulkDownloadSession.mockResolvedValue({ success: true });

    await expect(
      findRoute(routes, '/api/v1/downloads/sessions/:sessionId/pause', 'POST')
        .handler(context({ params: { sessionId: 's1' } })),
    ).resolves.toEqual({ paused: true });
    await expect(
      findRoute(routes, '/api/v1/downloads/sessions/:sessionId/resume', 'POST')
        .handler(context({ params: { sessionId: 's1' } })),
    ).resolves.toEqual({ resumed: true, queued: true });
    await expect(
      findRoute(routes, '/api/v1/downloads/sessions/:sessionId/cancel', 'POST')
        .handler(context({ params: { sessionId: 's1' } })),
    ).resolves.toEqual({ cancelled: true });
  });

  it('returns 404 before controlling missing download sessions', async () => {
    mockGetActiveBulkDownloadSessions.mockResolvedValue([]);
    const routes = createBooruRoutes();

    for (const [pattern, method] of [
      ['/api/v1/downloads/sessions/:sessionId/pause', 'POST'],
      ['/api/v1/downloads/sessions/:sessionId/resume', 'POST'],
      ['/api/v1/downloads/sessions/:sessionId/cancel', 'POST'],
    ] as const) {
      await expect(
        findRoute(routes, pattern, method).handler(context({ params: { sessionId: 'missing' } })),
      ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    }

    expect(mockPauseBulkDownloadSession).not.toHaveBeenCalled();
    expect(mockStartBulkDownloadSession).not.toHaveBeenCalled();
    expect(mockCancelBulkDownloadSession).not.toHaveBeenCalled();
  });

  it('throws ApiHttpError for invalid booru numeric params', async () => {
    const route = findRoute(createBooruRoutes(), '/api/v1/booru-posts/:siteId/:postId');

    await expect(route.handler(context({ params: { siteId: 'bad', postId: '1' } }))).rejects.toBeInstanceOf(
      ApiHttpError,
    );
  });
});
