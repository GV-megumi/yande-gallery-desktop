# Yande Gallery Desktop - 图库管理与 MBooru 对接程序

## 项目概述

本项目是一个基于 Electron 的桌面应用程序，提供**本地图库管理**和**MBooru（Yande.re 等 Booru 站点）对接**功能。程序支持本地图片的浏览、管理和组织，同时可以对接多个 Booru 站点的 API，实现图片的搜索、浏览和下载。

## 功能特性

### 核心功能

#### 本地图库管理
- **图片浏览**: 支持瀑布流和网格两种布局
  - **最近图片**: 懒加载模式，显示最近更新的图片（瀑布流布局）
  - **全部图片**: 分页模式，支持按时间/文件名排序（瀑布流布局）
  - **图集管理**: 按文件夹组织图片，支持设置封面（网格布局）
- **图片组织**: 支持图集（Gallery）管理，按文件夹自动分类
- **标签系统**: 支持标签管理和搜索
- **缩略图系统**: 自动生成和管理缩略图，提升浏览性能
- **图片预览**: 支持缩放、拖拽、键盘导航等高级预览功能

#### MBooru 对接
- **Booru API 对接**: 对接 Yande.re 等 Booru 站点的 API
- **图片搜索**: 支持按标签搜索 Booru 站点图片
- **批量下载**: 支持按标签、作者、评分等条件批量下载
- **下载队列**: 支持断点续传，下载状态管理
- **智能去重**: 自动检测重复图片，避免重复下载

### 高级功能
- **标签管理**: 支持自定义标签，批量标签操作
- **智能推荐**: 基于下载历史推荐相似图片
- **数据同步**: 支持账户登录，同步收藏夹数据
- **多语言支持**: 中英文界面切换
- **主题切换**: 支持明暗主题

## 技术架构

### 桌面应用架构 (Electron)
- **主进程 (Main Process)**: Node.js + TypeScript
  - 数据库操作 (SQLite)
  - 文件系统操作
  - 图片处理 (Sharp)
  - Booru API 对接
  - IPC 通信处理
- **渲染进程 (Renderer Process)**: React 18 + TypeScript
  - UI 渲染和用户交互
  - 状态管理 (React Hooks)
  - 图片展示和浏览
- **预加载脚本 (Preload Script)**: 安全地暴露 Electron API 给渲染进程

### 前端技术栈
- **框架**: React 18 + TypeScript
- **UI组件库**: Ant Design
- **图片展示**: 瀑布流/网格布局 + 懒加载
- **构建工具**: Vite
- **通信**: Electron IPC (Inter-Process Communication)

### 后端/主进程技术栈
- **运行时**: Node.js (Electron 内置)
- **数据库**: SQLite3 (本地图库元数据)
- **图片处理**: Sharp (缩略图生成、图片操作)
- **配置管理**: js-yaml (YAML 配置文件)
- **数据持久化**: electron-store (应用设置)

### 数据存储
- **图片存储**: 本地文件系统（用户指定目录）
- **元数据**: SQLite 数据库存储图片信息、标签、图集信息
- **缩略图缓存**: 本地文件系统（`data/thumbnails`）
- **配置文件**: YAML 格式 (`config.yaml`)

## 架构设计原则

### 组件抽象与复用

**重要原则**: 必要的一些组件或容器需要写成抽象层方便复用。

#### 已实现的抽象层

1. **`ImageGrid`** - 图片网格/瀑布流核心组件
   - 支持瀑布流 (`waterfall`) 和网格 (`grid`) 两种布局
   - 支持按时间/文件名排序
   - 支持按天/月/年分组
   - 统一的图片预览和详情查看

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

5. **`ImageCard`** - 图片卡片组件
   - 统一的图片卡片渲染
   - 支持缩略图自动获取/生成
   - 优化渲染性能（React.memo）

#### 抽象层的好处

- **代码复用**: 避免重复实现相同的功能
- **易于维护**: 修改一处即可影响所有使用场景
- **一致性**: 保证不同场景下的 UI 和行为一致
- **可测试性**: 独立的组件更易于单元测试

#### 未来可考虑的抽象

