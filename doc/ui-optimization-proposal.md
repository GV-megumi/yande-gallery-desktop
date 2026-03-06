# UI 优化方案 v1.0

> 创建日期：2026-03-06
> 状态：待评审

---

## 一、当前问题概览

| 问题类别 | 严重程度 | 说明 |
|---------|---------|------|
| 代码重复 | 🔴 高 | Grid 布局、URL 处理、收藏逻辑在 3-5 个页面重复实现（800+ 行） |
| 样式散乱 | 🔴 高 | 700+ 处 inline style，颜色/间距/阴影硬编码，无法统一修改 |
| 视觉一致性 | 🟡 中 | 不同页面搜索栏宽度、间距、阴影值不统一 |
| 响应式缺失 | 🟡 中 | 固定宽度散落各处（200px/300px/400px），移动端不友好 |
| 交互体验 | 🟡 中 | 缺少骨架屏、错误边界、加载反馈；配置轮询（2秒）导致性能浪费 |
| 状态管理 | 🟡 中 | 收藏状态、搜索状态在多个页面各自维护，不同步 |
| 暗色模式 | 🔵 低 | 颜色全部硬编码，无法支持暗色主题 |

### 详细问题分析

#### 1. 代码重复（800+ 行）

**Grid 布局**：BooruPage、BooruFavoritesPage、BooruTagSearchPage 三个页面各自实现了完整的网格布局逻辑，包括动态行高计算、容器宽度监听、图片排列等。

**URL 转换**：`getImageUrl()` 和 `getPreviewUrl()` 分别在以下文件中重复实现：
- `GalleryPage.tsx`
- `BooruPage.tsx`
- `BooruDownloadPage.tsx`
- `BooruFavoritesPage.tsx`
- 多处行内转换

**收藏逻辑**：收藏切换、收藏状态查询在 BooruPage、BooruFavoritesPage、BooruTagSearchPage 重复实现。

#### 2. 样式散乱

- **阴影值**：`0 2px 8px rgba(0,0,0,0.1)` 在 15+ 处重复硬编码
- **圆角值**：`borderRadius: 8` 在各处独立定义
- **颜色值**：`#1890ff`、`#666`、`#999` 散落各文件
- **间距值**：16px 和 24px 混用，无统一规范

#### 3. 交互体验不足

- **加载状态**：所有页面使用 `<Spin>` 居中旋转，缺少骨架屏
- **图片错误**：加载失败静默无反馈，无重试机制
- **配置轮询**：BooruPage 每 2 秒轮询外观配置，浪费性能
- **搜索体验**：无防抖、无搜索历史下拉

---

## 二、优化方案

### Phase 1：基础设施层（样式与工具统一）

#### 1.1 建立统一样式 Token 体系

创建 `src/renderer/styles/tokens.ts`，集中管理所有设计变量：

