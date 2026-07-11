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
import {
  addImagesToGallery,
  createEmptyGallery,
  deleteGallery,
  getGallery,
  removeImagesFromGallery,
  setGalleryCover,
  updateGallery,
} from '../../../src/main/services/galleryService.js';
import type { Image } from '../../../src/shared/types.js';
import type { Gallery } from '../../../src/main/services/galleryService.js';

vi.mock('../../../src/main/services/imageService.js', () => ({
  getImageById: vi.fn(),
  deleteImage: vi.fn(),
  addImageTags: vi.fn(),
  removeImageTags: vi.fn(),
}));

vi.mock('../../../src/main/services/galleryService.js', () => ({
  getGallery: vi.fn(),
  updateGallery: vi.fn(),
  deleteGallery: vi.fn(),
  createEmptyGallery: vi.fn(),
  addImagesToGallery: vi.fn(),
  removeImagesFromGallery: vi.fn(),
  setGalleryCover: vi.fn(),
}));

const mockGetImageById = vi.mocked(getImageById);
const mockDeleteImage = vi.mocked(deleteImage);
const mockAddImageTags = vi.mocked(addImageTags);
const mockRemoveImageTags = vi.mocked(removeImageTags);
const mockGetGallery = vi.mocked(getGallery);
const mockUpdateGallery = vi.mocked(updateGallery);
const mockDeleteGallery = vi.mocked(deleteGallery);
const mockCreateEmptyGallery = vi.mocked(createEmptyGallery);
const mockAddImagesToGallery = vi.mocked(addImagesToGallery);
const mockRemoveImagesFromGallery = vi.mocked(removeImagesFromGallery);
const mockSetGalleryCover = vi.mocked(setGalleryCover);

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

