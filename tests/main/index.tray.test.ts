import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockWhenReady = vi.fn();
const mockOn = vi.fn();
const mockQuit = vi.fn();
const mockDisableHardwareAcceleration = vi.fn();
const mockRequestSingleInstanceLock = vi.fn(() => true);
const mockSetApplicationMenu = vi.fn();
const mockBuildFromTemplate = vi.fn((template) => template);
const mockRegisterSchemesAsPrivileged = vi.fn();
const mockRegisterFileProtocol = vi.fn();
const mockGetAllWindows = vi.fn(() => []);
const mockCreateWindow = vi.fn();
const mockSetupWindowIPC = vi.fn();
const mockSetupIPC = vi.fn();
const mockInitializeApp = vi.fn(async () => ({ success: true }));
const mockShutdownAppResources = vi.fn().mockResolvedValue(undefined);
const mockExistsSync = vi.fn(() => true);
const mockMarkAppQuitting = vi.fn();
const mockSetCloseToTrayEnabled = vi.fn();
const mockSetMainWindowFactory = vi.fn();
const mockRestoreOrCreateMainWindow = vi.fn();
const mockResolveAppIconPath = vi.fn(() => 'M:/assets/icon.png');
const mockTrayShouldThrowRef = { current: false };
const mockTrayContextMenuShouldThrowRef = { current: false };
const trayConstructorArgs: string[] = [];
const trayInstances: Array<{
  setToolTip: ReturnType<typeof vi.fn>;
  setContextMenu: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}> = [];

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    realpathSync: vi.fn((input: string) => input),
  },
  existsSync: mockExistsSync,
  realpathSync: vi.fn((input: string) => input),
}));

