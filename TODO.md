# Yande Gallery Desktop - 开发任务规划

## 项目基础信息

### 一、核心数据类型 (src/shared/types.ts)

#### 1. 本地图库相关

```typescript
// 本地图片
interface Image {
  id: number;
  filename: string;
  filepath: string;
  fileSize: number;
  width: number;
  height: number;
  format: string;
  createdAt: string;
  updatedAt: string;
  tags?: Tag[];
}

// 本地标签
interface Tag {
  id: number;
  name: string;
  category?: string;
  createdAt: string;
}
```

#### 2. Booru 站点相关

```typescript
// Booru 站点配置
interface BooruSite {
  id: number;
  name: string;                                    // 站点名称
  url: string;                                     // 站点 URL
  type: 'moebooru' | 'danbooru' | 'gelbooru';     // 站点类型
  salt?: string;                                   // 密码加密盐值
  version?: string;                                // API 版本
  apiKey?: string;                                 // API Key
  username?: string;                               // 用户名
  passwordHash?: string;                           // 密码哈希
  favoriteSupport: boolean;                        // 是否支持收藏
  active: boolean;                                 // 是否激活
  createdAt: string;
  updatedAt: string;
}

// Booru 图片
interface BooruPost {
  id: number;
  siteId: number;                                  // 关联站点 ID
  postId: number;                                  // 原始图片 ID
  md5?: string;                                    // 文件 MD5
  fileUrl: string;                                 // 原图 URL
  previewUrl?: string;                             // 预览图 URL
  sampleUrl?: string;                              // 样本图 URL
  width?: number;
  height?: number;
  fileSize?: number;
  fileExt?: string;
  rating?: 'safe' | 'questionable' | 'explicit';  // 分级
  score?: number;                                  // 评分
  source?: string;                                 // 来源
  tags: string;                                    // 标签字符串（空格分隔）
  downloaded: boolean;                             // 是否已下载
  localPath?: string;                              // 本地路径
  localImageId?: number;                           // 本地图片 ID
  isFavorited: boolean;                            // 是否收藏
  createdAt: string;
  updatedAt: string;
}

// Booru 标签
interface BooruTag {
  id: number;
  siteId: number;
  name: string;
  category?: 'artist' | 'character' | 'copyright' | 'general' | 'meta';
  postCount: number;
  createdAt: string;
}

// Booru 收藏
interface BooruFavorite {
  id: number;
  postId: number;
  siteId: number;
  notes?: string;
  createdAt: string;
}

// 下载队列项
interface DownloadQueueItem {
  id: number;
  postId: number;
  siteId: number;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'paused';
  progress: number;                                // 0-100
  downloadedBytes: number;
  totalBytes: number;
  errorMessage?: string;
  retryCount: number;
  priority: number;
  targetPath?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// 搜索历史
interface SearchHistoryItem {
  id: number;
  siteId: number;
  query: string;
  resultCount: number;
  createdAt: string;
}
```

#### 3. 批量下载相关

```typescript
// 批量下载任务状态
type BulkDownloadSessionStatus = 
  | 'pending' | 'dryRun' | 'running' | 'completed' 
  | 'allSkipped' | 'failed' | 'paused' | 'suspended' | 'cancelled';

// 批量下载记录状态
type BulkDownloadRecordStatus = 
  | 'pending' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';

// 批量下载任务
interface BulkDownloadTask {
  id: string;
  siteId: number;
  path: string;                   // 下载目录
  tags: string;                   // 搜索标签
  blacklistedTags?: string;       // 黑名单标签
  notifications: boolean;
  skipIfExists: boolean;
  quality?: string;
  perPage: number;
  concurrency: number;
  createdAt: string;
  updatedAt: string;
}

// 批量下载会话
interface BulkDownloadSession {
  id: string;
  taskId: string;
  siteId: number;
  status: BulkDownloadSessionStatus;
  startedAt: string;
  completedAt?: string;
  currentPage: number;
  totalPages?: number;
  error?: string;
  task?: BulkDownloadTask;
  stats?: BulkDownloadSessionStats;
}

// 批量下载会话统计
interface BulkDownloadSessionStats {
  sessionId: string;
  coverUrl?: string;
  siteUrl?: string;
  totalFiles: number;
  totalSize?: number;
  // ... 更多统计字段
}
```

#### 4. 通用类型

```typescript
// API 响应格式
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
```

---

### 二、IPC 通道定义 (src/main/ipc/channels.ts)

#### 已实现的通道分类

| 分类 | 通道数量 | 说明 | 状态 |
|------|---------|------|------|
| 数据库操作 | 10 | DB_INIT, DB_GET_IMAGES, DB_SEARCH_IMAGES 等 | ✅ 正常工作 |
| 图片操作 | 3 | IMAGE_SCAN_FOLDER, IMAGE_GENERATE_THUMBNAIL 等 | ✅ 正常工作 |
| Yande.re API | 3 | YANDE_GET_IMAGES, YANDE_SEARCH_IMAGES 等 | ⚠️ **Mock 数据**（返回模拟数据，非真实 API） |
| 下载管理 | 5 | DOWNLOAD_START, DOWNLOAD_PAUSE 等 | ⚠️ 简化版/未完整实现 |
| 系统操作 | 3 | SYSTEM_SELECT_FOLDER, SYSTEM_OPEN_EXTERNAL 等 | ✅ 正常工作 |
| Booru 站点管理 | 6 | BOORU_GET_SITES, BOORU_ADD_SITE 等 | ✅ 正常工作 |
| Booru 图片 | 4 | BOORU_GET_POSTS, BOORU_SEARCH_POSTS 等 | ✅ 正常工作 |
| Booru 标签 | 4 | BOORU_GET_TAGS, BOORU_SEARCH_TAGS 等 | ⚠️ 部分实现（仅 getTagsCategories） |
| Booru 收藏 | 5 | BOORU_ADD_FAVORITE, BOORU_GET_FAVORITES 等 | ✅ **本地收藏**（非服务器收藏） |
| Booru 下载 | 9 | BOORU_ADD_TO_DOWNLOAD, BOORU_GET_DOWNLOAD_QUEUE 等 | ✅ 正常工作 |
| Booru 缓存 | 3 | BOORU_GET_CACHED_IMAGE_URL, BOORU_CACHE_IMAGE 等 | ✅ 正常工作 |
| 批量下载 | 15 | BULK_DOWNLOAD_CREATE_TASK, BULK_DOWNLOAD_START_SESSION 等 | ✅ 正常工作 |

**注意**：
- ⚠️ **Yande.re API** 返回的是 mock 模拟数据，不是真实的 API 调用
- ⚠️ **Booru 收藏** 是本地数据库收藏，不是服务器端收藏（服务器收藏需要登录）

---

### 三、Preload API 结构 (src/preload/index.ts)

```typescript
window.electronAPI = {
  db: { init, getImages, addImage, searchImages },
  gallery: { getRecentImages, getGalleries, getGallery, createGallery, ... },
  config: { get, save, updateGalleryFolders, reload },
  image: { scanFolder, generateThumbnail, getThumbnail, deleteThumbnail },
  yande: { getImages, searchImages, downloadImage },
  booru: { 
    // 站点管理
    getSites, addSite, updateSite, deleteSite, getActiveSite,
    // 图片操作
    getPosts, getPost, searchPosts,
    // 收藏管理
    getFavorites, addFavorite, removeFavorite,
    // 下载管理
    addToDownload, retryDownload, getDownloadQueue, clearDownloadRecords,
    // 缓存
    getCachedImageUrl, cacheImage, getCacheStats,
    // 标签
    getTagsCategories,
    // 事件监听
    onDownloadProgress, onDownloadStatus
  },
  bulkDownload: {
    createTask, getTasks, getTask, updateTask, deleteTask,
    createSession, getActiveSessions,
    startSession, pauseSession, cancelSession, deleteSession,
    getSessionStats, getRecords,
    retryAllFailed, retryFailedRecord
  },
  system: { selectFolder, openExternal, showItem, testBaidu, testGoogle }
}
```

