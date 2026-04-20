import { BrowserWindow, screen, ipcMain, app, dialog } from 'electron';
import { IPC_CHANNELS } from './ipc/channels.js';
import { getDesktopConfig } from './services/config.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 轻量子窗口 hash 前缀白名单。
 * 这些类型的子窗口使用精简 preload（build/preload/subwindow.js），
 * 仅暴露 window/booru/booruPreferences/system 四个域。
 * 其他类型（如 secondary-menu）使用主 preload（build/preload/index.js）。
 * 新增轻量子窗口类型时需同步更新此处。
 *
 * 暂不导出给 renderer / subwindow-index 共享，避免 renderer 引 main 代码破坏边界。
 */
export const LIGHTWEIGHT_SUBWINDOW_PREFIXES = ['tag-search', 'artist', 'character'] as const;

/**
 * 判断给定 hash（不含前导 '#'）是否属于轻量子窗口路由。
 * 归一化为小写以防御未来调用方的大小写漂移。
 * 严格匹配前缀边界（=、?、&、#、/），避免类似 'artist-foo' 这种串误命中。
 */
function isLightweightSubwindowHash(hash: string): boolean {
  const normalized = hash.toLowerCase();
  return LIGHTWEIGHT_SUBWINDOW_PREFIXES.some((prefix) =>
    normalized === prefix
      || normalized.startsWith(`${prefix}?`)
      || normalized.startsWith(`${prefix}&`)
      || normalized.startsWith(`${prefix}#`)
      || normalized.startsWith(`${prefix}/`)
  );
}

/**
 * 解析运行时图标路径：
 * - 开发模式：从编译后的 build/main 回到仓库根，取 assets/icon.png
 * - 生产模式：extraResources 把 assets 拷到 process.resourcesPath 下
 */
export function resolveAppIconPath(): string | undefined {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'assets', 'icon.png')]
    : [
        path.join(__dirname, '../../assets/icon.png'),
        path.join(process.cwd(), 'assets/icon.png'),
      ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

const ALLOWED_DEV_ORIGIN = {
  protocol: 'http:',
  hostname: 'localhost',
  port: '5173',
} as const;

const ALLOWED_WEBVIEW_HOSTS = new Set([
  'drive.google.com',
  'photos.google.com',
  'gemini.google.com',
]);

let isAppQuitting = false;
let isCloseToTrayEnabled = false;
let mainWindowFactory: (() => BrowserWindow) | null = null;
let mainWindowRef: BrowserWindow | null = null;

export function markAppQuitting(): void {
  isAppQuitting = true;
}

export function setCloseToTrayEnabled(enabled: boolean): void {
  isCloseToTrayEnabled = enabled;
}

export function setMainWindowFactory(factory: (() => BrowserWindow) | null): void {
  mainWindowFactory = factory;
}

/**
 * 取当前存活的主窗口引用。
 * 用于需要**精确定位主窗口**的场景（例如把 system:navigate 事件发到主窗口而非子窗口）。
 * 与 restoreOrCreateMainWindow 的差异：本函数**不会**创建新窗口、也不会 restore/focus，
 * 单纯返回内部持有的 mainWindowRef；不存活或未创建时返回 null。
 *
 * 典型用法：notificationService 里发 SYSTEM_NAVIGATE 时优先用 getMainWindow()?.webContents，
 * 避免落到 BrowserWindow.getAllWindows()[0] 误把事件发给子窗口（子窗口共享主 preload 会订阅
 * 同名事件，但没有 section/subKey 切换逻辑，会静默丢弃）。
 */
export function getMainWindow(): BrowserWindow | null {
  if (!mainWindowRef) return null;
  if (typeof mainWindowRef.isDestroyed === 'function' && mainWindowRef.isDestroyed()) return null;
  return mainWindowRef;
}

export function restoreOrCreateMainWindow(): BrowserWindow {
  const mainWindow = mainWindowRef && typeof mainWindowRef.isDestroyed === 'function' && !mainWindowRef.isDestroyed()
    ? mainWindowRef
    : null;

  if (mainWindow) {
    if (typeof mainWindow.isMinimized === 'function' && mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    if (typeof mainWindow.show === 'function') {
      mainWindow.show();
    }
    if (typeof mainWindow.focus === 'function') {
      mainWindow.focus();
    }
    return mainWindow;
  }

  const nextMainWindow = mainWindowFactory ? mainWindowFactory() : createWindow();
  mainWindowRef = nextMainWindow;
  return nextMainWindow;
}

function isTrustedAppUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (
    parsed.protocol === ALLOWED_DEV_ORIGIN.protocol
    && parsed.hostname === ALLOWED_DEV_ORIGIN.hostname
    && parsed.port === ALLOWED_DEV_ORIGIN.port
  ) {
    return true;
  }

  if (parsed.protocol !== 'file:') {
    return false;
  }

  const trustedRendererEntry = path.resolve(__dirname, '../renderer/index.html');

  try {
    return path.resolve(fileURLToPath(parsed)) === trustedRendererEntry;
  } catch {
    return false;
  }
}

function isAllowedWebviewUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  return parsed.protocol === 'https:' && ALLOWED_WEBVIEW_HOSTS.has(parsed.hostname);
}

