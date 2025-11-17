import { ipcMain, dialog, IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from './channels.js';
import path from 'path';
import fs from 'fs/promises';
import {
  initDatabase,
  getImages,
  addImage,
  searchImages,
  getImageById,
  deleteImage,
  updateImageTags,
  getAllTags,
  searchTags,
  addYandeImage,
  markYandeImageAsDownloaded,
  getRecentImages,
  getImagesByFolder,
  getAllFolders,
  scanAndImportFolder
} from '../services/imageService.js';
import {
  getGalleries,
  getGallery,
  createGallery,
  updateGallery,
  deleteGallery,
  setGalleryCover,
  updateGalleryStats,
  scanSubfoldersAndCreateGalleries
} from '../services/galleryService.js';
import { getConfig, saveConfig, updateGalleryFolders, reloadConfig } from '../services/config.js';
import { generateThumbnail, getThumbnailIfExists, deleteThumbnail } from '../services/thumbnailService.js';

export function setupIPC() {
  // 数据库初始化
  ipcMain.handle(IPC_CHANNELS.DB_INIT, async (_event: IpcMainInvokeEvent) => {
    try {
      return await initDatabase();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 获取图片列表
  ipcMain.handle(IPC_CHANNELS.DB_GET_IMAGES, async (_event: IpcMainInvokeEvent, page: number = 1, pageSize: number = 50) => {
    try {
      return await getImages(page, pageSize);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 添加图片
  ipcMain.handle(IPC_CHANNELS.DB_ADD_IMAGE, async (_event: IpcMainInvokeEvent, image: any) => {
    try {
      return await addImage(image);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 搜索图片（支持分页）
  ipcMain.handle(IPC_CHANNELS.DB_SEARCH_IMAGES, async (_event: IpcMainInvokeEvent, query: string, page?: number, pageSize?: number) => {
    try {
      return await searchImages(query, page, pageSize);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 扫描文件夹（简化版，不处理图片内容）
  ipcMain.handle(IPC_CHANNELS.IMAGE_SCAN_FOLDER, async (_event: IpcMainInvokeEvent, folderPath: string) => {
    try {
      const images = [];
      const files = await scanDirectory(folderPath);

      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) {
          try {
            const imageInfo = await getImageInfo(file);
            if (imageInfo) {
              const result = await addImage(imageInfo);
              if (result.success && result.data) {
                images.push({ ...imageInfo, id: result.data });
              }
            }
          } catch (error) {
            console.error(`Failed to process image ${file}:`, error);
          }
        }
      }

      return { success: true, data: images };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 生成缩略图
  ipcMain.handle(IPC_CHANNELS.IMAGE_GENERATE_THUMBNAIL, async (_event: IpcMainInvokeEvent, imagePath: string, force?: boolean) => {
    try {
      return await generateThumbnail(imagePath, force || false);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 获取缩略图路径（如果存在）
  ipcMain.handle('image:get-thumbnail', async (_event: IpcMainInvokeEvent, imagePath: string) => {
    try {
      const thumbnailPath = await getThumbnailIfExists(imagePath);
      return { success: true, data: thumbnailPath };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 删除缩略图
  ipcMain.handle('image:delete-thumbnail', async (_event: IpcMainInvokeEvent, imagePath: string) => {
    try {
      return await deleteThumbnail(imagePath);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 获取Yande.re图片（模拟数据）
  ipcMain.handle(IPC_CHANNELS.YANDE_GET_IMAGES, async (_event: IpcMainInvokeEvent, page: number = 1, tags?: string[]) => {
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
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 搜索图片
  ipcMain.handle(IPC_CHANNELS.YANDE_SEARCH_IMAGES, async (_event: IpcMainInvokeEvent, tags: string[], page: number = 1) => {
    try {
      // 模拟搜索功能，使用相同的模拟数据但过滤标签
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
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 下载图片（简化版）
  ipcMain.handle(IPC_CHANNELS.YANDE_DOWNLOAD_IMAGE, async (_event: IpcMainInvokeEvent, imageData: any) => {
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
      return { success: false, error: error instanceof Error ? error.message : String(error) };
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
  ipcMain.handle(IPC_CHANNELS.SYSTEM_SHOW_ITEM, async (_event: IpcMainInvokeEvent, filePath: string) => {
    try {
      const { shell } = await import('electron');
      shell.showItemInFolder(filePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 最近图片 =====
  ipcMain.handle('gallery:get-recent-images', async (_event: IpcMainInvokeEvent, count: number = 100) => {
    try {
      return await getRecentImages(count);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 文件夹相关 =====
  ipcMain.handle('gallery:get-images-by-folder', async (_event: IpcMainInvokeEvent, folderPath: string, page: number = 1, pageSize: number = 50) => {
    try {
      return await getImagesByFolder(folderPath, page, pageSize);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('gallery:get-all-folders', async (_event: IpcMainInvokeEvent) => {
    try {
      return await getAllFolders();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('gallery:scan-and-import-folder', async (_event: IpcMainInvokeEvent, folderPath: string, extensions: string[], recursive: boolean) => {
    try {
      return await scanAndImportFolder(folderPath, extensions, recursive);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 图库（Gallery）管理 =====
  ipcMain.handle('gallery:get-galleries', async (_event: IpcMainInvokeEvent) => {
    try {
      return await getGalleries();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('gallery:get-gallery', async (_event: IpcMainInvokeEvent, id: number) => {
    try {
      return await getGallery(id);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('gallery:create-gallery', async (_event: IpcMainInvokeEvent, galleryData: any) => {
    try {
      return await createGallery(galleryData);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('gallery:update-gallery', async (_event: IpcMainInvokeEvent, id: number, updates: any) => {
    try {
      return await updateGallery(id, updates);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('gallery:delete-gallery', async (_event: IpcMainInvokeEvent, id: number) => {
    try {
      return await deleteGallery(id);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('gallery:set-gallery-cover', async (_event: IpcMainInvokeEvent, id: number, coverImageId: number) => {
    try {
      return await setGalleryCover(id, coverImageId);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('gallery:update-gallery-stats', async (_event: IpcMainInvokeEvent, id: number, imageCount: number, lastScannedAt: string) => {
    try {
      return await updateGalleryStats(id, imageCount, lastScannedAt);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 配置管理 =====
  ipcMain.handle('config:get', async (_event: IpcMainInvokeEvent) => {
    try {
      const config = getConfig();
      return { success: true, data: config };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('config:save', async (_event: IpcMainInvokeEvent, newConfig: any) => {
    try {
      return await saveConfig(newConfig);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('config:update-gallery-folders', async (_event: IpcMainInvokeEvent, folders: any[]) => {
    try {
      return await updateGalleryFolders(folders);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('config:reload', async (_event: IpcMainInvokeEvent) => {
    try {
      const config = await reloadConfig();
      return { success: true, data: config };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 扫描子文件夹并创建图集 =====
  ipcMain.handle('gallery:scan-subfolders', async (_event: IpcMainInvokeEvent, rootPath: string, extensions?: string[]) => {
    try {
      return await scanSubfoldersAndCreateGalleries(rootPath, extensions);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
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

    const dimensions = mockDimensions[format as keyof typeof mockDimensions] || { width: 800, height: 600 };

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
