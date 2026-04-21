import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../channels.js';
import * as bulkDownloadService from '../../services/bulkDownloadService.js';

export function setupBulkDownloadHandlers() {
  // 创建批量下载任务
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_CREATE_TASK, async (_event: IpcMainInvokeEvent, options: any) => {
    try {
      console.log('[IPC] 创建批量下载任务:', options);
      return await bulkDownloadService.createBulkDownloadTask(options);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 创建批量下载任务失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 获取所有批量下载任务
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_GET_TASKS, async (_event: IpcMainInvokeEvent) => {
    try {
      console.log('[IPC] 获取所有批量下载任务');
      const tasks = await bulkDownloadService.getBulkDownloadTasks();
      return { success: true, data: tasks };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 获取批量下载任务失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 根据ID获取批量下载任务
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_GET_TASK, async (_event: IpcMainInvokeEvent, taskId: string) => {
    try {
      console.log('[IPC] 获取批量下载任务:', taskId);
      const task = await bulkDownloadService.getBulkDownloadTaskById(taskId);
      if (!task) {
        return { success: false, error: '任务不存在' };
      }
      return { success: true, data: task };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 获取批量下载任务失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 更新批量下载任务
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_UPDATE_TASK, async (_event: IpcMainInvokeEvent, taskId: string, updates: any) => {
    try {
      console.log('[IPC] 更新批量下载任务:', taskId, updates);
      return await bulkDownloadService.updateBulkDownloadTask(taskId, updates);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 更新批量下载任务失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 删除批量下载任务
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_DELETE_TASK, async (_event: IpcMainInvokeEvent, taskId: string) => {
    try {
      console.log('[IPC] 删除批量下载任务:', taskId);
      return await bulkDownloadService.deleteBulkDownloadTask(taskId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 删除批量下载任务失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 创建批量下载会话
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_CREATE_SESSION, async (_event: IpcMainInvokeEvent, taskId: string) => {
    try {
      console.log('[IPC] 创建批量下载会话:', taskId);
      return await bulkDownloadService.createBulkDownloadSession(taskId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 创建批量下载会话失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 获取活跃的批量下载会话
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_GET_ACTIVE_SESSIONS, async (_event: IpcMainInvokeEvent) => {
    try {
      // 减少日志输出频率，避免控制台刷屏
      // console.log('[IPC] 获取活跃的批量下载会话');
      const sessions = await bulkDownloadService.getActiveBulkDownloadSessions();
      return { success: true, data: sessions };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 获取批量下载会话失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 启动批量下载会话
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_START_SESSION, async (_event: IpcMainInvokeEvent, sessionId: string) => {
    try {
      console.log('[IPC] 启动批量下载会话:', sessionId);
      return await bulkDownloadService.startBulkDownloadSession(sessionId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 启动批量下载会话失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 暂停批量下载会话
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_PAUSE_SESSION, async (_event: IpcMainInvokeEvent, sessionId: string) => {
    try {
      console.log('[IPC] 暂停批量下载会话:', sessionId);
      return await bulkDownloadService.pauseBulkDownloadSession(sessionId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 暂停批量下载会话失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 取消批量下载会话
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_CANCEL_SESSION, async (_event: IpcMainInvokeEvent, sessionId: string) => {
    try {
      console.log('[IPC] 取消批量下载会话:', sessionId);
      return await bulkDownloadService.cancelBulkDownloadSession(sessionId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 取消批量下载会话失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 删除批量下载会话
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_DELETE_SESSION, async (_event: IpcMainInvokeEvent, sessionId: string) => {
    try {
      console.log('[IPC] 删除批量下载会话:', sessionId);
      return await bulkDownloadService.deleteBulkDownloadSession(sessionId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 删除批量下载会话失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 获取批量下载会话统计
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_GET_SESSION_STATS, async (_event: IpcMainInvokeEvent, sessionId: string) => {
    try {
      // 减少日志输出，避免阻塞（只在调试时输出）
      // console.log('[IPC] 获取批量下载会话统计:', sessionId);
      const stats = await bulkDownloadService.getBulkDownloadSessionStats(sessionId);
      return { success: true, data: stats };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 获取批量下载会话统计失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 获取批量下载记录
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_GET_RECORDS, async (_event: IpcMainInvokeEvent, sessionId: string, status?: string, page?: number, autoFix?: boolean) => {
    try {
      // 减少日志输出，避免阻塞（只在调试时输出）
      // console.log('[IPC] 获取批量下载记录:', sessionId, status, page);
      // 默认禁用自动修复，避免每次打开详情页都触发大量 HEAD 请求
      // 只在明确需要时才启用（比如手动点击修复按钮）
      const records = await bulkDownloadService.getBulkDownloadRecordsBySession(sessionId, status as any, page, autoFix === true);
      return { success: true, data: records };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 获取批量下载记录失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 重试所有失败的记录
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_RETRY_ALL_FAILED, async (_event: IpcMainInvokeEvent, sessionId: string) => {
    try {
      console.log('[IPC] 重试所有失败的记录:', sessionId);
      return await bulkDownloadService.retryAllFailedRecords(sessionId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 重试所有失败记录失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 重试单个失败的记录
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_RETRY_FAILED_RECORD, async (_event: IpcMainInvokeEvent, sessionId: string, recordUrl: string) => {
    try {
      console.log('[IPC] 重试失败的记录:', sessionId, recordUrl);
      return await bulkDownloadService.retryFailedRecord(sessionId, recordUrl);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 重试失败记录失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 恢复运行中的批量下载会话（程序启动后调用）
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_RESUME_RUNNING_SESSIONS, async () => {
    try {
      console.log('[IPC] 恢复运行中的批量下载会话');
      return await bulkDownloadService.resumeRunningSessions();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 恢复批量下载会话失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });
}
