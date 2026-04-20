/**
 * system 域 API 工厂。
 * 主窗口 preload 与精简 subwindow preload 共用。
 *
 * 实现整段原封不动搬自原 src/preload/index.ts 中 `system: { ... }` 段。
 * 注意：system 段仍包含批量下载的进度/状态监听（历史命名遗留），
 * 以及网络测试通道；保持原有结构不动以维持主窗口行为等价。
 */
import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../main/ipc/channels.js';

export function createSystemApi() {
  return {
    selectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SELECT_FOLDER),
    openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL, url),
    showItem: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SHOW_ITEM, path),
    exportBackup: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_EXPORT_BACKUP),
    importBackup: (mode: 'merge' | 'replace' = 'merge') => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_IMPORT_BACKUP, mode),
    checkForUpdate: () =>
      ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_CHECK_FOR_UPDATE),
    // 网络测试（从主进程发起，绕过CORS限制）
    testBaidu: () => ipcRenderer.invoke(IPC_CHANNELS.NETWORK_TEST_BAIDU),
    testGoogle: () => ipcRenderer.invoke(IPC_CHANNELS.NETWORK_TEST_GOOGLE),
    // 批量下载进度监听
    onBulkDownloadRecordProgress: (callback: (data: any) => void) => {
      const subscription = (_event: any, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.BULK_DOWNLOAD_RECORD_PROGRESS, subscription);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BULK_DOWNLOAD_RECORD_PROGRESS, subscription);
    },
    // 批量下载状态变化监听
    onBulkDownloadRecordStatus: (callback: (data: any) => void) => {
      const subscription = (_event: any, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.BULK_DOWNLOAD_RECORD_STATUS, subscription);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BULK_DOWNLOAD_RECORD_STATUS, subscription);
    },
    // bug9：主进程 → 渲染层导航事件（通知点击 / 托盘菜单等）。
    // payload: { section, subKey, sessionId? }；App.tsx 监听后切侧栏 + 右侧内容
    onSystemNavigate: (
      callback: (payload: { section: string; subKey: string; sessionId?: string }) => void,
    ) => {
      const subscription = (_event: any, payload: { section: string; subKey: string; sessionId?: string }) => callback(payload);
      ipcRenderer.on(IPC_CHANNELS.SYSTEM_NAVIGATE, subscription);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SYSTEM_NAVIGATE, subscription);
    },
  } as const;
}