---

### 四、主进程服务 (src/main/services/)

| 服务文件 | 功能说明 |
|---------|---------|
| `database.ts` | SQLite 数据库连接和表创建 |
| `config.ts` | YAML 配置文件管理 |
| `imageService.ts` | 本地图片服务 |
| `galleryService.ts` | 图库/图集服务 |
| `thumbnailService.ts` | 缩略图生成服务（WebP 格式） |
| `moebooruClient.ts` | Moebooru API 客户端 |
| `booruService.ts` | Booru 数据库操作服务 |
| `downloadManager.ts` | 下载队列管理器 |
| `bulkDownloadService.ts` | 批量下载服务 |
| `filenameGenerator.ts` | 文件名生成器（Token 模板） |
| `imageCacheService.ts` | 图片缓存服务 |
| `init.ts` | 应用初始化服务 |

---

### 五、渲染进程页面 (src/renderer/pages/)

| 页面文件 | 功能说明 |
|---------|---------|
| `GalleryPage.tsx` | 本地图库页面（最近/全部/图集） |
| `BooruPage.tsx` | Booru 图片浏览页面 |
| `BooruFavoritesPage.tsx` | Booru 收藏页面 |
| `BooruPostDetailsPage.tsx` | 图片详情页 |
| `BooruTagSearchPage.tsx` | 标签搜索页面 |
| `BooruDownloadPage.tsx` | 下载管理页面 |
| `BooruBulkDownloadPage.tsx` | 批量下载页面 |
| `BooruSettingsPage.tsx` | 站点配置页面 |
| `SettingsPage.tsx` | 应用设置页面 |
| `DownloadPage.tsx` | Yande.re 下载页面（旧版） |

---

### 六、渲染进程组件 (src/renderer/components/)

| 组件文件 | 功能说明 |
|---------|---------|
| `ImageGrid.tsx` | 图片网格/瀑布流布局 |
| `ImageListWrapper.tsx` | 图片列表包装器 |
| `ImageSearchBar.tsx` | 搜索栏组件 |
| `LazyLoadFooter.tsx` | 懒加载底部组件 |
| `BooruImageCard.tsx` | Booru 图片卡片 |
| `GalleryCoverImage.tsx` | 图集封面组件 |
| `BulkDownloadTaskForm.tsx` | 批量下载任务表单 |
| `BulkDownloadSessionCard.tsx` | 批量下载会话卡片 |
| `BulkDownloadSessionDetail.tsx` | 批量下载会话详情 |
| `BooruPostDetails/` | 详情页子组件目录 |

---

### 七、开发规范

#### 1. 日志输出规范
```typescript
// 模块前缀格式
console.log('[模块名] 操作说明:', 数据);
console.error('[模块名] 错误说明:', error);
console.warn('[模块名] 警告说明:', data);

// 示例
console.log('[BooruService] 获取站点列表');
console.error('[MoebooruClient] API 请求失败:', error);
```

#### 2. IPC 通信模式
```typescript
// 主进程处理器
ipcMain.handle('channel-name', async (event, ...args) => {
  try {
    const result = await someOperation(args);
    return { success: true, data: result };
  } catch (error) {
    console.error('[IPC] 操作失败:', error);
    return { success: false, error: error.message };
  }
});

// 渲染进程调用
const result = await window.electronAPI.module.method(args);
if (result.success) {
  // 处理成功
} else {
  // 处理错误
}
```

#### 3. React 组件规范
- 使用函数式组件 + Hooks
- 使用 `React.memo` 优化性能
- 使用 `App.useApp()` 获取 message/modal 等 API
- 使用 Ant Design 5.x 组件库

---

## 待开发功能规划

### 参考项目：Boorusama

**GitHub 仓库**：https://github.com/khoadng/Boorusama
**本地路径**：`Boorusama-master-official/`（git submodule）

#### 核心功能模块详细路径

##### 1. 标签黑名单 (`lib/core/blacklists/`)

| 文件 | 说明 |
|------|------|
| `src/types/blacklisted_tag.dart` | **BlacklistedTag 数据类型**：id, name, isActive, createdDate, updatedDate |
| `src/types/blacklisted_tag_repository.dart` | **仓库接口**：addTag, addTags, removeTag, getBlacklist, updateTag |
| `src/providers/global_blacklisted_tag_notifier.dart` | **状态管理**：增删改查黑名单标签，支持批量导入 |
| `src/pages/blacklisted_tag_page.dart` | **UI 页面**：黑名单管理页面实现 |
| `src/data/hive/tag_repository.dart` | **数据存储**：Hive 本地数据库实现 |

##### 2. 收藏标签 (`lib/core/tags/favorites/`)

| 文件 | 说明 |
|------|------|
| `src/types/favorite_tag.dart` | **FavoriteTag 数据类型**：name, createdAt, updatedAt, labels（分组）, queryType |
| `src/providers/favorite_tags_notifier.dart` | **状态管理**：load, add, update, remove, import, export |
| `src/pages/favorite_tags_page.dart` | **UI 页面**：收藏标签管理页面 |
| `src/pages/favorite_tag_labels_page.dart` | **分组管理**：标签分组/标签页面 |
| `src/data/favorite_tag_repository_hive.dart` | **数据存储**：Hive 本地数据库实现 |

##### 3. 导入导出 (`lib/core/backups/sources/`)

| 文件 | 说明 |
|------|------|
| `blacklisted_tags_source.dart` | **黑名单导入导出**：支持 JSON 和简单文本格式 |
| `favorite_tags_source.dart` | **收藏标签导入导出**：支持 JSON 和简单文本格式 |
| `json_source.dart` | **JSON 处理基类**：通用的 JSON 序列化/反序列化 |

##### 4. Moebooru 客户端 (`packages/booru_clients/lib/src/moebooru/`)

| 文件 | 说明 |
|------|------|
| `moebooru_client.dart` | **API 客户端**：完整的 Moebooru API 实现 |
| `types/post_dto.dart` | **帖子数据传输对象** |
| `types/comment_dto.dart` | **评论数据传输对象** |
| `types/tag_summary_dto.dart` | **标签摘要数据传输对象** |

##### 5. Moebooru 特定功能 (`lib/boorus/moebooru/`)

| 文件 | 说明 |
|------|------|
| `favorites/providers.dart` | **收藏用户列表**：获取谁收藏了某张图片 |
| `popular/providers.dart` | **热门图片**：按时间段获取热门图片 |
| `comments/providers.dart` | **评论功能**：获取和显示评论 |
| `post_details/src/widgets/toolbar.dart` | **详情页工具栏**：投票、收藏等操作 |

##### 6. 本地书签 (`lib/core/bookmarks/`)

| 文件 | 说明 |
|------|------|
| `src/types/bookmark.dart` | **Bookmark 数据类型**：完整保存帖子信息到本地 |
| `src/types/bookmark_repository.dart` | **仓库接口**：增删改查书签 |
| `src/providers/bookmark_provider.dart` | **状态管理**：书签状态管理 |
| `src/pages/bookmark_page.dart` | **UI 页面**：书签浏览页面 |

---

### Moebooru API 实现状态

#### moebooruClient.ts 中已实现的方法

