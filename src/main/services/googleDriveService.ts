/**
 * Google Drive 服务
 * 封装 Google Drive API v3，提供文件管理功能
 *
 * 功能：列出文件、搜索、上传、下载、删除、创建文件夹、移动、存储空间查询
 */

import axios, { AxiosInstance } from 'axios';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { getAccessToken } from './googleAuthService.js';
import { getConfig, getProxyConfig } from './config.js';

// ============= 类型定义 =============

export interface GDriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdTime: string;
  modifiedTime: string;
  thumbnailLink?: string;
  webViewLink?: string;
  parents?: string[];
  iconLink?: string;
}

export interface GDriveListResult {
  files: GDriveFile[];
  nextPageToken?: string;
}

export interface GDriveStorageQuota {
  totalGB: number;
  usedGB: number;
  trashedGB: number;
}

// ============= 常量 =============

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

// 图片相关 MIME 类型
const IMAGE_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml'
];

// ============= 内部工具 =============

/**
 * 创建带认证的 axios 实例
 */
async function createClient(): Promise<AxiosInstance> {
  const token = await getAccessToken();
  const proxy = getProxyConfig();

  return axios.create({
    baseURL: DRIVE_API_BASE,
    headers: {
      Authorization: `Bearer ${token}`,
    },
    proxy,
  });
}

/**
 * MIME 类型到文件扩展名映射（用于 Drive 中无扩展名的场景）
 */
function mimeToExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
  };
  return map[mimeType] || '';
}

// ============= 公开 API =============

/**
 * 列出文件和文件夹
 * @param folderId 文件夹 ID（'root' 表示根目录）
 * @param pageSize 每页数量
 * @param pageToken 分页 token
 * @param mimeTypeFilter 可选 MIME 类型过滤（如 'image/'）
 */
export async function listFiles(
  folderId: string = 'root',
  pageSize: number = 50,
  pageToken?: string,
  mimeTypeFilter?: string
): Promise<GDriveListResult> {
  const client = await createClient();

  // 构建查询条件
  let query = `'${folderId}' in parents and trashed = false`;
  if (mimeTypeFilter) {
    // 同时列出文件夹和符合条件的文件
    query = `'${folderId}' in parents and trashed = false and (mimeType = 'application/vnd.google-apps.folder' or mimeType contains '${mimeTypeFilter}')`;
  }

  const params: any = {
    q: query,
    pageSize,
    fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, thumbnailLink, webViewLink, parents, iconLink)',
    orderBy: 'folder, modifiedTime desc', // 文件夹在前，然后按修改时间倒序
  };
  if (pageToken) {
    params.pageToken = pageToken;
  }

  console.log('[GoogleDrive] listFiles, folderId:', folderId, 'pageSize:', pageSize);

  const response = await client.get('/files', { params });

  const files: GDriveFile[] = (response.data.files || []).map((f: any) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: parseInt(f.size || '0', 10),
    createdTime: f.createdTime,
    modifiedTime: f.modifiedTime,
    thumbnailLink: f.thumbnailLink,
    webViewLink: f.webViewLink,
    parents: f.parents,
    iconLink: f.iconLink,
  }));

  console.log('[GoogleDrive] listFiles 返回', files.length, '个文件');

  return {
    files,
    nextPageToken: response.data.nextPageToken,
  };
}

/**
 * 搜索文件
 * @param query 搜索关键词（搜索文件名）
 * @param pageSize 每页数量
 * @param pageToken 分页 token
 */
