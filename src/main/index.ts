import { app, BrowserWindow, protocol, Menu, Tray } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWindow, markAppQuitting, resolveAppIconPath, restoreOrCreateMainWindow, setCloseToTrayEnabled, setMainWindowFactory, setupWindowIPC } from './window.js';
import { setupIPC } from './ipc/handlers.js';
import { initializeApp, shutdownAppResources } from './services/init.js';
import {
  getCachePath,
  getDataDir,
  getDesktopConfig,
  getDownloadsPath,
  getGalleryFolders,
  getThumbnailsPath,
} from './services/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 注册自定义协议用于加载本地文件
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

let isQuitCleanupInProgress = false;
let hasQuitCleanupCompleted = false;
let allowQuitAfterCleanup = false;
let appTray: Tray | null = null;

function logLifecycleEvent(eventName: string, payload?: unknown): void {
  if (payload === undefined) {
    console.error(`[lifecycle] 捕获到 ${eventName}`);
    return;
  }

  console.error(`[lifecycle] 捕获到 ${eventName}:`, payload);
}

function normalizeControlledRoot(rootPath: string): string | null {
  if (!rootPath) {
    return null;
  }

  const normalized = path.resolve(rootPath);
  return process.platform === 'win32'
    ? normalized.toLowerCase()
    : normalized;
}

function normalizeCanonicalPath(targetPath: string): string | null {
  if (!targetPath) {
    return null;
  }

  try {
    const canonicalPath = fs.realpathSync(targetPath);
    return normalizeControlledRoot(canonicalPath);
  } catch {
    return null;
  }
}

function isPathWithinRoot(targetPath: string, rootPath: string): boolean {
  const canonicalTarget = normalizeCanonicalPath(targetPath);
  const canonicalRoot = normalizeCanonicalPath(rootPath);

  if (!canonicalTarget || !canonicalRoot) {
    return false;
  }

  if (canonicalTarget === canonicalRoot) {
    return true;
  }

  const relative = path.relative(canonicalRoot, canonicalTarget);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function getControlledAppProtocolRoots(): string[] {
  const roots = [
    ...getGalleryFolders().map(folder => folder.path),
    getDownloadsPath(),
    getDataDir(),
    getCachePath(),
    getThumbnailsPath(),
  ];

  return Array.from(
    new Set(
      roots
        .map(root => normalizeControlledRoot(root))
        .filter((root): root is string => Boolean(root))
    )
  );
}

function resolveAppProtocolFilePath(requestUrl: string): string | null {
  const url = new URL(requestUrl);

  let absolutePath: string;
  if (process.platform === 'win32') {
    const driveLetter = url.hostname || 'c';
    const decodedPath = decodeURIComponent(url.pathname);
    absolutePath = path.win32.resolve(`${driveLetter.toUpperCase()}:\\`, `.${decodedPath.replace(/\//g, '\\')}`);
  } else {
    absolutePath = path.posix.resolve('/', `.${decodeURIComponent(url.pathname)}`);
  }

  return getControlledAppProtocolRoots().some(root => isPathWithinRoot(absolutePath, root))
    ? absolutePath
    : null;
}

async function runQuitCleanup(): Promise<void> {
  if (hasQuitCleanupCompleted || isQuitCleanupInProgress) {
    return;
  }

  isQuitCleanupInProgress = true;

  try {
    await shutdownAppResources();
    hasQuitCleanupCompleted = true;
  } catch (error) {
    console.error('❌ 应用退出清理失败:', error);
  } finally {
    isQuitCleanupInProgress = false;
  }
}

async function handleLifecycleFailure(eventName: string, payload?: unknown): Promise<void> {
  logLifecycleEvent(eventName, payload);
  await runQuitCleanup();
}

function attachProcessGoneHandler(window: BrowserWindow | null | undefined): void {
  if (!window?.webContents?.on) {
    return;
  }

  window.webContents.on('render-process-gone', (_event, details) => {
    void handleLifecycleFailure('render-process-gone', details);
  });
}

function createAndTrackMainWindow(): BrowserWindow {
  const mainWindow = createWindow();
  attachProcessGoneHandler(mainWindow);
  return mainWindow;
}

setMainWindowFactory(() => createAndTrackMainWindow());

function createTray(): Tray | null {
  if (appTray) {
    setCloseToTrayEnabled(true);
    return appTray;
  }

  try {
    const iconPath = resolveAppIconPath();
    if (!iconPath) {
      throw new Error('tray icon not found');
    }

    const tray = new Tray(iconPath);
    tray.setToolTip('Yande Gallery Desktop');
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => {
          restoreOrCreateMainWindow();
        },
      },
      {
        label: '退出应用',
        click: () => {
          app.quit();
        },
      },
    ]));
    tray.on('click', () => {
      restoreOrCreateMainWindow();
    });
    appTray = tray;
    setCloseToTrayEnabled(true);
    return appTray;
  } catch (error) {
    appTray = null;
    setCloseToTrayEnabled(false);
    console.error('❌ Tray 初始化失败:', error);
    return null;
  }
}

