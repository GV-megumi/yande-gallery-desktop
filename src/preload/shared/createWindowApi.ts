/**
 * window 域 API 工厂。
 * 主窗口 preload 与精简 subwindow preload 共用，保证子窗口也能再次打开
 * tag-search / artist / character / secondary-menu 等子窗口。
 *
 * 参数签名对齐 src/main/window.ts::setupWindowIPC 中的 handler：
 *   - openTagSearch / openArtist / openCharacter: (name, siteId?)
 *   - openSecondaryMenu: (section, key, tab?, extra?)
 *     - extra：额外 query 串（如 Bug11 { galleryId: 5 } 用于子窗口直接进入图集详情）
 */
import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../main/ipc/channels.js';

export function createWindowApi() {
  return {
    openTagSearch: (tag: string, siteId?: number | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_TAG_SEARCH, tag, siteId),
    openArtist: (name: string, siteId?: number | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_ARTIST, name, siteId),
    openCharacter: (name: string, siteId?: number | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_CHARACTER, name, siteId),
    openSecondaryMenu: (
      section: string,
      key: string,
      tab?: string,
      extra?: Record<string, string | number>,
    ) =>
      ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_SECONDARY_MENU, section, key, tab, extra),
  } as const;
}
