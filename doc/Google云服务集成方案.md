# Google Drive & Google Photos 集成方案

## 一、目标

- **Google Drive**：完全管理（浏览、上传、下载、删除、创建文件夹）
- **Google Photos**：浏览已有照片/相册 + 从本地上传新照片

---

## 二、前置准备（Google Cloud Console）

### 2.1 创建项目与启用 API

1. 打开 https://console.cloud.google.com
2. 创建新项目（如 `yande-gallery`）
3. 进入 **API 和服务 → 库**，启用：
   - `Google Drive API`
   - `Photos Library API`
4. 进入 **API 和服务 → 凭据**，创建 **OAuth 2.0 客户端 ID**：
   - 应用类型选择 **桌面应用**
   - 获得 `Client ID` 和 `Client Secret`
5. 配置 **OAuth 同意屏幕**：
   - 用户类型：外部（测试模式，最多 100 个测试用户，自用足够）
   - 添加 Scopes（见下文）

### 2.2 所需 OAuth Scopes

```
# Google Drive（完全管理）
https://www.googleapis.com/auth/drive

# Google Photos（只读 + 上传）
https://www.googleapis.com/auth/photoslibrary.readonly
https://www.googleapis.com/auth/photoslibrary.appendonly
```

---

## 三、架构设计

### 3.1 整体架构

沿用现有 IPC 代理模式，所有 Google API 调用在主进程完成：

```
渲染进程                         主进程
  │                               │
  ├─ electronAPI.gdrive.*  ─IPC─> googleDriveService.ts  ─HTTPS─> Google Drive API
  │                               │
  └─ electronAPI.gphotos.* ─IPC─> googlePhotosService.ts ─HTTPS─> Photos Library API
                                  │
                            googleAuthService.ts（OAuth 管理）
```

### 3.2 新增文件结构

```
src/main/services/
  ├── googleAuthService.ts        # OAuth 认证（登录、token 存储、刷新）
  ├── googleDriveService.ts       # Google Drive API 封装
  └── googlePhotosService.ts      # Google Photos API 封装

src/main/ipc/
  └── googleHandlers.ts           # Google 相关 IPC 处理器

src/renderer/pages/
  ├── GoogleDrivePage.tsx          # Google Drive 文件管理页面
  └── GooglePhotosPage.tsx         # Google Photos 浏览/上传页面
```

### 3.3 IPC 通道规划

```typescript
// channels.ts 新增
const GOOGLE_CHANNELS = {
  // === 认证 ===
  GOOGLE_AUTH_LOGIN: 'google:auth-login',           // 弹出 OAuth 登录窗口
  GOOGLE_AUTH_LOGOUT: 'google:auth-logout',         // 退出登录
  GOOGLE_AUTH_STATUS: 'google:auth-status',         // 获取登录状态
  GOOGLE_AUTH_REFRESH: 'google:auth-refresh',       // 刷新 token

  // === Google Drive ===
  GDRIVE_LIST_FILES: 'gdrive:list-files',           // 列出文件/文件夹
  GDRIVE_SEARCH: 'gdrive:search',                   // 搜索文件
  GDRIVE_GET_FILE: 'gdrive:get-file',               // 获取文件元数据
  GDRIVE_DOWNLOAD: 'gdrive:download',               // 下载文件到本地
  GDRIVE_UPLOAD: 'gdrive:upload',                   // 上传本地文件
  GDRIVE_DELETE: 'gdrive:delete',                   // 删除文件
  GDRIVE_CREATE_FOLDER: 'gdrive:create-folder',     // 创建文件夹
  GDRIVE_MOVE: 'gdrive:move',                       // 移动文件
  GDRIVE_GET_THUMBNAIL: 'gdrive:get-thumbnail',     // 获取缩略图
  GDRIVE_GET_STORAGE: 'gdrive:get-storage',         // 获取存储空间信息

  // === Google Photos ===
  GPHOTOS_LIST_ALBUMS: 'gphotos:list-albums',       // 列出相册
  GPHOTOS_GET_ALBUM: 'gphotos:get-album',           // 获取相册详情
  GPHOTOS_LIST_PHOTOS: 'gphotos:list-photos',       // 列出照片（支持分页）
  GPHOTOS_SEARCH: 'gphotos:search',                 // 按日期/类型搜索
  GPHOTOS_GET_PHOTO: 'gphotos:get-photo',           // 获取照片详情和下载 URL
  GPHOTOS_DOWNLOAD: 'gphotos:download',             // 下载照片到本地
  GPHOTOS_UPLOAD: 'gphotos:upload',                 // 上传本地照片
  GPHOTOS_CREATE_ALBUM: 'gphotos:create-album',     // 创建相册
} as const;
```

