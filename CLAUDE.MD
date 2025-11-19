# Yande Gallery Desktop - 图库管理与 Booru 对接程序

## 项目概述

本项目是一个基于 **Electron + React + TypeScript** 的桌面应用程序，提供**本地图库管理**和 **Booru 站点（Yande.re、Konachan 等）对接**功能。程序支持本地图片的浏览、管理和组织，同时可以对接多个 Booru 站点的 API，实现图片的搜索、浏览和批量下载。

**参考项目**：在 `example/Boorusama-master` 文件夹中有 Flutter 实现的示例 Booru 客户端，可以提供参考。

## 核心功能

### 本地图库管理

#### 图片浏览
- **最近图片**：懒加载模式，一次加载 2000 张，初始渲染 200 张，支持滚动加载（瀑布流布局）
- **全部图片**：分页模式，每页 20 张，支持按时间/文件名排序（瀑布流布局）
- **图集管理**：按文件夹组织图片，支持设置封面，单个图集懒加载 1000 张（网格布局）

#### 高级功能
- **图片组织**：支持多图库（Gallery）管理，按文件夹自动分类
- **标签系统**：支持标签管理、搜索和批量操作
- **缩略图系统**：自动生成和管理缩略图（WebP 格式），提升浏览性能
- **图片预览**：支持缩放、拖拽、键盘导航（左右方向键）等高级预览功能
- **图片搜索**：支持按文件名、标签搜索，支持模糊匹配

### Booru 站点对接

#### 核心功能
- **多站点支持**：支持配置多个 Booru 站点（Moebooru、Danbooru、Gelbooru）
- **图片浏览**：支持按标签搜索、浏览 Booru 站点图片
- **批量下载**：支持按标签、评分、作者等条件批量下载
- **下载队列**：支持并发下载（可配置并发数）、断点续传、下载状态管理
- **智能去重**：基于 MD5 检测重复图片，避免重复下载
- **文件名自定义**：支持灵活的文件名模板系统（见下文详细说明）

#### 高级功能
- **收藏夹同步**：支持账户登录，同步收藏夹数据
- **搜索历史**：记录搜索历史，方便快速访问
- **代理支持**：支持 HTTP/HTTPS 代理配置（见网络配置章节）
- **分页模式**：支持分页和无限滚动两种浏览模式

## 技术架构

### 桌面应用架构 (Electron)

#### 主进程 (Main Process)
- **运行环境**：Node.js + TypeScript（ES Modules）
- **核心服务**：
  - `database.ts` - SQLite 数据库连接管理
  - `imageService.ts` - 本地图片服务
  - `galleryService.ts` - 图库/图集服务
  - `thumbnailService.ts` - 缩略图生成和管理
  - `moebooruClient.ts` - Moebooru API 客户端
  - `booruService.ts` - Booru 数据库操作
  - `downloadManager.ts` - 下载队列管理器
  - `filenameGenerator.ts` - 文件名生成器
  - `config.ts` - YAML 配置文件管理器
- **IPC 通信**：
  - `channels.ts` - IPC 频道定义
  - `handlers.ts` - IPC 请求处理器

#### 渲染进程 (Renderer Process)
- **框架**：React 18 + TypeScript
- **UI 组件库**：Ant Design 5.x
- **状态管理**：React Hooks（useState, useEffect, useMemo）
- **构建工具**：Vite 5.x

#### 预加载脚本 (Preload Script)
- **作用**：安全地暴露 Electron API 给渲染进程
- **实现**：`contextBridge.exposeInMainWorld`
- **暴露 API**：
  - `db.*` - 数据库操作
  - `image.*` - 图片操作
  - `gallery.*` - 图库操作
  - `booru.*` - Booru 站点操作
  - `download.*` - 下载管理
  - `system.*` - 系统操作

### 技术栈详情

#### 核心依赖
```json
{
  "electron": "^39.2.1",
  "react": "^18.2.0",
  "react-dom": "^18.2.0",
  "antd": "^5.11.0",
  "typescript": "^5.2.2",
  "vite": "^5.0.0"
}
```

#### 后端/主进程依赖
```json
{
  "sqlite3": "^5.1.6",        // 本地数据库
  "sharp": "^0.32.6",         // 图片处理（缩略图生成）
  "axios": "^1.6.0",          // HTTP 客户端
  "js-yaml": "^4.1.1",        // YAML 配置解析
  "electron-store": "^8.1.0"  // 应用设置持久化
}
```

### 数据存储

#### 文件系统
- **图片存储**：用户指定目录（`config.yaml` 中配置多个图库路径）
- **下载目录**：`config.yaml` 中的 `downloads.path` 配置
- **缩略图缓存**：`data/thumbnails/` 目录
- **配置文件**：`config.yaml`（YAML 格式）
- **数据库文件**：`data/gallery.db`（SQLite）

