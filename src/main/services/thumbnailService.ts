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
import { getConfig, getThumbnailsPath, getPreviewsPath } from './config.js';
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
  const missing = result.missing ?? isMissingSourceError(result.error);
  // error 只发类别不发原文：该事件经 API 事件桥落 system 频道、手机面可订阅，而 fs/sharp
  // 的原始错误串常含本地绝对路径（sanitizeApiEventPayload 只按键名剥离，不处理字符串值），
  // 原文会破坏「本地路径不经 API 外泄」的不变量。诊断原文保留在本服务的 console 日志里；
  // 渲染层仅消费 success/missing/thumbnailPath，不读 error 细节，此收窄无行为影响。
  const safeError = result.success
    ? undefined
    : result.cancelled
      ? '已取消'
      : missing
        ? '原图不存在'
        : '生成失败';
  emitBuiltRendererAppEvent<RendererThumbnailGeneratedEvent>({
    type: 'thumbnail:generated',
    source: 'thumbnailService',
    payload: {
      imagePath,
      thumbnailPath: result.success ? result.data : undefined,
      success: result.success,
      error: safeError,
      missing,
    },
  });
}

type ThumbnailQueueTask = {
  key: string;                                  // `${tier}:${imagePath}`，两档同源不撞车
  imagePath: string;                            // 裸路径：事件/日志/墓碑判定用
  run: () => Promise<ThumbnailResult>;          // 档位对应的生成函数闭包
  priorityWeight: number;
  resolve: (value: ThumbnailResult) => void;
  reject: (error: Error) => void;
};

class ThumbnailQueue {
  private queue: Array<ThumbnailQueueTask> = [];

  // 以下 Map/Set 全部以 task.key（`${tier}:${imagePath}`）为索引，两档同源互不干扰。
  private queuedPaths: Map<string, ThumbnailQueueTask> = new Map();
  private running: Map<string, Promise<ThumbnailResult>> = new Map();
  private notifyPaths: Set<string> = new Set();
  // 墓碑：任务开跑后其图片被删除（无法中断 sharp），完成时丢弃产物、不通知渲染层。
  // 不打墓碑的话，"删除相册/图片 → 清理缩略图 → 队列补生成"会留下永久泄漏的孤儿缩略图。
  private cancelledRunning: Set<string> = new Set();
  private maxConcurrent: number = 3;

  /**
   * 取消一批路径的缩略图生成（图片删除/孤儿回收路径调用）：
   * - 还在等待队列中的：直接移除，以 cancelled 结果 resolve（不 reject，免得后台任务的 .catch 刷告警）；
   * - 正在生成中的：打墓碑，完成后删除刚生成的产物文件并跳过 thumbnail:generated 通知。
   *
   * 对每个裸路径生成两档 target key（thumbnail:/preview:），双档一并投毒取消。
   */
  cancelPending(imagePaths: string[]): void {
    if (imagePaths.length === 0) return;
    const targets = new Set(imagePaths.flatMap((p) => [`thumbnail:${p}`, `preview:${p}`]));

    if (this.queue.length > 0) {
      const remaining: typeof this.queue = [];
      for (const task of this.queue) {
        if (targets.has(task.key)) {
          this.queuedPaths.delete(task.key);
          this.notifyPaths.delete(task.key);
          task.resolve({ success: false, error: '已取消（图片已删除）', cancelled: true });
        } else {
          remaining.push(task);
        }
      }
      this.queue = remaining;
    }

    for (const key of targets) {
      if (this.running.has(key)) {
        this.cancelledRunning.add(key);
      }
    }
  }

