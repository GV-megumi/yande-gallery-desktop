import { contextBridge, ipcRenderer } from 'electron';

// IPC 通道常量（与主进程 channels.ts 保持一致）
const IPC_CHANNELS = {
  // 数据库操作
  DB_INIT: 'db:init',
  DB_GET_IMAGES: 'db:get-images',
  DB_ADD_IMAGE: 'db:add-image',
  DB_SEARCH_IMAGES: 'db:search-images',
  // 图片操作
  IMAGE_SCAN_FOLDER: 'image:scan-folder',
  IMAGE_GENERATE_THUMBNAIL: 'image:generate-thumbnail',
  // 系统操作
  SYSTEM_SELECT_FOLDER: 'system:select-folder',
  SYSTEM_OPEN_EXTERNAL: 'system:open-external',
  SYSTEM_SHOW_ITEM: 'system:show-item',
  SYSTEM_EXPORT_BACKUP: 'system:export-backup',
  SYSTEM_IMPORT_BACKUP: 'system:import-backup',

  // === Booru 相关通道 ===
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
  BOORU_PAUSE_ALL_DOWNLOADS: 'booru:pause-all-downloads',
  BOORU_RESUME_ALL_DOWNLOADS: 'booru:resume-all-downloads',
  BOORU_RESUME_PENDING_DOWNLOADS: 'booru:resume-pending-downloads',
  BOORU_GET_QUEUE_STATUS: 'booru:get-queue-status',
  BOORU_PAUSE_DOWNLOAD: 'booru:pause-download',
  BOORU_RESUME_DOWNLOAD: 'booru:resume-download',

  // Booru 图片缓存
  BOORU_GET_CACHED_IMAGE_URL: 'booru:get-cached-image-url',
  BOORU_CACHE_IMAGE: 'booru:cache-image',
  BOORU_GET_CACHE_STATS: 'booru:get-cache-stats',
  BOORU_CLEAR_CACHE: 'booru:clear-cache',

  // Booru 标签缓存管理
  BOORU_GET_TAG_CACHE_STATS: 'booru:get-tag-cache-stats',
  BOORU_CLEAN_EXPIRED_TAGS: 'booru:clean-expired-tags',

  // Booru 标签分类
  BOORU_GET_TAGS_CATEGORIES: 'booru:get-tags-categories',

  // Booru 标签自动补全
  BOORU_AUTOCOMPLETE_TAGS: 'booru:autocomplete-tags',

  // Booru 艺术家
  BOORU_GET_ARTIST: 'booru:get-artist',
  BOORU_GET_TAG_RELATIONSHIPS: 'booru:get-tag-relationships',
  BOORU_REPORT_POST: 'booru:report-post',
  BOORU_GET_IMAGE_METADATA: 'booru:get-image-metadata',

  // Booru Wiki
  BOORU_GET_WIKI: 'booru:get-wiki',

  // Booru Forum
  BOORU_GET_FORUM_TOPICS: 'booru:get-forum-topics',
  BOORU_GET_FORUM_POSTS: 'booru:get-forum-posts',

  // Booru User
  BOORU_GET_PROFILE: 'booru:get-profile',
  BOORU_GET_USER_PROFILE: 'booru:get-user-profile',

  // 收藏标签管理
  BOORU_ADD_FAVORITE_TAG: 'booru:add-favorite-tag',
  BOORU_REMOVE_FAVORITE_TAG: 'booru:remove-favorite-tag',
  BOORU_REMOVE_FAVORITE_TAG_BY_NAME: 'booru:remove-favorite-tag-by-name',
  BOORU_GET_FAVORITE_TAGS: 'booru:get-favorite-tags',
  BOORU_UPDATE_FAVORITE_TAG: 'booru:update-favorite-tag',
  BOORU_IS_FAVORITE_TAG: 'booru:is-favorite-tag',

  // 收藏标签分组
  BOORU_GET_FAVORITE_TAG_LABELS: 'booru:get-favorite-tag-labels',
  BOORU_ADD_FAVORITE_TAG_LABEL: 'booru:add-favorite-tag-label',
  BOORU_REMOVE_FAVORITE_TAG_LABEL: 'booru:remove-favorite-tag-label',

  // 搜索历史
  BOORU_ADD_SEARCH_HISTORY: 'booru:add-search-history',
  BOORU_GET_SEARCH_HISTORY: 'booru:get-search-history',
  BOORU_CLEAR_SEARCH_HISTORY: 'booru:clear-search-history',

  // 黑名单标签管理
  BOORU_ADD_BLACKLISTED_TAG: 'booru:add-blacklisted-tag',
  BOORU_ADD_BLACKLISTED_TAGS: 'booru:add-blacklisted-tags',
  BOORU_GET_BLACKLISTED_TAGS: 'booru:get-blacklisted-tags',
  BOORU_GET_ACTIVE_BLACKLIST_TAG_NAMES: 'booru:get-active-blacklist-tag-names',
  BOORU_TOGGLE_BLACKLISTED_TAG: 'booru:toggle-blacklisted-tag',
  BOORU_UPDATE_BLACKLISTED_TAG: 'booru:update-blacklisted-tag',
  BOORU_REMOVE_BLACKLISTED_TAG: 'booru:remove-blacklisted-tag',

  // 认证
  BOORU_LOGIN: 'booru:login',
  BOORU_LOGOUT: 'booru:logout',
  BOORU_TEST_AUTH: 'booru:test-auth',
  BOORU_HASH_PASSWORD: 'booru:hash-password',

  // 投票/服务端收藏
  BOORU_VOTE_POST: 'booru:vote-post',
  BOORU_SERVER_FAVORITE: 'booru:server-favorite',
  BOORU_SERVER_UNFAVORITE: 'booru:server-unfavorite',
  BOORU_GET_SERVER_FAVORITES: 'booru:get-server-favorites',
  BOORU_GET_FAVORITE_USERS: 'booru:get-favorite-users',

  // 热门图片
  BOORU_GET_POPULAR_RECENT: 'booru:get-popular-recent',
  BOORU_GET_POPULAR_BY_DAY: 'booru:get-popular-by-day',
  BOORU_GET_POPULAR_BY_WEEK: 'booru:get-popular-by-week',
  BOORU_GET_POPULAR_BY_MONTH: 'booru:get-popular-by-month',

  // 评论
  BOORU_GET_COMMENTS: 'booru:get-comments',
  BOORU_CREATE_COMMENT: 'booru:create-comment',

  // Pool
  BOORU_GET_POOLS: 'booru:get-pools',
  BOORU_GET_POOL: 'booru:get-pool',
  BOORU_SEARCH_POOLS: 'booru:search-pools',

  // 标签导入/导出
  BOORU_EXPORT_FAVORITE_TAGS: 'booru:export-favorite-tags',
  BOORU_IMPORT_FAVORITE_TAGS: 'booru:import-favorite-tags',
  BOORU_EXPORT_BLACKLISTED_TAGS: 'booru:export-blacklisted-tags',
  BOORU_IMPORT_BLACKLISTED_TAGS: 'booru:import-blacklisted-tags',

  // 帖子注释
  BOORU_GET_NOTES: 'booru:get-notes',

  // 帖子版本历史
  BOORU_GET_POST_VERSIONS: 'booru:get-post-versions',

  // 收藏夹分组
  BOORU_GET_FAVORITE_GROUPS: 'booru:get-favorite-groups',
  BOORU_CREATE_FAVORITE_GROUP: 'booru:create-favorite-group',
  BOORU_UPDATE_FAVORITE_GROUP: 'booru:update-favorite-group',
  BOORU_DELETE_FAVORITE_GROUP: 'booru:delete-favorite-group',
  BOORU_MOVE_FAVORITE_TO_GROUP: 'booru:move-favorite-to-group',

  // 保存的搜索
  BOORU_GET_SAVED_SEARCHES: 'booru:get-saved-searches',
  BOORU_ADD_SAVED_SEARCH: 'booru:add-saved-search',
  BOORU_UPDATE_SAVED_SEARCH: 'booru:update-saved-search',
  BOORU_DELETE_SAVED_SEARCH: 'booru:delete-saved-search',

  // === Google 认证 ===
  GOOGLE_AUTH_LOGIN: 'google:auth-login',
  GOOGLE_AUTH_LOGOUT: 'google:auth-logout',
  GOOGLE_AUTH_STATUS: 'google:auth-status',

  // === Google Drive ===
  GDRIVE_LIST_FILES: 'gdrive:list-files',
  GDRIVE_SEARCH: 'gdrive:search',
  GDRIVE_GET_FILE: 'gdrive:get-file',
  GDRIVE_DOWNLOAD: 'gdrive:download',
  GDRIVE_UPLOAD: 'gdrive:upload',
  GDRIVE_DELETE: 'gdrive:delete',
  GDRIVE_CREATE_FOLDER: 'gdrive:create-folder',
  GDRIVE_MOVE: 'gdrive:move',
  GDRIVE_GET_STORAGE: 'gdrive:get-storage',
  GDRIVE_GET_THUMBNAIL: 'gdrive:get-thumbnail',

  // === Google Photos Picker API ===
  GPHOTOS_PICKER_OPEN: 'gphotos:picker-open',
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
    reload: () => ipcRenderer.invoke('config:reload'),
    // 监听配置变更事件（事件驱动，替代轮询）
    onConfigChanged: (callback: (config: any) => void) => {
      const subscription = (_event: any, config: any) => callback(config);
      ipcRenderer.on('config:changed', subscription);
      return () => ipcRenderer.removeListener('config:changed', subscription);
    }
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
    getFavorites: (siteId: number, page: number = 1, limit: number = 20, groupId?: number | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_FAVORITES, siteId, page, limit, groupId),
    addFavorite: (postId: number, siteId: number, syncToServer: boolean = false) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_ADD_FAVORITE, postId, siteId, syncToServer),
    removeFavorite: (postId: number, syncToServer: boolean = false) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_REMOVE_FAVORITE, postId, syncToServer),
    // 监听收藏后台修复完成事件
    onFavoritesRepairDone: (callback: (data: { siteId: number; repairedCount: number; deletedCount: number; deletedIds: number[] }) => void) => {
      const subscription = (_event: any, data: any) => callback(data);
      ipcRenderer.on('booru:favorites-repair-done', subscription);
      return () => ipcRenderer.removeListener('booru:favorites-repair-done', subscription);
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
    removeFavoriteTag: (id: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_REMOVE_FAVORITE_TAG, id),
    removeFavoriteTagByName: (siteId: number | null, tagName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_REMOVE_FAVORITE_TAG_BY_NAME, siteId, tagName),
    getFavoriteTags: (siteId?: number | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_FAVORITE_TAGS, siteId),
    updateFavoriteTag: (id: number, updates: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_UPDATE_FAVORITE_TAG, id, updates),
    isFavoriteTag: (siteId: number | null, tagName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_IS_FAVORITE_TAG, siteId, tagName),

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
    getBlacklistedTags: (siteId?: number | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_BLACKLISTED_TAGS, siteId),
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
    hashPassword: (salt: string, password: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_HASH_PASSWORD, salt, password),

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
    importFavoriteTags: () =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_IMPORT_FAVORITE_TAGS),
    exportBlacklistedTags: (siteId?: number | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_EXPORT_BLACKLISTED_TAGS, siteId),
    importBlacklistedTags: () =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_IMPORT_BLACKLISTED_TAGS),

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
    updateSavedSearch: (id: number, updates: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_UPDATE_SAVED_SEARCH, id, updates),
    deleteSavedSearch: (id: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_DELETE_SAVED_SEARCH, id),

    onDownloadProgress: (callback: (data: any) => void) => {
      const subscription = (_event: any, data: any) => callback(data);
      ipcRenderer.on('booru:download-progress', subscription);
      return () => ipcRenderer.removeListener('booru:download-progress', subscription);
    },
    onDownloadStatus: (callback: (data: any) => void) => {
      const subscription = (_event: any, data: any) => callback(data);
      ipcRenderer.on('booru:download-status', subscription);
      return () => ipcRenderer.removeListener('booru:download-status', subscription);
    },
    onQueueStatus: (callback: (data: any) => void) => {
      const subscription = (_event: any, data: any) => callback(data);
      ipcRenderer.on('booru:download-queue-status', subscription);
      return () => ipcRenderer.removeListener('booru:download-queue-status', subscription);
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
      ipcRenderer.invoke('bulk-download:retry-failed-record', sessionId, recordUrl),
    resumeRunningSessions: () =>
      ipcRenderer.invoke('bulk-download:resume-running-sessions')
  },

  // 子窗口操作
  window: {
    openTagSearch: (tag: string, siteId?: number | null) => ipcRenderer.invoke('window:open-tag-search', tag, siteId),
    openArtist: (name: string, siteId?: number | null) => ipcRenderer.invoke('window:open-artist', name, siteId),
    openCharacter: (name: string, siteId?: number | null) => ipcRenderer.invoke('window:open-character', name, siteId),
  },

  // 系统操作
  system: {
    selectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SELECT_FOLDER),
    openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL, url),
    showItem: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SHOW_ITEM, path),
    exportBackup: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_EXPORT_BACKUP),
    importBackup: (mode: 'merge' | 'replace' = 'merge') => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_IMPORT_BACKUP, mode),
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
  },

  // Google 认证
  google: {
    login: () => ipcRenderer.invoke(IPC_CHANNELS.GOOGLE_AUTH_LOGIN),
    logout: () => ipcRenderer.invoke(IPC_CHANNELS.GOOGLE_AUTH_LOGOUT),
    getAuthStatus: () => ipcRenderer.invoke(IPC_CHANNELS.GOOGLE_AUTH_STATUS),
  },

  // Google Drive
  gdrive: {
    listFiles: (folderId?: string, pageSize?: number, pageToken?: string, mimeType?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GDRIVE_LIST_FILES, folderId, pageSize, pageToken, mimeType),
    search: (query: string, pageSize?: number, pageToken?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GDRIVE_SEARCH, query, pageSize, pageToken),
    getFile: (fileId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GDRIVE_GET_FILE, fileId),
    download: (fileId: string, localPath?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GDRIVE_DOWNLOAD, fileId, localPath),
    upload: (localPath: string, folderId?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GDRIVE_UPLOAD, localPath, folderId),
    delete: (fileId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GDRIVE_DELETE, fileId),
    createFolder: (name: string, parentId?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GDRIVE_CREATE_FOLDER, name, parentId),
    move: (fileId: string, newParentId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GDRIVE_MOVE, fileId, newParentId),
    getStorage: () =>
      ipcRenderer.invoke(IPC_CHANNELS.GDRIVE_GET_STORAGE),
    getThumbnail: (fileId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.GDRIVE_GET_THUMBNAIL, fileId),
  },

  // Google Photos Picker API
  gphotos: {
    pickerOpen: () =>
      ipcRenderer.invoke(IPC_CHANNELS.GPHOTOS_PICKER_OPEN),
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
        getWiki: (siteId: number, title: string) => Promise<{ success: boolean; data?: { id: number; title: string; body: string; other_names: string[]; created_at?: string; updated_at?: string; is_locked?: boolean; is_deleted?: boolean } | null; error?: string }>;
        getForumTopics: (siteId: number, page?: number, limit?: number) => Promise<{ success: boolean; data?: Array<{ id: number; title: string; response_count: number; is_sticky?: boolean; is_locked?: boolean; is_hidden?: boolean; category_id?: number; creator_id?: number; updater_id?: number; created_at?: string; updated_at?: string }>; error?: string }>;
        getForumPosts: (siteId: number, topicId: number, page?: number, limit?: number) => Promise<{ success: boolean; data?: Array<{ id: number; topic_id: number; body: string; creator_id?: number; updater_id?: number; created_at?: string; updated_at?: string; is_deleted?: boolean; is_hidden?: boolean }>; error?: string }>;
        getProfile: (siteId: number) => Promise<{ success: boolean; data?: { id: number; name: string; level_string?: string; created_at?: string; avatar_url?: string; post_upload_count?: number; post_update_count?: number; note_update_count?: number; comment_count?: number; forum_post_count?: number; favorite_count?: number; feedback_count?: number } | null; error?: string }>;
        getUserProfile: (siteId: number, params: { userId?: number; username?: string }) => Promise<{ success: boolean; data?: { id: number; name: string; level_string?: string; created_at?: string; avatar_url?: string; post_upload_count?: number; post_update_count?: number; note_update_count?: number; comment_count?: number; forum_post_count?: number; favorite_count?: number; feedback_count?: number } | null; error?: string }>;
        addFavoriteTag: (siteId: number | null, tagName: string, options?: any) => Promise<{ success: boolean; data?: any; error?: string }>;
        removeFavoriteTag: (id: number) => Promise<{ success: boolean; error?: string }>;
        removeFavoriteTagByName: (siteId: number | null, tagName: string) => Promise<{ success: boolean; error?: string }>;
        getFavoriteTags: (siteId?: number | null) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        updateFavoriteTag: (id: number, updates: any) => Promise<{ success: boolean; error?: string }>;
        isFavoriteTag: (siteId: number | null, tagName: string) => Promise<{ success: boolean; data?: boolean; error?: string }>;
        getFavoriteTagLabels: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
        addFavoriteTagLabel: (name: string, color?: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        removeFavoriteTagLabel: (id: number) => Promise<{ success: boolean; error?: string }>;
        addSearchHistory: (siteId: number, query: string, resultCount?: number) => Promise<{ success: boolean; error?: string }>;
        getSearchHistory: (siteId?: number, limit?: number) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        clearSearchHistory: (siteId?: number) => Promise<{ success: boolean; error?: string }>;
        addBlacklistedTag: (tagName: string, siteId?: number | null, reason?: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        addBlacklistedTags: (tagString: string, siteId?: number | null, reason?: string) => Promise<{ success: boolean; data?: { added: number; skipped: number }; error?: string }>;
        getBlacklistedTags: (siteId?: number | null) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        getActiveBlacklistTagNames: (siteId?: number | null) => Promise<{ success: boolean; data?: string[]; error?: string }>;
        toggleBlacklistedTag: (id: number) => Promise<{ success: boolean; data?: any; error?: string }>;
        updateBlacklistedTag: (id: number, updates: any) => Promise<{ success: boolean; error?: string }>;
        removeBlacklistedTag: (id: number) => Promise<{ success: boolean; error?: string }>;
        // 认证
        login: (siteId: number, username: string, password: string) => Promise<{ success: boolean; data?: { username: string; authenticated: boolean }; error?: string }>;
        logout: (siteId: number) => Promise<{ success: boolean; error?: string }>;
        testAuth: (siteId: number) => Promise<{ success: boolean; data?: { authenticated: boolean; username?: string; reason?: string }; error?: string }>;
        hashPassword: (salt: string, password: string) => Promise<{ success: boolean; data?: string; error?: string }>;
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
        exportFavoriteTags: (siteId?: number | null) => Promise<{ success: boolean; data?: { count: number; path: string }; error?: string }>;
        importFavoriteTags: () => Promise<{ success: boolean; data?: { importedTags: number; importedLabels: number; skippedTags: number }; error?: string }>;
        exportBlacklistedTags: (siteId?: number | null) => Promise<{ success: boolean; data?: { count: number; path: string }; error?: string }>;
        importBlacklistedTags: () => Promise<{ success: boolean; data?: { imported: number; skipped: number }; error?: string }>;
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
      };
      system: {
        selectFolder: () => Promise<{ success: boolean; data?: string; error?: string }>;
        openExternal: (url: string) => Promise<void>;
        showItem: (path: string) => Promise<{ success: boolean; error?: string }>;
        exportBackup: () => Promise<{ success: boolean; data?: { path: string; summary: Array<{ table: string; count: number }> }; error?: string }>;
        importBackup: (mode?: 'merge' | 'replace') => Promise<{ success: boolean; data?: { path: string; mode: 'merge' | 'replace'; restoredTables: Array<{ table: string; count: number }> }; error?: string }>;
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
        onConfigChanged: (callback: (config: any) => void) => () => void;
      };
      google: {
        login: () => Promise<{ success: boolean; email?: string; error?: string }>;
        logout: () => Promise<{ success: boolean; error?: string }>;
        getAuthStatus: () => Promise<{ success: boolean; data?: { isLoggedIn: boolean; email?: string; expiresAt?: number }; error?: string }>;
      };
      gdrive: {
        listFiles: (folderId?: string, pageSize?: number, pageToken?: string, mimeType?: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        search: (query: string, pageSize?: number, pageToken?: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        getFile: (fileId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        download: (fileId: string, localPath?: string) => Promise<{ success: boolean; data?: string; error?: string }>;
        upload: (localPath: string, folderId?: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        delete: (fileId: string) => Promise<{ success: boolean; error?: string }>;
        createFolder: (name: string, parentId?: string) => Promise<{ success: boolean; data?: any; error?: string }>;
        move: (fileId: string, newParentId: string) => Promise<{ success: boolean; error?: string }>;
        getStorage: () => Promise<{ success: boolean; data?: { totalGB: number; usedGB: number; trashedGB: number }; error?: string }>;
        getThumbnail: (fileId: string) => Promise<{ success: boolean; data?: string | null; error?: string }>;
      };
      gphotos: {
        pickerOpen: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
      };
    };
  }
}