#### 数据库 (SQLite)
核心数据表：
1. **images** - 本地图片元数据
2. **tags** - 标签表
3. **image_tags** - 图片标签关联表
4. **galleries** - 图库/图集信息
5. **booru_sites** - Booru 站点配置
6. **booru_posts** - Booru 图片信息
7. **booru_tags** - Booru 标签
8. **download_queue** - 下载队列
9. **booru_favorites** - 收藏夹
10. **search_history** - 搜索历史

详细表结构见：`doc/database-schema.md`

## 项目结构

```
yande-gallery-desktop/
├── src/
│   ├── main/                    # Electron 主进程
│   │   ├── index.ts             # 应用入口
│   │   ├── window.ts            # 窗口管理
│   │   ├── ipc/                 # IPC 通信
│   │   │   ├── channels.ts      # IPC 频道定义
│   │   │   └── handlers.ts      # IPC 处理器
│   │   ├── services/            # 核心服务
│   │   │   ├── database.ts      # 数据库连接
│   │   │   ├── imageService.ts  # 图片服务
│   │   │   ├── galleryService.ts # 图库服务
│   │   │   ├── thumbnailService.ts # 缩略图服务
│   │   │   ├── moebooruClient.ts # Moebooru API 客户端
│   │   │   ├── booruService.ts  # Booru 数据库操作
│   │   │   ├── downloadManager.ts # 下载管理器
│   │   │   ├── filenameGenerator.ts # 文件名生成器
│   │   │   ├── config.ts        # 配置管理
│   │   │   └── init.ts          # 初始化服务
│   │   └── utils/
│   │       └── path.ts          # 路径工具
│   ├── renderer/                # React 渲染进程
│   │   ├── App.tsx              # 主应用组件
│   │   ├── main.tsx             # React 入口
│   │   ├── components/          # UI 组件
│   │   │   ├── ImageGrid.tsx    # 图片网格/瀑布流（核心组件）
│   │   │   ├── ImageListWrapper.tsx # 图片列表包装器
│   │   │   ├── ImageSearchBar.tsx # 搜索栏
│   │   │   ├── LazyLoadFooter.tsx # 懒加载底部
│   │   │   ├── BooruImageCard.tsx # Booru 图片卡片
│   │   │   └── GalleryCoverImage.tsx # 图集封面
│   │   ├── pages/               # 页面组件
│   │   │   ├── GalleryPage.tsx  # 图库页面（最近/全部/图集）
│   │   │   ├── BooruPage.tsx    # Booru 浏览页面
│   │   │   ├── BooruDownloadPage.tsx # Booru 下载管理页面
│   │   │   ├── BooruSettingsPage.tsx # Booru 站点配置页面
│   │   │   ├── DownloadPage.tsx # Yande.re 下载页面（旧版）
│   │   │   └── SettingsPage.tsx # 应用设置页面
│   │   └── utils/
│   │       └── format.ts        # 格式化工具
│   ├── preload/                 # 预加载脚本
│   │   └── index.ts             # Preload 脚本
│   └── shared/                  # 共享类型定义
│       └── types.ts             # TypeScript 类型
├── build/                       # 编译输出目录
├── data/                        # 数据目录
│   ├── gallery.db               # SQLite 数据库
│   └── thumbnails/              # 缩略图缓存
├── downloads/                   # 默认下载目录
├── doc/                         # 项目文档
│   ├── database-schema.md       # 数据库结构文档
│   ├── booru-feature-implementation.md # Booru 功能文档
│   └── gallery-feature.md       # 图库功能文档
├── example/                     # 参考项目
│   └── Boorusama-master/        # Flutter Booru 客户端示例
├── config.yaml                  # 应用配置文件
├── package.json                 # NPM 配置
├── tsconfig.json                # TypeScript 配置
├── vite.config.ts               # Vite 配置
├── README.md                    # 项目说明
└── CLAUDE.md                    # 本文档（AI 参考文档）
```

## 架构设计原则

### 组件抽象与复用

**重要原则**：必要的组件或容器需要写成抽象层方便复用。

#### 已实现的抽象层

1. **`ImageGrid`** - 图片网格/瀑布流核心组件
   - 支持瀑布流 (`waterfall`) 和网格 (`grid`) 两种布局
   - 支持按时间/文件名排序
   - 支持按天/月/年分组显示
   - 统一的图片预览和详情查看
   - 使用 `React.memo` 优化渲染性能

2. **`ImageListWrapper`** - 图片列表包装组件
   - 统一处理 loading、empty、ImageGrid 的渲染逻辑
   - 减少重复的状态判断和条件渲染代码
   - 支持 children 注入额外内容（如分页器）

3. **`ImageSearchBar`** - 搜索栏组件
   - 统一的搜索框样式和行为
   - 可复用于不同场景（最近图片、全部图片、图集搜索等）

4. **`LazyLoadFooter`** - 懒加载底部组件
   - 统一的"加载更多"按钮显示逻辑
   - 自动判断是否显示按钮

