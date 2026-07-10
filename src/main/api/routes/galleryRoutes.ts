/**
 * 图库读取路由，按命名空间归属分两组导出（spec §3.1/§3.2）：
 * - createGalleryRoutes：agent 面 /api/v1 只读独占（galleryRead/imageRead 细化权限）；
 * - createImageBinaryRoutes：两面共享——agent 面直挂（imageBinary 权限），手机面经 remapToAppNamespace 克隆。
 */
import { getGalleries, getGallery } from '../../services/galleryService.js';
import { getImageById, getImages, getImagesByGallery } from '../../services/imageService.js';
import { generatePreview, generateThumbnail } from '../../services/thumbnailService.js';
import { serveBinaryFile } from '../binaryResponse.js';
import { numberParam, optionalNumberQuery } from '../router.js';
import { ApiHttpError, type ApiRequestContext, type ApiRoute } from '../types.js';

const MAX_PAGE_SIZE = 200;

interface ServiceResult<T> {
  success: boolean;
  data?: T;
  total?: number;
  error?: string;
  missing?: boolean;
}

function isNotFoundResult(result: ServiceResult<unknown>): boolean {
  return result.missing === true
    || result.error === 'Gallery not found'
    || result.error === 'Image not found';
}

function unwrapServiceResult<T>(result: ServiceResult<T>, fallbackMessage = 'Service request failed'): T {
  if (result.success && result.data !== undefined) {
    return result.data;
  }

  if (isNotFoundResult(result)) {
    throw new ApiHttpError(404, 'NOT_FOUND', 'Resource not found');
  }

  throw new ApiHttpError(500, 'INTERNAL_ERROR', fallbackMessage);
}

function unwrapPagedServiceResult<T>(
  result: ServiceResult<T[]>,
  fallbackMessage = 'Service request failed',
): { data: T[]; total?: number } {
  const data = unwrapServiceResult(result, fallbackMessage);

  return result.total === undefined ? { data } : { data, total: result.total };
}

function pageQuery(context: ApiRequestContext): { page: number; pageSize: number } {
  const pageSize = optionalNumberQuery(context.query, 'pageSize', 50);
  if (pageSize > MAX_PAGE_SIZE) {
    throw new ApiHttpError(422, 'VALIDATION_ERROR', `pageSize must be <= ${MAX_PAGE_SIZE}`);
  }

  return {
    page: optionalNumberQuery(context.query, 'page', 1),
    pageSize,
  };
}

/** 图集/图片元数据只读五端点：仅挂 agent 面 /api/v1（galleryRead/imageRead 细化权限，spec §3.2）。 */
export function createGalleryRoutes(): ApiRoute[] {
  return [
    {
      method: 'GET',
      pattern: '/api/v1/galleries',
      handler: async () => unwrapServiceResult(await getGalleries(), 'Failed to load galleries'),
    },
    {
      method: 'GET',
      pattern: '/api/v1/galleries/:galleryId',
      handler: async (context) => {
        const galleryId = numberParam(context.params.galleryId, 'galleryId');
        return unwrapServiceResult(await getGallery(galleryId), 'Failed to load gallery');
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/galleries/:galleryId/images',
      handler: async (context) => {
        const galleryId = numberParam(context.params.galleryId, 'galleryId');
        const { page, pageSize } = pageQuery(context);
        // 保留 gallery-not-found 检查（不存在时映射为 404）
        unwrapServiceResult(await getGallery(galleryId), 'Failed to load gallery');

        // 成员读取（Phase 2B）：按 galleryId 显式取 gallery_images 成员，
        // 不再用 gallery.folderPath 做前缀匹配
        return unwrapPagedServiceResult(
          await getImagesByGallery(galleryId, page, pageSize),
          'Failed to load gallery images',
        );
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/images',
      handler: async (context) => {
        const { page, pageSize } = pageQuery(context);
        return unwrapServiceResult(await getImages(page, pageSize), 'Failed to load images');
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/images/:imageId',
      handler: async (context) => {
        const imageId = numberParam(context.params.imageId, 'imageId');
        return unwrapServiceResult(await getImageById(imageId), 'Failed to load image');
      },
    },
  ];
}

/** 图片二进制三端点：agent 面（imageBinary 权限）与手机面（remap 共享 handler）都挂（spec §3.1）。 */
export function createImageBinaryRoutes(): ApiRoute[] {
  return [
    {
      method: 'GET',
      pattern: '/api/v1/images/:imageId/thumbnail',
      handler: async (context) => {
        const imageId = numberParam(context.params.imageId, 'imageId');
        const image = unwrapServiceResult(await getImageById(imageId), 'Failed to load image');
        const thumbnailPath = unwrapServiceResult(
          await generateThumbnail(image.filepath),
          'Failed to generate thumbnail',
        );

        return serveBinaryFile(context, thumbnailPath, 'Failed to stream thumbnail');
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/images/:imageId/preview',
      handler: async (context) => {
        const imageId = numberParam(context.params.imageId, 'imageId');
        const image = unwrapServiceResult(await getImageById(imageId), 'Failed to load image');
        const previewPath = unwrapServiceResult(
          await generatePreview(image.filepath),
          'Failed to generate preview',
        );

        return serveBinaryFile(context, previewPath, 'Failed to stream preview');
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/images/:imageId/file',
      handler: async (context) => {
        const imageId = numberParam(context.params.imageId, 'imageId');
        const image = unwrapServiceResult(await getImageById(imageId), 'Failed to load image');

        return serveBinaryFile(context, image.filepath, 'Failed to stream file');
      },
    },
  ];
}