| API 方法 | 端点 | 客户端方法 | IPC Handler | Preload API | 状态 |
|---------|------|-----------|-------------|-------------|------|
| `getPosts()` | `/post.json` | ✅ | ✅ 被调用 | ✅ | **已完成** |
| `getPost()` | `/post.json?tags=id:X` | ✅ | ✅ 被调用 | ✅ | **已完成** |
| `getTags()` | `/tag.json` | ✅ | ⚠️ 未直接调用 | ⚠️ | 未使用 |
| `getTagsByNames()` | `/tag.json` | ✅ | ✅ 在 getPosts 中调用 | ✅ | **已完成** |
| `getTagSummary()` | `/tag/summary.json` | ✅ | ⚠️ 在 getTagsByNames 内部调用 | ❌ | 内部使用 |
| `hashPasswordSHA1()` | - | ✅ | ❌ 未使用 | ❌ | **仅示例代码** |
| `testConnection()` | - | ✅ | ❌ 未使用 | ❌ | **仅示例代码** |
| `votePost()` | `/post/vote.json` | ✅ | ❌ 未使用 | ❌ | **仅示例代码** |
| `favoritePost()` | `/post/vote.json?score=3` | ✅ | ❌ 未使用 | ❌ | **仅示例代码** |
| `unfavoritePost()` | `/post/vote.json?score=0` | ✅ | ❌ 未使用 | ❌ | **仅示例代码** |
| `getPopularRecent()` | `/post/popular_recent.json` | ✅ | ❌ 未使用 | ❌ | **仅示例代码** |
| `getPopularByDay()` | `/post/popular_by_day.json` | ✅ | ❌ 未使用 | ❌ | **仅示例代码** |
| `getComments()` | `/comment.json` | ✅ | ❌ 未使用 | ❌ | **仅示例代码** |
| `getFavoriteUsers()` | `/favorite/list_users.json` | ✅ | ❌ 未使用 | ❌ | **仅示例代码** |

**状态说明**：
- **已完成**：客户端方法 + IPC Handler 调用 + Preload API 暴露，前端可调用
- **仅示例代码**：只在 moebooruClient.ts 中实现了方法，但**没有被任何 IPC Handler 调用**，前端无法使用
- **内部使用**：被其他方法内部调用，但没有单独暴露
- **未使用**：方法存在但未被使用

⚠️ **重要提示**：标记为"仅示例代码"的方法虽然代码已写好，但要让前端能用，还需要：
1. 在 `handlers.ts` 添加 IPC Handler 调用这些方法
2. 在 `channels.ts` 添加 IPC 通道定义
3. 在 `preload/index.ts` 暴露 API

#### 待实现的功能链路

以下 API 虽然客户端方法已实现，但需要补充 IPC 通道和 Preload API：

| 功能 | 需要添加的 IPC 通道 | 需要添加的 Preload API |
|-----|-------------------|---------------------|
| 投票 | `BOORU_VOTE_POST` | `booru.votePost()` |
| 服务器收藏 | `BOORU_SERVER_FAVORITE` | `booru.serverFavorite()` |
| 取消服务器收藏 | `BOORU_SERVER_UNFAVORITE` | `booru.serverUnfavorite()` |
| 获取收藏用户 | `BOORU_GET_FAVORITE_USERS` | `booru.getFavoriteUsers()` |
| 近期热门 | `BOORU_GET_POPULAR_RECENT` | `booru.getPopularRecent()` |
| 指定日期热门 | `BOORU_GET_POPULAR_BY_DAY` | `booru.getPopularByDay()` |
| 获取评论 | `BOORU_GET_COMMENTS` | `booru.getComments()` |
| 密码哈希 | `BOORU_HASH_PASSWORD` | `booru.hashPassword()` |

#### 完全未实现的 API

| API | 端点 | 说明 |
|-----|------|------|
| `getUserFavorites()` | `/post.json?tags=fav:username` | 获取用户收藏列表 |
| `getPopularByWeek()` | `/post/popular_by_week.json` | 按周热门 |
| `getPopularByMonth()` | `/post/popular_by_month.json` | 按月热门 |
| `getPools()` | `/pool.json` | 获取 Pool 列表 |
| `getPool()` | `/pool/show.json?id=X` | 获取 Pool 详情 |
| `createComment()` | `/comment/create.json` | 发表评论 |

---

### 第一阶段：标签管理增强 (优先级: 高)

#### 1.1 标签收藏功能

**需求描述**：
- 用户可以收藏常用标签，方便快速搜索
- 收藏的标签在搜索框中优先显示
- 支持标签分组管理（labels）
- 支持快速点击收藏标签进行搜索

**Boorusama 参考**：
```
lib/core/tags/favorites/
├── src/
│   ├── types/
│   │   └── favorite_tag.dart          # FavoriteTag 数据类型
│   ├── providers/
│   │   └── favorite_tags_notifier.dart # 状态管理：load/add/update/remove/import/export
│   ├── pages/
│   │   ├── favorite_tags_page.dart     # 收藏标签列表页面
│   │   └── edit_favorite_tag_sheet.dart # 编辑标签弹窗
│   └── data/
│       └── favorite_tag_repository_hive.dart # 数据存储实现
```

**Boorusama FavoriteTag 数据结构**：
```dart
class FavoriteTag {
  final String name;           // 标签名
  final DateTime createdAt;    // 创建时间
  final DateTime? updatedAt;   // 更新时间
  final List<String>? labels;  // 分组标签（可多个）
  final QueryType? queryType;  // 查询类型：null=单标签, simple=原始查询, list=标签列表
}
```

**数据库设计**：
```sql
-- 收藏标签表
CREATE TABLE booru_favorite_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  siteId INTEGER,                   -- NULL 表示全局收藏
  tagName TEXT NOT NULL,
  labels TEXT,                      -- JSON 数组，用户自定义分组
  queryType TEXT DEFAULT 'tag',     -- 'tag' | 'raw' | 'list'
  notes TEXT,                       -- 备注
  sortOrder INTEGER DEFAULT 0,      -- 排序顺序
  createdAt TEXT NOT NULL,
  updatedAt TEXT,
  FOREIGN KEY (siteId) REFERENCES booru_sites(id) ON DELETE CASCADE,
  UNIQUE(siteId, tagName)
);

-- 标签分组表（可选，用于管理分组本身）
CREATE TABLE booru_favorite_tag_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT,                       -- 分组颜色
  sortOrder INTEGER DEFAULT 0,
  createdAt TEXT NOT NULL
);

CREATE INDEX idx_favorite_tags_siteId ON booru_favorite_tags(siteId);
CREATE INDEX idx_favorite_tags_labels ON booru_favorite_tags(labels);
```

**类型定义** (src/shared/types.ts)：
```typescript
// 收藏标签
interface FavoriteTag {
  id: number;
  siteId: number | null;      // null = 全局
  tagName: string;
  labels?: string[];          // 分组标签
  queryType: 'tag' | 'raw' | 'list';  // 查询类型
  notes?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt?: string;
}

// 标签分组
interface FavoriteTagLabel {
  id: number;
  name: string;
  color?: string;
  sortOrder: number;
  createdAt: string;
}
```

**IPC 通道** (src/main/ipc/channels.ts)：
```typescript
// 收藏标签管理
BOORU_ADD_FAVORITE_TAG: 'booru:add-favorite-tag',
BOORU_REMOVE_FAVORITE_TAG: 'booru:remove-favorite-tag',
BOORU_GET_FAVORITE_TAGS: 'booru:get-favorite-tags',
BOORU_UPDATE_FAVORITE_TAG: 'booru:update-favorite-tag',

// 分组管理
BOORU_GET_FAVORITE_TAG_LABELS: 'booru:get-favorite-tag-labels',
BOORU_ADD_FAVORITE_TAG_LABEL: 'booru:add-favorite-tag-label',
BOORU_REMOVE_FAVORITE_TAG_LABEL: 'booru:remove-favorite-tag-label',
```

**服务层实现** (src/main/services/booruService.ts)：
```typescript
// 添加收藏标签
async addFavoriteTag(siteId: number | null, tagName: string, options?: {
  labels?: string[];
  queryType?: 'tag' | 'raw' | 'list';
  notes?: string;
}): Promise<FavoriteTag>

// 获取收藏标签列表
async getFavoriteTags(siteId?: number): Promise<FavoriteTag[]>

// 更新收藏标签
async updateFavoriteTag(id: number, updates: Partial<FavoriteTag>): Promise<FavoriteTag>

// 删除收藏标签
async removeFavoriteTag(id: number): Promise<void>

// 检查标签是否已收藏
async isFavoriteTag(siteId: number | null, tagName: string): Promise<boolean>
```