5. **`BooruImageCard`** - Booru 图片卡片组件
   - 显示 Booru 图片的缩略图、标签、评分等信息
   - 支持添加到下载队列
   - 支持预览和详情查看

6. **`GalleryCoverImage`** - 图集封面组件
   - 自动获取和显示图集封面
   - 支持设置自定义封面

#### 抽象层的好处

- **代码复用**：避免重复实现相同的功能
- **易于维护**：修改一处即可影响所有使用场景
- **一致性**：保证不同场景下的 UI 和行为一致
- **可测试性**：独立的组件更易于单元测试

## 核心模块详解

### 1. 图库页面 (GalleryPage)

图库页面支持三种浏览模式，通过 `subTab` prop 控制：

#### 最近图片 (recent)
- **数据加载**：一次性加载 2000 张最近更新的图片
- **渲染策略**：初始渲染 200 张，滚动或点击按钮加载更多（每次 200 张）
- **布局**：瀑布流布局
- **特点**：数据一次性加载到内存，但 DOM 只渲染可见部分

#### 全部图片 (all)
- **数据加载**：每页 20 张图片
- **渲染策略**：分页模式，点击"上一页/下一页"切换
- **搜索功能**：支持按文件名和标签搜索
- **布局**：瀑布流布局
- **特点**：内存占用最小，适合精确查找

#### 图集 (galleries)
- **数据加载**：点击图集后加载该图集的 1000 张图片
- **渲染策略**：初始渲染 200 张，点击"加载更多"增加 200 张
- **布局**：网格布局（更规整的视觉效果）
- **特点**：单个图集数据一次性加载，DOM 只渲染可见部分

#### 状态管理

为避免不同模式之间的数据干扰，使用独立状态：

```typescript
const [recentImages, setRecentImages] = useState<any[]>([]);  // 最近图片
const [allImages, setAllImages] = useState<any[]>([]);        // 全部图片（分页）
const [galleryImages, setGalleryImages] = useState<any[]>([]); // 图集图片
```

### 2. 缩略图服务 (thumbnailService)

#### 核心功能
- **自动生成**：首次访问时自动生成缩略图
- **格式转换**：统一转换为 WebP 格式（高压缩比）
- **尺寸限制**：默认最大 1000x1000 像素
- **质量控制**：默认质量 95（可配置）
- **缓存管理**：缓存在 `data/thumbnails/` 目录

#### 命名规则
```
{原文件名}_thumb.webp
例如：image.jpg -> image_thumb.webp
```

#### Sharp 配置
```typescript
await sharp(imagePath)
  .resize(maxWidth, maxHeight, {
    fit: 'inside',
    withoutEnlargement: true
  })
  .webp({ quality: 95 })
  .toFile(thumbnailPath);
```

### 3. 下载管理器 (downloadManager)

#### 核心功能
- **并发控制**：支持配置最大并发下载数（默认 3）
- **队列管理**：自动从数据库读取待下载任务
- **断点续传**：支持下载失败后重试
- **进度跟踪**：实时更新下载进度（0-100%）
- **取消下载**：支持取消正在进行的下载
- **智能去重**：下载前检查文件是否已存在

#### 下载流程
1. 添加任务到数据库 (`download_queue` 表)
2. 触发队列处理 (`processQueue()`)
3. 并发下载（受 `maxConcurrent` 限制）
4. 下载完成后：
   - 将图片信息添加到 `images` 表
   - 更新 `booru_posts` 表的 `downloaded` 和 `localPath` 字段
   - 更新 `download_queue` 表的状态为 `completed`

### 4. 文件名生成器 (filenameGenerator)

#### 功能
支持灵活的文件名模板，使用 `{}` 包裹的 token 会被替换为实际值。

#### 支持的 Token

| Token | 说明 | 示例 |
|-------|------|------|
| `{id}` | 图片ID | `12345` |
| `{md5}` | MD5 哈希值 | `a1b2c3d4...` |
| `{md5:maxlength=8}` | MD5（限制长度） | `a1b2c3d4` |
| `{extension}` | 文件扩展名 | `jpg` |
| `{width}` | 图片宽度 | `1920` |
| `{height}` | 图片高度 | `1080` |
| `{rating}` | 评分 | `safe` |
| `{score}` | 分数 | `100` |
| `{site}` | 站点名称 | `yande` |
| `{tags:maxlength=50}` | 标签（限制长度） | `girl_blue_eyes...` |
| `{source}` | 来源URL | `https://...` |

#### 配置示例 (config.yaml)
```yaml
booru:
  download:
    filenameTemplate: '{site}_{id}_{md5:maxlength=8}.{extension}'
    tokenDefaults:
      extension: 'jpg'
      rating: 'unknown'
      score: 0
```

