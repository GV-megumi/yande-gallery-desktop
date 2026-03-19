// 图片类型定义
export interface Image {
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

// 标签类型定义
export interface Tag {
  id: number;
  name: string;
  category?: string;
  createdAt: string;
}

// IPC通信类型
export interface IPCChannels {
  // 数据库操作
  'db:init': () => Promise<{ success: boolean; error?: string }>;
  'db:get-images': (page: number, pageSize: number) => Promise<{ success: boolean; data?: Image[]; error?: string }>;
  'db:add-image': (image: Omit<Image, 'id' | 'createdAt' | 'updatedAt'>) => Promise<{ success: boolean; data?: number; error?: string }>;
  'db:search-images': (query: string) => Promise<{ success: boolean; data?: Image[]; error?: string }>;

  // 图片操作
  'image:scan-folder': (folderPath: string) => Promise<{ success: boolean; data?: Image[]; error?: string }>;
  'image:generate-thumbnail': (imagePath: string) => Promise<{ success: boolean; data?: string; error?: string }>;

  // 系统操作
  'system:select-folder': () => Promise<{ success: boolean; data?: string; error?: string }>;
  'system:open-external': (url: string) => Promise<void>;
  'system:show-item': (path: string) => Promise<void>;
}

// API响应统一格式
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ========= Booru 相关类型定义 (新增) =========

// Booru站点配置
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

// Booru图片
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
  author?: string;
  downloaded: boolean;
  localPath?: string;
  localImageId?: number;
  isFavorited: boolean;
  /** 服务端喜欢状态（vote:3），持久化到 DB，用于跨页面恢复显示 */
  isLiked?: boolean;
  createdAt: string;
  updatedAt: string;
}

// Booru标签
export interface BooruTag {
  id: number;
  siteId: number;
  name: string;
  category?: 'artist' | 'character' | 'copyright' | 'general' | 'meta';
  postCount: number;
  createdAt: string;
}

// Booru收藏
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

// 搜索历史项
export interface SearchHistoryItem {
  id: number;
  siteId: number;
  query: string;
  resultCount: number;
  createdAt: string;
}

// ========= 批量下载相关类型定义 =========

// 批量下载任务状态
export type BulkDownloadSessionStatus = 
  | 'pending' 
  | 'dryRun' 
  | 'running' 
  | 'completed' 
  | 'allSkipped' 
  | 'failed' 
  | 'paused' 
  | 'suspended' 
  | 'cancelled';

export type FavoriteTagDownloadDisplayStatus =
  | BulkDownloadSessionStatus
  | 'notConfigured'
  | 'ready'
  | 'starting'
  | 'validationError'
  | 'taskCreateFailed'
  | 'sessionCreateFailed';

// 批量下载记录状态
export type BulkDownloadRecordStatus = 
  | 'pending' 
  | 'downloading' 
  | 'paused' 
  | 'completed' 
  | 'failed' 
  | 'cancelled';

// 批量下载任务配置
export interface BulkDownloadTask {
  id: string;
  siteId: number;
  path: string;
  tags: string;  // 空格分隔的标签字符串
  blacklistedTags?: string;
  notifications: boolean;
  skipIfExists: boolean;
  quality?: string;
  perPage: number;
  concurrency: number;
  createdAt: string;
  updatedAt: string;
}

// 批量下载会话
export interface BulkDownloadSession {
  id: string;
  taskId: string;
  siteId: number;
  status: BulkDownloadSessionStatus;
  startedAt: string;
  completedAt?: string;
  currentPage: number;
  totalPages?: number;
  error?: string;
  originType?: 'favoriteTag';
  originId?: number;
  task?: BulkDownloadTask;
  stats?: BulkDownloadSessionStats;
}

// 批量下载记录
export interface BulkDownloadRecord {
  url: string;
  sessionId: string;
  status: BulkDownloadRecordStatus;
  page: number;
  pageIndex: number;
  createdAt: string;
  fileSize?: number;
  fileName: string;
  extension?: string;
  error?: string;
  downloadId?: string;
  headers?: Record<string, string>;
  thumbnailUrl?: string;
  sourceUrl?: string;
  progress?: number; // 下载进度（0-100）
  downloadedBytes?: number; // 已下载字节数
  totalBytes?: number; // 总字节数
}

// 批量下载会话统计
export interface BulkDownloadSessionStats {
  id?: number;
  sessionId: string;
  coverUrl?: string;
  siteUrl?: string;
  totalFiles: number;
  totalSize?: number;
  averageDuration?: number;
  averageFileSize?: number;
  largestFileSize?: number;
  smallestFileSize?: number;
  medianFileSize?: number;
  avgFilesPerPage?: number;
  maxFilesPerPage?: number;
  minFilesPerPage?: number;
  extensionCounts?: Record<string, number>;
}

// ========= 收藏标签相关类型定义 =========

// 收藏标签
export interface FavoriteTag {
  id: number;
  siteId: number | null;      // null = 全局
  tagName: string;
  labels?: string[];          // 分组标签（JSON 数组）
  queryType: 'tag' | 'raw' | 'list';  // 查询类型
  notes?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt?: string;
}

