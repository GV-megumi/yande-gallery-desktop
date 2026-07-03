import { describe, it, expect } from 'vitest';
import { IPC_CHANNELS } from '../../../src/main/ipc/channels';

describe('IPC_CHANNELS', () => {
  // === 结构完整性测试 ===

  it('应包含数据库操作通道', () => {
    expect(IPC_CHANNELS.DB_INIT).toBe('db:init');
    expect(IPC_CHANNELS.DB_GET_IMAGES).toBe('db:get-images');
    // [已停用] DB_ADD_IMAGE 绕过 gallery_images 成员模型，已注释停用（零调用方，保留备查）
    expect(IPC_CHANNELS.DB_SEARCH_IMAGES).toBe('db:search-images');
  });

  it('应包含图片操作通道', () => {
    // [已停用] IMAGE_SCAN_FOLDER 绕过 gallery_images 成员模型，已注释停用（零调用方，保留备查）
    expect(IPC_CHANNELS.IMAGE_GENERATE_THUMBNAIL).toBe('image:generate-thumbnail');
  });

  it('应包含系统操作通道', () => {
    expect(IPC_CHANNELS.SYSTEM_SELECT_FOLDER).toBe('system:select-folder');
    expect(IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL).toBe('system:open-external');
    expect(IPC_CHANNELS.SYSTEM_SHOW_ITEM).toBe('system:show-item');
  });

  it('应包含 Booru 站点管理通道', () => {
    expect(IPC_CHANNELS.BOORU_GET_SITES).toBe('booru:get-sites');
    expect(IPC_CHANNELS.BOORU_ADD_SITE).toBe('booru:add-site');
    expect(IPC_CHANNELS.BOORU_UPDATE_SITE).toBe('booru:update-site');
    expect(IPC_CHANNELS.BOORU_DELETE_SITE).toBe('booru:delete-site');
    expect(IPC_CHANNELS.BOORU_GET_ACTIVE_SITE).toBe('booru:get-active-site');
    expect(IPC_CHANNELS.BOORU_SET_ACTIVE_SITE).toBe('booru:set-active-site');
  });

  it('应包含 Booru 图片获取通道', () => {
    expect(IPC_CHANNELS.BOORU_GET_POSTS).toBe('booru:get-posts');
    expect(IPC_CHANNELS.BOORU_GET_POST).toBe('booru:get-post');
    expect(IPC_CHANNELS.BOORU_SEARCH_POSTS).toBe('booru:search-posts');
  });

  it('应包含 Booru 收藏通道', () => {
    expect(IPC_CHANNELS.BOORU_ADD_FAVORITE).toBe('booru:add-favorite');
    expect(IPC_CHANNELS.BOORU_REMOVE_FAVORITE).toBe('booru:remove-favorite');
    expect(IPC_CHANNELS.BOORU_GET_FAVORITES).toBe('booru:get-favorites');
  });

  it('应包含 Booru 下载通道', () => {
    expect(IPC_CHANNELS.BOORU_ADD_TO_DOWNLOAD).toBe('booru:add-to-download');
    expect(IPC_CHANNELS.BOORU_PAUSE_DOWNLOAD).toBe('booru:pause-download');
    expect(IPC_CHANNELS.BOORU_RESUME_DOWNLOAD).toBe('booru:resume-download');
    expect(IPC_CHANNELS.BOORU_CANCEL_DOWNLOAD).toBe('booru:cancel-download');
    expect(IPC_CHANNELS.BOORU_RETRY_DOWNLOAD).toBe('booru:retry-download');
    expect(IPC_CHANNELS.BOORU_GET_DOWNLOAD_QUEUE).toBe('booru:get-download-queue');
    expect(IPC_CHANNELS.BOORU_CLEAR_DOWNLOAD_RECORDS).toBe('booru:clear-download-records');
    expect(IPC_CHANNELS.BOORU_PAUSE_ALL_DOWNLOADS).toBe('booru:pause-all-downloads');
    expect(IPC_CHANNELS.BOORU_RESUME_ALL_DOWNLOADS).toBe('booru:resume-all-downloads');
    expect(IPC_CHANNELS.BOORU_RESUME_PENDING_DOWNLOADS).toBe('booru:resume-pending-downloads');
    expect(IPC_CHANNELS.BOORU_GET_QUEUE_STATUS).toBe('booru:get-queue-status');
  });

  it('应包含 Booru 搜索历史通道', () => {
    expect(IPC_CHANNELS.BOORU_ADD_SEARCH_HISTORY).toBe('booru:add-search-history');
    expect(IPC_CHANNELS.BOORU_GET_SEARCH_HISTORY).toBe('booru:get-search-history');
    expect(IPC_CHANNELS.BOORU_CLEAR_SEARCH_HISTORY).toBe('booru:clear-search-history');
  });

  it('应包含 Booru 图片缓存通道', () => {
    expect(IPC_CHANNELS.BOORU_GET_CACHED_IMAGE_URL).toBe('booru:get-cached-image-url');
    expect(IPC_CHANNELS.BOORU_CACHE_IMAGE).toBe('booru:cache-image');
    expect(IPC_CHANNELS.BOORU_GET_CACHE_STATS).toBe('booru:get-cache-stats');
  });

  it('应包含 Booru 标签分类通道', () => {
    expect(IPC_CHANNELS.BOORU_GET_TAGS_CATEGORIES).toBe('booru:get-tags-categories');
  });

  it('应包含批量下载通道', () => {
    expect(IPC_CHANNELS.BULK_DOWNLOAD_CREATE_TASK).toBe('bulk-download:create-task');
    expect(IPC_CHANNELS.BULK_DOWNLOAD_GET_TASKS).toBe('bulk-download:get-tasks');
    expect(IPC_CHANNELS.BULK_DOWNLOAD_GET_TASK).toBe('bulk-download:get-task');
    expect(IPC_CHANNELS.BULK_DOWNLOAD_UPDATE_TASK).toBe('bulk-download:update-task');
    expect(IPC_CHANNELS.BULK_DOWNLOAD_DELETE_TASK).toBe('bulk-download:delete-task');
    expect(IPC_CHANNELS.BULK_DOWNLOAD_CREATE_SESSION).toBe('bulk-download:create-session');
    expect(IPC_CHANNELS.BULK_DOWNLOAD_GET_ACTIVE_SESSIONS).toBe('bulk-download:get-active-sessions');
    expect(IPC_CHANNELS.BULK_DOWNLOAD_START_SESSION).toBe('bulk-download:start-session');
    expect(IPC_CHANNELS.BULK_DOWNLOAD_PAUSE_SESSION).toBe('bulk-download:pause-session');
    expect(IPC_CHANNELS.BULK_DOWNLOAD_CANCEL_SESSION).toBe('bulk-download:cancel-session');
    expect(IPC_CHANNELS.BULK_DOWNLOAD_DELETE_SESSION).toBe('bulk-download:delete-session');
    expect(IPC_CHANNELS.BULK_DOWNLOAD_GET_SESSION_STATS).toBe('bulk-download:get-session-stats');
    expect(IPC_CHANNELS.BULK_DOWNLOAD_GET_RECORDS).toBe('bulk-download:get-records');
    expect(IPC_CHANNELS.BULK_DOWNLOAD_RETRY_ALL_FAILED).toBe('bulk-download:retry-all-failed');
    expect(IPC_CHANNELS.BULK_DOWNLOAD_RETRY_FAILED_RECORD).toBe('bulk-download:retry-failed-record');
    expect(IPC_CHANNELS.BULK_DOWNLOAD_RESUME_RUNNING_SESSIONS).toBe('bulk-download:resume-running-sessions');
  });

  it('应包含收藏标签管理通道', () => {
    expect(IPC_CHANNELS.BOORU_ADD_FAVORITE_TAG).toBe('booru:add-favorite-tag');
    expect(IPC_CHANNELS.BOORU_REMOVE_FAVORITE_TAG).toBe('booru:remove-favorite-tag');
    expect(IPC_CHANNELS.BOORU_REMOVE_FAVORITE_TAG_BY_NAME).toBe('booru:remove-favorite-tag-by-name');
    expect(IPC_CHANNELS.BOORU_GET_FAVORITE_TAGS).toBe('booru:get-favorite-tags');
    expect(IPC_CHANNELS.BOORU_GET_FAVORITE_TAGS_WITH_DOWNLOAD_STATE).toBe('booru:get-favorite-tags-with-download-state');
    expect(IPC_CHANNELS.BOORU_UPDATE_FAVORITE_TAG).toBe('booru:update-favorite-tag');
    expect(IPC_CHANNELS.BOORU_IS_FAVORITE_TAG).toBe('booru:is-favorite-tag');
    expect(IPC_CHANNELS.BOORU_GET_FAVORITE_TAG_DOWNLOAD_BINDING).toBe('booru:get-favorite-tag-download-binding');
    expect(IPC_CHANNELS.BOORU_UPSERT_FAVORITE_TAG_DOWNLOAD_BINDING).toBe('booru:upsert-favorite-tag-download-binding');
    expect(IPC_CHANNELS.BOORU_REMOVE_FAVORITE_TAG_DOWNLOAD_BINDING).toBe('booru:remove-favorite-tag-download-binding');
    expect(IPC_CHANNELS.BOORU_START_FAVORITE_TAG_BULK_DOWNLOAD).toBe('booru:start-favorite-tag-bulk-download');
  });

  it('应包含收藏标签分组管理通道', () => {
    expect(IPC_CHANNELS.BOORU_GET_FAVORITE_TAG_LABELS).toBe('booru:get-favorite-tag-labels');
    expect(IPC_CHANNELS.BOORU_ADD_FAVORITE_TAG_LABEL).toBe('booru:add-favorite-tag-label');
    expect(IPC_CHANNELS.BOORU_REMOVE_FAVORITE_TAG_LABEL).toBe('booru:remove-favorite-tag-label');
  });

  // === 一致性测试 ===

  it('所有通道值应唯一（无重复）', () => {
    const values = Object.values(IPC_CHANNELS);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
  });

  it('所有通道值应为非空字符串', () => {
    const values = Object.values(IPC_CHANNELS);
    for (const value of values) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('所有通道值应使用冒号命名空间格式', () => {
    const values = Object.values(IPC_CHANNELS);
    for (const value of values) {
      // 每个通道值都应包含 : 分隔符（如 "db:init", "booru:get-sites"）
      expect(value).toContain(':');
    }
  });

  it('通道键应使用 UPPER_SNAKE_CASE', () => {
    const keys = Object.keys(IPC_CHANNELS);
    for (const key of keys) {
      expect(key).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it('应包含页面偏好通道', () => {
    expect(IPC_CHANNELS.PAGE_PREFERENCES_GET_FAVORITE_TAGS).toBe('page-preferences:get-favorite-tags');
    expect(IPC_CHANNELS.PAGE_PREFERENCES_SAVE_FAVORITE_TAGS).toBe('page-preferences:save-favorite-tags');
    expect(IPC_CHANNELS.PAGE_PREFERENCES_GET_BLACKLISTED_TAGS).toBe('page-preferences:get-blacklisted-tags');
    expect(IPC_CHANNELS.PAGE_PREFERENCES_SAVE_BLACKLISTED_TAGS).toBe('page-preferences:save-blacklisted-tags');
    expect(IPC_CHANNELS.PAGE_PREFERENCES_GET_GALLERY).toBe('page-preferences:get-gallery');
    expect(IPC_CHANNELS.PAGE_PREFERENCES_SAVE_GALLERY).toBe('page-preferences:save-gallery');
    expect(IPC_CHANNELS.PAGE_PREFERENCES_GET_APP_SHELL).toBe('page-preferences:get-app-shell');
    expect(IPC_CHANNELS.PAGE_PREFERENCES_SAVE_APP_SHELL).toBe('page-preferences:save-app-shell');
  });

  it('应包含 Booru 外观偏好通道', () => {
    expect(IPC_CHANNELS.BOORU_PREFERENCES_GET_APPEARANCE).toBe('booru-preferences:get-appearance');
  });

  it('should include API service channels', () => {
    expect(IPC_CHANNELS.API_SERVICE_GET_CONFIG).toBe('api-service:get-config');
    expect(IPC_CHANNELS.API_SERVICE_SAVE_CONFIG).toBe('api-service:save-config');
    expect(IPC_CHANNELS.API_SERVICE_GET_STATUS).toBe('api-service:get-status');
    expect(IPC_CHANNELS.API_SERVICE_GENERATE_KEY).toBe('api-service:generate-key');
    expect(IPC_CHANNELS.API_SERVICE_GET_LOGS).toBe('api-service:get-logs');
    expect(IPC_CHANNELS.API_SERVICE_GET_PAIRING_INFO).toBe('api-service:get-pairing-info');
    expect(IPC_CHANNELS.API_SERVICE_STATUS_CHANGED).toBe('api-service:status-changed');
    expect(IPC_CHANNELS.API_SERVICE_LOG_RECEIVED).toBe('api-service:log-received');
  });

  it('应包含收藏一键下载通道', () => {
    expect(IPC_CHANNELS.BOORU_START_FAVORITES_BULK_DOWNLOAD).toBe('booru:start-favorites-bulk-download');
  });

  it('应有正确数量的通道', () => {
    const keys = Object.keys(IPC_CHANNELS);
    // 确保通道数量不会意外增减（随功能增加而更新）
    // bug9 新增 5：SYSTEM_NAVIGATE、CONFIG_GET/SET_NOTIFICATIONS、CONFIG_GET/SET_DESKTOP
    // 失败记录单删新增 1：BOORU_DELETE_DOWNLOAD_RECORD
    // Phase 1 API service adds 7 API_SERVICE_* channels.
    // Task 5 收藏一键下载新增 1：BOORU_START_FAVORITES_BULK_DOWNLOAD
    // 图库归一到数据库后移除 1：CONFIG_UPDATE_GALLERY_FOLDERS（197→196）
    // Phase 2B 图集成员读取新增 1：GALLERY_GET_IMAGES_BY_GALLERY（196→197）
    // Phase 6A 图库↔文件夹解耦新增 3：GALLERY_BIND_FOLDER、GALLERY_UNBIND_FOLDER、
    //   GALLERY_CHANGE_FOLDER_PATH（197→200）
    // Phase 6A relocate/missing 新增 3：GALLERY_RELOCATE_PREVIEW、GALLERY_RELOCATE_APPLY、
    //   GALLERY_GET_MISSING_FOLDERS（200→203）
    // Phase 6B 扫描入库 plan/apply 新增 2：GALLERY_PLAN_SCAN_FOLDER、GALLERY_APPLY_SCAN_PLAN（203→205）
    // Phase 7B 图集多文件夹管理新增 1：GALLERY_GET_FOLDERS（205→206）
    // Phase 8A contract 移除 2：GALLERY_GET_IMAGES_BY_FOLDER、GALLERY_SCAN_SUBFOLDERS（206→204）
    // [已停用] 注释停用绕过 gallery_images 成员的 3 个遗留图片导入通道：
    //   DB_ADD_IMAGE、IMAGE_SCAN_FOLDER、GALLERY_SCAN_AND_IMPORT_FOLDER（204→201）
    // 丢失文件夹横幅批量迁移新增 1：GALLERY_MIGRATE_MISSING_FOLDER_IMAGES（201→202）
    // 孤儿缩略图清理维护动作新增 1：IMAGE_CLEANUP_ORPHAN_THUMBNAILS（202→203）
    // M1-T13 移动端扫码配对新增 1：API_SERVICE_GET_PAIRING_INFO（203→204）
    expect(keys.length).toBe(204);
  });

  it('Phase 6B：应包含扫描入库 plan/apply 通道', () => {
    expect(IPC_CHANNELS.GALLERY_PLAN_SCAN_FOLDER).toBe('gallery:plan-scan-folder');
    expect(IPC_CHANNELS.GALLERY_APPLY_SCAN_PLAN).toBe('gallery:apply-scan-plan');
  });

  it('bug9：应包含 SYSTEM_NAVIGATE 与 notifications / desktop 分域配置通道', () => {
    expect(IPC_CHANNELS.SYSTEM_NAVIGATE).toBe('system:navigate');
    expect(IPC_CHANNELS.SYSTEM_APP_EVENT).toBe('system:app-event');
    expect(IPC_CHANNELS.CONFIG_GET_NOTIFICATIONS).toBe('config:get-notifications');
    expect(IPC_CHANNELS.CONFIG_SET_NOTIFICATIONS).toBe('config:set-notifications');
    expect(IPC_CHANNELS.CONFIG_GET_DESKTOP).toBe('config:get-desktop');
    expect(IPC_CHANNELS.CONFIG_SET_DESKTOP).toBe('config:set-desktop');
  });
});
