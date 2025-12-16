export const IPC_CHANNELS = {
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
  SYSTEM_SHOW_ITEM: 'system:show-item',

  // === Booru 相关通道 (新增) ===

  // Booru 站点管理
  BOORU_GET_SITES: 'booru:get-sites',
  BOORU_ADD_SITE: 'booru:add-site',
  BOORU_UPDATE_SITE: 'booru:update-site',
  BOORU_DELETE_SITE: 'booru:delete-site',
  BOORU_GET_ACTIVE_SITE: 'booru:get-active-site',
  BOORU_SET_ACTIVE_SITE: 'booru:set-active-site',

  // Booru 图片获取
  BOORU_GET_POSTS: 'booru:get-posts',
  BOORU_GET_POST: 'booru:get-post',
  BOORU_SEARCH_POSTS: 'booru:search-posts',
  BOORU_GET_POPULAR: 'booru:get-popular',

  // Booru 标签
  BOORU_GET_TAGS: 'booru:get-tags',
  BOORU_SEARCH_TAGS: 'booru:search-tags',
  BOORU_GET_TAG_AUTOCOMPLETE: 'booru:get-tag-autocomplete',

  // Booru 收藏
  BOORU_ADD_FAVORITE: 'booru:add-favorite',
  BOORU_REMOVE_FAVORITE: 'booru:remove-favorite',
  BOORU_GET_FAVORITES: 'booru:get-favorites',
  BOORU_IS_FAVORITED: 'booru:is-favorited',
  BOORU_SYNC_FAVORITE_TO_SERVER: 'booru:sync-favorite-to-server',

  // Booru 下载
  BOORU_ADD_TO_DOWNLOAD: 'booru:add-to-download',
  BOORU_START_DOWNLOAD: 'booru:start-download',
  BOORU_PAUSE_DOWNLOAD: 'booru:pause-download',
  BOORU_RESUME_DOWNLOAD: 'booru:resume-download',
  BOORU_CANCEL_DOWNLOAD: 'booru:cancel-download',
  BOORU_RETRY_DOWNLOAD: 'booru:retry-download',
  BOORU_GET_DOWNLOAD_QUEUE: 'booru:get-download-queue',
  BOORU_CLEAR_DOWNLOAD_RECORDS: 'booru:clear-download-records',
  BOORU_BATCH_DOWNLOAD: 'booru:batch-download',

  // Booru 搜索历史
  BOORU_GET_SEARCH_HISTORY: 'booru:get-search-history',
  BOORU_CLEAR_SEARCH_HISTORY: 'booru:clear-search-history',

  // Booru 图片缓存
  BOORU_GET_CACHED_IMAGE_URL: 'booru:get-cached-image-url',
  BOORU_CACHE_IMAGE: 'booru:cache-image',
  BOORU_GET_CACHE_STATS: 'booru:get-cache-stats',

  // Booru 标签分类
  BOORU_GET_TAGS_CATEGORIES: 'booru:get-tags-categories',

  // === 批量下载相关通道 ===
  BULK_DOWNLOAD_CREATE_TASK: 'bulk-download:create-task',
  BULK_DOWNLOAD_GET_TASKS: 'bulk-download:get-tasks',
  BULK_DOWNLOAD_GET_TASK: 'bulk-download:get-task',
  BULK_DOWNLOAD_UPDATE_TASK: 'bulk-download:update-task',
  BULK_DOWNLOAD_DELETE_TASK: 'bulk-download:delete-task',
  BULK_DOWNLOAD_CREATE_SESSION: 'bulk-download:create-session',
  BULK_DOWNLOAD_GET_ACTIVE_SESSIONS: 'bulk-download:get-active-sessions',
  BULK_DOWNLOAD_START_SESSION: 'bulk-download:start-session',
  BULK_DOWNLOAD_PAUSE_SESSION: 'bulk-download:pause-session',
  BULK_DOWNLOAD_CANCEL_SESSION: 'bulk-download:cancel-session',
  BULK_DOWNLOAD_DELETE_SESSION: 'bulk-download:delete-session',
  BULK_DOWNLOAD_GET_SESSION_STATS: 'bulk-download:get-session-stats',
  BULK_DOWNLOAD_GET_RECORDS: 'bulk-download:get-records',
  BULK_DOWNLOAD_RETRY_ALL_FAILED: 'bulk-download:retry-all-failed',
  BULK_DOWNLOAD_RETRY_FAILED_RECORD: 'bulk-download:retry-failed-record'
} as const;