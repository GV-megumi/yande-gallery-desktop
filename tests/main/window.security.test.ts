import { beforeEach, describe, expect, it, vi } from 'vitest';

type WebContentsEventMap = Record<string, (...args: any[]) => void>;

type BrowserWindowMockInstance = {
  webContents: {
    handlers: WebContentsEventMap;
    windowOpenHandler: ((details: { url: string }) => { action: 'allow' | 'deny' }) | null;
    setWindowOpenHandler: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    openDevTools: ReturnType<typeof vi.fn>;
    executeJavaScript: ReturnType<typeof vi.fn>;
  };
  handlers: WebContentsEventMap;
  once: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  isMinimized: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
};

const browserWindowInstances: BrowserWindowMockInstance[] = [];
const mockGetPrimaryDisplay = vi.fn(() => ({ workAreaSize: { width: 1600, height: 900 } }));
const mockExistsSync = vi.fn(() => true);
const mockIpcHandle = vi.fn();

function createBrowserWindowMock(): BrowserWindowMockInstance {
  const webContentsHandlers: WebContentsEventMap = {};
  const handlers: WebContentsEventMap = {};
  const instance = {
    webContents: {
      handlers: webContentsHandlers,
      windowOpenHandler: null,
      setWindowOpenHandler: vi.fn((handler) => {
        instance.webContents.windowOpenHandler = handler;
      }),
      on: vi.fn((event, handler) => {
        webContentsHandlers[event] = handler;
      }),
      openDevTools: vi.fn(),
      executeJavaScript: vi.fn(async () => 'object'),
    },
    handlers,
    once: vi.fn(),
    on: vi.fn((event, handler) => {
      handlers[event] = handler;
    }),
    show: vi.fn(),
    hide: vi.fn(),
    focus: vi.fn(),
    restore: vi.fn(),
    isMinimized: vi.fn(() => false),
    close: vi.fn(),
    isDestroyed: vi.fn(() => false),
    loadURL: vi.fn(),
    loadFile: vi.fn(),
  } as BrowserWindowMockInstance;

  return instance;
}

vi.mock('electron', () => {
  class BrowserWindow {
    webContents: BrowserWindowMockInstance['webContents'];
    once: BrowserWindowMockInstance['once'];
    on: BrowserWindowMockInstance['on'];
    show: BrowserWindowMockInstance['show'];
    hide: BrowserWindowMockInstance['hide'];
    focus: BrowserWindowMockInstance['focus'];
    restore: BrowserWindowMockInstance['restore'];
    isMinimized: BrowserWindowMockInstance['isMinimized'];
    close: BrowserWindowMockInstance['close'];
    isDestroyed: BrowserWindowMockInstance['isDestroyed'];
    loadURL: BrowserWindowMockInstance['loadURL'];
    loadFile: BrowserWindowMockInstance['loadFile'];

    constructor() {
      const instance = createBrowserWindowMock();
      this.webContents = instance.webContents;
      this.once = instance.once;
      this.on = instance.on;
      this.show = instance.show;
      this.hide = instance.hide;
      this.focus = instance.focus;
      this.restore = instance.restore;
      this.isMinimized = instance.isMinimized;
      this.close = instance.close;
      this.isDestroyed = instance.isDestroyed;
      this.loadURL = instance.loadURL;
      this.loadFile = instance.loadFile;
      browserWindowInstances.push(instance);
    }

    static getAllWindows() {
      return browserWindowInstances as unknown as BrowserWindow[];
    }
  }

  return {
    BrowserWindow,
    screen: { getPrimaryDisplay: mockGetPrimaryDisplay },
    ipcMain: { handle: mockIpcHandle },
    app: { isPackaged: false },
  };
});

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
  },
  existsSync: mockExistsSync,
}));

