import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { BrowserWindow } from 'electron';
import * as booruService from './booruService.js';
import { generateFileName, FileNameTokens } from './filenameGenerator.js';
import { getConfig, getProxyConfig, getDownloadsPath } from './config.js';
import { BooruPost, DownloadQueueItem } from '../../shared/types';

interface ActiveDownload {
  id: number; // Queue ID
  cancelToken: AbortController;
}

class DownloadManager {
  private activeDownloads: Map<number, ActiveDownload> = new Map();
  private isProcessing: boolean = false;
  private maxConcurrent: number = 3;

  constructor() {
    // 从配置加载最大并发数
    try {
      const config = getConfig();
      this.maxConcurrent = config.yande?.maxConcurrentDownloads || 3;
    } catch (e) {
      console.warn('[DownloadManager] 无法加载配置，使用默认并发数:', this.maxConcurrent);
    }
  }

  /**
   * 添加下载任务
   */
  async addToQueue(post: BooruPost, siteId: number): Promise<boolean> {
    try {
      // 1. 获取配置的下载路径
      // 1. 获取配置的下载路径
      // 使用 getDownloadsPath() 获取绝对路径，避免使用相对路径导致保存位置不确定
      const downloadPath = getDownloadsPath();
      
      // 2. 生成文件名
      // 默认模板: {site}_{id}_{tags}.{extension}
      // 这里简化处理，实际应该从配置读取模板
      const filenameTemplate = '{site}_{id}_{md5}.{extension}';
      
      const metadata: FileNameTokens = {
        id: post.postId,
        md5: post.md5,
        extension: post.fileExt,
        width: post.width,
        height: post.height,
        rating: post.rating,
        score: post.score,
        site: `site_${siteId}`, // 暂时用ID代替，理想情况应该查站点名
        tags: post.tags.replace(/\s+/g, '_').substring(0, 50) // 限制标签长度
      };
      
      const filename = generateFileName(filenameTemplate, metadata);
      const targetPath = path.join(downloadPath, filename);

      // 3. 添加到数据库队列
      await booruService.addToDownloadQueue(post.postId, siteId, 0, targetPath);
      
      // 4. 触发队列处理
      this.processQueue();
      
      return true;
    } catch (error) {
      console.error('[DownloadManager] 添加下载任务失败:', error);
      return false;
    }
  }

  /**
   * 处理下载队列
   */
  private async processQueue() {
    if (this.activeDownloads.size >= this.maxConcurrent) {
      return;
    }

    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      // 获取待下载项目
      const queue = await booruService.getDownloadQueue('pending');
      
      for (const item of queue) {
        if (this.activeDownloads.size >= this.maxConcurrent) {
          break;
        }

        // 开始下载
        this.startDownload(item);
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
      const post = await booruService.getBooruPostBySiteAndId(item.siteId, item.postId);
      if (!post) {
        throw new Error(`找不到帖子信息: ${item.postId}`);
      }

      // 确保目标目录存在
      const targetDir = path.dirname(item.targetPath!);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

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

      const writer = fs.createWriteStream(item.targetPath!);

      response.data.on('data', (chunk: Buffer) => {
        downloadedLength += chunk.length;
        
        // 限制更新频率 (每500ms)
        const now = Date.now();
        if (now - lastUpdate > 500) {
          const progress = totalLength > 0 ? Math.round((downloadedLength / totalLength) * 100) : 0;
          
          // 更新数据库 (可选，为了性能可以减少数据库写入)
          booruService.updateDownloadProgress(queueId, progress, downloadedLength, totalLength).catch(console.error);
          
          // 发送进度到前端
          this.broadcastProgress(queueId, progress, downloadedLength, totalLength);
          
          lastUpdate = now;
        }
      });

      writer.on('finish', async () => {
        console.log(`[DownloadManager] 下载完成 #${queueId}`);
        this.activeDownloads.delete(queueId);
        
        // 更新数据库状态
        await booruService.updateDownloadStatus(queueId, 'completed');
        await booruService.markPostAsDownloaded(item.postId, item.targetPath!);
        
        // 通知前端
        this.broadcastStatus(queueId, 'completed');
        
        // 继续处理队列
        this.processQueue();
      });

      writer.on('error', async (err) => {
        console.error(`[DownloadManager] 写入文件失败 #${queueId}:`, err);
        this.handleDownloadError(queueId, err.message);
      });

      response.data.pipe(writer);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[DownloadManager] 下载失败 #${queueId}:`, errorMessage);
      this.handleDownloadError(queueId, errorMessage);
    }
  }

  /**
   * 处理下载错误
   */
  private async handleDownloadError(queueId: number, errorMessage: string) {
    this.activeDownloads.delete(queueId);
    await booruService.updateDownloadStatus(queueId, 'failed', errorMessage);
    this.broadcastStatus(queueId, 'failed', errorMessage);
    this.processQueue();
  }

  /**
   * 广播进度
   */
  private broadcastProgress(id: number, progress: number, downloaded: number, total: number) {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      win.webContents.send('booru:download-progress', {
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
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      win.webContents.send('booru:download-status', {
        id,
        status,
        error
      });
    }
  }
}

// 导出单例
export const downloadManager = new DownloadManager();