#### 生成示例
```typescript
// 模板: '{site}_{id}_{md5:maxlength=8}.{extension}'
// 元数据: { site: 'yande', id: 12345, md5: 'a1b2c3d4e5f6g7h8', extension: 'png' }
// 结果: 'yande_12345_a1b2c3d4.png'
```

### 5. Moebooru API 客户端 (moebooruClient)

#### 支持的 API

##### 搜索图片
```typescript
searchPosts(tags: string[], params?: {
  limit?: number;      // 每页数量（默认 20）
  page?: number;       // 页码（从 1 开始）
  rating?: string;     // 评分过滤
})
```

##### 获取热门图片
```typescript
getPopularPosts(params?: {
  period?: 'day' | 'week' | 'month';
  limit?: number;
})
```

##### 获取收藏夹
```typescript
getFavorites(username: string, params?: {
  limit?: number;
  page?: number;
})
```

##### 标签自动完成
```typescript
autocompleteTags(query: string, limit?: number)
```

#### 认证支持
支持使用用户名和密码哈希进行认证，访问收藏夹等需要登录的功能。

```typescript
const client = new MoebooruClient({
  baseUrl: 'https://yande.re',
  username: 'your_username',
  passwordHash: 'your_password_hash', // 使用站点提供的密码哈希
  salt: 'site_salt'
});
```

#### 代理支持
从 `config.yaml` 读取代理配置（见网络配置章节）。

## 配置系统

### 配置文件 (config.yaml)

#### 数据库配置
```yaml
database:
  path: data/gallery.db
  logging: true
```

#### 下载配置
```yaml
downloads:
  path: M:\test           # 下载目录
  createSubfolders: true  # 是否创建子文件夹
  subfolderFormat:        # 子文件夹格式
    - tags                # 按标签分类
    - date                # 按日期分类
```

#### 图库配置
```yaml
galleries:
  folders:
    - path: M:\booru_u
      name: booru_u
      autoScan: true      # 自动扫描
      recursive: true     # 递归子目录
      extensions:         # 支持的扩展名
        - .jpg
        - .jpeg
        - .png
        - .gif
        - .webp
        - .bmp
```

#### 缩略图配置
```yaml
thumbnails:
  cachePath: data/thumbnails
  maxWidth: 1000
  maxHeight: 1000
  quality: 95
  format: webp
```

#### 应用配置
```yaml
app:
  recentImagesCount: 100
  pageSize: 50
  defaultViewMode: grid
  showImageInfo: true
  autoScan: true
  autoScanInterval: 30  # 自动扫描间隔（分钟）
```

#### Yande.re 配置
```yaml
yande:
  apiUrl: https://yande.re/post.json
  pageSize: 20
  downloadTimeout: 60
  maxConcurrentDownloads: 5
```

#### 网络配置
```yaml
network:
  proxy:
    enabled: true         # 是否启用代理
    protocol: http        # 协议（http/https/socks5）
    host: 127.0.0.1       # 代理主机
    port: '7897'          # 代理端口
    username: ''          # 用户名（可选）
    password: ''          # 密码（可选）
```

#### Booru 界面配置
```yaml
booru:
  appearance:
    gridSize: 220               # 网格大小
    previewQuality: original    # 预览质量（original/sample/preview）
    itemsPerPage: 10            # 每页项目数
    paginationPosition: both    # 分页器位置（top/bottom/both）
    pageMode: pagination        # 页面模式（pagination/infinite）
    spacing: 16                 # 间距
    borderRadius: 8             # 圆角
    margin: 24                  # 边距
  download:
    filenameTemplate: '{id}_{md5:maxlength=8}.{extension}'
```

#### 日志配置
```yaml
logging:
  level: info
  filePath: data/app.log
  consoleOutput: true
  maxFileSize: 10  # MB
  maxFiles: 5
```

### 配置文件管理

#### 读取配置
```typescript
import { getConfig } from './config.js';

const config = getConfig();
const downloadPath = config.downloads.path;
```

#### 更新配置
```typescript
import { updateConfig } from './config.js';

updateConfig({
  downloads: {
    path: 'M:\\new_path'
  }
});
```

## 网络访问与 CORS 解决方案

### 问题描述
在 Electron 应用中，渲染进程（前端）直接发起外部网络请求（如访问 Baidu、Google、Booru API）时会遇到 **CORS（跨域资源共享）** 限制。这是因为浏览器安全策略禁止前端代码从不同源（origin）访问资源。

**错误示例**：
```
Access to fetch at 'https://www.google.com/' from origin 'http://localhost:5173'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present
on the requested resource.
```

### 解决方案：IPC 代理模式

**核心原则**：所有外部网络请求必须通过 **主进程（Main Process）** 发起，然后通过 IPC 通信将结果返回给渲染进程。

**架构优势**：
- ✅ 绕过浏览器 CORS 限制
- ✅ 统一网络请求管理（便于日志、错误处理、代理配置）
- ✅ 更好的安全性（敏感操作在受保护的环境下运行）
- ✅ 便于实现请求缓存和限流

