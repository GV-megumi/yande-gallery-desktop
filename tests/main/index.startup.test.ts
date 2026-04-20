import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockWhenReady = vi.fn();
const mockOn = vi.fn();
const mockQuit = vi.fn();
const mockDisableHardwareAcceleration = vi.fn();
const mockRequestSingleInstanceLock = vi.fn(() => true);
const mockSetApplicationMenu = vi.fn();
const mockBuildFromTemplate = vi.fn((template) => template);
const mockRegisterFileProtocol = vi.fn();
const mockRegisterSchemesAsPrivileged = vi.fn();
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
    buildFromTemplate: mockBuildFromTemplate,
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

describe('main index startup sequencing', () => {
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
    mockBuildFromTemplate.mockClear();
    mockRegisterFileProtocol.mockReset();
    mockRegisterSchemesAsPrivileged.mockReset();
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
    Object.defineProperty(process, 'on', {
      value: mockProcessOn,
      configurable: true,
    });
  });

  it('应在非关键初始化完成前先创建窗口并注册 IPC', async () => {
    let readyHandler: (() => Promise<void> | void) | undefined;
    mockWhenReady.mockImplementation(() => ({
      then: (handler: () => Promise<void> | void) => {
        readyHandler = handler;
        return Promise.resolve();
      },
    }));

    await import('../../src/main/index.js');

    expect(readyHandler).toBeTypeOf('function');
    readyHandler?.();
    await Promise.resolve();

    expect(mockCreateWindow).toHaveBeenCalledTimes(1);
    expect(mockSetupIPC).toHaveBeenCalledTimes(1);
    expect(mockSetupWindowIPC).toHaveBeenCalledTimes(1);
    expect(mockInitializeApp).toHaveBeenCalledTimes(1);
    expect(mockCreateWindow.mock.invocationCallOrder[0]).toBeLessThan(mockInitializeApp.mock.invocationCallOrder[0]);
    expect(mockSetupIPC.mock.invocationCallOrder[0]).toBeLessThan(mockInitializeApp.mock.invocationCallOrder[0]);
  });

  it('应在 before-quit 首次触发时阻止默认退出并在清理完成后再次调用 quit', async () => {
    mockWhenReady.mockImplementation(() => ({
      then: (handler: () => Promise<void> | void) => {
        handler();
        return Promise.resolve();
      },
    }));

    let resolveShutdown: (() => void) | undefined;
    mockShutdownAppResources.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveShutdown = resolve;
    }));

    await import('../../src/main/index.js');

    const beforeQuitHandler = mockOn.mock.calls.find(([event]) => event === 'before-quit')?.[1];
    expect(beforeQuitHandler).toBeTypeOf('function');

    const event = { preventDefault: vi.fn() };
    beforeQuitHandler?.(event);
    await Promise.resolve();

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mockShutdownAppResources).toHaveBeenCalledTimes(1);
    expect(mockQuit).not.toHaveBeenCalled();

    resolveShutdown?.();
    await Promise.resolve();
    await Promise.resolve();
    await vi.waitFor(() => {
      expect(mockQuit).toHaveBeenCalledTimes(1);
    });
  });

  it('will-quit 独立触发时也应进入统一清理链路并在完成后再次调用 quit', async () => {
    mockWhenReady.mockImplementation(() => ({
      then: (handler: () => Promise<void> | void) => {
        handler();
        return Promise.resolve();
      },
    }));

    let resolveShutdown: (() => void) | undefined;
    mockShutdownAppResources.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveShutdown = resolve;
    }));

    await import('../../src/main/index.js');

    const willQuitHandler = mockOn.mock.calls.find(([event]) => event === 'will-quit')?.[1];
    expect(willQuitHandler).toBeTypeOf('function');

    const event = { preventDefault: vi.fn() };
    willQuitHandler?.(event);
    await Promise.resolve();

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mockShutdownAppResources).toHaveBeenCalledTimes(1);
    expect(mockQuit).not.toHaveBeenCalled();

    resolveShutdown?.();
    await Promise.resolve();
    await Promise.resolve();
    await vi.waitFor(() => {
      expect(mockQuit).toHaveBeenCalledTimes(1);
    });
  });

  it('应避免 before-quit 与 will-quit 重复执行清理', async () => {
    mockWhenReady.mockImplementation(() => ({
      then: (handler: () => Promise<void> | void) => {
        handler();
        return Promise.resolve();
      },
    }));

    let resolveShutdown: (() => void) | undefined;
    mockShutdownAppResources.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveShutdown = resolve;
    }));

    await import('../../src/main/index.js');

    const beforeQuitHandler = mockOn.mock.calls.find(([event]) => event === 'before-quit')?.[1];
    const willQuitHandler = mockOn.mock.calls.find(([event]) => event === 'will-quit')?.[1];

    expect(beforeQuitHandler).toBeTypeOf('function');
    expect(willQuitHandler).toBeTypeOf('function');

    const beforeQuitEvent = { preventDefault: vi.fn() };
    const willQuitEvent = { preventDefault: vi.fn() };
    beforeQuitHandler?.(beforeQuitEvent);
    await Promise.resolve();
    willQuitHandler?.(willQuitEvent);
    await Promise.resolve();

    expect(beforeQuitEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(willQuitEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(mockShutdownAppResources).toHaveBeenCalledTimes(1);
    expect(mockQuit).not.toHaveBeenCalled();

    resolveShutdown?.();
    await Promise.resolve();
    await Promise.resolve();
    await vi.waitFor(() => {
      expect(mockQuit).toHaveBeenCalledTimes(1);
    });
  });

  it('应注册 uncaughtException / unhandledRejection 与 process-gone 统一治理入口', async () => {
    mockWhenReady.mockImplementation(() => ({
      then: (handler: () => Promise<void> | void) => {
        handler();
        return Promise.resolve();
      },
    }));

    const webContentsOn = vi.fn();
    const processGoneWindow = {
      webContents: {
        on: webContentsOn,
      },
    };
    mockCreateWindow.mockReturnValue(processGoneWindow);

    await import('../../src/main/index.js');

    expect(mockProcessOn).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
    expect(mockProcessOn).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
    expect(webContentsOn).toHaveBeenCalledWith('render-process-gone', expect.any(Function));
  });

  it('异常治理入口触发时应复用统一资源清理链路', async () => {
    mockWhenReady.mockImplementation(() => ({
      then: (handler: () => Promise<void> | void) => {
        handler();
        return Promise.resolve();
      },
    }));

    const webContentsOn = vi.fn();
    const processGoneWindow = {
      webContents: {
        on: webContentsOn,
      },
    };
    mockCreateWindow.mockReturnValue(processGoneWindow);

    await import('../../src/main/index.js');

    const uncaughtExceptionHandler = mockProcessOn.mock.calls.find(([event]) => event === 'uncaughtException')?.[1];
    const unhandledRejectionHandler = mockProcessOn.mock.calls.find(([event]) => event === 'unhandledRejection')?.[1];
    const renderProcessGoneHandler = webContentsOn.mock.calls.find(([event]) => event === 'render-process-gone')?.[1];

    expect(uncaughtExceptionHandler).toBeTypeOf('function');
    expect(unhandledRejectionHandler).toBeTypeOf('function');
    expect(renderProcessGoneHandler).toBeTypeOf('function');

    await uncaughtExceptionHandler?.(new Error('boom'));
    await unhandledRejectionHandler?.(new Error('reject boom'));
    await renderProcessGoneHandler?.({}, { reason: 'crashed', exitCode: 1 });

    expect(mockShutdownAppResources).toHaveBeenCalledTimes(1);
  });
});
