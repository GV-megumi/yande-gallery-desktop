import { contextBridge, ipcRenderer } from 'electron';
import { type AppShellPagePreference, type BlacklistedTagsPagePreference, type BooruAppearancePreference, type ConfigSaveInput, type FavoriteTagsPagePreference, type GalleryPagePreferencesBySubTab, type RendererSafeAppConfig } from '../main/services/config.js';
import type { BooruForumPost, BooruForumTopic, BooruSite, BooruSiteRecord, BooruUserProfile, BooruWiki, ConfigChangedSummary } from '../shared/types.js';
import { IPC_CHANNELS } from '../main/ipc/channels.js';

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

  booruPreferences: {
    appearance: {
      get: () => ipcRenderer.invoke(IPC_CHANNELS.BOORU_PREFERENCES_GET_APPEARANCE),
      // 订阅 booru 外观偏好变更：接收摘要事件后，直接通过
      // BOORU_PREFERENCES_GET_APPEARANCE 拉取最新 appearance DTO，不再依赖事件中的完整配置。
      // 注：忽略 summary.version —— 当前唯一消费者只是替换状态，不会累积；
      // 若未来有订阅者需要识别过期事件，应改为显式透传 summary。
      onChanged: (callback: (appearance: BooruAppearancePreference) => void) => {
        const subscription = async (_event: any, _summary: ConfigChangedSummary) => {
          try {
            const response = await ipcRenderer.invoke(IPC_CHANNELS.BOORU_PREFERENCES_GET_APPEARANCE);
            if (response?.success && response.data) {
              callback(response.data as BooruAppearancePreference);
            }
          } catch (error) {
            console.error('[Preload] 重新拉取 booru appearance 偏好失败:', error);
          }
        };
        ipcRenderer.on(IPC_CHANNELS.CONFIG_CHANGED, subscription);
        return () => ipcRenderer.removeListener(IPC_CHANNELS.CONFIG_CHANGED, subscription);
      },
    },
  },

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

  // Booru API (新增)
  booru: {
    // 站点管理
    getSites: () => ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_SITES) as Promise<{ success: boolean; data?: BooruSite[]; error?: string }>,
    addSite: (site: Omit<BooruSiteRecord, 'id' | 'createdAt' | 'updatedAt' | 'authenticated'>) => ipcRenderer.invoke(IPC_CHANNELS.BOORU_ADD_SITE, site),
    updateSite: (id: number, updates: Partial<Omit<BooruSiteRecord, 'id' | 'createdAt' | 'updatedAt' | 'authenticated'>>) => ipcRenderer.invoke(IPC_CHANNELS.BOORU_UPDATE_SITE, id, updates),
    deleteSite: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.BOORU_DELETE_SITE, id),
    getActiveSite: () => ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_ACTIVE_SITE) as Promise<{ success: boolean; data?: BooruSite | null; error?: string }>,

    // 图片
    getPosts: (siteId: number, page: number = 1, tags?: string[], limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_POSTS, siteId, page, tags, limit),
    getPost: (siteId: number, postId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_POST, siteId, postId),
    searchPosts: (siteId: number, tags: string[], page: number = 1, limit?: number, fetchTagCategories: boolean = true) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_SEARCH_POSTS, siteId, tags, page, limit, fetchTagCategories),

    // 收藏
    getFavorites: (siteId: number, page: number = 1, limit: number = 20, groupId?: number | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_FAVORITES, siteId, page, limit, groupId),
    addFavorite: (postId: number, siteId: number, syncToServer: boolean = false) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_ADD_FAVORITE, postId, siteId, syncToServer),
    removeFavorite: (postId: number, syncToServer: boolean = false) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_REMOVE_FAVORITE, postId, syncToServer),
    // 监听收藏后台修复完成事件
    onFavoritesRepairDone: (callback: (data: { siteId: number; repairedCount: number; deletedCount: number; deletedIds: number[] }) => void) => {
      const subscription = (_event: any, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.BOORU_FAVORITES_REPAIR_DONE, subscription);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BOORU_FAVORITES_REPAIR_DONE, subscription);
    },

    // 下载
    addToDownload: (postId: number, siteId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_ADD_TO_DOWNLOAD, postId, siteId),
    retryDownload: (postId: number, siteId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_RETRY_DOWNLOAD, postId, siteId),
    getDownloadQueue: (status?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_DOWNLOAD_QUEUE, status),
    clearDownloadRecords: (status: 'completed' | 'failed') =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_CLEAR_DOWNLOAD_RECORDS, status),
    pauseAllDownloads: () =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_PAUSE_ALL_DOWNLOADS),
    resumeAllDownloads: () =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_RESUME_ALL_DOWNLOADS),
    resumePendingDownloads: () =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_RESUME_PENDING_DOWNLOADS),
    getQueueStatus: () =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_QUEUE_STATUS),
    pauseDownload: (queueId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_PAUSE_DOWNLOAD, queueId),
    resumeDownload: (queueId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_RESUME_DOWNLOAD, queueId),

    // 图片缓存
    getCachedImageUrl: (md5: string, extension: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_CACHED_IMAGE_URL, md5, extension),
    cacheImage: (url: string, md5: string, extension: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_CACHE_IMAGE, url, md5, extension),
    getCacheStats: () =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_CACHE_STATS),
    clearCache: () =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_CLEAR_CACHE),

    // 标签缓存管理
    getTagCacheStats: () =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_TAG_CACHE_STATS),
    cleanExpiredTags: (expireDays?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_CLEAN_EXPIRED_TAGS, expireDays),

    // 标签分类
    getTagsCategories: (siteId: number, tagNames: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_TAGS_CATEGORIES, siteId, tagNames),

    // 标签自动补全
    autocompleteTags: (siteId: number, query: string, limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_AUTOCOMPLETE_TAGS, siteId, query, limit),

    // 艺术家
    getArtist: (siteId: number, name: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_ARTIST, siteId, name),
    getTagRelationships: (siteId: number, name: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_TAG_RELATIONSHIPS, siteId, name),
    reportPost: (siteId: number, postId: number, reason: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_REPORT_POST, siteId, postId, reason),
    getImageMetadata: (request: { localPath?: string; fileUrl?: string; md5?: string; fileExt?: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_IMAGE_METADATA, request),

    // Wiki
    getWiki: (siteId: number, title: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_WIKI, siteId, title),

    // Forum
    getForumTopics: (siteId: number, page?: number, limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_FORUM_TOPICS, siteId, page, limit),
    getForumPosts: (siteId: number, topicId: number, page?: number, limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_FORUM_POSTS, siteId, topicId, page, limit),

    // User
    getProfile: (siteId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_PROFILE, siteId),
    getUserProfile: (siteId: number, params: { userId?: number; username?: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_USER_PROFILE, siteId, params),

    // 收藏标签管理
    addFavoriteTag: (siteId: number | null, tagName: string, options?: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_ADD_FAVORITE_TAG, siteId, tagName, options),
    addFavoriteTagsBatch: (tagString: string, siteId: number | null, labels?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_ADD_FAVORITE_TAGS_BATCH, tagString, siteId, labels),
    removeFavoriteTag: (id: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_REMOVE_FAVORITE_TAG, id),
    removeFavoriteTagByName: (siteId: number | null, tagName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_REMOVE_FAVORITE_TAG_BY_NAME, siteId, tagName),
    getFavoriteTags: (params: import('../shared/types').ListQueryParams = {}) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_FAVORITE_TAGS, params),
    getFavoriteTagsWithDownloadState: (params: import('../shared/types').ListQueryParams = {}) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_FAVORITE_TAGS_WITH_DOWNLOAD_STATE, params),
    updateFavoriteTag: (id: number, updates: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_UPDATE_FAVORITE_TAG, id, updates),
    isFavoriteTag: (siteId: number | null, tagName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_IS_FAVORITE_TAG, siteId, tagName),
    getFavoriteTagDownloadBinding: (favoriteTagId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_FAVORITE_TAG_DOWNLOAD_BINDING, favoriteTagId),
    getFavoriteTagDownloadHistory: (favoriteTagId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_FAVORITE_TAG_DOWNLOAD_HISTORY, favoriteTagId),
    getGallerySourceFavoriteTags: (galleryId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_GALLERY_SOURCE_FAVORITE_TAGS, galleryId),
    upsertFavoriteTagDownloadBinding: (input: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_UPSERT_FAVORITE_TAG_DOWNLOAD_BINDING, input),
    removeFavoriteTagDownloadBinding: (favoriteTagId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_REMOVE_FAVORITE_TAG_DOWNLOAD_BINDING, favoriteTagId),
    startFavoriteTagBulkDownload: (favoriteTagId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_START_FAVORITE_TAG_BULK_DOWNLOAD, favoriteTagId),

    // 收藏标签分组
    getFavoriteTagLabels: () =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_FAVORITE_TAG_LABELS),
    addFavoriteTagLabel: (name: string, color?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_ADD_FAVORITE_TAG_LABEL, name, color),
    removeFavoriteTagLabel: (id: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_REMOVE_FAVORITE_TAG_LABEL, id),

    // 搜索历史
    addSearchHistory: (siteId: number, query: string, resultCount?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_ADD_SEARCH_HISTORY, siteId, query, resultCount),
    getSearchHistory: (siteId?: number, limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_SEARCH_HISTORY, siteId, limit),
    clearSearchHistory: (siteId?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_CLEAR_SEARCH_HISTORY, siteId),

    // 黑名单标签管理
    addBlacklistedTag: (tagName: string, siteId?: number | null, reason?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_ADD_BLACKLISTED_TAG, tagName, siteId, reason),
    addBlacklistedTags: (tagString: string, siteId?: number | null, reason?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_ADD_BLACKLISTED_TAGS, tagString, siteId, reason),
    getBlacklistedTags: (params: import('../shared/types').ListQueryParams = {}) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_BLACKLISTED_TAGS, params),
    getActiveBlacklistTagNames: (siteId?: number | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_ACTIVE_BLACKLIST_TAG_NAMES, siteId),
    toggleBlacklistedTag: (id: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_TOGGLE_BLACKLISTED_TAG, id),
    updateBlacklistedTag: (id: number, updates: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_UPDATE_BLACKLISTED_TAG, id, updates),
    removeBlacklistedTag: (id: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_REMOVE_BLACKLISTED_TAG, id),

    // 认证
    login: (siteId: number, username: string, password: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_LOGIN, siteId, username, password),
    logout: (siteId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_LOGOUT, siteId),
    testAuth: (siteId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_TEST_AUTH, siteId),

    // 投票/服务端收藏
    votePost: (siteId: number, postId: number, score: 1 | 0 | -1) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_VOTE_POST, siteId, postId, score),
    serverFavorite: (siteId: number, postId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_SERVER_FAVORITE, siteId, postId),
    serverUnfavorite: (siteId: number, postId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_SERVER_UNFAVORITE, siteId, postId),
    getServerFavorites: (siteId: number, page?: number, limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_SERVER_FAVORITES, siteId, page, limit),
    getFavoriteUsers: (siteId: number, postId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_FAVORITE_USERS, siteId, postId),

    // 热门图片
    getPopularRecent: (siteId: number, period?: '1day' | '1week' | '1month') =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_POPULAR_RECENT, siteId, period),
    getPopularByDay: (siteId: number, date: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_POPULAR_BY_DAY, siteId, date),
    getPopularByWeek: (siteId: number, date: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_POPULAR_BY_WEEK, siteId, date),
    getPopularByMonth: (siteId: number, date: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_POPULAR_BY_MONTH, siteId, date),

    // 评论
    getComments: (siteId: number, postId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_COMMENTS, siteId, postId),
    createComment: (siteId: number, postId: number, body: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_CREATE_COMMENT, siteId, postId, body),

    // Pool
    getPools: (siteId: number, page?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_POOLS, siteId, page),
    getPool: (siteId: number, poolId: number, page?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_POOL, siteId, poolId, page),
    searchPools: (siteId: number, query: string, page?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_SEARCH_POOLS, siteId, query, page),

    // 标签导入/导出
    exportFavoriteTags: (siteId?: number | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_EXPORT_FAVORITE_TAGS, siteId),
    importFavoriteTagsPickFile: () =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_IMPORT_FAVORITE_TAGS_PICK_FILE),
    importFavoriteTagsCommit: (payload: { records: import('../shared/types').FavoriteTagImportRecord[]; labelGroups?: import('../shared/types').FavoriteTagLabelImportRecord[]; fallbackSiteId: number | null }) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_IMPORT_FAVORITE_TAGS_COMMIT, payload),
    exportBlacklistedTags: (siteId?: number | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_EXPORT_BLACKLISTED_TAGS, siteId),
    importBlacklistedTagsPickFile: () =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_IMPORT_BLACKLISTED_TAGS_PICK_FILE),
    importBlacklistedTagsCommit: (payload: { records: import('../shared/types').BlacklistedTagImportRecord[]; fallbackSiteId: number | null }) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_IMPORT_BLACKLISTED_TAGS_COMMIT, payload),

    // 帖子注释
    getNotes: (siteId: number, postId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_NOTES, siteId, postId),

    // 帖子版本历史
    getPostVersions: (siteId: number, postId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_POST_VERSIONS, siteId, postId),

    // 收藏夹分组
    getFavoriteGroups: (siteId?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_FAVORITE_GROUPS, siteId),
    createFavoriteGroup: (name: string, siteId?: number, color?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_CREATE_FAVORITE_GROUP, name, siteId, color),
    updateFavoriteGroup: (id: number, updates: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_UPDATE_FAVORITE_GROUP, id, updates),
    deleteFavoriteGroup: (id: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_DELETE_FAVORITE_GROUP, id),
    moveFavoriteToGroup: (postId: number, groupId: number | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_MOVE_FAVORITE_TO_GROUP, postId, groupId),

    // 保存的搜索
    getSavedSearches: (siteId?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_SAVED_SEARCHES, siteId),
    addSavedSearch: (siteId: number | null, name: string, query: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_ADD_SAVED_SEARCH, siteId, name, query),
    updateSavedSearch: (id: number, updates: { name?: string; query?: string; siteId?: number | null }) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_UPDATE_SAVED_SEARCH, id, updates),
    deleteSavedSearch: (id: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_DELETE_SAVED_SEARCH, id),

    onDownloadProgress: (callback: (data: any) => void) => {
      const subscription = (_event: any, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.BOORU_DOWNLOAD_PROGRESS, subscription);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BOORU_DOWNLOAD_PROGRESS, subscription);
    },
    onDownloadStatus: (callback: (data: any) => void) => {
      const subscription = (_event: any, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.BOORU_DOWNLOAD_STATUS, subscription);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BOORU_DOWNLOAD_STATUS, subscription);
    },
    onQueueStatus: (callback: (data: any) => void) => {
      const subscription = (_event: any, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.BOORU_DOWNLOAD_QUEUE_STATUS, subscription);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BOORU_DOWNLOAD_QUEUE_STATUS, subscription);
    }
  },

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

  // 子窗口操作
  window: {
    openTagSearch: (tag: string, siteId?: number | null) => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_TAG_SEARCH, tag, siteId),
    openArtist: (name: string, siteId?: number | null) => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_ARTIST, name, siteId),
    openCharacter: (name: string, siteId?: number | null) => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_CHARACTER, name, siteId),
    openSecondaryMenu: (section: string, key: string, tab?: string) => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_OPEN_SECONDARY_MENU, section, key, tab),
  },

  // 系统操作
  system: {
    selectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SELECT_FOLDER),
    openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL, url),
    showItem: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SHOW_ITEM, path),
    exportBackup: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_EXPORT_BACKUP),
    importBackup: (mode: 'merge' | 'replace' = 'merge') => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_IMPORT_BACKUP, mode),
    checkForUpdate: () =>
      ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_CHECK_FOR_UPDATE),
    // 网络测试（从主进程发起，绕过CORS限制）
    testBaidu: () => ipcRenderer.invoke(IPC_CHANNELS.NETWORK_TEST_BAIDU),
    testGoogle: () => ipcRenderer.invoke(IPC_CHANNELS.NETWORK_TEST_GOOGLE),
    // 批量下载进度监听
    onBulkDownloadRecordProgress: (callback: (data: any) => void) => {
      const subscription = (_event: any, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.BULK_DOWNLOAD_RECORD_PROGRESS, subscription);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BULK_DOWNLOAD_RECORD_PROGRESS, subscription);
    },
    // 批量下载状态变化监听
    onBulkDownloadRecordStatus: (callback: (data: any) => void) => {
      const subscription = (_event: any, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.BULK_DOWNLOAD_RECORD_STATUS, subscription);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BULK_DOWNLOAD_RECORD_STATUS, subscription);
    }
  },

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
        startSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
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
        openSecondaryMenu: (section: string, key: string, tab?: string) => Promise<{ success: boolean }>;
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
