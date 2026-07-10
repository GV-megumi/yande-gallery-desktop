import { beforeEach, describe, expect, it, vi } from 'vitest';

const { closeAllApiEvents, publishApiEvent } = vi.hoisted(() => ({
  closeAllApiEvents: vi.fn(),
  publishApiEvent: vi.fn(),
}));
const saveConfig = vi.fn(async () => ({ success: true }));
const createApiHttpServer = vi.fn();
const getApiServiceConfig = vi.fn(() => ({
  enabled: false,
  mode: 'localhost',
  port: 38947,
  apiKey: '',
  app: { enabled: false },
  permissions: {},
  logs: { enabled: false, visibleInUi: false },
}));

vi.mock('../../../src/main/services/config.js', () => ({
  getApiServiceConfig,
  saveConfig,
}));

vi.mock('../../../src/main/api/server.js', () => ({
  createApiHttpServer,
}));

vi.mock('../../../src/main/api/events/eventHub.js', () => ({
  apiEventHub: {
    closeAll: closeAllApiEvents,
    publish: publishApiEvent,
  },
}));

function createConfig(overrides: Record<string, unknown> = {}) {
  return {
    enabled: false,
    mode: 'localhost',
    port: 38947,
    apiKey: '',
    app: { enabled: false },
    permissions: {},
    logs: { enabled: false, visibleInUi: false },
    ...overrides,
  };
}

async function flushPromises(count = 5): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

function createFakeServer() {
  let listenCallback: (() => void) | undefined;
  const startupErrorHandlers = new Set<(error: Error) => void>();
  const runtimeErrorHandlers = new Set<(error: Error) => void>();
  const connectionHandlers = new Set<(socket: { destroy: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }) => void>();

  const fakeServer = {
    once: vi.fn((event: string, handler: (error: Error) => void) => {
      if (event === 'error') {
        startupErrorHandlers.add(handler);
      }

      return fakeServer;
    }),
    on: vi.fn((event: string, handler: (error: Error) => void) => {
      if (event === 'error') {
        runtimeErrorHandlers.add(handler);
      }
      if (event === 'connection') {
        connectionHandlers.add(handler as unknown as (socket: { destroy: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }) => void);
      }

      return fakeServer;
    }),
    off: vi.fn((event: string, handler: (error: Error) => void) => {
      if (event === 'error') {
        startupErrorHandlers.delete(handler);
        runtimeErrorHandlers.delete(handler);
      }
      if (event === 'connection') {
        connectionHandlers.delete(handler as unknown as (socket: { destroy: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }) => void);
      }

      return fakeServer;
    }),
    removeListener: vi.fn((event: string, handler: (error: Error) => void) => {
      if (event === 'error') {
        startupErrorHandlers.delete(handler);
        runtimeErrorHandlers.delete(handler);
      }
      if (event === 'connection') {
        connectionHandlers.delete(handler as unknown as (socket: { destroy: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }) => void);
      }

      return fakeServer;
    }),
    listen: vi.fn((_port: number, _bindAddress: string, callback: () => void) => {
      listenCallback = callback;
      return fakeServer;
    }),
    close: vi.fn((callback?: (error?: Error) => void) => {
      callback?.();
      return fakeServer;
    }),
    closeAllConnections: vi.fn(),
    succeedListen() {
      listenCallback?.();
    },
    failListen(error: Error) {
      const [handler] = startupErrorHandlers;
      handler?.(error);
    },
    emitRuntimeError(error: Error) {
      for (const handler of runtimeErrorHandlers) {
        handler(error);
      }
    },
    startupErrorListenerCount() {
      return startupErrorHandlers.size;
    },
    runtimeErrorListenerCount() {
      return runtimeErrorHandlers.size;
    },
    emitConnection(socket: { destroy: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }) {
      for (const handler of connectionHandlers) {
        handler(socket);
      }
    },
  };

  return fakeServer;
}

function createFakeSocket() {
  const closeHandlers = new Set<() => void>();
  const socket = {
    destroy: vi.fn(),
    on: vi.fn((event: string, handler: () => void) => {
      if (event === 'close') {
        closeHandlers.add(handler);
      }
      return socket;
    }),
    emitClose() {
      for (const handler of closeHandlers) {
        handler();
      }
    },
  };

  return socket;
}