**UI 实现清单**：
- [x] 在 `TagsSection.tsx` 标签添加星标收藏按钮（点击切换收藏状态）✅
- [ ] 在 `BooruTagSearchPage.tsx` 搜索结果中显示收藏状态
- [x] 创建 `FavoriteTagsPage.tsx` 收藏标签管理页面（列表、快速搜索、添加、编辑、删除）✅
- [x] 在收藏标签页面显示快速搜索标签云 ✅
- [x] 支持标签分组筛选（按站点筛选）✅
- [ ] 支持拖拽排序（使用 `@dnd-kit/core`）
- [x] 编辑收藏标签弹窗（内置于 FavoriteTagsPage）✅
- [x] 在 App.tsx 添加收藏标签页面路由和侧栏菜单 ✅

---

#### 1.2 标签黑名单功能

**需求描述**：
- 用户可以设置黑名单标签
- 包含黑名单标签的图片在浏览时自动隐藏
- 黑名单可在配置中管理
- 支持临时禁用黑名单过滤
- 支持 `isActive` 状态控制单个标签是否生效

**Boorusama 参考**：
```
lib/core/blacklists/
├── src/
│   ├── types/
│   │   ├── blacklisted_tag.dart           # BlacklistedTag: id, name, isActive, createdDate, updatedDate
│   │   ├── blacklisted_tag_repository.dart # 仓库接口：addTag, removeTag, getBlacklist, updateTag
│   │   └── utils.dart                      # 排序和过滤工具函数
│   ├── providers/
│   │   └── global_blacklisted_tag_notifier.dart # 状态管理：支持批量导入 addTagString()
│   ├── pages/
│   │   ├── blacklisted_tag_page.dart       # 黑名单管理页面
│   │   └── blacklisted_tag_config_sheet.dart # 排序配置弹窗
│   └── data/
│       └── hive/tag_repository.dart        # Hive 本地存储实现
```

**Boorusama BlacklistedTag 数据结构**：
```dart
class BlacklistedTag {
  final int id;
  final String name;
  final bool isActive;        // 是否激活（可临时禁用单个标签）
  final DateTime createdDate;
  final DateTime updatedDate;
}
```

**数据库设计**：
```sql
CREATE TABLE booru_blacklisted_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  siteId INTEGER,                   -- NULL 表示全局黑名单
  tagName TEXT NOT NULL,
  isActive INTEGER DEFAULT 1,       -- 是否激活
  reason TEXT,                      -- 黑名单原因（可选）
  createdAt TEXT NOT NULL,
  updatedAt TEXT,
  FOREIGN KEY (siteId) REFERENCES booru_sites(id) ON DELETE CASCADE,
  UNIQUE(siteId, tagName)
);

CREATE INDEX idx_blacklisted_tags_siteId ON booru_blacklisted_tags(siteId);
CREATE INDEX idx_blacklisted_tags_active ON booru_blacklisted_tags(isActive);
```

**类型定义** (src/shared/types.ts)：
```typescript
interface BlacklistedTag {
  id: number;
  siteId: number | null;  // null = 全局
  tagName: string;
  isActive: boolean;      // 是否激活
  reason?: string;
  createdAt: string;
  updatedAt?: string;
}

// 黑名单排序类型
type BlacklistedTagsSortType = 'recentlyAdded' | 'nameAZ' | 'nameZA';
```

**IPC 通道** (src/main/ipc/channels.ts)：
```typescript
BOORU_ADD_BLACKLISTED_TAG: 'booru:add-blacklisted-tag',
BOORU_ADD_BLACKLISTED_TAGS: 'booru:add-blacklisted-tags',  // 批量添加
BOORU_REMOVE_BLACKLISTED_TAG: 'booru:remove-blacklisted-tag',
BOORU_GET_BLACKLISTED_TAGS: 'booru:get-blacklisted-tags',
BOORU_UPDATE_BLACKLISTED_TAG: 'booru:update-blacklisted-tag',
BOORU_TOGGLE_BLACKLISTED_TAG: 'booru:toggle-blacklisted-tag',  // 切换激活状态
```

**服务层实现** (src/main/services/booruService.ts)：
```typescript
// 添加黑名单标签
async addBlacklistedTag(tagName: string, siteId?: number): Promise<BlacklistedTag>

// 批量添加（支持换行分隔的字符串）
async addBlacklistedTags(tagString: string, siteId?: number): Promise<BlacklistedTag[]>

// 获取黑名单列表
async getBlacklistedTags(siteId?: number): Promise<BlacklistedTag[]>

// 获取激活的黑名单标签名列表（用于过滤）
async getActiveBlacklistTagNames(siteId?: number): Promise<string[]>

// 更新黑名单标签
async updateBlacklistedTag(id: number, updates: Partial<BlacklistedTag>): Promise<BlacklistedTag>

// 切换激活状态
async toggleBlacklistedTag(id: number): Promise<BlacklistedTag>

// 删除黑名单标签
async removeBlacklistedTag(id: number): Promise<void>
```

**过滤逻辑实现**：
```typescript
// 方式1：前端过滤（推荐，灵活性高）
function filterBlacklistedPosts(posts: BooruPost[], blacklist: string[]): {
  filtered: BooruPost[];
  hiddenCount: number;
} {
  const filtered = posts.filter(post => {
    const postTags = post.tags.split(' ');
    return !postTags.some(tag => blacklist.includes(tag));
  });
  return {
    filtered,
    hiddenCount: posts.length - filtered.length
  };
}

// 方式2：API 请求时排除（Moebooru 支持 -tag 语法）
function buildSearchTags(searchTags: string[], blacklist: string[]): string[] {
  return [...searchTags, ...blacklist.map(tag => `-${tag}`)];
}
```

**UI 实现清单**：
- [x] 创建 `BlacklistedTagsPage.tsx` 黑名单管理页面 ✅
- [x] 在 `TagsSection.tsx` 标签右键菜单添加"加入黑名单"选项 ✅
- [x] 在 `BooruPage.tsx` 添加黑名单过滤逻辑 ✅
- [x] 在图片列表顶部显示"已隐藏 X 张图片"提示 ✅
- [x] 添加全局黑名单开关（临时显示所有图片）✅
- [x] 支持单个标签的激活/禁用切换 ✅
- [x] 支持批量导入黑名单（每行一个标签）✅
- [x] 在 App.tsx 添加黑名单页面路由 ✅

---

#### 1.3 收藏/黑名单标签导入导出

**需求描述**：
- 支持将收藏标签和黑名单导出为 JSON/TXT 文件
- 支持从文件导入标签
- 支持合并导入（不覆盖现有数据）
- 支持简单文本格式（每行一个标签）
- 支持复制到剪贴板

**Boorusama 参考**：
```
lib/core/backups/sources/
├── blacklisted_tags_source.dart    # 黑名单导入导出
├── favorite_tags_source.dart       # 收藏标签导入导出
├── json_source.dart                # JSON 处理基类
└── providers.dart                  # 备份数据提供者
```

**Boorusama 导出实现**：
```dart
// 简单文本导出（复制到剪贴板）
final tagString = tags.map((e) => e.name).join('\n');
await AppClipboard.copy(tagString);

// 简单文本导入（每行一个标签）
final tags = tagString.split('\n');
for (final tag in tags) {
  await repo.addTag(tag.trim());
}

// JSON 导出
final data = tags.map((tag) => tag.toJson()).toList();
final json = jsonEncode(data);
```

**导出格式**：

**格式1：简单文本格式 (.txt)**
```
hatsune_miku
landscape
blue_eyes
long_hair
```

