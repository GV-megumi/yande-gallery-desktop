# Moebooru 基础功能实现 TODO

本文档详细列出实现 Moebooru 基础功能所需的所有任务，包括数据库变更、配置更新、功能实现等。

## 参考项目

- **Boorusama**: `example/Boorusama-master` - Flutter 实现的 Booru 客户端
- **核心目录**:
  - `lib/boorus/moebooru/` - Moebooru 特定实现
  - `packages/booru_clients/lib/src/moebooru/` - Moebooru API 客户端
  - `packages/filename_generator/` - 文件名生成器
  - `lib/core/bookmarks/` - 收藏功能
  - `lib/core/downloads/` - 下载功能

---

## 一、数据库表变更

### 1. 新增 `booru_sites` 表

存储 Moebooru 站点配置信息。

```sql
CREATE TABLE IF NOT EXISTS booru_sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                    -- 站点名称 (yande.re, konachan.com 等)
  url TEXT NOT NULL UNIQUE,              -- 站点 URL
  type TEXT NOT NULL,                    -- 站点类型 (moebooru, danbooru, gelbooru 等)
  salt TEXT,                             -- 密码加密盐值
  version TEXT,                          -- API 版本
  apiKey TEXT,                           -- API Key
  username TEXT,                         -- 用户名
  passwordHash TEXT,                     -- 密码哈希
  favoriteSupport INTEGER DEFAULT 1,    -- 是否支持收藏 (0/1)
  active INTEGER DEFAULT 1,              -- 是否激活 (0/1)
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX idx_booru_sites_type ON booru_sites(type);
CREATE INDEX idx_booru_sites_active ON booru_sites(active);
```

**参考文件**: 
- `example/Boorusama-master/lib/boorus/moebooru/moebooru.dart` (MoebooruSite 类型定义)
- `example/Boorusama-master/lib/boorus/moebooru/configs/types.dart` (配置类型)

---

### 2. 新增 `booru_posts` 表

存储从 Booru 站点获取的图片信息。

```sql
CREATE TABLE IF NOT EXISTS booru_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  siteId INTEGER NOT NULL,               -- 关联 booru_sites.id
  postId INTEGER NOT NULL,               -- Booru 站点的原始图片 ID
  md5 TEXT,                              -- 图片 MD5
  fileUrl TEXT NOT NULL,                 -- 原图 URL
  previewUrl TEXT,                       -- 预览图 URL
  sampleUrl TEXT,                        -- 样本图 URL
  width INTEGER,                         -- 图片宽度
  height INTEGER,                        -- 图片高度
  fileSize INTEGER,                      -- 文件大小
  fileExt TEXT,                          -- 文件扩展名
  rating TEXT,                           -- 分级 (safe/questionable/explicit)
  score INTEGER,                         -- 评分
  source TEXT,                           -- 来源
  tags TEXT,                             -- 标签字符串 (空格分隔)
  downloaded INTEGER DEFAULT 0,          -- 是否已下载 (0/1)
  localPath TEXT,                        -- 本地存储路径
  localImageId INTEGER,                  -- 关联本地 images.id
  isFavorited INTEGER DEFAULT 0,         -- 是否收藏 (0/1)
  createdAt TEXT NOT NULL,               -- 创建时间
  updatedAt TEXT NOT NULL,               -- 更新时间
  FOREIGN KEY (siteId) REFERENCES booru_sites(id) ON DELETE CASCADE,
  FOREIGN KEY (localImageId) REFERENCES images(id) ON DELETE SET NULL,
  UNIQUE(siteId, postId)
);

CREATE INDEX idx_booru_posts_siteId ON booru_posts(siteId);
CREATE INDEX idx_booru_posts_postId ON booru_posts(postId);
CREATE INDEX idx_booru_posts_downloaded ON booru_posts(downloaded);
CREATE INDEX idx_booru_posts_isFavorited ON booru_posts(isFavorited);
CREATE INDEX idx_booru_posts_rating ON booru_posts(rating);
CREATE INDEX idx_booru_posts_md5 ON booru_posts(md5);
```

**参考文件**:
- `example/Boorusama-master/packages/booru_clients/lib/src/moebooru/types/types.dart` (PostDto 定义)
- `example/Boorusama-master/lib/boorus/moebooru/posts/types.dart`

---

### 3. 新增 `booru_tags` 表

存储从 Booru 站点获取的标签信息。

```sql
CREATE TABLE IF NOT EXISTS booru_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  siteId INTEGER NOT NULL,               -- 关联 booru_sites.id
  name TEXT NOT NULL,                    -- 标签名称
  category TEXT,                         -- 标签分类 (artist/character/copyright/general/meta)
  postCount INTEGER DEFAULT 0,           -- 图片数量
  createdAt TEXT NOT NULL,
  FOREIGN KEY (siteId) REFERENCES booru_sites(id) ON DELETE CASCADE,
  UNIQUE(siteId, name)
);

CREATE INDEX idx_booru_tags_siteId ON booru_tags(siteId);
CREATE INDEX idx_booru_tags_name ON booru_tags(name);
CREATE INDEX idx_booru_tags_category ON booru_tags(category);
CREATE INDEX idx_booru_tags_postCount ON booru_tags(postCount DESC);
```

