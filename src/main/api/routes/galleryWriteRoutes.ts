import type { ApiRequestContext, ApiRoute } from '../types.js';
import { ApiHttpError } from '../types.js';
import { numberParam, readJsonBody } from '../router.js';
import {
  addImageTags, deleteImage, getImageById, removeImageTags,
} from '../../services/imageService.js';

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

export function createGalleryWriteRoutes(): ApiRoute[] {
  return [
    {
      method: 'DELETE',
      pattern: '/api/v1/images/:imageId',
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
      pattern: '/api/v1/images/batch-delete',
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
      pattern: '/api/v1/images/:imageId/tags',
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
      pattern: '/api/v1/images/:imageId/tags',
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
  ];
}