function attachSecurityGuards(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedAppUrl(url)) {
      return { action: 'allow' };
    }
    console.warn('[Window] 阻止新窗口打开:', url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (isTrustedAppUrl(url)) return;
    console.warn('[Window] 阻止页面导航:', url);
    event.preventDefault();
  });

  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const src = params.src ?? '';
    if (!isAllowedWebviewUrl(src)) {
      console.warn('[Window] 阻止附加非白名单 webview:', src);
      event.preventDefault();
      return;
    }

    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    webPreferences.sandbox = true;
  });
}

export function createWindow(): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  // 使用绝对路径，确保在开发和生产模式下都能正确加载
  // __dirname 在编译后是 build/main，所以 preload 在 build/preload
  const preloadPath = path.join(__dirname, '../preload/index.js');
  const absolutePreloadPath = path.resolve(preloadPath);
  console.log('[Window] __dirname:', __dirname);
  console.log('[Window] Preload script path (relative):', preloadPath);
  console.log('[Window] Preload script path (absolute):', absolutePreloadPath);
  console.log('[Window] Preload script exists:', fs.existsSync(absolutePreloadPath));
  
  if (!fs.existsSync(absolutePreloadPath)) {
    console.error('[Window] ❌ Preload script not found at:', absolutePreloadPath);
    // 尝试其他可能的路径
    const altPath1 = path.join(process.cwd(), 'build/preload/index.js');
    const altPath2 = path.join(__dirname, '../../build/preload/index.js');
    console.log('[Window] Trying alternative path 1:', altPath1, 'exists:', fs.existsSync(altPath1));
    console.log('[Window] Trying alternative path 2:', altPath2, 'exists:', fs.existsSync(altPath2));
  }
  
  const iconPath = resolveAppIconPath();
  if (iconPath) {
    console.log('[Window] App icon path:', iconPath);
  } else {
    console.warn('[Window] App icon not found, falling back to default');
  }

  const mainWindow = new BrowserWindow({
    width: Math.min(1400, width * 0.8),
    height: Math.min(900, height * 0.8),
    minWidth: 1200,
    minHeight: 700,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: absolutePreloadPath,
      webSecurity: true,
      webviewTag: true,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false // 先不显示，等加载完成后再显示
  });

  mainWindowRef = mainWindow;
  attachSecurityGuards(mainWindow);

  // 监听 preload 错误
  mainWindow.webContents.on('preload-error', (event, preloadPath, error) => {
    console.error('[Window] Preload script error:', preloadPath, error);
  });

  // 监听 DOM 就绪
  mainWindow.webContents.on('dom-ready', () => {
    console.log('[Window] DOM ready, checking electronAPI...');
    mainWindow.webContents.executeJavaScript('typeof window.electronAPI').then((result) => {
      console.log('[Window] window.electronAPI type:', result);
    }).catch((err) => {
      console.error('[Window] Failed to check electronAPI:', err);
    });
  });

  // 加载应用
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // 窗口事件
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    // 恢复上次的位置和大小
    // const windowState = getWindowState()
    // if (windowState) {
    //   mainWindow.setBounds(windowState)
    // }
  });

  mainWindow.on('close', (event) => {
    if (isAppQuitting || !isCloseToTrayEnabled) {
      // 已在退出流程 或 tray 不可用时，不拦截 close，走系统默认行为
      return;
    }

    // bug9：尊重 config.desktop.closeAction
    //   - 'quit'          ：不 preventDefault，正常走 before-quit / will-quit 清理链
    //   - 'hide-to-tray'  ：preventDefault + hide（原行为）
    //   - 'ask'           ：弹模态 dialog，由用户选择
    //
    // 读取失败（config 未加载等）时退化为 'hide-to-tray'，保持兼容。
    let action: 'quit' | 'hide-to-tray' | 'ask' = 'hide-to-tray';
    try {
      action = getDesktopConfig().closeAction;
    } catch (err) {
      console.warn('[Window] 读取 desktop.closeAction 失败，回退 hide-to-tray:', err);
    }

    if (action === 'quit') {
      return;
    }

    if (action === 'ask') {
      // preventDefault 必须同步调用，否则 Electron 不会拦截 close；
      // 随后 showMessageBox 异步弹窗，避免 showMessageBoxSync 阻塞事件循环。
      event.preventDefault();
      dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['最小化到托盘', '退出应用', '取消'],
        defaultId: 0,
        cancelId: 2,
        title: '关闭选项',
        message: '是否退出应用？',
      }).then(({ response }) => {
        if (response === 0) {
          mainWindow.hide();
        } else if (response === 1) {
          // 触发真实退出流程：由 index.ts 的 before-quit 处理器清理资源
          app.quit();
        }
        // response 2 / cancel：什么都不做
      }).catch((err) => {
        console.warn('[Window] close ask dialog 异常:', err);
      });
      return;
    }

    // action === 'hide-to-tray'（默认）
    event.preventDefault();
    mainWindow.hide();
    // 保存窗口状态
    // saveWindowState(mainWindow.getBounds())
  });

  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null;
    }
  });

  return mainWindow;
}

