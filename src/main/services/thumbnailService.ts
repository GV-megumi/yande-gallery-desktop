// Dynamically import sharp so the native module is not loaded during app startup.
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
import { emitBuiltRendererAppEvent } from './rendererEventBus.js';
import type { RendererThumbnailGeneratedEvent } from '../../shared/types.js';

type ThumbnailPriority = 'background' | 'foreground';
type ThumbnailResult = { success: boolean; data?: string; error?: string; missing?: boolean; cancelled?: boolean };

const THUMBNAIL_PRIORITY_WEIGHT: Record<ThumbnailPriority, number> = {
  background: 0,
  foreground: 10,
};

function isMissingSourceError(error?: string): boolean {
  return !!error && (
    error.includes('原图不存在') ||
    error.includes('鍘熷浘涓嶅瓨鍦')
  );
}

function emitThumbnailGenerated(imagePath: string, result: ThumbnailResult): void {
  emitBuiltRendererAppEvent<RendererThumbnailGeneratedEvent>({
    type: 'thumbnail:generated',
    source: 'thumbnailService',
    payload: {
      imagePath,
      thumbnailPath: result.success ? result.data : undefined,
      success: result.success,
      error: result.error,
      missing: result.missing ?? isMissingSourceError(result.error),
    },
  });
}

class ThumbnailQueue {
  private queue: Array<{
    imagePath: string;
    priorityWeight: number;
    resolve: (value: ThumbnailResult) => void;
    reject: (error: Error) => void;
  }> = [];

  private queuedPaths: Map<string, { imagePath: string; priorityWeight: number; resolve: (value: ThumbnailResult) => void; reject: (error: Error) => void }> = new Map();
  private running: Map<string, Promise<ThumbnailResult>> = new Map();
  private notifyPaths: Set<string> = new Set();
  // 墓碑：任务开跑后其图片被删除（无法中断 sharp），完成时丢弃产物、不通知渲染层。
  // 不打墓碑的话，"删除图集/图片 → 清理缩略图 → 队列补生成"会留下永久泄漏的孤儿缩略图。
  private cancelledRunning: Set<string> = new Set();
  private maxConcurrent: number = 3;

  /**
   * 取消一批路径的缩略图生成（图片删除/孤儿回收路径调用）：
   * - 还在等待队列中的：直接移除，以 cancelled 结果 resolve（不 reject，免得后台任务的 .catch 刷告警）；
   * - 正在生成中的：打墓碑，完成后删除刚生成的缩略图文件并跳过 thumbnail:generated 通知。
   */
  cancelPending(imagePaths: string[]): void {
    if (imagePaths.length === 0) return;
    const targets = new Set(imagePaths);

    if (this.queue.length > 0) {
      const remaining: typeof this.queue = [];
      for (const task of this.queue) {
        if (targets.has(task.imagePath)) {
          this.queuedPaths.delete(task.imagePath);
          this.notifyPaths.delete(task.imagePath);
          task.resolve({ success: false, error: '已取消（图片已删除）', cancelled: true });
        } else {
          remaining.push(task);
        }
      }
      this.queue = remaining;
    }

    for (const imagePath of targets) {
      if (this.running.has(imagePath)) {
        this.cancelledRunning.add(imagePath);
      }
    }
  }