```typescript
/** 颜色 Token */
export const colors = {
  // 品牌色
  primary: '#1890ff',
  primaryHover: '#40a9ff',
  primaryActive: '#096dd9',

  // 功能色
  success: '#52c41a',
  warning: '#faad14',
  danger: '#ff4d4f',
  info: '#1890ff',

  // 文本色
  textPrimary: 'rgba(0, 0, 0, 0.85)',
  textSecondary: 'rgba(0, 0, 0, 0.45)',
  textDisabled: 'rgba(0, 0, 0, 0.25)',

  // 背景色
  bgBase: '#ffffff',
  bgLight: '#f5f5f5',
  bgGray: '#fafafa',

  // 边框色
  border: '#f0f0f0',
  borderLight: '#e8e8e8',

  // 评分色（Booru 特有）
  ratingSafe: '#52c41a',
  ratingQuestionable: '#faad14',
  ratingExplicit: '#ff4d4f',
};

/** 间距 Token（4px 基准） */
export const spacing = {
  xs: 4,    // 紧凑间距
  sm: 8,    // 小间距（图标与文字）
  md: 12,   // 中间距（表单元素间）
  lg: 16,   // 大间距（卡片内边距、列表项间）
  xl: 24,   // 页面内边距、区块间
  xxl: 32,  // 大区块间距
};

/** 阴影 Token */
export const shadows = {
  card: '0 2px 8px rgba(0, 0, 0, 0.08)',
  cardHover: '0 4px 16px rgba(0, 0, 0, 0.12)',
  toolbar: '0 2px 8px rgba(0, 0, 0, 0.10)',
  dropdown: '0 6px 16px rgba(0, 0, 0, 0.08)',
  modal: '0 8px 24px rgba(0, 0, 0, 0.15)',
};

/** 圆角 Token */
export const radius = {
  sm: 4,    // 按钮、标签
  md: 8,    // 卡片、输入框
  lg: 12,   // 大卡片、弹窗
  round: 999, // 圆形
};

/** 过渡动画 Token */
export const transitions = {
  fast: 'all 0.15s ease',
  normal: 'all 0.2s ease',
  slow: 'all 0.3s ease',
};

/** 布局 Token */
export const layout = {
  sidebarWidth: 200,
  toolbarHeight: 56,
  contentPadding: 24,
  gridGap: 16,
  pageMaxWidth: 1400,
};

/** 断点 Token */
export const breakpoints = {
  xs: 480,
  sm: 576,
  md: 768,
  lg: 992,
  xl: 1200,
  xxl: 1600,
};
```

#### 1.2 统一 URL 工具函数

创建 `src/renderer/utils/url.ts`，合并当前散落在 5 个文件中的路径转换逻辑：

```typescript
/**
 * 将本地文件路径转换为 app:// 协议 URL
 * 合并自 GalleryPage、BooruPage、BooruDownloadPage、BooruFavoritesPage
 */
export function localPathToAppUrl(filePath: string): string;

/**
 * 获取 Booru 图片预览 URL
 * 根据配置质量选择 preview_url / sample_url / file_url
 */
export function getBooruPreviewUrl(post: any, quality?: string): string;

/**
 * 获取 Booru 图片完整 URL
 */
export function getBooruFileUrl(post: any): string;
```

#### 1.3 提取共享 BooruGridLayout 组件

从 BooruPage / BooruFavoritesPage / BooruTagSearchPage 提取通用网格布局：

```typescript
interface BooruGridLayoutProps {
  posts: BooruPost[];
  gridSize?: number;        // 默认 330
  spacing?: number;         // 默认 16
  borderRadius?: number;    // 默认 8
  onPostClick?: (post: BooruPost) => void;
  onFavoriteToggle?: (post: BooruPost) => void;
  onDownload?: (post: BooruPost) => void;
  renderCard?: (post: BooruPost) => ReactNode;  // 自定义卡片渲染
}
```

**预期消除重复代码**：~800 行

---

### Phase 2：交互体验优化

#### 2.1 骨架屏替代 Spin

**现状**：所有加载状态使用 `<Spin>` 居中旋转，页面内容区完全空白。

**优化**：使用 Ant Design `<Skeleton>` 组件，按卡片/列表形态展示骨架：

```
加载中效果（图片网格）：
┌─────────┐ ┌─────────┐ ┌─────────┐
│ ░░░░░░░ │ │ ░░░░░░░ │ │ ░░░░░░░ │
│ ░░░░░░░ │ │ ░░░░░░░ │ │ ░░░░░░░ │
│ ░░░     │ │ ░░░     │ │ ░░░     │
└─────────┘ └─────────┘ └─────────┘

加载中效果（列表/表格）：
┌──────────────────────────────────┐
│ ░░░░░░  ░░░░░░░░░  ░░░  ░░░░░ │
│ ░░░░░░  ░░░░░░░░░  ░░░  ░░░░░ │
│ ░░░░░░  ░░░░░░░░░  ░░░  ░░░░░ │
└──────────────────────────────────┘
```

涉及页面：GalleryPage、BooruPage、BooruFavoritesPage、BooruDownloadPage

#### 2.2 图片加载状态优化