**格式2：完整 JSON 格式 (.json)**
```json
{
  "version": "1.0",
  "appVersion": "2.0.0",
  "exportedAt": "2025-12-22T10:00:00Z",
  "data": {
    "favoriteTags": [
      {
        "tagName": "hatsune_miku",
        "labels": ["角色", "vocaloid"],
        "queryType": "tag",
        "createdAt": "2025-12-01T00:00:00Z"
      }
    ],
    "blacklistedTags": [
      {
        "tagName": "ugly_tag",
        "isActive": true,
        "reason": "不喜欢",
        "createdAt": "2025-12-01T00:00:00Z"
      }
    ]
  }
}
```

**IPC 通道** (src/main/ipc/channels.ts)：
```typescript
// 导出
BOORU_EXPORT_FAVORITE_TAGS: 'booru:export-favorite-tags',
BOORU_EXPORT_BLACKLISTED_TAGS: 'booru:export-blacklisted-tags',
BOORU_EXPORT_ALL_TAGS: 'booru:export-all-tags',

// 导入
BOORU_IMPORT_FAVORITE_TAGS: 'booru:import-favorite-tags',
BOORU_IMPORT_BLACKLISTED_TAGS: 'booru:import-blacklisted-tags',
BOORU_IMPORT_ALL_TAGS: 'booru:import-all-tags',
```

**服务层实现** (src/main/services/tagExportService.ts)：
```typescript
interface ExportOptions {
  format: 'json' | 'txt';
  includeMetadata?: boolean;  // 是否包含创建时间等元数据
}

interface ImportOptions {
  mode: 'merge' | 'replace';  // 合并或替换
  siteId?: number;            // 指定站点
}

// 导出收藏标签
async exportFavoriteTags(options: ExportOptions): Promise<string>

// 导出黑名单标签
async exportBlacklistedTags(options: ExportOptions): Promise<string>

// 导出所有标签
async exportAllTags(options: ExportOptions): Promise<string>

// 导入收藏标签
async importFavoriteTags(content: string, options: ImportOptions): Promise<{
  added: number;
  skipped: number;
  errors: string[];
}>

// 导入黑名单标签
async importBlacklistedTags(content: string, options: ImportOptions): Promise<{
  added: number;
  skipped: number;
  errors: string[];
}>

// 解析导入内容（自动检测格式）
async parseImportContent(content: string): Promise<{
  format: 'json' | 'txt';
  favoriteTags?: FavoriteTag[];
  blacklistedTags?: BlacklistedTag[];
}>
```

**UI 实现清单**：
- [ ] 在设置页面添加"标签管理"区域
- [ ] 添加"导出收藏标签"按钮（支持 JSON/TXT）
- [ ] 添加"导出黑名单"按钮（支持 JSON/TXT）
- [ ] 添加"导入标签"按钮
- [ ] 创建 `ImportTagsModal.tsx` 导入预览弹窗
- [ ] 支持拖拽文件导入
- [ ] 支持从剪贴板粘贴导入
- [ ] 显示导入结果统计（新增/跳过/错误）
- [ ] 支持选择性导入（勾选要导入的标签）

---

### 第二阶段：用户认证功能 (优先级: 高)

#### 2.1 Yande.re/Moebooru 登录配置

**需求描述**：
- 支持配置用户名和密码哈希
- 自动生成密码哈希（使用站点 Salt）
- 登录后支持：
  - 同步服务器收藏
  - 为图片投票（喜欢功能）
  - 查看个人收藏
  - 查看谁收藏了某张图片

**Boorusama 参考**：
```
packages/booru_clients/lib/src/moebooru/
├── moebooru_client.dart    # API 客户端实现
│   ├── _authParams         # 认证参数：login + password_hash
│   ├── votePost()          # 投票 API
│   ├── favoritePost()      # 收藏 API（score=3）
│   └── getFavoriteUsers()  # 获取收藏用户列表

lib/boorus/moebooru/
├── configs/
│   └── types.dart          # MoebooruConfig 配置类型
└── favorites/
    └── providers.dart      # 收藏用户列表状态管理
```

**Moebooru 认证机制**：
```typescript
// 密码哈希算法（SHA1）
function hashPassword(password: string, salt: string): string {
  // salt 格式：xxx--{0}--xxx，{0} 会被替换为密码
  const saltedPassword = salt.replace('{0}', password);
  return crypto.createHash('sha1').update(saltedPassword).digest('hex');
}

// 各站点 Salt（从站点获取或硬编码）
const SITE_SALTS: Record<string, string> = {
  'yande.re': 'choujin-steiner--{0}--',
  'konachan.com': 'So-I-Heard-You-Like-Mupkids-?--{0}--',
  'konachan.net': 'So-I-Heard-You-Like-Mupkids-?--{0}--',
  'lolibooru.moe': 'lolicondaise--{0}--',
};

// API 请求时附带认证参数
const authParams = {
  login: username,
  password_hash: passwordHash
};
```

**数据库变更**：
- `booru_sites` 表已有 `username`、`passwordHash`、`salt` 字段
- 新增 `isLoggedIn` 字段（可选，用于 UI 显示）

**IPC 通道** (src/main/ipc/channels.ts)：
```typescript
BOORU_LOGIN: 'booru:login',                     // 登录（生成密码哈希）
BOORU_LOGOUT: 'booru:logout',                   // 登出（清除认证信息）
BOORU_TEST_AUTH: 'booru:test-auth',             // 测试认证是否有效
BOORU_GET_SITE_SALT: 'booru:get-site-salt',     // 获取站点 salt
```

**服务层实现** (src/main/services/moebooruClient.ts)：
```typescript
// 已实现的方法
hashPasswordSHA1(salt: string, password: string): string

// 新增方法
async login(username: string, password: string): Promise<{
  success: boolean;
  passwordHash?: string;
  error?: string;
}>

async testAuth(): Promise<boolean>  // 通过尝试获取用户信息验证
```

**UI 实现清单**：
- [ ] 在 `BooruSettingsPage.tsx` 添加登录表单
  - [ ] 用户名输入框
  - [ ] 密码输入框（输入后自动哈希，不存储明文）
  - [ ] "登录"按钮
  - [ ] "测试连接"按钮
  - [ ] 登录状态显示（已登录/未登录）
  - [ ] "退出登录"按钮
- [ ] 添加站点 Salt 配置（高级选项，可手动输入）
- [ ] 登录成功后刷新页面状态

**安全考虑**：
- ⚠️ 密码仅在本地哈希存储，不存储明文
- ⚠️ 密码哈希存储在 SQLite 数据库中
- ⚠️ 支持随时清除认证信息（退出登录）
- ⚠️ 提示用户：密码哈希具有一定安全风险

---

#### 2.2 喜欢功能（Vote）

**需求描述**：
- 用户可以为图片投票（喜欢/不喜欢）
- 与收藏是不同的功能：
  - **本地收藏**：将图片保存到本地收藏列表（不需要登录）
  - **服务器收藏**：在服务器上收藏图片（需要登录，score=3）
  - **喜欢/投票**：在服务器上为图片投票，影响图片评分
- 显示谁收藏了这张图片

**Boorusama 参考**：
```
packages/booru_clients/lib/src/moebooru/moebooru_client.dart:

// 投票 API
Future<void> votePost({required int postId, required int score}) async {
  // score: 3=喜欢, 2=一般, 1=不喜欢, 0=取消
  await dio.post('/post/vote.json', queryParameters: {
    'id': postId,
    'score': score,
    ..._authParams,
  });
}

// 收藏 = 投票 score=3
Future<void> favoritePost({required int postId}) => votePost(postId: postId, score: 3);
Future<void> unfavoritePost({required int postId}) => votePost(postId: postId, score: 0);

// 获取收藏用户列表
Future<Set<String>?> getFavoriteUsers({required int postId}) async {
  final response = await dio.get('/favorite/list_users.json', queryParameters: {'id': postId});
  final userString = response.data['favorited_users'] as String?;
  return userString?.split(',').toSet();
}

lib/boorus/moebooru/post_details/src/widgets/toolbar.dart:
// 详情页工具栏：收藏按钮、投票按钮、下载按钮等
```

