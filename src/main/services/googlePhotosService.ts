/**
 * Google Photos 服务
 * 封装 Google Photos Picker API
 * Library API 已放弃（2024 后新 OAuth client 无法申请 photoslibrary.* 权限）
 */

import axios from 'axios';
import { BrowserWindow } from 'electron';
import { getAccessToken } from './googleAuthService.js';
import { getProxyConfig } from './config.js';

// ============= 内部工具 =============

/**
 * 创建带认证的请求头
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return {
    Authorization: `Bearer ${token}`,
  };
}

// ============= Google Photos Picker API =============

const PHOTOS_PICKER_API_BASE = 'https://photospicker.googleapis.com/v1';

export interface GPhotosPickerSession {
  id: string;
  pickerUri: string;
  mediaItemsSet: boolean;
  expireTime: string;
}

export interface GPhotosPickerMediaItem {
  id: string;
  createTime: string;
  type: string;
  mediaFile: {
    baseUrl: string;
    mimeType: string;
    filename: string;
    mediaFileMetadata?: {
      width: number;
      height: number;
    };
  };
}

/**
 * 创建 Picker 会话
 * 返回 sessionId 和 pickerUri（用于打开选择器窗口）
 */
export async function createPickerSession(): Promise<GPhotosPickerSession> {
  const headers = await getAuthHeaders();
  const proxy = getProxyConfig();

  console.log('[GooglePhotos] 创建 Picker 会话...');

  let response: any;
  try {
    response = await axios.post(`${PHOTOS_PICKER_API_BASE}/sessions`, {}, {
      headers,
      proxy,
    });
  } catch (err: any) {
    console.error('[GooglePhotos] createPickerSession 失败，状态码:', err.response?.status);
    console.error('[GooglePhotos] Picker 错误详情:', JSON.stringify(err.response?.data, null, 2));
    throw err;
  }

  console.log('[GooglePhotos] Picker 会话创建成功, ID:', response.data.id);
  return {
    id: response.data.id,
    pickerUri: response.data.pickerUri,
    mediaItemsSet: response.data.mediaItemsSet || false,
    expireTime: response.data.expireTime || '',
  };
}

/**
 * 查询 Picker 会话状态
 */
export async function getPickerSession(sessionId: string): Promise<GPhotosPickerSession> {
  const headers = await getAuthHeaders();
  const proxy = getProxyConfig();

  const response = await axios.get(`${PHOTOS_PICKER_API_BASE}/sessions/${sessionId}`, {
    headers,
    proxy,
  });

  return {
    id: response.data.id,
    pickerUri: response.data.pickerUri,
    mediaItemsSet: response.data.mediaItemsSet || false,
    expireTime: response.data.expireTime || '',
  };
}

/**
 * 获取 Picker 会话中用户选择的媒体项
 */
export async function getPickerMediaItems(sessionId: string): Promise<GPhotosPickerMediaItem[]> {
  const headers = await getAuthHeaders();
  const proxy = getProxyConfig();

  console.log('[GooglePhotos] 获取 Picker 选中的媒体项, sessionId:', sessionId);

  const items: GPhotosPickerMediaItem[] = [];
  let pageToken: string | undefined;

  do {
    const params: any = { sessionId, pageSize: 100 };
    if (pageToken) params.pageToken = pageToken;

    const response = await axios.get(`${PHOTOS_PICKER_API_BASE}/mediaItems`, {
      headers,
      params,
      proxy,
    });

    const batch = response.data.mediaItems || [];
    items.push(...batch.map((item: any) => ({
      id: item.id,
      createTime: item.createTime || '',
      type: item.type || 'PHOTO',
      mediaFile: {
        baseUrl: item.mediaFile?.baseUrl || '',
        mimeType: item.mediaFile?.mimeType || '',
        filename: item.mediaFile?.filename || '',
        mediaFileMetadata: item.mediaFile?.mediaFileMetadata
          ? {
              width: item.mediaFile.mediaFileMetadata.width || 0,
              height: item.mediaFile.mediaFileMetadata.height || 0,
            }
          : undefined,
      },
    })));

    pageToken = response.data.nextPageToken;
  } while (pageToken);

  console.log('[GooglePhotos] Picker 选中', items.length, '个媒体项');
  return items;
}

/**
 * 打开 Picker 窗口，等待用户完成选择，返回选中的媒体项
 * 会轮询会话状态，直到用户完成选择或关闭窗口
 */
export async function openPickerAndWait(): Promise<GPhotosPickerMediaItem[]> {
  // 1. 创建会话
  const session = await createPickerSession();

  return new Promise((resolve, reject) => {
    // 2. 打开 Picker 窗口
    const pickerWindow = new BrowserWindow({
      width: 900,
      height: 700,
      title: '从 Google Photos 选择照片',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    pickerWindow.loadURL(session.pickerUri);
    console.log('[GooglePhotos] 打开 Picker 窗口:', session.pickerUri);

    let closed = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    // 3. 轮询会话状态（每 2 秒一次）
    const poll = async () => {
      if (closed) return;
      try {
        const status = await getPickerSession(session.id);
        if (status.mediaItemsSet) {
          // 用户完成选择，关闭窗口并获取结果
          closed = true;
          if (!pickerWindow.isDestroyed()) pickerWindow.close();
          const items = await getPickerMediaItems(session.id);
          resolve(items);
        } else {
          // 继续轮询
          pollTimer = setTimeout(poll, 2000);
        }
      } catch (error) {
        console.error('[GooglePhotos] 轮询 Picker 会话失败:', error);
        pollTimer = setTimeout(poll, 3000);
      }
    };

    // 4. 窗口关闭时清理
    pickerWindow.on('closed', () => {
      if (!closed) {
        closed = true;
        if (pollTimer) clearTimeout(pollTimer);
        // 尝试获取已选内容（用户可能已选好后手动关窗）
        getPickerMediaItems(session.id)
          .then(items => resolve(items))
          .catch(() => resolve([]));
      }
    });

    // 5. 延迟 1 秒后开始轮询（给页面加载时间）
    pollTimer = setTimeout(poll, 1000);
  });
}
