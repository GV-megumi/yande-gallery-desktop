# UI 优化任务清单

> 基于 [UI 优化方案 v1.0](doc/ui-optimization-proposal.md)

## P0 - 基础设施（必须先完成） ✅

- [x] 1.1 创建样式 Token 体系 (`src/renderer/styles/tokens.ts`)
- [x] 1.2 统一 URL 工具函数 (`src/renderer/utils/url.ts`) — 消除 7 个文件中 ~450 行重复代码
- [x] 1.3 提取 BooruGridLayout 共享组件 (`src/renderer/components/BooruGridLayout.tsx`) — 消除 3 个页面中 ~350 行重复代码

> P0 总计：新增 438 行，删除 716 行，净减 278 行

## P1 - 交互与视觉优化

- [x] 2.1 骨架屏替代 Spin（GalleryPage, BooruPage, BooruFavoritesPage, ImageListWrapper）
- [x] 2.2 图片加载状态优化（fade-in 渐显 + 占位背景 + 错误降级 + 重试按钮）
- [ ] 2.3 配置更新改为事件驱动（消除 BooruPage 2秒轮询）
- [ ] 2.4 搜索体验增强（防抖 + 搜索历史 + 统一宽度）
- [ ] 3.1 全局 inline style 替换为 Token 引用
- [ ] 3.2 统一状态标签组件 StatusTag

## P2 - 组件重构

- [ ] 4.1 提取 PageToolbar 共享组件
- [ ] 4.2 提取 useFavorite Hook
- [ ] 4.3 提取 usePagination Hook
- [ ] 4.4 提取 useSearch Hook（带防抖）
- [ ] 4.5 高频组件 React.memo 优化

## P3 - 暗色模式

- [ ] 5.1 Ant Design 暗色主题切换
- [ ] 5.2 Token 暗色变量扩展
- [ ] 5.3 设置页面添加主题选项