---

## 四、模块详细设计

### 4.1 OAuth 认证服务 (googleAuthService.ts)

#### 核心职责
- 弹出 BrowserWindow 让用户登录 Google
- 获取 authorization code，换取 access_token + refresh_token
- 持久化存储 token（使用 electron-store，已有依赖）
- 自动检测 token 过期并刷新

#### 认证流程

```
1. 用户点击「登录 Google」
2. 主进程打开 BrowserWindow，加载 Google OAuth URL：
   https://accounts.google.com/o/oauth2/v2/auth?
     client_id=xxx&
     redirect_uri=http://localhost:PORT/callback&  (本地临时 HTTP Server)
     scope=drive+photoslibrary.readonly+photoslibrary.appendonly&
     response_type=code&
     access_type=offline&         (获取 refresh_token)
     prompt=consent
3. 用户在弹窗中登录并授权
4. Google 重定向到 localhost:PORT/callback?code=xxx
5. 本地 HTTP Server 截获 code，关闭弹窗
6. 用 code 换取 access_token + refresh_token
7. 存储到 electron-store
```

#### 关键接口

```typescript
interface GoogleAuthService {
  // 发起 OAuth 登录（弹出窗口）
  login(): Promise<{ success: boolean; email?: string; error?: string }>;

  // 退出登录（清除 token）
  logout(): void;

  // 获取当前登录状态
  getStatus(): { loggedIn: boolean; email?: string; expiresAt?: number };

  // 获取有效的 access_token（自动刷新）
  getAccessToken(): Promise<string>;

  // 获取带认证头的 axios 实例
  getAuthClient(): Promise<AxiosInstance>;
}
```

#### Token 存储结构（electron-store）

```json
{
  "google": {
    "accessToken": "ya29.xxx",
    "refreshToken": "1//xxx",
    "expiresAt": 1710000000000,
    "email": "user@gmail.com",
    "scope": "drive photoslibrary.readonly photoslibrary.appendonly"
  }
}
```

### 4.2 Google Drive 服务 (googleDriveService.ts)

#### API 基础信息

- Base URL: `https://www.googleapis.com/drive/v3`
- 上传 URL: `https://www.googleapis.com/upload/drive/v3`
- 认证: `Authorization: Bearer {access_token}`

#### 核心方法

```typescript
interface GoogleDriveService {
  // 列出文件/文件夹
  listFiles(params: {
    folderId?: string;      // 默认 'root'
    pageSize?: number;       // 默认 50
    pageToken?: string;      // 分页 token
    mimeType?: string;       // 过滤类型（如 'image/*'）
    orderBy?: string;        // 排序（如 'modifiedTime desc'）
  }): Promise<{
    files: GDriveFile[];
    nextPageToken?: string;
  }>;

  // 搜索文件
  search(query: string, pageSize?: number): Promise<GDriveFile[]>;

  // 获取文件元数据
  getFile(fileId: string): Promise<GDriveFile>;

  // 下载文件到本地
  download(fileId: string, localPath: string): Promise<string>;

  // 上传文件
  upload(localPath: string, params: {
    folderId?: string;       // 目标文件夹
    name?: string;           // 自定义文件名
  }): Promise<GDriveFile>;

  // 删除文件（移到回收站）
  trash(fileId: string): Promise<void>;

  // 永久删除
  delete(fileId: string): Promise<void>;

  // 创建文件夹
  createFolder(name: string, parentId?: string): Promise<GDriveFile>;

  // 移动文件
  move(fileId: string, newParentId: string): Promise<void>;

  // 获取存储空间
  getStorageQuota(): Promise<{
    totalGB: number;
    usedGB: number;
    trashedGB: number;
  }>;
}

// 文件数据结构
interface GDriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;               // 字节
  createdTime: string;        // ISO 8601
  modifiedTime: string;
  thumbnailLink?: string;     // 缩略图 URL（Google 自动生成）
  webViewLink?: string;       // 网页预览链接
  parents?: string[];         // 父文件夹 ID 列表
  iconLink?: string;
}
```

