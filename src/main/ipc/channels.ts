export const IPC_CHANNELS = {
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

  // === Booru 相关通道 ===

  // Booru 站点管理
  BOORU_GET_SITES: 'booru:get-sites',
  BOORU_ADD_SITE: 'booru:add-site',
  BOORU_UPDATE_SITE: 'booru:update-site',
  BOORU_DELETE_SITE: 'booru:delete-site',
  BOORU_GET_ACTIVE_SITE: 'booru:get-active-site',

  // Booru 图片获取
  BOORU_GET_POSTS: 'booru:get-posts',
  BOORU_GET_POST: 'booru:get-post',
  BOORU_SEARCH_POSTS: 'booru:search-posts',

  // Booru 收藏
  BOORU_ADD_FAVORITE: 'booru:add-favorite',
  BOORU_REMOVE_FAVORITE: 'booru:remove-favorite',
  BOORU_GET_FAVORITES: 'booru:get-favorites',

  // Booru 下载
  BOORU_ADD_TO_DOWNLOAD: 'booru:add-to-download',
  BOORU_PAUSE_DOWNLOAD: 'booru:pause-download',
  BOORU_RESUME_DOWNLOAD: 'booru:resume-download',
  BOORU_RETRY_DOWNLOAD: 'booru:retry-download',
  BOORU_GET_DOWNLOAD_QUEUE: 'booru:get-download-queue',
  BOORU_CLEAR_DOWNLOAD_RECORDS: 'booru:clear-download-records',
  BOORU_PAUSE_ALL_DOWNLOADS: 'booru:pause-all-downloads',
  BOORU_RESUME_ALL_DOWNLOADS: 'booru:resume-all-downloads',
  BOORU_RESUME_PENDING_DOWNLOADS: 'booru:resume-pending-downloads',
  BOORU_GET_QUEUE_STATUS: 'booru:get-queue-status',

  // Booru 搜索历史
  BOORU_ADD_SEARCH_HISTORY: 'booru:add-search-history',
  BOORU_GET_SEARCH_HISTORY: 'booru:get-search-history',
  BOORU_CLEAR_SEARCH_HISTORY: 'booru:clear-search-history',

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

  // Booru Wiki
  BOORU_GET_WIKI: 'booru:get-wiki',

  // Booru Forum
  BOORU_GET_FORUM_TOPICS: 'booru:get-forum-topics',
  BOORU_GET_FORUM_POSTS: 'booru:get-forum-posts',

  // Booru User
  BOORU_GET_PROFILE: 'booru:get-profile',
  BOORU_GET_USER_PROFILE: 'booru:get-user-profile',

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
  BULK_DOWNLOAD_RETRY_FAILED_RECORD: 'bulk-download:retry-failed-record',
  BULK_DOWNLOAD_RESUME_RUNNING_SESSIONS: 'bulk-download:resume-running-sessions',

  // === 收藏标签管理 ===
  BOORU_ADD_FAVORITE_TAG: 'booru:add-favorite-tag',
  BOORU_REMOVE_FAVORITE_TAG: 'booru:remove-favorite-tag',
  BOORU_REMOVE_FAVORITE_TAG_BY_NAME: 'booru:remove-favorite-tag-by-name',
  BOORU_GET_FAVORITE_TAGS: 'booru:get-favorite-tags',
  BOORU_GET_FAVORITE_TAGS_WITH_DOWNLOAD_STATE: 'booru:get-favorite-tags-with-download-state',
  BOORU_EXPORT_FAVORITE_TAGS: 'booru:export-favorite-tags',
  BOORU_IMPORT_FAVORITE_TAGS: 'booru:import-favorite-tags',
  BOORU_UPDATE_FAVORITE_TAG: 'booru:update-favorite-tag',
  BOORU_IS_FAVORITE_TAG: 'booru:is-favorite-tag',
  BOORU_GET_FAVORITE_TAG_DOWNLOAD_BINDING: 'booru:get-favorite-tag-download-binding',
  BOORU_GET_FAVORITE_TAG_DOWNLOAD_HISTORY: 'booru:get-favorite-tag-download-history',
  BOORU_GET_GALLERY_SOURCE_FAVORITE_TAGS: 'booru:get-gallery-source-favorite-tags',
  BOORU_UPSERT_FAVORITE_TAG_DOWNLOAD_BINDING: 'booru:upsert-favorite-tag-download-binding',
  BOORU_REMOVE_FAVORITE_TAG_DOWNLOAD_BINDING: 'booru:remove-favorite-tag-download-binding',
  BOORU_START_FAVORITE_TAG_BULK_DOWNLOAD: 'booru:start-favorite-tag-bulk-download',

  // 收藏标签分组管理
  BOORU_GET_FAVORITE_TAG_LABELS: 'booru:get-favorite-tag-labels',
  BOORU_ADD_FAVORITE_TAG_LABEL: 'booru:add-favorite-tag-label',
  BOORU_REMOVE_FAVORITE_TAG_LABEL: 'booru:remove-favorite-tag-label',

  // === 黑名单标签管理 ===
  BOORU_ADD_BLACKLISTED_TAG: 'booru:add-blacklisted-tag',
  BOORU_ADD_BLACKLISTED_TAGS: 'booru:add-blacklisted-tags',
  BOORU_GET_BLACKLISTED_TAGS: 'booru:get-blacklisted-tags',
  BOORU_GET_ACTIVE_BLACKLIST_TAG_NAMES: 'booru:get-active-blacklist-tag-names',
  BOORU_TOGGLE_BLACKLISTED_TAG: 'booru:toggle-blacklisted-tag',
  BOORU_UPDATE_BLACKLISTED_TAG: 'booru:update-blacklisted-tag',
  BOORU_REMOVE_BLACKLISTED_TAG: 'booru:remove-blacklisted-tag',

  // === 认证相关通道 ===
  BOORU_LOGIN: 'booru:login',
  BOORU_LOGOUT: 'booru:logout',
  BOORU_TEST_AUTH: 'booru:test-auth',
  BOORU_HASH_PASSWORD: 'booru:hash-password',

  // === 投票/服务端收藏 ===
  BOORU_VOTE_POST: 'booru:vote-post',
  BOORU_SERVER_FAVORITE: 'booru:server-favorite',
  BOORU_SERVER_UNFAVORITE: 'booru:server-unfavorite',
  BOORU_GET_SERVER_FAVORITES: 'booru:get-server-favorites',
  BOORU_GET_FAVORITE_USERS: 'booru:get-favorite-users',

  // === 热门图片 ===
  BOORU_GET_POPULAR_RECENT: 'booru:get-popular-recent',
  BOORU_GET_POPULAR_BY_DAY: 'booru:get-popular-by-day',
  BOORU_GET_POPULAR_BY_WEEK: 'booru:get-popular-by-week',
  BOORU_GET_POPULAR_BY_MONTH: 'booru:get-popular-by-month',

  // === 评论 ===
  BOORU_GET_COMMENTS: 'booru:get-comments',
  BOORU_CREATE_COMMENT: 'booru:create-comment',

  // === Pool（图集） ===
  BOORU_GET_POOLS: 'booru:get-pools',
  BOORU_GET_POOL: 'booru:get-pool',
  BOORU_SEARCH_POOLS: 'booru:search-pools',

  // === 标签导入/导出 ===
  BOORU_EXPORT_BLACKLISTED_TAGS: 'booru:export-blacklisted-tags',
  BOORU_IMPORT_BLACKLISTED_TAGS: 'booru:import-blacklisted-tags',

  // === 帖子注释 ===
  BOORU_GET_NOTES: 'booru:get-notes',

  // === 帖子版本历史 ===
  BOORU_GET_POST_VERSIONS: 'booru:get-post-versions',

  // === 收藏夹分组 ===
  BOORU_GET_FAVORITE_GROUPS: 'booru:get-favorite-groups',
  BOORU_CREATE_FAVORITE_GROUP: 'booru:create-favorite-group',
  BOORU_UPDATE_FAVORITE_GROUP: 'booru:update-favorite-group',
  BOORU_DELETE_FAVORITE_GROUP: 'booru:delete-favorite-group',
  BOORU_MOVE_FAVORITE_TO_GROUP: 'booru:move-favorite-to-group',

  // === 保存的搜索 ===
  BOORU_GET_SAVED_SEARCHES: 'booru:get-saved-searches',
  BOORU_ADD_SAVED_SEARCH: 'booru:add-saved-search',
  BOORU_UPDATE_SAVED_SEARCH: 'booru:update-saved-search',
  BOORU_DELETE_SAVED_SEARCH: 'booru:delete-saved-search',

} as const;
