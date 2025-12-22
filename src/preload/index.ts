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
  // 下载管理
  DOWNLOAD_START: 'download:start',
  DOWNLOAD_PAUSE: 'download:pause',
  DOWNLOAD_RESUME: 'download:resume',
  DOWNLOAD_CANCEL: 'download:cancel',
  DOWNLOAD_GET_PROGRESS: 'download:get-progress',
  // 系统操作
  SYSTEM_SELECT_FOLDER: 'system:select-folder',
  SYSTEM_OPEN_EXTERNAL: 'system:open-external',
  SYSTEM_SHOW_ITEM: 'system:show-item',

  // === Booru 相关通道 (新增) ===
  BOORU_GET_SITES: 'booru:get-sites',
  BOORU_ADD_SITE: 'booru:add-site',
  BOORU_UPDATE_SITE: 'booru:update-site',
  BOORU_DELETE_SITE: 'booru:delete-site',
  BOORU_GET_ACTIVE_SITE: 'booru:get-active-site',
  BOORU_GET_POSTS: 'booru:get-posts',
  BOORU_GET_POST: 'booru:get-post',
  BOORU_SEARCH_POSTS: 'booru:search-posts',
  BOORU_GET_FAVORITES: 'booru:get-favorites',
  BOORU_ADD_FAVORITE: 'booru:add-favorite',
  BOORU_REMOVE_FAVORITE: 'booru:remove-favorite',
  BOORU_ADD_TO_DOWNLOAD: 'booru:add-to-download',
  BOORU_RETRY_DOWNLOAD: 'booru:retry-download',
  BOORU_GET_DOWNLOAD_QUEUE: 'booru:get-download-queue',
  BOORU_CLEAR_DOWNLOAD_RECORDS: 'booru:clear-download-records',

  // Booru 图片缓存
  BOORU_GET_CACHED_IMAGE_URL: 'booru:get-cached-image-url',
  BOORU_CACHE_IMAGE: 'booru:cache-image',
  BOORU_GET_CACHE_STATS: 'booru:get-cache-stats',

  // Booru 标签分类
  BOORU_GET_TAGS_CATEGORIES: 'booru:get-tags-categories'
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
    setGalleryCover: (id: number, coverImageId: number) =>
      ipcRenderer.invoke('gallery:set-gallery-cover', id, coverImageId),
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

  // Booru API (新增)
  booru: {
    // 站点管理
    getSites: () => ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_SITES),
    addSite: (site: any) => ipcRenderer.invoke(IPC_CHANNELS.BOORU_ADD_SITE, site),
    updateSite: (id: number, updates: any) => ipcRenderer.invoke(IPC_CHANNELS.BOORU_UPDATE_SITE, id, updates),
    deleteSite: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.BOORU_DELETE_SITE, id),
    getActiveSite: () => ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_ACTIVE_SITE),

    // 图片
    getPosts: (siteId: number, page: number = 1, tags?: string[], limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_POSTS, siteId, page, tags, limit),
    getPost: (siteId: number, postId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_POST, siteId, postId),
    searchPosts: (siteId: number, tags: string[], page: number = 1, limit?: number, fetchTagCategories: boolean = true) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_SEARCH_POSTS, siteId, tags, page, limit, fetchTagCategories),

    // 收藏
    getFavorites: (siteId: number, page: number = 1, limit: number = 20) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_FAVORITES, siteId, page, limit),
    addFavorite: (postId: number, siteId: number, syncToServer: boolean = false) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_ADD_FAVORITE, postId, siteId, syncToServer),
    removeFavorite: (postId: number, syncToServer: boolean = false) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_REMOVE_FAVORITE, postId, syncToServer),

    // 下载
    addToDownload: (postId: number, siteId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_ADD_TO_DOWNLOAD, postId, siteId),
    retryDownload: (postId: number, siteId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_RETRY_DOWNLOAD, postId, siteId),
    getDownloadQueue: (status?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_DOWNLOAD_QUEUE, status),
    clearDownloadRecords: (status: 'completed' | 'failed') =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_CLEAR_DOWNLOAD_RECORDS, status),

    // 图片缓存
    getCachedImageUrl: (md5: string, extension: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_CACHED_IMAGE_URL, md5, extension),
    cacheImage: (url: string, md5: string, extension: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_CACHE_IMAGE, url, md5, extension),
    getCacheStats: () =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_CACHE_STATS),

    // 标签分类
    getTagsCategories: (siteId: number, tagNames: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_TAGS_CATEGORIES, siteId, tagNames),

    onDownloadProgress: (callback: (data: any) => void) => {
      const subscription = (_event: any, data: any) => callback(data);
      ipcRenderer.on('booru:download-progress', subscription);
      return () => ipcRenderer.removeListener('booru:download-progress', subscription);
    },
    onDownloadStatus: (callback: (data: any) => void) => {
      const subscription = (_event: any, data: any) => callback(data);
      ipcRenderer.on('booru:download-status', subscription);
      return () => ipcRenderer.removeListener('booru:download-status', subscription);
    }
  },

  // 批量下载 API
  bulkDownload: {
    createTask: (options: any) => ipcRenderer.invoke('bulk-download:create-task', options),
    getTasks: () => ipcRenderer.invoke('bulk-download:get-tasks'),
    getTask: (taskId: string) => ipcRenderer.invoke('bulk-download:get-task', taskId),
    updateTask: (taskId: string, updates: any) => ipcRenderer.invoke('bulk-download:update-task', taskId, updates),
    deleteTask: (taskId: string) => ipcRenderer.invoke('bulk-download:delete-task', taskId),
    createSession: (taskId: string) => ipcRenderer.invoke('bulk-download:create-session', taskId),
    getActiveSessions: () => ipcRenderer.invoke('bulk-download:get-active-sessions'),
    startSession: (sessionId: string) => ipcRenderer.invoke('bulk-download:start-session', sessionId),
    pauseSession: (sessionId: string) => ipcRenderer.invoke('bulk-download:pause-session', sessionId),
    cancelSession: (sessionId: string) => ipcRenderer.invoke('bulk-download:cancel-session', sessionId),
    deleteSession: (sessionId: string) => ipcRenderer.invoke('bulk-download:delete-session', sessionId),
    getSessionStats: (sessionId: string) => ipcRenderer.invoke('bulk-download:get-session-stats', sessionId),
    getRecords: (sessionId: string, status?: string, page?: number, autoFix?: boolean) => 
      ipcRenderer.invoke('bulk-download:get-records', sessionId, status, page, autoFix),
    retryAllFailed: (sessionId: string) => ipcRenderer.invoke('bulk-download:retry-all-failed', sessionId),
    retryFailedRecord: (sessionId: string, recordUrl: string) => 
      ipcRenderer.invoke('bulk-download:retry-failed-record', sessionId, recordUrl)
  },

  // 系统操作
  system: {
    selectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SELECT_FOLDER),
    openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL, url),
    showItem: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SHOW_ITEM, path),
    // 网络测试（从主进程发起，绕过CORS限制）
    testBaidu: () => ipcRenderer.invoke('network:test-baidu'),
    testGoogle: () => ipcRenderer.invoke('network:test-google'),
    // 批量下载进度监听
    onBulkDownloadRecordProgress: (callback: (data: any) => void) => {
      const subscription = (_event: any, data: any) => callback(data);
      ipcRenderer.on('bulk-download:record-progress', subscription);
      return () => ipcRenderer.removeListener('bulk-download:record-progress', subscription);
    },
    // 批量下载状态变化监听
    onBulkDownloadRecordStatus: (callback: (data: any) => void) => {
      const subscription = (_event: any, data: any) => callback(data);
      ipcRenderer.on('bulk-download:record-status', subscription);
      return () => ipcRenderer.removeListener('bulk-download:record-status', subscription);
    }
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
      // Booru API (新增)
      booru: {
        getSites: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
        addSite: (site: any) => Promise<{ success: boolean; data?: number; error?: string }>;
        updateSite: (id: number, updates: any) => Promise<{ success: boolean; error?: string }>;
        deleteSite: (id: number) => Promise<{ success: boolean; error?: string }>;
        getActiveSite: () => Promise<{ success: boolean; data?: any; error?: string }>;
        getPosts: (siteId: number, page?: number, tags?: string[], limit?: number) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        getPost: (siteId: number, postId: number) => Promise<{ success: boolean; data?: any; error?: string }>;
        searchPosts: (siteId: number, tags: string[], page?: number, limit?: number) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        getFavorites: (siteId: number, page?: number, limit?: number) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        addFavorite: (postId: number, siteId: number, syncToServer?: boolean) => Promise<{ success: boolean; data?: number; error?: string }>;
        removeFavorite: (postId: number, syncToServer?: boolean) => Promise<{ success: boolean; error?: string }>;
        addToDownload: (postId: number, siteId: number) => Promise<{ success: boolean; data?: any; error?: string }>;
        retryDownload: (postId: number, siteId: number) => Promise<{ success: boolean; data?: number; error?: string }>;
        getDownloadQueue: (status?: string) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        clearDownloadRecords: (status: 'completed' | 'failed') => Promise<{ success: boolean; data?: number; error?: string }>;
        getCachedImageUrl: (md5: string, extension: string) => Promise<{ success: boolean; data?: string; error?: string }>;
        cacheImage: (url: string, md5: string, extension: string) => Promise<{ success: boolean; data?: string; error?: string }>;
        getCacheStats: () => Promise<{ success: boolean; data?: { sizeMB: number; fileCount: number }; error?: string }>;
        getTagsCategories: (siteId: number, tagNames: string[]) => Promise<{ success: boolean; data?: Record<string, string>; error?: string }>;
        onDownloadProgress: (callback: (data: any) => void) => () => void;
        onDownloadStatus: (callback: (data: any) => void) => () => void;
      };
      bulkDownload: {
        createTask: (options: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        getTasks: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
        getTask: (taskId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        updateTask: (taskId: string, updates: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        deleteTask: (taskId: string) => Promise<{ success: boolean; error?: string }>;
        createSession: (taskId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        getActiveSessions: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
        startSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
        pauseSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
        cancelSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
        deleteSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
        getSessionStats: (sessionId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        getRecords: (sessionId: string, status?: string, page?: number, autoFix?: boolean) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        retryAllFailed: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
        retryFailedRecord: (sessionId: string, recordUrl: string) => Promise<{ success: boolean; error?: string }>;
      };
      system: {
        selectFolder: () => Promise<{ success: boolean; data?: string; error?: string }>;
        openExternal: (url: string) => Promise<void>;
        showItem: (path: string) => Promise<{ success: boolean; error?: string }>;
        testBaidu: () => Promise<{ success: boolean; status?: number; error?: string }>;
        testGoogle: () => Promise<{ success: boolean; status?: number; error?: string }>;
        onBulkDownloadRecordProgress: (callback: (data: any) => void) => () => void;
        onBulkDownloadRecordStatus: (callback: (data: any) => void) => () => void;
      };
      gallery: {
        getRecentImages: (count?: number) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        getGalleries: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
        getGallery: (id: number) => Promise<{ success: boolean; data?: any; error?: string }>;
        createGallery: (galleryData: any) => Promise<{ success: boolean; data?: number; error?: string }>;
        updateGallery: (id: number, updates: any) => Promise<{ success: boolean; error?: string }>;
        deleteGallery: (id: number) => Promise<{ success: boolean; error?: string }>;
        setGalleryCover: (id: number, coverImageId: number) => Promise<{ success: boolean; error?: string }>;
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