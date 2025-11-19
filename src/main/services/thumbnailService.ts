// 动态导入 sharp，避免启动时立即加载原生模块
let sharp: any = null;
async function getSharp() {
  if (!sharp) {
    try {
      sharp = (await import('sharp')).default;
    } catch (error) {
      console.error('Failed to load sharp:', error);
      throw error;
    }
  }
  return sharp;
}
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { getConfig, getThumbnailsPath } from './config.js';

/**
 * 缩略图服务 - 生成和管理图片缩略图
 */

/**
 * 缩略图生成任务队列管理器
 * 限制同时生成的缩略图数量，避免 CPU/IO 过载
 */
class ThumbnailQueue {
  private queue: Array<{
    imagePath: string;
    resolve: (value: { success: boolean; data?: string; error?: string }) => void;
    reject: (error: Error) => void;
  }> = [];
  private running: Map<string, Promise<{ success: boolean; data?: string; error?: string }>> = new Map(); // 正在处理的任务
  private maxConcurrent: number = 3; // 最大并发数，可以根据 CPU 核心数调整

  /**
   * 添加任务到队列
   */
  async enqueue(imagePath: string): Promise<{ success: boolean; data?: string; error?: string }> {
    // 如果已经在运行中，直接返回正在运行的 Promise
    const existingTask = this.running.get(imagePath);
    if (existingTask) {
      console.log(`[ThumbnailQueue] 图片已在生成中，等待完成: ${imagePath}`);
      return existingTask;
    }

    // 检查队列中是否已经有相同的任务
    const existingInQueue = this.queue.find(task => task.imagePath === imagePath);
    if (existingInQueue) {
      console.log(`[ThumbnailQueue] 图片已在队列中，等待处理: ${imagePath}`);
      // 返回一个新的 Promise，等待队列中的任务完成
      return new Promise((resolve, reject) => {
        // 创建一个包装的 resolve/reject，当原任务完成时也完成这个 Promise
        const originalResolve = existingInQueue.resolve;
        const originalReject = existingInQueue.reject;
        
        existingInQueue.resolve = (value) => {
          originalResolve(value);
          resolve(value);
        };
        
        existingInQueue.reject = (error) => {
          originalReject(error);
          reject(error);
        };
      });
    }

    // 创建新任务
    return new Promise<{ success: boolean; data?: string; error?: string }>((resolve, reject) => {
      this.queue.push({ imagePath, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * 处理队列
   */
  private async processQueue() {
    // 如果已达到最大并发数，等待
    if (this.running.size >= this.maxConcurrent) {
      return;
    }

    // 如果队列为空，返回
    if (this.queue.length === 0) {
      return;
    }

    // 取出一个任务
    const task = this.queue.shift();
    if (!task) return;

    const { imagePath, resolve, reject } = task;

    // 创建任务 Promise
    const taskPromise = (async () => {
      try {
        console.log(`[ThumbnailQueue] 开始生成缩略图: ${imagePath} (当前运行: ${this.running.size + 1}/${this.maxConcurrent})`);
        
        // 生成缩略图
        const result = await generateThumbnailInternal(imagePath, false);
        
        resolve(result);
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        reject(new Error(errorMessage));
        return { success: false, error: errorMessage };
      } finally {
        // 从运行中移除
        this.running.delete(imagePath);
        console.log(`[ThumbnailQueue] 缩略图生成完成: ${imagePath} (当前运行: ${this.running.size}/${this.maxConcurrent})`);
        
        // 继续处理队列
        this.processQueue();
      }
    })();

    // 标记为运行中
    this.running.set(imagePath, taskPromise);
  }
}

// 全局队列实例
const thumbnailQueue = new ThumbnailQueue();

/**
 * 内部生成缩略图函数（不经过队列）
 */
async function generateThumbnailInternal(
  imagePath: string,
  force: boolean = false
): Promise<{ success: boolean; data?: string; error?: string }> {
  try {
    // 检查原图是否存在
    try {
      await fs.access(imagePath);
    } catch {
      return { success: false, error: `原图不存在: ${imagePath}` };
    }

    const config = getConfig();
    const thumbnailPath = await getThumbnailPath(imagePath);

    // 如果缩略图已存在且不强制重新生成，直接返回
    if (!force && await thumbnailExists(thumbnailPath)) {
      return { success: true, data: thumbnailPath };
    }

    // 使用 sharp 生成缩略图
    const { maxWidth, maxHeight, quality, format } = config.thumbnails;

    // 对于 GIF，保持动画，使用 gif 格式
    const ext = path.extname(imagePath).toLowerCase();
    const isGif = ext === '.gif';

    // 动态加载 sharp
    const sharpLib = await getSharp();

    if (isGif) {
      // GIF 格式：保持动画，调整大小
      // 使用 fit: 'inside' 保持原始宽高比，适配到最大尺寸范围内
      await sharpLib(imagePath, { animated: true })
        .resize(maxWidth, maxHeight, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .gif()
        .toFile(thumbnailPath);
    } else {
      // 其他格式：转换为配置的格式（通常是 webp）
      // 使用 fit: 'inside' 保持原始宽高比，适配到最大尺寸范围内
      const sharpInstance = sharpLib(imagePath)
        .resize(maxWidth, maxHeight, {
          fit: 'inside',
          withoutEnlargement: true
        });

      // 根据配置的格式输出
      // 对于 WebP，使用更高的质量设置以达到约500KB的目标大小
      if (format === 'webp') {
        // WebP 质量范围 0-100，90 质量通常能产生高质量但文件大小合理的图片
        // 如果文件太大，可以动态调整质量
        await sharpInstance.webp({ 
          quality: quality,
          effort: 6  // 压缩努力程度 0-6，6 是最高质量
        }).toFile(thumbnailPath);
      } else if (format === 'jpeg' || format === 'jpg') {
        await sharpInstance.jpeg({ quality, mozjpeg: true }).toFile(thumbnailPath);
      } else if (format === 'png') {
        await sharpInstance.png({ quality, compressionLevel: 9 }).toFile(thumbnailPath);
      } else {
        // 默认使用 webp
        await sharpInstance.webp({ 
          quality: quality,
          effort: 6
        }).toFile(thumbnailPath);
      }
    }

    return { success: true, data: thumbnailPath };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`生成缩略图失败 ${imagePath}:`, errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 获取缩略图文件路径
 * 使用原图的哈希值作为文件名，避免文件名冲突
 */
async function getThumbnailPath(imagePath: string): Promise<string> {
  const config = getConfig();
  const thumbnailsDir = getThumbnailsPath();
  
  // 确保缩略图目录存在
  await fs.mkdir(thumbnailsDir, { recursive: true });
  
  // 生成文件哈希值作为唯一标识
  const hash = crypto.createHash('md5').update(imagePath).digest('hex');
  const ext = path.extname(imagePath).toLowerCase();
  
  // 使用配置的格式（通常是 webp），如果原图是 gif 则保持 gif
  const thumbnailExt = ext === '.gif' ? '.gif' : `.${config.thumbnails.format}`;
  const thumbnailPath = path.join(thumbnailsDir, `${hash}${thumbnailExt}`);
  
  return thumbnailPath;
}

/**
 * 检查缩略图是否存在
 */
async function thumbnailExists(thumbnailPath: string): Promise<boolean> {
  try {
    await fs.access(thumbnailPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 生成缩略图（带队列控制）
 * @param imagePath 原图路径
 * @param force 是否强制重新生成（即使已存在）
 * @returns 缩略图路径
 */
export async function generateThumbnail(
  imagePath: string,
  force: boolean = false
): Promise<{ success: boolean; data?: string; error?: string }> {
  // 如果强制重新生成，直接调用内部函数
  if (force) {
    return await generateThumbnailInternal(imagePath, force);
  }

  // 先检查缩略图是否已存在
  const thumbnailPath = await getThumbnailIfExists(imagePath);
  if (thumbnailPath) {
    return { success: true, data: thumbnailPath };
  }

  // 如果不存在，加入队列等待生成
  return await thumbnailQueue.enqueue(imagePath);
}

/**
 * 获取缩略图路径（如果存在）
 * @param imagePath 原图路径
 * @returns 缩略图路径，如果不存在则返回 null
 */
export async function getThumbnailIfExists(imagePath: string): Promise<string | null> {
  try {
    const thumbnailPath = await getThumbnailPath(imagePath);
    if (await thumbnailExists(thumbnailPath)) {
      return thumbnailPath;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 删除缩略图
 */
export async function deleteThumbnail(imagePath: string): Promise<{ success: boolean; error?: string }> {
  try {
    const thumbnailPath = await getThumbnailPath(imagePath);
    await fs.unlink(thumbnailPath);
    return { success: true };
  } catch (error) {
    // 如果文件不存在，也算成功
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { success: true };
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

/**
 * 批量生成缩略图
 */
export async function generateThumbnailsBatch(
  imagePaths: string[],
  force: boolean = false
): Promise<{ success: boolean; generated: number; failed: number; errors?: string[] }> {
  let generated = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const imagePath of imagePaths) {
    const result = await generateThumbnail(imagePath, force);
    if (result.success) {
      generated++;
    } else {
      failed++;
      if (result.error) {
        errors.push(`${imagePath}: ${result.error}`);
      }
    }
  }

  return {
    success: true,
    generated,
    failed,
    errors: errors.length > 0 ? errors : undefined
  };
}

