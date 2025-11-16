# 个人版 Yande.re 本地图库管理器

## 项目重新定位

从原来的Web应用改为**桌面应用程序**，专注于个人使用，提供简洁高效的本地图库管理和yande.re对接功能。

## 为什么选择桌面应用？

### ✅ 桌面应用优势
- **本地文件直接操作**: 无需通过Web接口，直接读写本地文件
- **更好的性能**: 本地数据库，响应更快
- **离线使用**: 不依赖网络，本地图库随时可用
- **系统集成**: 可以集成文件系统、右键菜单等
- **单文件部署**: 一个exe就能运行，简单方便
- **资源占用低**: 不需要浏览器和服务器环境

### ❌ Web应用缺点（个人使用场景）
- 需要同时运行前端+后端+数据库
- 配置复杂，部署麻烦
- 资源占用高
- 文件操作需要中转

## 技术方案对比

### 方案1: Electron + TypeScript + SQLite (推荐)
**优点**:
- 前端技术栈，开发效率高
- 跨平台（Windows/Mac/Linux）
- 丰富的UI组件库
- SQLite足够轻量，单文件数据库

**缺点**:
- 安装包稍大（50-100MB）
- 内存占用相对较高

### 方案2: Tauri + Rust + SQLite
**优点**:
- 安装包小（10-20MB）
- 性能极佳，内存占用低
- 现代技术栈

**缺点**:
- Rust学习曲线陡峭
- 生态相对较小

### 方案3: Python + Tkinter/PyQt + SQLite
**优点**:
- Python简单易学
- 大量图片处理库
- 快速开发

**缺点**:
- UI美观度有限
- 打包后体积大

## 最终推荐方案

### 🎯 Electron + TypeScript + SQLite

**理由**:
1. **开发效率**: 用熟悉的前端技术快速开发
2. **用户体验**: 现代化的UI界面
3. **功能完整**: 能轻松实现所有需求功能
4. **个人维护**: 代码简洁，易于后续维护

## 架构设计

```
yande-gallery-desktop/
├── src/
│   ├── main/           # Electron主进程
│   │   ├── index.ts    # 应用入口
│   │   ├── window.ts   # 窗口管理
│   │   ├── menu.ts     # 菜单配置
│   │   └── ipc/        # IPC通信
│   │
│   ├── renderer/       # 渲染进程（UI）
│   │   ├── components/ # React组件
│   │   ├── pages/      # 页面组件
│   │   ├── hooks/      # 自定义Hooks
│   │   ├── services/   # 业务逻辑
│   │   ├── store/      # 状态管理
│   │   └── utils/      # 工具函数
│   │
│   ├── core/           # 核心功能
│   │   ├── database/   # SQLite操作
│   │   ├── yande/      # Yande.re API对接
│   │   ├── download/   # 下载管理
│   │   └── image/      # 图片处理
│   │
│   └── shared/         # 共享类型定义
│
├── assets/             # 静态资源
├── dist/               # 打包输出
└── package.json
```

## 核心功能规划

### 🔥 MVP阶段（第一优先级）
1. **本地图库管理**
   - 指定文件夹扫描图片
   - 缩略图生成和展示
   - 基础标签管理（添加/删除/搜索）
   - 图片预览和基本信息显示

2. **Yande.re对接**
   - 浏览yande.re图片（分页加载）
   - 单张图片下载
   - 基础搜索（标签、评级）

3. **数据存储**
   - SQLite数据库存储图片元数据
   - 简单的配置存储

### 🎯 进阶功能（第二优先级）
1. **批量操作**
   - 批量下载（按标签、页数）
   - 批量标签操作
   - 智能去重检测

2. **高级搜索**
   - 本地图库多条件搜索
   - Yande.re高级搜索
   - 搜索历史记录

3. **用户体验**
   - 暗色主题
   - 自定义界面布局
   - 快捷键支持

### 🚀 高级功能（可选）
1. **智能功能**
   - 相似图片推荐
   - 自动标签生成（基于AI）
   - 使用统计分析

2. **同步功能**
   - Yande.re收藏夹同步
   - 数据备份和恢复
   - 多设备配置同步

## 数据库设计（极简版）

### SQLite方案（单文件）
```sql
-- 图片表
CREATE TABLE images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL UNIQUE,
    file_size INTEGER,
    width INTEGER,
    height INTEGER,
    format TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 标签表
CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    category TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 图片标签关联表
CREATE TABLE image_tags (
    image_id INTEGER,
    tag_id INTEGER,
    PRIMARY KEY (image_id, tag_id),
    FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Yande.re图片记录表
CREATE TABLE yande_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    yande_id INTEGER UNIQUE NOT NULL,
    filename TEXT,
    file_url TEXT,
    preview_url TEXT,
    rating TEXT,
    tags TEXT,  -- JSON格式存储标签
    downloaded BOOLEAN DEFAULT FALSE,
    local_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 配置表
CREATE TABLE config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## 技术选型详解

### Electron + React + TypeScript
```json
{
  "dependencies": {
    "electron": "^27.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "typescript": "^5.2.0",
    "sqlite3": "^5.1.6",
    "sharp": "^0.32.0",
    "axios": "^1.6.0"
  }
}
```

### 为什么不是纯前端存储？
虽然可以使用浏览器的IndexedDB或LocalStorage，但对于图片管理这种可能涉及数万张图片的场景，SQLite更合适：
- **性能更好**: SQLite专为大量数据设计
- **查询更强**: 支持复杂SQL查询
- **数据完整性**: 事务支持和数据约束
- **备份方便**: 单文件数据库，易于备份

## 开发时间估算

### MVP版本（2-3周）
- 基础界面搭建：3天
- 本地图库扫描和展示：4天
- SQLite数据库集成：2天
- Yande.re API对接：3天
- 下载功能实现：3天
- 测试和优化：2天

### 完整版（6-8周）
- 在MVP基础上增加进阶功能
- UI美化和用户体验优化
- 性能优化和错误处理
- 打包和发布准备

## 打包和分发

### Electron Builder配置
```json
{
  "build": {
    "appId": "com.yourname.yande-gallery",
    "productName": "Yande Gallery",
    "directories": {
      "output": "dist"
    },
    "files": [
      "build/**/*",
      "node_modules/**/*"
    ],
    "mac": {
      "category": "public.app-category.photography"
    },
    "win": {
      "target": "nsis"
    },
    "linux": {
      "target": "AppImage"
    }
  }
}
```

### 最终产物
- Windows: `.exe` 安装包（约50-80MB）
- macOS: `.dmg` 镜像文件（约60-90MB）
- Linux: `.AppImage` 可执行文件（约50-80MB）

## 个人使用优势

1. **简单易用**: 双击运行，无需配置
2. **数据安全**: 所有数据保存在本地，隐私性好
3. **性能优异**: 本地数据库，响应速度快
4. **离线可用**: 不依赖网络，随时浏览本地图库
5. **维护简单**: 单文件数据库，易于备份和迁移
6. **定制灵活**: 可以根据个人需求定制功能

## 下一步建议

1. **先确定Electron开发环境**：搭建基础框架
2. **实现最简单的本地图库浏览**：验证技术方案可行性
3. **逐步添加Yande.re对接功能**：避免一开始就过于复杂
4. **根据使用反馈优化**：个人项目可以快速迭代

这个方案既保持了功能的完整性，又大大简化了开发和部署的复杂度，非常适合个人使用！你觉得这个方向如何？需要我详细展开某个部分吗？比如具体的技术实现细节或者开发步骤规划？

---

*最后更新: 2024年11月16日*
*针对个人使用场景重新设计*