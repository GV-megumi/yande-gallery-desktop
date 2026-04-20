import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockWhenReady = vi.fn();
const mockOn = vi.fn();
const mockQuit = vi.fn();
const mockDisableHardwareAcceleration = vi.fn();
const mockRequestSingleInstanceLock = vi.fn(() => true);
const mockSetApplicationMenu = vi.fn();
const mockRegisterSchemesAsPrivileged = vi.fn();
const mockRegisterFileProtocol = vi.fn();
const mockGetAllWindows = vi.fn(() => []);
const mockCreateWindow = vi.fn();
const mockSetupWindowIPC = vi.fn();
const mockSetupIPC = vi.fn();
const mockInitializeApp = vi.fn(() => new Promise<{ success: boolean }>(() => {}));
const mockShutdownAppResources = vi.fn().mockResolvedValue(undefined);
const mockProcessOn = vi.fn();
const mockMarkAppQuitting = vi.fn();
const mockSetCloseToTrayEnabled = vi.fn();
const mockRestoreOrCreateMainWindow = vi.fn();
const mockSetMainWindowFactory = vi.fn();

vi.mock('electron', () => ({
  app: {
    whenReady: mockWhenReady,
    on: mockOn,
    quit: mockQuit,
    disableHardwareAcceleration: mockDisableHardwareAcceleration,
    requestSingleInstanceLock: mockRequestSingleInstanceLock,
  },
  BrowserWindow: {
    getAllWindows: mockGetAllWindows,
  },
  Tray: class {
    setToolTip = vi.fn();
    setContextMenu = vi.fn();
    on = vi.fn();
  },
  ipcMain: {},
  protocol: {
    registerSchemesAsPrivileged: mockRegisterSchemesAsPrivileged,
    registerFileProtocol: mockRegisterFileProtocol,
  },
  Menu: {
    setApplicationMenu: mockSetApplicationMenu,
    buildFromTemplate: vi.fn((template) => template),
  },
}));

vi.mock('../../src/main/window.js', () => ({
  createWindow: mockCreateWindow,
  markAppQuitting: mockMarkAppQuitting,
  resolveAppIconPath: vi.fn(() => 'M:/assets/icon.png'),
  setupWindowIPC: mockSetupWindowIPC,
  setCloseToTrayEnabled: mockSetCloseToTrayEnabled,
  setMainWindowFactory: mockSetMainWindowFactory,
  restoreOrCreateMainWindow: mockRestoreOrCreateMainWindow,
}));

vi.mock('../../src/main/ipc/handlers.js', () => ({
  setupIPC: mockSetupIPC,
}));

vi.mock('../../src/main/services/init.js', () => ({
  initializeApp: mockInitializeApp,
  shutdownAppResources: mockShutdownAppResources,
}));

describe('main index desktop lifecycle', () => {
  const originalProcessOn = process.on;

  beforeEach(() => {
    vi.resetModules();
    mockWhenReady.mockReset();
    mockOn.mockReset();
    mockQuit.mockReset();
    mockDisableHardwareAcceleration.mockReset();
    mockRequestSingleInstanceLock.mockReset();
    mockRequestSingleInstanceLock.mockReturnValue(true);
    mockSetApplicationMenu.mockReset();
    mockRegisterSchemesAsPrivileged.mockReset();
    mockRegisterFileProtocol.mockReset();
    mockGetAllWindows.mockReset();
    mockGetAllWindows.mockReturnValue([]);
    mockCreateWindow.mockReset();
    mockSetupWindowIPC.mockReset();
    mockSetupIPC.mockReset();
    mockInitializeApp.mockReset();
    mockInitializeApp.mockImplementation(() => new Promise<{ success: boolean }>(() => {}));
    mockShutdownAppResources.mockReset();
    mockShutdownAppResources.mockResolvedValue(undefined);
    mockProcessOn.mockReset();
    mockMarkAppQuitting.mockReset();
    mockSetCloseToTrayEnabled.mockReset();
    mockRestoreOrCreateMainWindow.mockReset();
    mockSetMainWindowFactory.mockReset();

    mockWhenReady.mockImplementation(() => ({
      then: () => Promise.resolve(),
    }));

    Object.defineProperty(process, 'on', {
      value: mockProcessOn,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'on', {
      value: originalProcessOn,
      configurable: true,
    });
  });

  it('second-instance 到来且当前没有主窗口时应走统一主窗口恢复入口', async () => {
    await import('../../src/main/index.js');
    mockRestoreOrCreateMainWindow.mockClear();

    const secondInstanceHandler = mockOn.mock.calls.find(([event]) => event === 'second-instance')?.[1];
    expect(secondInstanceHandler).toBeTypeOf('function');

    secondInstanceHandler?.();

    expect(mockRestoreOrCreateMainWindow).toHaveBeenCalledTimes(1);
  });

  it('second-instance 到来时应复用统一主窗口恢复入口处理隐藏窗口', async () => {
    await import('../../src/main/index.js');
    mockRestoreOrCreateMainWindow.mockClear();

    const secondInstanceHandler = mockOn.mock.calls.find(([event]) => event === 'second-instance')?.[1];
    expect(secondInstanceHandler).toBeTypeOf('function');

    secondInstanceHandler?.();

    expect(mockRestoreOrCreateMainWindow).toHaveBeenCalledTimes(1);
    expect(mockCreateWindow).not.toHaveBeenCalled();
  });

  it('tray 可用的非显式退出场景下 window-all-closed 不应直接退出应用', async () => {
    mockWhenReady.mockImplementation(() => ({
      then: async (handler: () => Promise<void> | void) => {
        await handler();
        return Promise.resolve();
      },
    }));

    await import('../../src/main/index.js');

    const windowAllClosedHandler = mockOn.mock.calls.find(([event]) => event === 'window-all-closed')?.[1];
    expect(windowAllClosedHandler).toBeTypeOf('function');

    mockQuit.mockClear();
    mockMarkAppQuitting.mockClear();
    windowAllClosedHandler?.();

    expect(mockMarkAppQuitting).not.toHaveBeenCalled();
    expect(mockQuit).not.toHaveBeenCalled();
  });
});
