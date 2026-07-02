import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fingerprintApiKey } from '../../../src/main/api/security.js';
import { ApiHttpError, type ApiRequestContext, type ApiRoute } from '../../../src/main/api/types.js';
import { createGalleryRoutes } from '../../../src/main/api/routes/galleryRoutes.js';
import { createServiceRoutes } from '../../../src/main/api/routes/serviceRoutes.js';
import { getApiServiceConfig } from '../../../src/main/services/config.js';
import { getGalleries, getGallery } from '../../../src/main/services/galleryService.js';
import { getImageById, getImages, getImagesByGallery } from '../../../src/main/services/imageService.js';
import { generateThumbnail } from '../../../src/main/services/thumbnailService.js';
import { createReadStream } from 'fs';
import { pipeline } from 'stream/promises';

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '9.8.7'),
  },
}));

vi.mock('../../../src/main/services/config.js', () => ({
  getApiServiceConfig: vi.fn(),
}));

vi.mock('../../../src/main/services/galleryService.js', () => ({
  getGalleries: vi.fn(),
  getGallery: vi.fn(),
}));

vi.mock('../../../src/main/services/imageService.js', () => ({
  getImages: vi.fn(),
  getImageById: vi.fn(),
  getImagesByGallery: vi.fn(),
}));

vi.mock('../../../src/main/services/thumbnailService.js', () => ({
  cancelThumbnailGeneration: vi.fn(),
  generateThumbnail: vi.fn(),
}));

vi.mock('fs', () => ({
  createReadStream: vi.fn(),
}));

vi.mock('stream/promises', () => ({
  pipeline: vi.fn(),
}));

const mockGetApiServiceConfig = vi.mocked(getApiServiceConfig);
const mockGetGalleries = vi.mocked(getGalleries);
const mockGetGallery = vi.mocked(getGallery);
const mockGetImages = vi.mocked(getImages);
const mockGetImageById = vi.mocked(getImageById);
const mockGetImagesByGallery = vi.mocked(getImagesByGallery);
const mockGenerateThumbnail = vi.mocked(generateThumbnail);
const mockCreateReadStream = vi.mocked(createReadStream);
const mockPipeline = vi.mocked(pipeline);

function findRoute(routes: ApiRoute[], pattern: string): ApiRoute {
  const route = routes.find((candidate) => candidate.pattern === pattern);
  if (!route) {
    throw new Error(`Missing route: ${pattern}`);
  }

  return route;
}

function context(options: {
  params?: Record<string, string>;
  query?: URLSearchParams;
  res?: Partial<ApiRequestContext['res']>;
} = {}): ApiRequestContext {
  return {
    req: {} as ApiRequestContext['req'],
    res: {
      setHeader: vi.fn(),
      ...options.res,
    } as ApiRequestContext['res'],
    method: 'GET',
    pathname: '/',
    query: options.query ?? new URLSearchParams(),
    params: options.params ?? {},
    sourceIp: '127.0.0.1',
    permissionKey: null,
  };
}

function gallery(overrides: Partial<Awaited<ReturnType<typeof getGallery>>['data']> = {}) {
  return {
    id: 12,
    folderPath: 'M:/gallery/cats',
    name: 'cats',
    imageCount: 2,
    isWatching: false,
    recursive: true,
    extensions: ['.jpg'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function image(overrides: Partial<Awaited<ReturnType<typeof getImageById>>['data']> = {}) {
  return {
    id: 34,
    filename: 'cat.jpg',
    filepath: 'M:/gallery/cats/cat.jpg',
    fileSize: 123,
    width: 800,
    height: 600,
    format: 'jpg',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tags: [],
    ...overrides,
  };
}

describe('service API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetApiServiceConfig.mockReturnValue({
      enabled: true,
      mode: 'localhost',
      port: 3210,
      apiKey: 'raw-secret-key',
      permissions: {
        galleryRead: true,
        imageRead: true,
        imageBinary: true,
        booruRead: false,
        booruWrite: false,
        favoriteTagsRead: false,
        favoriteTagsWrite: false,
        downloadsRead: false,
        downloadsControl: false,
        eventsSubscribe: false,
        apiLogsRead: false,
      },
      logs: {
        enabled: true,
        visibleInUi: true,
      },
    });
  });

  it('returns service metadata without exposing the raw API key', async () => {
    const status = {
      running: true,
      enabled: true,
      mode: 'localhost',
      port: 3210,
      bindAddress: '127.0.0.1',
      baseUrl: 'http://127.0.0.1:3210',
      startedAt: '2026-01-01T00:00:00.000Z',
      lastError: null,
      apiKey: 'status-secret-key',
    };
    const route = findRoute(
      createServiceRoutes({ getStatus: () => status as any }),
      '/api/v1/service/info',
    );

    const result = await route.handler(context());

    expect(result).toMatchObject({
      appName: 'Yande Gallery Desktop',
      appVersion: '9.8.7',
      apiVersion: 'v1',
      status: {
        running: true,
        enabled: true,
        mode: 'localhost',
        port: 3210,
        bindAddress: '127.0.0.1',
        baseUrl: 'http://127.0.0.1:3210',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastError: null,
      },
      mode: 'localhost',
      apiKeyFingerprint: fingerprintApiKey('raw-secret-key'),
    });
    expect(result).toHaveProperty('permissions.galleryRead', true);
    expect(JSON.stringify(result)).not.toContain('raw-secret-key');
    expect(JSON.stringify(result)).not.toContain('status-secret-key');
    expect(result).not.toHaveProperty('apiKey');
    expect(result).not.toHaveProperty('status.apiKey');
  });

  it('returns health with an ISO timestamp', async () => {
    const route = findRoute(createServiceRoutes({ getStatus: () => ({
      running: true,
      enabled: true,
      mode: 'localhost',
      port: 3210,
      bindAddress: '127.0.0.1',
      baseUrl: 'http://127.0.0.1:3210',
      startedAt: null,
      lastError: null,
    }) }), '/api/v1/service/health');

    const result = await route.handler(context());

    expect(result).toMatchObject({ ok: true });
    expect((result as { timestamp: string }).timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });
});