describe('window.ts 安全边界行为', () => {
  beforeEach(() => {
    vi.resetModules();
    browserWindowInstances.length = 0;
    mockGetPrimaryDisplay.mockClear();
    mockExistsSync.mockClear();
    mockIpcHandle.mockClear();
    delete process.env.NODE_ENV;
  });

  async function createMainWindowAndGetSecurityHooks(options?: { closeToTrayEnabled?: boolean }) {
    const module = await import('../../src/main/window');
    if (options?.closeToTrayEnabled) {
      (module as any).setCloseToTrayEnabled(true);
    }
    module.createWindow();

    const instance = browserWindowInstances[0];
    expect(instance).toBeTruthy();
    expect(instance.webContents.setWindowOpenHandler).toHaveBeenCalledTimes(1);
    expect(instance.webContents.handlers['will-navigate']).toBeTypeOf('function');
    expect(instance.webContents.handlers['will-attach-webview']).toBeTypeOf('function');

    return {
      openHandler: instance.webContents.windowOpenHandler!,
      navigateHandler: instance.webContents.handlers['will-navigate'],
      attachWebviewHandler: instance.webContents.handlers['will-attach-webview'],
    };
  }

  it('允许受控开发 URL，但拒绝 localhost 用户名绕过', async () => {
    process.env.NODE_ENV = 'development';
    const { openHandler } = await createMainWindowAndGetSecurityHooks();

    expect(openHandler({ url: 'http://localhost:5173/#/page' })).toEqual({ action: 'allow' });
    expect(openHandler({ url: 'http://localhost:5173@evil.com/' })).toEqual({ action: 'deny' });
  });

  it('拒绝非受控 file 导航', async () => {
    const { navigateHandler } = await createMainWindowAndGetSecurityHooks();
    const preventDefault = vi.fn();

    navigateHandler({ preventDefault }, 'file:///tmp/evil.html');

    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('拒绝看似受信任但路径不匹配的 file URL', async () => {
    const { openHandler } = await createMainWindowAndGetSecurityHooks();

    expect(openHandler({ url: 'file:///C:/fake/build/renderer/index.html' })).toEqual({ action: 'deny' });
  });

  it('允许白名单 webview host 并强制安全 webPreferences', async () => {
    const { attachWebviewHandler } = await createMainWindowAndGetSecurityHooks();
    const preventDefault = vi.fn();
    const webPreferences: Record<string, unknown> = {
      preload: '/tmp/preload.js',
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
    };

    attachWebviewHandler({ preventDefault }, webPreferences, { src: 'https://photos.google.com/abc' });

    expect(preventDefault).not.toHaveBeenCalled();
    expect('preload' in webPreferences).toBe(false);
    expect(webPreferences.nodeIntegration).toBe(false);
    expect(webPreferences.contextIsolation).toBe(true);
    expect(webPreferences.webSecurity).toBe(true);
    expect(webPreferences.allowRunningInsecureContent).toBe(false);
    expect(webPreferences.sandbox).toBe(true);
  });

  it('拒绝非白名单 https webview host', async () => {
    const { attachWebviewHandler } = await createMainWindowAndGetSecurityHooks();
    const preventDefault = vi.fn();
    const webPreferences: Record<string, unknown> = {
      preload: '/tmp/preload.js',
    };

    attachWebviewHandler({ preventDefault }, webPreferences, { src: 'https://evil.example.com' });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(webPreferences.preload).toBe('/tmp/preload.js');
  });

  it('主窗口 close 事件在非显式退出时应转为隐藏窗口', async () => {
    await createMainWindowAndGetSecurityHooks({ closeToTrayEnabled: true });

    const instance = browserWindowInstances[0];
    const closeHandler = instance.handlers.close;
    expect(closeHandler).toBeTypeOf('function');

    const preventDefault = vi.fn();
    closeHandler({ preventDefault });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(instance.hide).toHaveBeenCalledTimes(1);
  });

  it('主窗口在显式退出阶段不应被 close-to-tray 拦截', async () => {
    const module = await import('../../src/main/window');
    (module as any).markAppQuitting();
    module.createWindow();

    const instance = browserWindowInstances[0];
    const closeHandler = instance.handlers.close;
    expect(closeHandler).toBeTypeOf('function');

    const preventDefault = vi.fn();
    closeHandler({ preventDefault });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(instance.hide).not.toHaveBeenCalled();
  });

  it('未启用托盘兜底时主窗口 close 不应被强制隐藏', async () => {
    const module = await import('../../src/main/window');
    module.createWindow();

    const instance = browserWindowInstances[0];
    const closeHandler = instance.handlers.close;
    expect(closeHandler).toBeTypeOf('function');

    const preventDefault = vi.fn();
    closeHandler({ preventDefault });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(instance.hide).not.toHaveBeenCalled();
  });

  it('通知恢复主窗口时没有现存窗口应创建新主窗口', async () => {
    const module = await import('../../src/main/window');

    const result = module.restoreOrCreateMainWindow();

    expect(browserWindowInstances).toHaveLength(1);
    expect(result).toBeTruthy();
  });

  it('通知恢复主窗口时已有隐藏窗口应 show 并 focus', async () => {
    const module = await import('../../src/main/window');
    module.createWindow();

    const instance = browserWindowInstances[0];
    instance.show.mockClear();
    instance.focus.mockClear();
    instance.restore.mockClear();
    instance.isMinimized.mockReturnValue(false);

    const result = module.restoreOrCreateMainWindow();

    expect(result).toBeTruthy();
    expect(instance.restore).not.toHaveBeenCalled();
    expect(instance.show).toHaveBeenCalledTimes(1);
    expect(instance.focus).toHaveBeenCalledTimes(1);
  });

  it('恢复主窗口时应优先使用主窗口工厂而不是误用现存子窗口', async () => {
    const module = await import('../../src/main/window');
    module.createSubWindow('artist?name=test');

    const childInstance = browserWindowInstances[0];
    childInstance.show.mockClear();
    childInstance.focus.mockClear();

    const result = module.restoreOrCreateMainWindow();

    expect(browserWindowInstances).toHaveLength(2);
    expect(result).not.toBe(childInstance as any);
    expect(childInstance.show).not.toHaveBeenCalled();
    expect(childInstance.focus).not.toHaveBeenCalled();
  });

  it('openSecondaryMenu extra 中的保留键 section/key/tab 应被屏蔽且告警', async () => {
    const module = await import('../../src/main/window');
    module.setupWindowIPC();

    // 从注册的 ipcMain.handle 调用中提取 secondary-menu handler
    const secondaryCall = mockIpcHandle.mock.calls.find(
      (args: any[]) => args[0] === 'window:open-secondary-menu',
    );
    expect(secondaryCall).toBeTruthy();
    const handler = secondaryCall![1] as (
      _event: unknown,
      section: string,
      key: string,
      tab?: string,
      extra?: Record<string, string | number>,
    ) => Promise<{ success: boolean }>;

    // 注意：vi.spyOn(console, 'warn').mockImplementation(...) 在当前 vitest 版本下
    // 会导致 warn 调用记录不到 spy.mock.calls，这里只做 spy，不替换实现。
    const warnSpy = vi.spyOn(console, 'warn');

    await handler({}, 'gallery', 'list', undefined, {
      section: 'other',
      key: 'evil',
      tab: 'hijack',
      galleryId: 5,
    });

    // 子窗口被创建，hash 应保留原始 section=gallery / key=list，不被 extra 覆盖
    const subInstance = browserWindowInstances[browserWindowInstances.length - 1];
    expect(subInstance).toBeTruthy();
    const loadCall = subInstance.loadURL.mock.calls[0] ?? subInstance.loadFile.mock.calls[0];
    expect(loadCall).toBeTruthy();
    const hashArg = typeof loadCall[0] === 'string' && loadCall[0].includes('#')
      ? loadCall[0].split('#')[1]
      : (loadCall[1] as { hash: string }).hash;
    const query = hashArg.split('?')[1] ?? '';
    const parsed = new URLSearchParams(query);

    expect(parsed.get('section')).toBe('gallery');
    expect(parsed.get('key')).toBe('list');
    expect(parsed.get('tab')).toBeNull();
    expect(parsed.get('galleryId')).toBe('5');

    // 每个被屏蔽的保留键都应记一条 warn
    const warnMessages = warnSpy.mock.calls.map((args) => args.map(String).join(' '));
    expect(warnMessages.some((m) => m.includes('"section"'))).toBe(true);
    expect(warnMessages.some((m) => m.includes('"key"'))).toBe(true);
    expect(warnMessages.some((m) => m.includes('"tab"'))).toBe(true);

    warnSpy.mockRestore();
  });
});
