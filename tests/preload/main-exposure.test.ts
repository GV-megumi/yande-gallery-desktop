import { beforeEach, describe, expect, it, vi } from 'vitest';

const exposed: Record<string, unknown> = {};
const ipcRendererMock = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: unknown) => {
      exposed[name] = api;
    },
  },
  ipcRenderer: ipcRendererMock,
}));

beforeEach(() => {
  for (const key of Object.keys(exposed)) {
    delete exposed[key];
  }
  ipcRendererMock.invoke.mockClear();
  ipcRendererMock.on.mockClear();
  ipcRendererMock.removeListener.mockClear();
  vi.resetModules();
});

describe('main preload 暴露面', () => {
  it('主窗口 system 域暴露 onAppEvent 并返回 unsubscribe', async () => {
    await import('../../src/preload/index');
    const api = exposed.electronAPI as { system: { onAppEvent: (callback: (event: unknown) => void) => () => void } };

    const callback = vi.fn();
    const unsubscribe = api.system.onAppEvent(callback);

    expect(typeof unsubscribe).toBe('function');
    expect(ipcRendererMock.on).toHaveBeenCalledWith('system:app-event', expect.any(Function));

    const subscription = ipcRendererMock.on.mock.calls[0][1];
    const appEvent = {
      type: 'favorite-tags:changed',
      version: 1,
      occurredAt: '2026-04-24T00:00:00.000Z',
      source: 'booruService',
      payload: { action: 'updated', favoriteTagId: 1 },
    };
    subscription({}, appEvent);
    expect(callback).toHaveBeenCalledWith(appEvent);

    unsubscribe();
    expect(ipcRendererMock.removeListener).toHaveBeenCalledWith('system:app-event', subscription);
  });
});
