import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  getAllWindows: vi.fn(() => []),
  getApiServiceStatus: vi.fn(() => ({ running: false })),
  syncApiServiceFromConfig: vi.fn(async () => ({ running: true })),
  generateAndSaveApiKey: vi.fn(async () => ({ success: true, data: { apiKey: 'new-key' } })),
  queryApiLogs: vi.fn(async () => ({ items: [], total: 0 })),
  getConfig: vi.fn(() => ({
    apiService: {
      enabled: false,
      mode: 'localhost',
      port: 38947,
      apiKey: '',
      permissions: {},
      logs: { enabled: false, visibleInUi: false },
    },
  })),
  saveConfig: vi.fn(async () => ({ success: true })),
}));
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

vi.mock('electron', () => ({
  app: { setLoginItemSettings: vi.fn() },
  BrowserWindow: { getAllWindows: mocks.getAllWindows },
  ipcMain: { handle: mocks.handle },
}));

vi.mock('os', () => ({
  default: {
    hostname: vi.fn(() => 'test-host'),
    networkInterfaces: vi.fn(() => ({
      lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      eth0: [
        { family: 'IPv4', internal: false, address: '192.168.1.10' },
        { family: 'IPv6', internal: false, address: 'fe80::1' },
      ],
      wlan0: [{ family: 'IPv4', internal: false, address: '10.0.0.5' }],
    })),
  },
}));

vi.mock('../../../src/main/api/apiServiceManager.js', () => ({
  getApiServiceStatus: mocks.getApiServiceStatus,
  syncApiServiceFromConfig: mocks.syncApiServiceFromConfig,
  generateAndSaveApiKey: mocks.generateAndSaveApiKey,
}));

vi.mock('../../../src/main/services/apiLogService.js', () => ({
  queryApiLogs: mocks.queryApiLogs,
}));

vi.mock('../../../src/main/services/config.js', () => ({
  getConfig: mocks.getConfig,
  getBooruAppearancePreference: vi.fn(() => ({})),
  getApiServiceConfig: vi.fn(() => ({
    enabled: false,
    mode: 'localhost',
    port: 38947,
    apiKey: '',
    permissions: {},
    logs: { enabled: false, visibleInUi: false },
  })),
  saveConfig: mocks.saveConfig,
  updateGalleryFolders: vi.fn(),
  reloadConfig: vi.fn(),
  toRendererSafeConfig: vi.fn((value) => value),
  getNotificationsConfig: vi.fn(() => ({})),
  getDesktopConfig: vi.fn(() => ({ autoLaunch: false, startMinimized: false })),
}));

async function registerHandlers() {
  const { setupConfigHandlers } = await import('../../../src/main/ipc/handlers/configHandlers.js');
  const { IPC_CHANNELS } = await import('../../../src/main/ipc/channels.js');
  setupConfigHandlers();
  const handlers = new Map<string, (...args: any[]) => any>(mocks.handle.mock.calls);
  return { IPC_CHANNELS, handlers };
}

