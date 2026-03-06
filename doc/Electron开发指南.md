# Electron 桌面应用开发指南

## 项目初始化

### 1. 创建项目基础结构
```bash
mkdir yande-gallery-desktop
cd yande-gallery-desktop
npm init -y
```

### 2. 安装核心依赖
```bash
# 开发依赖
npm install --save-dev electron typescript @types/react @types/react-dom @types/node vite @vitejs/plugin-react electron-builder

# 运行时依赖
npm install react react-dom sqlite3 sharp axios electron-store

# UI组件库（任选其一）
npm install antd  # Ant Design
# 或者
npm install @mui/material @emotion/react @emotion/styled  # Material-UI
```

### 3. 项目结构
```
yande-gallery-desktop/
├── src/
│   ├── main/           # Electron主进程
│   │   ├── index.ts
│   │   ├── window.ts
│   │   ├── menu.ts
│   │   └── ipc/        # IPC处理
│   │       ├── handlers.ts
│   │       └── channels.ts
│   │
│   ├── renderer/       # 渲染进程（React）
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── services/
│   │   └── store/
│   │
│   ├── core/           # 核心功能
│   │   ├── database/   # SQLite操作
│   │   ├── yande/      # Yande.re API
│   │   ├── download/   # 下载管理
│   │   └── image/      # 图片处理
│   │
│   ├── shared/         # 共享类型
│   │   └── types.ts
│   │
│   └── preload/        # Preload脚本
│       └── index.ts
│
├── assets/             # 静态资源
├── build/              # 构建输出
├── dist/               # 打包输出
├── electron-builder.yml
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## 基础配置

### package.json
```json
{
  "name": "yande-gallery-desktop",
  "version": "1.0.0",
  "description": "Personal Yande.re Gallery Manager",
  "main": "build/main/index.js",
  "scripts": {
    "dev": "concurrently \"npm run dev:main\" \"npm run dev:renderer\"",
    "dev:main": "tsc -p tsconfig.main.json --watch",
    "dev:renderer": "vite",
    "build": "npm run build:main && npm run build:renderer",
    "build:main": "tsc -p tsconfig.main.json",
    "build:renderer": "vite build",
    "pack": "electron-builder",
    "dist": "npm run build && electron-builder"
  },
  "build": {
    "appId": "com.yourname.yande-gallery",
    "productName": "Yande Gallery",
    "directories": {
      "output": "dist"
    },
    "files": [
      "build/**/*",
      "node_modules/**/*",
      "package.json"
    ],
    "extraResources": [
      {
        "from": "assets",
        "to": "assets"
      }
    ],
    "mac": {
      "category": "public.app-category.photography"
    },
    "win": {
      "target": "nsis"
    },
    "linux": {
      "target": "AppImage"
    }
  }
}
```

### TypeScript配置
```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "build", "dist"]
}

// tsconfig.main.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "build/main",
    "noEmit": false,
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/main/**/*", "src/shared/**/*", "src/core/**/*"],
  "exclude": ["src/renderer/**/*"]
}
```

### Vite配置
```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  root: path.join(__dirname, 'src/renderer'),
  build: {
    outDir: path.join(__dirname, 'build/renderer'),
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src')
    }
  }
})
```

## Electron主进程开发

### 主入口文件
```typescript
// src/main/index.ts
import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { createWindow } from './window'
import { setupIPC } from './ipc/handlers'

// 禁用硬件加速（可选，解决某些渲染问题）
app.disableHardwareAcceleration()

// 单实例应用
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // 当尝试启动第二个实例时，聚焦到已有窗口
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0) {
      const window = windows[0]
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })
}

