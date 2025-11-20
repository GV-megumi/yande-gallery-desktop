# Yande Gallery Desktop

一个基于 **Electron + React + TypeScript** 的桌面应用程序，提供本地图库管理和 Booru 站点（Yande.re、Konachan 等）对接功能。

## 功能特点

### 本地图库管理
- 📸 **图片浏览**：支持最近图片、全部图片、图集管理
- 🏷️ **标签系统**：支持标签管理、搜索和批量操作
- 🖼️ **缩略图系统**：自动生成和管理 WebP 格式缩略图
- 🔍 **图片搜索**：支持按文件名、标签搜索，支持模糊匹配
- 📁 **多图库管理**：支持按文件夹组织图片，自动分类

### Booru 站点对接
- 🌐 **多站点支持**：支持 Moebooru、Danbooru、Gelbooru 等
- 📥 **批量下载**：支持按标签、评分等条件批量下载
- ⚡ **下载队列**：支持并发下载、断点续传、下载状态管理
- 🔄 **智能去重**：基于 MD5 检测重复图片，避免重复下载
- 📝 **文件名自定义**：支持灵活的文件名模板系统

## 系统要求

- **操作系统**：Windows 10/11、macOS 10.15+、Linux
- **Node.js**：v18.0.0 或更高版本（推荐 v20.x LTS）
- **npm**：v9.0.0 或更高版本（随 Node.js 一起安装）
- **Git**：用于克隆仓库
- **Python**：v3.x（用于编译 native 模块，Windows 需要）
- **构建工具**：
  - Windows: Visual Studio Build Tools 或 Visual Studio Community
  - macOS: Xcode Command Line Tools
  - Linux: build-essential (Ubuntu/Debian) 或等效工具

## 源码安装教程

### 第一步：安装 Node.js

#### Windows