describe('gallery and image API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPipeline.mockResolvedValue(undefined);
  });

  it('unwraps galleries from the gallery service', async () => {
    const galleries = [gallery({ id: 1, name: 'one' }), gallery({ id: 2, name: 'two' })];
    mockGetGalleries.mockResolvedValue({ success: true, data: galleries });
    const route = findRoute(createGalleryRoutes(), '/api/v1/galleries');

    await expect(route.handler(context())).resolves.toBe(galleries);
    expect(mockGetGalleries).toHaveBeenCalledTimes(1);
  });

  it('parses gallery ids and returns a single gallery', async () => {
    const expected = gallery({ id: 42 });
    mockGetGallery.mockResolvedValue({ success: true, data: expected });
    const route = findRoute(createGalleryRoutes(), '/api/v1/galleries/:galleryId');

    await expect(route.handler(context({ params: { galleryId: '42' } }))).resolves.toBe(expected);
    expect(mockGetGallery).toHaveBeenCalledWith(42);
  });

  it('loads gallery images by membership with parsed pagination', async () => {
    const expectedGallery = gallery({ id: 7, folderPath: 'M:/gallery/dogs' });
    const expectedImages = [image({ id: 70 })];
    mockGetGallery.mockResolvedValue({ success: true, data: expectedGallery });
    mockGetImagesByGallery.mockResolvedValue({ success: true, data: expectedImages, total: 1 });
    const route = findRoute(createGalleryRoutes(), '/api/v1/galleries/:galleryId/images');

    await expect(
      route.handler(context({
        params: { galleryId: '7' },
        query: new URLSearchParams([['page', '3'], ['pageSize', '25']]),
      })),
    ).resolves.toEqual({ data: expectedImages, total: 1 });
    // 仍保留 gallery-not-found 检查
    expect(mockGetGallery).toHaveBeenCalledWith(7);
    // 成员读取改用 getImagesByGallery，按 galleryId 取成员（不再用 folderPath 前缀）
    expect(mockGetImagesByGallery).toHaveBeenCalledWith(7, 3, 25);
  });

  it('uses default pagination for gallery images', async () => {
    mockGetGallery.mockResolvedValue({ success: true, data: gallery({ id: 8, folderPath: 'M:/gallery/defaults' }) });
    mockGetImagesByGallery.mockResolvedValue({ success: true, data: [], total: 0 });
    const route = findRoute(createGalleryRoutes(), '/api/v1/galleries/:galleryId/images');

    await route.handler(context({ params: { galleryId: '8' } }));

    expect(mockGetImagesByGallery).toHaveBeenCalledWith(8, 1, 50);
  });

  it('lists images with parsed and default pagination', async () => {
    const expectedImages = [image({ id: 1 })];
    mockGetImages.mockResolvedValue({ success: true, data: expectedImages });
    const route = findRoute(createGalleryRoutes(), '/api/v1/images');

    await expect(
      route.handler(context({ query: new URLSearchParams([['page', '2'], ['pageSize', '10']]) })),
    ).resolves.toBe(expectedImages);
    expect(mockGetImages).toHaveBeenCalledWith(2, 10);

    mockGetImages.mockClear();
    await route.handler(context());
    expect(mockGetImages).toHaveBeenCalledWith(1, 50);
  });

  it('parses image ids and returns image metadata', async () => {
    const expected = image({ id: 55 });
    mockGetImageById.mockResolvedValue({ success: true, data: expected });
    const route = findRoute(createGalleryRoutes(), '/api/v1/images/:imageId');

    await expect(route.handler(context({ params: { imageId: '55' } }))).resolves.toBe(expected);
    expect(mockGetImageById).toHaveBeenCalledWith(55);
  });

  it('generates and streams image thumbnails', async () => {
    const expectedImage = image({ id: 66, filepath: 'M:/gallery/cats/source.jpg' });
    const stream = {};
    mockGetImageById.mockResolvedValue({ success: true, data: expectedImage });
    mockGenerateThumbnail.mockResolvedValue({ success: true, data: 'M:/thumbs/source.webp' });
    mockCreateReadStream.mockReturnValue(stream as ReturnType<typeof createReadStream>);
    const res = { setHeader: vi.fn() } as unknown as ApiRequestContext['res'];
    const route = findRoute(createGalleryRoutes(), '/api/v1/images/:imageId/thumbnail');

    await expect(route.handler(context({ params: { imageId: '66' }, res }))).resolves.toBeUndefined();

    expect(mockGetImageById).toHaveBeenCalledWith(66);
    expect(mockGenerateThumbnail).toHaveBeenCalledWith('M:/gallery/cats/source.jpg');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/webp');
    expect(mockCreateReadStream).toHaveBeenCalledWith('M:/thumbs/source.webp');
    expect(mockPipeline).toHaveBeenCalledWith(stream, res);
  });

  it('sets thumbnail content type from the generated thumbnail extension', async () => {
    const stream = {};
    mockGetImageById.mockResolvedValue({ success: true, data: image({ filepath: 'M:/gallery/cats/source.jpg' }) });
    mockGenerateThumbnail.mockResolvedValue({ success: true, data: 'M:/thumbs/source.gif' });
    mockCreateReadStream.mockReturnValue(stream as ReturnType<typeof createReadStream>);
    const res = { setHeader: vi.fn() } as unknown as ApiRequestContext['res'];
    const route = findRoute(createGalleryRoutes(), '/api/v1/images/:imageId/thumbnail');

    await expect(route.handler(context({ params: { imageId: '67' }, res }))).resolves.toBeUndefined();

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/gif');
    expect(mockPipeline).toHaveBeenCalledWith(stream, res);
  });

  it('sets jpeg content type for jpg thumbnails', async () => {
    const stream = {};
    mockGetImageById.mockResolvedValue({ success: true, data: image({ filepath: 'M:/gallery/cats/source.jpg' }) });
    mockGenerateThumbnail.mockResolvedValue({ success: true, data: 'M:/thumbs/source.jpg' });
    mockCreateReadStream.mockReturnValue(stream as ReturnType<typeof createReadStream>);
    const res = { setHeader: vi.fn() } as unknown as ApiRequestContext['res'];
    const route = findRoute(createGalleryRoutes(), '/api/v1/images/:imageId/thumbnail');

    await expect(route.handler(context({ params: { imageId: '68' }, res }))).resolves.toBeUndefined();

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
  });

  it('streams original image files', async () => {
    const expectedImage = image({ id: 77, filepath: 'M:/gallery/cats/original.png' });
    const stream = {};
    mockGetImageById.mockResolvedValue({ success: true, data: expectedImage });
    mockCreateReadStream.mockReturnValue(stream as ReturnType<typeof createReadStream>);
    const res = { setHeader: vi.fn() } as unknown as ApiRequestContext['res'];
    const route = findRoute(createGalleryRoutes(), '/api/v1/images/:imageId/file');

    await expect(route.handler(context({ params: { imageId: '77' }, res }))).resolves.toBeUndefined();

    expect(mockGetImageById).toHaveBeenCalledWith(77);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/octet-stream');
    expect(mockCreateReadStream).toHaveBeenCalledWith('M:/gallery/cats/original.png');
    expect(mockPipeline).toHaveBeenCalledWith(stream, res);
  });

  it('waits for file streams to finish before resolving', async () => {
    let finishPipeline!: () => void;
    const stream = {};
    let resolved = false;
    mockGetImageById.mockResolvedValue({ success: true, data: image({ filepath: 'M:/gallery/cats/wait.png' }) });
    mockCreateReadStream.mockReturnValue(stream as ReturnType<typeof createReadStream>);
    mockPipeline.mockReturnValue(new Promise<void>((resolve) => {
      finishPipeline = resolve;
    }) as ReturnType<typeof pipeline>);
    const route = findRoute(createGalleryRoutes(), '/api/v1/images/:imageId/file');

    const resultPromise = route.handler(context({ params: { imageId: '78' } }));
    Promise.resolve(resultPromise).then(() => {
      resolved = true;
    });
    await Promise.resolve();

    expect(resolved).toBe(false);

    finishPipeline();
    await expect(resultPromise).resolves.toBeUndefined();
    expect(resolved).toBe(true);
  });

  it('maps not-found service results to API not found errors', async () => {
    mockGetGallery.mockResolvedValue({ success: false, error: 'Gallery not found' });
    const route = findRoute(createGalleryRoutes(), '/api/v1/galleries/:galleryId');

    await expect(route.handler(context({ params: { galleryId: '404' } }))).rejects.toMatchObject({
      name: 'ApiHttpError',
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('uses generic not-found messages for missing images', async () => {
    mockGetImageById.mockResolvedValue({ success: false, error: 'Image not found' });
    const route = findRoute(createGalleryRoutes(), '/api/v1/images/:imageId');

    await expect(route.handler(context({ params: { imageId: '404' } }))).rejects.toMatchObject({
      name: 'ApiHttpError',
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Resource not found',
    });
  });

  it('uses generic not-found messages when thumbnails are missing', async () => {
    mockGetImageById.mockResolvedValue({ success: true, data: image({ filepath: 'M:/secret/file.jpg' }) });
    mockGenerateThumbnail.mockResolvedValue({
      success: false,
      missing: true,
      error: 'source missing M:/secret/file.jpg',
    });
    const route = findRoute(createGalleryRoutes(), '/api/v1/images/:imageId/thumbnail');

    await expect(route.handler(context({ params: { imageId: '88' } }))).rejects.toMatchObject({
      name: 'ApiHttpError',
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Resource not found',
    });
    await expect(route.handler(context({ params: { imageId: '88' } }))).rejects.not.toThrow(
      /M:\/secret\/file\.jpg|source missing/,
    );
  });

  it('maps stream failures to API errors without leaking local paths', async () => {
    mockGetImageById.mockResolvedValue({ success: true, data: image({ filepath: 'M:/secret/original.png' }) });
    mockCreateReadStream.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT M:/secret/original.png'), { code: 'ENOENT' });
    });
    const route = findRoute(createGalleryRoutes(), '/api/v1/images/:imageId/file');

    await expect(route.handler(context({ params: { imageId: '89' } }))).rejects.toMatchObject({
      name: 'ApiHttpError',
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Resource not found',
    });
    await expect(route.handler(context({ params: { imageId: '89' } }))).rejects.not.toThrow(
      /M:\/secret\/original\.png|ENOENT/,
    );
  });

  it('maps stream pipeline failures to internal API errors', async () => {
    mockGetImageById.mockResolvedValue({ success: true, data: image({ filepath: 'M:/secret/broken.png' }) });
    mockCreateReadStream.mockReturnValue({} as ReturnType<typeof createReadStream>);
    mockPipeline.mockRejectedValue(new Error('stream failed M:/secret/broken.png'));
    const route = findRoute(createGalleryRoutes(), '/api/v1/images/:imageId/file');

    await expect(route.handler(context({ params: { imageId: '90' } }))).rejects.toMatchObject({
      name: 'ApiHttpError',
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Failed to stream file',
    });
    await expect(route.handler(context({ params: { imageId: '90' } }))).rejects.not.toThrow(
      /M:\/secret\/broken\.png|stream failed/,
    );
  });

  it('does not throw API errors for stream failures after the response has started', async () => {
    const streamError = new Error('stream failed after headers M:/secret/started.png');
    const destroy = vi.fn();
    mockGetImageById.mockResolvedValue({ success: true, data: image({ filepath: 'M:/secret/started.png' }) });
    mockCreateReadStream.mockReturnValue({} as ReturnType<typeof createReadStream>);
    mockPipeline.mockRejectedValue(streamError);
    const res = {
      setHeader: vi.fn(),
      headersSent: true,
      writableEnded: false,
      destroyed: false,
      destroy,
    } as unknown as ApiRequestContext['res'];
    const route = findRoute(createGalleryRoutes(), '/api/v1/images/:imageId/file');

    await expect(route.handler(context({ params: { imageId: '91' }, res }))).resolves.toBeUndefined();

    expect(destroy).toHaveBeenCalledWith(streamError);
  });

  it('rejects page sizes above the API limit', async () => {
    const route = findRoute(createGalleryRoutes(), '/api/v1/images');

    await expect(
      route.handler(context({ query: new URLSearchParams([['pageSize', '201']]) })),
    ).rejects.toMatchObject({
      name: 'ApiHttpError',
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
    expect(mockGetImages).not.toHaveBeenCalled();
  });

  it('rejects invalid numeric params with validation errors', async () => {
    const route = findRoute(createGalleryRoutes(), '/api/v1/images/:imageId');

    await expect(route.handler(context({ params: { imageId: 'abc' } }))).rejects.toMatchObject({
      name: 'ApiHttpError',
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
    await expect(route.handler(context({ params: { imageId: 'abc' } }))).rejects.toBeInstanceOf(
      ApiHttpError,
    );
  });
});
