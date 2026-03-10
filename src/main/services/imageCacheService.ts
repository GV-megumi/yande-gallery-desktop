/**
 * 图片缓存服务
 * 负责缓存 Booru 图片的原图，用于详情页快速加载
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import axios from 'axios';
import { getConfig, getProxyConfig, getCachePath as getConfigCachePath } from './config.js';
import crypto from 'crypto';
import { networkScheduler } from './networkScheduler.js';

// 正在进行中的缓存请求映射（防止同一图片并发下载）
const inFlightRequests = new Map<string, Promise<string>>();

/**
 * 获取缓存文件路径
 */
function getCacheFilePath(md5: string, extension: string): string {
  const cacheDir = getConfigCachePath();
  // 使用 MD5 的前两位作为子目录，避免单个目录文件过多
  const subDir = md5.substring(0, 2);
  return path.join(cacheDir, subDir, `${md5}.${extension}`);
}

/**
 * 获取缓存目录大小（MB）
 */
async function getCacheSize(): Promise<number> {
  const cacheDir = getConfigCachePath();
  try {
    await fs.access(cacheDir);
  } catch {
    return 0; // 目录不存在，返回 0
  }

  let totalSize = 0;
  
  async function calculateSize(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await calculateSize(fullPath);
      } else {
        const stats = await fs.stat(fullPath);
        totalSize += stats.size;
      }
    }
  }

  await calculateSize(cacheDir);
  return totalSize / (1024 * 1024); // 转换为 MB
}

// 单个缓存文件的最大尺寸限制（默认 200MB）
const MAX_SINGLE_FILE_SIZE_MB = 200;

/**
 * 清理缓存（LRU 逐个删除最旧文件，直到缓存低于目标大小）
 * @param targetSizeMB 目标缓存大小（MB），驱逐到此值以下
 */
async function cleanCache(targetSizeMB?: number): Promise<void> {
  const cacheDir = getConfigCachePath();
  try {
    await fs.access(cacheDir);
  } catch {
    return; // 目录不存在，无需清理
  }

  const config = getConfig();
  const maxCacheSizeMB = config.booru?.appearance?.maxCacheSizeMB || 500;
  // 驱逐目标：配置限制的 80%，留出缓冲空间
  const target = targetSizeMB ?? (maxCacheSizeMB * 0.8);

  // 收集所有缓存文件及其修改时间
  interface CacheFile {
    path: string;
    mtime: number;
    size: number;
  }

  const files: CacheFile[] = [];
  let totalSize = 0;

  async function collectFiles(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await collectFiles(fullPath);
      } else {
        const stats = await fs.stat(fullPath);
        files.push({
          path: fullPath,
          mtime: stats.mtimeMs,
          size: stats.size
        });
        totalSize += stats.size;
      }
    }
  }

  await collectFiles(cacheDir);

  if (files.length === 0) {
    return;
  }

  const targetBytes = target * 1024 * 1024;

  // 如果已经在目标以下，无需驱逐
  if (totalSize <= targetBytes) {
    return;
  }

  // 按修改时间排序（最旧的在前 — LRU）
  files.sort((a, b) => a.mtime - b.mtime);

  // 逐个删除最旧的文件，直到缓存低于目标大小
  let deletedCount = 0;
  let deletedSize = 0;

  for (const file of files) {
    if (totalSize - deletedSize <= targetBytes) {
      break; // 已经低于目标，停止驱逐
    }
    try {
      await fs.unlink(file.path);
      deletedCount++;
      deletedSize += file.size;
    } catch (error) {
      console.error('[imageCacheService] 删除缓存文件失败:', file.path, error);
    }
  }

  console.log(`[imageCacheService] LRU 缓存清理完成: 删除了 ${deletedCount} 个文件，释放 ${(deletedSize / (1024 * 1024)).toFixed(2)} MB，剩余 ${((totalSize - deletedSize) / (1024 * 1024)).toFixed(2)} MB`);
}

/**
 * 检查并清理缓存（如果超过限制）
 */
async function checkAndCleanCache(): Promise<void> {
  const config = getConfig();
  const maxCacheSizeMB = config.booru?.appearance?.maxCacheSizeMB || 500; // 默认 500MB

  const currentSize = await getCacheSize();
  console.log(`[imageCacheService] 当前缓存大小: ${currentSize.toFixed(2)} MB，限制: ${maxCacheSizeMB} MB`);

  if (currentSize > maxCacheSizeMB) {
    console.log(`[imageCacheService] 缓存超过限制，开始清理...`);
    await cleanCache();
  }
}

/**
 * 获取缓存的图片路径（如果存在）
 */
export async function getCachedImagePath(md5: string, extension: string): Promise<string | null> {
  const cachePath = getCacheFilePath(md5, extension);
  try {
    await fs.access(cachePath);
    return cachePath;
  } catch {
    return null;
  }
}

/**
 * 缓存图片
 * @param url 图片 URL
 * @param md5 图片 MD5
 * @param extension 文件扩展名
 * @returns 缓存文件路径
 */
export async function cacheImage(url: string, md5: string, extension: string): Promise<string> {
  // 检查缓存是否已存在
  const existingPath = await getCachedImagePath(md5, extension);
  if (existingPath) {
    console.log(`[imageCacheService] 缓存已存在: ${md5}.${extension}`);
    return existingPath;
  }

  // 防止同一图片并发下载：如果已有进行中的请求，直接复用
  const cacheKey = `${md5}.${extension}`;
  const existing = inFlightRequests.get(cacheKey);
  if (existing) {
    console.log(`[imageCacheService] 复用进行中的缓存请求: ${cacheKey}`);
    return existing;
  }

  // 通知网络调度器：浏览请求开始
  networkScheduler.incrementBrowsing();

  // 创建下载 Promise 并注册到 in-flight map
  const downloadPromise = doCacheImage(url, md5, extension);
  inFlightRequests.set(cacheKey, downloadPromise);

  try {
    return await downloadPromise;
  } finally {
    inFlightRequests.delete(cacheKey);
    // 通知网络调度器：浏览请求结束
    networkScheduler.decrementBrowsing();
  }
}