### 实现示例

#### 1. 主进程 IPC 处理器（src/main/ipc/handlers.ts）
```typescript
ipcMain.handle('network:test-baidu', async () => {
  try {
    const response = await fetch('https://www.baidu.com');
    return { success: true, status: response.status };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
});
```

#### 2. Preload 脚本暴露 API（src/preload/index.ts）
```typescript
contextBridge.exposeInMainWorld('electronAPI', {
  system: {
    testBaidu: () => ipcRenderer.invoke('network:test-baidu'),
    testGoogle: () => ipcRenderer.invoke('network:test-google')
  }
});
```

#### 3. 前端调用（src/renderer/pages/BooruSettingsPage.tsx）
```typescript
const testBaidu = async () => {
  try {
    const result = await window.electronAPI.system.testBaidu();
    if (result.success) {
      message.success(`百度连接成功！状态: ${result.status}`);
    } else {
      message.error('百度连接失败: ' + result.error);
    }
  } catch (error) {
    message.error('百度连接失败: ' + String(error));
  }
};
```

### 应用范围
此模式应用于所有外部 API 调用：
- Booru API（Yande.re、Konachan 等）
- 网络连接测试（Baidu、Google）
- 下载外部图片资源
- 其他任何跨域网络请求

### 代理配置指南

在中国大陆访问 Google 或某些 Booru 站点时，可能需要配置代理。

#### 方法1：配置文件（推荐）
编辑 `config.yaml`：
```yaml
network:
  proxy:
    enabled: true
    protocol: http
    host: 127.0.0.1
    port: '7890'
```

#### 方法2：环境变量
在启动应用前设置环境变量：

**Windows (CMD):**
```cmd
set HTTP_PROXY=http://127.0.0.1:7890
set HTTPS_PROXY=http://127.0.0.1:7890
npm run dev
```

**Windows (PowerShell):**
```powershell
$env:HTTP_PROXY="http://127.0.0.1:7890"
$env:HTTPS_PROXY="http://127.0.0.1:7890"
npm run dev
```

**macOS/Linux:**
```bash
export HTTP_PROXY=http://127.0.0.1:7890
export HTTPS_PROXY=http://127.0.0.1:7890
npm run dev
```

#### 验证代理配置
在 BooruSettingsPage 点击"测试百度"或"测试Google"按钮，查看控制台输出：
```
[IPC] 当前代理配置: http://127.0.0.1:7890
```

如果显示"无"，说明代理未正确配置。

## 开发规范

### 注释规范

**要求**：所有代码必须添加清晰的注释，以便于理解和维护。

#### 注释原则
- **模块注释**：每个文件顶部必须添加模块说明
- **函数注释**：复杂函数必须添加功能说明、参数说明、返回值说明
- **逻辑注释**：复杂业务逻辑必须添加行内注释
- **TODO 注释**：未完成的功能使用 `// TODO:` 标记

#### 注释示例

**模块注释：**
```typescript
/**
 * 缩略图服务
 * 负责生成和管理图片缩略图
 * - 自动生成 WebP 格式缩略图
 * - 缓存管理
 * - 尺寸和质量控制
 */
```

**函数注释：**
```typescript
/**
 * 生成图片缩略图
 * @param imagePath 原图片路径
 * @param options 缩略图选项（可选）
 * @returns 缩略图路径
 */
async function generateThumbnail(imagePath: string, options?: ThumbnailOptions): Promise<string> {
  // 实现
}
```

**逻辑注释：**
```typescript
// 检查缓存是否存在，避免重复生成
if (fs.existsSync(thumbnailPath)) {
  return thumbnailPath;
}

// 使用 Sharp 生成缩略图，限制最大尺寸为 1000x1000
await sharp(imagePath)
  .resize(maxWidth, maxHeight, { fit: 'inside' })
  .webp({ quality: 95 })
  .toFile(thumbnailPath);
```

### 日志输出规范

**要求**：所有代码必须在控制台输出日志，以便于调试和问题追踪。

#### 日志级别
- `console.log()` - 一般信息（如操作成功、状态变更）
- `console.warn()` - 警告信息（如参数异常、性能问题）
- `console.error()` - 错误信息（如异常、失败操作）

#### 日志格式
建议包含模块名称，便于问题定位：

```typescript
// 前端示例
console.log('[ImageGrid] 加载图片列表，数量:', images.length);
console.error('[ImageService] 图片加载失败:', error);
console.warn('[GalleryPage] 数据加载超时');

// 主进程示例
console.log('[downloadManager] 开始下载:', post.fileUrl);
console.error('[moebooruClient] API 请求失败:', error.message);
```

#### 关键操作必须输出日志
- 数据加载（开始、成功、失败）
- 用户交互（点击、搜索、切换）
- 网络请求（发起、响应、错误）
- 文件操作（读取、写入、删除）
- 下载操作（添加、开始、进度、完成）

### 代码风格