  async enqueue(
    imagePath: string,
    options: { priority?: ThumbnailPriority; notify?: boolean } = {}
  ): Promise<ThumbnailResult> {
    const priorityWeight = THUMBNAIL_PRIORITY_WEIGHT[options.priority ?? 'background'];
    if (options.notify) {
      this.notifyPaths.add(imagePath);
    }

    const existingTask = this.running.get(imagePath);
    if (existingTask) {
      return existingTask;
    }

    const existingInQueue = this.queuedPaths.get(imagePath);
    if (existingInQueue) {
      existingInQueue.priorityWeight = Math.max(existingInQueue.priorityWeight, priorityWeight);
      this.queue.sort((a, b) => b.priorityWeight - a.priorityWeight);
      return new Promise((resolve, reject) => {
        const originalResolve = existingInQueue.resolve;
        const originalReject = existingInQueue.reject;
        existingInQueue.resolve = (value) => { originalResolve(value); resolve(value); };
        existingInQueue.reject = (error) => { originalReject(error); reject(error); };
      });
    }

    return new Promise<ThumbnailResult>((resolve, reject) => {
      const task = { imagePath, priorityWeight, resolve, reject };
      this.queue.push(task);
      this.queue.sort((a, b) => b.priorityWeight - a.priorityWeight);
      this.queuedPaths.set(imagePath, task);
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.running.size >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    const { imagePath, resolve, reject } = task;
    this.queuedPaths.delete(imagePath);

    const taskPromise = (async () => {
      try {
        console.log(`[ThumbnailQueue] start generating thumbnail: ${imagePath} (running: ${this.running.size + 1}/${this.maxConcurrent})`);
        const result = await generateThumbnailInternal(imagePath, false);

        // 墓碑命中：生成期间图片被删除——丢弃产物（否则成为永远无人清理的孤儿缩略图），
        // 不向渲染层通知，向调用方返回 cancelled 结果。
        if (this.cancelledRunning.has(imagePath)) {
          this.cancelledRunning.delete(imagePath);
          if (result.success && result.data) {
            try {
              await fs.unlink(result.data);
            } catch {
              // 产物已不在（可能被并发清理删掉）则忽略
            }
          }
          console.log(`[ThumbnailQueue] cancelled during generation, artifact discarded: ${imagePath}`);
          const cancelledResult: ThumbnailResult = { success: false, error: '已取消（图片已删除）', cancelled: true };
          resolve(cancelledResult);
          return cancelledResult;
        }

        if (this.notifyPaths.has(imagePath)) {
          emitThumbnailGenerated(imagePath, result);
        }

        resolve(result);
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (this.cancelledRunning.has(imagePath)) {
          this.cancelledRunning.delete(imagePath);
        } else if (this.notifyPaths.has(imagePath)) {
          emitThumbnailGenerated(imagePath, {
            success: false,
            error: errorMessage,
            missing: isMissingSourceError(errorMessage),
          });
        }
        reject(new Error(errorMessage));
        return { success: false, error: errorMessage };
      } finally {
        this.running.delete(imagePath);
        this.notifyPaths.delete(imagePath);
        console.log(`[ThumbnailQueue] finished thumbnail: ${imagePath} (running: ${this.running.size}/${this.maxConcurrent})`);
        this.processQueue();
      }
    })();

    this.running.set(imagePath, taskPromise);
  }
}

const thumbnailQueue = new ThumbnailQueue();

function normalizeThumbnailEffort(effort: unknown): number {
  const normalized = Number(effort ?? 3);
  if (!Number.isFinite(normalized)) {
    return 3;
  }
  return Math.min(6, Math.max(0, Math.trunc(normalized)));
}

async function generateThumbnailInternal(
  imagePath: string,
  force: boolean = false
): Promise<ThumbnailResult> {
  try {
    try {
      await fs.access(imagePath);
    } catch {
      return { success: false, error: `原图不存在: ${imagePath}`, missing: true };
    }

    const config = getConfig();
    const thumbnailPath = await getThumbnailPath(imagePath);

    if (!force && await thumbnailExists(thumbnailPath)) {
      return { success: true, data: thumbnailPath };
    }

    const { maxWidth, maxHeight, quality, format } = config.thumbnails;
    const effort = normalizeThumbnailEffort(config.thumbnails.effort);
    const ext = path.extname(imagePath).toLowerCase();
    const isGif = ext === '.gif';
    const sharpLib = await getSharp();

    if (isGif) {
      await sharpLib(imagePath, { animated: true })
        .resize(maxWidth, maxHeight, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .gif()
        .toFile(thumbnailPath);
    } else {
      const sharpInstance = sharpLib(imagePath)
        .resize(maxWidth, maxHeight, {
          fit: 'inside',
          withoutEnlargement: true
        });

      if (format === 'webp') {
        await sharpInstance.webp({ quality, effort }).toFile(thumbnailPath);
      } else if (format === 'jpeg' || format === 'jpg') {
        await sharpInstance.jpeg({ quality, mozjpeg: true }).toFile(thumbnailPath);
      } else if (format === 'png') {
        await sharpInstance.png({ quality, compressionLevel: 9 }).toFile(thumbnailPath);
      } else {
        await sharpInstance.webp({ quality, effort }).toFile(thumbnailPath);
      }
    }

    return { success: true, data: thumbnailPath };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`生成缩略图失败 ${imagePath}:`, errorMessage);
    return { success: false, error: errorMessage, missing: isMissingSourceError(errorMessage) };
  }
}

async function getThumbnailPath(imagePath: string): Promise<string> {
  const config = getConfig();
  const thumbnailsDir = getThumbnailsPath();

  await fs.mkdir(thumbnailsDir, { recursive: true });

  const hash = crypto.createHash('md5').update(imagePath).digest('hex');
  const ext = path.extname(imagePath).toLowerCase();
  const thumbnailExt = ext === '.gif' ? '.gif' : `.${config.thumbnails.format}`;
  return path.join(thumbnailsDir, `${hash}${thumbnailExt}`);
}

async function thumbnailExists(thumbnailPath: string): Promise<boolean> {
  try {
    await fs.access(thumbnailPath);
    return true;
  } catch {
    return false;
  }
}

export async function generateThumbnail(
  imagePath: string,
  force: boolean = false
): Promise<ThumbnailResult> {
  if (force) {
    const result = await generateThumbnailInternal(imagePath, force);
    emitThumbnailGenerated(imagePath, result);
    return result;
  }

  const thumbnailPath = await getThumbnailIfExists(imagePath);
  if (thumbnailPath) {
    return { success: true, data: thumbnailPath };
  }

  return await thumbnailQueue.enqueue(imagePath, { priority: 'foreground', notify: true });
}

export async function requestThumbnailGeneration(
  imagePath: string
): Promise<{ success: boolean; data?: string; pending?: boolean; error?: string; missing?: boolean }> {
  const thumbnailPath = await getThumbnailIfExists(imagePath);
  if (thumbnailPath) {
    return { success: true, data: thumbnailPath };
  }

  thumbnailQueue.enqueue(imagePath, { priority: 'foreground', notify: true }).catch((error) => {
    console.warn(`[ThumbnailQueue] foreground thumbnail failed: ${imagePath}`, error);
  });

  return { success: true, pending: true };
}

export function enqueueThumbnailGeneration(imagePath: string): void {
  thumbnailQueue.enqueue(imagePath, { priority: 'background', notify: false }).catch((error) => {
    console.warn(`[ThumbnailQueue] background thumbnail failed: ${imagePath}`, error);
  });
}

/**
 * 取消一批路径的缩略图生成任务（等待中的移除、生成中的打墓碑丢弃产物）。
 * 删除图片/孤儿回收路径必须在删缩略图文件之前调用——否则队列里挂着的任务
 * 会在删除之后把缩略图重新生成出来（源文件仍在磁盘上），成为永久泄漏。
 */
export function cancelThumbnailGeneration(imagePaths: string[]): void {
  thumbnailQueue.cancelPending(imagePaths);
}

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

export async function deleteThumbnail(imagePath: string): Promise<{ success: boolean; error?: string }> {
  try {
    const thumbnailPath = await getThumbnailPath(imagePath);
    await fs.unlink(thumbnailPath);
    return { success: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { success: true };
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

/**
 * 清理孤儿缩略图：thumbnails 目录中与库内任何图片都不再对应的缩略图文件。
 *
 * 缩略图按 md5(filepath) 命名；历史上存在输出格式切换（webp/jpeg/png），故按
 * 文件名的 hash 段对账、不看扩展名；只处理形如 `<32位hex>.<ext>` 的文件，其它一概不动。
 * 保护集 = images.filepath 的 md5 全集 ∪ invalid_images.thumbnailPath 的 hash 段
 * （失效迁移有意保留缩略图供无效列表页展示，清掉会变破图）。
 *
 * 兜底用途：历史版本"删除后队列补生成"等竞态泄漏的孤儿文件，靠此维护动作清回来。
 */
export async function cleanupOrphanThumbnails(): Promise<{
  success: boolean;
  data?: { scanned: number; deleted: number; freedBytes: number };
  error?: string;
}> {
  try {
    // 动态导入：thumbnailService 平时不依赖数据库，仅此维护动作需要（避免启动期引入 DB）
    const { getDatabase, all } = await import('./database.js');
    const db = await getDatabase();

    const imageRows = await all<{ filepath: string }>(db, 'SELECT filepath FROM images');
    const validHashes = new Set(
      imageRows.map((row) => crypto.createHash('md5').update(row.filepath).digest('hex'))
    );
    const invalidRows = await all<{ thumbnailPath: string | null }>(
      db,
      'SELECT thumbnailPath FROM invalid_images WHERE thumbnailPath IS NOT NULL'
    );
    for (const row of invalidRows) {
      const match = /^([0-9a-f]{32})\./i.exec(path.basename(row.thumbnailPath ?? ''));
      if (match) {
        validHashes.add(match[1].toLowerCase());
      }
    }

    const thumbnailsDir = getThumbnailsPath();
    let entries: string[] = [];
    try {
      entries = await fs.readdir(thumbnailsDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { success: true, data: { scanned: 0, deleted: 0, freedBytes: 0 } };
      }
      throw err;
    }

    let scanned = 0;
    let deleted = 0;
    let freedBytes = 0;
    for (const name of entries) {
      const match = /^([0-9a-f]{32})\.[a-z0-9]+$/i.exec(name);
      if (!match) continue;
      scanned++;
      if (validHashes.has(match[1].toLowerCase())) continue;
      const fullPath = path.join(thumbnailsDir, name);
      try {
        const stat = await fs.stat(fullPath);
        if (!stat.isFile()) continue;
        await fs.unlink(fullPath);
        deleted++;
        freedBytes += stat.size;
      } catch (err) {
        // 单个文件删除失败（占用/权限）不中断整体清理
        console.warn(`[thumbnailService] 清理孤儿缩略图失败: ${name}`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`[thumbnailService] 孤儿缩略图清理完成: scanned=${scanned}, deleted=${deleted}, freed=${freedBytes}B`);
    return { success: true, data: { scanned, deleted, freedBytes } };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[thumbnailService] 清理孤儿缩略图失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

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