function registerLifecycleGuards(): void {
  process.on('uncaughtException', (error) => {
    void handleLifecycleFailure('uncaughtException', error);
  });

  process.on('unhandledRejection', (reason) => {
    void handleLifecycleFailure('unhandledRejection', reason);
  });
}

registerLifecycleGuards();

// 初始化应用（加载配置、初始化数据库、初始化图库）
app.whenReady().then(async () => {
  try {
    // 去掉 Electron 默认菜单栏（File / Edit / View / Window / Help）
    // 应用自身有侧边栏导航，无需系统菜单；同时也移除 Alt 呼出
    Menu.setApplicationMenu(null);

    // 注册文件协议处理器，将 app://... 安全映射到受控本地目录
    protocol.registerFileProtocol('app', (request, callback) => {
      try {
        const filePath = resolveAppProtocolFilePath(request.url);
        callback({ path: filePath || '' });
      } catch (e) {
        console.error('Failed to resolve app:// path', request.url, e);
        callback({ path: '' });
      }
    });
    console.log('✅ 自定义协议 app:// 注册成功');

    // 1. 先创建主窗口和 IPC，避免非关键初始化阻塞首屏
    createAndTrackMainWindow();
    createTray();
    setupIPC();
    setupWindowIPC();

    // 2. 再执行应用初始化（配置 + 数据库 + 图库）
    console.log('🚀 正在启动应用...');
    const initResult = await initializeApp();

    if (!initResult.success) {
      console.error('❌ 应用初始化失败:', initResult.error);
      // 继续启动应用，让用户看到错误信息
    } else {
      console.log('✅ 应用初始化成功');
    }

    // bug9：把 desktop.autoLaunch / startMinimized 应用到系统登录项。
    // 必须在 initializeApp 之后（此时 config 已加载），且只调用系统 API——
    // Linux 没 setLoginItemSettings 的 openAsHidden 字段但不会抛错。
    try {
      const desktop = getDesktopConfig();
      app.setLoginItemSettings({
        openAtLogin: desktop.autoLaunch,
        openAsHidden: desktop.startMinimized,
      });
      console.log('[App] setLoginItemSettings:', {
        openAtLogin: desktop.autoLaunch,
        openAsHidden: desktop.startMinimized,
      });
    } catch (err) {
      console.warn('[App] setLoginItemSettings 失败（可能该平台不支持）:', err);
    }

    console.log('🎉 应用启动完成');
  } catch (error) {
    console.error('❌ 应用启动失败:', error);
  }
});

// 禁用硬件加速（可选，解决某些渲染问题）
app.disableHardwareAcceleration();

// 单实例应用
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    restoreOrCreateMainWindow();
  });
}

function handleAppQuitLifecycleEvent(event?: { preventDefault?: () => void }): void {
  if (allowQuitAfterCleanup || hasQuitCleanupCompleted) {
    return;
  }

  event?.preventDefault?.();

  if (isQuitCleanupInProgress) {
    return;
  }

  void runQuitCleanup().then(() => {
    if (!hasQuitCleanupCompleted) {
      return;
    }

    markAppQuitting();
    allowQuitAfterCleanup = true;
    app.quit();
  });
}

app.on('before-quit', handleAppQuitLifecycleEvent);
app.on('will-quit', handleAppQuitLifecycleEvent);

// 桌面常驻模型下，存在 tray 时关闭所有窗口不默认退出应用；
// 若 tray 初始化失败，则最后一个窗口关闭后应直接走退出链路，避免留下无入口后台实例。
app.on('window-all-closed', () => {
  if (appTray) {
    return;
  }

  markAppQuitting();
  app.quit();
});

// 开发工具
if (process.env.NODE_ENV === 'development') {
  app.whenReady().then(async () => {
    try {
      const { default: installExtension, REACT_DEVELOPER_TOOLS } = await import('electron-devtools-installer');
      if (installExtension && typeof installExtension === 'function') {
        await installExtension(REACT_DEVELOPER_TOOLS)
          .then((ext) => console.log(`Added Extension: ${ext.name}`))
          .catch((err: Error) => console.log('An error occurred: ', err));
      }
    } catch (err) {
      console.log('Failed to load devtools installer:', err);
    }
  });
}