// 应用就绪时创建窗口
app.whenReady().then(() => {
  createWindow()
  setupIPC()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// 所有窗口关闭时退出应用
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 开发工具
if (process.env.NODE_ENV === 'development') {
  app.whenReady().then(() => {
    import('electron-devtools-installer').then(({ default: installExtension, REACT_DEVELOPER_TOOLS }) => {
      installExtension(REACT_DEVELOPER_TOOLS)
        .then((name) => console.log(`Added Extension: ${name}`))
        .catch((err) => console.log('An error occurred: ', err))
    })
  })
}
```

### 窗口管理
```typescript
// src/main/window.ts
import { BrowserWindow, screen } from 'electron'
import path from 'path'

export function createWindow(): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.workAreaSize

  const mainWindow = new BrowserWindow({
    width: Math.min(1400, width * 0.8),
    height: Math.min(900, height * 0.8),
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/index.js')
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false // 先不显示，等加载完成后再显示
  })

  // 加载应用
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // 窗口事件
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()

    // 恢复上次的位置和大小
    // const windowState = getWindowState()
    // if (windowState) {
    //   mainWindow.setBounds(windowState)
    // }
  })

  mainWindow.on('close', () => {
    // 保存窗口状态
    // saveWindowState(mainWindow.getBounds())
  })

  return mainWindow
}
```

### IPC通信处理
```typescript
// src/main/ipc/channels.ts
export const IPC_CHANNELS = {
  // 数据库操作
  DB_INIT: 'db:init',
  DB_GET_IMAGES: 'db:get-images',
  DB_ADD_IMAGE: 'db:add-image',
  DB_UPDATE_IMAGE: 'db:update-image',
  DB_DELETE_IMAGE: 'db:delete-image',
  DB_SEARCH_IMAGES: 'db:search-images',

  // 标签管理
  DB_GET_TAGS: 'db:get-tags',
  DB_ADD_TAG: 'db:add-tag',
  DB_UPDATE_TAG: 'db:update-tag',
  DB_DELETE_TAG: 'db:delete-tag',

  // 图片操作
  IMAGE_SCAN_FOLDER: 'image:scan-folder',
  IMAGE_GENERATE_THUMBNAIL: 'image:generate-thumbnail',
  IMAGE_GET_INFO: 'image:get-info',

  // Yande.re API
  YANDE_GET_IMAGES: 'yande:get-images',
  YANDE_SEARCH_IMAGES: 'yande:search-images',
  YANDE_DOWNLOAD_IMAGE: 'yande:download-image',

  // 下载管理
  DOWNLOAD_START: 'download:start',
  DOWNLOAD_PAUSE: 'download:pause',
  DOWNLOAD_RESUME: 'download:resume',
  DOWNLOAD_CANCEL: 'download:cancel',
  DOWNLOAD_GET_PROGRESS: 'download:get-progress',

  // 系统操作
  SYSTEM_SELECT_FOLDER: 'system:select-folder',
  SYSTEM_OPEN_EXTERNAL: 'system:open-external',
  SYSTEM_SHOW_ITEM: 'system:show-item'
} as const
```

```typescript
// src/main/ipc/handlers.ts
import { ipcMain } from 'electron'
import { IPC_CHANNELS } from './channels'
import { DatabaseManager } from '../core/database/DatabaseManager'
import { ImageScanner } from '../core/image/ImageScanner'
import { YandeAPI } from '../core/yande/YandeAPI'
import { DownloadManager } from '../core/download/DownloadManager'

