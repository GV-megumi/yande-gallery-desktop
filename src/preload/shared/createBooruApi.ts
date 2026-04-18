/**
 * booru 域 API 工厂。
 * 主窗口 preload 与精简 subwindow preload 共用。
 *
 * 实现整段原封不动搬自原 src/preload/index.ts 中 `booru: { ... }` 段
 * （70+ 方法）。不做方法筛减或合并，以保证主窗口对外行为严格等价。
 */
import { ipcRenderer } from 'electron';
import type { BooruSite, BooruSiteRecord } from '../../shared/types.js';
import { IPC_CHANNELS } from '../../main/ipc/channels.js';

export function createBooruApi() {
  return {
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
    cancelDownload: (queueId: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_CANCEL_DOWNLOAD, queueId),

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
    getFavoriteTags: (params: import('../../shared/types').ListQueryParams = {}) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_FAVORITE_TAGS, params),
    getFavoriteTagsWithDownloadState: (params: import('../../shared/types').ListQueryParams = {}) =>
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
    getBlacklistedTags: (params: import('../../shared/types').ListQueryParams = {}) =>
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
    importFavoriteTagsCommit: (payload: { records: import('../../shared/types').FavoriteTagImportRecord[]; labelGroups?: import('../../shared/types').FavoriteTagLabelImportRecord[]; fallbackSiteId: number | null }) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_IMPORT_FAVORITE_TAGS_COMMIT, payload),
    exportBlacklistedTags: (siteId?: number | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_EXPORT_BLACKLISTED_TAGS, siteId),
    importBlacklistedTagsPickFile: () =>
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_IMPORT_BLACKLISTED_TAGS_PICK_FILE),
    importBlacklistedTagsCommit: (payload: { records: import('../../shared/types').BlacklistedTagImportRecord[]; fallbackSiteId: number | null }) =>
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
  } as const;
}
