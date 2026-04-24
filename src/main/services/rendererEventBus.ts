import { IPC_CHANNELS } from '../ipc/channels.js';
import type { RendererAppEvent } from '../../shared/types.js';

type RendererEventWindow = {
  isDestroyed?: () => boolean;
  webContents?: { send?: (channel: string, event: RendererAppEvent) => void };
};

type BrowserWindowLike = {
  getAllWindows?: () => RendererEventWindow[];
};

export function buildRendererAppEvent<TEvent extends RendererAppEvent>(
  event: Omit<TEvent, 'version' | 'occurredAt'> & Partial<Pick<TEvent, 'version' | 'occurredAt'>>
): TEvent {
  return {
    ...event,
    version: 1,
    occurredAt: event.occurredAt ?? new Date().toISOString(),
  } as TEvent;
}

export function emitRendererAppEvent(event: RendererAppEvent): void {
  void emitRendererAppEventAsync(event);
}

async function emitRendererAppEventAsync(event: RendererAppEvent): Promise<void> {
  let BrowserWindow: BrowserWindowLike | undefined;
  try {
    const electron = await import('electron');
    BrowserWindow = (electron as { BrowserWindow?: BrowserWindowLike }).BrowserWindow;
  } catch {
    BrowserWindow = undefined;
  }

  let windows: RendererEventWindow[] = [];
  try {
    windows = typeof BrowserWindow?.getAllWindows === 'function'
      ? BrowserWindow.getAllWindows()
      : [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[rendererEventBus] 获取窗口列表失败:', event.type, message);
    return;
  }

  for (const win of windows) {
    try {
      if (typeof win.isDestroyed === 'function' && win.isDestroyed()) {
        continue;
      }
      if (typeof win.webContents?.send !== 'function') {
        continue;
      }
      win.webContents.send(IPC_CHANNELS.SYSTEM_APP_EVENT, event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[rendererEventBus] 广播应用内事件失败:', event.type, message);
    }
  }
}

export function emitBuiltRendererAppEvent<TEvent extends RendererAppEvent>(
  event: Omit<TEvent, 'version' | 'occurredAt'> & Partial<Pick<TEvent, 'version' | 'occurredAt'>>
): void {
  emitRendererAppEvent(buildRendererAppEvent<TEvent>(event));
}