export function setupIPC() {
  const dbManager = new DatabaseManager()
  const imageScanner = new ImageScanner()
  const yandeAPI = new YandeAPI()
  const downloadManager = new DownloadManager()

  // 数据库初始化
  ipcMain.handle(IPC_CHANNELS.DB_INIT, async () => {
    try {
      await dbManager.initialize()
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 获取图片列表
  ipcMain.handle(IPC_CHANNELS.DB_GET_IMAGES, async (_, page: number, pageSize: number) => {
    try {
      const images = await dbManager.getImages(page, pageSize)
      return { success: true, data: images }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 扫描文件夹
  ipcMain.handle(IPC_CHANNELS.IMAGE_SCAN_FOLDER, async (_, folderPath: string) => {
    try {
      const images = await imageScanner.scanFolder(folderPath)

      // 保存到数据库
      for (const image of images) {
        await dbManager.addImage(image)
      }

      return { success: true, data: images }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 获取Yande.re图片
  ipcMain.handle(IPC_CHANNELS.YANDE_GET_IMAGES, async (_, page: number, tags?: string[]) => {
    try {
      const images = await yandeAPI.getImages(page, tags)
      return { success: true, data: images }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 下载图片
  ipcMain.handle(IPC_CHANNELS.YANDE_DOWNLOAD_IMAGE, async (_, imageData: any) => {
    try {
      const result = await downloadManager.downloadImage(imageData)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 选择文件夹
  ipcMain.handle(IPC_CHANNELS.SYSTEM_SELECT_FOLDER, async () => {
    const { dialog } = require('electron')
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })

    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, data: result.filePaths[0] }
    }

    return { success: false, error: 'No folder selected' }
  })
}
```

## Preload脚本

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../main/ipc/channels'

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 数据库操作
  db: {
    init: () => ipcRenderer.invoke(IPC_CHANNELS.DB_INIT),
    getImages: (page: number, pageSize: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.DB_GET_IMAGES, page, pageSize),
    addImage: (image: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.DB_ADD_IMAGE, image),
    searchImages: (query: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.DB_SEARCH_IMAGES, query)
  },

  // 图片操作
  image: {
    scanFolder: (folderPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.IMAGE_SCAN_FOLDER, folderPath),
    generateThumbnail: (imagePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.IMAGE_GENERATE_THUMBNAIL, imagePath)
  },

  // Yande.re API
  yande: {
    getImages: (page: number, tags?: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.YANDE_GET_IMAGES, page, tags),
    downloadImage: (imageData: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.YANDE_DOWNLOAD_IMAGE, imageData)
  },

  // 系统操作
  system: {
    selectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SELECT_FOLDER),
    openExternal: (url: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL, url),
    showItem: (path: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SHOW_ITEM, path)
  }
})

// TypeScript类型声明
declare global {
  interface Window {
    electronAPI: {
      db: {
        init: () => Promise<{ success: boolean; error?: string }>
        getImages: (page: number, pageSize: number) => Promise<{ success: boolean; data?: any[]; error?: string }>
        addImage: (image: any) => Promise<{ success: boolean; error?: string }>
        searchImages: (query: string) => Promise<{ success: boolean; data?: any[]; error?: string }>
      }
      image: {
        scanFolder: (folderPath: string) => Promise<{ success: boolean; data?: any[]; error?: string }>
        generateThumbnail: (imagePath: string) => Promise<{ success: boolean; data?: string; error?: string }>
      }
      yande: {
        getImages: (page: number, tags?: string[]) => Promise<{ success: boolean; data?: any[]; error?: string }>
        downloadImage: (imageData: any) => Promise<{ success: boolean; data?: any; error?: string }>
      }
      system: {
        selectFolder: () => Promise<{ success: boolean; data?: string; error?: string }>
        openExternal: (url: string) => Promise<void>
        showItem: (path: string) => Promise<void>
      }
    }
  }
}
```

## SQLite数据库设计

```typescript
// src/core/database/DatabaseManager.ts
import { Database } from 'sqlite3'
import path from 'path'
import { app } from 'electron'

export class DatabaseManager {
  private db: Database | null = null
  private dbPath: string

  constructor() {
    this.dbPath = path.join(app.getPath('userData'), 'gallery.db')
  }

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db = new Database(this.dbPath, (err) => {
        if (err) {
          reject(err)
          return
        }

        this.createTables()
          .then(() => resolve())
          .catch(reject)
      })
    })
  }

  private async createTables(): Promise<void> {
    const tables = [
      `CREATE TABLE IF NOT EXISTS images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL UNIQUE,
        file_size INTEGER,
        width INTEGER,
        height INTEGER,
        format TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        category TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS image_tags (
        image_id INTEGER,
        tag_id INTEGER,
        PRIMARY KEY (image_id, tag_id),
        FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      )`,

      `CREATE TABLE IF NOT EXISTS yande_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        yande_id INTEGER UNIQUE NOT NULL,
        filename TEXT,
        file_url TEXT,
        preview_url TEXT,
        rating TEXT,
        tags TEXT,
        downloaded BOOLEAN DEFAULT FALSE,
        local_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ]

    for (const tableSql of tables) {
      await this.run(tableSql)
    }
  }

  private run(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'))
        return
      }

      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err)
          return
        }
        resolve()
      })
    })
  }

  async getImages(page: number, pageSize: number): Promise<any[]> {
    const offset = (page - 1) * pageSize
    const sql = `
      SELECT i.*, GROUP_CONCAT(t.name) as tags
      FROM images i
      LEFT JOIN image_tags it ON i.id = it.image_id
      LEFT JOIN tags t ON it.tag_id = t.id
      GROUP BY i.id
      ORDER BY i.created_at DESC
      LIMIT ? OFFSET ?
    `

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'))
        return
      }

      this.db.all(sql, [pageSize, offset], (err, rows) => {
        if (err) {
          reject(err)
          return
        }
        resolve(rows)
      })
    })
  }

  async addImage(image: any): Promise<number> {
    const sql = `
      INSERT INTO images (filename, filepath, file_size, width, height, format)
      VALUES (?, ?, ?, ?, ?, ?)
    `

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'))
        return
      }

      this.db.run(sql, [
        image.filename,
        image.filepath,
        image.file_size,
        image.width,
        image.height,
        image.format
      ], function(err) {
        if (err) {
          reject(err)
          return
        }
        resolve(this.lastID)
      })
    })
  }
}
```

## 核心功能实现

### 图片扫描器
```typescript
// src/core/image/ImageScanner.ts
import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'

