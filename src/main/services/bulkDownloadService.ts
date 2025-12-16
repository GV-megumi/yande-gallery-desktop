/**
 * 批量下载服务
 * 参考：Boorusama bulk_download_notifier.dart
 * 功能：
 * - 创建批量下载任务
 * - 管理下载会话
 * - 扫描页面并创建下载记录
 * - 执行批量下载
 */

import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { getDatabase, run, get, all } from './database.js';
import { getProxyConfig } from './config.js';
import { MoebooruClient } from './moebooruClient.js';
import { generateFileName, FileNameTokens } from './filenameGenerator.js';
import * as booruService from './booruService.js';
import { downloadManager } from './downloadManager.js';
import {
  BulkDownloadTask,
  BulkDownloadSession,
  BulkDownloadRecord,
  BulkDownloadOptions,
  BulkDownloadSessionStatus,
  BulkDownloadRecordStatus
} from '../../shared/types.js';
import { BooruPost } from '../../shared/types.js';

/**
 * 创建批量下载任务
 */
export async function createBulkDownloadTask(
  options: BulkDownloadOptions
): Promise<{ success: boolean; data?: BulkDownloadTask; error?: string }> {
  console.log('[bulkDownloadService] 创建批量下载任务:', options);
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const taskId = uuidv4();

    const task: BulkDownloadTask = {
      id: taskId,
      siteId: options.siteId,
      path: options.path,
      tags: options.tags.join(' '),
      blacklistedTags: options.blacklistedTags?.join(' '),
      notifications: options.notifications ?? true,
      skipIfExists: options.skipIfExists ?? true,
      quality: options.quality,
      perPage: options.perPage ?? 20,
      concurrency: options.concurrency ?? 3,
      createdAt: now,
      updatedAt: now
    };

    await run(db, `
      INSERT INTO bulk_download_tasks (
        id, siteId, path, tags, blacklistedTags, notifications, skipIfExists,
        quality, perPage, concurrency, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      task.id,
      task.siteId,
      task.path,
      task.tags,
      task.blacklistedTags || null,
      task.notifications ? 1 : 0,
      task.skipIfExists ? 1 : 0,
      task.quality || null,
      task.perPage,
      task.concurrency,
      task.createdAt,
      task.updatedAt
    ]);

    console.log('[bulkDownloadService] 任务创建成功:', taskId);
    return { success: true, data: task };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[bulkDownloadService] 创建任务失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 获取所有批量下载任务
 */
export async function getBulkDownloadTasks(): Promise<BulkDownloadTask[]> {
  console.log('[bulkDownloadService] 获取所有批量下载任务');
  try {
    const db = await getDatabase();
    const rows = await all<any>(db, `
      SELECT * FROM bulk_download_tasks ORDER BY createdAt DESC
    `);

    return rows.map(row => ({
      id: row.id,
      siteId: row.siteId,
      path: row.path,
      tags: row.tags,
      blacklistedTags: row.blacklistedTags,
      notifications: Boolean(row.notifications),
      skipIfExists: Boolean(row.skipIfExists),
      quality: row.quality,
      perPage: row.perPage,
      concurrency: row.concurrency,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  } catch (error) {
    console.error('[bulkDownloadService] 获取任务失败:', error);
    throw error;
  }
}

/**
 * 根据ID获取批量下载任务
 */
export async function getBulkDownloadTaskById(
  taskId: string
): Promise<BulkDownloadTask | null> {
  console.log('[bulkDownloadService] 获取批量下载任务:', taskId);
  try {
    const db = await getDatabase();
    const row = await get<any>(db, `
      SELECT * FROM bulk_download_tasks WHERE id = ?
    `, [taskId]);

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      siteId: row.siteId,
      path: row.path,
      tags: row.tags,
      blacklistedTags: row.blacklistedTags,
      notifications: Boolean(row.notifications),
      skipIfExists: Boolean(row.skipIfExists),
      quality: row.quality,
      perPage: row.perPage,
      concurrency: row.concurrency,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  } catch (error) {
    console.error('[bulkDownloadService] 获取任务失败:', error);
    throw error;
  }
}

/**
 * 更新批量下载任务
 */
export async function updateBulkDownloadTask(
  taskId: string,
  updates: Partial<BulkDownloadOptions>
): Promise<{ success: boolean; data?: BulkDownloadTask; error?: string }> {
  console.log('[bulkDownloadService] 更新批量下载任务:', taskId, updates);
  try {
    const db = await getDatabase();
    const task = await getBulkDownloadTaskById(taskId);
    if (!task) {
      return { success: false, error: '任务不存在' };
    }

    const now = new Date().toISOString();
    const updatedTask: BulkDownloadTask = {
      ...task,
      siteId: updates.siteId ?? task.siteId,
      path: updates.path ?? task.path,
      tags: updates.tags ? updates.tags.join(' ') : task.tags,
      blacklistedTags: updates.blacklistedTags 
        ? updates.blacklistedTags.join(' ') 
        : task.blacklistedTags,
      notifications: updates.notifications ?? task.notifications,
      skipIfExists: updates.skipIfExists ?? task.skipIfExists,
      quality: updates.quality ?? task.quality,
      perPage: updates.perPage ?? task.perPage,
      concurrency: updates.concurrency ?? task.concurrency,
      updatedAt: now
    };

    await run(db, `
      UPDATE bulk_download_tasks SET
        siteId = ?,
        path = ?,
        tags = ?,
        blacklistedTags = ?,
        notifications = ?,
        skipIfExists = ?,
        quality = ?,
        perPage = ?,
        concurrency = ?,
        updatedAt = ?
      WHERE id = ?
    `, [
      updatedTask.siteId,
      updatedTask.path,
      updatedTask.tags,
      updatedTask.blacklistedTags || null,
      updatedTask.notifications ? 1 : 0,
      updatedTask.skipIfExists ? 1 : 0,
      updatedTask.quality || null,
      updatedTask.perPage,
      updatedTask.concurrency,
      updatedTask.updatedAt,
      taskId
    ]);

    console.log('[bulkDownloadService] 任务更新成功:', taskId);
    return { success: true, data: updatedTask };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[bulkDownloadService] 更新任务失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 删除批量下载任务
 */
export async function deleteBulkDownloadTask(
  taskId: string
): Promise<{ success: boolean; error?: string }> {
  console.log('[bulkDownloadService] 删除批量下载任务:', taskId);
  try {
    const db = await getDatabase();
    
    // 检查是否有活跃的会话
    const activeSessions = await all<any>(db, `
      SELECT id FROM bulk_download_sessions 
      WHERE taskId = ? AND deletedAt IS NULL AND status != 'completed'
    `, [taskId]);

    if (activeSessions.length > 0) {
      return { 
        success: false, 
        error: '任务正在使用中，无法删除。请先完成或取消相关会话。' 
      };
    }

    await run(db, `DELETE FROM bulk_download_tasks WHERE id = ?`, [taskId]);

    console.log('[bulkDownloadService] 任务删除成功:', taskId);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[bulkDownloadService] 删除任务失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 创建批量下载会话
 */
export async function createBulkDownloadSession(
  taskId: string
): Promise<{ success: boolean; data?: BulkDownloadSession; error?: string }> {
  console.log('[bulkDownloadService] 创建批量下载会话:', taskId);
  try {
    const task = await getBulkDownloadTaskById(taskId);
    if (!task) {
      return { success: false, error: '任务不存在' };
    }

    const db = await getDatabase();
    const now = new Date().toISOString();
    const sessionId = uuidv4();

    const session: BulkDownloadSession = {
      id: sessionId,
      taskId: task.id,
      siteId: task.siteId,
      status: 'pending',
      startedAt: now,
      currentPage: 1,
      task
    };

    await run(db, `
      INSERT INTO bulk_download_sessions (
        id, taskId, siteId, status, startedAt, currentPage
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [
      session.id,
      session.taskId,
      session.siteId,
      session.status,
      session.startedAt,
      session.currentPage
    ]);

    console.log('[bulkDownloadService] 会话创建成功:', sessionId);
    return { success: true, data: session };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[bulkDownloadService] 创建会话失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 获取活跃的批量下载会话
 */
export async function getActiveBulkDownloadSessions(): Promise<BulkDownloadSession[]> {
  // 减少日志输出频率，避免控制台刷屏
  // console.log('[bulkDownloadService] 获取活跃的批量下载会话');
  try {
    const db = await getDatabase();
    const rows = await all<any>(db, `
      SELECT 
        s.*,
        t.id as task_id,
        t.siteId as task_siteId,
        t.path as task_path,
        t.tags as task_tags,
        t.blacklistedTags as task_blacklistedTags,
        t.notifications as task_notifications,
        t.skipIfExists as task_skipIfExists,
        t.quality as task_quality,
        t.perPage as task_perPage,
        t.concurrency as task_concurrency,
        t.createdAt as task_createdAt,
        t.updatedAt as task_updatedAt
      FROM bulk_download_sessions s
      INNER JOIN bulk_download_tasks t ON s.taskId = t.id
      WHERE s.deletedAt IS NULL AND s.status != 'completed'
      ORDER BY s.startedAt DESC
    `);

    return rows.map(row => {
      const task: BulkDownloadTask = {
        id: row.task_id,
        siteId: row.task_siteId,
        path: row.task_path,
        tags: row.task_tags,
        blacklistedTags: row.task_blacklistedTags,
        notifications: Boolean(row.task_notifications),
        skipIfExists: Boolean(row.task_skipIfExists),
        quality: row.task_quality,
        perPage: row.task_perPage,
        concurrency: row.task_concurrency,
        createdAt: row.task_createdAt,
        updatedAt: row.task_updatedAt
      };

      return {
        id: row.id,
        taskId: row.taskId,
        siteId: row.siteId,
        status: row.status as BulkDownloadSessionStatus,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        currentPage: row.currentPage,
        totalPages: row.totalPages,
        error: row.error,
        task
      };
    });
  } catch (error) {
    console.error('[bulkDownloadService] 获取会话失败:', error);
    throw error;
  }
}

/**
 * 更新会话状态
 */
export async function updateBulkDownloadSession(
  sessionId: string,
  updates: {
    status?: BulkDownloadSessionStatus;
    currentPage?: number;
    totalPages?: number;
    error?: string;
    completedAt?: string;
  }
): Promise<void> {
  console.log('[bulkDownloadService] 更新会话:', sessionId, updates);
  try {
    const db = await getDatabase();
    const setValues: string[] = [];
    const params: any[] = [];

    if (updates.status !== undefined) {
      setValues.push('status = ?');
      params.push(updates.status);
    }
    if (updates.currentPage !== undefined) {
      setValues.push('currentPage = ?');
      params.push(updates.currentPage);
    }
    if (updates.totalPages !== undefined) {
      setValues.push('totalPages = ?');
      params.push(updates.totalPages);
    }
    if (updates.error !== undefined) {
      setValues.push('error = ?');
      params.push(updates.error || null);
    }
    if (updates.completedAt !== undefined) {
      setValues.push('completedAt = ?');
      params.push(updates.completedAt || null);
    }

    if (setValues.length > 0) {
      params.push(sessionId);
      await run(db, `
        UPDATE bulk_download_sessions 
        SET ${setValues.join(', ')} 
        WHERE id = ? AND deletedAt IS NULL
      `, params);
    }
  } catch (error) {
    console.error('[bulkDownloadService] 更新会话失败:', error);
    throw error;
  }
}

/**
 * 创建下载记录
 */
export async function createBulkDownloadRecord(
  record: Omit<BulkDownloadRecord, 'createdAt'>
): Promise<void> {
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();

    await run(db, `
      INSERT OR IGNORE INTO bulk_download_records (
        url, sessionId, status, page, pageIndex, createdAt,
        fileName, extension, thumbnailUrl, sourceUrl
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      record.url,
      record.sessionId,
      record.status,
      record.page,
      record.pageIndex,
      now,
      record.fileName,
      record.extension || null,
      record.thumbnailUrl || null,
      record.sourceUrl || null
    ]);
  } catch (error) {
    console.error('[bulkDownloadService] 创建记录失败:', error);
    throw error;
  }
}

/**
 * 批量创建下载记录
 */
export async function createBulkDownloadRecords(
  records: Omit<BulkDownloadRecord, 'createdAt'>[]
): Promise<void> {
  if (records.length === 0) return;

  console.log('[bulkDownloadService] 批量创建下载记录:', records.length);
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();

    // 使用事务批量插入
    await run(db, 'BEGIN TRANSACTION');
    try {
      for (const record of records) {
        await run(db, `
          INSERT OR IGNORE INTO bulk_download_records (
            url, sessionId, status, page, pageIndex, createdAt,
            fileName, extension, thumbnailUrl, sourceUrl
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          record.url,
          record.sessionId,
          record.status,
          record.page,
          record.pageIndex,
          now,
          record.fileName,
          record.extension || null,
          record.thumbnailUrl || null,
          record.sourceUrl || null
        ]);
      }
      await run(db, 'COMMIT');
    } catch (error) {
      await run(db, 'ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('[bulkDownloadService] 批量创建记录失败:', error);
    throw error;
  }
}

/**
 * 获取会话的下载记录
 */
export async function getBulkDownloadRecordsBySession(
  sessionId: string,
  status?: BulkDownloadRecordStatus,
  page?: number
): Promise<BulkDownloadRecord[]> {
  try {
    const db = await getDatabase();
    let sql = `
      SELECT * FROM bulk_download_records 
      WHERE sessionId = ?
    `;
    const params: any[] = [sessionId];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (page !== undefined) {
      sql += ' AND page = ?';
      params.push(page);
    }

    sql += ' ORDER BY page ASC, pageIndex ASC';

    const rows = await all<any>(db, sql, params);

    return rows.map(row => ({
      url: row.url,
      sessionId: row.sessionId,
      status: row.status as BulkDownloadRecordStatus,
      page: row.page,
      pageIndex: row.pageIndex,
      createdAt: row.createdAt,
      fileSize: row.fileSize,
      fileName: row.fileName,
      extension: row.extension,
      error: row.error,
      downloadId: row.downloadId,
      headers: row.headers ? JSON.parse(row.headers) : undefined,
      thumbnailUrl: row.thumbnailUrl,
      sourceUrl: row.sourceUrl
    }));
  } catch (error) {
    console.error('[bulkDownloadService] 获取记录失败:', error);
    throw error;
  }
}

/**
 * 获取会话的统计信息
 */
export async function getBulkDownloadSessionStats(
  sessionId: string
): Promise<{
  total: number;
  completed: number;
  failed: number;
  pending: number;
}> {
  try {
    const db = await getDatabase();
    const rows = await all<any>(db, `
      SELECT status, COUNT(*) as count
      FROM bulk_download_records
      WHERE sessionId = ?
      GROUP BY status
    `, [sessionId]);

    const stats = {
      total: 0,
      completed: 0,
      failed: 0,
      pending: 0
    };

    for (const row of rows) {
      const count = row.count;
      stats.total += count;
      if (row.status === 'completed') {
        stats.completed = count;
      } else if (row.status === 'failed') {
        stats.failed = count;
      } else if (row.status === 'pending') {
        stats.pending = count;
      }
    }

    return stats;
  } catch (error) {
    console.error('[bulkDownloadService] 获取统计失败:', error);
    throw error;
  }
}

/**
 * 启动批量下载会话（Dry Run + 下载）
 */
export async function startBulkDownloadSession(
  sessionId: string
): Promise<{ success: boolean; error?: string }> {
  console.log('[bulkDownloadService] 启动批量下载会话:', sessionId);
  try {
    const db = await getDatabase();
    const sessionRow = await get<any>(db, `
      SELECT s.*, t.*
      FROM bulk_download_sessions s
      INNER JOIN bulk_download_tasks t ON s.taskId = t.id
      WHERE s.id = ? AND s.deletedAt IS NULL
    `, [sessionId]);

    if (!sessionRow) {
      return { success: false, error: '会话不存在' };
    }

    const task: BulkDownloadTask = {
      id: sessionRow.taskId,
      siteId: sessionRow.siteId,
      path: sessionRow.path,
      tags: sessionRow.tags,
      blacklistedTags: sessionRow.blacklistedTags,
      notifications: Boolean(sessionRow.notifications),
      skipIfExists: Boolean(sessionRow.skipIfExists),
      quality: sessionRow.quality,
      perPage: sessionRow.perPage,
      concurrency: sessionRow.concurrency,
      createdAt: sessionRow.createdAt,
      updatedAt: sessionRow.updatedAt
    };

    // 检查目录是否存在
    if (!fs.existsSync(task.path)) {
      await updateBulkDownloadSession(sessionId, {
        status: 'failed',
        error: '目录不存在: ' + task.path
      });
      return { success: false, error: '目录不存在' };
    }

    // 更新状态为 dryRun（扫描阶段）
    await updateBulkDownloadSession(sessionId, {
      status: 'dryRun',
      currentPage: 1
    });

    // 执行 Dry Run：扫描所有页面并创建记录
    const dryRunResult = await performDryRun(sessionId, task);
    if (!dryRunResult.success) {
      await updateBulkDownloadSession(sessionId, {
        status: 'failed',
        error: dryRunResult.error
      });
      return { success: false, error: dryRunResult.error };
    }

    // 检查是否有待下载的记录
    const pendingCount = await getBulkDownloadSessionStats(sessionId);
    if (pendingCount.pending === 0) {
      await updateBulkDownloadSession(sessionId, {
        status: 'allSkipped'
      });
      return { success: true };
    }

    // 更新状态为 running
    await updateBulkDownloadSession(sessionId, {
      status: 'running',
      totalPages: dryRunResult.totalPages
    });

    // 开始下载
    startDownloadingSession(sessionId, task).catch(error => {
      console.error('[bulkDownloadService] 下载过程出错:', error);
      updateBulkDownloadSession(sessionId, {
        status: 'failed',
        error: error.message
      });
    });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[bulkDownloadService] 启动会话失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 执行 Dry Run：扫描所有页面并创建下载记录
 */
async function performDryRun(
  sessionId: string,
  task: BulkDownloadTask
): Promise<{ success: boolean; totalPages?: number; error?: string }> {
  console.log('[bulkDownloadService] 开始 Dry Run:', sessionId);
  try {
    const site = await booruService.getBooruSiteById(task.siteId);
    if (!site) {
      return { success: false, error: '站点不存在' };
    }

    const client = new MoebooruClient({
      baseUrl: site.url,
      login: site.username,
      passwordHash: site.passwordHash
    });

    const tags = task.tags.split(' ').filter(t => t.trim());
    let currentPage = 1;
    let totalPages: number | undefined;
    let hasMore = true;

    while (hasMore) {
      // 更新当前页面
      await updateBulkDownloadSession(sessionId, {
        currentPage: currentPage
      });

      // 检查会话是否被取消
      const db = await getDatabase();
      const session = await get<any>(db, `
        SELECT status FROM bulk_download_sessions WHERE id = ?
      `, [sessionId]);
      if (session?.status !== 'dryRun') {
        console.log('[bulkDownloadService] Dry Run 被中断');
        break;
      }

      // 获取当前页的图片
      const posts = await client.getPosts({
        tags: tags,
        limit: task.perPage,
        page: currentPage
      });

      if (posts.length === 0) {
        hasMore = false;
        break;
      }

      // 如果没有设置总页数，尝试从响应中获取
      if (!totalPages && posts.length < task.perPage) {
        totalPages = currentPage;
      }

      // 创建下载记录
      const records: Omit<BulkDownloadRecord, 'createdAt'>[] = [];
      for (let i = 0; i < posts.length; i++) {
        const post = posts[i];
        const postId = post.id;
        const fileUrl = post.file_url || post.sample_url || post.preview_url;
        if (!fileUrl) continue;

        // 检查是否已下载（如果启用 skipIfExists）
        if (task.skipIfExists) {
          const existingPost = await booruService.getBooruPostBySiteAndId(task.siteId, postId);
          if (existingPost?.downloaded) {
            continue;
          }
        }

        // 生成文件名
        const fileName = await generateBulkDownloadFileName(post, task, site.name);

        // 检查文件是否已存在
        if (task.skipIfExists) {
          const filePath = path.join(task.path, fileName);
          if (fs.existsSync(filePath)) {
            continue;
          }
        }

        // 从 file_url 提取扩展名
        const extension = path.extname(fileUrl).slice(1) || 'jpg';
        
        records.push({
          url: fileUrl,
          sessionId: sessionId,
          status: 'pending',
          page: currentPage,
          pageIndex: i,
          fileName: fileName,
          extension: extension,
          thumbnailUrl: post.preview_url || post.sample_url,
          sourceUrl: post.source
        });
      }

      // 批量插入记录
      if (records.length > 0) {
        await createBulkDownloadRecords(records);
      }

      currentPage++;
      if (posts.length < task.perPage) {
        hasMore = false;
        if (!totalPages) {
          totalPages = currentPage - 1;
        }
      }

      // 限制最大页数（防止无限循环）
      if (currentPage > 1000) {
        console.warn('[bulkDownloadService] 达到最大页数限制，停止扫描');
        hasMore = false;
        totalPages = currentPage - 1;
      }
    }

    console.log('[bulkDownloadService] Dry Run 完成，总页数:', totalPages);
    return { success: true, totalPages: totalPages || currentPage - 1 };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[bulkDownloadService] Dry Run 失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 生成批量下载文件名
 */
async function generateBulkDownloadFileName(
  post: any,
  task: BulkDownloadTask,
  siteName: string
): Promise<string> {
  try {
    const { generateFileName } = await import('./filenameGenerator.js');
    const { getConfig } = await import('./config.js');

    const config = getConfig();
    const filenameTemplate = config.booru?.download?.filenameTemplate || '{site}_{id}_{md5:maxlength=8}.{extension}';
    const tokenDefaults = config.booru?.download?.tokenDefaults || {};

    // 从 file_url 提取扩展名
    const fileUrl = post.file_url || post.sample_url || post.preview_url || '';
    const extension = fileUrl ? path.extname(fileUrl).slice(1) || 'jpg' : 'jpg';
    
    // 转换 rating
    const ratingMap: Record<string, string> = {
      's': 'safe',
      'q': 'questionable',
      'e': 'explicit'
    };

    const metadata: FileNameTokens = {
      id: post.id,
      md5: post.md5 || '',
      extension: extension,
      width: post.width,
      height: post.height,
      rating: ratingMap[post.rating] || '',
      score: post.score,
      site: siteName,
      tags: post.tags || '',
      source: post.source || ''
    };

    return generateFileName(filenameTemplate, metadata, tokenDefaults);
  } catch (error) {
    console.error('[bulkDownloadService] 生成文件名失败:', error);
    // 回退方案
    // 从 file_url 提取扩展名
    const fileUrl = post.file_url || post.sample_url || post.preview_url || '';
    const extension = fileUrl ? path.extname(fileUrl).slice(1) || 'jpg' : 'jpg';
    return `${post.id}_${post.md5 || 'unknown'}.${extension}`;
  }
}

// 正在运行的下载会话映射（用于避免重复启动）
const activeDownloadSessions = new Set<string>();

/**
 * 开始下载会话中的所有记录
 */
async function startDownloadingSession(
  sessionId: string,
  task: BulkDownloadTask
): Promise<void> {
  console.log('[bulkDownloadService] 开始下载会话:', sessionId);
  
  // 如果已经在运行，直接返回
  if (activeDownloadSessions.has(sessionId)) {
    console.log('[bulkDownloadService] 会话已在下载中，跳过');
    return;
  }

  activeDownloadSessions.add(sessionId);

  try {
    // 并发下载（受任务配置的并发数限制）
    const concurrency = task.concurrency || 3;
    let activeCount = 0;

    const downloadNext = async () => {
      while (true) {
        // 检查会话状态
        const db = await getDatabase();
        const session = await get<any>(db, `
          SELECT status FROM bulk_download_sessions WHERE id = ?
        `, [sessionId]);
        
        if (session?.status !== 'running') {
          console.log('[bulkDownloadService] 会话已停止，停止下载');
          break;
        }

        // 获取待下载的记录（动态获取，支持重试）
        const pendingRecords = await getBulkDownloadRecordsBySession(sessionId, 'pending');
        
        if (pendingRecords.length === 0) {
          // 检查是否全部完成
          const stats = await getBulkDownloadSessionStats(sessionId);
          if (stats.completed + stats.failed === stats.total && activeCount === 0) {
            await updateBulkDownloadSession(sessionId, {
              status: 'completed',
              completedAt: new Date().toISOString()
            });
            break;
          }
          // 等待一段时间后重试
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        if (activeCount >= concurrency) {
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }

        // 获取第一个待下载的记录
        const record = pendingRecords[0];
        activeCount++;

        downloadRecord(record, task, sessionId).finally(() => {
          activeCount--;
          // 继续下载下一个
          downloadNext();
        });
      }
    };

    // 启动并发下载
    for (let i = 0; i < concurrency; i++) {
      downloadNext();
    }
  } finally {
    // 延迟移除，确保所有下载任务完成
    setTimeout(() => {
      activeDownloadSessions.delete(sessionId);
    }, 5000);
  }
}

/**
 * 下载单个记录
 */
async function downloadRecord(
  record: BulkDownloadRecord,
  task: BulkDownloadTask,
  sessionId: string
): Promise<void> {
  try {
    const db = await getDatabase();
    
    // 更新状态为 downloading
    await run(db, `
      UPDATE bulk_download_records 
      SET status = ? 
      WHERE url = ? AND sessionId = ?
    `, ['downloading', record.url, sessionId]);

    const filePath = path.join(task.path, record.fileName);
    
    // 确保目录存在
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 检查文件是否已存在
    if (task.skipIfExists && fs.existsSync(filePath)) {
      await run(db, `
        UPDATE bulk_download_records 
        SET status = ? 
        WHERE url = ? AND sessionId = ?
      `, ['completed', record.url, sessionId]);
      return;
    }

    // 使用 axios 下载
    const axios = (await import('axios')).default;
    const proxyConfig = getProxyConfig();
    
    const response = await axios({
      method: 'GET',
      url: record.url,
      responseType: 'stream',
      proxy: proxyConfig,
      timeout: 60000,
      headers: {
        'User-Agent': 'YandeGalleryDesktop/1.0.0'
      }
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    await new Promise<void>((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
      response.data.on('error', reject);
    });

    // 更新状态为 completed
    await run(db, `
      UPDATE bulk_download_records 
      SET status = ?, fileSize = ? 
      WHERE url = ? AND sessionId = ?
    `, ['completed', fs.statSync(filePath).size, record.url, sessionId]);

    // 更新或创建 booru_posts 记录
    // TODO: 这里需要从 URL 或其他方式获取 postId
    // 暂时跳过，因为需要额外的 API 调用

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[bulkDownloadService] 下载记录失败:', record.url, errorMessage);
    
    // 更新状态为 failed
    const db = await getDatabase();
    await run(db, `
      UPDATE bulk_download_records 
      SET status = ?, error = ? 
      WHERE url = ? AND sessionId = ?
    `, ['failed', errorMessage, record.url, sessionId]);
  }
}

/**
 * 暂停会话
 */
export async function pauseBulkDownloadSession(
  sessionId: string
): Promise<{ success: boolean; error?: string }> {
  console.log('[bulkDownloadService] 暂停会话:', sessionId);
  try {
    await updateBulkDownloadSession(sessionId, {
      status: 'paused'
    });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

/**
 * 取消会话
 */
export async function cancelBulkDownloadSession(
  sessionId: string
): Promise<{ success: boolean; error?: string }> {
  console.log('[bulkDownloadService] 取消会话:', sessionId);
  try {
    await updateBulkDownloadSession(sessionId, {
      status: 'cancelled'
    });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

/**
 * 删除会话
 */
export async function deleteBulkDownloadSession(
  sessionId: string
): Promise<{ success: boolean; error?: string }> {
  console.log('[bulkDownloadService] 删除会话:', sessionId);
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();
    await run(db, `
      UPDATE bulk_download_sessions 
      SET deletedAt = ? 
      WHERE id = ?
    `, [now, sessionId]);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

/**
 * 重试所有失败的记录
 */
export async function retryAllFailedRecords(
  sessionId: string
): Promise<{ success: boolean; error?: string }> {
  console.log('[bulkDownloadService] 重试所有失败的记录:', sessionId);
  try {
    const db = await getDatabase();
    
    // 获取会话和任务信息
    const sessionRow = await get<any>(db, `
      SELECT s.*, t.*
      FROM bulk_download_sessions s
      INNER JOIN bulk_download_tasks t ON s.taskId = t.id
      WHERE s.id = ? AND s.deletedAt IS NULL
    `, [sessionId]);

    if (!sessionRow) {
      return { success: false, error: '会话不存在' };
    }

    const task: BulkDownloadTask = {
      id: sessionRow.taskId,
      siteId: sessionRow.siteId,
      path: sessionRow.path,
      tags: sessionRow.tags,
      blacklistedTags: sessionRow.blacklistedTags,
      notifications: Boolean(sessionRow.notifications),
      skipIfExists: Boolean(sessionRow.skipIfExists),
      quality: sessionRow.quality,
      perPage: sessionRow.perPage,
      concurrency: sessionRow.concurrency,
      createdAt: sessionRow.createdAt,
      updatedAt: sessionRow.updatedAt
    };

    // 获取所有失败的记录
    const failedRecords = await getBulkDownloadRecordsBySession(sessionId, 'failed');
    
    if (failedRecords.length === 0) {
      return { success: true };
    }

    // 将所有失败的记录重置为 pending
    await run(db, `
      UPDATE bulk_download_records 
      SET status = ?, error = NULL 
      WHERE sessionId = ? AND status = ?
    `, ['pending', sessionId, 'failed']);

    // 如果会话已完成或失败，重新启动下载
    if (sessionRow.status === 'completed' || sessionRow.status === 'failed') {
      await updateBulkDownloadSession(sessionId, {
        status: 'running'
      });
      
      // 开始下载
      startDownloadingSession(sessionId, task).catch(error => {
        console.error('[bulkDownloadService] 重试下载过程出错:', error);
        updateBulkDownloadSession(sessionId, {
          status: 'failed',
          error: error.message
        });
      });
    } else if (sessionRow.status === 'running' || sessionRow.status === 'paused') {
      // 如果正在运行或暂停，直接继续下载（会处理新的 pending 记录）
      if (sessionRow.status === 'paused') {
        await updateBulkDownloadSession(sessionId, {
          status: 'running'
        });
      }
      // 继续下载会处理新的 pending 记录
      startDownloadingSession(sessionId, task).catch(error => {
        console.error('[bulkDownloadService] 继续下载过程出错:', error);
      });
    }

    console.log('[bulkDownloadService] 已重置', failedRecords.length, '个失败记录为待下载');
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[bulkDownloadService] 重试所有失败记录失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 重试单个失败的记录
 */
export async function retryFailedRecord(
  sessionId: string,
  recordUrl: string
): Promise<{ success: boolean; error?: string }> {
  console.log('[bulkDownloadService] 重试失败的记录:', sessionId, recordUrl);
  try {
    const db = await getDatabase();
    
    // 重置记录状态为 pending
    await run(db, `
      UPDATE bulk_download_records 
      SET status = ?, error = NULL 
      WHERE sessionId = ? AND url = ? AND status = ?
    `, ['pending', sessionId, recordUrl, 'failed']);

    // 获取会话和任务信息
    const sessionRow = await get<any>(db, `
      SELECT s.*, t.*
      FROM bulk_download_sessions s
      INNER JOIN bulk_download_tasks t ON s.taskId = t.id
      WHERE s.id = ? AND s.deletedAt IS NULL
    `, [sessionId]);

    if (!sessionRow) {
      return { success: false, error: '会话不存在' };
    }

    const task: BulkDownloadTask = {
      id: sessionRow.taskId,
      siteId: sessionRow.siteId,
      path: sessionRow.path,
      tags: sessionRow.tags,
      blacklistedTags: sessionRow.blacklistedTags,
      notifications: Boolean(sessionRow.notifications),
      skipIfExists: Boolean(sessionRow.skipIfExists),
      quality: sessionRow.quality,
      perPage: sessionRow.perPage,
      concurrency: sessionRow.concurrency,
      createdAt: sessionRow.createdAt,
      updatedAt: sessionRow.updatedAt
    };

    // 获取重置后的记录
    const record = await get<any>(db, `
      SELECT * FROM bulk_download_records 
      WHERE sessionId = ? AND url = ?
    `, [sessionId, recordUrl]);

    if (!record) {
      return { success: false, error: '记录不存在' };
    }

    const recordToDownload: BulkDownloadRecord = {
      url: record.url,
      sessionId: record.sessionId,
      status: record.status as BulkDownloadRecordStatus,
      page: record.page,
      pageIndex: record.pageIndex,
      createdAt: record.createdAt,
      fileSize: record.fileSize,
      fileName: record.fileName,
      extension: record.extension,
      error: record.error,
      downloadId: record.downloadId,
      headers: record.headers ? JSON.parse(record.headers) : undefined,
      thumbnailUrl: record.thumbnailUrl,
      sourceUrl: record.sourceUrl
    };

    // 如果会话未运行，启动下载会话
    if (sessionRow.status !== 'running') {
      await updateBulkDownloadSession(sessionId, {
        status: 'running'
      });
      // 启动下载会话（会自动处理 pending 记录）
      startDownloadingSession(sessionId, task).catch((error: Error) => {
        console.error('[bulkDownloadService] 启动下载会话失败:', error);
      });
    } else {
      // 如果已经在运行，直接下载这个记录
      downloadRecord(recordToDownload, task, sessionId).catch((error: Error) => {
        console.error('[bulkDownloadService] 重试下载记录失败:', error);
      });
    }

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[bulkDownloadService] 重试失败记录失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