**参考文件**:
- `example/Boorusama-master/lib/boorus/moebooru/tags/types.dart`
- `example/Boorusama-master/lib/boorus/moebooru/tag_summary/types.dart`

---

### 4. 新增 `booru_post_tags` 表

Booru 图片与标签的多对多关联表。

```sql
CREATE TABLE IF NOT EXISTS booru_post_tags (
  postId INTEGER NOT NULL,
  tagId INTEGER NOT NULL,
  PRIMARY KEY (postId, tagId),
  FOREIGN KEY (postId) REFERENCES booru_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (tagId) REFERENCES booru_tags(id) ON DELETE CASCADE
);

CREATE INDEX idx_booru_post_tags_postId ON booru_post_tags(postId);
CREATE INDEX idx_booru_post_tags_tagId ON booru_post_tags(tagId);
```

---

### 5. 新增 `booru_favorites` 表

存储用户本地收藏的 Booru 图片。

```sql
CREATE TABLE IF NOT EXISTS booru_favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  postId INTEGER NOT NULL,               -- 关联 booru_posts.id
  siteId INTEGER NOT NULL,               -- 关联 booru_sites.id
  notes TEXT,                            -- 用户备注
  createdAt TEXT NOT NULL,
  FOREIGN KEY (postId) REFERENCES booru_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (siteId) REFERENCES booru_sites(id) ON DELETE CASCADE,
  UNIQUE(postId)
);

CREATE INDEX idx_booru_favorites_siteId ON booru_favorites(siteId);
CREATE INDEX idx_booru_favorites_createdAt ON booru_favorites(createdAt DESC);
```

**参考文件**:
- `example/Boorusama-master/lib/core/bookmarks/` (收藏功能实现)
- `example/Boorusama-master/lib/boorus/moebooru/favorites/providers.dart`

---

### 6. 新增 `booru_download_queue` 表

存储下载队列信息。

```sql
CREATE TABLE IF NOT EXISTS booru_download_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  postId INTEGER NOT NULL,               -- 关联 booru_posts.id
  siteId INTEGER NOT NULL,               -- 关联 booru_sites.id
  status TEXT NOT NULL,                  -- 状态 (pending/downloading/completed/failed/paused)
  progress INTEGER DEFAULT 0,            -- 下载进度 (0-100)
  downloadedBytes INTEGER DEFAULT 0,     -- 已下载字节数
  totalBytes INTEGER DEFAULT 0,          -- 总字节数
  errorMessage TEXT,                     -- 错误信息
  retryCount INTEGER DEFAULT 0,          -- 重试次数
  priority INTEGER DEFAULT 0,            -- 优先级
  targetPath TEXT,                       -- 目标保存路径
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  completedAt TEXT,
  FOREIGN KEY (postId) REFERENCES booru_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (siteId) REFERENCES booru_sites(id) ON DELETE CASCADE
);

CREATE INDEX idx_booru_download_queue_status ON booru_download_queue(status);
CREATE INDEX idx_booru_download_queue_siteId ON booru_download_queue(siteId);
CREATE INDEX idx_booru_download_queue_priority ON booru_download_queue(priority DESC);
```

**参考文件**:
- `example/Boorusama-master/lib/core/downloads/` (下载管理)
- `example/Boorusama-master/lib/core/bulk_downloads/` (批量下载)

---

### 7. 新增 `booru_search_history` 表

存储搜索历史记录。

```sql
CREATE TABLE IF NOT EXISTS booru_search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  siteId INTEGER NOT NULL,               -- 关联 booru_sites.id
  query TEXT NOT NULL,                   -- 搜索查询字符串
  resultCount INTEGER DEFAULT 0,         -- 结果数量
  createdAt TEXT NOT NULL,
  FOREIGN KEY (siteId) REFERENCES booru_sites(id) ON DELETE CASCADE
);

CREATE INDEX idx_booru_search_history_siteId ON booru_search_history(siteId);
CREATE INDEX idx_booru_search_history_createdAt ON booru_search_history(createdAt DESC);
```

---

### 8. 更新 `yande_images` 表（迁移到 booru_posts）

**注意**: 现有的 `yande_images` 表需要迁移到新的 `booru_posts` 表中。

**迁移脚本**:
```sql
-- 1. 先创建 Yande.re 站点记录
INSERT INTO booru_sites (name, url, type, salt, favoriteSupport, active, createdAt, updatedAt)
VALUES ('Yande.re', 'https://yande.re', 'moebooru', 'choujin-steiner--{0}--', 1, 1, datetime('now'), datetime('now'));

-- 2. 迁移数据
INSERT INTO booru_posts (
  siteId, postId, fileUrl, previewUrl, rating, downloaded, localPath, createdAt, updatedAt
)
SELECT 
  (SELECT id FROM booru_sites WHERE url = 'https://yande.re'),
  yandeId,
  fileUrl,
  previewUrl,
  rating,
  downloaded,
  localPath,
  createdAt,
  updatedAt
FROM yande_images;

-- 3. 备份后可以删除旧表 (可选)
-- DROP TABLE yande_images;
```

---

## 二、config.yaml 配置变更

### 1. 新增 `booru` 配置节

在 `config.yaml` 中添加以下配置:

