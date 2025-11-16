# 图库功能实现文档

## 概述

本项目实现了基于懒加载设计的图库管理功能，支持多图库管理、最近图片查看、按文件夹浏览图片等基础图库软件功能。

## 核心特性

### 1. 多图库管理（懒加载设计）

#### 设计思路
- **图库信息存储在数据库**：所有图库元数据（路径、名称、封面、图片数量等）存储在 `galleries` 表中
- **懒加载机制**：应用启动时只加载图库列表（不扫描文件夹），点击图库后才扫描加载图片
- **封面图机制**：每个图库可以设置封面图片，快速预览图库内容

#### 数据表结构

**galleries 表**
```sql
CREATE TABLE galleries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folderPath TEXT NOT NULL UNIQUE,    -- 文件夹完整路径
  name TEXT NOT NULL,                 -- 图库名称（用户自定义）
  coverImageId INTEGER,              -- 封面图片ID（引用images表）
  imageCount INTEGER DEFAULT 0,       -- 图片数量（缓存，提升性能）
  lastScannedAt TEXT,                -- 最后扫描时间
  isWatching INTEGER DEFAULT 1,       -- 是否监视目录变化
  recursive INTEGER DEFAULT 1,        -- 是否递归扫描子目录
  extensions TEXT,                    -- 支持的扩展名（JSON数组）
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
```

### 2. 配置文件（config.yaml）

配置文件定义了数据库连接、下载目录、图库设置等信息。

**关键配置项：**
```yaml
# SQLite 数据库配置
database:
  path: "data/gallery.db"  # 数据库文件路径

# 下载配置 - 注意：图库功能不依赖此配置
downloads:
  path: "downloads"

# 图库配置（配置文件中定义的初始图库）
galleries:
  folders:
    - path: "images"                     # 文件夹路径
      name: "默认图库"                    # 图库显示名称
      autoScan: true                     # 自动扫描（懒加载时忽略）
      recursive: true                    # 递归扫描
      extensions: [".jpg", ".jpeg", ...] # 支持的图片格式

# 缩略图配置
thumbnails:
  cachePath: "data/thumbnails"
  maxWidth: 300
  maxHeight: 300

# 应用配置
app:
  recentImagesCount: 100  # 最近图片显示数量
  pageSize: 50           # 每页显示图片数量
```

**配置文件位置：** `m:\yande\yande-gallery-desktop\config.yaml`

### 3. 数据库服务接口

#### 图片相关操作（imageService.ts）

##### 获取最近图片
```typescript
import { getRecentImages } from '../services/imageService.js';

// 获取最近更新的100张图片
const result = await getRecentImages(100);
// 返回: { success: boolean, data?: Image[], error?: string }
```

##### 按文件夹获取图片（懒加载模式）
```typescript
import { getImagesByFolder } from '../services/imageService.js';

// 获取指定文件夹下的图片（分页）
const result = await getImagesByFolder(
  'D:/Pictures/Anime',  // 文件夹路径
  1,                    // 页码
  50                    // 每页数量
);
// 返回: { success: boolean, data?: Image[], total?: number, error?: string }
```

##### 获取所有文件夹列表
```typescript
import { getAllFolders } from '../services/imageService.js';

const result = await getAllFolders();
// 返回: { success: boolean, data?: string[], error?: string }
```

##### 扫描并导入文件夹
```typescript
import { scanAndImportFolder } from '../services/imageService.js';

const result = await scanAndImportFolder(
  'D:/Pictures/Anime',  // 文件夹路径
  ['.jpg', '.png'],      // 扩展名
  true                   // 递归扫描
);
// 返回: { success: boolean, data?: { imported: number, skipped: number }, error?: string }
```

#### 图库相关操作（galleryService.ts）

##### 获取所有图库列表
```typescript
import { getGalleries } from '../services/galleryService.js';

const result = await getGalleries();
// 返回: { success: boolean, data?: Gallery[], error?: string }
// Gallery 包含图库基本信息和封面图
```