  async enqueue(task: {
    key: string;
    imagePath: string;
    run: () => Promise<ThumbnailResult>;
    priority?: ThumbnailPriority;
    notify?: boolean;
  }): Promise<ThumbnailResult> {
    const { key, imagePath, run } = task;
    const priorityWeight = THUMBNAIL_PRIORITY_WEIGHT[task.priority ?? 'background'];
    if (task.notify) {
      this.notifyPaths.add(key);
    }

    const existingTask = this.running.get(key);
    if (existingTask) {
      return existingTask;
    }

    const existingInQueue = this.queuedPaths.get(key);
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
      const queueTask: ThumbnailQueueTask = { key, imagePath, run, priorityWeight, resolve, reject };
      this.queue.push(queueTask);
      this.queue.sort((a, b) => b.priorityWeight - a.priorityWeight);
      this.queuedPaths.set(key, queueTask);
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.running.size >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    const { key, imagePath, run, resolve, reject } = task;
    this.queuedPaths.delete(key);

    const taskPromise = (async () => {
      try {
        console.log(`[ThumbnailQueue] start generating thumbnail: ${imagePath} (running: ${this.running.size + 1}/${this.maxConcurrent})`);
        const result = await run();

        // 墓碑命中：生成期间图片被删除——丢弃产物（否则成为永远无人清理的孤儿文件），
        // 不向渲染层通知，向调用方返回 cancelled 结果。
        if (this.cancelledRunning.has(key)) {
          this.cancelledRunning.delete(key);
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

        if (this.notifyPaths.has(key)) {
          emitThumbnailGenerated(imagePath, result);
        }

        resolve(result);
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (this.cancelledRunning.has(key)) {
          this.cancelledRunning.delete(key);
        } else if (this.notifyPaths.has(key)) {
          emitThumbnailGenerated(imagePath, {
            success: false,
            error: errorMessage,
            missing: isMissingSourceError(errorMessage),
          });
        }
        reject(new Error(errorMessage));
        return { success: false, error: errorMessage };
      } finally {
        this.running.delete(key);
        this.notifyPaths.delete(key);
        console.log(`[ThumbnailQueue] finished thumbnail: ${imagePath} (running: ${this.running.size}/${this.maxConcurrent})`);
        this.processQueue();
      }
    })();

    this.running.set(key, taskPromise);
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

/**
 * 生成 1600px 预览档内部实现（结构镜像 generateThumbnailInternal）：
 * - 含源文件 fs.access 预检——缺失返回 missing:true，路由层据此映射 404 而非 500
 *   （与缩略图路由及 spec §6.3 "二进制 404 触发对账" 契约一致）；
 * - 无 GIF 分支（GIF 在 generatePreview 层直接回源文件、不进此函数）；
 * - 不 emit thumbnail:generated 事件（预览档不参与渲染层缩略图缓存）。
 */
async function generatePreviewInternal(imagePath: string, force: boolean): Promise<ThumbnailResult> {
  try {
    try {
      await fs.access(imagePath);
    } catch {
      return { success: false, error: `原图不存在: ${imagePath}`, missing: true };
    }

    const config = getConfig();
    const previewPath = await getTierCachePath('preview', imagePath);

    if (!force && await thumbnailExists(previewPath)) {
      return { success: true, data: previewPath };
    }

    const { maxWidth, maxHeight, quality, format } = config.thumbnails.preview;
    const effort = normalizeThumbnailEffort(config.thumbnails.preview.effort);
    const sharpLib = await getSharp();

    const sharpInstance = sharpLib(imagePath)
      .resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      });

    if (format === 'webp') {
      await sharpInstance.webp({ quality, effort }).toFile(previewPath);
    } else if (format === 'jpeg' || format === 'jpg') {
      await sharpInstance.jpeg({ quality, mozjpeg: true }).toFile(previewPath);
    } else if (format === 'png') {
      await sharpInstance.png({ quality, compressionLevel: 9 }).toFile(previewPath);
    } else {
      await sharpInstance.webp({ quality, effort }).toFile(previewPath);
    }

    return { success: true, data: previewPath };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`生成预览档失败 ${imagePath}:`, errorMessage);
    return { success: false, error: errorMessage, missing: isMissingSourceError(errorMessage) };
  }
}

type ImageTier = 'thumbnail' | 'preview';

/**
 * 计算某档位（缩略图 / 1600px 预览档）的缓存文件路径。
 * 两档同用 md5(源绝对路径) 命名，但落在各自目录，扩展名取各档 format（GIF 恒为 .gif）。
 */
async function getTierCachePath(tier: ImageTier, imagePath: string): Promise<string> {
  const config = getConfig();
  const settings = tier === 'preview' ? config.thumbnails.preview : config.thumbnails;
  const dir = tier === 'preview' ? getPreviewsPath() : getThumbnailsPath();

  await fs.mkdir(dir, { recursive: true });

  const hash = crypto.createHash('md5').update(imagePath).digest('hex');
  const ext = path.extname(imagePath).toLowerCase();
  const cacheExt = ext === '.gif' ? '.gif' : `.${settings.format}`;
  return path.join(dir, `${hash}${cacheExt}`);
}