#### TypeScript 规范
- 使用 `interface` 定义数据类型（定义在 `src/shared/types.ts`）
- 使用 `async/await` 处理异步操作
- 使用可选链 `?.` 和空值合并 `??`
- 避免使用 `any`，优先使用具体类型

#### React 规范
- 使用函数式组件（不使用 Class 组件）
- 使用 Hooks 管理状态（useState, useEffect, useMemo）
- 使用 `React.memo` 优化组件性能
- 组件文件使用 PascalCase 命名（如 `ImageGrid.tsx`）

#### 命名规范
- 变量和函数：camelCase（如 `loadImages`）
- 组件和类：PascalCase（如 `ImageGrid`）
- 常量：UPPER_SNAKE_CASE（如 `MAX_DOWNLOAD_COUNT`）
- 文件名：与导出内容一致

### 错误处理

#### 统一错误响应格式
```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
```

#### IPC 处理器错误处理
```typescript
ipcMain.handle('some:operation', async () => {
  try {
    // 业务逻辑
    const result = await someOperation();
    return { success: true, data: result };
  } catch (error) {
    console.error('[IPC] 操作失败:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
});
```

#### 前端错误处理
```typescript
const handleOperation = async () => {
  try {
    const result = await window.electronAPI.some.operation();
    if (result.success) {
      message.success('操作成功');
    } else {
      message.error('操作失败: ' + result.error);
    }
  } catch (error) {
    console.error('[Component] 操作失败:', error);
    message.error('操作失败: ' + String(error));
  }
};
```

### 代码修改规范

**核心原则**：修改逻辑时必须确保不会影响当前已经实现的功能。

#### 修改前的检查清单

1. **影响范围评估**
   - 识别要修改的模块和函数
   - 查找所有调用该模块/函数的地方
   - 评估修改可能影响的功能

2. **相关代码审查**
   - 如果需要底层修改，必须先查看相关联的源码
   - 理解现有代码的实现逻辑和设计意图
   - 确认修改不会破坏现有功能

3. **依赖关系检查**
   - 检查模块之间的依赖关系
   - 确认接口变更不会导致其他模块报错
   - 检查类型定义是否需要同步更新

#### 修改步骤

1. **阅读相关代码**
```typescript
// 修改前：先理解现有实现
// 1. 查看函数定义和注释
// 2. 查看函数的所有调用位置
// 3. 查看相关的测试用例（如果有）
```

2. **搜索调用位置**
```bash
# 使用 grep 查找所有调用位置
grep -r "functionName" src/
```

3. **制定修改计划**
- 列出需要修改的文件
- 列出需要同步更新的地方
- 考虑向后兼容性

4. **逐步实施**
- 先修改核心逻辑
- 再更新调用位置
- 最后更新类型定义和注释

5. **验证功能**
- 测试修改的功能是否正常
- 测试相关联的功能是否正常
- 检查控制台是否有错误或警告

#### 底层修改示例

**场景**：修改数据库查询接口

```typescript
// 修改前：先查看所有使用该函数的地方
// 搜索：grep -r "getImages" src/

// 原函数
async function getImages(limit: number): Promise<Image[]> {
  // 实现
}

// 修改后：添加新参数，但保持向后兼容
async function getImages(limit: number, options?: {
  sortBy?: 'date' | 'name';
  order?: 'asc' | 'desc';
}): Promise<Image[]> {
  // 新实现，默认行为与原来一致
  const sortBy = options?.sortBy || 'date';
  const order = options?.order || 'desc';
  // ...
}

// 所有现有调用位置无需修改，仍然正常工作
const images = await getImages(100);
```

#### 注意事项

- ⚠️ **不要轻易修改公共接口**：修改公共接口可能影响多个模块
- ⚠️ **保持向后兼容**：新增参数应设为可选，保持默认行为
- ⚠️ **及时更新文档**：修改后及时更新注释和文档
- ⚠️ **添加日志输出**：修改后的代码必须添加适当的日志

### Moebooru 开发规范

**重要**：在开发 Moebooru 相关功能前，必须先参考 `example/Boorusama-master` 项目的实现。

#### 开发流程

1. **查看 Boorusama 实现**
   - 大部分 Booru 功能在 Boorusama 项目中都有参考实现
   - Boorusama 位置：`example/Boorusama-master/`
   - 重点关注 Moebooru 相关的代码

2. **确认 API 接口**
   - 查看 Boorusama 如何调用 Moebooru API
   - 确认 API 端点、参数格式、返回数据结构
   - 理解认证机制（如果需要）

3. **理解业务逻辑**
   - 查看 Boorusama 如何处理数据
   - 理解数据转换和状态管理逻辑
   - 学习错误处理和边界情况

4. **进行实际开发**
   - 参考 Boorusama 的实现方式
   - 根据本项目的技术栈进行改造
   - 保持与现有代码风格一致

#### Boorusama 参考路径

