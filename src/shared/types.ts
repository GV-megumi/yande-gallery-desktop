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

// Yande.re图片类型
export interface YandeImage {
  id: number;
  yandeId: number;
  filename: string;
  fileUrl: string;
  previewUrl: string;
  rating: 'safe' | 'questionable' | 'explicit';
  tags: string[];
  downloaded: boolean;
  localPath?: string;
  createdAt: string;
}

// 下载任务类型
export interface DownloadTask {
  id: string;
  yandeImage: YandeImage;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  error?: string;
  createdAt: string;
  completedAt?: string;
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

  // Yande.re API
  'yande:get-images': (page: number, tags?: string[]) => Promise<{ success: boolean; data?: YandeImage[]; error?: string }>;
  'yande:search-images': (tags: string[], page?: number) => Promise<{ success: boolean; data?: YandeImage[]; error?: string }>;
  'yande:download-image': (imageData: YandeImage) => Promise<{ success: boolean; data?: string; error?: string }>;

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
  downloaded: boolean;
  localPath?: string;
  localImageId?: number;
  isFavorited: boolean;
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