#### 图片相关的 MIME 类型过滤

```typescript
// 只列出图片文件
const query = "mimeType contains 'image/' and trashed = false";

// 列出文件夹
const query = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";

// 在特定文件夹下列出图片
const query = "'folderId' in parents and mimeType contains 'image/' and trashed = false";
```

### 4.3 Google Photos 服务 (googlePhotosService.ts)

#### API 基础信息

- Base URL: `https://photoslibrary.googleapis.com/v1`
- 认证: `Authorization: Bearer {access_token}`

#### 核心方法

```typescript
interface GooglePhotosService {
  // 列出相册
  listAlbums(pageSize?: number, pageToken?: string): Promise<{
    albums: GPhotosAlbum[];
    nextPageToken?: string;
  }>;

  // 获取相册内容
  getAlbumPhotos(albumId: string, pageSize?: number, pageToken?: string): Promise<{
    photos: GPhotosMediaItem[];
    nextPageToken?: string;
  }>;

  // 列出所有照片（不限相册）
  listPhotos(pageSize?: number, pageToken?: string): Promise<{
    photos: GPhotosMediaItem[];
    nextPageToken?: string;
  }>;

  // 按条件搜索
  search(filters: {
    dateRange?: { startDate: DateObj; endDate: DateObj };
    mediaType?: 'PHOTO' | 'VIDEO' | 'ALL_MEDIA';
    contentCategory?: string[];  // LANDSCAPES, PETS, SELFIES 等
  }, pageSize?: number, pageToken?: string): Promise<{
    photos: GPhotosMediaItem[];
    nextPageToken?: string;
  }>;

  // 获取照片详情（含下载 URL）
  getPhoto(mediaItemId: string): Promise<GPhotosMediaItem>;

  // 下载照片到本地
  download(mediaItemId: string, localPath: string): Promise<string>;

  // 上传照片到 Google Photos
  upload(localPath: string, albumId?: string, description?: string): Promise<GPhotosMediaItem>;

  // 创建相册
  createAlbum(title: string): Promise<GPhotosAlbum>;
}

// 数据结构
interface GPhotosAlbum {
  id: string;
  title: string;
  productUrl: string;        // 在 Google Photos 中打开的链接
  mediaItemsCount: number;
  coverPhotoBaseUrl: string;
  coverPhotoMediaItemId: string;
}

interface GPhotosMediaItem {
  id: string;
  productUrl: string;        // 在 Google Photos 中打开
  baseUrl: string;           // 原图 URL（有效期 60 分钟）
  mimeType: string;
  filename: string;
  mediaMetadata: {
    creationTime: string;    // ISO 8601
    width: string;
    height: string;
    photo?: {                // 照片 EXIF（部分）
      cameraMake?: string;
      cameraModel?: string;
      focalLength?: number;
      apertureFNumber?: number;
      isoEquivalent?: number;
    };
  };
}
```

#### 照片下载说明

Google Photos 的 `baseUrl` 需要附加参数才能获取不同尺寸：

```
原图:    {baseUrl}=d          (download)
指定宽:  {baseUrl}=w2048      (width 2048px)
指定高:  {baseUrl}=h1024      (height 1024px)
缩略图:  {baseUrl}=w300-h300  (300x300)
```

**注意**: baseUrl 有效期约 60 分钟，过期需重新调用 API 获取。

#### 上传流程（两步上传）

```
Step 1: 上传字节流，获取 upload token
  POST https://photoslibrary.googleapis.com/v1/uploads
  Headers:
    Authorization: Bearer {access_token}
    Content-Type: application/octet-stream
    X-Goog-Upload-Content-Type: image/jpeg
    X-Goog-Upload-Protocol: raw
  Body: <raw bytes>
  Response: upload_token (纯文本)

Step 2: 用 upload token 创建媒体项
  POST https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate
  Body: {
    "albumId": "xxx",       // 可选
    "newMediaItems": [{
      "description": "xxx",
      "simpleMediaItem": {
        "uploadToken": "upload_token_from_step1",
        "fileName": "photo.jpg"
      }
    }]
  }
```

---

## 五、config.yaml 新增配置

