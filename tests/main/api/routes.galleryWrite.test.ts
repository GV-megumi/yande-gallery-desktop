import { Readable } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGalleryWriteRoutes } from '../../../src/main/api/routes/galleryWriteRoutes.js';
import type { ApiRequestContext, ApiRoute } from '../../../src/main/api/types.js';
import {
  addImageTags,
  deleteImage,
  getImageById,
  removeImageTags,
} from '../../../src/main/services/imageService.js';
import type { Image } from '../../../src/shared/types.js';

vi.mock('../../../src/main/services/imageService.js', () => ({
  getImageById: vi.fn(),
  deleteImage: vi.fn(),
  addImageTags: vi.fn(),
  removeImageTags: vi.fn(),
}));

// galleryService 空工厂：本任务 galleryWriteRoutes.ts 不引用它，占位供 Task 12 扩充。
vi.mock('../../../src/main/services/galleryService.js', () => ({}));

const mockGetImageById = vi.mocked(getImageById);
const mockDeleteImage = vi.mocked(deleteImage);
const mockAddImageTags = vi.mocked(addImageTags);
const mockRemoveImageTags = vi.mocked(removeImageTags);

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

function image(overrides: Partial<Image> = {}): Image {
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
    ...overrides,
  };
}

describe('gallery write API routes', () => {
  const routes = createGalleryWriteRoutes();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('DELETE /images/:imageId', () => {
    it('预检后删除', async () => {
      mockGetImageById.mockResolvedValue({ success: true, data: image({ id: 5 }) });
      mockDeleteImage.mockResolvedValue({ success: true });
      const route = findRoute(routes, '/api/v1/images/:imageId', 'DELETE');

      await expect(route.handler(context({ params: { imageId: '5' } }))).resolves.toEqual({ removed: true });

      expect(mockGetImageById).toHaveBeenCalledWith(5);
      expect(mockDeleteImage).toHaveBeenCalledWith(5);
    });

    it('不存在 → 404 且不调 deleteImage', async () => {
      mockGetImageById.mockResolvedValue({ success: false, error: 'Image not found' });
      const route = findRoute(routes, '/api/v1/images/:imageId', 'DELETE');

      await expect(route.handler(context({ params: { imageId: '5' } })))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
      expect(mockDeleteImage).not.toHaveBeenCalled();
    });

    it('deleteImage 失败 → 500', async () => {
      mockGetImageById.mockResolvedValue({ success: true, data: image({ id: 5 }) });
      mockDeleteImage.mockResolvedValue({ success: false, error: 'disk error' });
      const route = findRoute(routes, '/api/v1/images/:imageId', 'DELETE');

      await expect(route.handler(context({ params: { imageId: '5' } })))
        .rejects.toMatchObject({ statusCode: 500, code: 'INTERNAL_ERROR' });
    });

    it('非法 imageId → 422', async () => {
      const route = findRoute(routes, '/api/v1/images/:imageId', 'DELETE');

      await expect(route.handler(context({ params: { imageId: 'abc' } })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      expect(mockGetImageById).not.toHaveBeenCalled();
    });
  });

  describe('POST /images/batch-delete', () => {
    it('逐条成败，缺失记 NOT_FOUND，失败不中断', async () => {
      mockGetImageById
        .mockResolvedValueOnce({ success: true, data: image({ id: 1 }) })
        .mockResolvedValueOnce({ success: false, error: 'Image not found' })
        .mockResolvedValueOnce({ success: true, data: image({ id: 3 }) });
      mockDeleteImage
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, error: 'disk error' });
      const route = findRoute(routes, '/api/v1/images/batch-delete', 'POST');

      await expect(route.handler(context({ body: { imageIds: [1, 2, 3] } }))).resolves.toEqual({
        results: [
          { imageId: 1, success: true },
          { imageId: 2, success: false, error: 'NOT_FOUND' },
          { imageId: 3, success: false, error: 'disk error' },
        ],
      });
      expect(mockDeleteImage).toHaveBeenCalledTimes(2);
      expect(mockDeleteImage).toHaveBeenNthCalledWith(1, 1);
      expect(mockDeleteImage).toHaveBeenNthCalledWith(2, 3);
    });

    it('空数组 → 422', async () => {
      const route = findRoute(routes, '/api/v1/images/batch-delete', 'POST');

      await expect(route.handler(context({ body: { imageIds: [] } })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      expect(mockGetImageById).not.toHaveBeenCalled();
    });

    it('非法元素（非整数/非正数）→ 422', async () => {
      const route = findRoute(routes, '/api/v1/images/batch-delete', 'POST');

      await expect(route.handler(context({ body: { imageIds: [1, 'two'] } })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      await expect(route.handler(context({ body: { imageIds: [1, -2] } })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      await expect(route.handler(context({ body: { imageIds: [1, 0] } })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      await expect(route.handler(context({ body: { imageIds: [1, 1.5] } })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      expect(mockGetImageById).not.toHaveBeenCalled();
    });

    it('缺失 imageIds 字段 → 422', async () => {
      const route = findRoute(routes, '/api/v1/images/batch-delete', 'POST');

      await expect(route.handler(context({ body: {} })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    });
  });

  describe('POST /images/:imageId/tags', () => {
    it('委托 addImageTags', async () => {
      mockAddImageTags.mockResolvedValue({ success: true });
      const route = findRoute(routes, '/api/v1/images/:imageId/tags', 'POST');

      await expect(route.handler(context({ params: { imageId: '5' }, body: { names: ['cat', 'cute'] } })))
        .resolves.toEqual({ updated: true });
      expect(mockAddImageTags).toHaveBeenCalledWith(5, ['cat', 'cute']);
    });

    it('missing → 404', async () => {
      mockAddImageTags.mockResolvedValue({ success: false, missing: true, error: 'Image not found' });
      const route = findRoute(routes, '/api/v1/images/:imageId/tags', 'POST');

      await expect(route.handler(context({ params: { imageId: '5' }, body: { names: ['cat'] } })))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    it('service 失败（非 missing）→ 500', async () => {
      mockAddImageTags.mockResolvedValue({ success: false, error: 'db error' });
      const route = findRoute(routes, '/api/v1/images/:imageId/tags', 'POST');

      await expect(route.handler(context({ params: { imageId: '5' }, body: { names: ['cat'] } })))
        .rejects.toMatchObject({ statusCode: 500, code: 'INTERNAL_ERROR' });
    });

    it('names 非法（空数组/非字符串/空白串）→ 422', async () => {
      const route = findRoute(routes, '/api/v1/images/:imageId/tags', 'POST');

      await expect(route.handler(context({ params: { imageId: '5' }, body: { names: [] } })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      await expect(route.handler(context({ params: { imageId: '5' }, body: { names: [1] } })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      await expect(route.handler(context({ params: { imageId: '5' }, body: { names: ['  '] } })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      expect(mockAddImageTags).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /images/:imageId/tags', () => {
    it('委托 removeImageTags', async () => {
      mockRemoveImageTags.mockResolvedValue({ success: true });
      const route = findRoute(routes, '/api/v1/images/:imageId/tags', 'DELETE');

      await expect(route.handler(context({ params: { imageId: '5' }, body: { names: ['cat'] } })))
        .resolves.toEqual({ updated: true });
      expect(mockRemoveImageTags).toHaveBeenCalledWith(5, ['cat']);
    });

    it('missing → 404', async () => {
      mockRemoveImageTags.mockResolvedValue({ success: false, missing: true, error: 'Image not found' });
      const route = findRoute(routes, '/api/v1/images/:imageId/tags', 'DELETE');

      await expect(route.handler(context({ params: { imageId: '5' }, body: { names: ['cat'] } })))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    it('names 非法 → 422', async () => {
      const route = findRoute(routes, '/api/v1/images/:imageId/tags', 'DELETE');

      await expect(route.handler(context({ params: { imageId: '5' }, body: { names: [] } })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      expect(mockRemoveImageTags).not.toHaveBeenCalled();
    });
  });
});