```yaml
# Moebooru 配置
booru:
  # 默认站点
  defaultSite: yande.re
  
  # 站点列表
  sites:
    - name: Yande.re
      url: https://yande.re
      type: moebooru
      salt: choujin-steiner--{0}--
      version: "6.0.0"
      apiKey: ""
      username: ""
      favoriteSupport: true
      active: true
      
    - name: Konachan
      url: https://konachan.com
      type: moebooru
      salt: So-I-Heard-You-Like-Mupkids-?--{0}--
      version: "6.0.0"
      apiKey: ""
      username: ""
      favoriteSupport: true
      active: false
      
    - name: Konachan.net
      url: https://konachan.net
      type: moebooru
      salt: So-I-Heard-You-Like-Mupkids-?--{0}--
      version: "6.0.0"
      apiKey: ""
      username: ""
      favoriteSupport: true
      active: false
  
  # API 请求配置
  api:
    requestTimeout: 30                    # 请求超时时间（秒）
    retryTimes: 3                         # 重试次数
    retryDelay: 1000                      # 重试延迟（毫秒）
    pageSize: 20                          # 每页图片数量
    maxConcurrentRequests: 3              # 最大并发请求数
  
  # 下载配置
  download:
    path: downloads/booru                 # 下载路径
    createSubfolders: true                # 是否创建子文件夹
    subfolderFormat: "{site}/{rating}"    # 子文件夹格式
    filenameFormat: "{id}_{md5}.{extension}"  # 文件名格式
    maxConcurrentDownloads: 3             # 最大并发下载数
    chunkSize: 1048576                    # 下载块大小（字节，默认 1MB）
    autoRetry: true                       # 下载失败自动重试
    maxRetries: 3                         # 最大重试次数
    skipExisting: true                    # 跳过已存在文件
    
  # 文件名格式支持的标记
  # {id} - 图片 ID
  # {md5} - 图片 MD5
  # {extension} - 文件扩展名
  # {width} - 图片宽度
  # {height} - 图片高度
  # {rating} - 分级
  # {score} - 评分
  # {site} - 站点名称
  # {artist} - 艺术家（从标签提取）
  # {character} - 角色（从标签提取）
  # {copyright} - 版权（从标签提取）
  # {date} - 日期
  # {tags} - 标签（限制长度）
  
  # 搜索配置
  search:
    saveHistory: true                     # 保存搜索历史
    maxHistoryItems: 100                  # 最大历史记录数
    autocomplete: true                    # 启用标签自动补全
    autocompleteDelay: 300                # 自动补全延迟（毫秒）
    
  # 收藏配置
  favorites:
    syncToServer: false                   # 是否同步到服务器（需登录）
    autoDownload: false                   # 收藏后自动下载
    
  # 缓存配置
  cache:
    enabled: true                         # 启用缓存
    thumbnailCache: true                  # 缓存缩略图
    maxCacheSize: 500                     # 最大缓存大小（MB）
    cacheExpiry: 86400                    # 缓存过期时间（秒，默认 24 小时）
    
  # 过滤配置
  filter:
    defaultRating: all                    # 默认分级过滤 (all/safe/questionable/explicit)
    hideDeleted: true                     # 隐藏已删除的图片
    blacklistTags: []                     # 黑名单标签
```

**参考文件**:
- `example/Boorusama-master/lib/boorus/moebooru/configs/types.dart`
- `example/Boorusama-master/lib/core/configs/` (配置管理)

---

### 2. 更新 `downloads` 配置

```yaml
downloads:
  # 原有配置保持不变
  path: downloads
  createSubfolders: true
  subfolderFormat:
    - tags
    - date
  
  # 新增：Booru 下载独立配置（会覆盖上面的配置）
  booru:
    path: downloads/booru
    filenameFormat: "{id}_{md5}.{extension}"
```

---

### 3. 更新 `app` 配置

```yaml
app:
  recentImagesCount: 100
  pageSize: 50
  defaultViewMode: grid
  showImageInfo: true
  autoScan: true
  autoScanInterval: 30
  
  # 新增：Booru 界面配置
  booru:
    defaultLayout: waterfall              # 默认布局 (grid/waterfall)
    showPreview: true                     # 显示预览图
    previewQuality: sample                # 预览质量 (preview/sample/original)
    enableInfiniteScroll: true            # 启用无限滚动
    imagesPerPage: 20                     # 每页图片数
```

---

## 三、功能实现

### 阶段 1: 核心 API 客户端

#### 1.1 创建 Moebooru API 客户端类

**文件**: `src/main/services/moebooruClient.ts`

**功能**:
- 实现 Moebooru API 的所有接口
- 支持认证（用户名 + 密码哈希）
- 请求超时和重试机制
- 错误处理

**接口列表**:
- `getPosts(page, limit, tags)` - 获取图片列表
- `getPost(id)` - 获取单个图片详情
- `getPopularPostsRecent(period)` - 获取热门图片
- `getPopularPostsByDay/Week/Month(date)` - 获取特定时期热门图片
- `getTags(query, limit)` - 搜索标签
- `getTagSummary()` - 获取标签摘要
- `getComments(postId)` - 获取评论
- `favoritePost(postId)` - 添加收藏
- `unfavoritePost(postId)` - 取消收藏
- `votePost(postId, score)` - 投票
- `getFavoriteUsers(postId)` - 获取收藏该图片的用户

**参考文件**:
- `example/Boorusama-master/packages/booru_clients/lib/src/moebooru/moebooru_client.dart` ⭐ **主要参考**

