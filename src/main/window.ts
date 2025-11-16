import { BrowserWindow, screen } from 'electron';
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
      preload: absolutePreloadPath
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