##### 创建图库
```typescript
import { createGallery } from '../services/galleryService.js';

const result = await createGallery({
  folderPath: 'D:/Pictures/Anime',
  name: '动漫图片',
  isWatching: true,
  recursive: true,
  extensions: ['.jpg', '.png', '.webp']
});
// 返回: { success: boolean, data?: galleryId, error?: string }
```

##### 更新图库
```typescript
import { updateGallery } from '../services/galleryService.js';

const result = await updateGallery(1, {
  name: '新名称',
  isWatching: true,
  recursive: false
});
```

##### 设置图库封面
```typescript
import { setGalleryCover } from '../services/galleryService.js';

const result = await setGalleryCover(1, 123); // 图库ID, 图片ID
```

##### 更新图库统计信息
```typescript
import { updateGalleryStats } from '../services/galleryService.js';

const result = await updateGalleryStats(
  1,                                    // 图库ID
  156,                                  // 图片数量
  new Date().toISOString()              // 扫描时间
);
```

#### 配置读取（config.ts）

```typescript
import { loadConfig, getConfig, getDatabasePath, getDownloadsPath, getGalleryFolders } from '../services/config.js';

// 加载配置（首次调用）
const config = await loadConfig();

// 同步获取配置（必须先调用 loadConfig）
const config = getConfig();

// 获取数据库路径
const dbPath = getDatabasePath();

// 获取下载目录路径
const downloadsPath = getDownloadsPath();

// 获取图库目录配置
const folders = getGalleryFolders();
```

**注意：** 需要安装 `js-yaml` 库：`npm install js-yaml @types/js-yaml`

### 4. 懒加载流程

#### 流程图
```
应用启动
    ↓
加载配置（config.yaml）
    ↓
初始化数据库（创建galleries表）
    ↓
从数据库读取图库列表（只读元数据，不扫描）
    ↓
显示图库列表（仅显示名称、封面、图片数量）
    ↓
用户点击图库
    ↓
扫描文件夹（读取图片，添加到images表）
    ↓
更新galleries表的imageCount和lastScannedAt
    ↓
显示图片列表
```

#### 伪代码实现

```typescript
// 1. 应用启动
async function initApp() {
  // 加载配置
  await loadConfig();

  // 初始化数据库
  await initDatabase();

  // 从config.yaml加载初始图库（如果数据库是空的）
  await initGalleriesFromConfig();

  // 获取并显示图库列表（懒加载 - 只显示封面和名称）
  const galleries = await getGalleries();
  renderGalleryList(galleries);
}

// 2. 用户点击图库
async function onGalleryClick(galleryId: number) {
  // 获取图库信息
  const gallery = await getGallery(galleryId);

  // 扫描文件夹（真实加载图片）
  const scanResult = await scanAndImportFolder(
    gallery.folderPath,
    gallery.extensions,
    gallery.recursive
  );

  // 更新统计信息
  await updateGalleryStats(
    galleryId,
    scanResult.imported,
    new Date().toISOString()
  );

  // 获取图片列表
  const images = await getImagesByFolder(gallery.folderPath);

  // 显示图片
  renderImageGrid(images);
}
```

### 5. 从配置文件加载初始图库

在应用首次启动时，如果 `galleries` 表为空，可以从 `config.yaml` 中读取初始图库配置并创建图库。

**实现示例：**

```typescript
// 在应用初始化时调用
async function initGalleriesFromConfig() {
  const db = await getDatabase();

  // 检查是否已有图库
  const existing = await all(db, 'SELECT id FROM galleries');

  if (existing.length === 0) {
    // 从配置读取初始图库
    const config = getConfig();

    for (const folder of config.galleries.folders) {
      try {
        await createGallery({
          folderPath: folder.path,
          name: folder.name,
          isWatching: folder.autoScan,
          recursive: folder.recursive,
          extensions: folder.extensions
        });
        console.log(`✅ 创建图库: ${folder.name}`);
      } catch (error) {
        console.error(`❌ 创建图库失败: ${folder.name}`, error);
      }
    }
  }
}
```

### 6. 文件说明

#### 数据库服务文件