describe('apiServiceManager', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    publishApiEvent.mockReset();
    saveConfig.mockResolvedValue({ success: true });
    getApiServiceConfig.mockReturnValue(createConfig());
  });

  it('generates and persists API key when current key is empty', async () => {
    const { generateAndSaveApiKey } = await import('../../../src/main/api/apiServiceManager.js');

    const result = await generateAndSaveApiKey();

    expect(result.success).toBe(true);
    expect(result.data?.apiKey.length).toBeGreaterThanOrEqual(32);
    expect(saveConfig).toHaveBeenCalledWith({ apiService: { apiKey: result.data?.apiKey } });
  });

  it('auto-generates and persists an API key before starting an enabled service with an empty key', async () => {
    getApiServiceConfig.mockReturnValue(createConfig({ enabled: true, apiKey: '' }));
    const fakeServer = createFakeServer();
    createApiHttpServer.mockReturnValue(fakeServer);
    const { syncApiServiceFromConfig } = await import('../../../src/main/api/apiServiceManager.js');

    const sync = syncApiServiceFromConfig();
    await flushPromises();

    expect(saveConfig).toHaveBeenCalledWith({
      apiService: { apiKey: expect.any(String) },
    });
    const generatedKey = saveConfig.mock.calls[0][0].apiService.apiKey;
    expect(generatedKey.length).toBeGreaterThanOrEqual(32);
    expect(createApiHttpServer).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ apiKey: generatedKey }),
    }));

    fakeServer.succeedListen();
    await expect(sync).resolves.toMatchObject({
      running: true,
      baseUrl: 'http://127.0.0.1:38947',
    });
  });

  it('does not start the API service when auto-generating the first API key fails', async () => {
    saveConfig.mockResolvedValueOnce({ success: false, error: 'save failed' });
    getApiServiceConfig.mockReturnValue(createConfig({ enabled: true, apiKey: '' }));
    const { syncApiServiceFromConfig } = await import('../../../src/main/api/apiServiceManager.js');

    await expect(syncApiServiceFromConfig()).resolves.toMatchObject({
      running: false,
      enabled: true,
      lastError: 'save failed',
    });
    expect(createApiHttpServer).not.toHaveBeenCalled();
  });

  it('reports stopped status when disabled', async () => {
    const { getApiServiceStatus } = await import('../../../src/main/api/apiServiceManager.js');

    expect(getApiServiceStatus()).toMatchObject({
      running: false,
      enabled: false,
      mode: 'localhost',
      port: 38947,
      bindAddress: null,
    });
  });

  it('仅 app.enabled=true 也启动服务器，且绑定 0.0.0.0（spec §6）', async () => {
    getApiServiceConfig.mockReturnValue(createConfig({
      enabled: false,
      app: { enabled: true },
      apiKey: 'test-api-key',
    }));
    const fakeServer = createFakeServer();
    createApiHttpServer.mockReturnValue(fakeServer);
    const { syncApiServiceFromConfig } = await import('../../../src/main/api/apiServiceManager.js');

    const sync = syncApiServiceFromConfig();
    await flushPromises();
    fakeServer.succeedListen();

    await expect(sync).resolves.toMatchObject({
      running: true,
      enabled: false,
      appEnabled: true,
    });
    expect(fakeServer.listen).toHaveBeenCalledWith(38947, '0.0.0.0', expect.any(Function));
  });

  it('enabled 与 app.enabled 均为 false 时不启动', async () => {
    getApiServiceConfig.mockReturnValue(createConfig({ enabled: false, app: { enabled: false } }));
    const { syncApiServiceFromConfig } = await import('../../../src/main/api/apiServiceManager.js');

    await expect(syncApiServiceFromConfig()).resolves.toMatchObject({
      running: false,
      appEnabled: false,
    });
    expect(createApiHttpServer).not.toHaveBeenCalled();
  });

  it('agent localhost 模式 + app.enabled=true 时仍强制绑定 0.0.0.0（手机连接=局域网）', async () => {
    getApiServiceConfig.mockReturnValue(createConfig({
      enabled: true,
      mode: 'localhost',
      app: { enabled: true },
      apiKey: 'test-api-key',
    }));
    const fakeServer = createFakeServer();
    createApiHttpServer.mockReturnValue(fakeServer);
    const { syncApiServiceFromConfig } = await import('../../../src/main/api/apiServiceManager.js');

    const sync = syncApiServiceFromConfig();
    await flushPromises();
    fakeServer.succeedListen();
    await sync;

    expect(fakeServer.listen).toHaveBeenCalledWith(38947, '0.0.0.0', expect.any(Function));
  });

  it('app 关闭时绑定回归 mode 旧逻辑（localhost → 127.0.0.1）', async () => {
    getApiServiceConfig.mockReturnValue(createConfig({
      enabled: true,
      mode: 'localhost',
      app: { enabled: false },
      apiKey: 'test-api-key',
    }));
    const fakeServer = createFakeServer();
    createApiHttpServer.mockReturnValue(fakeServer);
    const { syncApiServiceFromConfig } = await import('../../../src/main/api/apiServiceManager.js');

    const sync = syncApiServiceFromConfig();
    await flushPromises();
    fakeServer.succeedListen();
    await sync;

    expect(fakeServer.listen).toHaveBeenCalledWith(38947, '127.0.0.1', expect.any(Function));
  });

  it('serializes concurrent sync calls so the second startup waits for the first lifecycle operation', async () => {
    getApiServiceConfig.mockReturnValue(createConfig({ enabled: true, apiKey: 'test-api-key' }));
    const firstServer = createFakeServer();
    const secondServer = createFakeServer();
    createApiHttpServer.mockReturnValueOnce(firstServer).mockReturnValueOnce(secondServer);
    const { syncApiServiceFromConfig } = await import('../../../src/main/api/apiServiceManager.js');

    const firstSync = syncApiServiceFromConfig();
    await Promise.resolve();
    const secondSync = syncApiServiceFromConfig();
    await Promise.resolve();
    await Promise.resolve();

    expect(createApiHttpServer).toHaveBeenCalledTimes(1);

    firstServer.succeedListen();
    await firstSync;
    await flushPromises();

    expect(firstServer.close).toHaveBeenCalledTimes(1);
    expect(createApiHttpServer).toHaveBeenCalledTimes(2);

    secondServer.succeedListen();
    await expect(secondSync).resolves.toMatchObject({
      running: true,
      baseUrl: 'http://127.0.0.1:38947',
    });
  });

  it('removes listen-time error listeners and records runtime server errors', async () => {
    getApiServiceConfig.mockReturnValue(createConfig({ enabled: true, apiKey: 'test-api-key' }));
    const fakeServer = createFakeServer();
    createApiHttpServer.mockReturnValue(fakeServer);
    const { getApiServiceStatus, stopApiService, syncApiServiceFromConfig } = await import(
      '../../../src/main/api/apiServiceManager.js'
    );

    const sync = syncApiServiceFromConfig();
    await Promise.resolve();
    await Promise.resolve();
    fakeServer.succeedListen();
    await expect(sync).resolves.toMatchObject({ running: true, lastError: null });

    expect(fakeServer.startupErrorListenerCount()).toBe(0);
    expect(fakeServer.runtimeErrorListenerCount()).toBe(1);

    fakeServer.emitRuntimeError(new Error('runtime failure'));

    expect(getApiServiceStatus()).toMatchObject({
      running: false,
      bindAddress: null,
      baseUrl: null,
      startedAt: null,
      lastError: 'runtime failure',
    });
    await stopApiService();
    expect(fakeServer.close).not.toHaveBeenCalled();
  });

  it('keeps the active server when close fails so a later stop can retry it', async () => {
    getApiServiceConfig.mockReturnValue(createConfig({ enabled: true, apiKey: 'test-api-key' }));
    const closeError = new Error('close failed');
    const fakeServer = createFakeServer();
    fakeServer.close
      .mockImplementationOnce((callback?: (error?: Error) => void) => {
        callback?.(closeError);
        return fakeServer;
      })
      .mockImplementationOnce((callback?: (error?: Error) => void) => {
        callback?.();
        return fakeServer;
      });
    createApiHttpServer.mockReturnValue(fakeServer);
    const { getApiServiceStatus, stopApiService, syncApiServiceFromConfig } = await import(
      '../../../src/main/api/apiServiceManager.js'
    );

    const sync = syncApiServiceFromConfig();
    await Promise.resolve();
    await Promise.resolve();
    fakeServer.succeedListen();
    await sync;

    await expect(stopApiService()).rejects.toThrow('close failed');
    expect(getApiServiceStatus()).toMatchObject({
      running: true,
      lastError: 'close failed',
      baseUrl: 'http://127.0.0.1:38947',
    });
    expect(fakeServer.runtimeErrorListenerCount()).toBe(1);

    await expect(stopApiService()).resolves.toBeUndefined();
    expect(fakeServer.close).toHaveBeenCalledTimes(2);
    expect(getApiServiceStatus()).toMatchObject({
      running: false,
      baseUrl: null,
      lastError: 'close failed',
    });
    expect(fakeServer.runtimeErrorListenerCount()).toBe(0);
  });

  it('closes API event streams before closing the server on explicit stop', async () => {
    const closeOrder: string[] = [];
    closeAllApiEvents.mockImplementationOnce(() => {
      closeOrder.push('events');
    });
    getApiServiceConfig.mockReturnValue(createConfig({ enabled: true, apiKey: 'test-api-key' }));
    const fakeServer = createFakeServer();
    fakeServer.close.mockImplementationOnce((callback?: (error?: Error) => void) => {
      closeOrder.push('server');
      callback?.();
      return fakeServer;
    });
    createApiHttpServer.mockReturnValue(fakeServer);
    const { stopApiService, syncApiServiceFromConfig } = await import('../../../src/main/api/apiServiceManager.js');

    const sync = syncApiServiceFromConfig();
    await Promise.resolve();
    await Promise.resolve();
    fakeServer.succeedListen();
    await sync;

    await expect(stopApiService()).resolves.toBeUndefined();

    expect(closeAllApiEvents).toHaveBeenCalledTimes(1);
    expect(fakeServer.close).toHaveBeenCalledTimes(1);
    expect(closeOrder).toEqual(['events', 'server']);
  });

  it('forces remaining active connections closed when graceful server close times out', async () => {
    vi.useFakeTimers();
    getApiServiceConfig.mockReturnValue(createConfig({ enabled: true, apiKey: 'test-api-key' }));
    const fakeServer = createFakeServer();
    fakeServer.close.mockImplementationOnce(() => fakeServer);
    createApiHttpServer.mockReturnValue(fakeServer);
    const { stopApiService, syncApiServiceFromConfig } = await import('../../../src/main/api/apiServiceManager.js');

    const sync = syncApiServiceFromConfig();
    await Promise.resolve();
    await Promise.resolve();
    fakeServer.succeedListen();
    await sync;
    const socket = createFakeSocket();
    fakeServer.emitConnection(socket);

    const stop = stopApiService().then(() => 'resolved');
    await vi.advanceTimersByTimeAsync(5000);

    await expect(Promise.race([stop, Promise.resolve('pending')])).resolves.toBe('resolved');
    expect(closeAllApiEvents).toHaveBeenCalledTimes(1);
    expect(fakeServer.close).toHaveBeenCalledTimes(1);
    expect(fakeServer.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(socket.destroy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('closes API event streams before closing the server during disabled config sync', async () => {
    const closeOrder: string[] = [];
    closeAllApiEvents.mockImplementationOnce(() => {
      closeOrder.push('events');
    });
    const fakeServer = createFakeServer();
    fakeServer.close.mockImplementationOnce((callback?: (error?: Error) => void) => {
      closeOrder.push('server');
      callback?.();
      return fakeServer;
    });
    createApiHttpServer.mockReturnValue(fakeServer);
    getApiServiceConfig.mockReturnValue(createConfig({ enabled: true, apiKey: 'test-api-key' }));
    const { syncApiServiceFromConfig } = await import('../../../src/main/api/apiServiceManager.js');

    const start = syncApiServiceFromConfig();
    await Promise.resolve();
    await Promise.resolve();
    fakeServer.succeedListen();
    await start;

    getApiServiceConfig.mockReturnValue(createConfig({ enabled: false, apiKey: 'test-api-key' }));

    await expect(syncApiServiceFromConfig()).resolves.toMatchObject({ running: false, enabled: false });

    expect(closeAllApiEvents).toHaveBeenCalledTimes(1);
    expect(fakeServer.close).toHaveBeenCalledTimes(1);
    expect(closeOrder).toEqual(['events', 'server']);
  });

  it('does not report running when runtime error clears server before close rejects', async () => {
    getApiServiceConfig.mockReturnValue(createConfig({ enabled: true, apiKey: 'test-api-key' }));
    const fakeServer = createFakeServer();
    fakeServer.close.mockImplementationOnce((callback?: (error?: Error) => void) => {
      fakeServer.emitRuntimeError(new Error('runtime failure during close'));
      callback?.(new Error('close failed after runtime error'));
      return fakeServer;
    });
    createApiHttpServer.mockReturnValue(fakeServer);
    const { getApiServiceStatus, stopApiService, syncApiServiceFromConfig } = await import(
      '../../../src/main/api/apiServiceManager.js'
    );

    const sync = syncApiServiceFromConfig();
    await Promise.resolve();
    await Promise.resolve();
    fakeServer.succeedListen();
    await sync;

    await expect(stopApiService()).rejects.toThrow('close failed after runtime error');
    expect(getApiServiceStatus()).toMatchObject({
      running: false,
      bindAddress: null,
      baseUrl: null,
      startedAt: null,
      lastError: 'close failed after runtime error',
    });

    await expect(stopApiService()).resolves.toBeUndefined();
    expect(fakeServer.close).toHaveBeenCalledTimes(1);
  });

  it('preserves active runtime status when close fails during config-change sync', async () => {
    const closeError = new Error('close failed during config change');
    const firstServer = createFakeServer();
    const secondServer = createFakeServer();
    firstServer.close
      .mockImplementationOnce((callback?: (error?: Error) => void) => {
        callback?.(closeError);
        return firstServer;
      })
      .mockImplementationOnce((callback?: (error?: Error) => void) => {
        callback?.();
        return firstServer;
      });
    createApiHttpServer.mockReturnValueOnce(firstServer).mockReturnValueOnce(secondServer);
    getApiServiceConfig.mockReturnValue(createConfig({ enabled: true, port: 38947, apiKey: 'test-api-key' }));
    const { getApiServiceStatus, stopApiService, syncApiServiceFromConfig } = await import(
      '../../../src/main/api/apiServiceManager.js'
    );

    const firstSync = syncApiServiceFromConfig();
    await Promise.resolve();
    await Promise.resolve();
    firstServer.succeedListen();
    await expect(firstSync).resolves.toMatchObject({
      running: true,
      port: 38947,
      baseUrl: 'http://127.0.0.1:38947',
    });

    getApiServiceConfig.mockReturnValue(createConfig({ enabled: true, port: 38948, apiKey: 'test-api-key' }));

    await expect(syncApiServiceFromConfig()).rejects.toThrow('close failed during config change');
    expect(createApiHttpServer).toHaveBeenCalledTimes(1);
    expect(getApiServiceStatus()).toMatchObject({
      running: true,
      enabled: true,
      mode: 'localhost',
      port: 38947,
      bindAddress: '127.0.0.1',
      baseUrl: 'http://127.0.0.1:38947',
      lastError: 'close failed during config change',
    });

    getApiServiceConfig.mockReturnValue(createConfig({ enabled: false, port: 38948, apiKey: 'test-api-key' }));
    await expect(stopApiService()).resolves.toBeUndefined();
    expect(firstServer.close).toHaveBeenCalledTimes(2);
    expect(getApiServiceStatus()).toMatchObject({
      running: false,
      enabled: false,
      port: 38948,
      bindAddress: null,
      baseUrl: null,
    });
  });

  it('clears the pending server when listen fails before a later disabled sync', async () => {
    const listenError = new Error('listen failed');
    let errorHandler: ((error: Error) => void) | undefined;
    const fakeServer = {
      once: vi.fn((event: string, handler: (error: Error) => void) => {
        if (event === 'error') {
          errorHandler = handler;
        }

        return fakeServer;
      }),
      listen: vi.fn(() => {
        errorHandler?.(listenError);
        return fakeServer;
      }),
      close: vi.fn(() => {
        throw new Error('stale unstarted server close attempted');
      }),
    };
    createApiHttpServer.mockReturnValue(fakeServer);
    getApiServiceConfig
      .mockReturnValueOnce(createConfig({ enabled: true, apiKey: 'test-api-key' }))
      .mockReturnValue(createConfig({ enabled: false, apiKey: 'test-api-key' }));
    const { syncApiServiceFromConfig } = await import('../../../src/main/api/apiServiceManager.js');

    await expect(syncApiServiceFromConfig()).resolves.toMatchObject({
      running: false,
      lastError: 'listen failed',
    });
    await expect(syncApiServiceFromConfig()).resolves.toMatchObject({
      running: false,
      enabled: false,
    });
    expect(fakeServer.close).not.toHaveBeenCalled();
  });
});