1. **下载 Node.js**
   - 访问 [Node.js 官网](https://nodejs.org/)
   - 下载 **LTS 版本**（推荐 v20.x）
   - 选择 Windows Installer (.msi) 64-bit

2. **安装 Node.js**
   - 运行下载的安装程序
   - 按照向导完成安装（保持默认选项即可）
   - 确保勾选 "Add to PATH" 选项

3. **验证安装**
   ```bash
   node --version
   npm --version
   ```
   应该显示类似：
   ```
   v20.10.0
   10.2.3
   ```

#### macOS

1. **使用 Homebrew 安装（推荐）**
   ```bash
   brew install node
   ```

2. **或下载安装包**
   - 访问 [Node.js 官网](https://nodejs.org/)
   - 下载 macOS Installer (.pkg)
   - 运行安装程序

3. **验证安装**
   ```bash
   node --version
   npm --version
   ```

#### Linux (Ubuntu/Debian)

```bash
# 使用 NodeSource 仓库安装
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证安装
node --version
npm --version
```

### 第二步：安装构建工具（仅 Windows）

Windows 需要安装构建工具来编译 native 模块（sqlite3、sharp）。

#### 方法 1：安装 Visual Studio Build Tools（推荐）

1. 下载 [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)
2. 运行安装程序，选择 "C++ build tools" 工作负载
3. 确保勾选 "Windows 10/11 SDK"

#### 方法 2：安装 Visual Studio Community

1. 下载 [Visual Studio Community](https://visualstudio.microsoft.com/downloads/)
2. 安装时选择 "使用 C++ 的桌面开发" 工作负载

#### 方法 3：使用 windows-build-tools（已弃用，不推荐）

```bash
npm install --global windows-build-tools
```

### 第三步：克隆仓库

```bash
# 克隆仓库
git clone https://github.com/your-username/yande-gallery-desktop.git

# 进入项目目录
cd yande-gallery-desktop
```

### 第四步：安装项目依赖

#### 配置 npm 镜像（可选，国内用户推荐）

```bash
# 使用淘宝镜像加速下载
npm config set registry https://registry.npmmirror.com
```

#### 安装依赖

```bash
# 安装所有依赖（包括 devDependencies）
npm install
```

**注意**：首次安装可能需要较长时间（5-10 分钟），因为需要编译 native 模块。

#### 如果安装失败

如果遇到 native 模块编译错误，可以尝试：

```bash
# 清除 npm 缓存
npm cache clean --force

# 删除 node_modules 和 package-lock.json
rm -rf node_modules package-lock.json

# 重新安装
npm install
```

### 第五步：重建 Native 模块（如果需要）

如果遇到 sqlite3 或 sharp 相关错误，需要针对 Electron 版本重新编译：

```bash
# 重建所有 native 模块
npm run rebuild

# 或单独重建 sharp
npm run rebuild:sharp
```

### 第六步：配置应用

创建或编辑 `config.yaml` 文件：

```yaml
# 数据库配置
database:
  path: data/gallery.db

# 下载配置
downloads:
  path: ./downloads
  createSubfolders: true

# 图库配置
galleries:
  folders:
    - path: ./images
      name: 默认图库
      autoScan: true
      recursive: true
      extensions:
        - .jpg
        - .jpeg
        - .png
        - .gif
        - .webp

# 网络配置（可选，需要代理时）
network:
  proxy:
    enabled: false
    protocol: http
    host: 127.0.0.1
    port: '7890'
```

### 第七步：运行应用

#### 开发模式

```bash
# 启动开发服务器（会自动打开 Electron 窗口）
npm run dev
```

这会同时启动：
- 主进程编译（TypeScript 监视模式）
- 预加载脚本编译（TypeScript 监视模式）
- 渲染进程开发服务器（Vite 热更新）

#### 生产构建

```bash
# 编译所有代码
npm run build

# 打包应用
npm run dist:win    # Windows
npm run dist:mac    # macOS
npm run dist:linux  # Linux
```

打包后的应用在 `dist/` 目录。

## 开发指南

### 项目结构

```
yande-gallery-desktop/
├── src/
│   ├── main/                    # Electron 主进程
│   │   ├── index.ts             # 应用入口
│   │   ├── window.ts            # 窗口管理
│   │   ├── ipc/                 # IPC 通信
│   │   └── services/            # 核心服务
│   ├── renderer/                # React 渲染进程
│   │   ├── App.tsx              # 主应用组件
│   │   ├── pages/               # 页面组件
│   │   └── components/          # UI 组件
│   ├── preload/                 # 预加载脚本
│   └── shared/                  # 共享类型定义
├── build/                       # 编译输出目录
├── data/                        # 数据目录
│   ├── gallery.db               # SQLite 数据库
│   └── thumbnails/              # 缩略图缓存
├── config.yaml                  # 应用配置文件
└── package.json                 # 项目配置
```

### 常用命令

```bash
# 开发模式
npm run dev

# 编译代码
npm run build

# 仅编译主进程
npm run build:main

# 仅编译渲染进程
npm run build:renderer

# 重建 native 模块
npm run rebuild

# 打包应用
npm run dist:win
```

### 调试技巧

- **主进程调试**：在主进程代码中使用 `console.log()`，输出会显示在终端
- **渲染进程调试**：在 Electron 窗口中按 `F12` 打开开发者工具
- **IPC 通信调试**：查看终端和控制台的日志输出

## 常见问题

### 1. Node.js 版本不兼容

**问题**：提示 Node.js 版本过低或过高

**解决**：
- 确保使用 Node.js v18+（推荐 v20.x LTS）
- 使用 `nvm`（Node Version Manager）管理多个 Node.js 版本

### 2. Native 模块编译失败

**问题**：sqlite3 或 sharp 编译错误

**解决**：
```bash
# Windows: 确保安装了 Visual Studio Build Tools
# macOS: 确保安装了 Xcode Command Line Tools
# Linux: 确保安装了 build-essential

# 然后重新编译
npm run rebuild
```

### 3. 依赖安装慢或失败

**问题**：npm install 很慢或超时

**解决**：
```bash
# 使用国内镜像
npm config set registry https://registry.npmmirror.com

# 或使用 cnpm
npm install -g cnpm --registry=https://registry.npmmirror.com
cnpm install
```

### 4. Electron 启动失败

**问题**：运行 `npm run dev` 后 Electron 窗口无法打开

**解决**：
1. 检查 Node.js 版本（推荐 v18+）
2. 确保 TypeScript 编译成功（检查 `build/` 目录）
3. 查看终端错误信息
4. 尝试重新编译：`npm run build`

### 5. 代理配置不生效

**问题**：配置了代理但无法访问外网

**解决**：
1. 检查 `config.yaml` 中的代理配置
2. 确保代理服务（如 Clash、V2Ray）正在运行
3. 在应用内测试网络连接

## 技术栈

- **Electron** ^39.2.1 - 桌面应用框架
- **React** ^18.2.0 - UI 框架
- **TypeScript** ^5.2.2 - 类型安全
- **Ant Design** ^5.11.0 - UI 组件库
- **Vite** ^5.0.0 - 构建工具
- **SQLite3** ^5.1.6 - 本地数据库
- **Sharp** ^0.32.6 - 图片处理
- **Axios** ^1.6.0 - HTTP 客户端

## 鸣谢

本项目在开发过程中参考了以下优秀项目：

- **[Boorusama](https://github.com/khoadng/Boorusama)** - 一个功能强大的 Flutter Booru 客户端，为本项目的 Booru API 对接和功能设计提供了重要参考。特别感谢 [@khoadng](https://github.com/khoadng) 及其贡献者们的优秀工作。

## 许可证

MIT License

---

**最后更新**：2024 年 11 月 19 日