async function getThumbnailPath(imagePath: string): Promise<string> {
  return getTierCachePath('thumbnail', imagePath);
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

  return await thumbnailQueue.enqueue({
    key: `thumbnail:${imagePath}`,
    imagePath,
    run: () => generateThumbnailInternal(imagePath, false),
    priority: 'foreground',
    notify: true,
  });
}

export async function requestThumbnailGeneration(
  imagePath: string
): Promise<{ success: boolean; data?: string; pending?: boolean; error?: string; missing?: boolean }> {
  const thumbnailPath = await getThumbnailIfExists(imagePath);
  if (thumbnailPath) {
    return { success: true, data: thumbnailPath };
  }

  thumbnailQueue.enqueue({
    key: `thumbnail:${imagePath}`,
    imagePath,
    run: () => generateThumbnailInternal(imagePath, false),
    priority: 'foreground',
    notify: true,
  }).catch((error) => {
    console.warn(`[ThumbnailQueue] foreground thumbnail failed: ${imagePath}`, error);
  });

  return { success: true, pending: true };
}

export function enqueueThumbnailGeneration(imagePath: string): void {
  thumbnailQueue.enqueue({
    key: `thumbnail:${imagePath}`,
    imagePath,
    run: () => generateThumbnailInternal(imagePath, false),
    priority: 'background',
    notify: false,
  }).catch((error) => {
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
 * 生成 1600px 预览档（移动端全屏大图，spec §5.1）。
 * GIF 不转码，直接返回源文件路径。结构镜像 generateThumbnail：force 直跑不进队列；
 * 缓存命中短路；否则入队（foreground 阻塞等待、notify:false 不污染渲染层缩略图缓存）。
 */
export async function generatePreview(imagePath: string, force: boolean = false): Promise<ThumbnailResult> {
  if (path.extname(imagePath).toLowerCase() === '.gif') {
    return { success: true, data: imagePath };
  }

  if (force) {
    return generatePreviewInternal(imagePath, true);
  }

  const cached = await getPreviewIfExists(imagePath);
  if (cached) {
    return { success: true, data: cached };
  }

  return thumbnailQueue.enqueue({
    key: `preview:${imagePath}`,
    imagePath,
    run: () => generatePreviewInternal(imagePath, false),
    priority: 'foreground',   // HTTP 请求阻塞等待
    notify: false,            // 预览档不发 thumbnail:generated（避免污染渲染层缩略图缓存）
  });
}

/**
 * 返回已存在的预览档路径；不存在返回 null。GIF 直接回源文件路径（无预览档产物）。
 */
export async function getPreviewIfExists(imagePath: string): Promise<string | null> {
  if (path.extname(imagePath).toLowerCase() === '.gif') {
    return imagePath;
  }
  try {
    const previewPath = await getTierCachePath('preview', imagePath);
    return (await thumbnailExists(previewPath)) ? previewPath : null;
  } catch {
    return null;
  }
}

/**
 * 删除某图片的预览档文件（ENOENT 容忍）。结构镜像 deleteThumbnail。
 * GIF 无预览档产物，previews 目录里恒无对应文件，unlink 命中 ENOENT 视为成功。
 */
export async function deletePreview(imagePath: string): Promise<{ success: boolean; error?: string }> {
  try {
    const previewPath = await getTierCachePath('preview', imagePath);
    await fs.unlink(previewPath);
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

    // 单目录清扫：thumbnails 与 previews 复用同一 validHashes 集合（两档同用 md5(源路径) 命名）。
    // 语义决策（写死）：invalid_images 引用的 hash 段命中的 preview 文件同样被保留——
    // 无害（图片修复回库后 preview 直接复用）、零额外集合，与缩略图目录的保护语义对称。
    const scanDir = async (dir: string): Promise<{ scanned: number; deleted: number; freedBytes: number }> => {
      let entries: string[] = [];
      try {
        entries = await fs.readdir(dir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return { scanned: 0, deleted: 0, freedBytes: 0 };
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
        const fullPath = path.join(dir, name);
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
      return { scanned, deleted, freedBytes };
    };

    const thumbResult = await scanDir(getThumbnailsPath());
    const previewResult = await scanDir(getPreviewsPath());
    const scanned = thumbResult.scanned + previewResult.scanned;
    const deleted = thumbResult.deleted + previewResult.deleted;
    const freedBytes = thumbResult.freedBytes + previewResult.freedBytes;

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
