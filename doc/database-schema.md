# 数据库表结构说明

本文档描述了应用使用的 SQLite 数据库表结构。

## 数据库位置

数据库文件：`data/gallery.db`

使用 SQLite 本地文件数据库，数据存储在应用根目录下的 `data` 文件夹中。

## 数据表概览

1. [images](#images) - 本地图片信息表
2. [tags](#tags) - 标签表
3. [image_tags](#image_tags) - 图片与标签关联表
4. [yande_images](#yande_images) - Yande.re 图片记录表

## 详细表结构

### images

存储本地图片的元数据信息。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | 主键ID |
| filename | TEXT | NOT NULL | 文件名 |
| filepath | TEXT | NOT NULL, UNIQUE | 文件完整路径（唯一） |
| fileSize | INTEGER | NOT NULL | 文件大小（字节） |
| width | INTEGER | NOT NULL | 图片宽度（像素） |
| height | INTEGER | NOT NULL | 图片高度（像素） |
| format | TEXT | NOT NULL | 图片格式（jpg, png等） |
| createdAt | TEXT | NOT NULL | 创建时间（ISO字符串） |
| updatedAt | TEXT | NOT NULL | 更新时间（ISO字符串） |

**索引：**
- `idx_images_filename` - 文件名索引
- `idx_images_createdAt` - 创建时间倒序索引

**示例数据：**
```json
{
  "id": 1,
  "filename": "example.jpg",
  "filepath": "C:/images/example.jpg",
  "fileSize": 2048576,
  "width": 1920,
  "height": 1080,
  "format": "jpg",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

---

### tags

存储标签信息，支持多种标签分类。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | 主键ID |
| name | TEXT | NOT NULL, UNIQUE | 标签名称（唯一） |
| category | TEXT | | 标签分类 |
| createdAt | TEXT | NOT NULL | 创建时间（ISO字符串） |

**索引：**
- `idx_tags_name` - 标签名索引

**示例数据：**
```json
{
  "id": 1,
  "name": "anime",
  "category": "type",
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```

**常见标签分类：**
- `type` - 类型（anime, manga, game等）
- `character` - 角色名
- `artist` - 画师/创作者
- `general` - 一般标签（如：girl, boy, landscape等）
- `rating` - 分级（safe, questionable, explicit）

---

### image_tags

图片与标签的多对多关联表。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| imageId | INTEGER | PRIMARY KEY, FOREIGN KEY | 图片ID |
| tagId | INTEGER | PRIMARY KEY, FOREIGN KEY | 标签ID |

**外键约束：**
- `imageId` 引用 `images.id` ON DELETE CASCADE
- `tagId` 引用 `tags.id` ON DELETE CASCADE

**说明：**
- 一个图片可以有多个标签
- 一个标签可以对应多个图片
- 删除图片时自动删除关联记录
- 删除标签时自动删除关联记录

**示例数据：**
```json
[
  { "imageId": 1, "tagId": 1 },
  { "imageId": 1, "tagId": 2 },
  { "imageId": 2, "tagId": 1 }
]
```

---

### yande_images

存储从 Yande.re 获取的图片信息和下载状态。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | 主键ID |
| yandeId | INTEGER | NOT NULL, UNIQUE | Yande.re 原站图片ID |
| filename | TEXT | NOT NULL | 文件名 |
| fileUrl | TEXT | NOT NULL | 原图URL |
| previewUrl | TEXT | | 预览图URL |
| rating | TEXT | CHECK IN ('safe','questionable','explicit') | 分级 |
| downloaded | INTEGER | DEFAULT 0 | 是否已下载（0/1） |
| localPath | TEXT | | 本地存储路径 |
| createdAt | TEXT | NOT NULL | 创建时间 |
| updatedAt | TEXT | NOT NULL | 更新时间 |

**索引：**
- `idx_yande_images_downloaded` - 下载状态索引

**分级说明：**
- `safe` - 全年龄安全内容
- `questionable` - 可疑/轻微暴露内容
- `explicit` - 明确成人内容

**示例数据：**
```json
{
  "id": 1,
  "yandeId": 123456,
  "filename": "yande_123456.jpg",
  "fileUrl": "https://files.yande.re/image/xxxxx.jpg",
  "previewUrl": "https://assets.yande.re/sample/xxxxx.jpg",
  "rating": "safe",
  "downloaded": 1,
  "localPath": "C:/downloads/yande_123456.jpg",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:35:00.000Z"
}
```

---

## 数据库操作接口

### 初始化数据库
```typescript
import { initDatabase } from '../services/imageService.js';

// 初始化数据库（创建数据表和索引）
const result = await initDatabase();
// 返回: { success: boolean, error?: string }
```

### 图片操作

#### 获取图片列表（分页）
```typescript
const result = await getImages(page = 1, pageSize = 50);
// 返回: { success: boolean, data?: Image[], error?: string }
```

#### 添加图片
```typescript
const imageData = {
  filename: 'example.jpg',
  filepath: 'C:/images/example.jpg',
  fileSize: 2048576,
  width: 1920,
  height: 1080,
  format: 'jpg',
  tags: ['anime', 'girl']  // 可选
};
const result = await addImage(imageData);
// 返回: { success: boolean, data?: imageId, error?: string }
```

#### 搜索图片
```typescript
const result = await searchImages('anime');
// 返回: { success: boolean, data?: Image[], error?: string }
// 支持按文件名和标签搜索
```

### 标签操作

#### 获取所有标签
```typescript
const result = await getAllTags();
// 返回: { success: boolean, data?: Tag[], error?: string }
```

#### 搜索标签
```typescript
const result = await searchTags('ani');
// 返回: { success: boolean, data?: Tag[], error?: string }
```

### Yande.re 图片操作

#### 添加 Yande.re 图片记录
```typescript
const yandeImage = {
  yandeId: 123456,
  filename: 'yande_123456.jpg',
  fileUrl: 'https://files.yande.re/xxxxx.jpg',
  previewUrl: 'https://assets.yande.re/sample/xxxxx.jpg',
  rating: 'safe',
  tags: ['anime', 'cute'],
  downloaded: false
};
const result = await addYandeImage(yandeImage);
```

#### 标记为已下载
```typescript
const result = await markYandeImageAsDownloaded(yandeId, localPath);
// 返回: { success: boolean, error?: string }
```

---

## 数据库文件结构

```
yande-gallery-desktop/
├── data/
│   └── gallery.db          # SQLite 数据库文件
├── downloads/              # 下载的图片文件夹
├── src/
│   ├── main/
│   │   ├── services/
│   │   │   ├── database.ts      # 数据库连接管理
│   │   │   └── imageService.ts  # 数据库操作服务
│   │   └── ipc/
│   │       └── handlers.ts      # IPC 处理器
│   └── shared/
│       └── types.ts             # 数据类型定义
```

---

## 技术说明

### 数据库选择
- **SQLite** - 轻量级嵌入式数据库，无需独立服务器
- 适合桌面应用，单文件存储
- 支持 SQL 标准查询
- 自动事务管理

### 连接管理
- 使用单例模式管理数据库连接
- 首次连接时自动创建数据目录
- 应用关闭时自动释放连接

### 外键约束
- 启用外键支持（SQLite 默认）
- 使用 `ON DELETE CASCADE` 级联删除
- 保证数据完整性

### 索引优化
- 为常用查询字段创建索引
- 提高搜索和排序性能
- 避免全表扫描

---

## 维护和备份

### 数据库备份
数据库是单个文件，可以直接复制备份：
```bash
cp data/gallery.db backup/gallery_$(date +%Y%m%d).db
```

### 数据导出
导出为 SQL 文件：
```bash
sqlite3 data/gallery.db .dump > backup.sql
```

### 性能优化
- 定期执行 `VACUUM` 命令压缩数据库
- 监控数据库文件大小
- 大批量插入时使用事务

---

## 常见问题

### Q: 数据库文件在哪里？
A: 在应用根目录的 `data/gallery.db`

### Q: 如何重置数据库？
A: 删除 `data/gallery.db` 文件，下次启动会自动重新创建

### Q: 如何查看数据库内容？
A: 使用 SQLite 管理工具，如 DB Browser for SQLite

### Q: 支持多大容量的图片库？
A: SQLite 支持 TB 级别数据，实际性能取决于图片数量和查询复杂度

---

**最后更新：** 2024年
**数据库版本：** 1.0.0
