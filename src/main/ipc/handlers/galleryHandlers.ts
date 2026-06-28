import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { IPC_CHANNELS } from '../channels.js';
import {
  initDatabase,
  getImages,
  addImage,
  searchImages,
  deleteImage,
  getRecentImages,
  getRecentImagesAfter,
  getImagesByFolder,
  getImagesByGallery,
  getAllFolders,
  scanAndImportFolder,
} from '../../services/imageService.js';
import {
  getGalleries,
  getGallery,
  createGallery,
  updateGallery,
  deleteGallery,
  setGalleryCover,
  updateGalleryStats,
  syncGalleryFolder,
  scanSubfoldersAndCreateGalleries,
  listIgnoredFolders,
  addIgnoredFolder,
  updateIgnoredFolder,
  removeIgnoredFolder,
  bindFolder,
  unbindFolder,
  changeFolderPath,
} from '../../services/galleryService.js';
import { generateThumbnail, requestThumbnailGeneration, deleteThumbnail } from '../../services/thumbnailService.js';
import {
  reportInvalidImage,
  getInvalidImages,
  getInvalidImageCount,
  deleteInvalidImage,
  clearInvalidImages,
} from '../../services/invalidImageService.js';

export function setupGalleryHandlers() {
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

  // Queue missing thumbnails instead of blocking the IPC call until generation completes.
  ipcMain.handle(IPC_CHANNELS.IMAGE_GET_THUMBNAIL, async (_event: IpcMainInvokeEvent, imagePath: string) => {
    try {
      return await requestThumbnailGeneration(imagePath);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[IPC] 获取缩略图失败: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  });

  // 删除图片（包括数据库记录、磁盘文件和缩略图）
  ipcMain.handle(IPC_CHANNELS.IMAGE_DELETE, async (_event: IpcMainInvokeEvent, imageId: number) => {
    try {
      return await deleteImage(imageId);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 删除缩略图
  ipcMain.handle(IPC_CHANNELS.IMAGE_DELETE_THUMBNAIL, async (_event: IpcMainInvokeEvent, imagePath: string) => {
    try {
      return await deleteThumbnail(imagePath);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 最近图片 =====
  ipcMain.handle(IPC_CHANNELS.GALLERY_GET_RECENT_IMAGES, async (_event: IpcMainInvokeEvent, count: number = 100) => {
    try {
      return await getRecentImages(count);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_GET_RECENT_IMAGES_AFTER, async (
    _event: IpcMainInvokeEvent,
    updatedAt: string,
    id: number,
    limit: number = 200,
    beforeUpdatedAt?: string,
    beforeId?: number
  ) => {
    try {
      return await getRecentImagesAfter(updatedAt, id, limit, beforeUpdatedAt, beforeId);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 文件夹相关 =====
  ipcMain.handle(IPC_CHANNELS.GALLERY_GET_IMAGES_BY_FOLDER, async (_event: IpcMainInvokeEvent, folderPath: string, page: number = 1, pageSize: number = 50) => {
    try {
      return await getImagesByFolder(folderPath, page, pageSize);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 图集成员读取（Phase 2B）：按 gallery_images 成员表读取图集图片
  ipcMain.handle(IPC_CHANNELS.GALLERY_GET_IMAGES_BY_GALLERY, async (_event: IpcMainInvokeEvent, galleryId: number, page: number = 1, pageSize: number = 50) => {
    try {
      return await getImagesByGallery(galleryId, page, pageSize);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_GET_ALL_FOLDERS, async (_event: IpcMainInvokeEvent) => {
    try {
      return await getAllFolders();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_SCAN_AND_IMPORT_FOLDER, async (_event: IpcMainInvokeEvent, folderPath: string, extensions: string[], recursive: boolean) => {
    try {
      return await scanAndImportFolder(folderPath, extensions, recursive);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 图库（Gallery）管理 =====
  ipcMain.handle(IPC_CHANNELS.GALLERY_GET_GALLERIES, async (_event: IpcMainInvokeEvent) => {
    try {
      return await getGalleries();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_GET_GALLERY, async (_event: IpcMainInvokeEvent, id: number) => {
    try {
      return await getGallery(id);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_CREATE_GALLERY, async (_event: IpcMainInvokeEvent, galleryData: any) => {
    try {
      return await createGallery(galleryData);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_UPDATE_GALLERY, async (_event: IpcMainInvokeEvent, id: number, updates: any) => {
    try {
      return await updateGallery(id, updates);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_DELETE_GALLERY, async (_event: IpcMainInvokeEvent, id: number) => {
    try {
      return await deleteGallery(id);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_SET_GALLERY_COVER, async (_event: IpcMainInvokeEvent, id: number, coverImageId: number) => {
    try {
      return await setGalleryCover(id, coverImageId);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_UPDATE_GALLERY_STATS, async (_event: IpcMainInvokeEvent, id: number, imageCount: number, lastScannedAt: string) => {
    try {
      return await updateGalleryStats(id, imageCount, lastScannedAt);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_SYNC_GALLERY_FOLDER, async (_event: IpcMainInvokeEvent, id: number) => {
    try {
      return await syncGalleryFolder(id);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 无效图片管理 =====
  ipcMain.handle(IPC_CHANNELS.GALLERY_REPORT_INVALID_IMAGE, async (_event: IpcMainInvokeEvent, imageId: number) => {
    try {
      return await reportInvalidImage(imageId);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_GET_INVALID_IMAGES, async (_event: IpcMainInvokeEvent, page: number = 1, pageSize: number = 200) => {
    try {
      return await getInvalidImages(page, pageSize);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_GET_INVALID_IMAGE_COUNT, async (_event: IpcMainInvokeEvent) => {
    try {
      return await getInvalidImageCount();
    } catch (error) {
      return { success: false, data: 0, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_DELETE_INVALID_IMAGE, async (_event: IpcMainInvokeEvent, id: number) => {
    try {
      return await deleteInvalidImage(id);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_CLEAR_INVALID_IMAGES, async (_event: IpcMainInvokeEvent) => {
    try {
      return await clearInvalidImages();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 图库忽略名单 CRUD（bug12） =====
  ipcMain.handle(IPC_CHANNELS.GALLERY_LIST_IGNORED_FOLDERS, async (_event: IpcMainInvokeEvent) => {
    try {
      return await listIgnoredFolders();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.GALLERY_ADD_IGNORED_FOLDER,
    async (_event: IpcMainInvokeEvent, folderPath: string, note?: string) => {
      try {
        return await addIgnoredFolder(folderPath, note);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.GALLERY_UPDATE_IGNORED_FOLDER,
    async (_event: IpcMainInvokeEvent, id: number, patch: { note?: string }) => {
      try {
        return await updateIgnoredFolder(id, patch);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.GALLERY_REMOVE_IGNORED_FOLDER,
    async (_event: IpcMainInvokeEvent, id: number) => {
      try {
        return await removeIgnoredFolder(id);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  // ===== 扫描子文件夹并创建图集 =====
  ipcMain.handle(IPC_CHANNELS.GALLERY_SCAN_SUBFOLDERS, async (_event: IpcMainInvokeEvent, rootPath: string, extensions?: string[]) => {
    try {
      return await scanSubfoldersAndCreateGalleries(rootPath, extensions);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 图库↔文件夹解耦：文件夹绑定原语（Phase 6A） =====
  // 将文件夹绑定到图集（全局唯一：一个文件夹只能绑定到一个图集）
  ipcMain.handle(
    IPC_CHANNELS.GALLERY_BIND_FOLDER,
    async (_event: IpcMainInvokeEvent, galleryId: number, folderPath: string, recursive?: boolean, extensions?: string[]) => {
      try {
        return await bindFolder(galleryId, folderPath, recursive, extensions);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  // 解除文件夹与图集的绑定
  ipcMain.handle(
    IPC_CHANNELS.GALLERY_UNBIND_FOLDER,
    async (_event: IpcMainInvokeEvent, galleryId: number, folderPath: string) => {
      try {
        return await unbindFolder(galleryId, folderPath);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  // 修改图集绑定的文件夹路径（解绑旧路径 + 绑定新路径）
  ipcMain.handle(
    IPC_CHANNELS.GALLERY_CHANGE_FOLDER_PATH,
    async (_event: IpcMainInvokeEvent, galleryId: number, oldPath: string, newPath: string, recursive?: boolean, extensions?: string[]) => {
      try {
        return await changeFolderPath(galleryId, oldPath, newPath, recursive, extensions);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );
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
