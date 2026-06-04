import { createReadStream } from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { getGalleries, getGallery } from '../../services/galleryService.js';
import { getImageById, getImages, getImagesByFolder } from '../../services/imageService.js';
import { generateThumbnail } from '../../services/thumbnailService.js';
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

function isMissingFileError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function hasStartedResponse(context: ApiRequestContext): boolean {
  return context.res.headersSent === true
    || context.res.writableEnded === true
    || context.res.destroyed === true;
}

function destroyStartedResponse(context: ApiRequestContext, error: unknown): void {
  if (context.res.destroyed === true || typeof context.res.destroy !== 'function') {
    return;
  }

  context.res.destroy(error instanceof Error ? error : undefined);
}

function thumbnailContentType(thumbnailPath: string): string {
  switch (path.extname(thumbnailPath).toLowerCase()) {
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    default:
      return 'application/octet-stream';
  }
}

async function streamFile(
  context: ApiRequestContext,
  filePath: string,
  contentType: string,
  internalMessage: string,
): Promise<undefined> {
  try {
    context.res.setHeader('Content-Type', contentType);
    await pipeline(createReadStream(filePath), context.res);
    return undefined;
  } catch (error) {
    if (hasStartedResponse(context)) {
      destroyStartedResponse(context, error);
      return undefined;
    }

    if (isMissingFileError(error)) {
      throw new ApiHttpError(404, 'NOT_FOUND', 'Resource not found');
    }

    throw new ApiHttpError(500, 'INTERNAL_ERROR', internalMessage);
  }
}

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
        const gallery = unwrapServiceResult(await getGallery(galleryId), 'Failed to load gallery');

        return unwrapPagedServiceResult(
          await getImagesByFolder(gallery.folderPath, page, pageSize),
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

        return streamFile(
          context,
          thumbnailPath,
          thumbnailContentType(thumbnailPath),
          'Failed to stream thumbnail',
        );
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/images/:imageId/file',
      handler: async (context) => {
        const imageId = numberParam(context.params.imageId, 'imageId');
        const image = unwrapServiceResult(await getImageById(imageId), 'Failed to load image');

        return streamFile(context, image.filepath, 'application/octet-stream', 'Failed to stream file');
      },
    },
  ];
}