export interface FavoriteTagDownloadBinding {
  id: number;
  favoriteTagId: number;
  galleryId: number | null;
  downloadPath: string;
  enabled: boolean;
  autoCreateGallery?: boolean | null;
  autoSyncGalleryAfterDownload?: boolean | null;
  quality?: string | null;
  perPage?: number | null;
  concurrency?: number | null;
  skipIfExists?: boolean | null;
  notifications?: boolean | null;
  blacklistedTags?: string[] | null;
  lastTaskId?: string | null;
  lastSessionId?: string | null;
  lastStartedAt?: string | null;
  lastCompletedAt?: string | null;
  lastStatus?: FavoriteTagDownloadDisplayStatus | null;
  createdAt: string;
  updatedAt: string;
}

export interface FavoriteTagDownloadRuntimeProgress {
  sessionId: string;
  status: BulkDownloadSessionStatus;
  completed: number;
  total: number;
  percent: number;
  failed?: number;
}

export interface FavoriteTagWithDownloadState extends FavoriteTag {
  downloadBinding?: FavoriteTagDownloadBinding;
  resolvedDownloadPath?: string | null;
  runtimeProgress?: FavoriteTagDownloadRuntimeProgress | null;
  galleryName?: string | null;
  galleryBindingConsistent?: boolean | null;
  galleryBindingMismatchReason?: string | null;
}

export interface UpsertFavoriteTagDownloadBindingInput {
  favoriteTagId: number;
  galleryId?: number | null;
  downloadPath: string;
  enabled?: boolean;
  autoCreateGallery?: boolean | null;
  autoSyncGalleryAfterDownload?: boolean | null;
  quality?: string | null;
  perPage?: number | null;
  concurrency?: number | null;
  skipIfExists?: boolean | null;
  notifications?: boolean | null;
  blacklistedTags?: string[] | null;
}

// 标签分组
export interface FavoriteTagLabel {
  id: number;
  name: string;
  color?: string;
  sortOrder: number;
  createdAt: string;
}

// ========= 黑名单标签相关类型定义 =========

// 黑名单标签
export interface BlacklistedTag {
  id: number;
  siteId: number | null;  // null = 全局黑名单
  tagName: string;
  isActive: boolean;      // 是否激活
  reason?: string;        // 黑名单原因（可选）
  createdAt: string;
  updatedAt?: string;
}

// 黑名单排序类型
export type BlacklistedTagsSortType = 'recentlyAdded' | 'nameAZ' | 'nameZA';

// ========= 评论相关类型定义 =========

// Booru 评论
export interface BooruComment {
  id: number;
  postId: number;
  body: string;
  creator: string;
  creatorId: number;
  createdAt: string;
  updatedAt?: string;
}

// ========= Pool 相关类型定义 =========

// Booru Pool（图集）
export interface BooruPool {
  id: number;
  name: string;
  description?: string;
  postCount: number;
  createdAt: string;
  updatedAt?: string;
  isPublic: boolean;
  userId?: number;
}

// Pool 详情（包含图片列表）
export interface BooruPoolDetail extends BooruPool {
  posts: BooruPost[];
}

// ========= Wiki 相关类型定义 =========

// Booru Wiki 页面（当前主要用于 Danbooru）
export interface BooruWiki {
  id: number;
  title: string;
  body: string;
  otherNames: string[];
  createdAt?: string;
  updatedAt?: string;
  isLocked?: boolean;
  isDeleted?: boolean;
}

// ========= Forum 相关类型定义 =========

// Booru 论坛主题（当前主要用于 Danbooru）
export interface BooruForumTopic {
  id: number;
  title: string;
  responseCount: number;
  isSticky?: boolean;
  isLocked?: boolean;
  isHidden?: boolean;
  categoryId?: number;
  creatorId?: number;
  updaterId?: number;
  createdAt?: string;
  updatedAt?: string;
}

// Booru 论坛帖子（当前主要用于 Danbooru）
export interface BooruForumPost {
  id: number;
  topicId: number;
  body: string;
  creatorId?: number;
  updaterId?: number;
  createdAt?: string;
  updatedAt?: string;
  isDeleted?: boolean;
  isHidden?: boolean;
}

// ========= User 相关类型定义 =========

// Booru 用户主页（当前主要用于 Danbooru）
export interface BooruUserProfile {
  id: number;
  name: string;
  levelString?: string;
  createdAt?: string;
  avatarUrl?: string;
  postUploadCount?: number;
  postUpdateCount?: number;
  noteUpdateCount?: number;
  commentCount?: number;
  forumPostCount?: number;
  favoriteCount?: number;
  feedbackCount?: number;
}

// ========= 投票相关类型定义 =========

// 投票分数：1=up, 0=neutral, -1=down
export type VoteScore = 1 | 0 | -1;

// 批量下载任务选项（用于创建任务）
export interface BulkDownloadOptions {
  siteId: number;
  path: string;
  tags: string[];
  blacklistedTags?: string[];
  notifications?: boolean;
  skipIfExists?: boolean;
  quality?: string;
  perPage?: number;
  concurrency?: number;
}