- **分页器组件**: 统一处理分页逻辑（当前"全部图片"有独立的实现）
- **图集卡片组件**: 抽象图集卡片的渲染逻辑（当前在 `GalleryCardList` 中）
- **Booru API 客户端**: 抽象不同 Booru 站点的 API 对接（当前主要对接 Yande.re）
- **图片预览组件**: 进一步抽象图片预览功能（当前在 `ImageGrid` 中）

## 项目结构

```
yande-gallery/
├── frontend/                 # React TypeScript 前端
│   ├── src/
│   │   ├── components/       # UI组件
│   │   ├── pages/           # 页面组件
│   │   ├── hooks/           # 自定义Hooks
│   │   ├── services/        # API服务
│   │   ├── stores/          # 状态管理
│   │   ├── types/           # TypeScript类型定义
│   │   └── utils/           # 工具函数
│   ├── public/              # 静态资源
│   └── package.json
│
├── backend/                  # Python后端
│   ├── app/
│   │   ├── api/             # API路由
│   │   ├── models/          # 数据模型
│   │   ├── services/        # 业务逻辑
│   │   ├── utils/           # 工具函数
│   │   └── core/            # 核心配置
│   ├── migrations/          # 数据库迁移
│   ├── tests/               # 测试文件
│   └── requirements.txt
│
├── shared/                   # 共享类型定义
│   └── types/               # 前后端共享的类型
│
├── downloads/                # 下载图片存储
├── config/                   # 配置文件
└── docs/                     # 项目文档
```

## API设计

### yande.re API 对接
- **基础URL**: https://yande.re/post.json
- **认证方式**: 可选的用户认证
- **请求限制**: 频率控制和错误处理
- **数据格式**: JSON响应解析和处理

### 内部API设计
- **RESTful风格**: 清晰的资源命名和操作
- **分页处理**: 统一的分页参数和响应格式
- **错误处理**: 统一的错误响应格式
- **数据验证**: 请求参数和响应数据的验证

## 核心模块设计

### 图片下载模块
```python
class DownloadManager:
    - 下载队列管理
    - 并发下载控制
    - 断点续传支持
    - 下载速度限制
    - 错误重试机制
```

### 图片去重模块
```python
class DuplicateDetector:
    - 基于文件哈希的去重
    - 基于 perceptual hash 的相似图片检测
    - 基于文件大小的初筛
    - 元数据比对验证
```

### 标签管理模块
```python
class TagManager:
    - 标签分类和层级
    - 标签搜索和推荐
    - 批量标签操作
    - 标签统计和分析
```

## 开发规范

### 日志输出规范

**要求**：所有代码必须在控制台输出日志，以便于调试和问题追踪。

**规范说明**：
- **前端代码**：使用 `console.log()`、`console.warn()`、`console.error()` 等控制台方法输出日志
  - 关键操作（如数据加载、状态变更、用户交互）应输出日志
  - 错误情况必须使用 `console.error()` 输出错误信息
  - 警告信息使用 `console.warn()` 输出
- **后端代码**：使用适当的日志库（如 Python 的 `logging` 模块）输出日志
  - API 请求和响应应记录日志
  - 业务逻辑关键步骤应输出日志
  - 异常情况必须记录错误日志
- **日志级别**：
  - `debug`: 详细的调试信息
  - `info`: 一般信息（如操作成功、状态变更）
  - `warn`: 警告信息（如参数异常、性能问题）
  - `error`: 错误信息（如异常、失败操作）
- **日志格式**：建议包含时间戳、模块名称、操作描述等信息，便于问题定位

**示例**：
```typescript
// 前端示例
console.log('[ImageGrid] 加载图片列表，数量:', images.length);
console.error('[ImageService] 图片加载失败:', error);
```

```python
# 后端示例
import logging
logger = logging.getLogger(__name__)
logger.info(f'开始下载图片: {image_url}')
logger.error(f'下载失败: {error}')
```

## 性能优化

### 前端优化
- **虚拟滚动**: 处理大量图片列表
- **图片懒加载**: 按需加载可视区域图片
- **缓存策略**: 合理的缓存和预加载
- **代码分割**: 按需加载功能模块

