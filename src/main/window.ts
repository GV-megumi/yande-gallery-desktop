import { BrowserWindow, screen, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  
  const mainWindow = new BrowserWindow({
    width: Math.min(1400, width * 0.8),
    height: Math.min(900, height * 0.8),
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: absolutePreloadPath,
      webSecurity: false // 禁用 webSecurity 以允许加载外部图片
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false // 先不显示，等加载完成后再显示
  });

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

  mainWindow.on('close', () => {
    // 保存窗口状态
    // saveWindowState(mainWindow.getBounds())
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

  const preloadPath = path.join(__dirname, '../preload/index.js');
  const absolutePreloadPath = path.resolve(preloadPath);

  const subWindow = new BrowserWindow({
    width: Math.min(1200, Math.round(width * 0.7)),
    height: Math.min(800, Math.round(height * 0.75)),
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: absolutePreloadPath,
      webSecurity: false
    },
    show: false
  });

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
  ipcMain.handle('window:open-tag-search', async (_event, tag: string, siteId?: number | null) => {
    const params = new URLSearchParams();
    params.set('tag', tag);
    if (siteId != null) params.set('siteId', String(siteId));
    createSubWindow(`tag-search?${params.toString()}`);
    return { success: true };
  });

  // 打开艺术家子窗口
  ipcMain.handle('window:open-artist', async (_event, name: string, siteId?: number | null) => {
    const params = new URLSearchParams();
    params.set('name', name);
    if (siteId != null) params.set('siteId', String(siteId));
    createSubWindow(`artist?${params.toString()}`);
    return { success: true };
  });

  // 打开角色子窗口
  ipcMain.handle('window:open-character', async (_event, name: string, siteId?: number | null) => {
    const params = new URLSearchParams();
    params.set('name', name);
    if (siteId != null) params.set('siteId', String(siteId));
    createSubWindow(`character?${params.toString()}`);
    return { success: true };
  });

  console.log('[Window] 子窗口 IPC 处理器注册完成');
}