/**
 * 实际执行图片缓存下载（内部方法）
 */
async function doCacheImage(url: string, md5: string, extension: string): Promise<string> {
  // 检查并清理缓存
  await checkAndCleanCache();

  // 下载图片
  const cachePath = getCacheFilePath(md5, extension);
  const cacheDir = path.dirname(cachePath);

  // 确保缓存目录存在
  await fs.mkdir(cacheDir, { recursive: true });

  console.log(`[imageCacheService] 开始缓存图片: ${url.substring(0, 100)}...`);

  try {
    const proxyConfig = getProxyConfig();

    // 先用 HEAD 请求检查文件大小，拒绝超大文件
    try {
      const headResponse = await axios({
        method: 'HEAD',
        url: url,
        proxy: proxyConfig,
        timeout: 10000,
        headers: { 'User-Agent': 'YandeGalleryDesktop/1.0.0' }
      });
      const contentLength = parseInt(headResponse.headers['content-length'] || '0', 10);
      const maxSizeBytes = MAX_SINGLE_FILE_SIZE_MB * 1024 * 1024;
      if (contentLength > maxSizeBytes) {
        console.warn(`[imageCacheService] 文件过大 (${(contentLength / (1024 * 1024)).toFixed(1)} MB > ${MAX_SINGLE_FILE_SIZE_MB} MB)，跳过缓存: ${md5}.${extension}`);
        throw new Error(`File too large: ${(contentLength / (1024 * 1024)).toFixed(1)} MB exceeds ${MAX_SINGLE_FILE_SIZE_MB} MB limit`);
      }
    } catch (headError: any) {
      // HEAD 请求失败时（如服务端不支持 HEAD），继续下载但不中断
      if (headError.message?.startsWith('File too large')) throw headError;
      console.warn('[imageCacheService] HEAD 请求失败，跳过大小检查:', headError.message);
    }

    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      proxy: proxyConfig,
      timeout: 60000, // 60秒超时
      headers: {
        'User-Agent': 'YandeGalleryDesktop/1.0.0'
      }
    });

    const writer = fsSync.createWriteStream(cachePath);

    // 使用 pipeline 自动处理背压和错误传播（替代 .pipe()）
    await pipeline(response.data, writer);
    console.log(`[imageCacheService] 图片缓存成功: ${cachePath}`);

    return cachePath;
  } catch (error) {
    // 如果下载失败，尝试删除可能的部分文件
    try {
      await fs.unlink(cachePath);
    } catch {
      // 忽略删除错误
    }
    throw error;
  }
}

/**
 * 获取缓存图片的 URL（用于前端显示）
 * @param md5 图片 MD5
 * @param extension 文件扩展名
 * @returns 缓存文件的 app:// URL，如果不存在则返回 null
 */
export async function getCachedImageUrl(md5: string, extension: string): Promise<string | null> {
  const cachePath = await getCachedImagePath(md5, extension);
  if (!cachePath) {
    return null;
  }

  // 转换为 app:// URL
  // Windows 下需要将路径转换为 app://盘符/路径 格式
  // 例如：M:\yande\yande-gallery-desktop\data\cache\87\874a52b20a5c1ba31141bd964f40ea3b.png
  // 转换为：app://m/data/cache/87/874a52b20a5c1ba31141bd964f40ea3b.png
  if (process.platform === 'win32') {
    // Windows 路径：M:\path\to\file.png
    const match = cachePath.match(/^([A-Z]):\\(.+)$/i);
    if (match) {
      const driveLetter = match[1].toLowerCase();
      const pathPart = match[2].replace(/\\/g, '/');
      return `app://${driveLetter}/${pathPart}`;
    }
  }
  
  // Unix 路径
  return `app://${cachePath}`;
}

/**
 * 获取缓存统计信息
 */
export async function getCacheStats(): Promise<{ sizeMB: number; fileCount: number }> {
  const cacheDir = getConfigCachePath();
  let totalSize = 0;
  let fileCount = 0;

  try {
    await fs.access(cacheDir);
  } catch {
    return { sizeMB: 0, fileCount: 0 };
  }

  async function countFiles(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await countFiles(fullPath);
      } else {
        const stats = await fs.stat(fullPath);
        totalSize += stats.size;
        fileCount++;
      }
    }
  }

  await countFiles(cacheDir);
  return {
    sizeMB: totalSize / (1024 * 1024),
    fileCount
  };
}

/**
 * 清除所有缓存文件
 */
export async function clearAllCache(): Promise<{ deletedCount: number; freedMB: number }> {
  const cacheDir = getConfigCachePath();
  let deletedCount = 0;
  let freedBytes = 0;

  try {
    await fs.access(cacheDir);
  } catch {
    return { deletedCount: 0, freedMB: 0 };
  }

  async function deleteFiles(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await deleteFiles(fullPath);
        try { await fs.rmdir(fullPath); } catch { /* 忽略非空目录错误 */ }
      } else {
        const stat = await fs.stat(fullPath);
        freedBytes += stat.size;
        await fs.unlink(fullPath);
        deletedCount++;
      }
    }
  }

  await deleteFiles(cacheDir);
  console.log(`[imageCacheService] 清除缓存完成：删除 ${deletedCount} 个文件，释放 ${(freedBytes / 1024 / 1024).toFixed(1)} MB`);
  return { deletedCount, freedMB: freedBytes / (1024 * 1024) };
}

