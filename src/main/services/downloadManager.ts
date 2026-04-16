import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import axios from 'axios';
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../ipc/channels.js';
import * as booruService from './booruService.js';
import { generateFileName, FileNameTokens } from './filenameGenerator.js';
import { getConfig, getProxyConfig, getDownloadsPath } from './config.js';
import { BooruPost, DownloadQueueItem } from '../../shared/types';
import { networkScheduler } from './networkScheduler.js';
import {
  buildDownloadTempPath,
  replaceFileWithTemp,
  validateDownloadedFileMd5,
  validateDownloadedFileSize,
} from './downloadFileProtocol.js';

/** 浏览模式下的最大并发数（让出带宽给图片预览） */
const BROWSING_MODE_CONCURRENCY = 1;

interface ActiveDownload {
  id: number; // Queue ID
  cancelToken: AbortController;
}

class DownloadManager {
  private activeDownloads: Map<number, ActiveDownload> = new Map();
  private isProcessing: boolean = false;
  private maxConcurrent: number = 3;
  private isPaused: boolean = false;
  private hasResumedOnStartup: boolean = false; // 标记是否已经在启动时恢复过
  private userInterruptedStatuses = new Map<number, 'paused'>();

  /** 缓存窗口引用，避免每次广播都调用 getAllWindows() */
  private cachedWindows: BrowserWindow[] = [];
  private cachedWindowsTime: number = 0;
  private static readonly WINDOW_CACHE_TTL = 5000; // 5秒缓存过期

  /** 获取缓存的窗口列表 */
  private getWindows(): BrowserWindow[] {
    const now = Date.now();
    if (now - this.cachedWindowsTime > DownloadManager.WINDOW_CACHE_TTL || this.cachedWindows.length === 0) {
      this.cachedWindows = BrowserWindow.getAllWindows();
      this.cachedWindowsTime = now;
    }
    // 过滤已销毁的窗口
    this.cachedWindows = this.cachedWindows.filter(w => !w.isDestroyed());
    return this.cachedWindows;
  }

  constructor() {
    // 从配置加载最大并发数
    try {
      const config = getConfig();
      this.maxConcurrent = config.yande?.maxConcurrentDownloads || 3;
    } catch (e) {
      console.warn('[DownloadManager] 无法加载配置，使用默认并发数:', this.maxConcurrent);
    }

    // 监听浏览模式变化：浏览结束后尝试恢复下载队列
    networkScheduler.onChange((isBrowsing) => {
      if (!isBrowsing && !this.isPaused && this.activeDownloads.size > 0) {
        console.log('[DownloadManager] 浏览模式结束，尝试填充下载队列');
        this.processQueue();
      }
    });
  }

  /**
   * 获取当前有效的最大并发数（浏览模式下自动降低）
   */
  private getEffectiveConcurrency(): number {
    if (networkScheduler.isBrowsingActive()) {
      return Math.min(BROWSING_MODE_CONCURRENCY, this.maxConcurrent);
    }
    return this.maxConcurrent;
  }

  /**
   * 恢复未完成的下载任务（程序启动时调用）
   * 只在首次调用时执行，后续调用会被忽略
   */
  async resumePendingDownloads(): Promise<{ resumed: number; total: number }> {
    if (this.hasResumedOnStartup) {
      console.log('[DownloadManager] 已经恢复过，跳过');
      return { resumed: 0, total: 0 };
    }

    this.hasResumedOnStartup = true;
    console.log('[DownloadManager] 开始恢复未完成的下载任务...');

    try {
      // 获取所有进行中和等待中的任务
      const downloadingQueue = await booruService.getDownloadQueue('downloading');
      const pendingQueue = await booruService.getDownloadQueue('pending');
      
      // 将 downloading 状态的任务重置为 pending（因为程序重启后需要重新下载）
      for (const item of downloadingQueue) {
        await booruService.updateDownloadStatus(item.id, 'pending');
        console.log(`[DownloadManager] 重置任务 #${item.id} 状态为 pending`);
      }

      const totalTasks = downloadingQueue.length + pendingQueue.length;
      
      if (totalTasks > 0) {
        console.log(`[DownloadManager] 发现 ${totalTasks} 个未完成任务，开始恢复...`);
        this.isPaused = false;
        this.processQueue();
      } else {
        console.log('[DownloadManager] 没有未完成的下载任务');
      }

      return { resumed: totalTasks, total: totalTasks };
    } catch (error) {
      console.error('[DownloadManager] 恢复未完成任务失败:', error);
      return { resumed: 0, total: 0 };
    }
  }

