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

/** 并发信号量：限制同时进行的缓存下载数量 */
const MAX_CACHE_CONCURRENCY = 8;
let activeCacheDownloads = 0;
const waitQueue: Array<() => void> = [];

/** 获取并发许可 */
function acquireCacheSlot(): Promise<void> {
  if (activeCacheDownloads < MAX_CACHE_CONCURRENCY) {
    activeCacheDownloads++;
    return Promise.resolve();
  }
  return new Promise<void>(resolve => waitQueue.push(resolve));
}

/** 释放并发许可 */
function releaseCacheSlot(): void {
  activeCacheDownloads--;
  if (waitQueue.length > 0) {
    activeCacheDownloads++;
    const next = waitQueue.shift()!;
    next();
  }
}

/** 缓存大小增量追踪器（避免每次遍历目录） */
let trackedCacheSize = -1; // -1 表示未初始化

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
 * 全量计算缓存目录大小（仅在首次调用或重置时使用）
 */
async function calculateFullCacheSize(): Promise<number> {
  const cacheDir = getConfigCachePath();
  try {
    await fs.access(cacheDir);
  } catch {
    return 0;
  }

  let totalSize = 0;

  async function calculateSize(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    // 并行 stat 同一目录下的文件
    const statPromises = entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await calculateSize(fullPath);
      } else {
        const stats = await fs.stat(fullPath);
        totalSize += stats.size;
      }
    });
    await Promise.all(statPromises);
  }

  await calculateSize(cacheDir);
  return totalSize;
}

/**
 * 获取缓存目录大小（MB）—— 使用增量追踪，避免每次全量扫描
 */
async function getCacheSize(): Promise<number> {
  if (trackedCacheSize < 0) {
    trackedCacheSize = await calculateFullCacheSize();
    console.log(`[imageCacheService] 初始化缓存大小: ${(trackedCacheSize / (1024 * 1024)).toFixed(2)} MB`);
  }
  return trackedCacheSize / (1024 * 1024);
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
    // 并行 stat 同目录文件
    const statPromises = entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await collectFiles(fullPath);
      } else {
        const stats = await fs.stat(fullPath);
        files.push({ path: fullPath, mtime: stats.mtimeMs, size: stats.size });
        totalSize += stats.size;
      }
    });
    await Promise.all(statPromises);
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

  // 并行删除最旧的文件，每批最多 20 个
  let deletedCount = 0;
  let deletedSize = 0;
  const DELETE_BATCH = 20;

  for (let i = 0; i < files.length; i += DELETE_BATCH) {
    if (totalSize - deletedSize <= targetBytes) break;

    const batch = files.slice(i, i + DELETE_BATCH).filter(() => totalSize - deletedSize > targetBytes);
    const results = await Promise.allSettled(
      batch.map(async (file) => {
        await fs.unlink(file.path);
        return file.size;
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        deletedCount++;
        deletedSize += result.value;
      }
    }
  }

  // 更新增量追踪器
  trackedCacheSize = totalSize - deletedSize;

  console.log(`[imageCacheService] LRU 缓存清理完成: 删除了 ${deletedCount} 个文件，释放 ${(deletedSize / (1024 * 1024)).toFixed(2)} MB，剩余 ${((totalSize - deletedSize) / (1024 * 1024)).toFixed(2)} MB`);
}

/**
 * 检查并清理缓存（如果超过限制）
 */
async function checkAndCleanCache(): Promise<void> {
  const config = getConfig();
  const maxCacheSizeMB = config.booru?.appearance?.maxCacheSizeMB || 500; // 默认 500MB

  const currentSize = await getCacheSize();

  if (currentSize > maxCacheSizeMB) {
    console.log(`[imageCacheService] 缓存超过限制 (${currentSize.toFixed(2)}/${maxCacheSizeMB} MB)，开始清理...`);
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
    return existingPath;
  }

  // 防止同一图片并发下载：如果已有进行中的请求，直接复用
  const cacheKey = `${md5}.${extension}`;
  const existing = inFlightRequests.get(cacheKey);
  if (existing) {
    console.log(`[imageCacheService] 复用进行中的缓存请求: ${cacheKey}`);
    return existing;
  }

  // 获取并发许可
  await acquireCacheSlot();

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
    // 释放并发许可
    releaseCacheSlot();
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

    // 增量更新缓存大小追踪
    try {
      const stat = await fs.stat(cachePath);
      if (trackedCacheSize >= 0) {
        trackedCacheSize += stat.size;
      }
    } catch { /* 忽略 */ }

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
  if (process.platform === 'win32') {
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
    const statPromises = entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await countFiles(fullPath);
      } else {
        const stats = await fs.stat(fullPath);
        totalSize += stats.size;
        fileCount++;
      }
    });
    await Promise.all(statPromises);
  }

  await countFiles(cacheDir);

  // 同步增量追踪器
  trackedCacheSize = totalSize;

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

  // 重置增量追踪器
  trackedCacheSize = 0;

  console.log(`[imageCacheService] 清除缓存完成：删除 ${deletedCount} 个文件，释放 ${(freedBytes / 1024 / 1024).toFixed(1)} MB`);
  return { deletedCount, freedMB: freedBytes / (1024 * 1024) };
}
