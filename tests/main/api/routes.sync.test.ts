import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiRequestContext, ApiRoute } from '../../../src/main/api/types.js';
import { createSyncRoutes } from '../../../src/main/api/routes/syncRoutes.js';
import {
  decodeSyncCursor,
  getSyncMeta,
  listSyncGalleries,
  listSyncImageIds,
  listSyncImages,
  listSyncTags,
} from '../../../src/main/services/syncService.js';

vi.mock('../../../src/main/services/syncService.js', () => ({
  getSyncMeta: vi.fn(),
  listSyncImages: vi.fn(),
  listSyncGalleries: vi.fn(),
  listSyncTags: vi.fn(),
  listSyncImageIds: vi.fn(),
  decodeSyncCursor: vi.fn(),
}));

const mockGetSyncMeta = vi.mocked(getSyncMeta);
const mockListSyncImages = vi.mocked(listSyncImages);
const mockListSyncGalleries = vi.mocked(listSyncGalleries);
const mockListSyncTags = vi.mocked(listSyncTags);
const mockListSyncImageIds = vi.mocked(listSyncImageIds);
const mockDecodeSyncCursor = vi.mocked(decodeSyncCursor);

function findRoute(pattern: string): ApiRoute {
  const route = createSyncRoutes().find((candidate) => candidate.pattern === pattern);
  if (!route) {
    throw new Error(`Missing route: ${pattern}`);
  }
  return route;
}

type EndMock = ReturnType<typeof vi.fn>;

function context(options: { query?: URLSearchParams } = {}): ApiRequestContext & { res: { end: EndMock } } {
  return {
    req: { headers: {} } as unknown as ApiRequestContext['req'],
    res: {
      setHeader: vi.fn(),
      end: vi.fn(),
    } as unknown as ApiRequestContext['res'],
    method: 'GET',
    pathname: '/',
    query: options.query ?? new URLSearchParams(),
    params: {},
    sourceIp: '127.0.0.1',
    permissionKey: 'galleryRead',
  } as ApiRequestContext & { res: { end: EndMock } };
}

function endBody(ctx: { res: { end: EndMock } }): string {
  const end = ctx.res.end;
  expect(end).toHaveBeenCalledTimes(1);
  return String(end.mock.calls[0][0]);
}

describe('sync API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('meta 委托 getSyncMeta 并写出 success envelope（handler 返回 undefined）', async () => {
    mockGetSyncMeta.mockResolvedValue({ serverId: 'srv-1', dataVersion: 3, imageCount: 4, latestCursor: 'cur' });
    const route = findRoute('/api/v1/sync/meta');
    const ctx = context();

    await expect(route.handler(ctx)).resolves.toBeUndefined();

    expect(mockGetSyncMeta).toHaveBeenCalledTimes(1);
    expect(endBody(ctx)).toContain('"success":true');
  });

  it('galleries 委托 listSyncGalleries，载荷包在 items 下', async () => {
    mockListSyncGalleries.mockResolvedValue([{ id: 1, name: 'g1', coverImageId: null, imageCount: 0 }]);
    const route = findRoute('/api/v1/sync/galleries');
    const ctx = context();

    await expect(route.handler(ctx)).resolves.toBeUndefined();

    expect(mockListSyncGalleries).toHaveBeenCalledTimes(1);
    const body = endBody(ctx);
    expect(body).toContain('"success":true');
    expect(JSON.parse(body)).toEqual({ success: true, data: { items: [{ id: 1, name: 'g1', coverImageId: null, imageCount: 0 }] } });
  });

  it('tags 委托 listSyncTags，载荷包在 items 下', async () => {
    mockListSyncTags.mockResolvedValue([{ id: 1, name: 't1', category: null }]);
    const route = findRoute('/api/v1/sync/tags');
    const ctx = context();

    await expect(route.handler(ctx)).resolves.toBeUndefined();

    expect(mockListSyncTags).toHaveBeenCalledTimes(1);
    expect(JSON.parse(endBody(ctx))).toEqual({ success: true, data: { items: [{ id: 1, name: 't1', category: null }] } });
  });

  it('image-ids 委托 listSyncImageIds，响应 { ids }', async () => {
    mockListSyncImageIds.mockResolvedValue([1, 2, 3, 4]);
    const route = findRoute('/api/v1/sync/image-ids');
    const ctx = context();

    await expect(route.handler(ctx)).resolves.toBeUndefined();

    expect(mockListSyncImageIds).toHaveBeenCalledTimes(1);
    expect(JSON.parse(endBody(ctx))).toEqual({ success: true, data: { ids: [1, 2, 3, 4] } });
  });

  it('images 缺 cursor 时传 null，默认 limit 2000', async () => {
    mockListSyncImages.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    const route = findRoute('/api/v1/sync/images');

    await expect(route.handler(context())).resolves.toBeUndefined();

    expect(mockDecodeSyncCursor).not.toHaveBeenCalled();
    expect(mockListSyncImages).toHaveBeenCalledWith(null, 2000);
  });

  it('images 合法 cursor 解码后传给 listSyncImages（携带自定义 limit）', async () => {
    mockDecodeSyncCursor.mockReturnValue({ u: '2024-01-01T00:00:00.000Z', i: 3 });
    mockListSyncImages.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    const route = findRoute('/api/v1/sync/images');

    await route.handler(context({ query: new URLSearchParams([['cursor', 'abc'], ['limit', '10']]) }));

    expect(mockDecodeSyncCursor).toHaveBeenCalledWith('abc');
    expect(mockListSyncImages).toHaveBeenCalledWith({ u: '2024-01-01T00:00:00.000Z', i: 3 }, 10);
  });

  it('images 非法 cursor 抛 422，不触达 listSyncImages', async () => {
    mockDecodeSyncCursor.mockReturnValue(null);
    const route = findRoute('/api/v1/sync/images');

    await expect(route.handler(context({ query: new URLSearchParams([['cursor', 'bad']]) }))).rejects.toMatchObject({
      name: 'ApiHttpError',
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
    expect(mockListSyncImages).not.toHaveBeenCalled();
  });

  it('images limit 超 5000 被钳制为 5000', async () => {
    mockListSyncImages.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    const route = findRoute('/api/v1/sync/images');

    await route.handler(context({ query: new URLSearchParams([['limit', '999999']]) }));

    expect(mockListSyncImages).toHaveBeenCalledWith(null, 5000);
  });
});
