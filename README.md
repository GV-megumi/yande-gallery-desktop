# Yande Gallery Desktop

个人使用的Yande.re图片管理和下载工具

## 项目结构

```
yande-gallery-desktop/
├── src/
│   ├── main/           # Electron主进程
│   ├── renderer/       # React渲染进程
│   ├── core/           # 核心功能
│   ├── shared/         # 共享类型
│   └── preload/        # Preload脚本
├── assets/             # 静态资源
├── .vscode/            # VS Code配置
└── package.json        # 项目配置
```

## 开发环境设置

### 1. 安装依赖（简化版）

由于完整依赖安装可能遇到问题，我们先使用简化版本：

```bash
# 使用简化版package.json
cp package-minimal.json package.json

# 安装基础依赖
npm install
```

### 2. 编译和运行

```bash
# 开发模式
npm run dev

# 构建生产版本
npm run build
```

### 3. 逐步添加高级功能

基础功能完成后，再逐步添加：
- SQLite数据库支持
- Sharp图片处理
- 高级下载功能

## 功能特点

### ✅ 已完成
- Electron + React + TypeScript基础框架
- VS Code开发环境配置
- 基础UI界面
- 图片网格展示
- 模拟数据功能

### 🚧 开发中
- 本地文件扫描
- Yande.re API对接
- 图片下载功能

### 📋 计划中
- SQLite数据库
- 缩略图生成
- 标签管理系统
- 批量下载

## 开发指南

### 文件说明

1. **主进程** (`src/main/`)
   - `index.ts`: 应用入口
   - `window.ts`: 窗口管理
   - `ipc/handlers.ts`: IPC通信处理

2. **渲染进程** (`src/renderer/`)
   - `App.tsx`: 主应用组件
   - `pages/`: 页面组件
   - `components/`: 通用组件

3. **共享类型** (`src/shared/`)
   - `types.ts`: TypeScript类型定义

### 开发建议

1. **渐进式开发**: 先让基础框架跑起来，再逐步添加功能
2. **模块化设计**: 保持代码结构清晰，便于维护
3. **错误处理**: 添加适当的错误处理和用户反馈
4. **性能优化**: 注意内存管理和渲染性能

## 常见问题

### 依赖安装失败

如果遇到依赖安装问题：
1. 清除npm缓存: `npm cache clean --force`
2. 使用国内镜像: `npm config set registry https://registry.npmmirror.com`
3. 逐个安装依赖，先安装基础框架依赖

### Electron启动失败

1. 检查Node.js版本 (推荐 v18+)
2. 确保TypeScript编译成功
3. 查看控制台错误信息

## 下一步开发计划

1. **Week 1**: 完善基础界面和交互
2. **Week 2**: 添加文件扫描功能
3. **Week 3**: 集成Yande.re API
4. **Week 4**: 添加数据库支持

## 许可证

MIT License

---

*个人项目，按自己喜好开发* 😊

## 更新日志

### v0.1.0 (2024-11-16)
- ✅ 创建项目基础结构
- ✅ 配置VS Code开发环境
- ✅ 创建TypeScript配置文件
- ✅ 实现基础Electron框架
- ✅ 创建React UI组件
- ✅ 添加IPC通信机制

### v0.2.0 (计划中)
- 🚧 文件扫描功能
- 🚧 图片展示优化
- 🚧 Yande.re API集成
- 🚧 基础下载功能

### v1.0.0 (目标)
- 📋 完整的本地图库管理
- 📋 Yande.re图片浏览和下载
- 📋 标签管理系统
- 📋 缩略图生成
- 📋 数据库持久化
- 📋 应用打包发布