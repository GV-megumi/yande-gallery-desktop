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