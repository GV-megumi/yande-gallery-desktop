import { IPC_CHANNELS } from '../ipc/channels.js';
import { apiEventHub, type ApiEventChannel } from '../api/events/eventHub.js';
import type { RendererAppEvent } from '../../shared/types.js';

type RendererEventWindow = {
  isDestroyed?: () => boolean;
  webContents?: { send?: (channel: string, event: RendererAppEvent) => void };
};

type BrowserWindowLike = {
  getAllWindows?: () => RendererEventWindow[];
};

const API_EVENT_LOCAL_PATH_KEYS = new Set([
  'folderPath',
  'imagePath',
  'thumbnailPath',
  'localPath',
  'filepath',
]);

export function buildRendererAppEvent<TEvent extends RendererAppEvent>(
  event: Omit<TEvent, 'version' | 'occurredAt'> & Partial<Pick<TEvent, 'version' | 'occurredAt'>>
): TEvent {
  return {
    ...event,
    version: 1,
    occurredAt: event.occurredAt ?? new Date().toISOString(),
  } as TEvent;
}

function resolveApiEventChannel(type: RendererAppEvent['type']): ApiEventChannel {
  if (type.startsWith('bulk-download:') || type.startsWith('download:')) return 'downloads';
  if (type.startsWith('favorite-tag')) return 'favorite-tags';
  if (type.startsWith('booru:')) return 'booru';
  return 'system';
}

function sanitizeApiEventPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeApiEventPayload);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (API_EVENT_LOCAL_PATH_KEYS.has(key)) {
      continue;
    }
    sanitized[key] = sanitizeApiEventPayload(item);
  }

  return sanitized;
}

function toApiSafeRendererAppEvent(event: RendererAppEvent): RendererAppEvent {
  return {
    ...event,
    payload: sanitizeApiEventPayload(event.payload),
  } as RendererAppEvent;
}

export function emitRendererAppEvent(event: RendererAppEvent): void {
  try {
    const apiEvent = toApiSafeRendererAppEvent(event);
    apiEventHub.publish(resolveApiEventChannel(event.type), {
      type: event.type,
      timestamp: event.occurredAt,
      data: apiEvent,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[rendererEventBus] API event bridge publish failed:', event.type, message);
  }
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