### 后端优化
- **异步处理**: 使用async/await提高并发能力
- **连接池**: 数据库连接池管理
- **缓存策略**: Redis缓存热点数据
- **图片压缩**: 下载时进行图片压缩优化

## 安全考虑

### 数据安全
- **输入验证**: 严格的参数验证和过滤
- **SQL注入防护**: 使用ORM和参数化查询
- **XSS防护**: 前端输入输出编码
- **CSRF防护**: 跨站请求伪造防护

### 网络安全
- **API限流**: 防止API被滥用
- **用户认证**: 可选的用户登录和权限管理
- **HTTPS**: 建议使用HTTPS加密通信
- **CORS配置**: 合理的跨域配置

## 部署方案

### 开发环境
- **前端**: Vite开发服务器 + 热更新
- **后端**: Python开发服务器 + 自动重启
- **数据库**: SQLite (轻量级开发)

### 生产环境
- **前端**: Nginx静态文件服务
- **后端**: Gunicorn + Uvicorn (ASGI服务器)
- **数据库**: PostgreSQL
- **反向代理**: Nginx反向代理和负载均衡
- **容器化**: Docker容器化部署支持

## 开发计划

### 第一阶段 (MVP)
- [ ] 基础图片浏览功能
- [ ] 单张图片下载
- [ ] 本地图片列表展示
- [ ] 基础标签显示

### 第二阶段 (核心功能)
- [ ] 批量下载功能
- [ ] 标签管理和搜索
- [ ] 图片去重功能
- [ ] 下载队列管理

### 第三阶段 (高级功能)
- [ ] 用户登录和数据同步
- [ ] 智能推荐系统
- [ ] 高级搜索和过滤
- [ ] 主题和国际化支持

### 第四阶段 (优化和完善)
- [ ] 性能优化
- [ ] 移动端适配
- [ ] 插件系统
- [ ] 数据分析和统计

## 技术选型理由

### 前端技术栈
- **React**: 生态系统成熟，组件化开发
- **TypeScript**: 类型安全，提高代码质量
- **Vite**: 快速的构建工具和开发体验
- **Ant Design**: 丰富的UI组件，快速开发

### 后端技术栈
- **FastAPI**: 现代、快速、基于Python 3.7+的API框架
- **SQLAlchemy**: 强大的ORM，支持多种数据库
- **Celery**: 分布式任务队列，处理异步任务
- **Redis**: 高性能的内存数据库，用于缓存和队列

## 参考项目