**主要参考文件**：
```
example/Boorusama-master/
├── lib/
│   ├── boorus/moebooru/          # Moebooru 实现
│   │   ├── moebooru_client.dart  # API 客户端
│   │   ├── models/               # 数据模型
│   │   └── providers/            # 状态管理
│   ├── clients/                  # 通用客户端
│   └── core/                     # 核心功能
```

#### API 对接示例

**步骤1：查看 Boorusama 实现**
```dart
// example/Boorusama-master/lib/boorus/moebooru/moebooru_client.dart
class MoebooruClient {
  Future<List<Post>> getPosts({
    String? tags,
    int? page,
    int? limit,
  }) async {
    // API 调用逻辑
  }
}
```

**步骤2：确认 API 细节**
- 端点：`https://yande.re/post.json`
- 参数：`tags`, `page`, `limit`
- 返回：JSON 数组，包含 post 对象

**步骤3：在本项目实现**
```typescript
// src/main/services/moebooruClient.ts

/**
 * 搜索图片
 * 参考：Boorusama moebooru_client.dart
 * @param tags 标签列表
 * @param params 查询参数
 */
async searchPosts(tags: string[], params?: {
  limit?: number;
  page?: number;
  rating?: string;
}): Promise<MoebooruPost[]> {
  console.log('[MoebooruClient] 搜索图片:', tags, params);
  
  try {
    // API 调用实现
    const response = await this.client.get('/post.json', {
      params: {
        tags: tags.join(' '),
        limit: params?.limit || 20,
        page: params?.page || 1,
      }
    });
    
    console.log('[MoebooruClient] 搜索成功，返回数量:', response.data.length);
    return response.data;
  } catch (error) {
    console.error('[MoebooruClient] 搜索失败:', error);
    throw error;
  }
}
```

#### 常见 Moebooru API

| API 端点 | 功能 | Boorusama 参考 |
|---------|------|---------------|
| `/post.json` | 搜索图片 | `moebooru_client.dart` |
| `/post/popular_recent.json` | 热门图片 | `moebooru_client.dart` |
| `/favorite.json` | 收藏夹 | `favorites/` |
| `/tag.json` | 标签搜索 | `tags/` |
| `/comment.json` | 评论 | `comments/` |

#### 数据模型映射

**Boorusama 模型** → **本项目类型**

```dart
// Boorusama
class Post {
  int id;
  String md5;
  String fileUrl;
  List<String> tags;
}
```

```typescript
// 本项目 (src/shared/types.ts)
interface MoebooruPost {
  id: number;
  md5: string;
  file_url: string;
  tags: string;  // 空格分隔的标签字符串
}
```

#### 注意事项

- ✅ **优先参考 Boorusama**：不要重复造轮子，先看看 Boorusama 如何实现
- ✅ **确认接口正确性**：API 参数和返回格式必须与实际一致
- ✅ **处理认证逻辑**：部分 API 需要登录，参考 Boorusama 的认证实现
- ✅ **错误处理完善**：网络请求必须有完善的错误处理
- ✅ **添加日志输出**：API 调用必须输出日志，便于调试

## 性能优化

### 前端优化

#### 1. 虚拟滚动和懒加载
- **最近图片**：一次加载 2000 张，但只渲染 200 张（避免 DOM 过多）
- **图集**：一次加载 1000 张，只渲染 200 张
- **全部图片**：分页模式，每次只加载 20 张

#### 2. 组件优化
- 使用 `React.memo` 避免不必要的重渲染
- 使用 `useMemo` 缓存计算结果
- 使用 `useCallback` 缓存回调函数

```typescript
const ImageGrid = React.memo(({ images, layout }: Props) => {
  const groupedImages = useMemo(() => {
    return groupImagesByDate(images);
  }, [images]);

  return <div>{/* 渲染 */}</div>;
});
```

#### 3. 图片懒加载
- HTML `<img loading="lazy">` 属性
- 浏览器自动延迟加载视口外的图片

#### 4. 状态分离
- 不同模式使用独立状态，避免数据污染
- 切换模式时清空其他模式的数据，释放内存

### 后端/主进程优化

#### 1. 数据库优化
- 为常用查询字段创建索引
- 使用 `LIMIT` 和 `OFFSET` 分页查询
- 使用 `GROUP BY` 聚合查询
- 批量插入时使用事务

```typescript
// 分页查询示例
const sql = `
  SELECT * FROM images
  ORDER BY updatedAt DESC
  LIMIT ? OFFSET ?
`;
const images = await all(db, sql, [pageSize, (page - 1) * pageSize]);
```

#### 2. 缩略图优化
- 首次生成后缓存到 `data/thumbnails/`
- 使用 WebP 格式（高压缩比）
- 限制最大尺寸（默认 1000x1000）

#### 3. 下载优化
- 并发控制（默认最大 3 个并发）
- 使用流式下载（避免一次性加载到内存）
- 支持断点续传和重试