**实现要点**:
```typescript
// 密码哈希算法
import crypto from 'crypto';

function hashPasswordSHA1(salt: string, password: string): string {
  const saltedPassword = salt.replace('{0}', password);
  return crypto.createHash('sha1').update(saltedPassword).digest('hex');
}

// API 认证参数
interface MoebooruAuth {
  login?: string;
  password_hash?: string;
}

// 请求示例
async function getPosts(params: {
  page?: number;
  limit?: number;
  tags?: string[];
}): Promise<PostDto[]> {
  const queryParams = {
    page: params.page || 1,
    limit: params.limit || 20,
    tags: params.tags?.join(' ') || '',
    ...this.getAuthParams()
  };
  
  const response = await this.dio.get('/post.json', { params: queryParams });
  return response.data.map(item => PostDto.fromJson(item));
}
```

---

#### 1.2 创建数据库服务层

**文件**: `src/main/services/booruService.ts`

**功能**:
- 站点管理（增删改查）
- 图片记录管理
- 标签管理
- 收藏管理
- 下载队列管理
- 搜索历史管理

**主要函数**:
```typescript
// 站点管理
export async function getBooruSites(): Promise<BooruSite[]>
export async function addBooruSite(site: Omit<BooruSite, 'id'>): Promise<number>
export async function updateBooruSite(id: number, updates: Partial<BooruSite>): Promise<void>
export async function deleteBooruSite(id: number): Promise<void>
export async function getActiveBooruSite(): Promise<BooruSite | null>

// 图片管理
export async function saveBooruPost(post: BooruPost): Promise<number>
export async function getBooruPosts(siteId: number, page: number, limit: number): Promise<BooruPost[]>
export async function searchBooruPosts(siteId: number, tags: string[], page: number): Promise<BooruPost[]>
export async function markPostAsDownloaded(postId: number, localPath: string, localImageId: number): Promise<void>

// 收藏管理
export async function addToFavorites(postId: number, siteId: number, notes?: string): Promise<number>
export async function removeFromFavorites(postId: number): Promise<void>
export async function getFavorites(siteId: number, page: number, limit: number): Promise<BooruPost[]>
export async function isFavorited(postId: number): Promise<boolean>

// 下载队列
export async function addToDownloadQueue(postId: number, siteId: number, priority?: number): Promise<number>
export async function getDownloadQueue(status?: string): Promise<DownloadQueueItem[]>
export async function updateDownloadProgress(id: number, progress: number, downloadedBytes: number): Promise<void>
export async function updateDownloadStatus(id: number, status: string, errorMessage?: string): Promise<void>
export async function removeFromDownloadQueue(id: number): Promise<void>

// 标签管理
export async function saveBooruTags(siteId: number, tags: BooruTag[]): Promise<void>
export async function searchBooruTags(siteId: number, query: string, limit?: number): Promise<BooruTag[]>
export async function getTagsByCategory(siteId: number, category: string): Promise<BooruTag[]>

// 搜索历史
export async function saveSearchHistory(siteId: number, query: string, resultCount: number): Promise<void>
export async function getSearchHistory(siteId: number, limit?: number): Promise<SearchHistoryItem[]>
export async function clearSearchHistory(siteId: number): Promise<void>
```

**参考文件**:
- `src/main/services/imageService.ts` (现有数据库服务)
- `example/Boorusama-master/lib/boorus/moebooru/moebooru_repository.dart`

---

#### 1.3 创建文件名生成器

**文件**: `src/main/services/filenameGenerator.ts`

**功能**:
- 根据模板生成文件名
- 支持多种标记（token）
- 处理非法字符
- 支持日期格式化
- 支持标签提取和分类

**标记列表**:
- `{id}` - 图片 ID
- `{md5}` - MD5
- `{extension}` - 扩展名
- `{width}` - 宽度
- `{height}` - 高度
- `{rating}` - 分级
- `{score}` - 评分
- `{site}` - 站点名称
- `{artist}` - 艺术家
- `{character}` - 角色
- `{copyright}` - 版权
- `{date}` - 日期
- `{tags}` - 标签

**参考文件**:
- `example/Boorusama-master/packages/filename_generator/lib/src/generator.dart` ⭐ **主要参考**
- `example/Boorusama-master/packages/filename_generator/lib/src/token.dart`
- `example/Boorusama-master/packages/filename_generator/lib/src/parser.dart`

**实现示例**:
```typescript
interface FileNameTokens {
  id?: string;
  md5?: string;
  extension?: string;
  width?: number;
  height?: number;
  rating?: string;
  score?: number;
  site?: string;
  artist?: string;
  character?: string;
  copyright?: string;
  date?: string;
  tags?: string;
}

function generateFileName(
  template: string,
  metadata: FileNameTokens
): string {
  let result = template;
  
  // 替换所有标记
  for (const [key, value] of Object.entries(metadata)) {
    const token = `{${key}}`;
    if (result.includes(token) && value !== undefined) {
      result = result.replace(token, String(value));
    }
  }
  
  // 移除未替换的标记
  result = result.replace(/\{[^}]+\}/g, '');
  
  // 清理非法字符
  result = sanitizeFileName(result);
  
  return result;
}

function sanitizeFileName(fileName: string): string {
  // 替换 Windows/Linux 非法字符
  return fileName.replace(/[<>:"/\\|?*]/g, '_');
}

// 从标签中提取特定类别
function extractTagsByCategory(
  tags: string,
  category: 'artist' | 'character' | 'copyright'
): string[] {
  // 需要从 booru_tags 表中查询标签分类
  // 或者从标签字符串中解析（如果包含类别前缀）
  // 例如: "artist:yoko" -> ["yoko"]
}
```

