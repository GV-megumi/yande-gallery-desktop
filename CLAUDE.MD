# Yande Gallery Desktop

## 项目简介

Yande Gallery Desktop 是一个基于 Electron + React + TypeScript 的桌面应用，核心目标是同时支持：

- 本地图库管理：扫描、检索、分组、缩略图、预览与标签管理
- Booru 浏览与下载：统一接入 Moebooru、Danbooru、Gelbooru 等站点，支持搜索、收藏、下载、缓存和批量任务

当前仓库的**详细功能、数据库、Renderer API、架构说明**以 `doc/` 目录中的主文档为准；本文件只保留长期稳定、跨任务都适用的开发规范和导航。

## 核心命令

```bash
# 安装依赖
npm install

# 开发
npm run dev

# 测试
npm run test

# 构建
npm run build

# 原生模块重建
npm run rebuild
npm run rebuild:sharp

# 打包
npm run dist
```

如果原生模块安装、ABI 或 Electron 版本不匹配，优先查看：

- `doc/开发与配置指南.md`
- `doc/注意事项/Native模块编译问题.md`

## 架构速览

### 主进程 `src/main/`

- `services/`：数据库、配置、图库扫描、缩略图、下载、缓存、Booru 客户端、Google 相关服务
- `ipc/`：统一 IPC 通道与处理器
- `index.ts`：主进程启动编排
- `window.ts`：主窗口创建和运行时配置

### 渲染进程 `src/renderer/`

- `App.tsx`：主导航、固定页面、主题、快捷键、页面切换
- `pages/`：图库、Booru、Google、设置等页面
- `components/`：图片网格、详情区块、表单、浮层、卡片等复用组件

### 预加载层 `src/preload/`

- 使用 `contextBridge.exposeInMainWorld` 暴露受控 API
- 当前主要分域：`db`、`gallery`、`config`、`image`、`booru`、`bulkDownload`、`window`、`system`、`google`、`gdrive`、`gphotos`

### 共享层 `src/shared/`

- 保存图库、Booru、下载、标签、Google 等共享类型定义

## 开发规范

### 1. 所有外部网络请求必须走主进程

渲染进程不要直接请求外部站点。外部网络访问统一通过主进程 + IPC 执行，以规避 CORS、集中处理代理、认证、错误与限流。

相关文档：

- `doc/注意事项/网络访问与CORS解决方案.md`
- `doc/Booru功能实现文档.md`

### 2. 修改前先看相关代码，不要只改表面

如果修改的是服务、IPC、共享类型、配置或数据库相关逻辑，必须先查看：

- 定义位置
- 调用位置
- 相关类型
- 关联文档

尤其是底层接口变更，要先确认不会破坏已有功能和兼容性。

相关文档：

- `doc/注意事项/代码修改规范.md`

### 3. 共享类型优先放在 `src/shared/types.ts`

涉及主进程 / 渲染进程共同使用的数据结构时，优先放入共享类型层，避免两边各自定义导致漂移。

### 4. 必要的 UI 能力要做成可复用抽象

通用图片列表、详情区块、卡片、搜索栏、分页或懒加载相关能力，优先沉淀成复用组件，而不是在页面里复制实现。

相关文档：

- `doc/注意事项/组件抽象与复用原则.md`

### 5. 配置与运行数据路径不要拍脑袋假设

路径系统由 `CONFIG_DIR`、`config.yaml`、`dataPath` 共同决定。数据库、缓存、缩略图、日志的位置要以当前实现和配置文档为准，不要直接假定都在仓库根目录下。

相关文档：

- `doc/开发与配置指南.md`
- `doc/注意事项/配置路径解析系统.md`
- `doc/注意事项/数据迁移规则.md`

### 6. 数据库结构以 `src/main/services/database.ts` 为准

数据库说明文档是重要参考，但当前真实 schema、兼容迁移和动态补列逻辑，最终以 `src/main/services/database.ts` 为准。涉及字段、约束、索引或迁移判断时，要同时看代码和文档。

相关文档：

- `doc/数据库结构文档.md`

### 7. Renderer API 以 `src/preload/index.ts` 为准

`window.electronAPI` 的实际暴露面以 `src/preload/index.ts` 为 source of truth。做渲染层能力、IPC 对接或页面调用排查时，优先看 preload，而不是只看历史说明。

相关文档：

- `doc/Renderer API 文档.md`

### 8. 改 Booru 能力时先确认站点差异

Moebooru、Danbooru、Gelbooru 的接口形态、认证、标签类型、帖子能力并不完全一致。新增或修改 Booru 相关逻辑时，要先确认是统一层问题、站点适配层问题，还是某个站点专属行为。

开发 Moebooru 相关功能前，优先参考 `Boorusama-master-official/` 的现有实现思路。

相关文档：

- `doc/Booru功能实现文档.md`
- `doc/注意事项/Moebooru开发规范.md`
- `doc/注意事项/API限流与安全约束.md`

### 9. 注释和日志要保留可维护性

复杂逻辑、关键分支、外部请求、文件操作、下载过程、异常处理等位置，应保留清晰注释与带模块前缀的日志，便于后续排查。

相关文档：

- `doc/注意事项/注释与日志输出规范.md`

### 10. 性能问题优先避免反模式

图库和 Booru 页面都涉及大批量图片、懒加载、缓存、下载和列表渲染。遇到性能问题，先确认是否出现了重复渲染、重复请求、一次性加载过多数据、绕过缓存等反模式。

相关文档：

- `doc/注意事项/图库懒加载设计.md`
- `doc/注意事项/性能约束与反模式.md`

### 11. 提交代码时使用中文 commit message

所有 git commit message 统一使用中文撰写，包括标题和正文。类型前缀（如 `feat`、`fix`、`chore` 等）保留英文，但描述部分必须是中文，与仓库已有提交风格保持一致。

## 按任务查文档

- **做项目级判断**：`README.md`、`doc/README.md`、`doc/架构总览.md`、`doc/功能总览.md`
- **改开发环境、路径、配置、启动行为**：`doc/开发与配置指南.md`、`doc/注意事项/配置路径解析系统.md`、`doc/注意事项/数据迁移规则.md`
- **改数据库、表结构、迁移**：`doc/数据库结构文档.md`、`src/main/services/database.ts`
- **改渲染层调用、预加载接口、IPC 对接**：`doc/Renderer API 文档.md`、`src/preload/index.ts`、`src/main/ipc/channels.ts`
- **改本地图库相关能力**：`doc/图库功能文档.md`、`doc/注意事项/图库懒加载设计.md`
- **改 Booru 相关能力**：`doc/Booru功能实现文档.md`、`doc/注意事项/Moebooru开发规范.md`、`doc/注意事项/API限流与安全约束.md`
- **看设计原因、坑点和约束**：`doc/注意事项/README.md`
- **追溯历史实现或旧方案**：`doc/done/README.md`

## 文档导航

- **当前主文档**：`doc/架构总览.md`、`doc/功能总览.md`、`doc/开发与配置指南.md`、`doc/数据库结构文档.md`、`doc/Renderer API 文档.md`、`doc/Booru功能实现文档.md`、`doc/图库功能文档.md`
- **专题注意事项**：`doc/注意事项/README.md`
- **历史归档**：`doc/done/README.md`

## 说明

- 如果 `CLAUDE.MD` 与 `doc/` 中的当前主文档存在细节冲突，优先以 `doc/` 和实际代码为准。
- 如果 `doc/` 与实现不一致，优先以代码为准，并在修改后同步更新对应文档。