describe('api service IPC handlers', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.handle.mockClear();
    mocks.getAllWindows.mockReset();
    mocks.getAllWindows.mockReturnValue([]);
    mocks.getApiServiceStatus.mockClear();
    mocks.syncApiServiceFromConfig.mockReset();
    mocks.syncApiServiceFromConfig.mockResolvedValue({ running: true });
    mocks.generateAndSaveApiKey.mockReset();
    mocks.generateAndSaveApiKey.mockResolvedValue({ success: true, data: { apiKey: 'new-key' } });
    mocks.queryApiLogs.mockClear();
    mocks.getConfig.mockClear();
    mocks.saveConfig.mockReset();
    mocks.saveConfig.mockResolvedValue({ success: true });
    warnSpy.mockClear();
  });

  it('registers API service handlers', async () => {
    const { IPC_CHANNELS } = await registerHandlers();

    expect(mocks.handle.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining([
      IPC_CHANNELS.API_SERVICE_GET_CONFIG,
      IPC_CHANNELS.API_SERVICE_SAVE_CONFIG,
      IPC_CHANNELS.API_SERVICE_GET_STATUS,
      IPC_CHANNELS.API_SERVICE_GENERATE_KEY,
      IPC_CHANNELS.API_SERVICE_GET_LOGS,
      IPC_CHANNELS.API_SERVICE_GET_PAIRING_INFO,
    ]));
  });

  it('API_SERVICE_SAVE_CONFIG saves patch, resyncs service, and broadcasts config changes on success', async () => {
    const window = { webContents: { send: vi.fn() } };
    mocks.getAllWindows.mockReturnValue([window]);
    const { IPC_CHANNELS, handlers } = await registerHandlers();
    const patch = { enabled: true, port: 38948 };

    await expect(handlers.get(IPC_CHANNELS.API_SERVICE_SAVE_CONFIG)?.({}, patch)).resolves.toEqual({ success: true });

    expect(mocks.saveConfig).toHaveBeenCalledWith({ apiService: patch });
    expect(mocks.syncApiServiceFromConfig).toHaveBeenCalledTimes(1);
    expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.CONFIG_CHANGED, {
      version: expect.any(Number),
      sections: ['apiService'],
    });
  });

  it('API_SERVICE_SAVE_CONFIG broadcasts and preserves save success when service resync fails', async () => {
    const window = { webContents: { send: vi.fn() } };
    mocks.getAllWindows.mockReturnValue([window]);
    mocks.syncApiServiceFromConfig.mockRejectedValue(new Error('sync failed'));
    const { IPC_CHANNELS, handlers } = await registerHandlers();
    const patch = { permissions: { galleryRead: false } };

    await expect(handlers.get(IPC_CHANNELS.API_SERVICE_SAVE_CONFIG)?.({}, patch)).resolves.toEqual({
      success: true,
      syncError: 'sync failed',
    });

    expect(mocks.saveConfig).toHaveBeenCalledWith({ apiService: patch });
    expect(mocks.syncApiServiceFromConfig).toHaveBeenCalledTimes(1);
    expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.CONFIG_CHANGED, {
      version: expect.any(Number),
      sections: ['apiService'],
    });
  });

  it('API_SERVICE_SAVE_CONFIG surfaces resolved start failures as syncError', async () => {
    const window = { webContents: { send: vi.fn() } };
    mocks.getAllWindows.mockReturnValue([window]);
    mocks.syncApiServiceFromConfig.mockResolvedValueOnce({
      enabled: true,
      running: false,
      lastError: 'EADDRINUSE',
    });
    const { IPC_CHANNELS, handlers } = await registerHandlers();
    const patch = { enabled: true };

    await expect(handlers.get(IPC_CHANNELS.API_SERVICE_SAVE_CONFIG)?.({}, patch)).resolves.toEqual({
      success: true,
      syncError: 'EADDRINUSE',
    });

    expect(mocks.saveConfig).toHaveBeenCalledWith({ apiService: patch });
    expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.CONFIG_CHANGED, {
      version: expect.any(Number),
      sections: ['apiService'],
    });
  });

  it('CONFIG_SAVE resyncs API service when apiService config is saved', async () => {
    const { IPC_CHANNELS, handlers } = await registerHandlers();
    const payload = { apiService: { enabled: true } };

    await expect(handlers.get(IPC_CHANNELS.CONFIG_SAVE)?.({}, payload)).resolves.toEqual({ success: true });

    expect(mocks.saveConfig).toHaveBeenCalledWith(payload);
    expect(mocks.syncApiServiceFromConfig).toHaveBeenCalledTimes(1);
  });

  it('CONFIG_SAVE broadcasts all changed sections and preserves save success when API service resync fails', async () => {
    const window = { webContents: { send: vi.fn() } };
    mocks.getAllWindows.mockReturnValue([window]);
    mocks.syncApiServiceFromConfig.mockRejectedValue(new Error('sync failed'));
    const { IPC_CHANNELS, handlers } = await registerHandlers();
    const payload = { apiService: { enabled: true }, desktop: { autoLaunch: true } };

    await expect(handlers.get(IPC_CHANNELS.CONFIG_SAVE)?.({}, payload)).resolves.toEqual({
      success: true,
      syncError: 'sync failed',
    });

    expect(mocks.saveConfig).toHaveBeenCalledWith(payload);
    expect(mocks.syncApiServiceFromConfig).toHaveBeenCalledTimes(1);
    expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.CONFIG_CHANGED, {
      version: expect.any(Number),
      sections: ['apiService', 'desktop'],
    });
  });

  it('API_SERVICE_GENERATE_KEY broadcasts and resyncs service after key generation succeeds', async () => {
    const window = { webContents: { send: vi.fn() } };
    mocks.getAllWindows.mockReturnValue([window]);
    const { IPC_CHANNELS, handlers } = await registerHandlers();

    await expect(handlers.get(IPC_CHANNELS.API_SERVICE_GENERATE_KEY)?.({})).resolves.toEqual({
      success: true,
      data: { apiKey: 'new-key' },
    });

    expect(mocks.generateAndSaveApiKey).toHaveBeenCalledTimes(1);
    expect(mocks.syncApiServiceFromConfig).toHaveBeenCalledTimes(1);
    expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.CONFIG_CHANGED, {
      version: expect.any(Number),
      sections: ['apiService'],
    });
  });

  it('API_SERVICE_GENERATE_KEY surfaces resolved start failures as syncError', async () => {
    const window = { webContents: { send: vi.fn() } };
    mocks.getAllWindows.mockReturnValue([window]);
    mocks.syncApiServiceFromConfig.mockResolvedValueOnce({
      enabled: true,
      running: false,
      lastError: 'EADDRINUSE',
    });
    const { IPC_CHANNELS, handlers } = await registerHandlers();

    await expect(handlers.get(IPC_CHANNELS.API_SERVICE_GENERATE_KEY)?.({})).resolves.toEqual({
      success: true,
      data: { apiKey: 'new-key' },
      syncError: 'EADDRINUSE',
    });

    expect(mocks.generateAndSaveApiKey).toHaveBeenCalledTimes(1);
    expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.CONFIG_CHANGED, {
      version: expect.any(Number),
      sections: ['apiService'],
    });
  });

  it('API_SERVICE_GET_LOGS delegates to queryApiLogs', async () => {
    const { IPC_CHANNELS, handlers } = await registerHandlers();
    const query = { limit: 20, offset: 0 };

    await expect(handlers.get(IPC_CHANNELS.API_SERVICE_GET_LOGS)?.({}, query)).resolves.toEqual({
      success: true,
      data: { items: [], total: 0 },
    });

    expect(mocks.queryApiLogs).toHaveBeenCalledWith(query);
  });

  it('API_SERVICE_GET_PAIRING_INFO 返回主机名、端口、key 与 IPv4 非环回地址', async () => {
    const { IPC_CHANNELS, handlers } = await registerHandlers();

    await expect(handlers.get(IPC_CHANNELS.API_SERVICE_GET_PAIRING_INFO)?.({})).resolves.toEqual({
      success: true,
      data: {
        name: 'test-host',
        port: 38947,
        mode: 'localhost',
        running: false,
        apiKey: expect.any(String),
        lanAddresses: ['192.168.1.10', '10.0.0.5'],
      },
    });
  });
});