---

### 阶段 2: 下载管理器

#### 2.1 创建下载管理器

**文件**: `src/main/services/downloadManager.ts`

**功能**:
- 下载队列管理
- 并发控制
- 断点续传
- 进度回调
- 错误重试
- 下载暂停/恢复/取消

**参考文件**:
- `example/Boorusama-master/lib/core/download_manager/` ⭐ **主要参考**
- `example/Boorusama-master/lib/core/bulk_downloads/`

**主要接口**:
```typescript
class DownloadManager {
  private queue: DownloadQueueItem[] = [];
  private activeDownloads: Map<number, DownloadTask> = new Map();
  private maxConcurrent: number = 3;
  
  // 添加到下载队列
  async addToQueue(postId: number, siteId: number): Promise<number>
  
  // 开始下载
  async startDownload(queueId: number): Promise<void>
  
  // 暂停下载
  async pauseDownload(queueId: number): Promise<void>
  
  // 恢复下载
  async resumeDownload(queueId: number): Promise<void>
  
  // 取消下载
  async cancelDownload(queueId: number): Promise<void>
  
  // 重试失败的下载
  async retryDownload(queueId: number): Promise<void>
  
  // 批量下载
  async batchDownload(postIds: number[], siteId: number): Promise<void>
  
  // 获取下载进度
  getProgress(queueId: number): DownloadProgress
  
  // 监听进度事件
  onProgress(callback: (progress: DownloadProgress) => void): void
  
  // 监听完成事件
  onComplete(callback: (queueId: number) => void): void
  
  // 监听错误事件
  onError(callback: (queueId: number, error: Error) => void): void
}

interface DownloadProgress {
  queueId: number;
  postId: number;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'paused';
  progress: number; // 0-100
  downloadedBytes: number;
  totalBytes: number;
  speed: number; // bytes/s
  eta: number; // seconds
}
```

**实现要点**:
- 使用 `axios` 或 `node-fetch` 下载文件
- 支持 `Range` 请求实现断点续传
- 使用 `fs.createWriteStream` 写入文件
- 实现并发控制队列
- 错误处理和自动重试

---

### 阶段 3: IPC 通信层

#### 3.1 添加 IPC 通道

**文件**: `src/main/ipc/channels.ts`

添加以下通道定义:

```typescript
export const IPC_CHANNELS = {
  // ... 现有通道 ...
  
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
  BOORU_GET_DOWNLOAD_QUEUE: 'booru:get-download-queue',
  BOORU_BATCH_DOWNLOAD: 'booru:batch-download',
  
  // Booru 搜索历史
  BOORU_GET_SEARCH_HISTORY: 'booru:get-search-history',
  BOORU_CLEAR_SEARCH_HISTORY: 'booru:clear-search-history',
  
  // Booru 评论
  BOORU_GET_COMMENTS: 'booru:get-comments',
} as const;
```

---

#### 3.2 实现 IPC 处理器

**文件**: `src/main/ipc/handlers.ts`

在现有的 `setupIPC()` 函数中添加新的处理器:

```typescript
import { MoebooruClient } from '../services/moebooruClient.js';
import * as booruService from '../services/booruService.js';
import { DownloadManager } from '../services/downloadManager.js';

export function setupIPC() {
  // ... 现有处理器 ...
  
  // 获取 Booru 站点列表
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_SITES, async () => {
    try {
      const sites = await booruService.getBooruSites();
      return { success: true, data: sites };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  // 获取图片列表
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_POSTS, async (_event, siteId: number, page: number, tags?: string[]) => {
    try {
      const site = await booruService.getBooruSiteById(siteId);
      const client = new MoebooruClient({
        baseUrl: site.url,
        login: site.username,
        passwordHash: site.passwordHash
      });
      
      const posts = await client.getPosts({ page, tags });
      
      // 保存到数据库
      for (const post of posts) {
        await booruService.saveBooruPost({ ...post, siteId });
      }
      
      return { success: true, data: posts };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  // 添加收藏
  ipcMain.handle(IPC_CHANNELS.BOORU_ADD_FAVORITE, async (_event, postId: number, siteId: number, syncToServer: boolean) => {
    try {
      // 添加本地收藏
      await booruService.addToFavorites(postId, siteId);
      
      // 可选：同步到服务器
      if (syncToServer) {
        const site = await booruService.getBooruSiteById(siteId);
        const client = new MoebooruClient({
          baseUrl: site.url,
          login: site.username,
          passwordHash: site.passwordHash
        });
        
        const post = await booruService.getBooruPostById(postId);
        await client.favoritePost({ postId: post.postId });
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  // 添加到下载队列
  ipcMain.handle(IPC_CHANNELS.BOORU_ADD_TO_DOWNLOAD, async (_event, postId: number, siteId: number) => {
    try {
      const downloadManager = DownloadManager.getInstance();
      const queueId = await downloadManager.addToQueue(postId, siteId);
      return { success: true, data: queueId };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  // ... 更多处理器 ...
}
```

