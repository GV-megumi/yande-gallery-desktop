# Google Drive & Photos 集成 - 任务清单

## 前置准备

- [x] Google Cloud Console 创建项目、启用 API、获取 OAuth 凭据
- [x] config.yaml 配置 clientId / clientSecret

## 阶段一：OAuth 认证

- [ ] `src/main/services/googleAuthService.ts` - OAuth 认证服务
  - [ ] 弹出 BrowserWindow 加载 Google 登录页
  - [ ] 本地临时 HTTP Server 接收回调 code
  - [ ] 用 code 换取 access_token + refresh_token
  - [ ] token 持久化存储（electron-store）
  - [ ] token 自动刷新（过期前刷新）
  - [ ] 登录状态查询 / 退出登录
- [ ] IPC 通道注册（login / logout / status）
- [ ] Preload 暴露 `electronAPI.google.login/logout/getAuthStatus`

## 阶段二：Google Drive 服务

- [ ] `src/main/services/googleDriveService.ts` - Drive API 封装
  - [ ] listFiles - 列出文件/文件夹（支持分页、过滤 mimeType）
  - [ ] search - 搜索文件
  - [ ] getFile - 获取文件元数据
  - [ ] download - 下载文件到本地
  - [ ] upload - 上传本地文件
  - [ ] trash / delete - 删除文件
  - [ ] createFolder - 创建文件夹
  - [ ] move - 移动文件
  - [ ] getStorageQuota - 获取存储空间信息
  - [ ] getThumbnail - 获取缩略图
- [ ] IPC 通道注册（gdrive:*）
- [ ] Preload 暴露 `electronAPI.gdrive.*`

## 阶段三：Google Photos 服务

- [ ] `src/main/services/googlePhotosService.ts` - Photos API 封装
  - [ ] listAlbums - 列出相册
  - [ ] getAlbumPhotos - 获取相册内照片
  - [ ] listPhotos - 列出所有照片（支持分页）
  - [ ] search - 按日期/类型搜索
  - [ ] getPhoto - 获取照片详情和下载 URL
  - [ ] download - 下载照片到本地
  - [ ] upload - 两步上传（上传字节流 + 创建媒体项）
  - [ ] createAlbum - 创建相册
- [ ] IPC 通道注册（gphotos:*）
- [ ] Preload 暴露 `electronAPI.gphotos.*`

## 阶段四：IPC 处理器

- [ ] `src/main/ipc/googleHandlers.ts` - 统一 IPC 处理器
  - [ ] 认证相关 handler（3 个）
  - [ ] Drive 相关 handler（10 个）
  - [ ] Photos 相关 handler（8 个）
- [ ] `src/main/ipc/channels.ts` - 新增 Google 通道常量
- [ ] `src/main/index.ts` - 注册 googleHandlers
- [ ] `src/preload/index.ts` - 暴露 google / gdrive / gphotos API

## 阶段五：配置类型

- [ ] `src/main/services/config.ts` - AppConfig 新增 google 字段类型
  - [ ] GoogleConfig 接口定义
  - [ ] 默认值设置

## 阶段六：前端页面

- [ ] `src/renderer/pages/GoogleDrivePage.tsx` - Drive 文件管理页面
  - [ ] 面包屑导航（文件夹层级）
  - [ ] 文件/文件夹网格展示（图片显示缩略图）
  - [ ] 搜索
  - [ ] 上传 / 新建文件夹
  - [ ] 右键菜单（下载、移动、删除）
  - [ ] 存储空间显示
- [ ] `src/renderer/pages/GooglePhotosPage.tsx` - Photos 浏览/上传页面
  - [ ] 全部照片（按时间分组，复用 ImageGrid）
  - [ ] 相册列表
  - [ ] 按日期筛选
  - [ ] 照片预览
  - [ ] 上传本地照片（选文件 + 选相册）
  - [ ] 下载到本地
- [ ] `src/renderer/App.tsx` - 侧边栏新增 Google 菜单

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
| 修改 | 数据库 schema（新增 `gallery_album_bindings` + `gallery_upload_records` 表） |
| 已完成 | `config.yaml`（凭据已配置） |