vi.mock('electron', () => ({
  app: {
    whenReady: mockWhenReady,
    on: mockOn,
    quit: mockQuit,
    disableHardwareAcceleration: mockDisableHardwareAcceleration,
    requestSingleInstanceLock: mockRequestSingleInstanceLock,
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: mockGetAllWindows,
  },
  Tray: class {
    setToolTip = vi.fn(() => {
      if (mockTrayContextMenuShouldThrowRef.current) {
        return undefined;
      }
    });
    setContextMenu = vi.fn(() => {
      if (mockTrayContextMenuShouldThrowRef.current) {
        throw new Error('tray context menu failed');
      }
    });
    on = vi.fn();

    constructor(iconPath: string) {
      trayConstructorArgs.push(iconPath);
      if (mockTrayShouldThrowRef.current) {
        throw new Error('tray init failed');
      }
      trayInstances.push(this);
    }
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
  setupWindowIPC: mockSetupWindowIPC,
  markAppQuitting: mockMarkAppQuitting,
  setCloseToTrayEnabled: mockSetCloseToTrayEnabled,
  setMainWindowFactory: mockSetMainWindowFactory,
  restoreOrCreateMainWindow: mockRestoreOrCreateMainWindow,
  resolveAppIconPath: mockResolveAppIconPath,
}));

vi.mock('../../src/main/ipc/handlers.js', () => ({
  setupIPC: mockSetupIPC,
}));

vi.mock('../../src/main/services/init.js', () => ({
  initializeApp: mockInitializeApp,
  shutdownAppResources: mockShutdownAppResources,
}));

vi.mock('../../src/main/services/config.js', () => ({
  getGalleryFolders: vi.fn(() => []),
  getDownloadsPath: vi.fn(() => 'M:/downloads'),
  getDataDir: vi.fn(() => 'M:/data'),
  getCachePath: vi.fn(() => 'M:/data/cache'),
  getThumbnailsPath: vi.fn(() => 'M:/data/thumbnails'),
}));

describe('main index tray wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    trayInstances.length = 0;
    trayConstructorArgs.length = 0;
    mockWhenReady.mockReset();
    mockOn.mockReset();
    mockQuit.mockReset();
    mockDisableHardwareAcceleration.mockReset();
    mockRequestSingleInstanceLock.mockReset();
    mockRequestSingleInstanceLock.mockReturnValue(true);
    mockSetApplicationMenu.mockReset();
    mockBuildFromTemplate.mockClear();
    mockRegisterSchemesAsPrivileged.mockReset();
    mockRegisterFileProtocol.mockReset();
    mockGetAllWindows.mockReset();
    mockGetAllWindows.mockReturnValue([]);
    mockCreateWindow.mockReset();
    mockCreateWindow.mockReturnValue({
      webContents: { on: vi.fn() },
      on: vi.fn(),
      once: vi.fn(),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      focus: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
    });
    mockSetupWindowIPC.mockReset();
    mockSetupIPC.mockReset();
    mockInitializeApp.mockReset();
    mockInitializeApp.mockResolvedValue({ success: true });
    mockShutdownAppResources.mockReset();
    mockShutdownAppResources.mockResolvedValue(undefined);
    mockExistsSync.mockReset();
    mockExistsSync.mockReturnValue(true);
    mockMarkAppQuitting.mockReset();
    mockSetCloseToTrayEnabled.mockReset();
    mockSetMainWindowFactory.mockReset();
    mockRestoreOrCreateMainWindow.mockReset();
    mockResolveAppIconPath.mockReset();
    mockResolveAppIconPath.mockReturnValue('M:/assets/icon.png');
    mockTrayShouldThrowRef.current = false;
    mockTrayContextMenuShouldThrowRef.current = false;

    mockWhenReady.mockImplementation(() => ({
      then: async (handler: () => Promise<void> | void) => {
        await handler();
        return Promise.resolve();
      },
    }));
  });

  it('应用就绪后应创建 tray，并提供恢复主窗口与显式退出入口', async () => {
    await import('../../src/main/index.js');

    expect(mockResolveAppIconPath).toHaveBeenCalledTimes(1);
    expect(trayConstructorArgs).toEqual(['M:/assets/icon.png']);
    expect(trayInstances).toHaveLength(1);
    expect(mockBuildFromTemplate).toHaveBeenCalledTimes(1);
    expect(mockBuildFromTemplate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ label: '显示主窗口' }),
        expect.objectContaining({ label: '退出应用' }),
      ])
    );
    expect(trayInstances[0].setContextMenu).toHaveBeenCalledTimes(1);
  });

  it('tray 点击恢复已隐藏主窗口时应走统一主窗口恢复入口', async () => {
    await import('../../src/main/index.js');
    mockRestoreOrCreateMainWindow.mockClear();
    mockCreateWindow.mockClear();

    const trayClick = trayInstances[0].on.mock.calls.find(([event]) => event === 'click')?.[1] as (() => void) | undefined;
    expect(trayClick).toBeTypeOf('function');

    trayClick?.();

    expect(mockRestoreOrCreateMainWindow).toHaveBeenCalledTimes(1);
    expect(mockCreateWindow).not.toHaveBeenCalled();
  });

  it('tray 显式退出入口应通过统一 quit 链路在清理完成后再进入退出态', async () => {
    let resolveShutdown: (() => void) | undefined;
    mockShutdownAppResources.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveShutdown = resolve;
    }));

    await import('../../src/main/index.js');

    const menuTemplate = mockBuildFromTemplate.mock.calls[0]?.[0] as Array<{ label: string; click?: () => void }>;
    const quitItem = menuTemplate.find((item) => item.label === '退出应用');
    const beforeQuitHandler = mockOn.mock.calls.find(([event]) => event === 'before-quit')?.[1];
    expect(quitItem?.click).toBeTypeOf('function');
    expect(beforeQuitHandler).toBeTypeOf('function');

    quitItem?.click?.();

    expect(mockMarkAppQuitting).not.toHaveBeenCalled();
    expect(mockQuit).toHaveBeenCalledTimes(1);

    const event = { preventDefault: vi.fn() };
    beforeQuitHandler?.(event);
    await Promise.resolve();

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mockShutdownAppResources).toHaveBeenCalledTimes(1);
    expect(mockMarkAppQuitting).not.toHaveBeenCalled();

    resolveShutdown?.();
    await Promise.resolve();
    await Promise.resolve();
    await vi.waitFor(() => {
      expect(mockMarkAppQuitting).toHaveBeenCalledTimes(1);
      expect(mockQuit).toHaveBeenCalledTimes(2);
    });
  });

  it('tray 初始化失败时应关闭 close-to-tray 兜底，避免窗口被隐藏后无法恢复', async () => {
    mockTrayShouldThrowRef.current = true;
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await import('../../src/main/index.js');

    expect(mockSetCloseToTrayEnabled).toHaveBeenCalledWith(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith('❌ Tray 初始化失败:', expect.any(Error));
    consoleErrorSpy.mockRestore();
  });

  it('tray 初始化失败后关闭所有窗口时应退出应用，避免留下无托盘后台实例', async () => {
    mockTrayShouldThrowRef.current = true;
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await import('../../src/main/index.js');

    const windowAllClosedHandler = mockOn.mock.calls.find(([event]) => event === 'window-all-closed')?.[1];
    expect(windowAllClosedHandler).toBeTypeOf('function');

    windowAllClosedHandler?.();

    expect(mockMarkAppQuitting).toHaveBeenCalledTimes(1);
    expect(mockQuit).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it('tray 部分初始化失败后关闭所有窗口时也应退出应用，避免残留失效 tray 引用', async () => {
    mockTrayContextMenuShouldThrowRef.current = true;
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await import('../../src/main/index.js');

    const windowAllClosedHandler = mockOn.mock.calls.find(([event]) => event === 'window-all-closed')?.[1];
    expect(windowAllClosedHandler).toBeTypeOf('function');

    mockMarkAppQuitting.mockClear();
    mockQuit.mockClear();
    windowAllClosedHandler?.();

    expect(mockSetCloseToTrayEnabled).toHaveBeenCalledWith(false);
    expect(mockMarkAppQuitting).toHaveBeenCalledTimes(1);
    expect(mockQuit).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });
});
