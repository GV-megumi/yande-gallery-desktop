import { ipcMain, dialog } from 'electron';
import { IPC_CHANNELS } from './channels.js';
import path from 'path';
import fs from 'fs/promises';

// 模拟数据库操作（简化版本，不使用sharp）
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
    const newImage = {
      ...image,
      id: Date.now(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
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

  // 扫描文件夹（简化版，不处理图片内容）
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

  // 生成缩略图（简化版，直接返回原图路径）
  ipcMain.handle(IPC_CHANNELS.IMAGE_GENERATE_THUMBNAIL, async (_, imagePath: string) => {
    try {
      // 简化版本，直接返回原图路径
      // 实际项目中应该使用sharp生成缩略图
      console.log(`Thumbnail generation skipped for: ${imagePath}`);
      return { success: true, data: imagePath };
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
        fileUrl: `https://via.placeholder.com/800x600/1890ff/ffffff?text=Yande+${i + 1000 * page}`,
        previewUrl: `https://via.placeholder.com/200x150/1890ff/ffffff?text=Preview+${i + 1000 * page}`,
        rating: ['safe', 'questionable', 'explicit'][Math.floor(Math.random() * 3)],
        tags: tags || ['anime', 'girl', 'cute'],
        downloaded: false,
        createdAt: new Date().toISOString()
      }));

      return { success: true, data: mockImages };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 搜索图片
  ipcMain.handle(IPC_CHANNELS.YANDE_SEARCH_IMAGES, async (_, tags: string[], page: number = 1) => {
    try {
      return await ipcMain.handle(IPC_CHANNELS.YANDE_GET_IMAGES, null, page, tags);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 下载图片（简化版）
  ipcMain.handle(IPC_CHANNELS.YANDE_DOWNLOAD_IMAGE, async (_, imageData: any) => {
    try {
      // 模拟下载过程
      console.log(`Downloading image: ${imageData.filename}`);

      // 创建downloads目录
      const downloadsDir = path.join(__dirname, '../../../downloads');
      await fs.mkdir(downloadsDir, { recursive: true });

      // 模拟下载路径
      const downloadPath = path.join(downloadsDir, imageData.filename);

      // 这里应该实现实际的下载逻辑
      // 简化版本，直接返回路径
      console.log(`Image would be downloaded to: ${downloadPath}`);

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

// 辅助函数：获取图片信息（简化版，不处理图片内容）
async function getImageInfo(filePath: string): Promise<any | null> {
  try {
    const stats = await fs.stat(filePath);

    // 简化版本，不实际读取图片内容
    const ext = path.extname(filePath).toLowerCase();
    const format = ext.replace('.', '');

    // 模拟图片尺寸（实际项目中应该使用sharp获取真实尺寸）
    const mockDimensions = {
      'jpg': { width: 1920, height: 1080 },
      'jpeg': { width: 1920, height: 1080 },
      'png': { width: 1920, height: 1080 },
      'gif': { width: 400, height: 300 },
      'webp': { width: 1920, height: 1080 },
      'bmp': { width: 1920, height: 1080 }
    };

    const dimensions = mockDimensions[format] || { width: 800, height: 600 };

    return {
      filename: path.basename(filePath),
      filepath: filePath,
      fileSize: stats.size,
      width: dimensions.width,
      height: dimensions.height,
      format: format,
      createdAt: stats.birthtime.toISOString(),
      updatedAt: stats.mtime.toISOString()
    };
  } catch (error) {
    console.error(`Failed to get image info for ${filePath}:`, error);
    return null;
  }
}