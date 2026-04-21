import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../channels.js';
import type { ConfigChangedSummary } from '../../../shared/types.js';
import {
  getConfig,
  getBooruAppearancePreference,
  saveConfig,
  updateGalleryFolders,
  reloadConfig,
  toRendererSafeConfig,
  getNotificationsConfig,
  getDesktopConfig,
  type AppShellPagePreference,
  type BlacklistedTagsPagePreference,
  type ConfigSaveInput,
  type FavoriteTagsPagePreference,
  type GalleryPagePreferencesBySubTab,
} from '../../services/config.js';

export function setupConfigHandlers() {
  // ===== 配置管理 =====
  ipcMain.handle(IPC_CHANNELS.CONFIG_GET, async (_event: IpcMainInvokeEvent) => {
    try {
      const config = getConfig();
      return { success: true, data: toRendererSafeConfig(config) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_PREFERENCES_GET_APPEARANCE, async (_event: IpcMainInvokeEvent) => {
    try {
      return { success: true, data: getBooruAppearancePreference(getConfig()) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 仅广播“哪些配置区块发生了变化”的摘要，避免事件负载携带完整的（包含敏感字段的）
  // 配置对象。渲染端收到摘要后应通过 CONFIG_GET / BOORU_PREFERENCES_GET_APPEARANCE 等
  // 只读通道自行拉取去敏后的最新数据。
  const broadcastConfigChanged = (sections: string[]): void => {
    const windows = BrowserWindow.getAllWindows();
    const summary: ConfigChangedSummary = {
      version: Date.now(),
      sections: Array.from(new Set(sections.filter(section => section.length > 0))),
    };
    for (const win of windows) {
      win.webContents.send(IPC_CHANNELS.CONFIG_CHANGED, summary);
    }
    console.log('[IPC] 配置变更摘要已广播到', windows.length, '个窗口:', summary.sections);
  };

  // 根据 ConfigSaveInput 负载推导受影响的“配置区块路径”集合。
  // - 普通顶层字段(如 `network`/`google`)统一记录为顶层段。
  // - `ui.pagePreferences.<key>` 需要额外下钻到具体偏好名，便于订阅端按页判断。
  // - 数组被视作终值、不再下钻，避免按索引生成无意义的段路径。
  // - 循环引用在当前路径不会出现：payload 来自 ipcRenderer.invoke 的结构化克隆副本，
  //   renderer 端 ConfigSaveInput 类型本身不允许循环；如未来来源扩大，需要补 visited guard。
  const collectConfigSaveSections = (
    payload: unknown,
    prefix = '',
  ): string[] => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return prefix ? [prefix] : [];
    }
    const entries = Object.entries(payload as Record<string, unknown>);
    if (entries.length === 0) {
      return prefix ? [prefix] : [];
    }
    const sections: string[] = [];
    for (const [key, value] of entries) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      if (nextPrefix === 'ui' || nextPrefix === 'ui.pagePreferences') {
        sections.push(...collectConfigSaveSections(value, nextPrefix));
      } else {
        sections.push(nextPrefix);
      }
    }
    return sections;
  };

  ipcMain.handle(IPC_CHANNELS.CONFIG_SAVE, async (_event: IpcMainInvokeEvent, newConfig: ConfigSaveInput) => {
    try {
      const result = await saveConfig(newConfig);
      if (result.success) {
        broadcastConfigChanged(collectConfigSaveSections(newConfig));
      }
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // bug9：通知配置分域 getter/setter
  //
  // 之所以不复用通用 CONFIG_GET/CONFIG_SAVE：
  //   - 让前端读写时有"只关心这段"的清晰入口，避免误传其他字段
  //   - 与后续可能的增量广播（仅 notifications section）保持一致
  //
  // setter 内部走 saveConfig + broadcast，保证其他订阅方也能感知变更。
  ipcMain.handle(IPC_CHANNELS.CONFIG_GET_NOTIFICATIONS, async () => {
    try {
      return { success: true, data: getNotificationsConfig() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG_SET_NOTIFICATIONS, async (_event: IpcMainInvokeEvent, patch: Partial<NonNullable<ReturnType<typeof getNotificationsConfig>>>) => {
    try {
      const current = getConfig().notifications ?? {};
      const merged = { ...current, ...patch } as any;
      const result = await saveConfig({ notifications: merged });
      if (result.success) {
        broadcastConfigChanged(['notifications']);
      }
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG_GET_DESKTOP, async () => {
    try {
      return { success: true, data: getDesktopConfig() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG_SET_DESKTOP, async (_event: IpcMainInvokeEvent, patch: Partial<ReturnType<typeof getDesktopConfig>>) => {
    try {
      const current = getConfig().desktop ?? {};
      const merged = { ...current, ...patch } as any;
      const result = await saveConfig({ desktop: merged });
      if (result.success) {
        broadcastConfigChanged(['desktop']);
        // bug9：autoLaunch / startMinimized 变化时要同步调一次 setLoginItemSettings，
        // 让系统登录项立即跟随新配置，无需重启应用。
        if ('autoLaunch' in patch || 'startMinimized' in patch) {
          try {
            const desktop = getDesktopConfig();
            app.setLoginItemSettings({
              openAtLogin: desktop.autoLaunch,
              openAsHidden: desktop.startMinimized,
            });
          } catch (err) {
            console.warn('[IPC] setLoginItemSettings 失败（可能该平台不支持）:', err);
          }
        }
      }
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PAGE_PREFERENCES_GET_FAVORITE_TAGS, async (_event: IpcMainInvokeEvent) => {
    try {
      const config = getConfig();
      return {
        success: true,
        data: config.ui?.pagePreferences?.favoriteTags,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PAGE_PREFERENCES_SAVE_FAVORITE_TAGS, async (_event: IpcMainInvokeEvent, preferences: FavoriteTagsPagePreference) => {
    try {
      const result = await saveConfig({
        ui: {
          pagePreferences: {
            favoriteTags: preferences,
          },
        },
      });
      if (result.success) {
        broadcastConfigChanged(['ui.pagePreferences.favoriteTags']);
      }
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PAGE_PREFERENCES_GET_BLACKLISTED_TAGS, async (_event: IpcMainInvokeEvent) => {
    try {
      const config = getConfig();
      return {
        success: true,
        data: config.ui?.pagePreferences?.blacklistedTags,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PAGE_PREFERENCES_SAVE_BLACKLISTED_TAGS, async (_event: IpcMainInvokeEvent, preferences: BlacklistedTagsPagePreference) => {
    try {
      const result = await saveConfig({
        ui: {
          pagePreferences: {
            blacklistedTags: preferences,
          },
        },
      });
      if (result.success) {
        broadcastConfigChanged(['ui.pagePreferences.blacklistedTags']);
      }
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PAGE_PREFERENCES_GET_GALLERY, async (_event: IpcMainInvokeEvent) => {
    try {
      const config = getConfig();
      return {
        success: true,
        data: config.ui?.pagePreferences?.galleryBySubTab,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PAGE_PREFERENCES_SAVE_GALLERY, async (_event: IpcMainInvokeEvent, preferences: GalleryPagePreferencesBySubTab) => {
    try {
      const result = await saveConfig({
        ui: {
          pagePreferences: {
            galleryBySubTab: preferences,
          },
        },
      });
      if (result.success) {
        broadcastConfigChanged(['ui.pagePreferences.galleryBySubTab']);
      }
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PAGE_PREFERENCES_GET_APP_SHELL, async (_event: IpcMainInvokeEvent) => {
    try {
      const config = getConfig();
      const pagePreference = config.ui?.pagePreferences?.appShell;
      return {
        success: true,
        data: {
          menuOrder: {
            main: pagePreference?.menuOrder?.main ?? config.ui?.menuOrder?.main,
            gallery: pagePreference?.menuOrder?.gallery ?? config.ui?.menuOrder?.gallery,
            booru: pagePreference?.menuOrder?.booru ?? config.ui?.menuOrder?.booru,
            google: pagePreference?.menuOrder?.google ?? config.ui?.menuOrder?.google,
          },
          pinnedItems: pagePreference?.pinnedItems ?? config.ui?.pinnedItems,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PAGE_PREFERENCES_SAVE_APP_SHELL, async (_event: IpcMainInvokeEvent, preferences: AppShellPagePreference) => {
    try {
      const result = await saveConfig({
        ui: {
          pagePreferences: {
            appShell: preferences,
          },
        },
      });
      if (result.success) {
        broadcastConfigChanged(['ui.pagePreferences.appShell']);
      }
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG_UPDATE_GALLERY_FOLDERS, async (_event: IpcMainInvokeEvent, folders: any[]) => {
    try {
      return await updateGalleryFolders(folders);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG_RELOAD, async (_event: IpcMainInvokeEvent) => {
    try {
      const config = await reloadConfig();
      return { success: true, data: toRendererSafeConfig(config) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
