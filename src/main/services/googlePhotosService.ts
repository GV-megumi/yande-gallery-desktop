/**
 * Google Photos 服务
 * 封装 Google Photos Library API，提供浏览和上传功能
 *
 * 权限限制：
 *   - 只读浏览已有照片和相册
 *   - 可上传新照片到相册
 *   - 不能删除、修改已有照片
 *   - baseUrl 有效期约 60 分钟
 */

import axios from 'axios';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { getAccessToken } from './googleAuthService.js';
import { getConfig, getProxyConfig } from './config.js';

// ============= 类型定义 =============

export interface GPhotosAlbum {
  id: string;
  title: string;
  productUrl: string;
  mediaItemsCount: number;
  coverPhotoBaseUrl: string;
  coverPhotoMediaItemId: string;
}

export interface GPhotosMediaItem {
  id: string;
  productUrl: string;
  baseUrl: string;
  mimeType: string;
  filename: string;
  mediaMetadata: {
    creationTime: string;
    width: string;
    height: string;
    photo?: {
      cameraMake?: string;
      cameraModel?: string;
      focalLength?: number;
      apertureFNumber?: number;
      isoEquivalent?: number;
    };
  };
}

export interface GPhotosListResult {
  items: GPhotosMediaItem[];
  nextPageToken?: string;
}

export interface GPhotosAlbumListResult {
  albums: GPhotosAlbum[];
  nextPageToken?: string;
}

export interface GPhotosSearchFilters {
  dateRange?: {
    startDate: { year: number; month: number; day: number };
    endDate: { year: number; month: number; day: number };
  };
  mediaType?: 'PHOTO' | 'VIDEO' | 'ALL_MEDIA';
  contentCategory?: string[];
}

// ============= 常量 =============

const PHOTOS_API_BASE = 'https://photoslibrary.googleapis.com/v1';

// ============= 内部工具 =============

/**
 * 创建带认证的请求头
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return {
    Authorization: `Bearer ${token}`,
  };
}

/**
 * 将 API 返回的 mediaItem 转为标准格式
 */
function parseMediaItem(item: any): GPhotosMediaItem {
  return {
    id: item.id,
    productUrl: item.productUrl || '',
    baseUrl: item.baseUrl || '',
    mimeType: item.mimeType || '',
    filename: item.filename || '',
    mediaMetadata: {
      creationTime: item.mediaMetadata?.creationTime || '',
      width: item.mediaMetadata?.width || '0',
      height: item.mediaMetadata?.height || '0',
      photo: item.mediaMetadata?.photo,
    },
  };
}

/**
 * 将 API 返回的 album 转为标准格式
 */
function parseAlbum(album: any): GPhotosAlbum {
  return {
    id: album.id,
    title: album.title || '',
    productUrl: album.productUrl || '',
    mediaItemsCount: parseInt(album.mediaItemsCount || '0', 10),
    coverPhotoBaseUrl: album.coverPhotoBaseUrl || '',
    coverPhotoMediaItemId: album.coverPhotoMediaItemId || '',
  };
}

// ============= 公开 API =============

/**
 * 列出所有相册
 */
export async function listAlbums(
  pageSize: number = 50,
  pageToken?: string
): Promise<GPhotosAlbumListResult> {
  const headers = await getAuthHeaders();
  const proxy = getProxyConfig();

  const params: any = { pageSize };
  if (pageToken) params.pageToken = pageToken;

  console.log('[GooglePhotos] listAlbums, pageSize:', pageSize);

  try {
    const response = await axios.get(`${PHOTOS_API_BASE}/albums`, {
      headers,
      params,
      proxy,
    });

    const albums = (response.data.albums || []).map(parseAlbum);
    console.log('[GooglePhotos] listAlbums 返回', albums.length, '个相册');

    return {
      albums,
      nextPageToken: response.data.nextPageToken,
    };
  } catch (error: any) {
    console.error('[GooglePhotos] listAlbums 失败，状态码:', error.response?.status);
    console.error('[GooglePhotos] 错误详情:', JSON.stringify(error.response?.data, null, 2));
    throw error;
  }
}

