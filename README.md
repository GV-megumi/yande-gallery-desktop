# Yande Gallery Desktop

一个基于 Electron + React + TypeScript 的桌面应用，用来管理本地图库，并接入多个 Booru 站点进行浏览、搜索、收藏和下载。

## 当前能力

### 本地图库

- 最近图片、全部图片、图集三种浏览模式
- 标签管理、搜索、批量关联
- 缩略图缓存、图片预览、键盘导航
- 多图库与封面管理

### Booru 多站点

- Moebooru、Danbooru、Gelbooru
- 帖子搜索、热门、Pools、标签搜索
- 艺术家、角色、Wiki、论坛、用户主页
- 收藏、收藏分组、保存的搜索、黑名单标签
- 单帖下载、批量下载、缓存管理、备份恢复
- 视频帖子、帖子注释、版本历史、举报、标签别名/关联

### 辅助集成

- Google Drive
- Google Photos Picker
- Google Account
- Gemini

## 快速开始

### 环境要求

- Node.js 18+
- npm 9+
- Python 3
- Git
- Windows 下建议安装 Visual Studio Build Tools（原生模块编译需要）

### 安装与运行

```bash
npm install
npm run dev
```

### 常用命令

```bash
npm run dev
npm run build
npm run test
npm run rebuild
npm run rebuild:sharp
npm run dist
```

## 配置

- `.env` 可通过 `CONFIG_DIR` 指定配置根目录
- `config.yaml` 定义数据库、下载目录、图库目录、缩略图、代理和 Booru 外观设置
- 应用启动时会自动初始化数据库、按配置创建初始图库，并在后台恢复未完成下载
- 路径系统已和运行数据目录解耦，详情见 `doc/开发与配置指南.md`

## 未来规划

以下方向已经进入长期规划，但短期内不会优先推进，预计还需要较长时间才会进入正式实现阶段：

- **自动标签 (AI)**：使用本地模型或外部 API 自动为图片生成标签，辅助本地图库的标签整理与管理。
- **数据统计面板**：补充本地图库与下载任务的统计视图，例如标签分布、文件格式、大小分布，以及按站点 / 日期 / 标签聚合的下载统计。
- **主进程 IPC 模块化**：将当前集中在 `src/main/ipc/handlers.ts` 的大体量注册逻辑拆分为按域组织的子模块，降低跨子系统耦合，让 IPC 运行时测试与后续维护更容易落地。详细规划见 `doc/handlers-ipc-模块化计划概述.md`。

## 文档索引

- `doc/架构总览.md`：当前架构、模块划分、存储布局
- `doc/功能总览.md`：当前功能面
- `doc/开发与配置指南.md`：安装、命令、配置、排错
- `doc/数据库结构文档.md`：数据库结构总览
- `doc/Renderer API 文档.md`：渲染进程 API 总览
- `doc/Booru功能实现文档.md`：Booru 子系统说明
- `doc/图库功能文档.md`：图库子系统说明
- `doc/注意事项/README.md`：设计原因、约束、注意事项索引
- `doc/README.md`：`doc/` 目录内部导航
- `doc/handlers-ipc-模块化计划概述.md`：`handlers.ts` 拆分与 IPC 可测试性增强规划
- `doc/done/`：历史实现记录、归档材料与旧版路线图

## 常见问题

### 原生模块安装或 ABI 不匹配

```bash
npm run rebuild
npm run rebuild:sharp
```

详细说明见 `doc/注意事项/Native模块编译问题.md`。

### 网络请求被拦截或跨域

外部请求应统一走主进程 + IPC，不建议在渲染进程直接请求站点。见 `doc/注意事项/网络访问与CORS解决方案.md`。

### 代理不生效

见 `doc/注意事项/代理配置指南.md`。

## 参考项目

- `Boorusama-master-official/`：Flutter 版 Booru 客户端参考实现

## 许可证

MIT License

---

最后更新：2026-03-18
