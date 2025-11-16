import { app, BrowserWindow, ipcMain, protocol } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWindow } from './window.js';
import { setupIPC } from './ipc/handlers.js';
import { initializeApp } from './services/init.js';

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

// 初始化应用（加载配置、初始化数据库、初始化图库）
app.whenReady().then(async () => {
  try {
    // 注册文件协议处理器，将 app://... 映射到本地文件系统路径
    protocol.registerFileProtocol('app', (request, callback) => {
      try {
        const url = new URL(request.url);
        let filePath: string;

        if (process.platform === 'win32') {
          // 例如 app://m/booru/yuzuna%20hiyo/548758.png
          const driveLetter = url.hostname || 'c';
          const decodedPath = decodeURIComponent(url.pathname); // /booru/...
          filePath = `${driveLetter.toUpperCase()}:${decodedPath.replace(/\//g, '\\')}`;
        } else {
          filePath = decodeURIComponent(url.pathname);
        }

        callback({ path: filePath });
      } catch (e) {
        console.error('Failed to resolve app:// path', request.url, e);
        callback({ path: '' });
      }
    });
    console.log('✅ 自定义协议 app:// 注册成功');

    // 1. 初始化应用（配置 + 数据库 + 图库）
    console.log('🚀 正在启动应用...');
    const initResult = await initializeApp();

    if (!initResult.success) {
      console.error('❌ 应用初始化失败:', initResult.error);
      // 继续启动应用，让用户看到错误信息
    } else {
      console.log('✅ 应用初始化成功');
    }

    // 2. 创建窗口
    createWindow();

    // 3. 设置IPC
    setupIPC();

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
    // 当尝试启动第二个实例时，聚焦到已有窗口
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      const window = windows[0];
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
}

// 所有窗口关闭时退出应用
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 开发工具
if (process.env.NODE_ENV === 'development') {
  app.whenReady().then(async () => {
    try {
      const { default: installExtension, REACT_DEVELOPER_TOOLS } = await import('electron-devtools-installer');
      if (installExtension && typeof installExtension === 'function') {
        await installExtension(REACT_DEVELOPER_TOOLS)
          .then((name: string) => console.log(`Added Extension: ${name}`))
          .catch((err: Error) => console.log('An error occurred: ', err));
      }
    } catch (err) {
      console.log('Failed to load devtools installer:', err);
    }
  });
}