/**
 * 获取相册内照片
 */
export async function getAlbumPhotos(
  albumId: string,
  pageSize: number = 50,
  pageToken?: string
): Promise<GPhotosListResult> {
  const headers = await getAuthHeaders();
  const proxy = getProxyConfig();

  const body: any = {
    albumId,
    pageSize,
  };
  if (pageToken) body.pageToken = pageToken;

  console.log('[GooglePhotos] getAlbumPhotos, albumId:', albumId);

  const response = await axios.post(
    `${PHOTOS_API_BASE}/mediaItems:search`,
    body,
    { headers, proxy }
  );

  const items = (response.data.mediaItems || []).map(parseMediaItem);
  console.log('[GooglePhotos] getAlbumPhotos 返回', items.length, '张照片');

  return {
    items,
    nextPageToken: response.data.nextPageToken,
  };
}

/**
 * 列出所有照片（不限相册）
 */
export async function listPhotos(
  pageSize: number = 50,
  pageToken?: string
): Promise<GPhotosListResult> {
  const headers = await getAuthHeaders();
  const proxy = getProxyConfig();

  const params: any = { pageSize };
  if (pageToken) params.pageToken = pageToken;

  console.log('[GooglePhotos] listPhotos, pageSize:', pageSize);

  const response = await axios.get(`${PHOTOS_API_BASE}/mediaItems`, {
    headers,
    params,
    proxy,
  });

  const items = (response.data.mediaItems || []).map(parseMediaItem);
  console.log('[GooglePhotos] listPhotos 返回', items.length, '张照片');

  return {
    items,
    nextPageToken: response.data.nextPageToken,
  };
}

/**
 * 按条件搜索照片
 */
export async function searchPhotos(
  filters: GPhotosSearchFilters,
  pageSize: number = 50,
  pageToken?: string
): Promise<GPhotosListResult> {
  const headers = await getAuthHeaders();
  const proxy = getProxyConfig();

  const body: any = { pageSize };
  if (pageToken) body.pageToken = pageToken;

  // 构建 filters
  const apiFilters: any = {};
  if (filters.dateRange) {
    apiFilters.dateFilter = {
      ranges: [{
        startDate: filters.dateRange.startDate,
        endDate: filters.dateRange.endDate,
      }],
    };
  }
  if (filters.mediaType && filters.mediaType !== 'ALL_MEDIA') {
    apiFilters.mediaTypeFilter = {
      mediaTypes: [filters.mediaType],
    };
  }
  if (filters.contentCategory && filters.contentCategory.length > 0) {
    apiFilters.contentFilter = {
      includedContentCategories: filters.contentCategory,
    };
  }

  if (Object.keys(apiFilters).length > 0) {
    body.filters = apiFilters;
  }

  console.log('[GooglePhotos] searchPhotos, filters:', JSON.stringify(filters));

  const response = await axios.post(
    `${PHOTOS_API_BASE}/mediaItems:search`,
    body,
    { headers, proxy }
  );

  const items = (response.data.mediaItems || []).map(parseMediaItem);
  console.log('[GooglePhotos] searchPhotos 返回', items.length, '张照片');

  return {
    items,
    nextPageToken: response.data.nextPageToken,
  };
}

/**
 * 获取单张照片详情
 */
export async function getPhoto(mediaItemId: string): Promise<GPhotosMediaItem> {
  const headers = await getAuthHeaders();
  const proxy = getProxyConfig();

  console.log('[GooglePhotos] getPhoto:', mediaItemId);

  const response = await axios.get(`${PHOTOS_API_BASE}/mediaItems/${mediaItemId}`, {
    headers,
    proxy,
  });

  return parseMediaItem(response.data);
}