**加载中**：
- 显示低对比度的占位背景（浅灰色 + Skeleton.Image）
- 图片加载完成后 fade-in 渐显（`opacity: 0 → 1`，`transition: opacity 0.3s`）

**加载失败**：
- 显示占位图 + 错误图标
- 提供「重试」按钮
- 当前：失败后静默无反馈

**空状态**：
- 优化 Empty 组件样式，加入引导性文案和操作按钮
- 不同场景使用不同文案（"暂无图片" / "搜索无结果" / "收藏夹为空"）

#### 2.3 配置更新机制优化

**现状**：BooruPage 每 2 秒调用 `window.electronAPI.booru.getAppearanceConfig()` 轮询配置。

**优化方案**：改为事件驱动
- 主进程：配置变更时通过 IPC 发送 `config:changed` 事件
- 渲染进程：监听事件更新状态
- 消除定时器轮询，减少不必要的渲染

#### 2.4 搜索体验增强

- **防抖**：添加 300ms debounce，避免每次按键触发请求
- **Loading**：搜索时输入框显示加载指示
- **搜索历史**：下拉显示最近搜索记录（已有后端 `search_history` 表支持）
- **统一宽度**：所有搜索栏统一响应式宽度（最小 200px，最大 500px）
- **快捷键**：`Ctrl+K` / `Cmd+K` 聚焦搜索栏

#### 2.5 状态反馈增强

- **操作成功**：使用 `message.success()` 统一提示
- **操作失败**：使用 `message.error()` 并提供重试建议
- **危险操作**：使用 `Popconfirm` 二次确认（统一样式和文案）
- **网络异常**：显示全局 Banner 提示网络状态

---

### Phase 3：视觉设计统一

#### 3.1 页面布局规范

```
┌──────────────────────────────────────────────┐
│  Sidebar (200px)    │  Content Area           │
│                     │                         │
│  ┌───────────────┐  │  ┌───────────────────┐  │
│  │ 📷 图库       │  │  │ 工具栏 (Affix)     │  │
│  │   最近图片    │  │  │ 搜索 + 筛选控制    │  │
│  │   全部图片    │  │  │ 高度: 56px         │  │
│  │   图集        │  │  ├───────────────────┤  │
│  ├───────────────┤  │  │                   │  │
│  │ 🌐 Booru     │  │  │  内容区域          │  │
│  │   浏览        │  │  │  padding: 24px     │  │
│  │   收藏        │  │  │  (Grid / List)     │  │
│  │   标签搜索    │  │  │                   │  │
│  │   下载管理    │  │  │                   │  │
│  │   批量下载    │  │  ├───────────────────┤  │
│  │   设置        │  │  │ 分页器 / 加载更多  │  │
│  ├───────────────┤  │  └───────────────────┘  │
│  │ ⚙ 设置       │  │                         │
│  └───────────────┘  │                         │
└──────────────────────────────────────────────┘
```

**统一规范**：
- 内容区域 padding: `spacing.xl`（24px）
- 工具栏高度: `layout.toolbarHeight`（56px），底部阴影: `shadows.toolbar`
- 卡片间距: `spacing.lg`（16px）
- 圆角统一: `radius.md`（8px）
- 页面标题: Ant Design `Title level={4}`，底部 margin 16px

#### 3.2 卡片样式规范

**所有卡片**（图库卡片 / Booru 卡片 / 下载卡片 / 会话卡片）统一样式基础：

```typescript
const cardStyle = {
  borderRadius: radius.md,           // 8px
  boxShadow: shadows.card,           // 默认阴影
  transition: transitions.normal,     // 0.2s ease
  overflow: 'hidden',
};

const cardHoverStyle = {
  boxShadow: shadows.cardHover,      // 增强阴影
  transform: 'translateY(-2px)',      // 微上浮
};
```

#### 3.3 颜色语义化替换