```yaml
google:
  # OAuth 凭据（开发者在 Google Cloud Console 获取）
  clientId: 'your-client-id.apps.googleusercontent.com'
  clientSecret: 'your-client-secret'

  drive:
    enabled: true
    defaultViewMode: 'grid'          # grid | list
    imageOnly: false                 # 是否只显示图片文件
    downloadPath: 'M:\google-drive'  # 下载保存目录

  photos:
    enabled: true
    downloadPath: 'M:\google-photos' # 下载保存目录
    uploadAlbumName: 'Yande Gallery' # 默认上传相册名
    thumbnailSize: 512               # 缩略图尺寸
```

---

## 六、preload 新增 API

```typescript
// preload/index.ts 新增
google: {
  // 认证
  login: () => ipcRenderer.invoke('google:auth-login'),
  logout: () => ipcRenderer.invoke('google:auth-logout'),
  getAuthStatus: () => ipcRenderer.invoke('google:auth-status'),
},

gdrive: {
  listFiles: (folderId?: string, pageSize?: number, pageToken?: string, mimeType?: string) =>
    ipcRenderer.invoke('gdrive:list-files', folderId, pageSize, pageToken, mimeType),
  search: (query: string) =>
    ipcRenderer.invoke('gdrive:search', query),
  getFile: (fileId: string) =>
    ipcRenderer.invoke('gdrive:get-file', fileId),
  download: (fileId: string, localPath?: string) =>
    ipcRenderer.invoke('gdrive:download', fileId, localPath),
  upload: (localPath: string, folderId?: string) =>
    ipcRenderer.invoke('gdrive:upload', localPath, folderId),
  delete: (fileId: string) =>
    ipcRenderer.invoke('gdrive:delete', fileId),
  createFolder: (name: string, parentId?: string) =>
    ipcRenderer.invoke('gdrive:create-folder', name, parentId),
  move: (fileId: string, newParentId: string) =>
    ipcRenderer.invoke('gdrive:move', fileId, newParentId),
  getStorage: () =>
    ipcRenderer.invoke('gdrive:get-storage'),
  getThumbnail: (fileId: string) =>
    ipcRenderer.invoke('gdrive:get-thumbnail', fileId),
},

gphotos: {
  listAlbums: (pageSize?: number, pageToken?: string) =>
    ipcRenderer.invoke('gphotos:list-albums', pageSize, pageToken),
  getAlbumPhotos: (albumId: string, pageSize?: number, pageToken?: string) =>
    ipcRenderer.invoke('gphotos:get-album', albumId, pageSize, pageToken),
  listPhotos: (pageSize?: number, pageToken?: string) =>
    ipcRenderer.invoke('gphotos:list-photos', pageSize, pageToken),
  search: (filters: any, pageSize?: number, pageToken?: string) =>
    ipcRenderer.invoke('gphotos:search', filters, pageSize, pageToken),
  getPhoto: (mediaItemId: string) =>
    ipcRenderer.invoke('gphotos:get-photo', mediaItemId),
  download: (mediaItemId: string) =>
    ipcRenderer.invoke('gphotos:download', mediaItemId),
  upload: (localPath: string, albumId?: string) =>
    ipcRenderer.invoke('gphotos:upload', localPath, albumId),
  createAlbum: (title: string) =>
    ipcRenderer.invoke('gphotos:create-album', title),
}
```

---

## 七、前端页面设计

### 7.1 侧边栏新增

在 App.tsx 的主菜单中新增 `Google` 一级菜单：

```
Google
  ├── Drive      (文件管理)
  └── Photos     (照片浏览/上传)
```

如果未登录，点击任何 Google 子页面时显示登录引导。

### 7.2 Google Drive 页面 (GoogleDrivePage.tsx)

#### 布局

```
┌──────────────────────────────────────────────────┐
│ [面包屑导航: 我的云端硬盘 > 文件夹A > ...]        │
│ [搜索框]  [新建文件夹] [上传] [切换视图]           │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐            │
│  │ 📁  │  │ 📁  │  │ 🖼  │  │ 🖼  │            │
│  │文件夹│  │文件夹│  │图片1│  │图片2│            │
│  └─────┘  └─────┘  └─────┘  └─────┘            │
│  ┌─────┐  ┌─────┐                               │
│  │ 🖼  │  │ 📄  │                               │
│  │图片3│  │文件  │                               │
│  └─────┘  └─────┘                               │
│                                                  │
│                  [加载更多]                        │
├──────────────────────────────────────────────────┤
│ 存储空间: 5.2 GB / 15 GB                          │
└──────────────────────────────────────────────────┘
```