interface ImageFile {
  filename: string
  filepath: string
  file_size: number
  width: number
  height: number
  format: string
}

export class ImageScanner {
  private readonly supportedFormats = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']

  async scanFolder(folderPath: string): Promise<ImageFile[]> {
    const imageFiles: ImageFile[] = []

    try {
      const files = await this.getAllFiles(folderPath)

      for (const file of files) {
        const ext = path.extname(file).toLowerCase()
        if (this.supportedFormats.includes(ext)) {
          try {
            const imageInfo = await this.getImageInfo(file)
            if (imageInfo) {
              imageFiles.push(imageInfo)
            }
          } catch (error) {
            console.error(`Failed to process image ${file}:`, error)
          }
        }
      }
    } catch (error) {
      throw new Error(`Failed to scan folder ${folderPath}: ${error}`)
    }

    return imageFiles
  }

  private async getAllFiles(dirPath: string): Promise<string[]> {
    const files: string[] = []
    const items = await fs.readdir(dirPath, { withFileTypes: true })

    for (const item of items) {
      const fullPath = path.join(dirPath, item.name)
      if (item.isDirectory()) {
        const subFiles = await this.getAllFiles(fullPath)
        files.push(...subFiles)
      } else {
        files.push(fullPath)
      }
    }

    return files
  }

  private async getImageInfo(filePath: string): Promise<ImageFile | null> {
    try {
      const stats = await fs.stat(filePath)
      const metadata = await sharp(filePath).metadata()

      if (!metadata.width || !metadata.height) {
        return null
      }

      return {
        filename: path.basename(filePath),
        filepath: filePath,
        file_size: stats.size,
        width: metadata.width,
        height: metadata.height,
        format: metadata.format || 'unknown'
      }
    } catch (error) {
      console.error(`Failed to get image info for ${filePath}:`, error)
      return null
    }
  }
}
```

## React组件开发

### 主应用组件
```typescript
// src/renderer/App.tsx
import React, { useEffect, useState } from 'react'
import { Layout, Menu, theme } from 'antd'
import { PictureOutlined, CloudDownloadOutlined, SettingOutlined } from '@ant-design/icons'
import { GalleryPage } from './pages/GalleryPage'
import { DownloadPage } from './pages/DownloadPage'
import { SettingsPage } from './pages/SettingsPage'

const { Header, Content, Sider } = Layout

type MenuItem = {
  key: string
  icon: React.ReactNode
  label: string
}

const menuItems: MenuItem[] = [
  { key: 'gallery', icon: <PictureOutlined />, label: '本地图库' },
  { key: 'download', icon: <CloudDownloadOutlined />, label: 'Yande.re' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置' }
]

export const App: React.FC = () => {
  const [selectedKey, setSelectedKey] = useState('gallery')
  const {
    token: { colorBgContainer },
  } = theme.useToken()

  // 初始化数据库
  useEffect(() => {
    window.electronAPI.db.init().then(result => {
      if (!result.success) {
        console.error('Failed to initialize database:', result.error)
      }
    })
  }, [])

  const renderContent = () => {
    switch (selectedKey) {
      case 'gallery':
        return <GalleryPage />
      case 'download':
        return <DownloadPage />
      case 'settings':
        return <SettingsPage />
      default:
        return <GalleryPage />
    }
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={200} theme="light">
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => setSelectedKey(key)}
        />
      </Sider>
      <Layout>
        <Header style={{ padding: 0, background: colorBgContainer }}>
          <h2 style={{ margin: '0 24px' }}>
            {menuItems.find(item => item.key === selectedKey)?.label}
          </h2>
        </Header>
        <Content style={{ margin: '24px 16px 0', overflow: 'initial' }}>
          {renderContent()}
        </Content>
      </Layout>
    </Layout>
  )
}
```

### 图库页面
```typescript
// src/renderer/pages/GalleryPage.tsx
import React, { useState, useEffect } from 'react'
import { Button, Empty, message, Spin, Upload } from 'antd'
import { PlusOutlined, FolderOpenOutlined } from '@ant-design/icons'
import { ImageGrid } from '../components/ImageGrid'
import { Image } from '../types'

