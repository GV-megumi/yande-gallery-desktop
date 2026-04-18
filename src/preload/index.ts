import { contextBridge, ipcRenderer } from 'electron';
import { type AppShellPagePreference, type BlacklistedTagsPagePreference, type BooruAppearancePreference, type ConfigSaveInput, type FavoriteTagsPagePreference, type GalleryPagePreferencesBySubTab, type RendererSafeAppConfig } from '../main/services/config.js';
import type { BooruForumPost, BooruForumTopic, BooruSite, BooruSiteRecord, BooruUserProfile, BooruWiki, ConfigChangedSummary } from '../shared/types.js';
import { IPC_CHANNELS } from '../main/ipc/channels.js';
import { createWindowApi } from './shared/createWindowApi.js';
import { createBooruApi } from './shared/createBooruApi.js';
import { createBooruPreferencesApi } from './shared/createBooruPreferencesApi.js';
import { createSystemApi } from './shared/createSystemApi.js';

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
      ipcRenderer.invoke(IPC_CHANNELS.GALLERY_GET_RECENT_IMAGES, count),
    getGalleries: () => ipcRenderer.invoke(IPC_CHANNELS.GALLERY_GET_GALLERIES),
    getGallery: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.GALLERY_GET_GALLERY, id),
    createGallery: (galleryData: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.GALLERY_CREATE_GALLERY, galleryData),
    updateGallery: (id: number, updates: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.GALLERY_UPDATE_GALLERY, id, updates),
    deleteGallery: (id: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.GALLERY_DELETE_GALLERY, id),
    setGalleryCover: (id: number, coverImageId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.GALLERY_SET_GALLERY_COVER, id, coverImageId),
    getImagesByFolder: (folderPath: string, page?: number, pageSize?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.GALLERY_GET_IMAGES_BY_FOLDER, folderPath, page, pageSize),
    scanAndImportFolder: (folderPath: string, extensions?: string[], recursive?: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.GALLERY_SCAN_AND_IMPORT_FOLDER, folderPath, extensions, recursive),
    syncGalleryFolder: (id: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.GALLERY_SYNC_GALLERY_FOLDER, id),
    scanSubfolders: (rootPath: string, extensions?: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.GALLERY_SCAN_SUBFOLDERS, rootPath, extensions),
    reportInvalidImage: (imageId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.GALLERY_REPORT_INVALID_IMAGE, imageId),
    getInvalidImages: (page?: number, pageSize?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.GALLERY_GET_INVALID_IMAGES, page, pageSize),
    getInvalidImageCount: () =>
      ipcRenderer.invoke(IPC_CHANNELS.GALLERY_GET_INVALID_IMAGE_COUNT),
    deleteInvalidImage: (id: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.GALLERY_DELETE_INVALID_IMAGE, id),
    clearInvalidImages: () =>
      ipcRenderer.invoke(IPC_CHANNELS.GALLERY_CLEAR_INVALID_IMAGES),
  },

  // 配置操作
  config: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET),
    save: (newConfig: ConfigSaveInput) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SAVE, newConfig),
    updateGalleryFolders: (folders: any[]) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_UPDATE_GALLERY_FOLDERS, folders),
    reload: () => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_RELOAD),
    // 监听配置变更摘要事件（事件驱动，替代轮询）
    // 主进程只广播摘要 { version, sections }，避免事件中携带完整去敏配置。
    // 订阅端在收到摘要后应调用 ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET) 主动拉取最新 safe config。
    onConfigChanged: (callback: (config: RendererSafeAppConfig, summary: ConfigChangedSummary) => void) => {
      const subscription = async (_event: any, summary: ConfigChangedSummary) => {
        try {
          const response = await ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET);
          if (response?.success && response.data) {
            callback(response.data as RendererSafeAppConfig, summary);
          }
        } catch (error) {
          console.error('[Preload] 重新拉取 safe config 失败:', error);
        }
      };
      ipcRenderer.on(IPC_CHANNELS.CONFIG_CHANGED, subscription);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CONFIG_CHANGED, subscription);
    }
  },

  // booruPreferences 域通过工厂统一定义，主/子窗口 preload 共用
  booruPreferences: createBooruPreferencesApi(),

  pagePreferences: {
    favoriteTags: {
      get: () => ipcRenderer.invoke(IPC_CHANNELS.PAGE_PREFERENCES_GET_FAVORITE_TAGS),
      save: (preferences: FavoriteTagsPagePreference) =>
        ipcRenderer.invoke(IPC_CHANNELS.PAGE_PREFERENCES_SAVE_FAVORITE_TAGS, preferences),
    },
    blacklistedTags: {
      get: () => ipcRenderer.invoke(IPC_CHANNELS.PAGE_PREFERENCES_GET_BLACKLISTED_TAGS),
      save: (preferences: BlacklistedTagsPagePreference) =>
        ipcRenderer.invoke(IPC_CHANNELS.PAGE_PREFERENCES_SAVE_BLACKLISTED_TAGS, preferences),
    },
    gallery: {
      get: () => ipcRenderer.invoke(IPC_CHANNELS.PAGE_PREFERENCES_GET_GALLERY),
      save: (preferences: GalleryPagePreferencesBySubTab) =>
        ipcRenderer.invoke(IPC_CHANNELS.PAGE_PREFERENCES_SAVE_GALLERY, preferences),
    },
    appShell: {
      get: () => ipcRenderer.invoke(IPC_CHANNELS.PAGE_PREFERENCES_GET_APP_SHELL),
      save: (preferences: AppShellPagePreference) =>
        ipcRenderer.invoke(IPC_CHANNELS.PAGE_PREFERENCES_SAVE_APP_SHELL, preferences),
    },
  },

  // 图片操作
  image: {
    scanFolder: (folderPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.IMAGE_SCAN_FOLDER, folderPath),
    generateThumbnail: (imagePath: string, force?: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.IMAGE_GENERATE_THUMBNAIL, imagePath, force),
    getThumbnail: (imagePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.IMAGE_GET_THUMBNAIL, imagePath),
    deleteThumbnail: (imagePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.IMAGE_DELETE_THUMBNAIL, imagePath),
    deleteImage: (imageId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.IMAGE_DELETE, imageId),
  },

  // booru 域通过工厂统一定义，主/子窗口 preload 共用
  booru: createBooruApi(),


  // 批量下载 API
  bulkDownload: {
    createTask: (options: any) => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_CREATE_TASK, options),
    getTasks: () => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_GET_TASKS),
    getTask: (taskId: string) => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_GET_TASK, taskId),
    updateTask: (taskId: string, updates: any) => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_UPDATE_TASK, taskId, updates),
    deleteTask: (taskId: string) => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_DELETE_TASK, taskId),
    createSession: (taskId: string) => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_CREATE_SESSION, taskId),
    getActiveSessions: () => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_GET_ACTIVE_SESSIONS),
    startSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_START_SESSION, sessionId),
    pauseSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_PAUSE_SESSION, sessionId),
    cancelSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_CANCEL_SESSION, sessionId),
    deleteSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_DELETE_SESSION, sessionId),
    getSessionStats: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_GET_SESSION_STATS, sessionId),
    getRecords: (sessionId: string, status?: string, page?: number, autoFix?: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_GET_RECORDS, sessionId, status, page, autoFix),
    retryAllFailed: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_RETRY_ALL_FAILED, sessionId),
    retryFailedRecord: (sessionId: string, recordUrl: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_RETRY_FAILED_RECORD, sessionId, recordUrl),
    resumeRunningSessions: () =>
      ipcRenderer.invoke(IPC_CHANNELS.BULK_DOWNLOAD_RESUME_RUNNING_SESSIONS)
  },

  // window 域（子窗口操作）通过工厂统一定义，主/子窗口 preload 共用
  window: createWindowApi(),

  // system 域通过工厂统一定义，主/子窗口 preload 共用
  system: createSystemApi(),

});