  /**
   * 暂停所有下载
   */
  async pauseAll(): Promise<boolean> {
    console.log('[DownloadManager] 暂停所有下载任务');
    this.isPaused = true;

    // 取消所有活跃的下载
    for (const [queueId, download] of this.activeDownloads) {
      try {
        this.userInterruptedStatuses.set(queueId, 'paused');
        download.cancelToken.abort();
        await booruService.updateDownloadStatus(queueId, 'paused');
        this.broadcastStatus(queueId, 'paused');
      } catch (error) {
        console.error(`[DownloadManager] 暂停任务 #${queueId} 失败:`, error);
      }
    }
    
    this.activeDownloads.clear();
    this.broadcastQueueStatus();
    return true;
  }

  /**
   * 恢复所有下载
   */
  async resumeAll(): Promise<boolean> {
    console.log('[DownloadManager] 恢复所有下载任务');
    this.isPaused = false;
    this.processQueue();
    this.broadcastQueueStatus();
    return true;
  }

  /**
   * 暂停单个下载任务
   */
  async pauseDownload(queueId: number): Promise<boolean> {
    console.log(`[DownloadManager] 暂停下载任务 #${queueId}`);
    
    try {
      const activeDownload = this.activeDownloads.get(queueId);
      if (activeDownload) {
        // 取消正在进行的下载
        this.userInterruptedStatuses.set(queueId, 'paused');
        activeDownload.cancelToken.abort();
        this.activeDownloads.delete(queueId);
      }

      // 更新数据库状态为 paused
      await booruService.updateDownloadStatus(queueId, 'paused');
      this.broadcastStatus(queueId, 'paused');

      // 继续处理队列中的其他任务
      this.processQueue();

      return true;
    } catch (error) {
      console.error(`[DownloadManager] 暂停任务 #${queueId} 失败:`, error);
      return false;
    }
  }

  /**
   * 恢复单个下载任务
   */
  async resumeDownload(queueId: number): Promise<boolean> {
    console.log(`[DownloadManager] 恢复下载任务 #${queueId}`);
    
    try {
      this.userInterruptedStatuses.delete(queueId);

      // 更新数据库状态为 pending
      await booruService.updateDownloadStatus(queueId, 'pending');
      this.broadcastStatus(queueId, 'pending');

      // 触发队列处理
      if (!this.isPaused) {
        this.processQueue();
      }

      return true;
    } catch (error) {
      console.error(`[DownloadManager] 恢复任务 #${queueId} 失败:`, error);
      return false;
    }
  }

  /**
   * 重试单个失败的下载任务
   * 重试前清除可能存在的损坏文件
   */
  async retryDownload(postId: number, siteId: number): Promise<boolean> {
    console.log(`[DownloadManager] 重试下载任务: postId=${postId}, siteId=${siteId}`);

    try {
      // 获取图片信息
      const post = await booruService.getBooruPostBySiteAndId(siteId, postId);
      if (!post) {
        console.error('[DownloadManager] 找不到图片信息:', postId);
        return false;
      }

      // 重新生成文件路径
      const downloadPath = getDownloadsPath();
      const targetPath = await this.generateDownloadFileName(post, siteId, downloadPath);

      // 重试前仅清除可能残留的临时文件，避免误删最终目标文件
      const tempPath = buildDownloadTempPath(targetPath);
      try {
        await fsPromises.access(tempPath);
        console.log(`[DownloadManager] 重试前清除损坏临时文件: ${tempPath}`);
        await fsPromises.unlink(tempPath);
      } catch (unlinkError: any) {
        // ENOENT 表示文件不存在，忽略；其他错误警告
        if (unlinkError?.code !== 'ENOENT') {
          console.warn(`[DownloadManager] 清除临时文件失败:`, unlinkError);
        }
      }

      // 更新数据库中的任务状态为 pending
      await booruService.addToDownloadQueue(postId, siteId, 0, targetPath);

      // 触发队列处理（如果没有暂停）
      if (!this.isPaused) {
        this.processQueue();
      }

      return true;
    } catch (error) {
      console.error('[DownloadManager] 重试下载失败:', error);
      return false;
    }
  }

  /**
   * 获取队列状态
   */
  getQueueStatus(): { isPaused: boolean; activeCount: number; maxConcurrent: number } {
    return {
      isPaused: this.isPaused,
      activeCount: this.activeDownloads.size,
      maxConcurrent: this.maxConcurrent
    };
  }

  /**
   * 广播队列状态变更
   */
  private broadcastQueueStatus() {
    const status = this.getQueueStatus();
    for (const win of this.getWindows()) {
      win.webContents.send(IPC_CHANNELS.BOORU_DOWNLOAD_QUEUE_STATUS, status);
    }
  }