export const GalleryPage: React.FC = () => {
  const [images, setImages] = useState<Image[]>([])
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)

  // 加载图片列表
  const loadImages = async (page: number = 1) => {
    setLoading(true)
    try {
      const result = await window.electronAPI.db.getImages(page, 50)
      if (result.success) {
        setImages(result.data || [])
      } else {
        message.error('加载图片失败: ' + result.error)
      }
    } catch (error) {
      message.error('加载图片失败')
    } finally {
      setLoading(false)
    }
  }

  // 扫描文件夹
  const handleScanFolder = async () => {
    const result = await window.electronAPI.system.selectFolder()
    if (!result.success || !result.data) {
      return
    }

    setScanning(true)
    try {
      const scanResult = await window.electronAPI.image.scanFolder(result.data)
      if (scanResult.success) {
        message.success(`扫描完成，共找到 ${scanResult.data?.length || 0} 张图片`)
        loadImages()
      } else {
        message.error('扫描失败: ' + scanResult.error)
      }
    } catch (error) {
      message.error('扫描失败')
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => {
    loadImages()
  }, [])

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ marginBottom: '24px', display: 'flex', gap: '12px' }}>
        <Button
          type="primary"
          icon={<FolderOpenOutlined />}
          onClick={handleScanFolder}
          loading={scanning}
        >
          扫描文件夹
        </Button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px' }}>
          <Spin size="large" />
        </div>
      ) : images.length === 0 ? (
        <Empty
          description="暂无图片"
          style={{ marginTop: '100px' }}
        >
          <Button type="primary" onClick={handleScanFolder}>
            扫描文件夹
          </Button>
        </Empty>
      ) : (
        <ImageGrid images={images} onReload={() => loadImages()} />
      )}
    </div>
  )
}
```

## 打包和发布

### 开发环境准备
```bash
# 安装开发工具
npm install --save-dev concurrently electron-devtools-installer

# 创建开发脚本
# package.json scripts section
"scripts": {
  "dev": "concurrently \"npm run dev:main\" \"npm run dev:renderer\"",
  "dev:main": "tsc -p tsconfig.main.json --watch",
  "dev:renderer": "vite --host",
  "build": "npm run build:main && npm run build:renderer",
  "build:main": "tsc -p tsconfig.main.json",
  "build:renderer": "vite build",
  "pack": "electron-builder",
  "dist": "npm run build && electron-builder --publish=never"
}
```

### 构建配置
```yaml
# electron-builder.yml
appId: com.yourname.yande-gallery
productName: Yande Gallery
directories:
  output: dist
files:
  - build/**/*
  - node_modules/**/*
  - package.json
extraResources:
  - from: assets
    to: assets
mac:
  category: public.app-category.photography
  target: dmg
win:
  target: nsis
  icon: assets/icon.ico
linux:
  target: AppImage
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

### 打包命令
```bash
# 开发测试
npm run dev

# 构建应用
npm run build

# 打包（当前平台）
npm run dist

# 打包特定平台
npm run dist -- --mac
npm run dist -- --win
npm run dist -- --linux
```

## 最佳实践和优化

### 1. 性能优化
- 使用虚拟滚动处理大量图片列表
- 图片懒加载，只加载可视区域
- 缩略图预生成和缓存
- 数据库查询优化，使用索引

### 2. 内存管理
- 及时清理不需要的图片对象
- 限制同时显示的图片数量
- 使用分页加载而非一次性加载全部

### 3. 用户体验
- 添加加载状态提示
- 实现渐进式加载
- 提供快捷键支持
- 支持拖拽操作

### 4. 错误处理
- 完善的错误提示
- 操作回滚机制
- 日志记录便于调试

### 5. 数据安全
- 数据库备份机制
- 操作确认对话框
- 定期数据完整性检查

## 下一步开发建议

1. **先完成MVP功能**：
   - 基础图片扫描和展示
   - 简单的数据库操作
   - 基本的Yande.re浏览和下载

2. **逐步优化**：
   - 添加缩略图生成
   - 实现虚拟滚动
   - 优化图片加载性能

3. **添加高级功能**：
   - 标签管理系统
   - 高级搜索功能
   - 批量下载管理

这个指南应该能帮助你快速搭建Electron应用的基础框架。需要我详细展开某个具体功能的实现吗？比如图片扫描器的详细实现，或者Yande.re API的对接代码？

---

*基于个人使用场景优化的Electron开发指南*