// 子窗口管理：追踪所有打开的子窗口，限制最大数量防止资源泄漏
const MAX_SUB_WINDOWS = 10;
const subWindows = new Set<BrowserWindow>();

/**
 * 创建子窗口（标签搜索、艺术家、角色等独立页面）
 * 通过 URL hash 传递页面类型和参数，子窗口渲染精简布局（无侧边栏）
 * @param hash URL hash 参数，如 "tag-search?tag=blue_eyes&siteId=1"
 */
export function createSubWindow(hash: string): BrowserWindow {
  // 清理已关闭的窗口引用
  for (const win of subWindows) {
    if (win.isDestroyed()) subWindows.delete(win);
  }

  // 达到上限时关闭最早打开的子窗口
  if (subWindows.size >= MAX_SUB_WINDOWS) {
    const oldest = subWindows.values().next().value;
    if (oldest) {
      if (!oldest.isDestroyed()) {
        console.log('[Window] 子窗口数量达到上限，关闭最早的子窗口');
        oldest.close();
      }
      subWindows.delete(oldest);
    }
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  // 按 hash 前缀分流 preload：
  //   - tag-search / artist / character 子窗口只渲染对应的 3 个 Booru 页面，
  //     使用精简 preload（src/preload/subwindow-index.ts → build/preload/subwindow.js），
  //     只暴露 window / booru / booruPreferences / system 四个域。
  //   - secondary-menu 子窗口会 lazy 加载 Gallery / BooruPage / Settings 等重型页面，
  //     仍使用主 preload（build/preload/index.js），维持完整 API 暴露。
  // 实现 TP-06 子窗口暴露面最小化原则，不影响其他 webPreferences（contextIsolation 等）。
  // 前缀白名单与判断逻辑抽到模块顶部 LIGHTWEIGHT_SUBWINDOW_PREFIXES / isLightweightSubwindowHash。
  const isLightweightSubwindow = isLightweightSubwindowHash(hash);
  const preloadPath = path.join(
    __dirname,
    isLightweightSubwindow ? '../preload/subwindow.js' : '../preload/index.js'
  );
  const absolutePreloadPath = path.resolve(preloadPath);

  const iconPath = resolveAppIconPath();

  const subWindow = new BrowserWindow({
    width: Math.min(1200, Math.round(width * 0.7)),
    height: Math.min(800, Math.round(height * 0.75)),
    minWidth: 800,
    minHeight: 600,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: absolutePreloadPath,
      webSecurity: true
    },
    show: false
  });

  attachSecurityGuards(subWindow);

  subWindows.add(subWindow);
  console.log('[Window] 创建子窗口, hash:', hash, '当前子窗口数:', subWindows.size);

  // 窗口关闭时自动清理引用
  subWindow.on('closed', () => {
    subWindows.delete(subWindow);
    console.log('[Window] 子窗口已关闭, 剩余子窗口数:', subWindows.size);
  });

  if (process.env.NODE_ENV === 'development') {
    subWindow.loadURL(`http://localhost:5173#${hash}`);
  } else {
    subWindow.loadFile(path.join(__dirname, '../renderer/index.html'), { hash });
  }

  subWindow.once('ready-to-show', () => {
    subWindow.show();
  });

  return subWindow;
}