  /**
   * 根据配置文件生成文件名
   * @param post Booru图片
   * @param siteId 站点ID
   * @param targetDir 目标目录
   */
  private async generateDownloadFileName(
    post: BooruPost,
    siteId: number,
    targetDir: string
  ): Promise<string> {
    try {
      // 1. 获取配置文件
      const config = getConfig();
      const booruConfig = config.booru;

      if (!booruConfig?.download?.filenameTemplate) {
        console.warn('[DownloadManager] 无法获取文件名模板配置，使用默认值');
      }

      const filenameTemplate = booruConfig?.download?.filenameTemplate || '{site}_{id}_{md5}.{extension}';
      const tokenDefaults = booruConfig?.download?.tokenDefaults || {};

      // 2. 获取站点信息
      const site = await booruService.getBooruSiteById(siteId);
      const siteName = site?.name || `site_${siteId}`;

      // 3. 准备文件元数据
      const metadata: FileNameTokens = {
        id: post.postId,
        md5: post.md5 || '',
        extension: post.fileExt || '',
        width: post.width,
        height: post.height,
        rating: post.rating || '',
        score: post.score,
        site: siteName,
        tags: post.tags || '',
        source: post.source || ''
      };

      // 4. 生成文件名
      const filename = generateFileName(filenameTemplate, metadata, tokenDefaults);
      const targetPath = path.join(targetDir, filename);

      console.log(`[DownloadManager] 生成文件名: ${filename}`);
      return targetPath;

    } catch (error) {
      console.error('[DownloadManager] 生成文件名失败:', error);
      // 失败时使用回退方案
      const fallbackName = `fallback_${post.postId}_${post.md5 || 'unknown'}.${post.fileExt || 'jpg'}`;
      return path.join(targetDir, fallbackName);
    }
  }

  /**
   * 添加下载任务
   */
  async addToQueue(post: BooruPost, siteId: number): Promise<boolean> {
    try {
      // 1. 获取配置的下载路径
      const downloadPath = getDownloadsPath();

      // 2. 生成文件名（使用配置模板）
      const targetPath = await this.generateDownloadFileName(post, siteId, downloadPath);

      // 3. 添加到数据库队列
      await booruService.addToDownloadQueue(post.postId, siteId, 0, targetPath);

      // 4. 触发队列处理
      this.processQueue();

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[DownloadManager] 添加下载任务失败:', errorMessage);
      return false;
    }
  }