```
src/main/services/
├── database.ts          # 数据库连接管理（创建galleries表）
├── imageService.ts      # 图片操作（新增：getRecentImages, getImagesByFolder, getAllFolders）
└── galleryService.ts    # 图库操作（新增：完整的图库CRUD）
```

#### 工具函数

```
src/main/utils/
└── path.ts              # 路径工具函数（normalizePath, getDirectoryPath等）
```

#### 配置和文档

```
├── config.yaml          # 主配置文件
└── doc/
    ├── database-schema.md   # 数据库表结构
    └── gallery-feature.md   # 本文档
```

### 7. 数据库关系图

```
┌─────────────┐          ┌─────────────┐
│   images    │          │    tags     │
├─────────────┤          ├─────────────┤
│ id          │          │ id          │
│ filename    │          │ name        │
│ filepath    │          │ category    │
│ ...         │          └─────────────┘
└─────────────┘                 │
       │                        │
       │                        │
       │  ┌──────────────┐      │
       └──┤ image_tags   ├──────┘
          ├──────────────┤
          │ imageId      │
          │ tagId        │
          └──────────────┘
                 │
                 │
            ┌────┴──────┐
            │ galleries │
            ├───────────┤
            │ id        │
            │ name      │
            │ folderPath│
            │ cover..   │←─────────┐
            │ ...       │          │
            └───────────┘          │
                                   │
                                   │ 外键关联
                                ┌──┴──┐
                                │ coverImageId
                                └─────┘
```

### 8. 使用示例

#### 从配置初始化图库

```bash
# 1. 编辑配置文件
notepad config.yaml

# 2. 配置你的图库目录
galleries:
  folders:
    - path: "D:/Pictures/Anime"
      name: "动漫图片"
      autoScan: false      # 延迟到点击后再扫描
      recursive: true
      extensions: [".jpg", ".png", ".webp"]

# 3. 启动应用（会自动导入初始图库到数据库）
npm run dev

# 4. 图库页面只显示图库列表和封面

# 5. 点击某个图库 → 触发扫描 → 显示图片
```

#### API 使用示例

```typescript
// 渲染图库列表页面
async function renderGalleryList() {
  const result = await getGalleries();

  if (result.success && result.data) {
    const galleries = result.data;

    // 只显示图库基本信息（不加载图片）
    for (const gallery of galleries) {
      console.log(`图库: ${gallery.name}`);
      console.log(`路径: ${gallery.folderPath}`);
      console.log(`图片数量: ${gallery.imageCount}`);
      console.log(`封面: ${gallery.coverImage?.filepath || '无'}`);
    }
  }
}

// 渲染图库内的图片
async function renderGalleryImages(galleryId: number) {
  // 1. 获取图库信息
  const galleryResult = await getGallery(galleryId);
  if (!galleryResult.success) return;

  const gallery = galleryResult.data!;

  // 2. 如果是首次访问，扫描文件夹
  if (gallery.lastScannedAt === null) {
    await scanAndImportFolder(gallery.folderPath);
  }

  // 3. 获取并显示图片
  const imagesResult = await getImagesByFolder(gallery.folderPath);
  if (imagesResult.success) {
    renderImageGrid(imagesResult.data!);
  }
}
```

### 9. 后续可优化功能

1. **后台扫描**：在后台线程中扫描大图库，避免阻塞UI
2. **智能封面**：自动选择文件夹中清晰度最高的图片作为封面
3. **缓存优化**：缓存图库统计信息，避免重复查询
4. **目录监视**：使用文件系统监视API，自动发现新图片
5. **扫描进度**：显示扫描进度条
6. **去重检测**：检测重复图片并提示用户

### 10. 注意事项

1. **安装依赖**：需要安装 `js-yaml` 库才能读取配置
   ```bash
   npm install js-yaml @types/js-yaml
   ```

2. **路径处理**：Windows 和 Unix 路径格式差异已处理

3. **首次启动**：首次启动时会自动从配置创建图库

4. **性能考虑**：
   - 大图库扫描可能耗时较长（建议后台扫描）
   - 图库列表只显示元数据，性能影响小
   - 图片数量缓存提升性能

---

**最后更新：** 2024年11月16日
**数据库版本：** 1.0.0