/**
 * 注册子窗口相关的 IPC 处理器
 */
export function setupWindowIPC(): void {
  // 打开标签搜索子窗口
  ipcMain.handle(IPC_CHANNELS.WINDOW_OPEN_TAG_SEARCH, async (_event, tag: string, siteId?: number | null) => {
    const params = new URLSearchParams();
    params.set('tag', tag);
    if (siteId != null) params.set('siteId', String(siteId));
    createSubWindow(`tag-search?${params.toString()}`);
    return { success: true };
  });

  // 打开艺术家子窗口
  ipcMain.handle(IPC_CHANNELS.WINDOW_OPEN_ARTIST, async (_event, name: string, siteId?: number | null) => {
    const params = new URLSearchParams();
    params.set('name', name);
    if (siteId != null) params.set('siteId', String(siteId));
    createSubWindow(`artist?${params.toString()}`);
    return { success: true };
  });

  // 打开角色子窗口
  ipcMain.handle(IPC_CHANNELS.WINDOW_OPEN_CHARACTER, async (_event, name: string, siteId?: number | null) => {
    const params = new URLSearchParams();
    params.set('name', name);
    if (siteId != null) params.set('siteId', String(siteId));
    createSubWindow(`character?${params.toString()}`);
    return { success: true };
  });

  // 打开二级菜单页面子窗口
  // extra：额外 query 串（例如 { galleryId: 5 } 用于 Bug11 子窗口直接进入图集详情）
  ipcMain.handle(IPC_CHANNELS.WINDOW_OPEN_SECONDARY_MENU, async (
    _event,
    section: string,
    key: string,
    tab?: string,
    extra?: Record<string, string | number>,
  ) => {
    const params = new URLSearchParams({ section, key });
    if (tab) params.set('tab', tab);
    if (extra) {
      // 防御：extra 是 preload 暴露的公共 API，调用方若传 section/key/tab
      // 会静默覆盖前面的定位参数，这里显式屏蔽保留键并告警，避免意外错位。
      const RESERVED = new Set(['section', 'key', 'tab']);
      for (const [k, v] of Object.entries(extra)) {
        if (RESERVED.has(k)) {
          console.warn(`[Window] openSecondaryMenu extra 尝试覆盖保留键 "${k}"，已忽略`);
          continue;
        }
        if (v != null) params.set(k, String(v));
      }
    }
    createSubWindow(`secondary-menu?${params.toString()}`);
    return { success: true };
  });

  console.log('[Window] 子窗口 IPC 处理器注册完成');
}