**参考文件**:
- `src/main/ipc/handlers.ts` (现有实现)
- `example/Boorusama-master/lib/boorus/moebooru/**/providers.dart` (各功能的 provider 实现)

---

#### 3.3 更新 Preload 脚本

**文件**: `src/preload/index.ts`

添加 Booru API 到 `electronAPI`:

```typescript
contextBridge.exposeInMainWorld('electronAPI', {
  // ... 现有 API ...
  
  booru: {
    // 站点管理
    getSites: () => ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_SITES),
    addSite: (site: any) => ipcRenderer.invoke(IPC_CHANNELS.BOORU_ADD_SITE, site),
    updateSite: (id: number, updates: any) => ipcRenderer.invoke(IPC_CHANNELS.BOORU_UPDATE_SITE, id, updates),
    deleteSite: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.BOORU_DELETE_SITE, id),
    getActiveSite: () => ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_ACTIVE_SITE),
    setActiveSite: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.BOORU_SET_ACTIVE_SITE, id),
    
    // 图片
    getPosts: (siteId: number, page: number, tags?: string[]) => 
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_POSTS, siteId, page, tags),
    getPost: (siteId: number, postId: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_POST, siteId, postId),
    searchPosts: (siteId: number, tags: string[], page: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_SEARCH_POSTS, siteId, tags, page),
    getPopular: (siteId: number, period: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_POPULAR, siteId, period),
    
    // 标签
    getTags: (siteId: number) => ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_TAGS, siteId),
    searchTags: (siteId: number, query: string, limit?: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_SEARCH_TAGS, siteId, query, limit),
    getTagAutocomplete: (siteId: number, query: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_TAG_AUTOCOMPLETE, siteId, query),
    
    // 收藏
    addFavorite: (postId: number, siteId: number, syncToServer: boolean) => 
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_ADD_FAVORITE, postId, siteId, syncToServer),
    removeFavorite: (postId: number, syncToServer: boolean) => 
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_REMOVE_FAVORITE, postId, syncToServer),
    getFavorites: (siteId: number, page: number, limit: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_FAVORITES, siteId, page, limit),
    isFavorited: (postId: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_IS_FAVORITED, postId),
    
    // 下载
    addToDownload: (postId: number, siteId: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_ADD_TO_DOWNLOAD, postId, siteId),
    startDownload: (queueId: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_START_DOWNLOAD, queueId),
    pauseDownload: (queueId: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_PAUSE_DOWNLOAD, queueId),
    resumeDownload: (queueId: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_RESUME_DOWNLOAD, queueId),
    cancelDownload: (queueId: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_CANCEL_DOWNLOAD, queueId),
    getDownloadQueue: (status?: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_DOWNLOAD_QUEUE, status),
    batchDownload: (postIds: number[], siteId: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_BATCH_DOWNLOAD, postIds, siteId),
    
    // 下载进度监听
    onDownloadProgress: (callback: (progress: any) => void) => 
      ipcRenderer.on('booru:download-progress', (_event, progress) => callback(progress)),
    onDownloadComplete: (callback: (queueId: number) => void) => 
      ipcRenderer.on('booru:download-complete', (_event, queueId) => callback(queueId)),
    onDownloadError: (callback: (error: any) => void) => 
      ipcRenderer.on('booru:download-error', (_event, error) => callback(error)),
    
    // 搜索历史
    getSearchHistory: (siteId: number, limit?: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_SEARCH_HISTORY, siteId, limit),
    clearSearchHistory: (siteId: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_CLEAR_SEARCH_HISTORY, siteId),
    
    // 评论
    getComments: (siteId: number, postId: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.BOORU_GET_COMMENTS, siteId, postId),
  }
});
```

---

### 阶段 4: 前端界面

#### 4.1 创建 Booru 页面组件

**文件**: `src/renderer/pages/BooruPage.tsx`

**功能**:
- 显示 Booru 图片列表（瀑布流/网格布局）
- 搜索功能（标签搜索、自动补全）
- 分页/无限滚动
- 图片详情查看
- 收藏/取消收藏
- 下载图片
- 分级过滤
- 站点切换

**UI 布局**:
```
┌─────────────────────────────────────────┐
│ [站点选择] [搜索框]           [分级筛选] │
├─────────────────────────────────────────┤
│                                         │
│  ┌────┐  ┌────┐  ┌────┐  ┌────┐       │
│  │图片│  │图片│  │图片│  │图片│       │
│  │ 1  │  │ 2  │  │ 3  │  │ 4  │       │
│  │❤️ 📥│  │❤️ 📥│  │❤️ 📥│  │❤️ 📥│       │
│  └────┘  └────┘  └────┘  └────┘       │
│                                         │
│  ┌────┐  ┌────┐  ┌────┐  ┌────┐       │
│  │图片│  │图片│  │图片│  │图片│       │
│  │ 5  │  │ 6  │  │ 7  │  │ 8  │       │
│  │❤️ 📥│  │❤️ 📥│  │❤️ 📥│  │❤️ 📥│       │
│  └────┘  └────┘  └────┘  └────┘       │
│                                         │
│         [加载更多] / 分页导航           │
└─────────────────────────────────────────┘
```

