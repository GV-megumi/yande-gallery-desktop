import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../main/ipc/channels.js';

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

// TypeScript类型声明
declare global {
  interface Window {
    electronAPI: {
      db: {
        init: () => Promise<{ success: boolean; error?: string }>;
        getImages: (page: number, pageSize: number) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        addImage: (image: any) => Promise<{ success: boolean; data?: number; error?: string }>;
        searchImages: (query: string) => Promise<{ success: boolean; data?: any[]; error?: string }>;
      };
      image: {
        scanFolder: (folderPath: string) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        generateThumbnail: (imagePath: string) => Promise<{ success: boolean; data?: string; error?: string }>;
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
    };
  }
}