  /**
   * 处理下载队列
   * 使用互斥锁防止并发调用导致下载数超过 maxConcurrent
   */
  private async processQueue() {
    // 如果队列已暂停，不处理新任务
    if (this.isPaused) {
      console.log('[DownloadManager] 队列已暂停，跳过处理');
      return;
    }

    // 互斥锁：防止多次快速调用导致竞态条件
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;

    try {
      // 循环填充空闲槽位，直到达到并发上限或没有更多待下载任务
      const effectiveConcurrency = this.getEffectiveConcurrency();
      while (this.activeDownloads.size < effectiveConcurrency && !this.isPaused) {
        const queue = await booruService.getDownloadQueue('pending');

        // 过滤掉已经在活跃下载中的任务
        const nextItem = queue.find(item => !this.activeDownloads.has(item.id));
        if (!nextItem) {
          break; // 没有更多待下载任务
        }

        // 同步注册到 activeDownloads 后再启动异步下载，确保不会超发
        this.startDownload(nextItem);
      }
    } catch (error) {
      console.error('[DownloadManager] 处理队列失败:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 开始单个下载
   */
  private async startDownload(item: DownloadQueueItem) {
    const queueId = item.id;
    
    if (this.activeDownloads.has(queueId)) {
      return;
    }

    const controller = new AbortController();
    this.activeDownloads.set(queueId, { id: queueId, cancelToken: controller });

    console.log(`[DownloadManager] 开始下载任务 #${queueId}: ${item.targetPath}`);

    try {
      // 更新状态为下载中
      await booruService.updateDownloadStatus(queueId, 'downloading');
      this.broadcastStatus(queueId, 'downloading');

      // 获取帖子信息以获取URL
      const post = await booruService.getBooruPostById(item.postId);
      if (!post) {
        throw new Error(`找不到帖子信息: ${item.postId}`);
      }

      // 确保目标目录存在
      const targetDir = path.dirname(item.targetPath!);
      await fsPromises.mkdir(targetDir, { recursive: true });

      // 配置请求
      const proxyConfig = getProxyConfig();
      const response = await axios({
        method: 'GET',
        url: post.fileUrl,
        responseType: 'stream',
        signal: controller.signal,
        proxy: proxyConfig,
        timeout: 60000, // 60秒超时
        headers: {
          'User-Agent': 'YandeGalleryDesktop/1.0.0'
        }
      });

      const totalLength = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedLength = 0;
      let lastUpdate = Date.now();
      const tempPath = buildDownloadTempPath(item.targetPath!);

      // 使用 Transform 流监控进度
      const { Transform } = await import('stream');
      const progressStream = new Transform({
        transform: (chunk: Buffer, _encoding: string, callback: Function) => {
          downloadedLength += chunk.length;

          // 限制更新频率 (每500ms)
          const now = Date.now();
          if (now - lastUpdate > 500) {
            const progress = totalLength > 0 ? Math.round((downloadedLength / totalLength) * 100) : 0;

            // 进度仅发送到前端，不写数据库（减少 I/O）
            this.broadcastProgress(queueId, progress, downloadedLength, totalLength);

            lastUpdate = now;
          }
          callback(null, chunk);
        }
      });

      const writer = fs.createWriteStream(tempPath);

      // 使用 pipeline 自动处理背压和错误传播
      await pipeline(response.data, progressStream, writer);

      const actualSize = (await fsPromises.stat(tempPath)).size;
      validateDownloadedFileSize(actualSize, totalLength > 0 ? totalLength : null);
      // 如果 Booru post 返回了 md5 指纹，就在替换最终文件前再做一次校验，
      // 防止中间人替换或代理/CDN 缓存污染导致的内容不一致。
      try {
        validateDownloadedFileMd5(tempPath, post.md5);
      } catch (md5Error) {
        // 校验失败时清理 .part 文件，不要保留到最终目录
        try {
          await fsPromises.unlink(tempPath);
        } catch {}
        throw md5Error;
      }
      replaceFileWithTemp(tempPath, item.targetPath!);

      // pipeline 成功完成
      console.log(`[DownloadManager] 下载完成 #${queueId}`);
      this.activeDownloads.delete(queueId);

      // 更新数据库状态（完成时写一次）
      await booruService.updateDownloadStatus(queueId, 'completed');
      await booruService.updateDownloadProgress(queueId, 100, actualSize, totalLength || actualSize).catch(console.error);
      await booruService.markPostAsDownloaded(post.id, item.targetPath!);

      // 通知前端
      this.broadcastStatus(queueId, 'completed');

      // 继续处理队列
      this.processQueue();

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[DownloadManager] 下载失败 #${queueId}:`, errorMessage);
      // 下载失败时清除可能存在的损坏文件（异步）
      try {
        if (item.targetPath) {
          await fsPromises.unlink(buildDownloadTempPath(item.targetPath));
          console.log(`[DownloadManager] 下载失败，已清除损坏临时文件: ${buildDownloadTempPath(item.targetPath)}`);
        }
      } catch (unlinkError: any) {
        if (unlinkError?.code !== 'ENOENT') {
          console.warn(`[DownloadManager] 清除损坏文件失败:`, unlinkError);
        }
      }
      this.handleDownloadError(queueId, errorMessage);
    }
  }

  /**
   * 处理下载错误
   * 注意：调用方应在调用此方法前清除损坏文件
   */
  private isAbortError(errorMessage: string): boolean {
    return errorMessage.includes('aborted') || errorMessage.includes('AbortError');
  }

  private async handleDownloadError(queueId: number, errorMessage: string) {
    this.activeDownloads.delete(queueId);

    const interruptedStatus = this.userInterruptedStatuses.get(queueId);
    if (interruptedStatus && this.isAbortError(errorMessage)) {
      this.userInterruptedStatuses.delete(queueId);
      this.processQueue();
      return;
    }

    this.userInterruptedStatuses.delete(queueId);
    await booruService.updateDownloadStatus(queueId, 'failed', errorMessage);
    this.broadcastStatus(queueId, 'failed', errorMessage);
    this.processQueue();
  }

  /**
   * 广播进度
   */
  private broadcastProgress(id: number, progress: number, downloaded: number, total: number) {
    for (const win of this.getWindows()) {
      win.webContents.send(IPC_CHANNELS.BOORU_DOWNLOAD_PROGRESS, {
        id,
        progress,
        downloadedBytes: downloaded,
        totalBytes: total
      });
    }
  }

  /**
   * 广播状态变更
   */
  private broadcastStatus(id: number, status: string, error?: string) {
    for (const win of this.getWindows()) {
      win.webContents.send(IPC_CHANNELS.BOORU_DOWNLOAD_STATUS, {
        id,
        status,
        error
      });
    }
  }
}

// 导出单例
export const downloadManager = new DownloadManager();
