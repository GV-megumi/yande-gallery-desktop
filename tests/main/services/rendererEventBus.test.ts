import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RendererAppEvent } from '../../../src/shared/types';

const state = vi.hoisted(() => ({
  windows: [] as Array<{
    destroyed: boolean;
    webContents: { send: ReturnType<typeof vi.fn> };
    isDestroyed: () => boolean;
  }>,
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => state.windows,
  },
}));

describe('rendererEventBus', () => {
  beforeEach(() => {
    vi.resetModules();
    state.windows = [];
  });

  const event: RendererAppEvent = {
    type: 'favorite-tags:changed',
    version: 1,
    occurredAt: '2026-04-24T00:00:00.000Z',
    source: 'booruService',
    payload: { action: 'updated', favoriteTagId: 1 },
  };

  it('向所有存活窗口广播 app event', async () => {
    const liveA = { destroyed: false, webContents: { send: vi.fn() }, isDestroyed() { return this.destroyed; } };
    const liveB = { destroyed: false, webContents: { send: vi.fn() }, isDestroyed() { return this.destroyed; } };
    state.windows = [liveA, liveB];

    const { emitRendererAppEvent } = await import('../../../src/main/services/rendererEventBus');
    emitRendererAppEvent(event);

    await vi.waitFor(() => {
      expect(liveA.webContents.send).toHaveBeenCalledWith('system:app-event', event);
      expect(liveB.webContents.send).toHaveBeenCalledWith('system:app-event', event);
    });
  });

  it('跳过已销毁窗口', async () => {
    const destroyed = { destroyed: true, webContents: { send: vi.fn() }, isDestroyed() { return this.destroyed; } };
    state.windows = [destroyed];

    const { emitRendererAppEvent } = await import('../../../src/main/services/rendererEventBus');
    emitRendererAppEvent(event);

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(destroyed.webContents.send).not.toHaveBeenCalled();
  });

  it('没有窗口时不抛错', async () => {
    const { emitRendererAppEvent } = await import('../../../src/main/services/rendererEventBus');
    expect(() => emitRendererAppEvent(event)).not.toThrow();
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  it('单个窗口发送失败不影响其它窗口且不向业务层抛错', async () => {
    const broken = {
      destroyed: false,
      webContents: { send: vi.fn(() => { throw new Error('send failed'); }) },
      isDestroyed() { return this.destroyed; },
    };
    const live = { destroyed: false, webContents: { send: vi.fn() }, isDestroyed() { return this.destroyed; } };
    state.windows = [broken, live];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { emitRendererAppEvent } = await import('../../../src/main/services/rendererEventBus');
    expect(() => emitRendererAppEvent(event)).not.toThrow();

    await vi.waitFor(() => {
      expect(broken.webContents.send).toHaveBeenCalledWith('system:app-event', event);
      expect(live.webContents.send).toHaveBeenCalledWith('system:app-event', event);
      expect(warnSpy).toHaveBeenCalledWith(
        '[rendererEventBus] 广播应用内事件失败:',
        event.type,
        'send failed',
      );
    });
    warnSpy.mockRestore();
  });

  it('窗口对象缺少 isDestroyed 时也不向业务层抛错', async () => {
    const partialWindow = { destroyed: false, webContents: { send: vi.fn() } } as any;
    state.windows = [partialWindow];

    const { emitRendererAppEvent } = await import('../../../src/main/services/rendererEventBus');
    expect(() => emitRendererAppEvent(event)).not.toThrow();

    await vi.waitFor(() => {
      expect(partialWindow.webContents.send).toHaveBeenCalledWith('system:app-event', event);
    });
  });
});
