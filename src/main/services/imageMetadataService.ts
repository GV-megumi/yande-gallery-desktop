import sharp from 'sharp';
import { cacheImage, getCachedImagePath } from './imageCacheService.js';

export interface ImageMetadataRequest {
  localPath?: string;
  fileUrl?: string;
  md5?: string;
  fileExt?: string;
}

export interface ImageMetadataResult {
  format?: string;
  width?: number;
  height?: number;
  space?: string;
  density?: number;
  hasAlpha?: boolean;
  orientation?: number;
  channels?: number;
  hasExif: boolean;
  pathSource: 'local' | 'cache';
}

async function resolveMetadataPath(request: ImageMetadataRequest): Promise<{ filePath: string; pathSource: 'local' | 'cache' }> {
  if (request.localPath) {
    return { filePath: request.localPath, pathSource: 'local' };
  }

  if (!request.fileUrl || !request.md5 || !request.fileExt) {
    throw new Error('缺少图片元数据来源');
  }

  const cachedPath = await getCachedImagePath(request.md5, request.fileExt);
  if (cachedPath) {
    return { filePath: cachedPath, pathSource: 'cache' };
  }

  const downloadedPath = await cacheImage(request.fileUrl, request.md5, request.fileExt);
  return { filePath: downloadedPath, pathSource: 'cache' };
}

export async function getImageMetadata(request: ImageMetadataRequest): Promise<ImageMetadataResult> {
  const { filePath, pathSource } = await resolveMetadataPath(request);
  const metadata = await sharp(filePath).metadata();

  return {
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    space: metadata.space,
    density: metadata.density,
    hasAlpha: metadata.hasAlpha,
    orientation: metadata.orientation,
    channels: metadata.channels,
    hasExif: Boolean(metadata.exif),
    pathSource,
  };
}