- [Boorusama](https://github.com/khoadng/Boorusama) - Flutter实现的booru客户端
- [yande.re](https://yande.re) - 目标网站
- [Hydrus Network](https://github.com/hydrusnetwork/hydrus) - 图片管理工具

## 图库页面实现逻辑

### 页面结构

图库页面 (`GalleryPage.tsx`) 支持三种不同的浏览模式，通过 `subTab` prop 控制：
- `recent`: 最近图片（懒加载模式）
- `all`: 所有图片（分页模式）
- `galleries`: 图集列表和浏览（懒加载模式）

### 状态管理

为了避免不同模式之间的数据干扰，使用了独立的状态变量：

```typescript
// 分离不同模式的状态，避免相互干扰
const [recentImages, setRecentImages] = useState<any[]>([]); // 最近图片数据（懒加载，一次2000张）
const [allImages, setAllImages] = useState<any[]>([]); // 所有图片分页数据（每次20张）
const [galleryImages, setGalleryImages] = useState<any[]>([]); // 图集图片数据（懒加载，一次1000张）
```

### 三种模式的实现逻辑

#### 1. 最近图片（懒加载模式）

**数据加载**：
- 一次性从数据库加载2000张最近更新的图片到 `recentImages`
- 使用 `getRecentImages(2000)` API

**渲染策略**：
- 初始只渲染前200张（`recentVisibleCount = 200`）
- 使用 `recentImages.slice(0, recentVisibleCount)` 切片渲染
- 滚动到底部时，自动增加200张（通过 `useEffect` 监听滚动事件）
- 显示"加载更多"按钮，手动点击也可以加载200张

**特点**：
- 数据一次性加载到内存，但DOM只渲染可见部分
- 适合快速浏览大量最近图片

#### 2. 所有图片（分页模式）

**数据加载**：
- 每次只从数据库加载20张图片（`pageSize = 20`）
- 使用 `getImages(page, 20)` API，支持分页查询
- 切换页面时先清空旧数据：`setAllImages([])`

**渲染策略**：
- 直接渲染当前页的20张图片（`allImages`）
- 通过"上一页/下一页"按钮切换页面
- 不支持滚动加载，必须点击分页按钮

**搜索功能**：
- 支持按文件名和标签搜索
- 搜索结果也使用分页模式，每页20张
- 搜索时使用 `searchImages(query, page, 20)` API

**特点**：
- 内存占用最小，每次只加载20张
- 适合精确查找和浏览特定范围的图片

#### 3. 图集（懒加载模式）

**数据加载**：
- 点击图集后，一次性加载该图集的1000张图片到 `galleryImages`
- 使用 `getImagesByFolder(folderPath, 1, 1000)` API

**渲染策略**：
- 初始只渲染前200张（`galleryVisibleCount = 200`）
- 使用 `galleryImages.slice(0, galleryVisibleCount)` 切片渲染
- 显示"加载更多"按钮，点击后增加200张

**图集列表搜索**：
- 支持按图集名称搜索
- 前端过滤，不重新查询数据库

**布局方式**：
- 图集内图片使用**网格布局**（`layout="grid"`），而非瀑布流
- 其他场景（最近图片、全部图片）使用**瀑布流布局**（默认）

**特点**：
- 单个图集数据一次性加载，但DOM只渲染可见部分
- 适合浏览单个图集的内容
- 网格布局提供更规整的视觉效果

### 切换模式时的清理逻辑

当切换 `subTab` 时，会清空其他模式的数据，避免内存累积：

```typescript
useEffect(() => {
  if (subTab === 'recent') {
    setAllImages([]);
    setGalleryImages([]);
    loadRecentImages(2000);
  } else if (subTab === 'all') {
    setRecentImages([]);
    setGalleryImages([]);
    setAllImages([]);
    loadImages(1, 20);
  } else if (subTab === 'galleries') {
    setRecentImages([]);
    setAllImages([]);
    setGalleryImages([]);
    loadGalleries();
  }
}, [subTab]);
```

### ImageGrid 组件

`ImageGrid` 组件接收 `images` prop，直接渲染传入的图片数组：
- 对于"所有图片"：传入的是 `allImages`（当前页20张）
- 对于"最近图片"：传入的是 `recentImages.slice(0, recentVisibleCount)`（已切片）
- 对于"图集"：传入的是 `galleryImages.slice(0, galleryVisibleCount)`（已切片）

组件内部使用 `useMemo` 对图片进行分组和排序，支持按时间分组和按文件名排序。

### 数据库查询

**所有图片分页查询**：
```sql
SELECT i.*, GROUP_CONCAT(t.name) as tags
FROM images i
LEFT JOIN image_tags it ON i.id = it.imageId
LEFT JOIN tags t ON it.tagId = t.id
GROUP BY i.id
ORDER BY i.updatedAt DESC
LIMIT ? OFFSET ?
```

**搜索图片分页查询**：
```sql
SELECT i.*, GROUP_CONCAT(t.name) as tags
FROM images i
LEFT JOIN image_tags it ON i.id = it.imageId
LEFT JOIN tags t ON it.tagId = t.id
WHERE LOWER(i.filename) LIKE ? OR LOWER(t.name) LIKE ?
GROUP BY i.id
ORDER BY i.updatedAt DESC
LIMIT ? OFFSET ?
```

### 性能优化

1. **状态分离**：三种模式使用独立状态，避免数据污染
2. **分页加载**："所有图片"模式每次只加载20张，内存占用最小
3. **懒加载渲染**："最近图片"和"图集"模式只渲染可见部分
4. **切换清理**：切换模式时清空其他模式的数据，释放内存
5. **图片懒加载**：使用 `loading="lazy"` 属性，浏览器自动延迟加载视口外的图片

## 许可证

MIT License - 允许自由使用、修改和分发

---

*最后更新: 2024年11月17日*
*作者: Claude Code*