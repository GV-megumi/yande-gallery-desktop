/**
 * booruPreferences 域 API 工厂。
 * 主窗口 preload 与精简 subwindow preload 共用。
 *
 * 实现整段原封不动搬自原 src/preload/index.ts 中 `booruPreferences: { ... }` 段。
 */
import { ipcRenderer } from 'electron';
import type { BooruAppearancePreference } from '../../main/services/config.js';
import type { ConfigChangedSummary } from '../../shared/types.js';
import { IPC_CHANNELS } from '../../main/ipc/channels.js';

export function createBooruPreferencesApi() {
  return {
    appearance: {
      get: () => ipcRenderer.invoke(IPC_CHANNELS.BOORU_PREFERENCES_GET_APPEARANCE),
      // 订阅 booru 外观偏好变更：接收摘要事件后，直接通过
      // BOORU_PREFERENCES_GET_APPEARANCE 拉取最新 appearance DTO，不再依赖事件中的完整配置。
      // 注：忽略 summary.version —— 当前唯一消费者只是替换状态，不会累积；
      // 若未来有订阅者需要识别过期事件，应改为显式透传 summary。
      onChanged: (callback: (appearance: BooruAppearancePreference) => void) => {
        const subscription = async (_event: any, _summary: ConfigChangedSummary) => {
          try {
            const response = await ipcRenderer.invoke(IPC_CHANNELS.BOORU_PREFERENCES_GET_APPEARANCE);
            if (response?.success && response.data) {
              callback(response.data as BooruAppearancePreference);
            }
          } catch (error) {
            console.error('[Preload] 重新拉取 booru appearance 偏好失败:', error);
          }
        };
        ipcRenderer.on(IPC_CHANNELS.CONFIG_CHANGED, subscription);
        return () => ipcRenderer.removeListener(IPC_CHANNELS.CONFIG_CHANGED, subscription);
      },
    },
  } as const;
}
