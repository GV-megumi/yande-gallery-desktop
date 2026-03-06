# UI 优化任务清单

> 基于 [UI 优化方案 v1.0](doc/ui-optimization-proposal.md)

## P0 - 基础设施（必须先完成） ✅

- [x] 1.1 创建样式 Token 体系 (`src/renderer/styles/tokens.ts`)
- [x] 1.2 统一 URL 工具函数 (`src/renderer/utils/url.ts`) — 消除 7 个文件中 ~450 行重复代码
- [x] 1.3 提取 BooruGridLayout 共享组件 (`src/renderer/components/BooruGridLayout.tsx`) — 消除 3 个页面中 ~350 行重复代码

> P0 总计：新增 438 行，删除 716 行，净减 278 行

## P1 - 交互与视觉优化 ✅

- [x] 2.1 骨架屏替代 Spin（GalleryPage, BooruPage, BooruFavoritesPage, ImageListWrapper）
- [x] 2.2 图片加载状态优化（fade-in 渐显 + 占位背景 + 错误降级 + 重试按钮）
- [x] 2.3 配置更新改为事件驱动（消除 BooruPage 2秒轮询）
- [x] 2.4 搜索体验增强（防抖 hook + 搜索历史下拉 + AutoComplete 集成）
- [x] 3.1 全局 inline style 替换为 Token 引用（ImageGrid, GalleryPage, BooruPage, BooruFavoritesPage, BooruTagSearchPage, BooruImageCard, LazyLoadFooter）
- [x] 3.2 统一状态标签组件 StatusTag（消除 3 处重复的 getStatusTag 逻辑）

## P2 - 组件重构 ✅

- [x] 4.1 提取 BooruPageToolbar 共享组件（消除 3 页面工具栏 ~150 行重复）
- [x] 4.1b 提取 PaginationControl 共享组件（消除 3 页面分页 ~180 行重复）
- [x] 4.2 提取 useFavorite Hook（消除 3 页面 ~120 行重复收藏逻辑）
- [~] 4.3 提取 usePagination Hook — 跳过：各页面分页逻辑差异大，抽象收益低
- [~] 4.4 提取 useSearch Hook（带防抖）— 跳过：搜索模式差异大（标签/文本/混合），抽象收益低
- [x] 4.5 高频组件 React.memo 优化（BooruImageCard, BooruGridLayout, PaginationControl, BooruPageToolbar, ImageGrid）

## P3 - 暗色模式 ✅

- [x] 5.1 Ant Design 暗色主题切换（ConfigProvider + darkAlgorithm）
- [x] 5.2 Token 暗色变量扩展（colors/shadows Proxy 动态切换）
- [x] 5.3 设置页面添加主题选项（Segmented 三态切换：浅色/深色/跟随系统）