**参考文件**:
- `src/renderer/pages/GalleryPage.tsx` (现有图片列表页面)
- `example/Boorusama-master/lib/boorus/moebooru/popular/src/pages/popular_page.dart`
- `example/Boorusama-master/lib/core/posts/` (图片列表组件)

---

#### 4.2 创建 Booru 图片卡片组件

**文件**: `src/renderer/components/BooruImageCard.tsx`

**功能**:
- 显示缩略图
- 显示标签、评分、分级
- 收藏按钮（心形图标）
- 下载按钮
- 点击查看详情
- 懒加载

**参考文件**:
- `src/renderer/components/ImageCard.tsx` (现有图片卡片)
- `example/Boorusama-master/lib/core/posts/` (图片卡片组件)

---

#### 4.3 创建图片详情模态框

**文件**: `src/renderer/components/BooruImageModal.tsx`

**功能**:
- 显示大图
- 显示完整信息（标签、评分、来源、尺寸等）
- 标签列表（可点击搜索）
- 收藏按钮
- 下载按钮
- 在站点打开
- 评论列表（可选）
- 相关图片（可选）

**参考文件**:
- `example/Boorusama-master/lib/boorus/moebooru/post_details/src/details_page.dart` ⭐
- `example/Boorusama-master/lib/boorus/moebooru/post_details/src/widgets/`

---

#### 4.4 创建收藏页面

**文件**: `src/renderer/pages/BooruFavoritesPage.tsx`

**功能**:
- 显示收藏的图片列表
- 按站点筛选
- 搜索收藏
- 批量操作（取消收藏、下载）
- 排序（按收藏时间、评分等）

**参考文件**:
- `example/Boorusama-master/lib/core/bookmarks/src/pages/bookmark_page.dart`

---

#### 4.5 创建下载管理页面

**文件**: `src/renderer/pages/BooruDownloadPage.tsx`

**功能**:
- 显示下载队列
- 显示下载进度
- 暂停/恢复/取消下载
- 重试失败的下载
- 查看下载历史
- 批量操作

**UI 布局**:
```
┌─────────────────────────────────────────┐
│ 下载中 (3) │ 已完成 (15) │ 失败 (2)    │
├─────────────────────────────────────────┤
│ 图片 ID  │ 文件名  │ 进度  │ 速度 │ 操作│
├─────────────────────────────────────────┤
│ 123456  │ test.jpg│ ████░ │ 1.2M │暂停 │
│ 123457  │ test2.jpg│█████ │ 0.8M │暂停 │
│ 123458  │ test3.jpg│██░░░ │ 2.1M │暂停 │
└─────────────────────────────────────────┘
```

**参考文件**:
- `src/renderer/pages/DownloadPage.tsx` (现有下载页面)
- `example/Boorusama-master/lib/core/bulk_downloads/`

---

#### 4.6 创建站点设置页面

**文件**: `src/renderer/pages/BooruSettingsPage.tsx`

**功能**:
- 站点列表管理（添加、编辑、删除）
- 配置 API Key 和用户名
- 默认站点设置
- 下载设置（路径、文件名格式等）
- 过滤设置（分级、黑名单标签等）

**参考文件**:
- `src/renderer/pages/SettingsPage.tsx` (现有设置页面)
- `example/Boorusama-master/lib/boorus/moebooru/configs/widgets.dart`

---

#### 4.7 创建标签搜索组件

**文件**: `src/renderer/components/BooruTagSearch.tsx`

**功能**:
- 标签输入框
- 自动补全
- 标签建议
- 已选标签展示
- 标签分类显示（艺术家、角色、版权等）

**参考文件**:
- `example/Boorusama-master/lib/core/search/` ⭐
- `example/Boorusama-master/lib/boorus/moebooru/autocompletes/`

---

#### 4.8 更新主应用路由

**文件**: `src/renderer/App.tsx`

在主菜单中添加 Booru 相关页面:

```typescript
const mainMenuItems: MenuItem[] = [
  { key: 'gallery', icon: <PictureOutlined />, label: '图库' },
  { key: 'booru', icon: <CloudDownloadOutlined />, label: 'Booru' },  // 新增
  { key: 'download', icon: <CloudDownloadOutlined />, label: 'Yande.re' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置' }
];

const booruSubMenuItems: MenuItem[] = [
  { key: 'posts', icon: <AppstoreOutlined />, label: '图片' },
  { key: 'favorites', icon: <HeartOutlined />, label: '收藏' },
  { key: 'downloads', icon: <DownloadOutlined />, label: '下载' },
  { key: 'settings', icon: <SettingOutlined />, label: '站点设置' }
];
```

---

### 阶段 5: 类型定义

#### 5.1 更新类型定义

**文件**: `src/shared/types.ts`

添加 Booru 相关类型:

