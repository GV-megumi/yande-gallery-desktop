import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';

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

  it('onAppEvent 多订阅者复用同一个底层 ipc 监听器并在清空后移除', async () => {
    await import('../../src/preload/index');
    const api = exposed.electronAPI as { system: { onAppEvent: (callback: (event: unknown) => void) => () => void } };

    const callbackA = vi.fn();
    const callbackB = vi.fn();
    const unsubscribeA = api.system.onAppEvent(callbackA);
    const unsubscribeB = api.system.onAppEvent(callbackB);

    // 多个订阅者只注册一个底层 ipc 监听器（避免 MaxListenersExceeded 累积）
    const appEventOnCalls = ipcRendererMock.on.mock.calls.filter((call) => call[0] === 'system:app-event');
    expect(appEventOnCalls).toHaveLength(1);

    const subscription = appEventOnCalls[0][1];
    const appEvent = {
      type: 'booru:sites-changed',
      version: 1,
      occurredAt: '2026-06-10T00:00:00.000Z',
      source: 'booruService',
      payload: { action: 'updated', siteId: 1 },
    };
    subscription({}, appEvent);
    expect(callbackA).toHaveBeenCalledWith(appEvent);
    expect(callbackB).toHaveBeenCalledWith(appEvent);

    // 还有订阅者时不移除底层监听器
    unsubscribeA();
    expect(ipcRendererMock.removeListener).not.toHaveBeenCalledWith('system:app-event', expect.any(Function));

    // 重复退订不影响其他订阅者
    unsubscribeA();
    subscription({}, appEvent);
    expect(callbackA).toHaveBeenCalledTimes(1);
    expect(callbackB).toHaveBeenCalledTimes(2);

    // 最后一个订阅者退订后移除底层监听器
    unsubscribeB();
    expect(ipcRendererMock.removeListener).toHaveBeenCalledWith('system:app-event', subscription);

    // 清空后再次订阅会重新懒注册底层监听器
    api.system.onAppEvent(vi.fn());
    const reRegistered = ipcRendererMock.on.mock.calls.filter((call) => call[0] === 'system:app-event');
    expect(reRegistered).toHaveLength(2);
  });

  it('主窗口 apiService 域暴露配置、状态、key 和日志能力', async () => {
    await import('../../src/preload/index');
    const api = exposed.electronAPI as any;

    expect(typeof api.apiService.getConfig).toBe('function');
    expect(typeof api.apiService.saveConfig).toBe('function');
    expect(typeof api.apiService.getStatus).toBe('function');
    expect(typeof api.apiService.generateKey).toBe('function');
    expect(typeof api.apiService.getLogs).toBe('function');

    await api.apiService.getConfig();
    expect(ipcRendererMock.invoke).toHaveBeenCalledWith('api-service:get-config');

    const patch = { permissions: { galleryRead: false } };
    await api.apiService.saveConfig(patch);
    expect(ipcRendererMock.invoke).toHaveBeenCalledWith('api-service:save-config', patch);

    await api.apiService.getStatus();
    expect(ipcRendererMock.invoke).toHaveBeenCalledWith('api-service:get-status');

    await api.apiService.generateKey();
    expect(ipcRendererMock.invoke).toHaveBeenCalledWith('api-service:generate-key');

    const query = { limit: 20 };
    await api.apiService.getLogs(query);
    expect(ipcRendererMock.invoke).toHaveBeenCalledWith('api-service:get-logs', query);
  });

  it('Window.electronAPI.config desktop 类型声明包含 hardwareAcceleration', () => {
    const preloadSource = fs.readFileSync(
      new URL('../../src/preload/index.ts', import.meta.url),
      'utf8',
    );

    expect(preloadSource).toMatch(/getDesktop:[\s\S]*hardwareAcceleration: boolean/);
    expect(preloadSource).toMatch(/setDesktop:[\s\S]*hardwareAcceleration\?: boolean/);
  });
});
