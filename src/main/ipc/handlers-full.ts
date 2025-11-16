import { ipcMain, dialog } from 'electron';
import { IPC_CHANNELS } from './channels.js';
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';

// 模拟数据库操作（实际项目中应该使用SQLite）
const mockDatabase = {
  images: [] as any[],
  async init() {
    console.log('Database initialized');
    return { success: true };
  },
  async getImages(page: number, pageSize: number) {
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    return this.images.slice(start, end);
  },
  async addImage(image: any) {
    const newImage = { ...image, id: Date.now(), createdAt: new Date().toISOString() };
    this.images.push(newImage);
    return newImage.id;
  },
  async searchImages(query: string) {
    return this.images.filter(img =>
      img.filename.toLowerCase().includes(query.toLowerCase())
    );
  }
};

export function setupIPC() {
  // 数据库初始化
  ipcMain.handle(IPC_CHANNELS.DB_INIT, async () => {
    try {
      const result = await mockDatabase.init();
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 获取图片列表
  ipcMain.handle(IPC_CHANNELS.DB_GET_IMAGES, async (_, page: number = 1, pageSize: number = 50) => {
    try {
      const images = await mockDatabase.getImages(page, pageSize);
      return { success: true, data: images };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 添加图片
  ipcMain.handle(IPC_CHANNELS.DB_ADD_IMAGE, async (_, image: any) => {
    try {
      const id = await mockDatabase.addImage(image);
      return { success: true, data: id };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 搜索图片
  ipcMain.handle(IPC_CHANNELS.DB_SEARCH_IMAGES, async (_, query: string) => {
    try {
      const images = await mockDatabase.searchImages(query);
      return { success: true, data: images };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 扫描文件夹
  ipcMain.handle(IPC_CHANNELS.IMAGE_SCAN_FOLDER, async (_, folderPath: string) => {
    try {
      const images = [];
      const files = await scanDirectory(folderPath);

      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) {
          try {
            const imageInfo = await getImageInfo(file);
            if (imageInfo) {
              const id = await mockDatabase.addImage(imageInfo);
              images.push({ ...imageInfo, id });
            }
          } catch (error) {
            console.error(`Failed to process image ${file}:`, error);
          }
        }
      }

      return { success: true, data: images };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 生成缩略图
  ipcMain.handle(IPC_CHANNELS.IMAGE_GENERATE_THUMBNAIL, async (_, imagePath: string) => {
    try {
      const thumbnailPath = imagePath.replace(/(\.\w+)$/, '_thumb$1');

      await sharp(imagePath)
        .resize(200, 200, { fit: 'cover' })
        .toFile(thumbnailPath);

      return { success: true, data: thumbnailPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 获取Yande.re图片
  ipcMain.handle(IPC_CHANNELS.YANDE_GET_IMAGES, async (_, page: number = 1, tags?: string[]) => {
    try {
      // 模拟Yande.re API响应
      const mockImages = Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        yandeId: i + 1000 * page,
        filename: `yande_${i + 1000 * page}.jpg`,
        fileUrl: `https://yande.re/sample/sample_${i + 1000 * page}.jpg`,
        previewUrl: `https://yande.re/preview/preview_${i + 1000 * page}.jpg`,
        rating: ['safe', 'questionable', 'explicit'][Math.floor(Math.random() * 3)],
        tags: ['tag1', 'tag2', 'tag3'],
        downloaded: false,
        createdAt: new Date().toISOString()
      }));

      return { success: true, data: mockImages };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 下载图片
  ipcMain.handle(IPC_CHANNELS.YANDE_DOWNLOAD_IMAGE, async (_, imageData: any) => {
    try {
      // 模拟下载过程
      console.log(`Downloading image: ${imageData.filename}`);

      // 这里应该实现实际的下载逻辑
      const downloadPath = path.join(__dirname, '../../../downloads', imageData.filename);

      // 模拟下载完成
      return { success: true, data: downloadPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 选择文件夹
  ipcMain.handle(IPC_CHANNELS.SYSTEM_SELECT_FOLDER, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择图片文件夹'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, data: result.filePaths[0] };
    }

    return { success: false, error: 'No folder selected' };
  });

  // 打开外部链接
  ipcMain.handle(IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL, async (_, url: string) => {
    const { shell } = await import('electron');
    await shell.openExternal(url);
  });

  // 在文件管理器中显示项目
  ipcMain.handle(IPC_CHANNELS.SYSTEM_SHOW_ITEM, async (_, filePath: string) => {
    const { shell } = await import('electron');
    shell.showItemInFolder(filePath);
  });
}

// 辅助函数：递归扫描目录
async function scanDirectory(dirPath: string): Promise<string[]> {
  const files: string[] = [];
  const items = await fs.readdir(dirPath, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);
    if (item.isDirectory()) {
      const subFiles = await scanDirectory(fullPath);
      files.push(...subFiles);
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

// 辅助函数：获取图片信息
async function getImageInfo(filePath: string): Promise<any | null> {
  try {
    const stats = await fs.stat(filePath);
    const metadata = await sharp(filePath).metadata();

    if (!metadata.width || !metadata.height) {
      return null;
    }

    return {
      filename: path.basename(filePath),
      filepath: filePath,
      fileSize: stats.size,
      width: metadata.width,
      height: metadata.height,
      format: metadata.format || 'unknown',
      createdAt: stats.birthtime.toISOString(),
      updatedAt: stats.mtime.toISOString()
    };
  } catch (error) {
    console.error(`Failed to get image info for ${filePath}:`, error);
    return null;
  }
}