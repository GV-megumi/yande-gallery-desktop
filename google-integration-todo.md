# Google Drive & Photos 集成 - 任务清单

## 前置准备

- [x] Google Cloud Console 创建项目、启用 API、获取 OAuth 凭据
- [x] config.yaml 配置 clientId / clientSecret

## 阶段一：OAuth 认证

- [x] `src/main/services/googleAuthService.ts` - OAuth 认证服务
  - [x] 弹出 BrowserWindow 加载 Google 登录页
  - [x] 本地临时 HTTP Server 接收回调 code
  - [x] 用 code 换取 access_token + refresh_token
  - [x] token 持久化存储（electron-store）
  - [x] token 自动刷新（过期前刷新）
  - [x] 登录状态查询 / 退出登录
- [x] IPC 通道注册（login / logout / status）
- [x] Preload 暴露 `electronAPI.google.login/logout/getAuthStatus`

## 阶段二：Google Drive 服务

- [x] `src/main/services/googleDriveService.ts` - Drive API 封装
  - [x] listFiles - 列出文件/文件夹（支持分页、过滤 mimeType）
  - [x] search - 搜索文件
  - [x] getFile - 获取文件元数据
  - [x] download - 下载文件到本地
  - [x] upload - 上传本地文件
  - [x] trash / delete - 删除文件
  - [x] createFolder - 创建文件夹
  - [x] move - 移动文件
  - [x] getStorageQuota - 获取存储空间信息
  - [x] getThumbnail - 获取缩略图
- [x] IPC 通道注册（gdrive:*）
- [x] Preload 暴露 `electronAPI.gdrive.*`

## 阶段三：Google Photos 服务

- [x] `src/main/services/googlePhotosService.ts` - Photos API 封装
  - [x] listAlbums - 列出相册
  - [x] getAlbumPhotos - 获取相册内照片
  - [x] listPhotos - 列出所有照片（支持分页）
  - [x] search - 按日期/类型搜索
  - [x] getPhoto - 获取照片详情和下载 URL
  - [x] download - 下载照片到本地
  - [x] upload - 两步上传（上传字节流 + 创建媒体项）
  - [x] batchUpload - 批量上传（每批最多 50 个）
  - [x] createAlbum - 创建相册
- [x] IPC 通道注册（gphotos:*）
- [x] Preload 暴露 `electronAPI.gphotos.*`

## 阶段四：IPC 处理器

- [x] `src/main/ipc/googleHandlers.ts` - 统一 IPC 处理器
  - [x] 认证相关 handler（3 个）
  - [x] Drive 相关 handler（10 个）
  - [x] Photos 相关 handler（9 个，含 batchUpload）
- [x] `src/main/ipc/channels.ts` - 新增 Google 通道常量（22 个）
- [x] `src/main/index.ts` - 注册 googleHandlers + initGoogleAuth
- [x] `src/preload/index.ts` - 暴露 google / gdrive / gphotos API + TypeScript 类型声明

## 阶段五：配置类型

- [x] `src/main/services/config.ts` - AppConfig 新增 google 字段类型
  - [x] google.clientId / clientSecret
  - [x] google.drive（enabled, defaultViewMode, imageOnly, downloadPath）
  - [x] google.photos（enabled, downloadPath, uploadAlbumName, thumbnailSize）

## 阶段六：前端页面

- [x] `src/renderer/pages/GoogleDrivePage.tsx` - Drive 文件管理页面
  - [x] 面包屑导航（文件夹层级）
  - [x] 文件/文件夹网格+列表视图（图片显示缩略图）
  - [x] 搜索文件
  - [x] 新建文件夹
  - [x] 右键菜单（下载、删除）
  - [x] 存储空间显示
  - [x] 登录/退出 UI
- [x] `src/renderer/pages/GooglePhotosPage.tsx` - Photos 浏览/上传页面
  - [x] 全部照片（按月分组网格展示）
  - [x] 相册列表（封面网格展示）
  - [x] 相册内照片浏览
  - [x] 照片预览（大图）
  - [x] 下载到本地
  - [x] 创建相册
  - [x] 登录/退出 UI
- [x] `src/renderer/App.tsx` - 侧边栏新增 Google 菜单（Drive + Photos 子菜单）
- [x] `src/renderer/styles/tokens.ts` - 新增 google / gdrive / gphotos 图标颜色

## 阶段七：联动功能（后续迭代）

- [ ] Booru 下载完成后可选自动上传到 Drive
- [ ] Google Photos 照片一键导入本地图库
- [ ] 本地图库批量上传到 Drive / Photos
- [ ] 本地图集与 Google 相册绑定
  - [ ] 数据库新增 `gallery_album_bindings` 表（图集-相册关联）
  - [ ] 数据库新增 `gallery_upload_records` 表（已上传记录，防重复）
  - [ ] IPC 接口：bindGallery / unbindGallery / getGalleryBindings
  - [ ] IPC 接口：syncGalleryToAlbum / getSyncStatus
  - [ ] 图集详情页 UI：绑定相册按钮、已绑定相册列表、同步进度
  - [ ] 批量两步上传逻辑（batchCreate 每批最多 50 个）
  - [ ] 中断续传支持（基于 upload_records 跳过已上传）

## 文件改动汇总

| 操作 | 文件 |
|------|------|
| 新增 | `src/main/services/googleAuthService.ts` |
| 新增 | `src/main/services/googleDriveService.ts` |
| 新增 | `src/main/services/googlePhotosService.ts` |
| 新增 | `src/main/ipc/googleHandlers.ts` |
| 新增 | `src/renderer/pages/GoogleDrivePage.tsx` |
| 新增 | `src/renderer/pages/GooglePhotosPage.tsx` |
| 修改 | `src/main/ipc/channels.ts` |
| 修改 | `src/main/index.ts` |
| 修改 | `src/preload/index.ts` |
| 修改 | `src/main/services/config.ts` |
| 修改 | `src/renderer/App.tsx` |
| 修改 | `src/renderer/styles/tokens.ts` |
| 修改 | 数据库 schema（新增 `gallery_album_bindings` + `gallery_upload_records` 表） |
| 已完成 | `config.yaml`（凭据已配置） |
