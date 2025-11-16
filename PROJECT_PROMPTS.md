# Yande.re 图片管理工具 - 整体开发提示词

## ⚠️ 重要更新：个人使用桌面应用方案

**经过重新评估，建议采用桌面应用方案而非Web应用，具体原因和方案详见 [PERSONAL_VERSION.md](PERSONAL_VERSION.md)**

### 为什么改为桌面应用？
1. **个人使用更简单**: 双击运行，无需配置服务器环境
2. **本地文件操作**: 直接读写本地文件，无需中转
3. **单文件部署**: 一个exe就能运行，简单方便
4. **性能更好**: 本地SQLite数据库，响应更快
5. **离线可用**: 不依赖网络，本地图库随时可用

## 项目角色定义（个人项目简化版）

### 核心角色
- **独立开发者**: 你一个人负责所有功能实现 😊
- **用户**: 你自己就是目标用户，按自己喜好来

## 技术栈选择建议（个人项目版）

### 🎯 推荐方案：Electron + TypeScript + SQLite

**最适合个人使用的组合**：
- **Electron**: 用前端技术开发桌面应用
- **React + TypeScript**: 熟悉的开发体验
- **SQLite**: 轻量级单文件数据库
- **Sharp**: 高效的图片处理库

### 为什么不是纯Web方案？

| 对比项 | 桌面应用 | Web应用 |
|--------|----------|---------|
| **部署** | 单文件exe，双击运行 | 需要安装配置前端+后端+数据库 |
| **文件操作** | 直接读写本地文件 | 需要API中转，效率低 |
| **性能** | 本地SQLite，极快 | 网络请求+服务器处理 |
| **离线使用** | 完全离线 | 依赖网络连接 |
| **资源占用** | 适中（50-100MB） | 浏览器+服务器，更高 |
| **维护成本** | 低 | 高 |

## Electron桌面应用开发指南

### 项目初始化
```bash
mkdir yande-gallery-desktop
cd yande-gallery-desktop
npm init -y
```

### 安装核心依赖
```bash
# 开发依赖
npm install --save-dev electron typescript @types/react @types/react-dom @types/node vite @vitejs/plugin-react electron-builder

# 运行时依赖
npm install react react-dom sqlite3 sharp axios electron-store

# UI组件库（任选其一）
npm install antd  # Ant Design
# 或者
npm install @mui/material @emotion/react @emotion/styled  # Material-UI
```

### 项目结构
```
yande-gallery-desktop/
├── src/
│   ├── main/           # Electron主进程
│   │   ├── index.ts
│   │   ├── window.ts
│   │   ├── menu.ts
│   │   └── ipc/        # IPC处理
│   │       ├── handlers.ts
│   │       └── channels.ts
│   │
│   ├── renderer/       # 渲染进程（React）
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── services/
│   │   └── store/
│   │
│   ├── core/           # 核心功能
│   │   ├── database/   # SQLite操作
│   │   ├── yande/      # Yande.re API
│   │   ├── download/   # 下载管理
│   │   └── image/      # 图片处理
│   │
│   ├── shared/         # 共享类型
│   │   └── types.ts
│   │
│   └── preload/        # Preload脚本
│       └── index.ts
│
├── assets/             # 静态资源
├── build/              # 构建输出
├── dist/               # 打包输出
├── electron-builder.yml
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## 核心功能开发建议

### 1. 本地图库管理
- **文件夹扫描**: 递归扫描指定文件夹中的图片文件
- **缩略图生成**: 使用Sharp库生成高质量缩略图
- **元数据提取**: 提取图片尺寸、格式、文件大小等信息
- **数据库设计**: 使用SQLite存储图片信息和标签

### 2. Yande.re对接功能
- **API封装**: 封装yande.re的JSON API接口
- **图片浏览**: 支持分页加载和标签筛选
- **下载管理**: 单张/批量下载，支持下载队列
- **元数据同步**: 保存yande.re的图片元数据到本地

### 3. 标签管理系统
- **标签分类**: 支持标签分类和层级管理
- **批量操作**: 支持批量添加/删除标签
- **智能搜索**: 基于标签的快速搜索功能
- **标签推荐**: 根据使用频率推荐标签

## SQLite数据库设计（简化版）

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
```

## 开发优先级建议

### 🔥 MVP阶段（第1-2周）
1. **基础框架搭建**
   - Electron + React + TypeScript环境配置
   - 基础窗口和菜单设计
   - IPC通信机制建立

2. **本地图库功能**
   - 文件夹选择和扫描
   - 图片信息提取和存储
   - 基础图片网格展示

3. **Yande.re基础对接**
   - API封装和测试
   - 图片列表浏览
   - 单张图片下载

### 🎯 进阶功能（第3-4周）
1. **用户体验优化**
   - 缩略图生成和缓存
   - 图片预览功能
   - 加载状态管理

2. **标签系统**
   - 标签添加和删除
   - 标签搜索功能
   - 标签分类管理

3. **下载管理**
   - 下载队列管理
   - 下载进度显示
   - 批量下载功能

### 🚀 高级功能（第5-6周）
1. **性能优化**
   - 虚拟滚动实现
   - 图片懒加载
   - 数据库索引优化

2. **界面美化**
   - 主题切换（明暗模式）
   - 自定义布局
   - 交互动画效果

3. **高级功能**
   - 智能去重检测
   - 相似图片推荐
   - 数据统计分析

## 打包和发布

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
      "node_modules/**/*",
      "package.json"
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

### 构建命令
```bash
# 开发环境
npm run dev

# 构建应用
npm run build

# 打包当前平台
npm run dist

# 打包特定平台
npm run dist -- --win
npm run dist -- --mac
npm run dist -- --linux
```

## 个人项目开发建议

### 1. 保持简单
- 不要过度设计，先实现基本功能
- 按自己的使用习惯来设计界面
- 功能可以逐步添加，不必一次到位

### 2. 代码质量
- 保持代码整洁，适当添加注释
- 使用TypeScript类型检查避免错误
- 定期备份代码到Git仓库

### 3. 性能考虑
- 图片处理使用Sharp库，性能优异
- SQLite足够支撑数万张图片的管理
- 注意内存管理，及时释放不需要的资源

### 4. 用户体验
- 界面设计简洁直观
- 操作响应要及时，避免卡顿
- 提供必要的操作反馈

## 开发工具推荐

### 必备工具
- **VS Code** - 代码编辑器，支持TypeScript
- **React Developer Tools** - React调试工具
- **SQLite Browser** - 数据库可视化工具

### 可选工具
- **Figma** - 界面原型设计
- **Postman** - API测试工具
- **GitHub Desktop** - 代码版本管理

## 下一步行动建议

1. **立即开始**：按照 [ELECTRON_GUIDE.md](m:/yande/ELECTRON_GUIDE.md) 创建基础项目结构
2. **MVP验证**：先实现最简单的图片扫描和展示功能
3. **逐步完善**：在MVP基础上添加Yande.re对接功能
4. **持续优化**：根据使用体验调整功能和界面

记住，这是你自己的项目，按自己的节奏和喜好来开发就好。不需要追求完美，实用和好用才是关键！

---

*最后更新: 2024年11月16日*
*针对个人使用场景优化的开发指南*