#### 功能
- 文件夹导航（点击进入，面包屑返回）
- 网格/列表视图切换
- 图片文件显示缩略图（Drive API 自带 thumbnailLink）
- 右键菜单：下载到本地、移动、删除、在浏览器中打开
- 支持拖拽上传本地文件
- 底部显示存储空间用量

### 7.3 Google Photos 页面 (GooglePhotosPage.tsx)

#### 布局

```
┌──────────────────────────────────────────────────┐
│ [全部照片] [相册]  [按日期筛选]  [上传本地照片]     │
├──────────────────────────────────────────────────┤
│                                                  │
│  === 2026年3月 ===                                │
│  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐            │
│  │     │  │     │  │     │  │     │  ← 瀑布流    │
│  │ 照片 │  │ 照片 │  │ 照片 │  │ 照片 │            │
│  └─────┘  └─────┘  └─────┘  └─────┘            │
│                                                  │
│  === 2026年2月 ===                                │
│  ┌─────┐  ┌─────┐  ┌─────┐                     │
│  │     │  │     │  │     │                      │
│  │ 照片 │  │ 照片 │  │ 照片 │                      │
│  └─────┘  └─────┘  └─────┘                     │
│                                                  │
│                  [加载更多]                        │
└──────────────────────────────────────────────────┘
```

#### 功能
- 全部照片：按时间倒序，分组显示（复用现有 ImageGrid 组件的按时间分组功能）
- 相册列表：网格展示相册封面，点击进入
- 按日期范围筛选
- 点击照片：预览大图（复用现有预览组件）
- 下载到本地 / 在 Google Photos 中打开
- 上传本地图片：选择文件 → 选择/创建目标相册 → 上传

---

## 八、与现有功能的联动

### 8.1 Booru 下载后上传到 Drive

在 Booru 下载完成后，可选自动上传到 Google Drive 指定文件夹：

```yaml
# config.yaml
google:
  drive:
    autoUploadFromBooru: false         # 是否自动上传
    autoUploadFolder: 'Booru Downloads' # Drive 中的目标文件夹名
```

### 8.2 Google Photos 照片导入本地图库

在 Google Photos 页面提供「导入到本地图库」按钮：
1. 下载照片原图到本地图库目录
2. 自动添加到 images 表
3. 自动生成缩略图

### 8.3 本地图库批量上传到 Drive/Photos

在本地图库页面新增「上传到 Google」选项：
- 选择多张图片 → 上传到 Drive 指定文件夹
- 选择多张图片 → 上传到 Photos 指定相册

### 8.4 本地图集与 Google 相册绑定

支持将本地图集（Gallery）与 Google Photos 相册建立关联，实现批量同步上传。

#### 绑定流程

1. 在图集详情页新增「绑定 Google 相册」按钮
2. 弹出对话框：选择已有相册 / 创建新相册（默认使用图集名称）
3. 建立绑定关系，存入数据库（`gallery_album_bindings` 表）
4. 绑定后显示同步状态和操作按钮

#### 同步上传流程

```
用户点击「同步到相册」
  │
  ├─ 读取图集中所有图片
  ├─ 对比已上传记录（避免重复上传）
  ├─ 筛选出未上传的图片
  ├─ 逐张执行两步上传:
  │   ├─ POST /v1/uploads → 获取 uploadToken
  │   └─ POST /v1/mediaItems:batchCreate (albumId + uploadToken)
  ├─ 记录上传结果到数据库
  └─ 显示上传进度和结果
```

#### 数据库设计

```sql
-- 图集与 Google 相册的绑定关系
CREATE TABLE gallery_album_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gallery_path TEXT NOT NULL,           -- 本地图集路径
  album_id TEXT NOT NULL,               -- Google Photos 相册 ID
  album_title TEXT,                     -- 相册标题（缓存）
  created_at TEXT DEFAULT (datetime('now')),
  last_synced_at TEXT,                  -- 最后同步时间
  UNIQUE(gallery_path, album_id)
);

-- 已上传图片记录（防止重复上传）
CREATE TABLE gallery_upload_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  binding_id INTEGER NOT NULL,          -- 关联绑定 ID
  local_path TEXT NOT NULL,             -- 本地图片路径
  media_item_id TEXT,                   -- Google Photos 媒体项 ID
  uploaded_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (binding_id) REFERENCES gallery_album_bindings(id) ON DELETE CASCADE,
  UNIQUE(binding_id, local_path)
);
```