/**
 * 下载照片到本地
 * @param mediaItemId 媒体项 ID
 * @param localPath 保存路径（不指定则使用配置的 downloadPath）
 * @returns 保存的文件路径
 */
export async function downloadPhoto(mediaItemId: string, localPath?: string): Promise<string> {
  const proxy = getProxyConfig();

  // 获取照片详情（刷新 baseUrl）
  const photo = await getPhoto(mediaItemId);

  // 确定保存路径
  if (!localPath) {
    const config = getConfig() as any;
    const downloadDir = config.google?.photos?.downloadPath || 'downloads/google-photos';
    await fs.mkdir(downloadDir, { recursive: true });
    localPath = path.join(downloadDir, photo.filename || `${mediaItemId}.jpg`);
  }

  // 确保目录存在
  await fs.mkdir(path.dirname(localPath), { recursive: true });

  // baseUrl + '=d' 表示下载原图
  const downloadUrl = `${photo.baseUrl}=d`;

  console.log('[GooglePhotos] 下载照片:', photo.filename, '→', localPath);

  const response = await axios.get(downloadUrl, {
    responseType: 'stream',
    proxy,
  });

  const writer = fsSync.createWriteStream(localPath);
  await new Promise<void>((resolve, reject) => {
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  console.log('[GooglePhotos] 下载完成:', localPath);
  return localPath;
}

/**
 * 上传照片到 Google Photos（两步上传）
 * Step 1: 上传字节流获取 uploadToken
 * Step 2: 用 uploadToken 创建媒体项（可选指定相册）
 *
 * @param localPath 本地文件路径
 * @param albumId 目标相册 ID（可选）
 * @param description 描述（可选）
 */
export async function uploadPhoto(
  localPath: string,
  albumId?: string,
  description?: string
): Promise<GPhotosMediaItem | null> {
  const headers = await getAuthHeaders();
  const proxy = getProxyConfig();

  const fileName = path.basename(localPath);
  const fileContent = await fs.readFile(localPath);

  // 检测 MIME 类型
  const ext = path.extname(localPath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    '.mp4': 'video/mp4', '.webm': 'video/webm',
  };
  const contentType = mimeMap[ext] || 'application/octet-stream';

  console.log('[GooglePhotos] 上传照片 Step 1:', fileName);

  // Step 1: 上传字节流
  const uploadResponse = await axios.post(
    `${PHOTOS_API_BASE}/uploads`,
    fileContent,
    {
      headers: {
        ...headers,
        'Content-Type': 'application/octet-stream',
        'X-Goog-Upload-Content-Type': contentType,
        'X-Goog-Upload-Protocol': 'raw',
      },
      proxy,
    }
  );

  const uploadToken = uploadResponse.data;
  console.log('[GooglePhotos] 上传照片 Step 2, uploadToken 获取成功');

  // Step 2: 创建媒体项
  const body: any = {
    newMediaItems: [{
      description: description || '',
      simpleMediaItem: {
        uploadToken,
        fileName,
      },
    }],
  };
  if (albumId) {
    body.albumId = albumId;
  }

  const createResponse = await axios.post(
    `${PHOTOS_API_BASE}/mediaItems:batchCreate`,
    body,
    { headers, proxy }
  );

  const results = createResponse.data.newMediaItemResults;
  if (results && results.length > 0 && results[0].status?.message === 'Success') {
    const item = parseMediaItem(results[0].mediaItem);
    console.log('[GooglePhotos] 上传成功:', item.filename, 'ID:', item.id);
    return item;
  }

  console.warn('[GooglePhotos] 上传结果异常:', JSON.stringify(results));
  return null;
}

/**
 * 批量上传照片（每批最多 50 个）
 * @param localPaths 本地文件路径列表
 * @param albumId 目标相册 ID（可选）
 * @param onProgress 进度回调
 * @returns 上传结果列表
 */
export async function batchUploadPhotos(
  localPaths: string[],
  albumId?: string,
  onProgress?: (uploaded: number, total: number) => void
): Promise<{ success: string[]; failed: string[] }> {
  const headers = await getAuthHeaders();
  const proxy = getProxyConfig();

  const success: string[] = [];
  const failed: string[] = [];

  // 每批最多 50 个
  const batchSize = 50;

  for (let i = 0; i < localPaths.length; i += batchSize) {
    const batch = localPaths.slice(i, i + batchSize);
    const uploadTokens: Array<{ token: string; fileName: string; localPath: string }> = [];

    // Step 1: 逐个上传字节流获取 token
    for (const localPath of batch) {
      try {
        const fileName = path.basename(localPath);
        const fileContent = await fs.readFile(localPath);
        const ext = path.extname(localPath).toLowerCase();
        const mimeMap: Record<string, string> = {
          '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
          '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
        };
        const contentType = mimeMap[ext] || 'application/octet-stream';

        const response = await axios.post(
          `${PHOTOS_API_BASE}/uploads`,
          fileContent,
          {
            headers: {
              ...headers,
              'Content-Type': 'application/octet-stream',
              'X-Goog-Upload-Content-Type': contentType,
              'X-Goog-Upload-Protocol': 'raw',
            },
            proxy,
          }
        );

        uploadTokens.push({ token: response.data, fileName, localPath });
      } catch (error) {
        console.error('[GooglePhotos] 上传字节流失败:', localPath, error);
        failed.push(localPath);
      }

      // 更新进度
      onProgress?.(success.length + failed.length + uploadTokens.length, localPaths.length);
    }

    // Step 2: 批量创建媒体项
    if (uploadTokens.length > 0) {
      try {
        const body: any = {
          newMediaItems: uploadTokens.map(({ token, fileName }) => ({
            simpleMediaItem: { uploadToken: token, fileName },
          })),
        };
        if (albumId) {
          body.albumId = albumId;
        }

        const response = await axios.post(
          `${PHOTOS_API_BASE}/mediaItems:batchCreate`,
          body,
          { headers, proxy }
        );

        const results = response.data.newMediaItemResults || [];
        for (let j = 0; j < results.length; j++) {
          if (results[j].status?.message === 'Success') {
            success.push(uploadTokens[j].localPath);
          } else {
            console.warn('[GooglePhotos] 创建媒体项失败:', uploadTokens[j].localPath, results[j].status);
            failed.push(uploadTokens[j].localPath);
          }
        }
      } catch (error) {
        console.error('[GooglePhotos] batchCreate 失败:', error);
        uploadTokens.forEach(t => failed.push(t.localPath));
      }
    }

    onProgress?.(success.length + failed.length, localPaths.length);
  }

  console.log('[GooglePhotos] 批量上传完成, 成功:', success.length, '失败:', failed.length);
  return { success, failed };
}

/**
 * 创建相册
 */
export async function createAlbum(title: string): Promise<GPhotosAlbum> {
  const headers = await getAuthHeaders();
  const proxy = getProxyConfig();

  console.log('[GooglePhotos] 创建相册:', title);

  const response = await axios.post(
    `${PHOTOS_API_BASE}/albums`,
    { album: { title } },
    { headers, proxy }
  );

  const album = parseAlbum(response.data);
  console.log('[GooglePhotos] 相册创建成功, ID:', album.id);
  return album;
}

/**
 * 获取照片缩略图 URL
 * @param baseUrl 照片的 baseUrl
 * @param size 缩略图尺寸（宽高取最大值）
 * @returns 缩略图 URL
 */
export function getPhotoThumbnailUrl(baseUrl: string, size?: number): string {
  const config = getConfig() as any;
  const thumbnailSize = size || config.google?.photos?.thumbnailSize || 512;
  return `${baseUrl}=w${thumbnailSize}-h${thumbnailSize}`;
}

/**
 * 获取照片原图 URL
 */
export function getPhotoOriginalUrl(baseUrl: string): string {
  return `${baseUrl}=d`;
}
