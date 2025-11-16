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