# 安装指南

由于npm环境可能存在问题，这里提供手动安装依赖的方法。

## 步骤1：创建基础package.json

确保package.json文件已经创建，内容如下：

```json
{
  "name": "yande-gallery-desktop",
  "version": "1.0.0",
  "description": "Personal Yande.re Gallery Manager",
  "main": "build/main/index.js",
  "type": "module",
  "scripts": {
    "dev": "concurrently \"npm run dev:main\" \"npm run dev:renderer\"",
    "dev:main": "tsc -p tsconfig.main.json --watch",
    "dev:renderer": "vite",
    "build": "npm run build:main && npm run build:renderer",
    "build:main": "tsc -p tsconfig.main.json",
    "build:renderer": "vite build"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@types/node": "^20.0.0",
    "@vitejs/plugin-react": "^4.2.0",
    "concurrently": "^8.2.2",
    "electron": "^27.0.0",
    "typescript": "^5.2.2",
    "vite": "^5.0.0"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "antd": "^5.11.0",
    "@ant-design/icons": "^5.2.0"
  }
}
```

## 步骤2：逐步安装依赖

在终端中执行以下命令：

```bash
# 1. 首先安装TypeScript和Vite
npm install typescript@5.2.2 vite@5.0.0 @vitejs/plugin-react@4.2.0 --save-dev

# 2. 安装Electron和相关工具
npm install electron@27.0.0 concurrently@8.2.2 --save-dev

# 3. 安装React相关依赖
npm install react@18.2.0 react-dom@18.2.0 @types/react@18.2.0 @types/react-dom@18.2.0 --save-dev

# 4. 安装UI组件库
npm install antd@5.11.0 @ant-design/icons@5.2.0

# 5. 安装其他运行时依赖（可选，等基础功能完成后再安装）
npm install sqlite3@5.1.6 sharp@0.32.0 axios@1.6.0 electron-store@8.1.0
```

## 步骤3：测试安装

安装完成后，运行以下命令测试：

```bash
# 编译TypeScript
npm run build:main

# 启动开发服务器
npm run dev
```

## 常见问题解决

### 1. sqlite3安装失败

sqlite3需要编译环境，如果安装失败，可以尝试：

```bash
# 安装windows构建工具
npm install --global windows-build-tools

# 或者使用预编译版本
npm install sqlite3@5.1.6 --build-from-source
```

### 2. sharp安装失败

sharp需要libvips，可以尝试：

```bash
# 清除缓存
npm cache clean --force

# 重新安装
npm install sharp@0.32.0
```

### 3. Electron安装失败

```bash
# 设置Electron镜像（国内用户）
npm config set electron_mirror https://npmmirror.com/mirrors/electron/

# 重新安装
npm install electron@27.0.0
```

## 备用方案：使用Yarn

如果npm始终有问题，可以尝试使用Yarn：

```bash
# 安装Yarn
npm install -g yarn

# 使用Yarn安装依赖
yarn install
```

## 最后方案：手动下载

如果自动安装都不行，可以手动下载预编译的依赖包。

## 开发环境验证

安装完成后，确保可以运行：

```bash
# 应该能看到TypeScript编译输出
npm run build:main

# 应该能启动Vite开发服务器
npm run dev:renderer
```

如果一切正常，就可以开始开发了！

## 下一步

1. 先让基础界面跑起来
2. 逐步添加功能
3. 遇到问题再安装对应的依赖

记住，这是一个渐进式的开发过程，不需要一次安装所有依赖。先让基础框架工作起来最重要。,