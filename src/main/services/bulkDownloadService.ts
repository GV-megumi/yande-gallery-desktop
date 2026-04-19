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
import type sqlite3 from 'sqlite3';
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../ipc/channels.js';
import { getDatabase, run, runWithChanges, get, all } from './database.js';
import { getProxyConfig, getMaxConcurrentBulkDownloadSessions } from './config.js';
import { createBooruClient } from './booruClientFactory.js';
import { generateFileName, FileNameTokens } from './filenameGenerator.js';
import * as booruService from './booruService.js';
import { downloadManager } from './downloadManager.js';
import { networkScheduler } from './networkScheduler.js';
import {
  BulkDownloadTask,
  BulkDownloadSession,
  BulkDownloadRecord,
  BulkDownloadOptions,
  BulkDownloadSessionStatus,
  BulkDownloadRecordStatus
} from '../../shared/types.js';
import { BooruPost } from '../../shared/types.js';
import {
  buildDownloadTempPath,
  replaceFileWithTemp,
  validateDownloadedFileSize,
} from './downloadFileProtocol.js';
import { notifyBulkSession } from './notificationService.js';

function parseContentLengthHeader(contentLength: unknown): number | null {
  if (typeof contentLength !== 'string' || contentLength.trim() === '') {
    return null;
  }

  const parsed = Number.parseInt(contentLength, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const DESKTOP_NOTIFICATION_STATUSES = new Set<BulkDownloadSessionStatus>([
  'completed',
  'failed',
  'allSkipped',
]);

function isDesktopNotificationStatus(status: BulkDownloadSessionStatus | undefined): status is 'completed' | 'failed' | 'allSkipped' {
  return typeof status === 'string' && DESKTOP_NOTIFICATION_STATUSES.has(status as 'completed' | 'failed' | 'allSkipped');
}

async function getBulkDownloadSessionNotificationContext(sessionId: string): Promise<{
  previousStatus: BulkDownloadSessionStatus;
  notificationsEnabled: boolean;
  tags: string;
  originType?: BulkDownloadSession['originType'] | null;
  error?: string | null;
} | null> {
  const db = await getDatabase();
  const sessionRow = await get<any>(db, `
    SELECT s.status, s.originType, s.error, t.notifications, t.tags
    FROM bulk_download_sessions s
    INNER JOIN bulk_download_tasks t ON s.taskId = t.id
    WHERE s.id = ? AND s.deletedAt IS NULL
  `, [sessionId]);

  if (!sessionRow) {
    return null;
  }

  return {
    previousStatus: sessionRow.status as BulkDownloadSessionStatus,
    notificationsEnabled: Boolean(sessionRow.notifications),
    tags: sessionRow.tags,
    originType: sessionRow.originType ?? null,
    error: sessionRow.error ?? null,
  };
}

// bug9：showDesktopNotificationForSession / focusExistingMainWindowFromNotification
// 已抽到 src/main/services/notificationService.ts（notifyBulkSession + 三级开关判断）。
// 任务级 notifications 开关从旧实现里的调用方上移成 notifyBulkSession 的 taskLevelEnabled 参数。

/**
 * 标签集合标准化：去空格、去重、排序后以空格拼接
 * 作为批量下载任务去重的唯一键组成部分（path + normalizedTags）
 */
export function normalizeTagSet(tags: string[]): string {
  return [...new Set(tags.map(tag => tag.trim()).filter(Boolean))].sort().join(' ');
}

/**
 * 创建批量下载任务
 * 如果已存在相同 path + 标签集合的任务，返回已有任务并标记 deduplicated
 */
export async function createBulkDownloadTask(
  options: BulkDownloadOptions
): Promise<{ success: boolean; data?: BulkDownloadTask; error?: string }> {
  console.log('[bulkDownloadService] 创建批量下载任务:', options);
  try {
    const db = await getDatabase();
    const normalizedTags = normalizeTagSet(options.tags);

    // 去重检查：相同下载路径 + 标签集合视为同一任务
    const existing = await get<any>(db, `
      SELECT * FROM bulk_download_tasks WHERE path = ? AND tags = ? ORDER BY createdAt DESC LIMIT 1
    `, [options.path, normalizedTags]);

    if (existing) {
      console.log('[bulkDownloadService] 发现已有相同任务，跳过创建:', existing.id);
      const deduplicatedTask: BulkDownloadTask = {
        id: existing.id,
        siteId: existing.siteId,
        path: existing.path,
        tags: existing.tags,
        blacklistedTags: existing.blacklistedTags,
        notifications: Boolean(existing.notifications),
        skipIfExists: Boolean(existing.skipIfExists),
        quality: existing.quality,
        perPage: existing.perPage,
        concurrency: existing.concurrency,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
        deduplicated: true
      };
      return { success: true, data: deduplicatedTask };
    }

    const now = new Date().toISOString();
    const taskId = uuidv4();

    const task: BulkDownloadTask = {
      id: taskId,
      siteId: options.siteId,
      path: options.path,
      tags: normalizedTags,
      blacklistedTags: options.blacklistedTags?.join(' '),
      notifications: options.notifications ?? true,
      skipIfExists: options.skipIfExists ?? true,
      quality: options.quality,
      perPage: options.perPage ?? 200,
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
 *
 * 去重：若 taskId 已存在活跃会话（pending / queued / dryRun / running / paused），
 * 不再 INSERT 新行，而是直接返回已存在的会话并带 deduplicated:true。
 * 上游（UI 的"开始"按钮、booruService.startFavoriteTagBulkDownload）可根据
 * 此标记决定是否跳过后续 startBulkDownloadSession。
 */
export async function createBulkDownloadSession(
  taskId: string
): Promise<{ success: boolean; data?: BulkDownloadSession; deduplicated?: boolean; error?: string }> {
  console.log('[bulkDownloadService] 创建批量下载会话:', taskId);
  try {
    const task = await getBulkDownloadTaskById(taskId);
    if (!task) {
      return { success: false, error: '任务不存在' };
    }

    const db = await getDatabase();

    // 活跃会话去重 + 防并发：把 "查活跃 → INSERT" 夹进调度器锁里串行执行，
    // 避免两次并发的 createSession 都读到空表再双双 INSERT（连点/多进程竞态）。
    //
    // 复用 schedulerMutex：createSession 不会被持有该锁的代码反向调用
    // （promoteNextQueued / startBulkDownloadSession 的锁内只做状态翻转），
    // 没有再入风险；锁粒度够细，不会阻塞下载主流程。
    const outcome = await withScheduler(async () => {
      const existing = await get<any>(
        db,
        `SELECT id, taskId, siteId, status, startedAt, completedAt, currentPage, totalPages, error
           FROM bulk_download_sessions
          WHERE taskId = ?
            AND deletedAt IS NULL
            AND status IN ('pending', 'queued', 'dryRun', 'running', 'paused')
          ORDER BY COALESCE(startedAt, rowid) ASC
          LIMIT 1`,
        [taskId],
      );
      if (existing) {
        return { kind: 'existing' as const, row: existing };
      }

      const now = new Date().toISOString();
      const sessionId = uuidv4();
      await run(
        db,
        `INSERT INTO bulk_download_sessions (
           id, taskId, siteId, status, startedAt, currentPage
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [sessionId, task.id, task.siteId, 'pending', now, 1],
      );
      return { kind: 'created' as const, sessionId, startedAt: now };
    });

    if (outcome.kind === 'existing') {
      console.log('[bulkDownloadService] 已存在活跃会话，跳过创建:', outcome.row.id);
      const existingSession: BulkDownloadSession = {
        id: outcome.row.id,
        taskId: outcome.row.taskId,
        siteId: outcome.row.siteId,
        status: outcome.row.status as BulkDownloadSessionStatus,
        startedAt: outcome.row.startedAt,
        completedAt: outcome.row.completedAt,
        currentPage: outcome.row.currentPage,
        totalPages: outcome.row.totalPages,
        error: outcome.row.error,
        task,
      };
      return { success: true, data: existingSession, deduplicated: true };
    }

    const session: BulkDownloadSession = {
      id: outcome.sessionId,
      taskId: task.id,
      siteId: task.siteId,
      status: 'pending',
      startedAt: outcome.startedAt,
      currentPage: 1,
      task,
    };
    console.log('[bulkDownloadService] 会话创建成功:', outcome.sessionId);
    return { success: true, data: session };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[bulkDownloadService] 创建会话失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 获取活跃的批量下载会话（包括已完成的会话）
 * 返回所有未删除的会话，让前端自行过滤显示
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
      WHERE s.deletedAt IS NULL
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
 * 判断某个批量下载任务当前是否有活跃会话（pending / dryRun / running / paused）。
 * 用于上游判定 "已存在任务模板 && 仍有进行中的会话" 时跳过重复启动；
 * 若任务模板存在但所有会话都已完成/失败/取消/软删，则允许复用任务模板启动新会话。
 */
export async function hasActiveSessionForTask(taskId: string): Promise<boolean> {
  const db = await getDatabase();
  const row = await get<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM bulk_download_sessions
     WHERE taskId = ?
       AND deletedAt IS NULL
       AND status IN ('pending', 'dryRun', 'running', 'paused')`,
    [taskId],
  );
  return (row?.n ?? 0) > 0;
}

/**
 * 当前 active = dryRun | running 的会话数（用于并发闸门判定）。
 * 注意：pending/queued/paused 不计入，因为它们不占用实际下载槽位。
 */
export async function countActiveSessions(): Promise<number> {
  const db = await getDatabase();
  const row = await get<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM bulk_download_sessions
     WHERE deletedAt IS NULL AND status IN ('dryRun', 'running')`,
  );
  return row?.n ?? 0;
}

/**
 * 调度器锁：保证 "查活跃数 + 置 queued / 进入 dryRun" 这对操作串行，
 * 避免多个 startBulkDownloadSession 并发撞上同一空槽。
 * 使用 Promise 链串行化，失败不阻塞后续任务（catch 后回到 resolved）。
 */
let schedulerMutex: Promise<unknown> = Promise.resolve();
function withScheduler<T>(fn: () => Promise<T>): Promise<T> {
  const next = schedulerMutex.then(() => fn());
  // 即使 next reject，也让 mutex 回到 resolved，避免阻塞后续调度
  schedulerMutex = next.catch(() => undefined);
  return next;
}

/**
 * 取第一个 queued 会话 id（FIFO）。
 *
 * FIFO 顺序来源：
 * - session.id 是 uuid v4（见 createBulkDownloadSession），完全随机，
 *   按 id 排序不能保证插入顺序。bulk_download_sessions 也没有 createdAt
 *   列，加列涉及 schema 迁移，代价过大。
 * - SQLite 每张普通表都带一个隐式的 rowid，它按 INSERT 先后单调递增，
 *   天然就是"入表顺序"。对 queued 的 FIFO 语义来说正是需要的。
 * - startedAt 在从 pending 迁 queued 的路径上可能为 null（例如 init.ts
 *   启动恢复时直接打 queued），所以用 COALESCE(startedAt, rowid) 兜底，
 *   既尊重已有 startedAt 的历史行，又能在缺失时回退到 rowid FIFO。
 *
 * 这是一个 0 schema 迁移的最小侵入修法。
 */
async function getNextQueuedSessionId(): Promise<string | null> {
  const db = await getDatabase();
  const row = await get<{ id: string }>(
    db,
    `SELECT id FROM bulk_download_sessions
     WHERE deletedAt IS NULL AND status = 'queued'
     ORDER BY COALESCE(startedAt, rowid) ASC
     LIMIT 1`,
  );
  return row?.id ?? null;
}

/**
 * 若有空槽，取下一个 queued 会话重新进入 startBulkDownloadSession。
 * - 锁内执行 "计数 + 取下一个 + 置 pending"，避免并发撞同一空槽；
 * - 锁外再调用 startBulkDownloadSession（会再次过闸门），避免阻塞当前 finally。
 */
export async function promoteNextQueued(): Promise<void> {
  const nextId = await withScheduler(async () => {
    const max = getMaxConcurrentBulkDownloadSessions();
    const active = await countActiveSessions();
    if (active >= max) return null;
    const id = await getNextQueuedSessionId();
    if (!id) return null;
    // 在锁内把状态改回 pending，避免再被 getNextQueuedSessionId 取到
    await updateBulkDownloadSession(id, { status: 'pending' });
    return id;
  });
  if (!nextId) return;
  // 递归调用：startBulkDownloadSession 内部会再过闸门
  // 不 await，避免阻塞当前 finally
  startBulkDownloadSession(nextId).catch(err => {
    console.error('[bulkDownloadService] promoteNextQueued 启动失败:', err);
  });
}

/**
 * 看门：session 从非 running 状态翻入 running 前调用。
 *
 * 必须在 withScheduler 锁内被调用 —— 本函数不再自己包锁，避免嵌套调度。
 * 调用方：startBulkDownloadSession（已在锁内）/ retryAllFailedRecords /
 * retryFailedRecord / resumeRunningSessions。
 *
 * 行为：
 * 1. 查同 taskId 下是否还存在别的活跃 session（pending/queued/dryRun/running/paused）。
 *    - 命中：
 *      - selfIsHistory=true（retry 场景，本 session 当前在 history）→ 软删本 session，返回 selfSoftDeleted:true；
 *      - selfIsHistory=false（正常推进）→ 不动本 session，返回 selfSoftDeleted:false；由调用方决定降级。
 * 2. 无冲突：软删同 taskId 下所有其他 history session（completed/failed/cancelled/allSkipped）。
 * 3. 返回 ok:true，调用方继续翻入 running。
 */
export async function ensureCanEnterRunning(
  db: sqlite3.Database,
  sessionId: string,
  taskId: string,
  opts: { selfIsHistory: boolean }
): Promise<
  | { ok: true }
  | {
      ok: false;
      reason: 'hasActive';
      activeSessionId: string;
      selfSoftDeleted: boolean;
    }
> {
  // 1. 活跃冲突探测
  const activeRow = await get<{ id: string }>(
    db,
    `SELECT id FROM bulk_download_sessions
      WHERE taskId = ? AND id != ? AND deletedAt IS NULL
        AND status IN ('pending', 'queued', 'dryRun', 'running', 'paused')
      LIMIT 1`,
    [taskId, sessionId]
  );

  if (activeRow) {
    if (opts.selfIsHistory) {
      const now = new Date().toISOString();
      await run(
        db,
        `UPDATE bulk_download_sessions SET deletedAt = ? WHERE id = ?`,
        [now, sessionId]
      );
      return {
        ok: false,
        reason: 'hasActive',
        activeSessionId: activeRow.id,
        selfSoftDeleted: true,
      };
    }
    return {
      ok: false,
      reason: 'hasActive',
      activeSessionId: activeRow.id,
      selfSoftDeleted: false,
    };
  }

  // 2. 无冲突：软删同 taskId 下所有其他 history
  const now = new Date().toISOString();
  await run(
    db,
    `UPDATE bulk_download_sessions
        SET deletedAt = ?
      WHERE taskId = ? AND id != ? AND deletedAt IS NULL
        AND status IN ('completed', 'failed', 'cancelled', 'allSkipped')`,
    [now, taskId, sessionId]
  );

  return { ok: true };
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
    const nextStatus = updates.status;
    const notificationContext = isDesktopNotificationStatus(nextStatus)
      ? await getBulkDownloadSessionNotificationContext(sessionId)
      : null;
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

    if (
      notificationContext
      && isDesktopNotificationStatus(nextStatus)
      && notificationContext.previousStatus !== nextStatus
    ) {
      // bug9：三级 AND 判断（全局 enabled / byStatus[status] / 任务级）由 notifyBulkSession 内部完成。
      // 任务级开关（notificationContext.notificationsEnabled）作为参数下沉，保留"任务上关通知 => 不弹"语义。
      notifyBulkSession({
        status: nextStatus,
        tags: notificationContext.tags,
        originType: notificationContext.originType,
        error: updates.error ?? notificationContext.error,
        sessionId,
        taskLevelEnabled: notificationContext.notificationsEnabled,
      });
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
 * @param autoFix 是否自动修复状态不一致的记录（文件已存在但状态不对）
 */
export async function getBulkDownloadRecordsBySession(
  sessionId: string,
  status?: BulkDownloadRecordStatus,
  page?: number,
  autoFix: boolean = false
): Promise<BulkDownloadRecord[]> {
  try {
    const db = await getDatabase();
    
    // 如果需要自动修复，先获取会话和任务信息
    let task: BulkDownloadTask | null = null;
    if (autoFix) {
      const sessionRow = await get<any>(db, `
        SELECT s.*, t.*
        FROM bulk_download_sessions s
        INNER JOIN bulk_download_tasks t ON s.taskId = t.id
        WHERE s.id = ? AND s.deletedAt IS NULL
      `, [sessionId]);
      
      if (sessionRow) {
        task = {
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
      }
    }
    
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

    const records = rows.map(row => ({
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
      sourceUrl: row.sourceUrl,
      progress: row.progress || 0,
      downloadedBytes: row.downloadedBytes || 0,
      totalBytes: row.totalBytes || 0
    }));

    // 自动修复：只在明确启用时才执行（避免每次打开详情页都触发大量 HEAD 请求）
    // 注意：修复应该作为兜底机制，主要依赖下载完成时的状态更新
    if (autoFix && task) {
      const recordsToFix = records.filter(r => 
        (r.status === 'downloading' || r.status === 'pending') && r.fileName
      );
      
      if (recordsToFix.length > 0) {
        console.log(`[bulkDownloadService] 手动修复：检查 ${recordsToFix.length} 条记录的状态一致性...`);
        
        // 限制并发修复数量，避免同时发起太多 HEAD 请求
        const maxConcurrentFixes = 3;
        const fixPromises: Promise<void>[] = [];

        for (let i = 0; i < recordsToFix.length; i++) {
          const record = recordsToFix[i];

          // 如果达到并发限制，等待一个完成后移除
          if (fixPromises.length >= maxConcurrentFixes) {
            const resolved = await Promise.race(
              fixPromises.map((p, idx) => p.then(() => idx))
            );
            fixPromises.splice(resolved, 1);
          }
          
          const fixPromise = (async () => {
            const filePath = path.join(task.path, record.fileName);
            if (fs.existsSync(filePath)) {
              try {
                const fileSize = fs.statSync(filePath).size;
                if (fileSize > 0) {
                  // 文件存在且不为空，尝试验证完整性
                  try {
                    const axios = (await import('axios')).default;
                    const proxyConfig = getProxyConfig();
                    const headResponse = await axios.head(record.url, {
                      proxy: proxyConfig,
                      timeout: 5000, // 5秒超时，快速检查
                      headers: {
                        'User-Agent': 'YandeGalleryDesktop/1.0.0'
                      }
                    });
                    
                    const serverSize = parseContentLengthHeader(headResponse.headers['content-length']);

                    if (serverSize !== null && fileSize === serverSize) {
                      // 文件完整，修复状态
                      console.log(`[bulkDownloadService] 修复状态: ${record.fileName} (文件已完整)`);
                      await run(db, `
                        UPDATE bulk_download_records 
                        SET status = ?, fileSize = ?, progress = 100, downloadedBytes = ?, totalBytes = ?
                        WHERE url = ? AND sessionId = ?
                      `, ['completed', fileSize, fileSize, serverSize, record.url, sessionId]);
                      
                      // 更新返回的记录状态
                      record.status = 'completed';
                      record.fileSize = fileSize;
                      record.progress = 100;
                      record.downloadedBytes = fileSize;
                      record.totalBytes = serverSize;
                    }
                  } catch (headError) {
                    console.warn(`[bulkDownloadService] 修复状态时无法验证文件完整性，保留原状态: ${record.fileName}`);
                  }
                }
              } catch (statError) {
                // 文件检查失败，跳过
              }
            }
          })();
          
          fixPromises.push(fixPromise);
        }
        
        // 等待所有修复完成
        await Promise.all(fixPromises);
        console.log(`[bulkDownloadService] 修复完成`);
      }
    }

    return records;
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
 *
 * 返回值约定：
 * - `queued: true`：该会话被闸门拦下打成 queued，或命中 queued 幂等分支
 *   （noop：已在队列中再次被外部 start 调用）。调用方据此可以直接弹
 *   "已加入队列" 的提示，而不需要再查一次 active sessions 去推断
 *   —— 后者存在 "查之前 promoteNextQueued 已把它推出队列" 的 race 漏弹。
 * - `queued: false` / 字段缺失：走正常 dryRun / running / 复用活跃
 *   会话的成功路径，不弹队列提示。
 * - `success: false`：启动失败（目录不存在 / 会话不存在 / Dry Run 失败）。
 */
export async function startBulkDownloadSession(
  sessionId: string
): Promise<{ success: boolean; queued?: boolean; error?: string }> {
  console.log('[bulkDownloadService] 启动批量下载会话:', sessionId);

  const existingStartPromise = activeSessionStartPromises.get(sessionId);
  if (existingStartPromise) {
    console.log('[bulkDownloadService] 会话启动中，复用现有启动流程');
    return existingStartPromise;
  }

  const startPromise = (async (): Promise<{ success: boolean; queued?: boolean; error?: string }> => {
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
        promoteNextQueued().catch(err => console.error('[bulkDownloadService] promoteNextQueued failed:', err));
        return { success: false, error: '目录不存在' };
      }

      const currentStatus = sessionRow.status as BulkDownloadSessionStatus;

      if (currentStatus === 'dryRun') {
        console.log('[bulkDownloadService] 会话正在 Dry Run，忽略重复启动');
        return { success: true };
      }

      if (currentStatus === 'running') {
        console.log('[bulkDownloadService] 会话已在运行，保持现有生命周期');
        const activePromise = activeDownloadSessionPromises.get(sessionId);
        if (!activePromise) {
          // 运行中但内存里没有活跃下载循环，说明可能是旧循环已退出或留下了僵尸 downloading 记录。
          // 先把悬挂中的 in-flight 记录重置回 pending，再幂等拉起下载循环，避免卡在 running + downloading 的忙等状态。
          await resetInFlightRecordsToPending(sessionId);
          startDownloadingSession(sessionId, task)
            .catch(error => {
              console.error('[bulkDownloadService] 下载过程出错:', error);
              return updateBulkDownloadSession(sessionId, {
                status: 'failed',
                error: error.message
              });
            })
            .finally(() => {
              promoteNextQueued().catch(err => {
                console.error('[bulkDownloadService] promoteNextQueued failed:', err);
              });
            });
        }
        return { success: true };
      }

      if (currentStatus === 'queued') {
        // queued 会话由 promoteNextQueued 调度器负责推进，此处仅在调度器调用时
        // （status 已被 promoteNextQueued 改回 pending）才会往下走；外部重复调用
        // 命中这里属于 noop，仍返回 queued: true 以便 UI 复述 "已加入队列" 状态，
        // 避免调用方靠 "创建后再查 status" 产生 race（短暂被 promoteNextQueued
        // 提升到 pending 就会漏弹）。
        console.log('[bulkDownloadService] 会话当前仍在队列中，忽略外部 start 调用');
        return { success: true, queued: true };
      }

      // ── 并发闸门 + 同 taskId 去重：锁内串行化 ──
      //
      // 1) ensureCanEnterRunning：拦住 "同 taskId 已经在跑另一条" 的情况，
      //    并顺手清掉同 taskId 下的历史记录（不变量：history 最多 1 条）。
      // 2) 并发闸门：超上限时打成 queued；否则在锁内就把 dryRun 槽位预留好。
      //
      // 反模式回归守卫（bug7-I1）：
      // 旧实现只在锁内做 "满了就打 queued"，释放锁后再把当前会话写成 dryRun。
      // 两次并发 start 会在锁外的 "dryRun 置位" 发生前都看到同一个 active 计数，
      // 双双通过闸门，超出并发上限。
      //
      // 修复思路：countActiveSessions 的 SQL 口径是 status IN ('dryRun','running')，
      // 所以把 "dryRun 置位" 动作挪进锁内，让自己先占住一个槽位，后续并发
      // 进入锁时 countActiveSessions 就能看到这次预留，闸门才真的串行。
      const outcome = await withScheduler(async () => {
        const gate = await ensureCanEnterRunning(db, sessionId, sessionRow.taskId, {
          selfIsHistory: false,
        });
        if (!gate.ok) {
          return { kind: 'conflict' as const, activeSessionId: gate.activeSessionId };
        }

        const max = getMaxConcurrentBulkDownloadSessions();
        const active = await countActiveSessions();
        if (active >= max) {
          await updateBulkDownloadSession(sessionId, { status: 'queued' });
          console.log('[bulkDownloadService] 会话进入等待队列:', sessionId);
          return { kind: 'queued' as const };
        }
        // 在锁内就把自己占为 dryRun（slot 预留），保证其他并发 start
        // 看到更新后的 active 计数，避免多个 start 撞同一个空槽。
        await updateBulkDownloadSession(sessionId, { status: 'dryRun', currentPage: 1 });
        return { kind: 'reserved' as const };
      });
      if (outcome.kind === 'conflict') {
        console.log(
          '[bulkDownloadService] 同 taskId 已有活跃会话，拒绝启动:',
          sessionId,
          '→',
          outcome.activeSessionId
        );
        return {
          success: false,
          error: '该任务已有进行中的下载会话',
        };
      }
      if (outcome.kind === 'queued') {
        // 闸门超限：把新创建的会话直接打成 queued 返回，由 promoteNextQueued
        // 在有空槽时重新唤起。queued: true 让调用方能明确区分 "进了队列"
        // 与 "跑起来了"。
        return { success: true, queued: true };
      }

      // 执行 Dry Run：扫描所有页面并创建记录
      const dryRunResult = await performDryRun(sessionId, task);
      if (!dryRunResult.success) {
        await updateBulkDownloadSession(sessionId, {
          status: 'failed',
          error: dryRunResult.error
        });
        promoteNextQueued().catch(err => console.error('[bulkDownloadService] promoteNextQueued failed:', err));
        return { success: false, error: dryRunResult.error };
      }

      // 等待旧下载循环在暂停/取消后完全退出，避免快速继续时旧循环的中止结果污染新一轮状态
      await waitForDownloadSessionToStop(sessionId);
      await resetInFlightRecordsToPending(sessionId);

      // 检查是否有待下载的记录
      const pendingCount = await getBulkDownloadSessionStats(sessionId);
      if (pendingCount.pending === 0) {
        await updateBulkDownloadSession(sessionId, {
          status: 'allSkipped'
        });
        promoteNextQueued().catch(err => console.error('[bulkDownloadService] promoteNextQueued failed:', err));
        return { success: true };
      }

      // 更新状态为 running
      sessionStopReasons.delete(sessionId);
      await updateBulkDownloadSession(sessionId, {
        status: 'running',
        totalPages: dryRunResult.totalPages
      });

      // 开始下载
      startDownloadingSession(sessionId, task)
        .catch(error => {
          console.error('[bulkDownloadService] 下载过程出错:', error);
          return updateBulkDownloadSession(sessionId, {
            status: 'failed',
            error: error.message
          });
        })
        .finally(() => {
          // 下载结束（成功 / 失败 / 取消 / 暂停 均由内部写 DB 后到达），推进队列
          promoteNextQueued().catch(err => {
            console.error('[bulkDownloadService] promoteNextQueued failed:', err);
          });
        });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[bulkDownloadService] 启动会话失败:', errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      activeSessionStartPromises.delete(sessionId);
    }
  })();

  activeSessionStartPromises.set(sessionId, startPromise);
  return startPromise;
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

    const client = createBooruClient(site);

    const tags = task.tags.split(' ').filter(t => t.trim());
    let currentPage = 1;
    let totalPages: number | undefined;
    let hasMore = true;

    while (hasMore) {
      // 更新当前页面
      await updateBulkDownloadSession(sessionId, {
        currentPage: currentPage
      });

      // 检查会话是否被取消（支持 dryRun、cancelled、paused 等状态）
      const db = await getDatabase();
      const session = await get<any>(db, `
        SELECT status FROM bulk_download_sessions WHERE id = ?
      `, [sessionId]);
      if (session?.status !== 'dryRun') {
        console.log('[bulkDownloadService] Dry Run 被中断，当前状态:', session?.status);
        break;
      }

      // 获取当前页的图片（带重试机制）
      let posts: any[] = [];
      let retryCount = 0;
      const maxRetries = 3;
      const retryDelay = 2000; // 2秒

      while (retryCount < maxRetries) {
        try {
          posts = await client.getPosts({
        tags: tags,
        limit: task.perPage,
        page: currentPage
      });
          break; // 成功则跳出重试循环
        } catch (error: any) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const isRetryableError = 
            errorMessage.includes('502') || 
            errorMessage.includes('503') || 
            errorMessage.includes('504') ||
            errorMessage.includes('timeout') ||
            errorMessage.includes('ECONNRESET') ||
            errorMessage.includes('ENOTFOUND');

          if (isRetryableError && retryCount < maxRetries - 1) {
            retryCount++;
            console.warn(`[bulkDownloadService] 请求第 ${currentPage} 页失败 (${errorMessage})，${retryDelay/1000}秒后重试 (${retryCount}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, retryDelay * retryCount)); // 递增延迟
            continue;
          } else {
            // 不可重试的错误或已达到最大重试次数
            throw error;
          }
        }
      }

      // 请求成功后，添加延迟避免请求过快（除了第一页）
      // 增加延迟时间，避免触发服务器限流（特别是遇到 502 错误后）
      if (currentPage > 1) {
        const requestDelay = 1000; // 增加到 1 秒延迟，避免请求过快
        await new Promise(resolve => setTimeout(resolve, requestDelay));
      }

      if (posts.length === 0) {
        hasMore = false;
        break;
      }

      // 如果没有设置总页数，尝试从响应中获取
      if (!totalPages && posts.length < task.perPage) {
        totalPages = currentPage;
      }

      // 批量检查已下载的图片（优化：一次性查询所有 postId，而不是逐个查询）
      let downloadedPostIds: Set<number> = new Set();
      if (task.skipIfExists && posts.length > 0) {
        try {
          const db = await getDatabase();
          const postIds = posts.map(p => p.id).filter(id => id);
          if (postIds.length > 0) {
            const placeholders = postIds.map(() => '?').join(',');
            const downloadedRows = await all<{ postId: number }>(db, `
              SELECT postId FROM booru_posts 
              WHERE siteId = ? AND postId IN (${placeholders}) AND downloaded = 1
            `, [task.siteId, ...postIds]);
            downloadedPostIds = new Set(downloadedRows.map(row => row.postId));
          }
        } catch (error) {
          console.warn('[bulkDownloadService] 批量查询已下载图片失败，回退到逐个查询:', error);
          // 如果批量查询失败，回退到逐个查询（但会慢一些）
        }
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
          // 优先使用批量查询结果
          if (downloadedPostIds.has(postId)) {
            continue;
          }
          // 如果批量查询失败，回退到逐个查询
          if (downloadedPostIds.size === 0) {
            const existingPost = await booruService.getBooruPostBySiteAndId(task.siteId, postId);
            if (existingPost?.downloaded) {
              continue;
            }
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

// 正在运行的下载会话映射：sessionId -> AbortController（用于避免重复启动和中止下载）
const activeDownloadSessions = new Map<string, AbortController>();
const activeDownloadSessionPromises = new Map<string, Promise<void>>();
const activeDownloadSessionWorkers = new Map<string, Set<Promise<void>>>();
const activeSessionStartPromises = new Map<string, Promise<{ success: boolean; error?: string }>>();
const sessionStopReasons = new Map<string, 'paused' | 'cancelled'>();

function isAbortError(error: unknown): boolean {
  if (!error || (typeof error !== 'object' && typeof error !== 'string')) {
    return false;
  }

  const message = typeof error === 'string'
    ? error.toLowerCase()
    : typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message.toLowerCase()
      : '';
  const name = typeof error === 'object' && typeof (error as { name?: unknown }).name === 'string'
    ? (error as { name: string }).name.toLowerCase()
    : '';
  const code = typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code.toUpperCase()
    : '';

  return (
    name === 'aborterror'
    || code === 'ERR_CANCELED'
    || message.includes('abort')
    || message.includes('canceled')
    || message.includes('cancelled')
  );
}

async function getSessionStatus(sessionId: string): Promise<BulkDownloadSessionStatus | null> {
  const db = await getDatabase();
  const session = await get<{ status: BulkDownloadSessionStatus }>(db, `
    SELECT status FROM bulk_download_sessions WHERE id = ?
  `, [sessionId]);
  return session?.status || null;
}

async function isUserInitiatedSessionAbort(sessionId: string, error: unknown): Promise<boolean> {
  if (!isAbortError(error)) {
    return false;
  }

  const stopReason = sessionStopReasons.get(sessionId);
  if (stopReason === 'paused' || stopReason === 'cancelled') {
    return true;
  }

  const sessionStatus = await getSessionStatus(sessionId);
  return sessionStatus === 'paused' || sessionStatus === 'cancelled';
}

async function waitForDownloadSessionToStop(sessionId: string): Promise<void> {
  const activePromise = activeDownloadSessionPromises.get(sessionId);
  if (!activePromise) {
    return;
  }

  await activePromise;
}

async function claimPendingRecords(
  sessionId: string,
  limit: number
): Promise<BulkDownloadRecord[]> {
  if (limit <= 0) {
    return [];
  }

  const pendingRecords = await getBulkDownloadRecordsBySession(sessionId, 'pending');
  if (pendingRecords.length === 0) {
    return [];
  }

  const db = await getDatabase();
  const claimedRecords: BulkDownloadRecord[] = [];

  for (const record of pendingRecords) {
    if (claimedRecords.length >= limit) {
      break;
    }

    const result = await runWithChanges(db, `
      UPDATE bulk_download_records
      SET status = ?, error = NULL
      WHERE status = ? AND url = ? AND sessionId = ?
    `, ['downloading', 'pending', record.url, sessionId]);

    if ((result?.changes ?? 0) > 0) {
      claimedRecords.push({
        ...record,
        status: 'downloading',
        error: undefined,
      });
    }
  }

  return claimedRecords;
}

async function resetInFlightRecordsToPending(sessionId: string): Promise<void> {
  const db = await getDatabase();
  await run(db, `
    UPDATE bulk_download_records
    SET status = ?, error = NULL, progress = 0, downloadedBytes = 0, totalBytes = 0, fileSize = NULL
    WHERE sessionId = ? AND status = ?
  `, ['pending', sessionId, 'downloading']);
}

/**
 * 开始下载会话中的所有记录
 */
async function startDownloadingSession(
  sessionId: string,
  task: BulkDownloadTask
): Promise<void> {
  console.log('[bulkDownloadService] 开始下载会话:', sessionId);

  // 如果已经在运行，直接返回当前循环，避免同一会话并发启动多个下载循环
  const activePromise = activeDownloadSessionPromises.get(sessionId);
  if (activePromise) {
    console.log('[bulkDownloadService] 会话已在下载中，复用现有下载循环');
    return activePromise;
  }

  const downloadLoopPromise = (async () => {
    const sessionAbortController = new AbortController();
    activeDownloadSessions.set(sessionId, sessionAbortController);
    const sessionWorkers = new Set<Promise<void>>();
    activeDownloadSessionWorkers.set(sessionId, sessionWorkers);

    // 事件驱动的并发下载（替代 200ms 轮询循环，降低 CPU 空转）
    const maxConcurrency = task.concurrency || 3;
    /** 浏览模式下的并发上限 */
    const BROWSING_CONCURRENCY = 1;
    let activeCount = 0;
    let isStopped = false;

    // 获取当前有效并发数（浏览模式下自动降低）
    const getEffectiveConcurrency = () => {
      return networkScheduler.isBrowsingActive()
        ? Math.min(BROWSING_CONCURRENCY, maxConcurrency)
        : maxConcurrency;
    };

    // 用 Promise + resolve 实现事件通知：下载完成时唤醒调度器
    let wakeup: (() => void) | null = null;

    // 监听浏览模式变化：浏览结束后唤醒调度器填充槽位
    const onBrowsingChange = (isBrowsing: boolean) => {
      if (!isBrowsing && wakeup) wakeup();
    };
    const unsubscribeBrowsing = networkScheduler.onChange(onBrowsingChange);

    // 工作函数：处理单个下载任务
    const processDownload = async (record: BulkDownloadRecord) => {
      activeCount++;
      const concurrency = getEffectiveConcurrency();
      console.log(`[bulkDownloadService] 开始下载: ${record.fileName} (活跃数: ${activeCount}/${concurrency})`);

      try {
        await downloadRecord(record, task, sessionId, sessionAbortController.signal);
      } catch (error) {
        console.error(`[bulkDownloadService] 下载记录失败: ${record.fileName}`, error);
      } finally {
        activeCount--;
        console.log(`[bulkDownloadService] 下载完成: ${record.fileName} (活跃数: ${activeCount}/${getEffectiveConcurrency()})`);
        // 通知调度器有空闲槽位
        if (wakeup) wakeup();
      }
    };

    // 等待空闲槽位的辅助函数（事件驱动，不轮询）
    const waitForSlot = (): Promise<void> => {
      if (activeCount < getEffectiveConcurrency()) return Promise.resolve();
      return new Promise<void>((resolve) => { wakeup = resolve; });
    };

    // 等待活跃任务状态变化，避免“仍有下载进行中但暂无 pending”时空转
    const waitForActivityChange = (): Promise<void> => {
      return new Promise<void>((resolve) => { wakeup = resolve; });
    };

    // 事件驱动的主调度循环
    const downloadLoop = async () => {
      try {
        while (!isStopped) {
          try {
            // 检查会话状态
            const db = await getDatabase();
            const session = await get<any>(db, `
              SELECT status FROM bulk_download_sessions WHERE id = ?
            `, [sessionId]);

            if (session?.status !== 'running') {
              console.log('[bulkDownloadService] 会话已停止，停止下载');
              isStopped = true;
              break;
            }

            // 等待有空闲槽位（事件驱动）
            await waitForSlot();
            if (isStopped) break;

            // 原子领取待下载的记录，避免同一条 pending 记录被重复调度
            const needMore = getEffectiveConcurrency() - activeCount;
            if (needMore <= 0) continue;

            const recordsToStart = await claimPendingRecords(sessionId, needMore);

            if (recordsToStart.length === 0) {
              // 检查是否全部完成
              if (activeCount === 0) {
                const stats = await getBulkDownloadSessionStats(sessionId);
                if (stats.completed + stats.failed === stats.total) {
                  await updateBulkDownloadSession(sessionId, {
                    status: 'completed',
                    completedAt: new Date().toISOString()
                  });
                  isStopped = true;
                  break;
                }

                // 没有活跃任务也没有可领取记录，但统计尚未收敛时，短暂让出事件循环后重试
                // 避免 pause/restart 竞态下等待一个永远不会到来的 activity 事件
                await new Promise(resolve => setTimeout(resolve, 20));
                continue;
              }

              // 仍有活跃任务在运行，等待任务完成后再继续，避免空转
              await waitForActivityChange();
              continue;
            }

            for (const record of recordsToStart) {
              let workerPromise: Promise<void>;
              workerPromise = processDownload(record)
                .catch((error) => {
                  console.error(`[bulkDownloadService] processDownload 出错:`, error);
                })
                .finally(() => {
                  sessionWorkers.delete(workerPromise);
                });
              sessionWorkers.add(workerPromise);
            }
          } catch (error) {
            console.error('[bulkDownloadService] downloadLoop 循环出错:', error);
            // 出错后短暂等待再继续
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      } finally {
        if (sessionWorkers.size > 0) {
          await Promise.allSettled(Array.from(sessionWorkers));
        }
        unsubscribeBrowsing();
        activeDownloadSessions.delete(sessionId);
        activeDownloadSessionPromises.delete(sessionId);
        activeDownloadSessionWorkers.delete(sessionId);
        sessionStopReasons.delete(sessionId);
      }
    };

    await downloadLoop();
  })();

  activeDownloadSessionPromises.set(sessionId, downloadLoopPromise);
  return downloadLoopPromise;
}

/**
 * 下载单个记录
 */
async function downloadRecord(
  record: BulkDownloadRecord,
  task: BulkDownloadTask,
  sessionId: string,
  abortSignal?: AbortSignal
): Promise<void> {
  try {
    const db = await getDatabase();

    const filePath = path.join(task.path, record.fileName);
    const tempPath = buildDownloadTempPath(filePath);

    // 确保目录存在
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 检查文件是否已存在且完整
    if (fs.existsSync(filePath)) {
      try {
        const existingSize = fs.statSync(filePath).size;
        if (existingSize > 0) {
          // 如果文件已存在且大小大于0，尝试获取服务器文件大小进行验证
          // 如果无法获取，至少文件存在且不为空，认为已完成
          let isComplete = false;
          
          try {
            // 尝试通过 HEAD 请求获取服务器文件大小
            const axios = (await import('axios')).default;
            const proxyConfig = getProxyConfig();
            const headResponse = await axios.head(record.url, {
              proxy: proxyConfig,
              timeout: 10000,
              headers: {
                'User-Agent': 'YandeGalleryDesktop/1.0.0'
              }
            });
            
            const serverSize = parseContentLengthHeader(headResponse.headers['content-length']);

            if (serverSize !== null && existingSize === serverSize) {
              // 文件大小匹配，确认已完成
              isComplete = true;
              console.log(`[bulkDownloadService] 文件已存在且完整: ${record.fileName} (${existingSize} bytes)`);
            } else if (serverSize === null) {
              console.log(`[bulkDownloadService] 无法获取 content-length，将重新下载并保留现有最终文件: ${record.fileName}`);
            } else {
              // 文件大小不匹配，需要重新下载，但保留当前最终文件，待新 .part 校验完成后再覆盖
              console.log(`[bulkDownloadService] 文件大小不匹配，将重新下载并保留现有最终文件: ${record.fileName} (本地: ${existingSize}, 服务器: ${serverSize})`);
            }
          } catch (headError) {
            console.log(`[bulkDownloadService] 无法验证文件完整性，将重新下载并保留现有最终文件: ${record.fileName}`);
          }
          
          if (isComplete) {
            // 更新状态为已完成
            await run(db, `
              UPDATE bulk_download_records 
              SET status = ?, fileSize = ?, progress = 100, downloadedBytes = ?, totalBytes = ?
              WHERE url = ? AND sessionId = ?
            `, ['completed', existingSize, existingSize, existingSize, record.url, sessionId]);
            
            // 广播状态变化到前端
            const windows = BrowserWindow.getAllWindows();
            for (const win of windows) {
              win.webContents.send(IPC_CHANNELS.BULK_DOWNLOAD_RECORD_STATUS, {
                sessionId: sessionId,
                url: record.url,
                status: 'completed',
                fileSize: existingSize,
                progress: 100,
                downloadedBytes: existingSize,
                totalBytes: existingSize
              });
            }
            
            return;
          }
        } else {
          // 文件存在但大小为0，删除它
          console.log(`[bulkDownloadService] 删除空文件: ${record.fileName}`);
          fs.unlinkSync(filePath);
        }
      } catch (statError) {
        console.warn(`[bulkDownloadService] 检查文件状态失败: ${filePath}`, statError);
        // 如果检查失败，继续下载流程
      }
    }

    // 使用 axios 下载（带重试机制）
    const axios = (await import('axios')).default;
    const proxyConfig = getProxyConfig();
    
    let downloadSuccess = false;
    let lastError: Error | null = null;
    const maxDownloadRetries = 2; // 最多重试2次
    
    for (let retry = 0; retry <= maxDownloadRetries; retry++) {
      try {
        // 如果重试，先清除可能存在的部分文件
        if (retry > 0 && fs.existsSync(tempPath)) {
          console.log(`[bulkDownloadService] 重试下载，清除部分文件: ${tempPath}`);
          fs.unlinkSync(tempPath);
          // 重试前等待一段时间
          await new Promise(resolve => setTimeout(resolve, 1000 * retry));
        }
    
    const response = await axios({
      method: 'GET',
      url: record.url,
      responseType: 'stream',
      proxy: proxyConfig,
          timeout: 600000, // 600秒（10分钟），大文件需要更长时间
      headers: {
        'User-Agent': 'YandeGalleryDesktop/1.0.0'
          },
          // 禁用自动重定向，避免问题
          maxRedirects: 5,
          validateStatus: (status) => status >= 200 && status < 300,
          // 支持会话级别的中止信号（暂停/取消时中止正在进行的下载）
          signal: abortSignal
    });

        // 获取预期的文件大小（如果服务器提供了 Content-Length）
        const expectedSize = response.headers['content-length'] 
          ? parseInt(response.headers['content-length'], 10) 
          : null;

    const writer = fs.createWriteStream(tempPath);
        let downloadedBytes = 0;
        let lastProgressUpdate = Date.now();
        const progressUpdateInterval = 500; // 每500ms更新一次进度（和单张下载一致，减少数据库写入）

        // 广播进度到前端（实时推送，不依赖数据库轮询）
        const broadcastProgress = (bytes: number, total: number | null) => {
          const progress = total && total > 0 ? Math.round((bytes / total) * 100) : 0;
          const windows = BrowserWindow.getAllWindows();
          for (const win of windows) {
            win.webContents.send(IPC_CHANNELS.BULK_DOWNLOAD_RECORD_PROGRESS, {
              sessionId: sessionId,
              url: record.url,
              progress: progress,
              downloadedBytes: bytes,
              totalBytes: total || 0
            });
          }
        };

        // 更新进度到数据库的函数（异步，不阻塞）
        const updateProgress = async (bytes: number, total: number | null) => {
          const progress = total && total > 0 ? Math.round((bytes / total) * 100) : 0;
          try {
            await run(db, `
              UPDATE bulk_download_records 
              SET progress = ?, downloadedBytes = ?, totalBytes = ?
              WHERE url = ? AND sessionId = ?
            `, [progress, bytes, total || 0, record.url, sessionId]);
          } catch (err) {
            // 忽略进度更新错误，不影响下载流程
            console.warn('[bulkDownloadService] 更新进度失败:', err);
          }
        };

        // 初始化进度（设置总大小）
        if (expectedSize) {
          broadcastProgress(0, expectedSize);
          await updateProgress(0, expectedSize);
        }

        // 使用 Promise 等待下载完成（带超时机制）
        await new Promise<void>((resolve, reject) => {
          let finished = false;
          let lastDataTime = Date.now();
          const downloadTimeout = 600000; // 10分钟总超时
          const dataTimeout = 120000; // 2分钟无数据超时（检测卡住）
          
          // 无数据超时检测（如果2分钟没有收到数据，认为卡住了）
          const dataTimeoutId = setInterval(() => {
            if (!finished) {
              const timeSinceLastData = Date.now() - lastDataTime;
              if (timeSinceLastData > dataTimeout && downloadedBytes > 0) {
                // 有下载但卡住了
                cleanup();
                reject(new Error(`Download stalled: no data received for ${Math.round(timeSinceLastData / 1000)}s (downloaded ${downloadedBytes} bytes)`));
              }
            }
          }, 10000); // 每10秒检查一次
          
          // 总超时检测
          const timeoutId = setTimeout(() => {
            if (!finished) {
              cleanup();
              reject(new Error(`Download timeout: exceeded ${Math.round(downloadTimeout / 1000)}s limit`));
            }
          }, downloadTimeout);
          
          const cleanup = () => {
            if (finished) return;
            finished = true;
            clearTimeout(timeoutId);
            clearInterval(dataTimeoutId);
            writer.removeAllListeners();
            response.data.removeAllListeners();
          };

          // 监听数据流，跟踪下载进度和检测卡住
          response.data.on('data', (chunk: Buffer) => {
            downloadedBytes += chunk.length;
            lastDataTime = Date.now(); // 更新最后数据时间
            
            // 限制更新频率（每500ms更新一次，减少数据库写入）
            const now = Date.now();
            if (now - lastProgressUpdate >= progressUpdateInterval) {
              lastProgressUpdate = now;
              
              // 实时推送进度到前端（不阻塞）
              broadcastProgress(downloadedBytes, expectedSize);
              
              // 异步更新数据库（不阻塞下载）
              updateProgress(downloadedBytes, expectedSize).catch(() => {
                // 静默忽略错误
              });
            }
          });

          writer.on('finish', async () => {
            cleanup();
            // 确保文件写入完成后再 resolve
            // 给一点时间让文件系统同步
            await new Promise(resolve => setTimeout(resolve, 100));
            resolve();
          });

          writer.on('error', (err) => {
            cleanup();
            reject(err);
          });

          response.data.on('error', (err: Error) => {
            cleanup();
            reject(err);
          });

          response.data.on('close', async () => {
            // 流关闭时检查是否完成
            if (!finished) {
              cleanup();
              // 如果流提前关闭，可能是中断了
              if (downloadedBytes === 0) {
                reject(new Error('Stream closed before any data received'));
              } else if (expectedSize && downloadedBytes < expectedSize) {
                reject(new Error(`Download incomplete: ${downloadedBytes}/${expectedSize} bytes`));
              } else {
                // 没有预期大小，但已下载了一些数据，检查文件是否完整
                try {
                  // 等待一下让文件系统同步
                  await new Promise(resolve => setTimeout(resolve, 200));
                  const currentSize = fs.existsSync(tempPath) ? fs.statSync(tempPath).size : 0;
                  if (currentSize > 0 && currentSize === downloadedBytes) {
                    // 文件大小匹配，可能已经完成，直接 resolve
                    // 注意：这里 resolve 后，外层代码会验证文件并更新状态
                    resolve();
                  } else {
                    // 文件大小不匹配，等待 finish 事件或超时
                    // 如果 finish 不触发，超时机制会处理
                    console.warn(`[bulkDownloadService] 流关闭但文件大小不匹配: ${record.fileName} (已下载: ${downloadedBytes}, 文件大小: ${currentSize})`);
                  }
                } catch (err) {
                  // 文件检查失败，等待 finish 事件
                  console.warn(`[bulkDownloadService] 检查文件大小失败: ${record.fileName}`, err);
                }
              }
            }
          });

          // 开始管道传输
          response.data.pipe(writer);
        });

        // 等待文件写入完成（给文件系统一点时间同步）
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // 验证文件是否完整下载
        let actualSize: number;
        try {
          actualSize = fs.statSync(tempPath).size;
        } catch (statError) {
          throw new Error(`无法读取下载的文件: ${statError instanceof Error ? statError.message : String(statError)}`);
        }

        validateDownloadedFileSize(actualSize, expectedSize);
        replaceFileWithTemp(tempPath, filePath);
        
        // 强制更新最终进度（确保显示100%）
        broadcastProgress(actualSize, expectedSize || actualSize);
        try {
          await updateProgress(actualSize, expectedSize || actualSize);
        } catch (progressError) {
          console.warn('[bulkDownloadService] 更新进度失败（继续）:', progressError);
        }
        
        downloadSuccess = true;
        console.log(`[bulkDownloadService] 下载成功: ${record.fileName} (${actualSize} bytes)`);

        // 更新状态为 completed，并更新最终进度（带重试机制，确保状态更新成功）
        let statusUpdateSuccess = false;
        const maxStatusUpdateRetries = 3;
        for (let statusRetry = 0; statusRetry < maxStatusUpdateRetries; statusRetry++) {
          try {
            await run(db, `
              UPDATE bulk_download_records 
              SET status = ?, fileSize = ?, progress = 100, downloadedBytes = ?, totalBytes = ?
              WHERE url = ? AND sessionId = ?
            `, ['completed', actualSize, actualSize, expectedSize || actualSize, record.url, sessionId]);
            
            // 验证更新是否成功
            const updatedRecord = await get<any>(db, `
              SELECT status FROM bulk_download_records 
              WHERE url = ? AND sessionId = ?
            `, [record.url, sessionId]);
            
            if (updatedRecord && updatedRecord.status === 'completed') {
              statusUpdateSuccess = true;
              console.log(`[bulkDownloadService] 数据库状态已更新为 completed: ${record.fileName}`);
              break;
            } else {
              console.warn(`[bulkDownloadService] 状态更新验证失败，重试中 (${statusRetry + 1}/${maxStatusUpdateRetries}): ${record.fileName}`);
              if (statusRetry < maxStatusUpdateRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, 100 * (statusRetry + 1)));
              }
            }
          } catch (dbError) {
            console.error(`[bulkDownloadService] 更新数据库状态失败 (${statusRetry + 1}/${maxStatusUpdateRetries}): ${record.fileName}`, dbError);
            if (statusRetry < maxStatusUpdateRetries - 1) {
              // 重试前等待一段时间
              await new Promise(resolve => setTimeout(resolve, 100 * (statusRetry + 1)));
            }
          }
        }
        
        if (!statusUpdateSuccess) {
          console.error(`[bulkDownloadService] 警告：状态更新失败（已重试 ${maxStatusUpdateRetries} 次）: ${record.fileName}`);
          // 即使状态更新失败，也继续广播状态，让前端知道下载完成
        }
        
        // 广播状态变化到前端（通知下载完成）- 确保即使数据库更新失败也发送
        try {
          const windows = BrowserWindow.getAllWindows();
          for (const win of windows) {
            win.webContents.send(IPC_CHANNELS.BULK_DOWNLOAD_RECORD_STATUS, {
              sessionId: sessionId,
              url: record.url,
              status: 'completed',
              fileSize: actualSize,
              progress: 100,
              downloadedBytes: actualSize,
              totalBytes: expectedSize || actualSize
            });
          }
          console.log(`[bulkDownloadService] 已广播状态更新: ${record.fileName}`);
        } catch (broadcastError) {
          console.error(`[bulkDownloadService] 广播状态更新失败: ${record.fileName}`, broadcastError);
        }
        
        break; // 成功，跳出重试循环

      } catch (error: any) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const errorMessage = lastError.message;

        // 用户主动暂停/取消触发的中断不应进入重试，否则旧循环可能在新一轮启动前迟迟不退出
        if (isAbortError(error) || abortSignal?.aborted) {
          throw lastError;
        }

        // 判断是否可重试的错误
        const isRetryableError =
          errorMessage.includes('ECONNRESET') ||
          errorMessage.includes('ETIMEDOUT') ||
          errorMessage.includes('timeout') ||
          errorMessage.includes('incomplete') ||
          errorMessage.includes('File size mismatch') ||
          errorMessage.includes('size mismatch') ||
          errorMessage.includes('Stream closed') ||
          errorMessage.includes('Download timeout') ||
          errorMessage.includes('Download stalled') ||
          errorMessage.includes('502') ||
          errorMessage.includes('503') ||
          errorMessage.includes('504') ||
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          (error.response && error.response.status >= 500);

        if (isRetryableError && retry < maxDownloadRetries) {
          console.warn(`[bulkDownloadService] 下载失败 (${errorMessage})，将重试 (${retry + 1}/${maxDownloadRetries})`);
          // 继续重试循环
        } else {
          // 不可重试或已达到最大重试次数
          throw lastError;
        }
      }
    }

    if (!downloadSuccess && lastError) {
      throw lastError;
    }

    // 更新或创建 booru_posts 记录
    // TODO: 这里需要从 URL 或其他方式获取 postId
    // 暂时跳过，因为需要额外的 API 调用

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const abortedByUser = await isUserInitiatedSessionAbort(sessionId, error);

    if (abortedByUser) {
      console.log('[bulkDownloadService] 下载因用户暂停/取消而中止，不标记为失败:', record.url);
      return;
    }

    console.error('[bulkDownloadService] 下载记录失败:', record.url, errorMessage);

    // 下载失败时清除可能存在的损坏临时文件
    const filePath = path.join(task.path, record.fileName);
    const tempPath = buildDownloadTempPath(filePath);
    try {
      if (fs.existsSync(tempPath)) {
        console.log('[bulkDownloadService] 清除损坏临时文件:', tempPath);
        fs.unlinkSync(tempPath);
      }
    } catch (unlinkError) {
      console.warn('[bulkDownloadService] 清除临时文件失败:', tempPath, unlinkError);
      // 清除文件失败不影响错误处理流程
    }

    // 更新状态为 failed
    const db = await getDatabase();
    await run(db, `
      UPDATE bulk_download_records
      SET status = ?, error = ?
      WHERE url = ? AND sessionId = ?
    `, ['failed', errorMessage, record.url, sessionId]);

    // 广播状态变化到前端（通知下载失败）
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      win.webContents.send(IPC_CHANNELS.BULK_DOWNLOAD_RECORD_STATUS, {
        sessionId: sessionId,
        url: record.url,
        status: 'failed',
        error: errorMessage
      });
    }
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
    sessionStopReasons.set(sessionId, 'paused');

    // 中止正在进行的下载请求
    const controller = activeDownloadSessions.get(sessionId);
    if (controller) {
      controller.abort();
      console.log('[bulkDownloadService] 已中止会话的进行中下载');
    }

    await updateBulkDownloadSession(sessionId, {
      status: 'paused'
    });
    // 暂停释放槽位后，推进下一个 queued
    promoteNextQueued().catch(err => console.error('[bulkDownloadService] promoteNextQueued failed:', err));
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
    sessionStopReasons.set(sessionId, 'cancelled');

    // 中止正在进行的下载请求
    const controller = activeDownloadSessions.get(sessionId);
    if (controller) {
      controller.abort();
      console.log('[bulkDownloadService] 已中止会话的进行中下载');
    }

    await updateBulkDownloadSession(sessionId, {
      status: 'cancelled'
    });

    // 清理正在下载中（未完成）的部分文件
    try {
      const db = await getDatabase();
      const session = await get<any>(db, 'SELECT taskId FROM bulk_download_sessions WHERE id = ?', [sessionId]);
      if (session?.taskId) {
        const task = await get<any>(db, 'SELECT path FROM bulk_download_tasks WHERE id = ?', [session.taskId]);
        if (task?.path) {
          // 获取所有 downloading 和 pending 状态的记录
          const incompleteRecords = await all<{ fileName: string }>(db, `
            SELECT fileName FROM bulk_download_records
            WHERE sessionId = ? AND status IN ('downloading', 'pending')
          `, [sessionId]);

          let cleanedCount = 0;
          for (const record of incompleteRecords) {
            const filePath = path.join(task.path, record.fileName);
            const tempPath = buildDownloadTempPath(filePath);
            try {
              if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
                cleanedCount++;
              }
            } catch (unlinkErr) {
              console.warn(`[bulkDownloadService] 清理部分文件失败: ${tempPath}`, unlinkErr);
            }
          }
          if (cleanedCount > 0) {
            console.log(`[bulkDownloadService] 已清理 ${cleanedCount} 个未完成的部分文件`);
          }
        }
      }
    } catch (cleanupError) {
      console.warn('[bulkDownloadService] 清理部分文件时出错:', cleanupError);
    }

    // 取消释放槽位后，推进下一个 queued
    promoteNextQueued().catch(err => console.error('[bulkDownloadService] promoteNextQueued failed:', err));
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
 * 恢复程序重启前正在运行的批量下载会话
 * 程序启动后调用，将 running/dryRun 状态的会话中 downloading 的记录重置为 pending，然后重启下载
 */
export async function resumeRunningSessions(): Promise<{ success: boolean; data?: { resumed: number }; error?: string }> {
  console.log('[bulkDownloadService] 恢复运行中的批量下载会话...');
  try {
    const db = await getDatabase();

    // 查找所有 running 状态且未删除的会话（paused 只能手动恢复，dryRun 无法续接）
    const runningSessions = await all<any>(db, `
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
      WHERE s.deletedAt IS NULL AND s.status = 'running'
    `);

    if (runningSessions.length === 0) {
      console.log('[bulkDownloadService] 没有需要恢复的批量下载会话');
      return { success: true, data: { resumed: 0 } };
    }

    console.log(`[bulkDownloadService] 发现 ${runningSessions.length} 个需要恢复的批量下载会话`);

    let resumedCount = 0;
    // 先把所有待恢复的会话打为 queued（或直接 completed），统一交给调度器按闸门拉起。
    // 这样重启后大量 running 会话不会瞬间全部启动撞上站点限流。
    for (const row of runningSessions) {
      const sessionId = row.id;

      // 将 downloading 状态的记录重置为 pending（因为程序重启后内存中的下载已丢失）
      await resetInFlightRecordsToPending(sessionId);

      // 检查是否还有待下载的记录
      const stats = await getBulkDownloadSessionStats(sessionId);
      if (stats.pending === 0 && stats.completed + stats.failed === stats.total) {
        // 没有待下载的记录，标记为已完成
        console.log(`[bulkDownloadService] 会话 ${sessionId} 没有待下载记录，标记为已完成`);
        await updateBulkDownloadSession(sessionId, {
          status: 'completed',
          completedAt: new Date().toISOString()
        });
        continue;
      }

      await waitForDownloadSessionToStop(sessionId);
      await resetInFlightRecordsToPending(sessionId);

      // 先置 queued，交由调度器按并发闸门拉起
      sessionStopReasons.delete(sessionId);
      await updateBulkDownloadSession(sessionId, { status: 'queued' });
      console.log(`[bulkDownloadService] 会话入队等待恢复: ${sessionId}, 待下载: ${stats.pending}`);

      resumedCount++;
    }

    // 触发 maxConcurrent 次调度：调度器会并发地拉起前 N 个 queued 会话，
    // 每个会话结束后 finally 会再次 promoteNextQueued 顶上。
    if (resumedCount > 0) {
      const max = getMaxConcurrentBulkDownloadSessions();
      for (let i = 0; i < max; i++) {
        promoteNextQueued().catch(err => {
          console.error('[bulkDownloadService] 启动恢复调度失败:', err);
        });
      }
    }

    console.log(`[bulkDownloadService] 已恢复 ${resumedCount} 个批量下载会话`);
    return { success: true, data: { resumed: resumedCount } };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[bulkDownloadService] 恢复运行中会话失败:', errorMessage);
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

    // 批量重试前清除所有失败记录对应的损坏文件
    for (const failedRecord of failedRecords) {
      const filePath = path.join(task.path, failedRecord.fileName);
      const tempPath = buildDownloadTempPath(filePath);
      try {
        if (fs.existsSync(tempPath)) {
          console.log('[bulkDownloadService] 批量重试前清除损坏临时文件:', tempPath);
          fs.unlinkSync(tempPath);
        }
      } catch (unlinkError) {
        console.warn('[bulkDownloadService] 清除临时文件失败:', tempPath, unlinkError);
        // 清除文件失败不影响重试流程
      }
    }

    // 将所有失败的记录重置为 pending
    await run(db, `
      UPDATE bulk_download_records
      SET status = ?, error = NULL
      WHERE sessionId = ? AND status = ?
    `, ['pending', sessionId, 'failed']);

    // 根据会话状态决定是否需要启动下载
    if (sessionRow.status === 'completed' || sessionRow.status === 'failed') {
      // 会话已结束，重新启动下载
      await waitForDownloadSessionToStop(sessionId);
      await resetInFlightRecordsToPending(sessionId);
      sessionStopReasons.delete(sessionId);
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
    } else if (sessionRow.status === 'paused') {
      // 会话已暂停，恢复为运行状态
      await waitForDownloadSessionToStop(sessionId);
      await resetInFlightRecordsToPending(sessionId);
      sessionStopReasons.delete(sessionId);
      await updateBulkDownloadSession(sessionId, {
        status: 'running'
      });
      startDownloadingSession(sessionId, task).catch(error => {
        console.error('[bulkDownloadService] 恢复暂停会话下载失败:', error);
      });
    } else if (sessionRow.status === 'running') {
      // 会话正在运行，下载循环会自动获取并处理新的 pending 记录
      console.log('[bulkDownloadService] 会话正在运行，记录已重置为 pending，等待下载循环处理');
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

    // 重试前清除可能存在的损坏文件
    const filePath = path.join(task.path, record.fileName);
    const tempPath = buildDownloadTempPath(filePath);
    try {
      if (fs.existsSync(tempPath)) {
        console.log('[bulkDownloadService] 重试前清除损坏临时文件:', tempPath);
        fs.unlinkSync(tempPath);
      }
    } catch (unlinkError) {
      console.warn('[bulkDownloadService] 清除临时文件失败:', tempPath, unlinkError);
      // 清除文件失败不影响重试流程
    }

    // 如果会话未运行，启动下载会话
    if (sessionRow.status !== 'running') {
      await waitForDownloadSessionToStop(sessionId);
      await resetInFlightRecordsToPending(sessionId);
      sessionStopReasons.delete(sessionId);
      await updateBulkDownloadSession(sessionId, {
        status: 'running'
      });
      // 启动下载会话（会自动处理 pending 记录）
      startDownloadingSession(sessionId, task).catch((error: Error) => {
        console.error('[bulkDownloadService] 启动下载会话失败:', error);
      });
    } else {
      // 如果已经在运行，只需要重置状态为 pending
      // 下载循环会自动获取并处理这个 pending 记录，遵守并发限制
      console.log('[bulkDownloadService] 会话正在运行，记录已重置为 pending，等待下载循环处理');
    }

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[bulkDownloadService] 重试失败记录失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