**Moebooru Vote API**：
```typescript
// POST /post/vote.json
interface VoteRequest {
  id: number;           // 图片 ID
  score: 0 | 1 | 2 | 3; // 投票分数
  login: string;
  password_hash: string;
}

// 投票分数含义
const VOTE_SCORES = {
  CANCEL: 0,      // 取消投票/取消收藏
  DISLIKE: 1,     // 不喜欢
  NEUTRAL: 2,     // 一般
  LIKE: 3,        // 喜欢（同时也是服务器收藏）
};

// 响应
interface VoteResponse {
  success: boolean;
  score: number;     // 图片新的总分
  post_id: number;
}

// GET /favorite/list_users.json
interface FavoriteUsersResponse {
  favorited_users: string;  // 逗号分隔的用户名列表
}
```

**moebooruClient.ts 已实现**（但未暴露到前端）：
- ⚠️ `votePost(id, score)` - 投票（仅客户端方法，无 IPC 通道）
- ⚠️ `favoritePost(id)` - 服务器收藏（score=3）（仅客户端方法，无 IPC 通道）
- ⚠️ `unfavoritePost(id)` - 取消服务器收藏（score=0）（仅客户端方法，无 IPC 通道）
- ⚠️ `getFavoriteUsers(postId)` - 获取收藏用户列表（仅客户端方法，无 IPC 通道）

**待添加 IPC 通道** (src/main/ipc/channels.ts)：
```typescript
// ❌ 以下通道尚未添加，需要实现
BOORU_VOTE_POST: 'booru:vote-post',
BOORU_SERVER_FAVORITE: 'booru:server-favorite',
BOORU_SERVER_UNFAVORITE: 'booru:server-unfavorite',
BOORU_GET_FAVORITE_USERS: 'booru:get-favorite-users',
```

**待添加 Preload API** (src/preload/index.ts)：
```typescript
// ❌ 以下 API 尚未暴露，需要实现
booru: {
  // ... 已有的 API
  votePost: (siteId: number, postId: number, score: 0 | 1 | 2 | 3) => 
    ipcRenderer.invoke(IPC_CHANNELS.BOORU_VOTE_POST, siteId, postId, score),
  serverFavorite: (siteId: number, postId: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.BOORU_SERVER_FAVORITE, siteId, postId),
  serverUnfavorite: (siteId: number, postId: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.BOORU_SERVER_UNFAVORITE, siteId, postId),
  getFavoriteUsers: (siteId: number, postId: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_FAVORITE_USERS, siteId, postId),
}
```

**实现步骤**：
1. [ ] 在 `channels.ts` 添加 IPC 通道定义
2. [ ] 在 `handlers.ts` 添加 IPC 处理器
3. [ ] 在 `preload/index.ts` 暴露 API
4. [ ] 实现 UI 组件

**UI 实现清单**：
- [ ] 在 `BooruImageCard.tsx` 添加喜欢按钮（仅登录后显示）
- [ ] 在 `Toolbar.tsx` (详情页) 添加投票按钮组
  - [ ] 👍 喜欢按钮（score=3）
  - [ ] 👎 不喜欢按钮（score=1）
  - [ ] 取消投票选项
- [ ] 在详情页显示"谁收藏了这张图片"
- [ ] 投票后刷新图片评分显示
- [ ] 未登录时显示"请先登录"提示

**UI 设计**：
```
图片详情页工具栏:
┌──────────────────────────────────────────────┐
│ ⭐ 本地收藏  │  ❤️ 服务器收藏  │  👍 喜欢  │  👎 │
├──────────────────────────────────────────────┤
│ Score: 100  │  收藏: 50人                    │
└──────────────────────────────────────────────┘

收藏用户列表（可展开）:
┌──────────────────────────────────────────────┐
│ 收藏了这张图片的用户 (50):                    │
│ user1, user2, user3, user4...                │
└──────────────────────────────────────────────┘
```

**功能区分说明**：
| 功能 | 说明 | 需要登录 | API |
|------|------|---------|-----|
| 本地收藏 | 保存到本地数据库，仅本地可见 | ❌ | 本地数据库操作 |
| 服务器收藏 | 保存到服务器，其他用户可见 | ✅ | `/post/vote.json?score=3` |
| 喜欢/投票 | 影响图片总评分 | ✅ | `/post/vote.json` |

---

### 第三阶段：功能增强 (优先级: 中)

#### 3.1 服务器收藏同步

**需求描述**：
- 登录后可查看服务器上的收藏
- 支持将本地收藏同步到服务器
- 支持从服务器导入收藏到本地

**Boorusama 参考**：
```
lib/boorus/moebooru/favorites/
└── providers.dart              # 收藏用户列表状态管理

packages/booru_clients/lib/src/moebooru/moebooru_client.dart:
├── favoritePost()              # 服务器收藏（vote score=3）
├── unfavoritePost()            # 取消服务器收藏（vote score=0）
└── getFavoriteUsers()          # 获取谁收藏了某张图片
```

**Moebooru Favorite API**：
```typescript
// 添加服务器收藏（实际是投票 score=3）
// POST /post/vote.json
{ id: postId, score: 3, login, password_hash }

// 取消服务器收藏（投票 score=0）
// POST /post/vote.json
{ id: postId, score: 0, login, password_hash }

// 获取用户收藏列表（通过搜索实现）
// GET /post.json?tags=vote:3:username
// 或 GET /post.json?tags=fav:username

// 获取某图片的收藏用户
// GET /favorite/list_users.json?id=postId
```

**moebooruClient.ts 已实现**（但未暴露到前端）：
- ⚠️ `favoritePost(id)` - 服务器收藏（仅客户端方法，无 IPC）
- ⚠️ `unfavoritePost(id)` - 取消服务器收藏（仅客户端方法，无 IPC）
- ⚠️ `getFavoriteUsers(postId)` - 获取收藏用户列表（仅客户端方法，无 IPC）

**待实现**：
```typescript
// 获取用户的服务器收藏列表
async getUserFavorites(username: string, params?: {
  page?: number;
  limit?: number;
}): Promise<MoebooruPost[]> {
  // 使用 fav:username 标签搜索
  return this.getPosts({ tags: [`fav:${username}`], ...params });
}
```

**IPC 通道**：
```typescript
BOORU_GET_USER_FAVORITES: 'booru:get-user-favorites',
BOORU_SYNC_FAVORITES: 'booru:sync-favorites',
```

**UI 实现清单**：
- [ ] 在 `BooruFavoritesPage.tsx` 添加"服务器收藏"选项卡
- [ ] 显示当前登录用户的服务器收藏
- [ ] 添加"同步到本地"按钮
- [ ] 添加"上传到服务器"按钮
- [ ] 显示同步状态和进度
- [ ] 处理同步冲突（本地有/服务器没有 等情况）

---

#### 3.2 热门图片浏览

**需求描述**：
- 查看近期热门图片
- 支持按日/周/月/年筛选
- 支持选择具体日期查看历史热门

**Boorusama 参考**：
```
lib/boorus/moebooru/popular/
├── providers.dart              # MoebooruPopularRepository
├── types.dart                  # MoebooruTimePeriod 枚举
└── src/pages/
    └── popular_page.dart       # 热门页面 UI

// 时间周期类型
enum MoebooruPopularType { recent, day, week, month }

// 页面结构：
// - 顶部：时间周期切换（日/周/月）
// - 中间：图片网格
// - 底部：日期选择器
```

