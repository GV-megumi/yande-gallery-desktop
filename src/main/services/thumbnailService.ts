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
type ThumbnailResult = { success: boolean; data?: string; error?: string; missing?: boolean };

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
  private maxConcurrent: number = 3;

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
        if (this.notifyPaths.has(imagePath)) {
          emitThumbnailGenerated(imagePath, result);
        }

        resolve(result);
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (this.notifyPaths.has(imagePath)) {
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