export async function searchFiles(
  query: string,
  pageSize: number = 50,
  pageToken?: string
): Promise<GDriveListResult> {
  const client = await createClient();

  const params: any = {
    q: `name contains '${query.replace(/'/g, "\\'")}' and trashed = false`,
    pageSize,
    fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, thumbnailLink, webViewLink, parents, iconLink)',
    orderBy: 'modifiedTime desc',
  };
  if (pageToken) {
    params.pageToken = pageToken;
  }

  console.log('[GoogleDrive] searchFiles, query:', query);

  const response = await client.get('/files', { params });

  const files: GDriveFile[] = (response.data.files || []).map((f: any) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: parseInt(f.size || '0', 10),
    createdTime: f.createdTime,
    modifiedTime: f.modifiedTime,
    thumbnailLink: f.thumbnailLink,
    webViewLink: f.webViewLink,
    parents: f.parents,
    iconLink: f.iconLink,
  }));

  console.log('[GoogleDrive] searchFiles 返回', files.length, '个结果');

  return {
    files,
    nextPageToken: response.data.nextPageToken,
  };
}

/**
 * 获取文件元数据
 */
export async function getFile(fileId: string): Promise<GDriveFile> {
  const client = await createClient();

  console.log('[GoogleDrive] getFile:', fileId);

  const response = await client.get(`/files/${fileId}`, {
    params: {
      fields: 'id, name, mimeType, size, createdTime, modifiedTime, thumbnailLink, webViewLink, parents, iconLink',
    },
  });

  const f = response.data;
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: parseInt(f.size || '0', 10),
    createdTime: f.createdTime,
    modifiedTime: f.modifiedTime,
    thumbnailLink: f.thumbnailLink,
    webViewLink: f.webViewLink,
    parents: f.parents,
    iconLink: f.iconLink,
  };
}

/**
 * 下载文件到本地
 * @param fileId 文件 ID
 * @param localPath 本地保存路径（如果不指定，使用配置的 downloadPath）
 * @returns 保存的文件路径
 */
export async function downloadFile(fileId: string, localPath?: string): Promise<string> {
  const token = await getAccessToken();
  const proxy = getProxyConfig();

  // 先获取文件信息
  const fileInfo = await getFile(fileId);

  // 确定保存路径
  if (!localPath) {
    const config = getConfig() as any;
    const downloadDir = config.google?.drive?.downloadPath || 'downloads/google-drive';
    await fs.mkdir(downloadDir, { recursive: true });
    localPath = path.join(downloadDir, fileInfo.name);
  }

  // 确保目录存在
  await fs.mkdir(path.dirname(localPath), { recursive: true });

  console.log('[GoogleDrive] 下载文件:', fileInfo.name, '→', localPath);

  // 使用流式下载
  const response = await axios.get(`${DRIVE_API_BASE}/files/${fileId}`, {
    params: { alt: 'media' },
    headers: { Authorization: `Bearer ${token}` },
    responseType: 'stream',
    proxy,
  });

  // 写入文件
  const writer = fsSync.createWriteStream(localPath);
  await new Promise<void>((resolve, reject) => {
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  console.log('[GoogleDrive] 下载完成:', localPath);
  return localPath;
}

/**
 * 上传文件到 Drive
 * @param localPath 本地文件路径
 * @param folderId 目标文件夹 ID（默认根目录）
 * @param name 自定义文件名（默认使用原文件名）
 */
export async function uploadFile(
  localPath: string,
  folderId?: string,
  name?: string
): Promise<GDriveFile> {
  const token = await getAccessToken();
  const proxy = getProxyConfig();

  const fileName = name || path.basename(localPath);
  const fileContent = await fs.readFile(localPath);

  console.log('[GoogleDrive] 上传文件:', fileName, '到文件夹:', folderId || 'root');

  // 使用 multipart upload
  const metadata: any = { name: fileName };
  if (folderId) {
    metadata.parents = [folderId];
  }

  // 构建 multipart 请求体
  const boundary = '-----GoogleDriveUploadBoundary';
  const metadataStr = JSON.stringify(metadata);

  // 检测 MIME 类型
  const ext = path.extname(localPath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf',
    '.txt': 'text/plain', '.zip': 'application/zip',
  };
  const contentType = mimeMap[ext] || 'application/octet-stream';

  const preBody = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataStr}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
  const postBody = `\r\n--${boundary}--`;

  const body = Buffer.concat([
    Buffer.from(preBody),
    fileContent,
    Buffer.from(postBody),
  ]);

  const response = await axios.post(
    `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,name,mimeType,size,createdTime,modifiedTime,thumbnailLink,webViewLink,parents`,
    body,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      maxBodyLength: Infinity,
      proxy,
    }
  );

  const f = response.data;
  console.log('[GoogleDrive] 上传成功:', f.name, 'ID:', f.id);

  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: parseInt(f.size || '0', 10),
    createdTime: f.createdTime,
    modifiedTime: f.modifiedTime,
    thumbnailLink: f.thumbnailLink,
    webViewLink: f.webViewLink,
    parents: f.parents,
  };
}