console.log('[Preload] electronAPI exposed successfully');

// TypeScript类型声明
//
// 注意：该 Window.electronAPI 类型声明包含**主窗口** preload 暴露的全部域（db / image /
// booru / booruPreferences / pagePreferences / bulkDownload / window / system / gallery /
// config 等共计十余个域）。
//
// 轻量子窗口（tag-search / artist / character，由 src/main/window.ts 按 hash 前缀分流到
// build/preload/subwindow.js）的 preload 只实现 4 个域：
//   window / booru / booruPreferences / system
// （定义见 src/preload/subwindow-index.ts，实现复用 src/preload/shared/ 下的工厂）。
//
// 在子窗口上下文中访问 db / gallery / config / image / bulkDownload / pagePreferences 等
// 其他域会在 TS 层通过编译，但运行时为 undefined（静默错误，调用 .xxx() 才会抛 TypeError）。
//
// 子窗口页面（BooruTagSearchPage / BooruArtistPage / BooruCharacterPage 及其依赖的
// hooks / components）开发时应避免引用这些域。
// 如未来需要强类型隔离，可提取 SubWindowElectronAPI 接口供子窗口页面使用，
// 并在 subwindow-index.ts 中做对应的 declare module 声明。当前作为已知设计选择保留。
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
        deleteImage: (imageId: number) => Promise<{ success: boolean; error?: string }>;
      };
      // Booru API (新增)
      booru: {
        getSites: () => Promise<{ success: boolean; data?: BooruSite[]; error?: string }>;
        addSite: (site: Omit<BooruSiteRecord, 'id' | 'createdAt' | 'updatedAt' | 'authenticated'>) => Promise<{ success: boolean; data?: number; error?: string }>;
        updateSite: (id: number, updates: Partial<Omit<BooruSiteRecord, 'id' | 'createdAt' | 'updatedAt' | 'authenticated'>>) => Promise<{ success: boolean; error?: string }>;
        deleteSite: (id: number) => Promise<{ success: boolean; error?: string }>;
        getActiveSite: () => Promise<{ success: boolean; data?: BooruSite | null; error?: string }>;
        getPosts: (siteId: number, page?: number, tags?: string[], limit?: number) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        getPost: (siteId: number, postId: number) => Promise<{ success: boolean; data?: any; error?: string }>;
        searchPosts: (siteId: number, tags: string[], page?: number, limit?: number, fetchTagCategories?: boolean) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        getFavorites: (siteId: number, page?: number, limit?: number) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        addFavorite: (postId: number, siteId: number, syncToServer?: boolean) => Promise<{ success: boolean; data?: number; error?: string }>;
        onFavoritesRepairDone: (callback: (data: { siteId: number; repairedCount: number; deletedCount: number; deletedIds: number[] }) => void) => () => void;
        removeFavorite: (postId: number, syncToServer?: boolean) => Promise<{ success: boolean; error?: string }>;
        addToDownload: (postId: number, siteId: number) => Promise<{ success: boolean; data?: any; error?: string }>;
        retryDownload: (postId: number, siteId: number) => Promise<{ success: boolean; error?: string }>;
        getDownloadQueue: (status?: string) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        clearDownloadRecords: (status: 'completed' | 'failed') => Promise<{ success: boolean; data?: number; error?: string }>;
        pauseAllDownloads: () => Promise<{ success: boolean; error?: string }>;
        resumeAllDownloads: () => Promise<{ success: boolean; error?: string }>;
        resumePendingDownloads: () => Promise<{ success: boolean; data?: { resumed: number; total: number }; error?: string }>;
        getQueueStatus: () => Promise<{ success: boolean; data?: { isPaused: boolean; activeCount: number; maxConcurrent: number }; error?: string }>;
        pauseDownload: (queueId: number) => Promise<{ success: boolean; error?: string }>;
        resumeDownload: (queueId: number) => Promise<{ success: boolean; error?: string }>;
        cancelDownload: (queueId: number) => Promise<{ success: boolean; error?: string }>;
        getCachedImageUrl: (md5: string, extension: string) => Promise<{ success: boolean; data?: string; error?: string }>;
        cacheImage: (url: string, md5: string, extension: string) => Promise<{ success: boolean; data?: string; error?: string }>;
        getCacheStats: () => Promise<{ success: boolean; data?: { sizeMB: number; fileCount: number }; error?: string }>;
        clearCache: () => Promise<{ success: boolean; data?: { deletedCount: number; freedMB: number }; error?: string }>;
        getTagCacheStats: () => Promise<{ success: boolean; data?: { totalCount: number; expiredCount: number; oldestDate: string | null }; error?: string }>;
        cleanExpiredTags: (expireDays?: number) => Promise<{ success: boolean; data?: { cleaned: number }; error?: string }>;
        getTagsCategories: (siteId: number, tagNames: string[]) => Promise<{ success: boolean; data?: Record<string, string>; error?: string }>;
        autocompleteTags: (siteId: number, query: string, limit?: number) => Promise<{ success: boolean; data?: Array<{ name: string; count: number; type: number }>; error?: string }>;
        getArtist: (siteId: number, name: string) => Promise<{ success: boolean; data?: { id: number; name: string; aliases: string[]; urls: string[]; group_name?: string; is_banned?: boolean } | null; error?: string }>;
        getTagRelationships: (siteId: number, name: string) => Promise<{ success: boolean; data?: { aliases: Array<{ id: number; antecedent_name: string; consequent_name: string; status?: string; created_at?: string }>; implications: Array<{ id: number; antecedent_name: string; consequent_name: string; status?: string; created_at?: string }> }; error?: string }>;
        reportPost: (siteId: number, postId: number, reason: string) => Promise<{ success: boolean; error?: string }>;
        getImageMetadata: (request: { localPath?: string; fileUrl?: string; md5?: string; fileExt?: string }) => Promise<{ success: boolean; data?: { format?: string; width?: number; height?: number; space?: string; density?: number; hasAlpha?: boolean; orientation?: number; channels?: number; hasExif: boolean; pathSource: 'local' | 'cache' }; error?: string }>;
        getWiki: (siteId: number, title: string) => Promise<{ success: boolean; data?: BooruWiki | null; error?: string }>;
        getForumTopics: (siteId: number, page?: number, limit?: number) => Promise<{ success: boolean; data?: BooruForumTopic[]; error?: string }>;
        getForumPosts: (siteId: number, topicId: number, page?: number, limit?: number) => Promise<{ success: boolean; data?: BooruForumPost[]; error?: string }>;
        getProfile: (siteId: number) => Promise<{ success: boolean; data?: BooruUserProfile | null; error?: string }>;
        getUserProfile: (siteId: number, params: { userId?: number; username?: string }) => Promise<{ success: boolean; data?: BooruUserProfile | null; error?: string }>;
        addFavoriteTag: (siteId: number | null, tagName: string, options?: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        addFavoriteTagsBatch: (tagString: string, siteId: number | null, labels?: string) => Promise<{ success: boolean; data?: { added: number; skipped: number }; error?: string }>;
        removeFavoriteTag: (id: number) => Promise<{ success: boolean; error?: string }>;
        removeFavoriteTagByName: (siteId: number | null, tagName: string) => Promise<{ success: boolean; error?: string }>;
        getFavoriteTags: (params?: import('../shared/types').ListQueryParams) => Promise<{ success: boolean; data?: import('../shared/types').PaginatedResult<import('../shared/types').FavoriteTag>; error?: string }>;
        getFavoriteTagsWithDownloadState: (params?: import('../shared/types').ListQueryParams) => Promise<{ success: boolean; data?: import('../shared/types').PaginatedResult<import('../shared/types').FavoriteTagWithDownloadState>; error?: string }>;
        exportFavoriteTags: (siteId?: number | null) => Promise<{ success: boolean; data?: { count: number; filePath: string }; error?: string }>;
        importFavoriteTagsPickFile: () => Promise<{ success: boolean; data?: import('../shared/types').FavoriteTagsImportPickFileResult; error?: string }>;
        importFavoriteTagsCommit: (payload: { records: import('../shared/types').FavoriteTagImportRecord[]; labelGroups?: import('../shared/types').FavoriteTagLabelImportRecord[]; fallbackSiteId: number | null }) => Promise<{ success: boolean; data?: { imported: number; skipped: number; labelsImported: number; labelsSkipped: number }; error?: string }>;
        updateFavoriteTag: (id: number, updates: any) => Promise<{ success: boolean; error?: string }>;
        isFavoriteTag: (siteId: number | null, tagName: string) => Promise<{ success: boolean; data?: boolean; error?: string }>;
        getFavoriteTagDownloadBinding: (favoriteTagId: number) => Promise<{ success: boolean; data?: any; error?: string }>;
        getFavoriteTagDownloadHistory: (favoriteTagId: number) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        getGallerySourceFavoriteTags: (galleryId: number) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        upsertFavoriteTagDownloadBinding: (input: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        removeFavoriteTagDownloadBinding: (favoriteTagId: number) => Promise<{ success: boolean; error?: string }>;
        startFavoriteTagBulkDownload: (favoriteTagId: number) => Promise<{ success: boolean; data?: { taskId: string; sessionId: string; deduplicated?: boolean }; error?: string }>;
        getFavoriteTagLabels: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
        addFavoriteTagLabel: (name: string, color?: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        removeFavoriteTagLabel: (id: number) => Promise<{ success: boolean; error?: string }>;
        addSearchHistory: (siteId: number, query: string, resultCount?: number) => Promise<{ success: boolean; error?: string }>;
        getSearchHistory: (siteId?: number, limit?: number) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        clearSearchHistory: (siteId?: number) => Promise<{ success: boolean; error?: string }>;
        addBlacklistedTag: (tagName: string, siteId?: number | null, reason?: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        addBlacklistedTags: (tagString: string, siteId?: number | null, reason?: string) => Promise<{ success: boolean; data?: { added: number; skipped: number }; error?: string }>;
        getBlacklistedTags: (params?: import('../shared/types').ListQueryParams) => Promise<{ success: boolean; data?: import('../shared/types').PaginatedResult<import('../shared/types').BlacklistedTag>; error?: string }>;
        getActiveBlacklistTagNames: (siteId?: number | null) => Promise<{ success: boolean; data?: string[]; error?: string }>;
        toggleBlacklistedTag: (id: number) => Promise<{ success: boolean; data?: any; error?: string }>;
        updateBlacklistedTag: (id: number, updates: any) => Promise<{ success: boolean; error?: string }>;
        removeBlacklistedTag: (id: number) => Promise<{ success: boolean; error?: string }>;
        // 认证
        login: (siteId: number, username: string, password: string) => Promise<{ success: boolean; data?: { username: string; authenticated: boolean }; error?: string }>;
        logout: (siteId: number) => Promise<{ success: boolean; error?: string }>;
        testAuth: (siteId: number) => Promise<{ success: boolean; data?: { authenticated: boolean; username?: string; reason?: string }; error?: string }>;
        // 投票/服务端收藏
        votePost: (siteId: number, postId: number, score: 1 | 0 | -1) => Promise<{ success: boolean; error?: string }>;
        serverFavorite: (siteId: number, postId: number) => Promise<{ success: boolean; error?: string }>;
        serverUnfavorite: (siteId: number, postId: number) => Promise<{ success: boolean; error?: string }>;
        getServerFavorites: (siteId: number, page?: number, limit?: number) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        getFavoriteUsers: (siteId: number, postId: number) => Promise<{ success: boolean; data?: string[]; error?: string }>;
        // 热门图片
        getPopularRecent: (siteId: number, period?: '1day' | '1week' | '1month') => Promise<{ success: boolean; data?: any[]; error?: string }>;
        getPopularByDay: (siteId: number, date: string) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        getPopularByWeek: (siteId: number, date: string) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        getPopularByMonth: (siteId: number, date: string) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        // 评论
        getComments: (siteId: number, postId: number) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        createComment: (siteId: number, postId: number, body: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        // Pool
        getPools: (siteId: number, page?: number) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        getPool: (siteId: number, poolId: number, page?: number) => Promise<{ success: boolean; data?: any; error?: string }>;
        searchPools: (siteId: number, query: string, page?: number) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        // 标签导入/导出
        exportBlacklistedTags: (siteId?: number | null) => Promise<{ success: boolean; data?: { count: number; path: string }; error?: string }>;
        importBlacklistedTagsPickFile: () => Promise<{ success: boolean; data?: import('../shared/types').ImportPickFileResult<import('../shared/types').BlacklistedTagImportRecord>; error?: string }>;
        importBlacklistedTagsCommit: (payload: { records: import('../shared/types').BlacklistedTagImportRecord[]; fallbackSiteId: number | null }) => Promise<{ success: boolean; data?: { imported: number; skipped: number }; error?: string }>;
        onDownloadProgress: (callback: (data: any) => void) => () => void;
        onDownloadStatus: (callback: (data: any) => void) => () => void;
        onQueueStatus: (callback: (data: any) => void) => () => void;
      };
      bulkDownload: {
        createTask: (options: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        getTasks: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
        getTask: (taskId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        updateTask: (taskId: string, updates: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        deleteTask: (taskId: string) => Promise<{ success: boolean; error?: string }>;
        createSession: (taskId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        getActiveSessions: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
        startSession: (sessionId: string) => Promise<{ success: boolean; queued?: boolean; error?: string }>;
        pauseSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
        cancelSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
        deleteSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
        getSessionStats: (sessionId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        getRecords: (sessionId: string, status?: string, page?: number, autoFix?: boolean) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        retryAllFailed: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
        retryFailedRecord: (sessionId: string, recordUrl: string) => Promise<{ success: boolean; error?: string }>;
        resumeRunningSessions: () => Promise<{ success: boolean; data?: { resumed: number }; error?: string }>;
      };
      window: {
        openTagSearch: (tag: string, siteId?: number | null) => Promise<{ success: boolean }>;
        openArtist: (name: string, siteId?: number | null) => Promise<{ success: boolean }>;
        openCharacter: (name: string, siteId?: number | null) => Promise<{ success: boolean }>;
        openSecondaryMenu: (
          section: string,
          key: string,
          tab?: string,
          extra?: Record<string, string | number>,
        ) => Promise<{ success: boolean }>;
      };
      system: {
        selectFolder: () => Promise<{ success: boolean; data?: string; error?: string }>;
        openExternal: (url: string) => Promise<void>;
        showItem: (path: string) => Promise<{ success: boolean; error?: string }>;
        exportBackup: () => Promise<{ success: boolean; data?: { path: string; summary: Array<{ table: string; count: number }> }; error?: string }>;
        importBackup: (mode?: 'merge' | 'replace') => Promise<{ success: boolean; data?: { path: string; mode: 'merge' | 'replace'; restoredTables: Array<{ table: string; count: number }> }; error?: string }>;
        testBaidu: () => Promise<{ success: boolean; status?: number; error?: string }>;
        testGoogle: () => Promise<{ success: boolean; status?: number; error?: string }>;
        checkForUpdate: () => Promise<{ success: boolean; data?: import('../shared/types').UpdateCheckResult; error?: string }>;
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
        syncGalleryFolder: (id: number) => Promise<{ success: boolean; data?: { imported: number; skipped: number; imageCount: number; lastScannedAt: string }; error?: string }>;
        scanSubfolders: (rootPath: string, extensions?: string[]) => Promise<{ success: boolean; data?: { created: number; skipped: number }; error?: string }>;
        reportInvalidImage: (imageId: number) => Promise<{ success: boolean; error?: string }>;
        getInvalidImages: (page?: number, pageSize?: number) => Promise<{ success: boolean; data?: any[]; total?: number; error?: string }>;
        getInvalidImageCount: () => Promise<{ success: boolean; data?: number; error?: string }>;
        deleteInvalidImage: (id: number) => Promise<{ success: boolean; error?: string }>;
        clearInvalidImages: () => Promise<{ success: boolean; data?: { deleted: number }; error?: string }>;
      };
      config: {
        get: () => Promise<{ success: boolean; data?: RendererSafeAppConfig; error?: string }>;
        save: (newConfig: ConfigSaveInput) => Promise<{ success: boolean; error?: string }>;
        updateGalleryFolders: (folders: any[]) => Promise<{ success: boolean; error?: string }>;
        reload: () => Promise<{ success: boolean; data?: RendererSafeAppConfig; error?: string }>;
        onConfigChanged: (callback: (config: RendererSafeAppConfig, summary: ConfigChangedSummary) => void) => () => void;
      };
      booruPreferences: {
        appearance: {
          get: () => Promise<{ success: boolean; data?: BooruAppearancePreference; error?: string }>;
          onChanged: (callback: (appearance: BooruAppearancePreference) => void) => () => void;
        };
      };
      pagePreferences: {
        favoriteTags: {
          get: () => Promise<{ success: boolean; data?: FavoriteTagsPagePreference; error?: string }>;
          save: (preferences: FavoriteTagsPagePreference) => Promise<{ success: boolean; error?: string }>;
        };
        blacklistedTags: {
          get: () => Promise<{ success: boolean; data?: BlacklistedTagsPagePreference; error?: string }>;
          save: (preferences: BlacklistedTagsPagePreference) => Promise<{ success: boolean; error?: string }>;
        };
        gallery: {
          get: () => Promise<{ success: boolean; data?: GalleryPagePreferencesBySubTab; error?: string }>;
          save: (preferences: GalleryPagePreferencesBySubTab) => Promise<{ success: boolean; error?: string }>;
        };
        appShell: {
          get: () => Promise<{ success: boolean; data?: AppShellPagePreference; error?: string }>;
          save: (preferences: AppShellPagePreference) => Promise<{ success: boolean; error?: string }>;
        };
      };
    };
  }
}
