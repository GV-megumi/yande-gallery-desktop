/**
 * 图片缓存服务
 * 负责缓存 Booru 图片的原图，用于详情页快速加载
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import axios from 'axios';
import { getConfig, getProxyConfig } from './config.js';
import crypto from 'crypto';

/**
 * 获取缓存文件路径
 */
function getCachePath(md5: string, extension: string): string {
  const config = getConfig();
  const cacheDir = path.join(process.cwd(), 'data', 'cache');
  // 使用 MD5 的前两位作为子目录，避免单个目录文件过多
  const subDir = md5.substring(0, 2);
  return path.join(cacheDir, subDir, `${md5}.${extension}`);
}

/**
 * 获取缓存目录大小（MB）
 */
async function getCacheSize(): Promise<number> {
  const cacheDir = path.join(process.cwd(), 'data', 'cache');
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

/**
 * 清理缓存（删除最旧的一半文件）
 */
async function cleanCache(): Promise<void> {
  const cacheDir = path.join(process.cwd(), 'data', 'cache');
  try {
    await fs.access(cacheDir);
  } catch {
    return; // 目录不存在，无需清理
  }

  // 收集所有缓存文件及其修改时间
  interface CacheFile {
    path: string;
    mtime: number;
    size: number;
  }

  const files: CacheFile[] = [];

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
      }
    }
  }

  await collectFiles(cacheDir);

  if (files.length === 0) {
    return;
  }

  // 按修改时间排序（最旧的在前）
  files.sort((a, b) => a.mtime - b.mtime);

  // 删除最旧的一半文件
  const filesToDelete = files.slice(0, Math.ceil(files.length / 2));
  let deletedCount = 0;
  let deletedSize = 0;

  for (const file of filesToDelete) {
    try {
      await fs.unlink(file.path);
      deletedCount++;
      deletedSize += file.size;
    } catch (error) {
      console.error('[imageCacheService] 删除缓存文件失败:', file.path, error);
    }
  }

  console.log(`[imageCacheService] 清理缓存完成: 删除了 ${deletedCount} 个文件，释放 ${(deletedSize / (1024 * 1024)).toFixed(2)} MB`);
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
  const cachePath = getCachePath(md5, extension);
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

  // 检查并清理缓存
  await checkAndCleanCache();

  // 下载图片
  const cachePath = getCachePath(md5, extension);
  const cacheDir = path.dirname(cachePath);

  // 确保缓存目录存在
  await fs.mkdir(cacheDir, { recursive: true });

  console.log(`[imageCacheService] 开始缓存图片: ${url.substring(0, 100)}...`);

  try {
    const proxyConfig = getProxyConfig();
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
    response.data.pipe(writer);

    await new Promise<void>((resolve, reject) => {
      writer.on('finish', () => {
        console.log(`[imageCacheService] 图片缓存成功: ${cachePath}`);
        resolve();
      });
      writer.on('error', (error: Error) => {
        console.error(`[imageCacheService] 图片缓存失败:`, error);
        reject(error);
      });
    });

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
  
  // Unix 路径或其他格式
  const relativePath = path.relative(process.cwd(), cachePath);
  const normalizedPath = relativePath.replace(/\\/g, '/');
  return `app://${normalizedPath}`;
}

/**
 * 获取缓存统计信息
 */
export async function getCacheStats(): Promise<{ sizeMB: number; fileCount: number }> {
  const cacheDir = path.join(process.cwd(), 'data', 'cache');
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