/**
 * 移到回收站
 */
export async function trashFile(fileId: string): Promise<void> {
  const client = await createClient();
  console.log('[GoogleDrive] 移到回收站:', fileId);
  await client.patch(`/files/${fileId}`, { trashed: true });
}

/**
 * 永久删除
 */
export async function deleteFile(fileId: string): Promise<void> {
  const client = await createClient();
  console.log('[GoogleDrive] 永久删除:', fileId);
  await client.delete(`/files/${fileId}`);
}

/**
 * 创建文件夹
 */
export async function createFolder(name: string, parentId?: string): Promise<GDriveFile> {
  const client = await createClient();

  const metadata: any = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) {
    metadata.parents = [parentId];
  }

  console.log('[GoogleDrive] 创建文件夹:', name, '在:', parentId || 'root');

  const response = await client.post('/files', metadata, {
    params: {
      fields: 'id, name, mimeType, createdTime, modifiedTime, parents',
    },
  });

  const f = response.data;
  console.log('[GoogleDrive] 文件夹创建成功, ID:', f.id);

  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: 0,
    createdTime: f.createdTime,
    modifiedTime: f.modifiedTime,
    parents: f.parents,
  };
}

/**
 * 移动文件到新的文件夹
 */
export async function moveFile(fileId: string, newParentId: string): Promise<void> {
  const client = await createClient();

  // 先获取当前父文件夹
  const file = await getFile(fileId);
  const previousParents = (file.parents || []).join(',');

  console.log('[GoogleDrive] 移动文件:', fileId, '到:', newParentId);

  await client.patch(`/files/${fileId}`, null, {
    params: {
      addParents: newParentId,
      removeParents: previousParents,
    },
  });
}

/**
 * 获取存储空间信息
 */
export async function getStorageQuota(): Promise<GDriveStorageQuota> {
  const client = await createClient();

  console.log('[GoogleDrive] 获取存储空间信息');

  const response = await client.get('/about', {
    params: {
      fields: 'storageQuota',
    },
  });

  const quota = response.data.storageQuota;
  const toGB = (bytes: string) => parseFloat(bytes) / (1024 * 1024 * 1024);

  return {
    totalGB: toGB(quota.limit || '0'),
    usedGB: toGB(quota.usage || '0'),
    trashedGB: toGB(quota.usageInDriveTrash || '0'),
  };
}

/**
 * 获取文件缩略图 URL
 * Drive API 返回的 thumbnailLink 需要认证，这里代理获取缩略图数据
 * @returns Base64 编码的缩略图数据 URL
 */
export async function getThumbnail(fileId: string): Promise<string | null> {
  const token = await getAccessToken();
  const proxy = getProxyConfig();

  try {
    // 先获取文件信息拿到 thumbnailLink
    const file = await getFile(fileId);
    if (!file.thumbnailLink) {
      return null;
    }

    // 代理下载缩略图
    const response = await axios.get(file.thumbnailLink, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
      proxy,
    });

    const base64 = Buffer.from(response.data).toString('base64');
    const mimeType = response.headers['content-type'] || 'image/png';
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.warn('[GoogleDrive] 获取缩略图失败:', error);
    return null;
  }
}