**Moebooru Popular API**：
```typescript
// 近期热门（支持 1d/1w/1m 时间段）
// GET /post/popular_recent.json?period=1d
interface PopularRecentParams {
  period: '1d' | '1w' | '1m' | '1y';
}

// 指定日期热门
// GET /post/popular_by_day.json?day=1&month=12&year=2025
// GET /post/popular_by_week.json?day=1&month=12&year=2025
// GET /post/popular_by_month.json?month=12&year=2025
interface PopularByDateParams {
  day?: number;
  month: number;
  year: number;
}
```

**moebooruClient.ts 已实现**（但未暴露到前端）：
- ⚠️ `getPopularRecent(period)` - 近期热门（仅客户端方法，无 IPC 通道）
- ⚠️ `getPopularByDay(date)` - 指定日期热门（仅客户端方法，无 IPC 通道）

**待实现**：
```typescript
// 1. 补充按周、按月热门 (moebooruClient.ts)
async getPopularByWeek(date: Date): Promise<MoebooruPost[]>
async getPopularByMonth(date: Date): Promise<MoebooruPost[]>

// 2. 添加 IPC 通道 (channels.ts)
BOORU_GET_POPULAR_RECENT: 'booru:get-popular-recent',
BOORU_GET_POPULAR_BY_DAY: 'booru:get-popular-by-day',
BOORU_GET_POPULAR_BY_WEEK: 'booru:get-popular-by-week',
BOORU_GET_POPULAR_BY_MONTH: 'booru:get-popular-by-month',

// 3. 添加 Preload API (index.ts)
booru.getPopularRecent(period)
booru.getPopularByDay(date)
```

**IPC 通道**：
```typescript
BOORU_GET_POPULAR_RECENT: 'booru:get-popular-recent',
BOORU_GET_POPULAR_BY_DAY: 'booru:get-popular-by-day',
BOORU_GET_POPULAR_BY_WEEK: 'booru:get-popular-by-week',
BOORU_GET_POPULAR_BY_MONTH: 'booru:get-popular-by-month',
```

**UI 实现清单**：
- [ ] 创建 `BooruPopularPage.tsx` 热门图片页面
- [ ] 添加时间周期切换按钮（日/周/月）
- [ ] 添加日期选择器（DatePicker）
- [ ] 图片网格展示（复用现有组件）
- [ ] 在 App.tsx 添加路由
- [ ] 在导航菜单添加"热门"入口

**UI 设计**：
```
┌──────────────────────────────────────────────┐
│  [日] [周] [月]              📅 2025-12-22   │
├──────────────────────────────────────────────┤
│                                              │
│    📷    📷    📷    📷                      │
│                                              │
│    📷    📷    📷    📷                      │
│                                              │
└──────────────────────────────────────────────┘
```

---

#### 3.3 评论功能

**需求描述**：
- 在图片详情页查看评论
- 显示评论者、时间、内容
- 支持发表评论（需登录）

**Boorusama 参考**：
```
lib/boorus/moebooru/comments/
├── types.dart                  # MoebooruComment 数据类型
├── parser.dart                 # 评论数据解析
└── providers.dart              # 评论状态管理

lib/boorus/moebooru/post_details/src/widgets/
└── comment_section.dart        # 评论区 UI 组件

// MoebooruComment 数据结构
class MoebooruComment {
  final int id;
  final DateTime createdAt;
  final int postId;
  final String creator;         // 评论者用户名
  final int creatorId;
  final String body;            // 评论内容
}
```

**Moebooru Comment API**：
```typescript
// 获取评论
// GET /comment.json?post_id=123
interface CommentResponse {
  id: number;
  created_at: string;
  post_id: number;
  creator: string;
  creator_id: number;
  body: string;
}

// 发表评论（需登录）
// POST /comment/create.json
interface CreateCommentRequest {
  comment: {
    post_id: number;
    body: string;
  };
  login: string;
  password_hash: string;
}
```

**moebooruClient.ts 已实现**（但未暴露到前端）：
- ⚠️ `getComments(postId)` - 获取评论列表（仅客户端方法，无 IPC 通道）

**待实现**：
```typescript
// 1. 发表评论 (moebooruClient.ts)
async createComment(postId: number, body: string): Promise<Comment>

// 2. 添加 IPC 通道 (channels.ts)
BOORU_GET_COMMENTS: 'booru:get-comments',
BOORU_CREATE_COMMENT: 'booru:create-comment',

// 3. 添加 Preload API (index.ts)
booru.getComments(postId)
booru.createComment(postId, body)
```

**类型定义** (src/shared/types.ts)：
```typescript
interface BooruComment {
  id: number;
  postId: number;
  creator: string;
  creatorId: number;
  body: string;
  createdAt: string;
}
```

**IPC 通道**：
```typescript
BOORU_GET_COMMENTS: 'booru:get-comments',
BOORU_CREATE_COMMENT: 'booru:create-comment',
```

**UI 实现清单**：
- [ ] 在 `BooruPostDetailsPage.tsx` 添加评论区
- [ ] 创建 `CommentSection.tsx` 评论区组件
- [ ] 创建 `CommentItem.tsx` 单条评论组件
- [ ] 添加评论输入框（仅登录后显示）
- [ ] 支持评论内容的基本格式化显示
- [ ] 显示评论数量

**UI 设计**：
```
评论区:
┌──────────────────────────────────────────────┐
│ 💬 评论 (15)                                 │
├──────────────────────────────────────────────┤
│ user123 · 2025-12-22 10:30                   │
│ 这张图太棒了！                               │
├──────────────────────────────────────────────┤
│ another_user · 2025-12-21 08:15              │
│ 画师是谁？                                   │
├──────────────────────────────────────────────┤
│ [输入评论...]                    [发送]      │
└──────────────────────────────────────────────┘
```

---

#### 3.4 Pool（图集）浏览

**需求描述**：
- 浏览 Booru 站点的 Pool（图集/合集）
- 支持搜索 Pool
- 按顺序浏览 Pool 中的图片
- 显示 Pool 信息（名称、描述、图片数量）

**Moebooru Pool API**：
```typescript
// 获取 Pool 列表
// GET /pool.json?query=keyword&page=1
interface PoolListResponse {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  user_id: number;
  is_public: boolean;
  post_count: number;
  description: string;
}

// 获取 Pool 详情（包含图片列表）
// GET /pool/show.json?id=123&page=1
interface PoolDetailResponse {
  id: number;
  name: string;
  description: string;
  post_count: number;
  posts: Post[];  // Pool 中的图片，按顺序排列
}
```

**待实现** (moebooruClient.ts)：
```typescript
// 获取 Pool 列表
async getPools(params?: {
  query?: string;
  page?: number;
}): Promise<Pool[]>

// 获取 Pool 详情
async getPool(id: number, page?: number): Promise<PoolDetail>
```

**类型定义** (src/shared/types.ts)：
```typescript
interface BooruPool {
  id: number;
  name: string;
  description?: string;
  postCount: number;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

interface BooruPoolDetail extends BooruPool {
  posts: BooruPost[];
}
```

**IPC 通道**：
```typescript
BOORU_GET_POOLS: 'booru:get-pools',
BOORU_GET_POOL: 'booru:get-pool',
BOORU_SEARCH_POOLS: 'booru:search-pools',
```

**UI 实现清单**：
- [ ] 创建 `BooruPoolsPage.tsx` Pool 列表页面
- [ ] 创建 `BooruPoolDetailPage.tsx` Pool 详情页面
- [ ] 创建 `PoolCard.tsx` Pool 卡片组件
- [ ] 支持 Pool 搜索
- [ ] Pool 内图片按顺序浏览
- [ ] 支持"上一张/下一张"导航
- [ ] 在 App.tsx 添加路由
- [ ] 在导航菜单添加"图集"入口