#### IPC 接口

```typescript
// preload 新增
gphotos: {
  // ... 已有接口 ...

  // 图集绑定
  bindGallery: (galleryPath: string, albumId: string, albumTitle: string) =>
    ipcRenderer.invoke('gphotos:bind-gallery', galleryPath, albumId, albumTitle),
  unbindGallery: (galleryPath: string, albumId: string) =>
    ipcRenderer.invoke('gphotos:unbind-gallery', galleryPath, albumId),
  getGalleryBindings: (galleryPath: string) =>
    ipcRenderer.invoke('gphotos:get-gallery-bindings', galleryPath),

  // 批量同步上传
  syncGalleryToAlbum: (galleryPath: string, albumId: string) =>
    ipcRenderer.invoke('gphotos:sync-gallery', galleryPath, albumId),
  getSyncStatus: (galleryPath: string, albumId: string) =>
    ipcRenderer.invoke('gphotos:get-sync-status', galleryPath, albumId),
}
```

#### UI 设计

在图集详情页中：
```
┌──────────────────────────────────────────────────┐
│ 图集: booru_u                                     │
│ [绑定 Google 相册 ▼]                               │
│                                                   │
│ 已绑定相册:                                        │
│ ┌───────────────────────────────────────────────┐ │
│ │ 📷 Booru Collection                           │ │
│ │ 已同步 150/200 张 │ 上次同步: 2026-03-12       │ │
│ │ [同步到相册] [解除绑定]                         │ │
│ └───────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

#### 注意事项

- Google Photos API 单次 `batchCreate` 最多 50 个媒体项，超过需分批
- 上传时显示进度（已上传 X / 总共 Y）
- 支持中断后继续（基于 `gallery_upload_records` 跳过已上传）
- 绑定是多对多关系：一个图集可绑定多个相册，一个相册也可被多个图集绑定

---

## 九、依赖与安全

### 9.1 新增依赖

无需额外依赖。项目已有 `axios`，Google API 都是标准 REST，直接用 axios 调用即可。Token 存储使用已有的 `electron-store`。

### 9.2 安全注意事项

| 事项 | 处理方式 |
|------|---------|
| Client Secret 不能暴露给前端 | 只在主进程使用，不通过 preload 暴露 |
| Access Token 不能泄露 | 只在主进程使用，前端只拿到最终数据 |
| Refresh Token 持久化 | 存在 electron-store，跟随系统用户目录 |
| OAuth 回调端口 | 使用随机端口，授权完成立即关闭 |

---

## 十、实施步骤

| 阶段 | 内容 | 预计改动 |
|------|------|---------|
| 1 | Google Cloud Console 配置（手动操作） | 无代码改动 |
| 2 | googleAuthService.ts — OAuth 登录/token 管理 | 新增 1 文件 |
| 3 | googleDriveService.ts — Drive API 封装 | 新增 1 文件 |
| 4 | googlePhotosService.ts — Photos API 封装 | 新增 1 文件 |
| 5 | googleHandlers.ts — IPC 处理器 | 新增 1 文件 |
| 6 | channels.ts / preload/index.ts — 注册通道和暴露 API | 修改 2 文件 |
| 7 | config.ts — 新增 google 配置类型和默认值 | 修改 1 文件 |
| 8 | GoogleDrivePage.tsx — Drive 管理页面 | 新增 1 文件 |
| 9 | GooglePhotosPage.tsx — Photos 浏览/上传页面 | 新增 1 文件 |
| 10 | App.tsx — 侧边栏新增 Google 菜单 | 修改 1 文件 |
| 11 | 联动功能（自动上传、导入本地等） | 后续迭代 |
| 12 | 图集-相册绑定（DB 表 + IPC + 批量同步上传 + UI） | 后续迭代 |

**总计**: 新增 6 个文件，修改 4 个文件，新增 2 张数据库表。核心改动集中在主进程 service 层，不影响现有功能。
