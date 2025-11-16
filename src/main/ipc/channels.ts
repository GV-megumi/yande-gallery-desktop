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
  SYSTEM_SHOW_ITEM: 'system:show-item'
} as const;