| 用途 | 当前写法 | 优化后 |
|-----|---------|--------|
| 主操作按钮/链接 | `color: '#1890ff'` 硬编码 | `colors.primary` |
| 辅助文字 | `#666` / `#999` 混用 | `colors.textSecondary` |
| 卡片阴影 | `'0 2px 8px rgba(0,0,0,0.1)'` × 15处 | `shadows.card` |
| 危险操作 | `'#ff4d4f'` 硬编码 | `colors.danger` |
| 背景色 | `'#f0f0f0'` / `'#f5f5f5'` 混用 | `colors.bgLight` |
| 边框色 | `'#e8e8e8'` / `'#f0f0f0'` 混用 | `colors.border` |

#### 3.4 状态标签统一

定义统一的状态颜色映射，替代各页面独立维护：

| 状态 | 颜色 | 用于 |
|------|------|------|
| pending | `default` | 下载队列、批量下载 |
| downloading / running | `processing` | 下载中、任务运行中 |
| paused | `warning` | 暂停的下载/任务 |
| completed | `success` | 完成的下载/任务 |
| failed | `error` | 失败的下载/任务 |
| cancelled | `default` | 已取消的任务 |

---

### Phase 4：组件重构

#### 4.1 新增共享组件

| 组件 | 说明 | 替代 |
|------|------|------|
| `BooruGridLayout` | Booru 图片网格布局 | 替代 3 个页面中重复的网格实现 |
| `PageToolbar` | 页面工具栏（Affix + 搜索 + 筛选） | 统一 BooruPage/FavoritesPage/TagSearchPage 的工具栏 |
| `ImageFallback` | 图片加载失败的降级组件 | 替代当前静默失败的行为 |
| `StatusTag` | 统一状态标签 | 替代各处硬编码的 Tag 颜色映射 |
| `SkeletonGrid` | 网格骨架屏 | 替代 Spin 加载状态 |

#### 4.2 提取自定义 Hook

```typescript
/** 收藏管理 Hook */
function useFavorite(siteId: number, postId: number) {
  return { isFavorited, toggleFavorite, loading };
}

/** 分页/无限滚动 Hook */
function usePagination<T>(fetchFn: FetchFunction<T>) {
  return { data, page, pageSize, total, goTo, hasMore, loadMore, loading };
}

/** 搜索 Hook（带防抖和历史） */
function useSearch(options: SearchOptions) {
  return { keyword, setKeyword, results, loading, history, clearHistory };
}

/** Booru 外观配置 Hook（事件驱动） */
function useBooruAppearance() {
  return { gridSize, spacing, borderRadius, previewQuality, pageMode };
}
```

#### 4.3 组件 Memo 优化

为以下高频渲染组件添加 `React.memo`：
- `BooruImageCard` — 列表项，父级重渲染时不应重复渲染
- `BooruGridLayout` — 大量子元素的容器
- `GalleryCoverImage` — 图集列表项
- `StatusTag` — 纯展示组件

---

### Phase 5：暗色模式支持（可选）

#### 5.1 Ant Design 主题切换

利用 Ant Design 5.x 内置的暗色算法：

```typescript
import { theme } from 'antd';

<ConfigProvider
  theme={{
    algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: '#1890ff',
    },
  }}
>
  <App />
</ConfigProvider>
```

#### 5.2 自定义元素暗色适配

Token 体系中增加暗色变量，通过 CSS 变量或条件选择：

```typescript
const darkColors = {
  textPrimary: 'rgba(255, 255, 255, 0.85)',
  textSecondary: 'rgba(255, 255, 255, 0.45)',
  bgBase: '#141414',
  bgLight: '#1f1f1f',
  border: '#303030',
};
```

#### 5.3 设置页面添加主题切换

在 SettingsPage 添加「外观主题」选项：
- 跟随系统 / 浅色 / 深色
- 存储到 `config.yaml` 中

---

## 三、优先级与执行顺序