```typescript
// Booru 站点
export interface BooruSite {
  id: number;
  name: string;
  url: string;
  type: 'moebooru' | 'danbooru' | 'gelbooru';
  salt?: string;
  version?: string;
  apiKey?: string;
  username?: string;
  passwordHash?: string;
  favoriteSupport: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// Booru 图片
export interface BooruPost {
  id: number;
  siteId: number;
  postId: number;
  md5?: string;
  fileUrl: string;
  previewUrl?: string;
  sampleUrl?: string;
  width?: number;
  height?: number;
  fileSize?: number;
  fileExt?: string;
  rating?: 'safe' | 'questionable' | 'explicit';
  score?: number;
  source?: string;
  tags: string;
  downloaded: boolean;
  localPath?: string;
  localImageId?: number;
  isFavorited: boolean;
  createdAt: string;
  updatedAt: string;
}

// Booru 标签
export interface BooruTag {
  id: number;
  siteId: number;
  name: string;
  category?: 'artist' | 'character' | 'copyright' | 'general' | 'meta';
  postCount: number;
  createdAt: string;
}

// 收藏
export interface BooruFavorite {
  id: number;
  postId: number;
  siteId: number;
  notes?: string;
  createdAt: string;
}

// 下载队列项
export interface DownloadQueueItem {
  id: number;
  postId: number;
  siteId: number;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'paused';
  progress: number;
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
export interface SearchHistoryItem {
  id: number;
  siteId: number;
  query: string;
  resultCount: number;
  createdAt: string;
}
```

---

## 四、测试计划

### 4.1 单元测试

- [ ] 测试 Moebooru API 客户端各接口
- [ ] 测试密码哈希算法
- [ ] 测试文件名生成器
- [ ] 测试数据库服务层各函数
- [ ] 测试下载管理器

### 4.2 集成测试

- [ ] 测试完整的图片浏览流程
- [ ] 测试搜索功能
- [ ] 测试收藏功能（本地+服务器）
- [ ] 测试下载流程（包括断点续传）
- [ ] 测试站点切换

### 4.3 UI 测试

- [ ] 测试图片列表渲染
- [ ] 测试无限滚动/分页
- [ ] 测试图片详情模态框
- [ ] 测试下载进度显示
- [ ] 测试响应式布局

---

## 五、开发顺序建议

### 阶段 1: 基础设施 (1-2 周)
1. 数据库表创建和迁移
2. 配置文件更新
3. Moebooru API 客户端实现
4. 数据库服务层实现
5. 类型定义更新

### 阶段 2: 核心功能 (2-3 周)
1. 图片获取和显示
2. 标签搜索和自动补全
3. 收藏功能（本地）
4. IPC 通信层实现
5. 前端页面基础框架

### 阶段 3: 下载功能 (1-2 周)
1. 文件名生成器
2. 下载管理器
3. 下载队列 UI
4. 批量下载

### 阶段 4: 高级功能 (1-2 周)
1. 服务器收藏同步
2. 评论功能
3. 热门图片
4. 搜索历史
5. 站点管理 UI

### 阶段 5: 优化和完善 (1 周)
1. 性能优化
2. 错误处理完善
3. 用户体验优化
4. 文档编写
5. 测试和 Bug 修复

**总预计时间**: 6-10 周

---

## 六、注意事项

### 6.1 API 限流

Moebooru 站点通常有 API 限流：
- Yande.re: 2 请求/秒
- Konachan: 1 请求/秒

**解决方案**:
- 实现请求队列和延迟
- 缓存请求结果
- 尊重 `Retry-After` 响应头

### 6.2 密码安全

- 密码哈希使用 SHA1（Moebooru 标准）
- 不同站点使用不同的 salt
- API Key 和密码加密存储

### 6.3 文件去重

下载前检查:
- MD5 哈希
- 文件是否已存在
- 避免重复下载

### 6.4 数据迁移

- 保留现有 `yande_images` 表作为备份
- 提供迁移脚本将数据迁移到新表
- 确保迁移过程可逆

### 6.5 错误处理

- 网络错误自动重试
- API 错误友好提示
- 下载失败保存状态，支持恢复

### 6.6 性能优化

- 图片懒加载
- 虚拟滚动（大列表）
- 缩略图缓存
- 数据库查询优化（索引）

---

## 七、参考资源

### 7.1 官方文档

- [Moebooru GitHub](https://github.com/moebooru/moebooru)
- [Yande.re API](https://yande.re/help/api)
- [Konachan API](https://konachan.com/help/api)

### 7.2 参考项目

- **Boorusama** (Flutter): `example/Boorusama-master/`
  - 完整的 Moebooru 客户端实现
  - 优秀的架构设计
  - 丰富的功能参考

### 7.3 关键参考文件

**API 客户端**:
- `example/Boorusama-master/packages/booru_clients/lib/src/moebooru/moebooru_client.dart`

**文件名生成**:
- `example/Boorusama-master/packages/filename_generator/lib/src/generator.dart`

**收藏功能**:
- `example/Boorusama-master/lib/boorus/moebooru/favorites/providers.dart`
- `example/Boorusama-master/lib/core/bookmarks/`

**下载功能**:
- `example/Boorusama-master/lib/core/download_manager/`
- `example/Boorusama-master/lib/core/bulk_downloads/`

**UI 组件**:
- `example/Boorusama-master/lib/boorus/moebooru/post_details/`
- `example/Boorusama-master/lib/core/posts/`

---

## 八、里程碑

- [ ] **里程碑 1**: 数据库和 API 客户端完成
- [ ] **里程碑 2**: 基础图片浏览功能完成
- [ ] **里程碑 3**: 搜索和收藏功能完成
- [ ] **里程碑 4**: 下载功能完成
- [ ] **里程碑 5**: 所有功能集成完成
- [ ] **里程碑 6**: 测试和优化完成

---

**最后更新**: 2025-11-18
**作者**: Claude AI
**状态**: 待开始

