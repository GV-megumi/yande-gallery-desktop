import type { ApiRequestContext, ApiRoute } from '../types.js';
import { ApiHttpError } from '../types.js';
import { numberParam, readJsonBody } from '../router.js';
import {
  addImageTags, deleteImage, getImageById, removeImageTags,
} from '../../services/imageService.js';
import {
  addImagesToGallery,
  createEmptyGallery,
  deleteGallery,
  getGallery,
  removeImagesFromGallery,
  setGalleryCover,
  updateGallery,
} from '../../services/galleryService.js';

type JsonObject = Record<string, unknown>;

function validationError(message: string): never {
  throw new ApiHttpError(422, 'VALIDATION_ERROR', message);
}

async function jsonObject(context: ApiRequestContext): Promise<JsonObject> {
  const body = await readJsonBody(context.req);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    validationError('Request body must be an object');
  }
  return body as JsonObject;
}

function stringArrayField(body: JsonObject, field: string): string[] {
  const value = body[field];
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !item.trim())) {
    validationError(`${field} must be a non-empty string array`);
  }
  return value as string[];
}

function idArrayField(body: JsonObject, field: string): number[] {
  const value = body[field];
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => !Number.isInteger(item) || (item as number) <= 0)) {
    validationError(`${field} must be a non-empty positive integer array`);
  }
  return value as number[];
}

function notFound(): never {
  throw new ApiHttpError(404, 'NOT_FOUND', 'Resource not found');
}

async function requireImage(imageId: number): Promise<void> {
  const result = await getImageById(imageId);
  if (!result.success || !result.data) {
    notFound();
  }
}

/**
 * 图片/图集写路由九端点（安卓相册 spec §5.4/§6.1），整组挂手机面 /api/app/v1，
 * 整面受『允许手机端连接』一门制（spec §3.1），无细化权限。
 */