**UI 设计**：
```
Pool 列表页:
┌──────────────────────────────────────────────┐
│ 🔍 [搜索 Pool...]                            │
├──────────────────────────────────────────────┤
│ ┌─────────────┐  ┌─────────────┐             │
│ │  [封面图]   │  │  [封面图]   │             │
│ │ Pool Name   │  │ Pool Name   │             │
│ │ 25 张图片   │  │ 18 张图片   │             │
│ └─────────────┘  └─────────────┘             │
└──────────────────────────────────────────────┘

Pool 详情页:
┌──────────────────────────────────────────────┐
│ ← Pool Name                    1/25          │
├──────────────────────────────────────────────┤
│                                              │
│              [当前图片]                       │
│                                              │
├──────────────────────────────────────────────┤
│     [◀ 上一张]           [下一张 ▶]          │
└──────────────────────────────────────────────┘
```

---

### 第四阶段：体验优化 (优先级: 低)

#### 4.1 主题切换

**需求描述**：
- 支持明暗主题切换
- 跟随系统主题

**待实现**：
- [ ] Ant Design 主题配置
- [ ] 主题切换按钮
- [ ] 持久化主题设置

---

#### 4.2 多语言支持

**需求描述**：
- 支持中文/英文切换

**待实现**：
- [ ] i18n 配置
- [ ] 语言文件
- [ ] 语言切换功能

---

#### 4.3 快捷键支持

**需求描述**：
- 图片浏览快捷键（上下左右）
- 常用操作快捷键

**待实现**：
- [ ] 快捷键配置
- [ ] 快捷键提示

---

## 开发优先级总结

### 高优先级 (用户明确需求)

| # | 功能 | 状态 | 主要工作 | 备注 |
|---|------|------|---------|------|
| 1 | 标签收藏功能 | ✅ 已完成 | 数据库表 + 服务层 + IPC + UI页面 | 全链路已实现 |
| 2 | 标签黑名单功能 | ✅ 已完成 | 数据库表 + 服务层 + 过滤逻辑 + UI | 全链路已实现 |
| 3 | 收藏/黑名单导入导出 | ⏳ 未开始 | 导出服务 + 导入解析 + UI弹窗 | 全新功能 |
| 4 | Yande.re 登录配置 | ⚠️ 部分 | 登录表单 + 密码哈希 + 状态存储 | 客户端已有 hashPassword |
| 5 | 喜欢功能（Vote） | ⚠️ 部分 | IPC通道 + Preload API + UI按钮 | 客户端已有 votePost，需补 IPC |

### 中优先级 (功能增强)

| # | 功能 | 状态 | 主要工作 | 备注 |
|---|------|------|---------|------|
| 6 | 服务器收藏同步 | ⚠️ 部分 | getUserFavorites API + 同步逻辑 + UI | 客户端已有 favoritePost |
| 7 | 热门图片浏览 | ⚠️ 部分 | IPC + Preload + 新页面 + 日期选择器 | 客户端已有 getPopular* |
| 8 | 评论功能 | ⚠️ 部分 | IPC + Preload + 评论组件 + createComment | 客户端已有 getComments |
| 9 | Pool（图集）浏览 | ⏳ 未开始 | Pool API + 列表页 + 详情页 | 全新功能 |

### 低优先级 (体验优化)

| # | 功能 | 状态 | 主要工作 | 备注 |
|---|------|------|---------|------|
| 10 | 主题切换 | ⏳ 未开始 | Ant Design 主题配置 + 持久化 | |
| 11 | 多语言支持 | ⏳ 未开始 | i18n 框架 + 语言文件 | |
| 12 | 快捷键支持 | ⏳ 未开始 | 快捷键绑定 + 提示UI | |

**状态说明**：
- ⏳ **未开始**：完全没有实现
- ⚠️ **部分**：moebooruClient.ts 中有基础方法，但没有 IPC 通道和 Preload API
- ✅ **已完成**：前端到后端链路完整，UI 已实现

---

## 开发进度记录

### 实现顺序建议

**阶段 1：标签管理基础（建议先做）**
```
1.1 标签收藏功能
    ├── 创建数据库表 booru_favorite_tags
    ├── 添加类型定义到 types.ts
    ├── 实现 booruService 方法
    ├── 添加 IPC 通道和处理器
    ├── 添加 Preload API
    └── 创建 UI 页面和组件

1.2 标签黑名单功能
    ├── 创建数据库表 booru_blacklisted_tags
    ├── 实现过滤逻辑
    ├── 添加 IPC 通道
    └── 创建 UI 页面

1.3 导入导出功能
    ├── 创建 tagExportService.ts
    ├── 实现导出逻辑（JSON/TXT）
    ├── 实现导入解析逻辑
    └── 创建导入预览弹窗
```

**阶段 2：用户认证（依赖标签功能完成）**
```
2.1 登录配置
    ├── 扩展站点配置表单
    ├── 实现密码哈希逻辑
    ├── 添加登录状态管理
    └── 创建测试认证功能

2.2 喜欢功能
    ├── 添加 IPC 通道
    ├── 添加 Preload API
    ├── 修改详情页工具栏
    └── 添加投票按钮
```

**阶段 3：功能增强（可并行开发）**
```
3.1 热门图片 → 新页面，独立功能
3.2 评论功能 → 详情页扩展
3.3 Pool 浏览 → 新页面，独立功能
3.4 服务器收藏同步 → 收藏页扩展
```

---

### 已完成

#### 已完成任务
- [x] **1.1 标签收藏功能** - 数据库表 + 服务层 + IPC + Preload + UI页面 + TagsSection星标收藏 ✅ (2026-03-06)

### 待开始

#### 下一步任务（紧急修复）

##### A. 批量下载自动恢复 ✅
- [x] 后端：`bulkDownloadService.ts` 添加 `resumeRunningSessions()` 方法，程序启动后恢复 `running`/`paused` 状态的会话
- [x] IPC：添加 `BULK_DOWNLOAD_RESUME_RUNNING_SESSIONS` 通道 + handler + preload API
- [x] 前端：`BooruBulkDownloadPage.tsx` 首次进入时自动调用恢复接口

##### B. 普通下载功能强化 ✅
- [x] 后端：`downloadManager.ts` 下载失败时清除损坏文件 + 重试前清除损坏文件
- [x] 前端：`BooruDownloadPage.tsx` 失败列表已有单个重试按钮（已确认存在）

#### 后续任务
- [ ] **1.2 标签黑名单功能** - 创建数据库表和基础服务

---

### 文件修改清单（预估）

| 文件 | 修改内容 |
|------|---------|
| `src/shared/types.ts` | 添加 FavoriteTag, BlacklistedTag, BooruComment, BooruPool 等类型 |
| `src/main/ipc/channels.ts` | 添加新 IPC 通道定义 |
| `src/main/ipc/handlers.ts` | 添加新 IPC 处理器 |
| `src/preload/index.ts` | 暴露新 API |
| `src/main/services/database.ts` | 创建新数据库表 |
| `src/main/services/booruService.ts` | 添加收藏标签、黑名单服务方法 |
| `src/main/services/tagExportService.ts` | 新建：导入导出服务 |
| `src/main/services/moebooruClient.ts` | 添加 Pool、热门等 API |
| `src/renderer/App.tsx` | 添加新页面路由 |
| `src/renderer/pages/FavoriteTagsPage.tsx` | 新建：收藏标签页面 |
| `src/renderer/pages/BlacklistedTagsPage.tsx` | 新建：黑名单页面 |
| `src/renderer/pages/BooruPopularPage.tsx` | 新建：热门图片页面 |
| `src/renderer/pages/BooruPoolsPage.tsx` | 新建：Pool 列表页面 |
| `src/renderer/pages/BooruPoolDetailPage.tsx` | 新建：Pool 详情页面 |
| `src/renderer/components/CommentSection.tsx` | 新建：评论区组件 |
| `src/renderer/components/ImportTagsModal.tsx` | 新建：导入标签弹窗 |

---

**最后更新**: 2026年3月6日
**版本**: 2.2
