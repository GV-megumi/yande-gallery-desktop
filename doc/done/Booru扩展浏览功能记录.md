# Booru 扩展浏览功能记录

更新时间：2026-03-15

本文档记录近期补充完成的 4 个 Booru 扩展浏览能力：Wiki 页面、论坛浏览、用户主页、角色页面状态校正。

---

## 1. Wiki 页面浏览

### 完成情况

- 已新增 `src/renderer/pages/BooruWikiPage.tsx`
- 已新增主进程 / IPC / preload 全链路支持
- 当前优先支持 Danbooru Wiki API
- Moebooru / Gelbooru 暂返回“不支持”，前端有明确提示

### 已实现能力

- 从标签搜索页进入 Wiki 页面
- 读取 Wiki 标题、正文、别名、更新时间
- 支持基础正文浏览
- 支持基础链接解析：
  - `[[wiki]]`
  - `{{tag}}`
  - 普通 URL
- 支持浏览器打开原始 Wiki 页面
- 支持切回标签搜索

### 相关文件

- `src/renderer/pages/BooruWikiPage.tsx`
- `src/main/services/booruClientInterface.ts`
- `src/main/services/danbooruClient.ts`
- `src/main/ipc/channels.ts`
- `src/main/ipc/handlers.ts`
- `src/preload/index.ts`

### 后续可增强

- 更完整的 DText / HTML 渲染
- 站内链接样式优化
- 支持更多站点的 Wiki API

---

## 2. 论坛浏览

### 完成情况

- 已新增 `src/renderer/pages/BooruForumPage.tsx`
- 已新增论坛主题和论坛帖子读取接口
- 当前仅 Danbooru 支持论坛浏览

### 已实现能力

- 浏览论坛主题列表
- 点击查看主题帖子列表
- 支持分页
- 支持刷新
- 支持只读查看帖子正文
- 支持基础 URL 链接化
- 支持从论坛主题 / 帖子中的用户 ID 进入用户主页

### 相关文件

- `src/renderer/pages/BooruForumPage.tsx`
- `src/main/services/danbooruClient.ts`
- `src/main/ipc/channels.ts`
- `src/main/ipc/handlers.ts`
- `src/preload/index.ts`
- `src/shared/types.ts`

### 后续可增强

- 论坛帖子投票
- 用户名展示替代纯 ID 展示
- 更完整的正文格式渲染
- 论坛搜索 / 分类过滤

---

## 3. 用户主页

### 完成情况

- 已新增 `src/renderer/pages/BooruUserPage.tsx`
- 已加入 Booru 菜单入口 `用户主页`
- 当前优先支持 Danbooru 用户资料 API

### 已实现能力

- 查看当前登录用户主页
- 按 `userId` / `username` 查看指定用户主页
- 展示基础资料：
  - 用户 ID
  - 用户名
  - 等级
  - 注册时间
- 展示基础统计：
  - 上传帖子数
  - 帖子编辑数
  - Note 编辑数
  - 评论数
  - 论坛发帖数
  - 收藏数
  - 反馈数
- 支持快速跳转到 `user:username` 上传搜索

### 相关文件

- `src/renderer/pages/BooruUserPage.tsx`
- `src/renderer/App.tsx`
- `src/main/services/danbooruClient.ts`
- `src/main/ipc/channels.ts`
- `src/main/ipc/handlers.ts`
- `src/preload/index.ts`
- `src/shared/types.ts`

### 后续可增强

- 用户上传列表内嵌展示
- 用户收藏列表聚合展示
- 用户历史名称 / Feedback 详情
- 从评论区、收藏用户列表等位置直接跳转用户主页

---

## 4. 角色页面状态校正

### 说明

`todo.md` 中原先将“角色页面”记为未完成，但代码中实际上已经存在并可用：

- `src/renderer/pages/BooruCharacterPage.tsx`

因此本次已同步修正文档状态，避免后续重复开发。

---

## 5. 验证结果

本批功能完成后已执行：

- `npm run build` 通过
- `npm test -- tests/main/services/danbooruClient.test.ts` 通过

测试覆盖已包含新增的 Danbooru 论坛与用户主页基础行为兜底。
