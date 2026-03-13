/**
 * Google 服务 IPC 处理器
 * 注册 Google 认证、Drive、Photos 相关的 IPC 通道
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from './channels.js';
import {
  googleLogin,
  googleLogout,
  getGoogleAuthStatus,
} from '../services/googleAuthService.js';
import * as driveService from '../services/googleDriveService.js';
import * as photosService from '../services/googlePhotosService.js';

/**
 * 注册所有 Google 相关 IPC 处理器
 */
export function setupGoogleIPC(): void {
  console.log('[IPC] 注册 Google 相关处理器...');

  // ============= Google 认证 =============

  ipcMain.handle(IPC_CHANNELS.GOOGLE_AUTH_LOGIN, async () => {
    try {
      const result = await googleLogin();
      return result;
    } catch (error) {
      console.error('[IPC] Google 登录失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GOOGLE_AUTH_LOGOUT, async () => {
    try {
      await googleLogout();
      return { success: true };
    } catch (error) {
      console.error('[IPC] Google 退出失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GOOGLE_AUTH_STATUS, async () => {
    try {
      const status = await getGoogleAuthStatus();
      return { success: true, data: status };
    } catch (error) {
      console.error('[IPC] 获取 Google 认证状态失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ============= Google Drive =============

  ipcMain.handle(IPC_CHANNELS.GDRIVE_LIST_FILES, async (_, folderId?: string, pageSize?: number, pageToken?: string, mimeType?: string) => {
    try {
      const result = await driveService.listFiles(folderId, pageSize, pageToken, mimeType);
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] Drive listFiles 失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GDRIVE_SEARCH, async (_, query: string, pageSize?: number, pageToken?: string) => {
    try {
      const result = await driveService.searchFiles(query, pageSize, pageToken);
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] Drive search 失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GDRIVE_GET_FILE, async (_, fileId: string) => {
    try {
      const result = await driveService.getFile(fileId);
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] Drive getFile 失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GDRIVE_DOWNLOAD, async (_, fileId: string, localPath?: string) => {
    try {
      const result = await driveService.downloadFile(fileId, localPath);
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] Drive download 失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GDRIVE_UPLOAD, async (_, localPath: string, folderId?: string) => {
    try {
      const result = await driveService.uploadFile(localPath, folderId);
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] Drive upload 失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GDRIVE_DELETE, async (_, fileId: string) => {
    try {
      await driveService.trashFile(fileId);
      return { success: true };
    } catch (error) {
      console.error('[IPC] Drive delete 失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GDRIVE_CREATE_FOLDER, async (_, name: string, parentId?: string) => {
    try {
      const result = await driveService.createFolder(name, parentId);
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] Drive createFolder 失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GDRIVE_MOVE, async (_, fileId: string, newParentId: string) => {
    try {
      await driveService.moveFile(fileId, newParentId);
      return { success: true };
    } catch (error) {
      console.error('[IPC] Drive move 失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GDRIVE_GET_STORAGE, async () => {
    try {
      const result = await driveService.getStorageQuota();
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] Drive getStorage 失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GDRIVE_GET_THUMBNAIL, async (_, fileId: string) => {
    try {
      const result = await driveService.getThumbnail(fileId);
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] Drive getThumbnail 失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ============= Google Photos =============

  // Picker API — 打开选择器窗口，等待用户选好后返回选中的媒体项
  ipcMain.handle(IPC_CHANNELS.GPHOTOS_PICKER_OPEN, async () => {
    try {
      console.log('[IPC] 打开 Google Photos Picker...');
      const items = await photosService.openPickerAndWait();
      return { success: true, data: items };
    } catch (error) {
      console.error('[IPC] Photos Picker 失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  console.log('[IPC] Google 相关处理器注册完成（认证 3 + Drive 10 + Picker 1 = 14 个通道）');
}