```typescript
const response = await axios.get(url, {
  responseType: 'stream',
  timeout: downloadTimeout,
  onDownloadProgress: (progressEvent) => {
    // 更新进度
  }
});

response.data.pipe(fs.createWriteStream(targetPath));
```

## 开发和构建

### 开发环境

#### 安装依赖
```bash
npm install
```

#### 启动开发服务器
```bash
npm run dev
```

这会同时启动：
- 主进程编译（TypeScript 监视模式）
- 预加载脚本编译（TypeScript 监视模式）
- 渲染进程开发服务器（Vite 热更新）

#### 访问应用
Electron 窗口会自动打开，或访问 `http://localhost:5173`

### 生产构建

#### 编译所有代码
```bash
npm run build
```

这会编译：
- 主进程代码到 `build/main/`
- 预加载脚本到 `build/preload/`
- 渲染进程代码到 `build/renderer/`

#### 打包应用

**Windows:**
```bash
npm run dist:win
```

**macOS:**
```bash
npm run dist:mac
```

**Linux:**
```bash
npm run dist:linux
```

输出目录：`dist/`

### 调试技巧

#### 主进程调试
在主进程代码中使用 `console.log()`，输出会显示在终端。

#### 渲染进程调试
在 Electron 窗口中按 `F12` 打开开发者工具。

#### IPC 通信调试
在 IPC 处理器中添加日志：
```typescript
ipcMain.handle('some:operation', async (event, args) => {
  console.log('[IPC] some:operation 调用，参数:', args);
  const result = await someOperation(args);
  console.log('[IPC] some:operation 结果:', result);
  return result;
});
```

## 已知问题和解决方案

### 1. Sharp 编译问题

**问题**：Sharp 是 Native Module，需要针对 Electron 版本重新编译。

**解决方案**：
```bash
npm run rebuild:sharp
```

或使用 electron-builder 自动处理。

### 2. SQLite 编译问题

**问题**：sqlite3 也是 Native Module，需要针对 Electron 版本重新编译。

**解决方案**：
```bash
npm run rebuild
```

### 3. 代理不生效

**问题**：配置了代理但无法访问外网。

**解决方案**：
1. 检查 `config.yaml` 中的代理配置
2. 确保代理服务（如 Clash、V2Ray）正在运行
3. 在 BooruSettingsPage 测试网络连接
4. 查看控制台输出的代理配置信息

### 4. 图片加载慢

**问题**：图片加载速度慢。

**解决方案**：
1. 使用缩略图（自动生成 WebP 格式）
2. 启用图片懒加载
3. 减少每次渲染的图片数量
4. 考虑增加缩略图质量或尺寸

## 未来计划

### 第一阶段 (已完成) ✅
- [x] 基础图片浏览功能
- [x] 本地图片列表展示
- [x] 图库/图集管理
- [x] 缩略图系统
- [x] 标签系统
- [x] Booru API 对接
- [x] 图片搜索和浏览
- [x] 批量下载功能
- [x] 下载队列管理

### 第二阶段 (进行中) 🚧
- [ ] 收藏夹同步
- [ ] 多站点支持完善（Danbooru、Gelbooru）
- [ ] 标签自动完成优化
- [ ] 图片详情页完善
- [ ] 下载历史和统计
- [ ] 相似图片推荐

### 第三阶段 (计划中) 📋
- [ ] 智能标签推荐
- [ ] 图片相似度检测（perceptual hash）
- [ ] 导出和备份功能
- [ ] 主题切换（明暗模式）
- [ ] 多语言支持（中英文）
- [ ] 快捷键支持

### 第四阶段 (未来) 🌟
- [ ] 插件系统
- [ ] 自定义脚本
- [ ] 批量编辑标签
- [ ] 图片分类训练（机器学习）
- [ ] 云端同步
- [ ] 移动端支持

## 参考项目

- **[Boorusama](https://github.com/khoadng/Boorusama)** - Flutter 实现的 Booru 客户端（位于 `example/Boorusama-master/`）
- **[Yande.re](https://yande.re)** - Moebooru 站点示例
- **[Konachan](https://konachan.com)** - Moebooru 站点示例
- **[Hydrus Network](https://github.com/hydrusnetwork/hydrus)** - 功能强大的图片管理工具

## 相关文档

- **[database-schema.md](doc/database-schema.md)** - 数据库表结构详细说明
- **[booru-feature-implementation.md](doc/booru-feature-implementation.md)** - Booru 功能实现文档
- **[gallery-feature.md](doc/gallery-feature.md)** - 图库功能实现文档
- **[README.md](README.md)** - 项目说明和快速开始
- **[ELECTRON_GUIDE.md](ELECTRON_GUIDE.md)** - Electron 开发指南

## 许可证

MIT License - 允许自由使用、修改和分发

---

**最后更新**：2024 年 11 月 19 日  
**作者**：Claude Code  
**版本**：2.0.0