| 优先级 | 阶段 | 改动范围 | 风险 | 依赖 |
|-------|------|---------|------|------|
| **P0** | 1.1 样式 Token 体系 | 新增 `tokens.ts` + 全局替换 inline style 引用 | 低 | 无 |
| **P0** | 1.2 URL 工具统一 | 新增 `url.ts` + 替换 5 个文件中的重复函数 | 低 | 无 |
| **P0** | 1.3 提取 BooruGridLayout | 新增组件 + 重构 3 个页面 | 中 | 无 |
| **P1** | 2.1 骨架屏 | 改动 5-6 个页面的 loading 状态 | 低 | 无 |
| **P1** | 2.2 图片加载优化 | 改动 ImageGrid、BooruImageCard | 低 | 无 |
| **P1** | 2.3 配置事件驱动 | 改动主进程 config + BooruPage | 中 | 无 |
| **P1** | 2.4 搜索增强 | 改动 ImageSearchBar + 各页面搜索逻辑 | 低 | 无 |
| **P1** | 3.1-3.4 视觉统一 | 全局替换 inline style 为 Token 引用 | 低 | Phase 1.1 |
| **P2** | 4.1 共享组件提取 | 新增 4-5 个组件 | 中 | Phase 1 |
| **P2** | 4.2 Hook 提取 | 新增 4 个 Hook + 重构页面引用 | 中 | Phase 1 |
| **P2** | 4.3 Memo 优化 | 包裹 4-5 个组件 | 低 | 无 |
| **P3** | 5.1-5.3 暗色模式 | ConfigProvider + Token 扩展 + 设置页面 | 中 | Phase 1 + 3 |

---

## 四、文件变更清单（预估）

### 新增文件

```
src/renderer/
├── styles/
│   └── tokens.ts                    # 设计 Token 常量
├── utils/
│   └── url.ts                       # URL 工具函数（合并）
├── components/
│   ├── BooruGridLayout.tsx          # Booru 网格布局（提取）
│   ├── PageToolbar.tsx              # 页面工具栏（提取）
│   ├── ImageFallback.tsx            # 图片降级组件
│   ├── StatusTag.tsx                # 统一状态标签
│   └── SkeletonGrid.tsx            # 网格骨架屏
├── hooks/
│   ├── useFavorite.ts              # 收藏管理
│   ├── usePagination.ts            # 分页管理
│   ├── useSearch.ts                # 搜索管理
│   └── useBooruAppearance.ts       # 外观配置
```

### 修改文件

```
src/renderer/
├── App.tsx                          # 主题 ConfigProvider
├── pages/
│   ├── GalleryPage.tsx             # Token 替换 + 骨架屏 + URL 工具
│   ├── BooruPage.tsx               # GridLayout 提取 + Token + 事件驱动
│   ├── BooruFavoritesPage.tsx      # GridLayout 提取 + Token + Hook
│   ├── BooruTagSearchPage.tsx      # GridLayout 提取 + Token + Hook
│   ├── BooruDownloadPage.tsx       # Token 替换 + URL 工具 + 骨架屏
│   ├── BooruBulkDownloadPage.tsx   # Token 替换 + StatusTag
│   ├── BooruPostDetailsPage.tsx    # Token 替换
│   ├── BooruSettingsPage.tsx       # 主题切换选项（Phase 5）
│   └── SettingsPage.tsx            # 主题切换选项（Phase 5）
├── components/
│   ├── ImageGrid.tsx               # Token 替换 + 图片加载优化
│   ├── ImageSearchBar.tsx          # 搜索增强（防抖/历史）
│   ├── BooruImageCard.tsx          # Token + ImageFallback + URL 工具
│   ├── BulkDownloadSessionCard.tsx # Token + StatusTag
│   └── LazyLoadFooter.tsx          # Token 替换
```

---

## 五、注意事项

1. **向后兼容**：所有重构保持现有功能不变，Token 替换为纯视觉等价替换
2. **逐步迁移**：不一次性替换所有 inline style，按页面逐步迁移
3. **回归测试**：每个 Phase 完成后进行完整功能回归
4. **Git 分支**：建议每个 Phase 使用独立分支开发，完成后合并
5. **性能基线**：重构前后对比页面加载时间、内存占用