function gallery(overrides: Partial<Gallery> = {}): Gallery {
  return {
    id: 7,
    name: '相册',
    imageCount: 0,
    autoScan: true,
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
      const route = findRoute(routes, '/api/app/v1/images/:imageId', 'DELETE');

      await expect(route.handler(context({ params: { imageId: '5' } }))).resolves.toEqual({ removed: true });

      expect(mockGetImageById).toHaveBeenCalledWith(5);
      expect(mockDeleteImage).toHaveBeenCalledWith(5);
    });

    it('不存在 → 404 且不调 deleteImage', async () => {
      mockGetImageById.mockResolvedValue({ success: false, error: 'Image not found' });
      const route = findRoute(routes, '/api/app/v1/images/:imageId', 'DELETE');

      await expect(route.handler(context({ params: { imageId: '5' } })))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
      expect(mockDeleteImage).not.toHaveBeenCalled();
    });

    it('deleteImage 失败 → 500', async () => {
      mockGetImageById.mockResolvedValue({ success: true, data: image({ id: 5 }) });
      mockDeleteImage.mockResolvedValue({ success: false, error: 'disk error' });
      const route = findRoute(routes, '/api/app/v1/images/:imageId', 'DELETE');

      await expect(route.handler(context({ params: { imageId: '5' } })))
        .rejects.toMatchObject({ statusCode: 500, code: 'INTERNAL_ERROR' });
    });

    it('非法 imageId → 422', async () => {
      const route = findRoute(routes, '/api/app/v1/images/:imageId', 'DELETE');

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
      const route = findRoute(routes, '/api/app/v1/images/batch-delete', 'POST');

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
      const route = findRoute(routes, '/api/app/v1/images/batch-delete', 'POST');

      await expect(route.handler(context({ body: { imageIds: [] } })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      expect(mockGetImageById).not.toHaveBeenCalled();
    });

    it('非法元素（非整数/非正数）→ 422', async () => {
      const route = findRoute(routes, '/api/app/v1/images/batch-delete', 'POST');

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
      const route = findRoute(routes, '/api/app/v1/images/batch-delete', 'POST');

      await expect(route.handler(context({ body: {} })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    });
  });

  describe('POST /images/:imageId/tags', () => {
    it('委托 addImageTags', async () => {
      mockAddImageTags.mockResolvedValue({ success: true });
      const route = findRoute(routes, '/api/app/v1/images/:imageId/tags', 'POST');

      await expect(route.handler(context({ params: { imageId: '5' }, body: { names: ['cat', 'cute'] } })))
        .resolves.toEqual({ updated: true });
      expect(mockAddImageTags).toHaveBeenCalledWith(5, ['cat', 'cute']);
    });

    it('missing → 404', async () => {
      mockAddImageTags.mockResolvedValue({ success: false, missing: true, error: 'Image not found' });
      const route = findRoute(routes, '/api/app/v1/images/:imageId/tags', 'POST');

      await expect(route.handler(context({ params: { imageId: '5' }, body: { names: ['cat'] } })))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    it('service 失败（非 missing）→ 500', async () => {
      mockAddImageTags.mockResolvedValue({ success: false, error: 'db error' });
      const route = findRoute(routes, '/api/app/v1/images/:imageId/tags', 'POST');

      await expect(route.handler(context({ params: { imageId: '5' }, body: { names: ['cat'] } })))
        .rejects.toMatchObject({ statusCode: 500, code: 'INTERNAL_ERROR' });
    });

    it('names 非法（空数组/非字符串/空白串）→ 422', async () => {
      const route = findRoute(routes, '/api/app/v1/images/:imageId/tags', 'POST');

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
      const route = findRoute(routes, '/api/app/v1/images/:imageId/tags', 'DELETE');

      await expect(route.handler(context({ params: { imageId: '5' }, body: { names: ['cat'] } })))
        .resolves.toEqual({ updated: true });
      expect(mockRemoveImageTags).toHaveBeenCalledWith(5, ['cat']);
    });

    it('missing → 404', async () => {
      mockRemoveImageTags.mockResolvedValue({ success: false, missing: true, error: 'Image not found' });
      const route = findRoute(routes, '/api/app/v1/images/:imageId/tags', 'DELETE');

      await expect(route.handler(context({ params: { imageId: '5' }, body: { names: ['cat'] } })))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    it('names 非法 → 422', async () => {
      const route = findRoute(routes, '/api/app/v1/images/:imageId/tags', 'DELETE');

      await expect(route.handler(context({ params: { imageId: '5' }, body: { names: [] } })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      expect(mockRemoveImageTags).not.toHaveBeenCalled();
    });
  });

  describe('POST /galleries', () => {
    it('建空相册', async () => {
      mockCreateEmptyGallery.mockResolvedValue({ success: true, data: 7 });
      const route = findRoute(routes, '/api/app/v1/galleries', 'POST');

      await expect(route.handler(context({ body: { name: '新相册' } }))).resolves.toEqual({ id: 7 });
      expect(mockCreateEmptyGallery).toHaveBeenCalledWith('新相册');
    });

    it('空名/纯空白 → 422', async () => {
      const route = findRoute(routes, '/api/app/v1/galleries', 'POST');

      await expect(route.handler(context({ body: { name: '  ' } })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      await expect(route.handler(context({ body: {} })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      expect(mockCreateEmptyGallery).not.toHaveBeenCalled();
    });

    it('service 失败 → 500', async () => {
      mockCreateEmptyGallery.mockResolvedValue({ success: false, error: 'db error' });
      const route = findRoute(routes, '/api/app/v1/galleries', 'POST');

      await expect(route.handler(context({ body: { name: '新相册' } })))
        .rejects.toMatchObject({ statusCode: 500, code: 'INTERNAL_ERROR' });
    });
  });

  describe('PATCH /galleries/:galleryId', () => {
    it('预检后重命名', async () => {
      mockGetGallery.mockResolvedValue({ success: true, data: gallery({ id: 3 }) });
      mockUpdateGallery.mockResolvedValue({ success: true });
      const route = findRoute(routes, '/api/app/v1/galleries/:galleryId', 'PATCH');

      await expect(route.handler(context({ params: { galleryId: '3' }, body: { name: '改名' } })))
        .resolves.toEqual({ updated: true });
      expect(mockGetGallery).toHaveBeenCalledWith(3);
      expect(mockUpdateGallery).toHaveBeenCalledWith(3, { name: '改名' });
    });

    it('缺失 → 404 且不调 updateGallery', async () => {
      mockGetGallery.mockResolvedValue({ success: false, error: 'Gallery not found' });
      const route = findRoute(routes, '/api/app/v1/galleries/:galleryId', 'PATCH');

      await expect(route.handler(context({ params: { galleryId: '3' }, body: { name: '改名' } })))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
      expect(mockUpdateGallery).not.toHaveBeenCalled();
    });

    it('name 非法（空/纯空白）→ 422，且不预检', async () => {
      const route = findRoute(routes, '/api/app/v1/galleries/:galleryId', 'PATCH');

      await expect(route.handler(context({ params: { galleryId: '3' }, body: { name: '   ' } })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      expect(mockGetGallery).not.toHaveBeenCalled();
    });

    it('updateGallery 失败 → 500', async () => {
      mockGetGallery.mockResolvedValue({ success: true, data: gallery({ id: 3 }) });
      mockUpdateGallery.mockResolvedValue({ success: false, error: 'db error' });
      const route = findRoute(routes, '/api/app/v1/galleries/:galleryId', 'PATCH');

      await expect(route.handler(context({ params: { galleryId: '3' }, body: { name: '改名' } })))
        .rejects.toMatchObject({ statusCode: 500, code: 'INTERNAL_ERROR' });
    });
  });

  describe('PATCH /galleries/:galleryId（v0.6 扩展 coverImageId）', () => {
    it('仅 name：行为不变', async () => {
      mockGetGallery.mockResolvedValue({ success: true, data: gallery() });
      mockUpdateGallery.mockResolvedValue({ success: true });
      const route = findRoute(routes, '/api/app/v1/galleries/:galleryId', 'PATCH');
      await expect(route.handler(context({ params: { galleryId: '7' }, body: { name: ' 新名 ' } })))
        .resolves.toEqual({ updated: true });
      expect(mockUpdateGallery).toHaveBeenCalledWith(7, { name: '新名' });
      expect(mockSetGalleryCover).not.toHaveBeenCalled();
    });

    it('仅 coverImageId：委托 setGalleryCover，不调 updateGallery', async () => {
      mockGetGallery.mockResolvedValue({ success: true, data: gallery() });
      mockSetGalleryCover.mockResolvedValue({ success: true });
      const route = findRoute(routes, '/api/app/v1/galleries/:galleryId', 'PATCH');
      await expect(route.handler(context({ params: { galleryId: '7' }, body: { coverImageId: 10 } })))
        .resolves.toEqual({ updated: true });
      expect(mockSetGalleryCover).toHaveBeenCalledWith(7, 10);
      expect(mockUpdateGallery).not.toHaveBeenCalled();
    });

    it('name 与 coverImageId 同传：两者都生效', async () => {
      mockGetGallery.mockResolvedValue({ success: true, data: gallery() });
      mockUpdateGallery.mockResolvedValue({ success: true });
      mockSetGalleryCover.mockResolvedValue({ success: true });
      const route = findRoute(routes, '/api/app/v1/galleries/:galleryId', 'PATCH');
      await expect(route.handler(context({ params: { galleryId: '7' }, body: { name: 'n', coverImageId: 10 } })))
        .resolves.toEqual({ updated: true });
      expect(mockUpdateGallery).toHaveBeenCalledWith(7, { name: 'n' });
      expect(mockSetGalleryCover).toHaveBeenCalledWith(7, 10);
    });

    it('coverImageId: null → 清除封面', async () => {
      mockGetGallery.mockResolvedValue({ success: true, data: gallery() });
      mockSetGalleryCover.mockResolvedValue({ success: true });
      const route = findRoute(routes, '/api/app/v1/galleries/:galleryId', 'PATCH');
      await expect(route.handler(context({ params: { galleryId: '7' }, body: { coverImageId: null } })))
        .resolves.toEqual({ updated: true });
      expect(mockSetGalleryCover).toHaveBeenCalledWith(7, null);
    });

    it('两者都缺 → 422', async () => {
      const route = findRoute(routes, '/api/app/v1/galleries/:galleryId', 'PATCH');
      await expect(route.handler(context({ params: { galleryId: '7' }, body: {} })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    });

    it('coverImageId 非法（0/负数/小数/字符串）→ 422', async () => {
      const route = findRoute(routes, '/api/app/v1/galleries/:galleryId', 'PATCH');
      for (const bad of [0, -1, 1.5, 'x']) {
        await expect(route.handler(context({ params: { galleryId: '7' }, body: { coverImageId: bad } })))
          .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      }
    });

    it('setGalleryCover 校验失败（非成员/不存在）→ 422', async () => {
      mockGetGallery.mockResolvedValue({ success: true, data: gallery() });
      mockSetGalleryCover.mockResolvedValue({ success: false, error: 'Cover image not in gallery' });
      const route = findRoute(routes, '/api/app/v1/galleries/:galleryId', 'PATCH');
      await expect(route.handler(context({ params: { galleryId: '7' }, body: { coverImageId: 20 } })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    });

    it('相册不存在 → 404（预检语义不变）', async () => {
      mockGetGallery.mockResolvedValue({ success: false, error: 'not found' });
      const route = findRoute(routes, '/api/app/v1/galleries/:galleryId', 'PATCH');
      await expect(route.handler(context({ params: { galleryId: '7' }, body: { coverImageId: 10 } })))
        .rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('DELETE /galleries/:galleryId', () => {
    it('Gallery not found → 404', async () => {
      mockDeleteGallery.mockResolvedValue({ success: false, error: 'Gallery not found' });
      const route = findRoute(routes, '/api/app/v1/galleries/:galleryId', 'DELETE');

      await expect(route.handler(context({ params: { galleryId: '9' } })))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    it('成功 → { removed: true }', async () => {
      mockDeleteGallery.mockResolvedValue({ success: true });
      const route = findRoute(routes, '/api/app/v1/galleries/:galleryId', 'DELETE');

      await expect(route.handler(context({ params: { galleryId: '9' } }))).resolves.toEqual({ removed: true });
      expect(mockDeleteGallery).toHaveBeenCalledWith(9);
    });

    it('其他 service 失败 → 500', async () => {
      mockDeleteGallery.mockResolvedValue({ success: false, error: 'disk error' });
      const route = findRoute(routes, '/api/app/v1/galleries/:galleryId', 'DELETE');

      await expect(route.handler(context({ params: { galleryId: '9' } })))
        .rejects.toMatchObject({ statusCode: 500, code: 'INTERNAL_ERROR' });
    });
  });

  describe('POST /galleries/:galleryId/images', () => {
    it('委托 addImagesToGallery', async () => {
      mockAddImagesToGallery.mockResolvedValue({ success: true, data: { added: 2, missingImageIds: [] } });
      const route = findRoute(routes, '/api/app/v1/galleries/:galleryId/images', 'POST');

      await expect(route.handler(context({ params: { galleryId: '3' }, body: { imageIds: [1, 2] } })))
        .resolves.toEqual({ added: 2, missingImageIds: [] });
      expect(mockAddImagesToGallery).toHaveBeenCalledWith(3, [1, 2]);
    });

    it('Gallery not found → 404', async () => {
      mockAddImagesToGallery.mockResolvedValue({ success: false, error: 'Gallery not found' });
      const route = findRoute(routes, '/api/app/v1/galleries/:galleryId/images', 'POST');

      await expect(route.handler(context({ params: { galleryId: '3' }, body: { imageIds: [1] } })))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    it('imageIds 非法 → 422', async () => {
      const route = findRoute(routes, '/api/app/v1/galleries/:galleryId/images', 'POST');

      await expect(route.handler(context({ params: { galleryId: '3' }, body: { imageIds: [] } })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      await expect(route.handler(context({ params: { galleryId: '3' }, body: { imageIds: [1, -1] } })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      expect(mockAddImagesToGallery).not.toHaveBeenCalled();
    });

    it('其他 service 失败 → 500', async () => {
      mockAddImagesToGallery.mockResolvedValue({ success: false, error: 'db error' });
      const route = findRoute(routes, '/api/app/v1/galleries/:galleryId/images', 'POST');

      await expect(route.handler(context({ params: { galleryId: '3' }, body: { imageIds: [1] } })))
        .rejects.toMatchObject({ statusCode: 500, code: 'INTERNAL_ERROR' });
    });
  });

  describe('DELETE /galleries/:galleryId/images', () => {
    it('委托 removeImagesFromGallery', async () => {
      mockRemoveImagesFromGallery.mockResolvedValue({ success: true, data: { removed: 2 } });
      const route = findRoute(routes, '/api/app/v1/galleries/:galleryId/images', 'DELETE');

      await expect(route.handler(context({ params: { galleryId: '3' }, body: { imageIds: [1, 2] } })))
        .resolves.toEqual({ removed: 2 });
      expect(mockRemoveImagesFromGallery).toHaveBeenCalledWith(3, [1, 2]);
    });

    it('Gallery not found → 404', async () => {
      mockRemoveImagesFromGallery.mockResolvedValue({ success: false, error: 'Gallery not found' });
      const route = findRoute(routes, '/api/app/v1/galleries/:galleryId/images', 'DELETE');

      await expect(route.handler(context({ params: { galleryId: '3' }, body: { imageIds: [1] } })))
        .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    it('imageIds 非法 → 422', async () => {
      const route = findRoute(routes, '/api/app/v1/galleries/:galleryId/images', 'DELETE');

      await expect(route.handler(context({ params: { galleryId: '3' }, body: { imageIds: [] } })))
        .rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      expect(mockRemoveImagesFromGallery).not.toHaveBeenCalled();
    });
  });
});
