import { contextBridge, ipcRenderer } from 'electron';

// IPC 通道常量（与主进程保持一致）
const IPC_CHANNELS = {
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
} as const;

// 暴露安全的API给渲染进程
console.log('[Preload] Exposing electronAPI to renderer process');
contextBridge.exposeInMainWorld('electronAPI', {
  // 数据库操作
  db: {
    init: () => ipcRenderer.invoke(IPC_CHANNELS.DB_INIT),
    getImages: (page: number, pageSize: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.DB_GET_IMAGES, page, pageSize),
    addImage: (image: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.DB_ADD_IMAGE, image),
    searchImages: (query: string, page?: number, pageSize?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.DB_SEARCH_IMAGES, query, page, pageSize)
  },

  // 图库操作
  gallery: {
    getRecentImages: (count?: number) =>
      ipcRenderer.invoke('gallery:get-recent-images', count),
    getGalleries: () => ipcRenderer.invoke('gallery:get-galleries'),
    getGallery: (id: number) => ipcRenderer.invoke('gallery:get-gallery', id),
    createGallery: (galleryData: any) =>
      ipcRenderer.invoke('gallery:create-gallery', galleryData),
    updateGallery: (id: number, updates: any) =>
      ipcRenderer.invoke('gallery:update-gallery', id, updates),
    deleteGallery: (id: number) =>
      ipcRenderer.invoke('gallery:delete-gallery', id),
    getImagesByFolder: (folderPath: string, page?: number, pageSize?: number) =>
      ipcRenderer.invoke('gallery:get-images-by-folder', folderPath, page, pageSize),
    scanAndImportFolder: (folderPath: string, extensions?: string[], recursive?: boolean) =>
      ipcRenderer.invoke('gallery:scan-and-import-folder', folderPath, extensions, recursive),
    scanSubfolders: (rootPath: string, extensions?: string[]) =>
      ipcRenderer.invoke('gallery:scan-subfolders', rootPath, extensions)
  },

  // 配置操作
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    save: (newConfig: any) => ipcRenderer.invoke('config:save', newConfig),
    updateGalleryFolders: (folders: any[]) => ipcRenderer.invoke('config:update-gallery-folders', folders),
    reload: () => ipcRenderer.invoke('config:reload')
  },

  // 图片操作
  image: {
    scanFolder: (folderPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.IMAGE_SCAN_FOLDER, folderPath),
    generateThumbnail: (imagePath: string, force?: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.IMAGE_GENERATE_THUMBNAIL, imagePath, force),
    getThumbnail: (imagePath: string) =>
      ipcRenderer.invoke('image:get-thumbnail', imagePath),
    deleteThumbnail: (imagePath: string) =>
      ipcRenderer.invoke('image:delete-thumbnail', imagePath)
  },

  // Yande.re API
  yande: {
    getImages: (page: number, tags?: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.YANDE_GET_IMAGES, page, tags),
    searchImages: (tags: string[], page?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.YANDE_SEARCH_IMAGES, tags, page),
    downloadImage: (imageData: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.YANDE_DOWNLOAD_IMAGE, imageData)
  },

  // 系统操作
  system: {
    selectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SELECT_FOLDER),
    openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL, url),
    showItem: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SHOW_ITEM, path)
  }
});

console.log('[Preload] electronAPI exposed successfully');

// TypeScript类型声明
declare global {
  interface Window {
    electronAPI: {
      db: {
        init: () => Promise<{ success: boolean; error?: string }>;
        getImages: (page: number, pageSize: number) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        addImage: (image: any) => Promise<{ success: boolean; data?: number; error?: string }>;
        searchImages: (query: string, page?: number, pageSize?: number) => Promise<{ success: boolean; data?: any[]; total?: number; error?: string }>;
      };
      image: {
        scanFolder: (folderPath: string) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        generateThumbnail: (imagePath: string, force?: boolean) => Promise<{ success: boolean; data?: string; error?: string }>;
        getThumbnail: (imagePath: string) => Promise<{ success: boolean; data?: string | null; error?: string }>;
        deleteThumbnail: (imagePath: string) => Promise<{ success: boolean; error?: string }>;
      };
      yande: {
        getImages: (page: number, tags?: string[]) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        searchImages: (tags: string[], page?: number) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        downloadImage: (imageData: any) => Promise<{ success: boolean; data?: any; error?: string }>;
      };
      system: {
        selectFolder: () => Promise<{ success: boolean; data?: string; error?: string }>;
        openExternal: (url: string) => Promise<void>;
        showItem: (path: string) => Promise<void>;
      };
      gallery: {
        getRecentImages: (count?: number) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        getGalleries: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
        getGallery: (id: number) => Promise<{ success: boolean; data?: any; error?: string }>;
        createGallery: (galleryData: any) => Promise<{ success: boolean; data?: number; error?: string }>;
        updateGallery: (id: number, updates: any) => Promise<{ success: boolean; error?: string }>;
        deleteGallery: (id: number) => Promise<{ success: boolean; error?: string }>;
        getImagesByFolder: (folderPath: string, page?: number, pageSize?: number) => Promise<{ success: boolean; data?: any[]; total?: number; error?: string }>;
        scanAndImportFolder: (folderPath: string, extensions?: string[], recursive?: boolean) => Promise<{ success: boolean; data?: { imported: number; skipped: number }; error?: string }>;
        scanSubfolders: (rootPath: string, extensions?: string[]) => Promise<{ success: boolean; data?: { created: number; skipped: number }; error?: string }>;
      };
      config: {
        get: () => Promise<{ success: boolean; data?: any; error?: string }>;
        save: (newConfig: any) => Promise<{ success: boolean; error?: string }>;
        updateGalleryFolders: (folders: any[]) => Promise<{ success: boolean; error?: string }>;
        reload: () => Promise<{ success: boolean; data?: any; error?: string }>;
      };
    };
  }
}