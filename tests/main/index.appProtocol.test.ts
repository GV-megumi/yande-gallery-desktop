import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

const mockRealpathSync = vi.fn((input: string) => input);

vi.mock('fs', () => ({
  default: {
    realpathSync: mockRealpathSync,
  },
  realpathSync: mockRealpathSync,
}));

type FileProtocolHandler = (request: { url: string }, callback: (result: { path: string }) => void) => void;

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
const mockInitializeApp = vi.fn(() => new Promise<{ success: boolean }>(() => {}));
const mockShutdownAppResources = vi.fn().mockResolvedValue(undefined);
const mockGetGalleryFolders = vi.fn();
const mockGetDownloadsPath = vi.fn();
const mockGetDataDir = vi.fn();
const mockGetCachePath = vi.fn();
const mockGetThumbnailsPath = vi.fn();
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

vi.mock('../../src/main/services/config.js', () => ({
  getGalleryFolders: mockGetGalleryFolders,
  getDownloadsPath: mockGetDownloadsPath,
  getDataDir: mockGetDataDir,
  getCachePath: mockGetCachePath,
  getThumbnailsPath: mockGetThumbnailsPath,
}));

describe('main index app protocol containment', () => {
  const originalPlatform = process.platform;

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
    mockGetGalleryFolders.mockReset();
    mockGetDownloadsPath.mockReset();
    mockGetDataDir.mockReset();
    mockGetCachePath.mockReset();
    mockGetThumbnailsPath.mockReset();
    mockSetCloseToTrayEnabled.mockReset();
    mockRestoreOrCreateMainWindow.mockReset();
    mockSetMainWindowFactory.mockReset();
    mockRealpathSync.mockReset();
    mockRealpathSync.mockImplementation((input: string) => input);

    mockWhenReady.mockImplementation(() => ({
      then: (handler: () => Promise<void> | void) => {
        handler();
        return Promise.resolve();
      },
    }));

    mockGetGalleryFolders.mockReturnValue([
      { path: 'M:\\gallery', name: '图库', autoScan: true, recursive: true, extensions: ['.jpg'] },
    ]);
    mockGetDownloadsPath.mockReturnValue('M:\\downloads');
    mockGetDataDir.mockReturnValue('M:\\appdata');
    mockGetCachePath.mockReturnValue('M:\\appdata\\cache');
    mockGetThumbnailsPath.mockReturnValue('M:\\appdata\\thumbnails');

    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  });

  async function loadProtocolHandler(): Promise<FileProtocolHandler> {
    await import('../../src/main/index.js');
    const handler = mockRegisterFileProtocol.mock.calls.find(([scheme]) => scheme === 'app')?.[1];
    expect(handler).toBeTypeOf('function');
    return handler as FileProtocolHandler;
  }

  function resolvePath(handler: FileProtocolHandler, url: string): string {
    let resolved = '__unset__';
    handler({ url }, ({ path }) => {
      resolved = path;
    });
    return resolved;
  }

  it('允许图库根目录中的文件', async () => {
    const handler = await loadProtocolHandler();

    const resolved = resolvePath(handler, 'app://m/gallery/album/image%201.jpg');

    expect(resolved).toBe('M:\\gallery\\album\\image 1.jpg');
  });

  it('允许下载目录和应用数据目录中的文件', async () => {
    const handler = await loadProtocolHandler();

    expect(resolvePath(handler, 'app://m/downloads/task/out.png')).toBe('M:\\downloads\\task\\out.png');
    expect(resolvePath(handler, 'app://m/appdata/cache/thumb.webp')).toBe('M:\\appdata\\cache\\thumb.webp');
    expect(resolvePath(handler, 'app://m/appdata/thumbnails/grid/a.webp')).toBe('M:\\appdata\\thumbnails\\grid\\a.webp');
  });

  it('拒绝路径穿越逃逸', async () => {
    const handler = await loadProtocolHandler();

    const resolved = resolvePath(handler, 'app://m/gallery/../../Windows/System32/calc.exe');

    expect(resolved).toBe('');
  });

  it('拒绝允许根目录之外的绝对路径', async () => {
    const handler = await loadProtocolHandler();

    const resolved = resolvePath(handler, 'app://m/Users/Public/outside.txt');

    expect(resolved).toBe('');
  });

  it('一致处理 Windows 盘符形式并拒绝切换到其他盘符', async () => {
    const handler = await loadProtocolHandler();

    expect(resolvePath(handler, 'app://m/gallery/nested/file.jpg')).toBe('M:\\gallery\\nested\\file.jpg');
    expect(resolvePath(handler, 'app://c/Windows/explorer.exe')).toBe('');
  });

  it('拒绝通过符号链接跳出允许根目录', async () => {
    mockRealpathSync.mockImplementation((input: string) => {
      if (input === 'M:\\gallery') {
        return input;
      }

      if (input === 'M:\\gallery\\linked\\outside.txt') {
        return 'C:\\secret\\outside.txt';
      }

      return input;
    });

    const handler = await loadProtocolHandler();

    const resolved = resolvePath(handler, 'app://m/gallery/linked/outside.txt');

    expect(resolved).toBe('');
  });
});