export function createGalleryWriteRoutes(): ApiRoute[] {
  return [
    {
      method: 'DELETE',
      pattern: '/api/app/v1/images/:imageId',
      handler: async (context) => {
        const imageId = numberParam(context.params.imageId, 'imageId');
        // deleteImage 对缺失 id 静默成功，404 语义由预检提供（spec §5.4）
        await requireImage(imageId);
        const result = await deleteImage(imageId);
        if (!result.success) {
          throw new ApiHttpError(500, 'INTERNAL_ERROR', result.error || 'Failed to delete image');
        }
        return { removed: true };
      },
    },
    {
      method: 'POST',
      pattern: '/api/app/v1/images/batch-delete',
      handler: async (context) => {
        const body = await jsonObject(context);
        const imageIds = idArrayField(body, 'imageIds');
        const results: Array<{ imageId: number; success: boolean; error?: string }> = [];
        for (const imageId of imageIds) {
          const existing = await getImageById(imageId);
          if (!existing.success || !existing.data) {
            results.push({ imageId, success: false, error: 'NOT_FOUND' });
            continue;
          }
          const result = await deleteImage(imageId);
          results.push(result.success
            ? { imageId, success: true }
            : { imageId, success: false, error: result.error || 'Failed to delete image' });
        }
        return { results };
      },
    },
    {
      method: 'POST',
      pattern: '/api/app/v1/images/:imageId/tags',
      handler: async (context) => {
        const imageId = numberParam(context.params.imageId, 'imageId');
        const names = stringArrayField(await jsonObject(context), 'names');
        const result = await addImageTags(imageId, names);
        if (result.missing) {
          notFound();
        }
        if (!result.success) {
          throw new ApiHttpError(500, 'INTERNAL_ERROR', result.error || 'Failed to add tags');
        }
        return { updated: true };
      },
    },
    {
      method: 'DELETE',
      pattern: '/api/app/v1/images/:imageId/tags',
      handler: async (context) => {
        const imageId = numberParam(context.params.imageId, 'imageId');
        const names = stringArrayField(await jsonObject(context), 'names');
        const result = await removeImageTags(imageId, names);
        if (result.missing) {
          notFound();
        }
        if (!result.success) {
          throw new ApiHttpError(500, 'INTERNAL_ERROR', result.error || 'Failed to remove tags');
        }
        return { updated: true };
      },
    },
    {
      method: 'POST',
      pattern: '/api/app/v1/galleries',
      handler: async (context) => {
        const body = await jsonObject(context);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) {
          validationError('name is required');
        }
        const result = await createEmptyGallery(name);
        if (!result.success || result.data === undefined) {
          throw new ApiHttpError(500, 'INTERNAL_ERROR', result.error || 'Failed to create gallery');
        }
        return { id: result.data };
      },
    },
    {
      method: 'PATCH',
      pattern: '/api/app/v1/galleries/:galleryId',
      handler: async (context) => {
        const galleryId = numberParam(context.params.galleryId, 'galleryId');
        const body = await jsonObject(context);
        // v0.6（安卓 spec §6.1）：body 接受 { name?, coverImageId?: number|null }，至少一项
        const hasName = body.name !== undefined;
        const hasCover = 'coverImageId' in body;
        if (!hasName && !hasCover) {
          validationError('name or coverImageId is required');
        }
        let name = '';
        if (hasName) {
          name = typeof body.name === 'string' ? body.name.trim() : '';
          if (!name) {
            validationError('name must be a non-empty string');
          }
        }
        let coverImageId: number | null = null;
        if (hasCover) {
          const value = body.coverImageId;
          if (value !== null && (!Number.isInteger(value) || (value as number) <= 0)) {
            validationError('coverImageId must be a positive integer or null');
          }
          coverImageId = value as number | null;
        }
        // updateGallery/setGalleryCover 对缺失 id 静默成功，404 语义由预检提供
        const existing = await getGallery(galleryId);
        if (!existing.success || !existing.data) {
          notFound();
        }
        // 语义说明（终审 Minor#1）：name 与 coverImageId 同传时先改名后设封面，封面校验失败
        // 返回 422 但改名已持久化（非原子部分生效）。自家安卓端恒单字段提交，不为此引入事务。
        if (hasName) {
          const result = await updateGallery(galleryId, { name });
          if (!result.success) {
            throw new ApiHttpError(500, 'INTERNAL_ERROR', result.error || 'Failed to rename gallery');
          }
        }
        if (hasCover) {
          const result = await setGalleryCover(galleryId, coverImageId);
          if (!result.success) {
            // 存在性/成员校验失败按 422（仓内 validationError 惯例；spec §6.1）
            if (result.error === 'Cover image not found' || result.error === 'Cover image not in gallery') {
              validationError(result.error);
            }
            throw new ApiHttpError(500, 'INTERNAL_ERROR', result.error || 'Failed to set gallery cover');
          }
        }
        return { updated: true };
      },
    },
    {
      method: 'DELETE',
      pattern: '/api/app/v1/galleries/:galleryId',
      handler: async (context) => {
        const galleryId = numberParam(context.params.galleryId, 'galleryId');
        const result = await deleteGallery(galleryId);
        if (!result.success) {
          if (result.error === 'Gallery not found') {
            notFound();
          }
          throw new ApiHttpError(500, 'INTERNAL_ERROR', result.error || 'Failed to delete gallery');
        }
        return { removed: true };
      },
    },
    {
      method: 'POST',
      pattern: '/api/app/v1/galleries/:galleryId/images',
      handler: async (context) => {
        const galleryId = numberParam(context.params.galleryId, 'galleryId');
        const imageIds = idArrayField(await jsonObject(context), 'imageIds');
        const result = await addImagesToGallery(galleryId, imageIds);
        if (!result.success || !result.data) {
          if (result.error === 'Gallery not found') {
            notFound();
          }
          throw new ApiHttpError(500, 'INTERNAL_ERROR', result.error || 'Failed to add images to gallery');
        }
        return result.data;
      },
    },
    {
      method: 'DELETE',
      pattern: '/api/app/v1/galleries/:galleryId/images',
      handler: async (context) => {
        const galleryId = numberParam(context.params.galleryId, 'galleryId');
        const imageIds = idArrayField(await jsonObject(context), 'imageIds');
        const result = await removeImagesFromGallery(galleryId, imageIds);
        if (!result.success || !result.data) {
          if (result.error === 'Gallery not found') {
            notFound();
          }
          throw new ApiHttpError(500, 'INTERNAL_ERROR', result.error || 'Failed to remove images from gallery');
        }
        return result.data;
      },
    },
  ];
}
