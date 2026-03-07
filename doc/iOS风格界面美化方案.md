# iOS 风格界面美化方案

> 以 Apple iOS/iPadOS 的设计语言为蓝本，对 Yande Gallery Desktop 进行全面的视觉升级。
> 目标：从"功能可用的工具软件"蜕变为"精致、现代、令人愉悦的桌面应用"。

---

## 一、iOS 设计哲学核心原则

### 1.1 我们要借鉴的 iOS 核心理念

| 原则 | 含义 | 在本项目中的体现 |
|------|------|-----------------|
| **清晰 (Clarity)** | 内容优先，UI 元素退到幕后 | 图片是主角，工具栏/侧边栏应极简化 |
| **遵从 (Deference)** | 界面服务于内容，不喧宾夺主 | 大面积留白、半透明毛玻璃、浅色边框 |
| **深度 (Depth)** | 通过层次和动效创造空间感 | 多层背景、悬浮卡片、微妙阴影、弹性动画 |
| **一致性 (Consistency)** | 统一的控件样式和交互模式 | 圆角统一、间距规律、动画曲线一致 |
| **直接操控 (Direct Manipulation)** | 用户感觉在直接触碰内容 | 图片卡片的悬停反馈、平滑过渡 |

### 1.2 iOS 视觉特征提炼

```
┌─────────────────────────────────────────────────┐
│  ● 大圆角 (16-20px)                              │
│  ● 毛玻璃/半透明背景 (backdrop-filter: blur)      │
│  ● SF Pro 风格字体层级 (粗标题 + 细正文)           │
│  ● 系统级蓝色 (#007AFF) 作为强调色                 │
│  ● 极简线条，几乎不用实线边框                      │
│  ● 大量留白，内容呼吸感                            │
│  ● 微妙的阴影代替边框                              │
│  ● 分组卡片 (Grouped Inset Style)                 │
│  ● 弹性动画 (spring animation)                    │
│  ● 明暗模式下的自适应颜色                          │
│  ● 搜索栏：圆角胶囊形、居中占位文字                │
│  ● 导航栏：大标题 → 小标题的滚动过渡               │
└─────────────────────────────────────────────────┘
```

---

## 二、当前界面问题诊断

### 2.1 整体问题

| 问题 | 现状 | iOS 标准 |
|------|------|----------|
| **圆角偏小** | radius: 4-8px 为主 | iOS 统一使用 12-20px 大圆角 |
| **间距过密** | spacing 最大 32px，组件间距 12-16px | iOS 偏好 20-24px 以上的宽松间距 |
| **阴影扁平** | 单层薄阴影 `0 2px 8px` | iOS 使用多层阴影创造立体感 |
| **色彩单调** | 主色 #1890ff (Ant Design 蓝) | iOS 蓝 #007AFF 更鲜明，辅色更丰富 |
| **字体层级弱** | 11-24px，差异不大 | iOS 使用 34px 大标题 + 13px 正文形成强对比 |
| **背景缺乏层次** | 纯白/纯黑背景 | iOS 使用灰白分层 + 毛玻璃叠加 |
| **工具栏生硬** | 实色背景 + 方角 | iOS 偏好半透明毛玻璃 + 大圆角 |
| **侧边栏传统** | 标准 Ant Design Menu 样式 | iPadOS 使用圆角选中指示器 + 图标色彩 |
| **卡片缺少质感** | 薄边框或薄阴影 | iOS 卡片有明显的浮起感 + 圆润质感 |
| **动画缺失** | 仅 CSS transition | iOS 大量使用 spring 弹性动画 |

### 2.2 各模块具体问题

#### 侧边栏 (Sider)
- Menu 项无圆角选中态背景
- 图标无色彩区分
- 主菜单与子菜单分隔线生硬
- 缺乏 App 标志/品牌感

#### 顶部标题栏 (Header)
- 仅显示标题文字，信息密度低
- 高度固定 64px 偏矮
- 未利用滚动联动效果

#### 图片浏览（瀑布流/网格）
- 图片卡片圆角小 (8px)
- 缩略图缺少加载动画
- 信息叠加层设计简单

#### Booru 工具栏
- 元素排列拥挤
- 搜索框样式标准
- 分级筛选 (Segmented) 样式普通

#### 设置页面
- 表单布局紧凑
- 缺乏分组卡片风格
- 按钮样式普通

---

## 三、Token 体系升级方案

### 3.1 色彩体系 —— 从 Ant Design 蓝到 iOS 系统色

```typescript
// ============================================================
// 新色彩体系：iOS 系统色 + 自定义扩展
// ============================================================

const lightColors = {
  // === 品牌色 (iOS Blue) ===
  primary: '#007AFF',
  primaryHover: '#0A84FF',
  primaryActive: '#0060CC',
  primaryBg: 'rgba(0, 122, 255, 0.08)',
  primaryBgHover: 'rgba(0, 122, 255, 0.12)',

  // === iOS 系统功能色 ===
  success: '#34C759',       // iOS Green
  successBg: 'rgba(52, 199, 89, 0.08)',
  warning: '#FF9500',       // iOS Orange
  warningBg: 'rgba(255, 149, 0, 0.08)',
  danger: '#FF3B30',        // iOS Red
  dangerBg: 'rgba(255, 59, 48, 0.08)',
  info: '#5AC8FA',          // iOS Teal
  purple: '#AF52DE',        // iOS Purple（收藏标签用）
  pink: '#FF2D55',          // iOS Pink（收藏心形用）
  indigo: '#5856D6',        // iOS Indigo

  // === 文本色（iOS 标准灰度层级）===
  textPrimary: '#000000',                    // 纯黑标题
  textSecondary: '#3C3C43',                  // 副标题 (60% opacity in practice)
  textTertiary: 'rgba(60, 60, 67, 0.60)',    // 辅助文字
  textQuaternary: 'rgba(60, 60, 67, 0.30)',  // 占位/禁用
  textLink: '#007AFF',                       // 链接色

  // === 背景色（iOS 三层灰白体系）===
  bgPrimary: '#FFFFFF',             // 第一层：卡片/内容面
  bgSecondary: '#F2F2F7',           // 第二层：页面底色（iOS 经典灰白）
  bgTertiary: '#E5E5EA',            // 第三层：嵌套区域/分割
  bgElevated: '#FFFFFF',            // 浮起面（弹窗、下拉）
  bgGrouped: '#F2F2F7',             // 分组背景（设置页）
  bgGroupedSecondary: '#FFFFFF',    // 分组内卡片

  // === 分隔与边框 ===
  separator: 'rgba(60, 60, 67, 0.12)',      // iOS 标准分隔线
  separatorOpaque: '#C6C6C8',               // 不透明分隔线
  border: 'rgba(0, 0, 0, 0.06)',            // 极淡边框
  borderCard: 'rgba(0, 0, 0, 0.04)',        // 卡片边框（几乎不可见）

  // === 叠加层 ===
  overlayUltraThin: 'rgba(0, 0, 0, 0.02)',
  overlayThin: 'rgba(0, 0, 0, 0.04)',
  overlayRegular: 'rgba(0, 0, 0, 0.15)',
  overlayThick: 'rgba(0, 0, 0, 0.40)',
  overlayBlur: 'rgba(255, 255, 255, 0.72)',  // 毛玻璃背景

  // === 材质 (Materials) — 毛玻璃效果 ===
  materialUltraThin: 'rgba(255, 255, 255, 0.30)',
  materialThin: 'rgba(255, 255, 255, 0.50)',
  materialRegular: 'rgba(255, 255, 255, 0.72)',
  materialThick: 'rgba(255, 255, 255, 0.85)',

  // === Booru 评分色（iOS 风格化）===
  ratingSafe: '#34C759',
  ratingQuestionable: '#FF9500',
  ratingExplicit: '#FF3B30',
};

const darkColors = {
  // === 品牌色 (iOS Dark Blue) ===
  primary: '#0A84FF',
  primaryHover: '#409CFF',
  primaryActive: '#0064D2',
  primaryBg: 'rgba(10, 132, 255, 0.12)',
  primaryBgHover: 'rgba(10, 132, 255, 0.18)',

  // === iOS Dark 功能色 ===
  success: '#30D158',
  successBg: 'rgba(48, 209, 88, 0.12)',
  warning: '#FF9F0A',
  warningBg: 'rgba(255, 159, 10, 0.12)',
  danger: '#FF453A',
  dangerBg: 'rgba(255, 69, 58, 0.12)',
  info: '#64D2FF',
  purple: '#BF5AF2',
  pink: '#FF375F',
  indigo: '#5E5CE6',

  // === 文本色 ===
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(235, 235, 245, 0.60)',
  textTertiary: 'rgba(235, 235, 245, 0.30)',
  textQuaternary: 'rgba(235, 235, 245, 0.18)',
  textLink: '#0A84FF',

  // === 背景色（iOS Dark 三层体系）===
  bgPrimary: '#1C1C1E',
  bgSecondary: '#000000',
  bgTertiary: '#2C2C2E',
  bgElevated: '#2C2C2E',
  bgGrouped: '#000000',
  bgGroupedSecondary: '#1C1C1E',

  // === 分隔与边框 ===
  separator: 'rgba(84, 84, 88, 0.65)',
  separatorOpaque: '#38383A',
  border: 'rgba(255, 255, 255, 0.08)',
  borderCard: 'rgba(255, 255, 255, 0.06)',

  // === 叠加层 ===
  overlayUltraThin: 'rgba(255, 255, 255, 0.02)',
  overlayThin: 'rgba(255, 255, 255, 0.04)',
  overlayRegular: 'rgba(0, 0, 0, 0.30)',
  overlayThick: 'rgba(0, 0, 0, 0.55)',
  overlayBlur: 'rgba(30, 30, 30, 0.72)',

  // === 材质 ===
  materialUltraThin: 'rgba(45, 45, 45, 0.30)',
  materialThin: 'rgba(45, 45, 45, 0.50)',
  materialRegular: 'rgba(45, 45, 45, 0.72)',
  materialThick: 'rgba(45, 45, 45, 0.85)',

  // === Booru 评分色 ===
  ratingSafe: '#30D158',
  ratingQuestionable: '#FF9F0A',
  ratingExplicit: '#FF453A',
};
```

### 3.2 圆角体系 —— 全面增大

```typescript
export const radius = {
  xs: 6,        // 小标签、小按钮 (原 4)
  sm: 10,       // 输入框、小卡片 (原 4)
  md: 14,       // 标准卡片、对话框 (原 8)
  lg: 20,       // 大卡片、工具栏 (原 12)
  xl: 28,       // 特大卡片 (原 16)
  pill: 9999,   // 胶囊形 (搜索框、标签)
  round: '50%', // 圆形 (头像)
} as const;
```

### 3.3 阴影体系 —— 多层立体感

```typescript
// iOS 风格多层阴影（light 模式）
const lightShadows = {
  /** 微浮起 — 列表行 hover */
  xs: '0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.02)',
  /** 小浮起 — 卡片默认态 */
  sm: '0 1px 3px rgba(0, 0, 0, 0.06), 0 2px 8px rgba(0, 0, 0, 0.04)',
  /** 中浮起 — 卡片悬停态 */
  md: '0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04)',
  /** 大浮起 — 工具栏、Popover */
  lg: '0 8px 28px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.04)',
  /** 超大浮起 — Modal、Dropdown */
  xl: '0 16px 48px rgba(0, 0, 0, 0.16), 0 4px 16px rgba(0, 0, 0, 0.06)',
  /** 内阴影 — 输入框 focus */
  inset: 'inset 0 0 0 3.5px rgba(0, 122, 255, 0.30)',
  /** 无阴影 */
  none: 'none',
};

// Dark 模式阴影（更深沉）
const darkShadows = {
  xs: '0 1px 2px rgba(0, 0, 0, 0.20)',
  sm: '0 1px 3px rgba(0, 0, 0, 0.30), 0 2px 8px rgba(0, 0, 0, 0.15)',
  md: '0 4px 12px rgba(0, 0, 0, 0.35), 0 2px 4px rgba(0, 0, 0, 0.20)',
  lg: '0 8px 28px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.20)',
  xl: '0 16px 48px rgba(0, 0, 0, 0.55), 0 4px 16px rgba(0, 0, 0, 0.25)',
  inset: 'inset 0 0 0 3.5px rgba(10, 132, 255, 0.40)',
  none: 'none',
};
```

### 3.4 间距体系 —— 更宽松

```typescript
export const spacing = {
  '2xs': 2,     // 微小间距
  xs: 4,        // 紧凑间距
  sm: 8,        // 小间距
  md: 12,       // 中间距（保持）
  lg: 16,       // 大间距
  xl: 20,       // 加大（原 24，更贴近 iOS）
  '2xl': 24,    // 段间距
  '3xl': 32,    // 区域间距
  '4xl': 40,    // 页面间距
  '5xl': 48,    // 超大间距
} as const;
```

### 3.5 字体体系 —— iOS 风格层级

```typescript
export const typography = {
  // === 字体族 ===
  fontFamily: {
    // SF Pro 回退链：系统字体优先
    base: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
    display: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
    mono: '"SF Mono", "Fira Code", "Cascadia Code", Menlo, Consolas, monospace',
  },

  // === 字号 + 行高 + 字重 组合（iOS Human Interface Guidelines）===
  largeTitle:   { fontSize: 34, lineHeight: '41px', fontWeight: 700, letterSpacing: '0.37px' },
  title1:       { fontSize: 28, lineHeight: '34px', fontWeight: 700, letterSpacing: '0.36px' },
  title2:       { fontSize: 22, lineHeight: '28px', fontWeight: 700, letterSpacing: '0.35px' },
  title3:       { fontSize: 20, lineHeight: '25px', fontWeight: 600, letterSpacing: '0.38px' },
  headline:     { fontSize: 17, lineHeight: '22px', fontWeight: 600, letterSpacing: '-0.41px' },
  body:         { fontSize: 17, lineHeight: '22px', fontWeight: 400, letterSpacing: '-0.41px' },
  callout:      { fontSize: 16, lineHeight: '21px', fontWeight: 400, letterSpacing: '-0.32px' },
  subheadline:  { fontSize: 15, lineHeight: '20px', fontWeight: 400, letterSpacing: '-0.24px' },
  footnote:     { fontSize: 13, lineHeight: '18px', fontWeight: 400, letterSpacing: '-0.08px' },
  caption1:     { fontSize: 12, lineHeight: '16px', fontWeight: 400, letterSpacing: '0px' },
  caption2:     { fontSize: 11, lineHeight: '13px', fontWeight: 400, letterSpacing: '0.07px' },

  // === 桌面端调整（因为桌面屏幕更大，可以微调）===
  desktop: {
    largeTitle: { fontSize: 30, lineHeight: '36px', fontWeight: 700 },
    title1:     { fontSize: 26, lineHeight: '32px', fontWeight: 700 },
    title2:     { fontSize: 20, lineHeight: '26px', fontWeight: 600 },
    body:       { fontSize: 14, lineHeight: '20px', fontWeight: 400 },
    footnote:   { fontSize: 12, lineHeight: '16px', fontWeight: 400 },
    caption:    { fontSize: 11, lineHeight: '14px', fontWeight: 400 },
  },
} as const;
```

### 3.6 动画体系 —— iOS 弹性动画

```typescript
export const animation = {
  // === 缓动曲线 ===
  easing: {
    /** iOS 标准交互 (ease-in-out 变体) */
    standard: 'cubic-bezier(0.25, 0.1, 0.25, 1.0)',
    /** 弹性进入 (spring-like) */
    springIn: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    /** 减速退出 */
    decelerate: 'cubic-bezier(0.0, 0.0, 0.2, 1)',
    /** 加速进入 */
    accelerate: 'cubic-bezier(0.4, 0.0, 1, 1)',
  },

  // === 持续时间 ===
  duration: {
    instant: '0.1s',
    fast: '0.2s',
    normal: '0.3s',
    slow: '0.45s',
    slower: '0.6s',
  },

  // === 预组合 ===
  transition: {
    /** 按钮、链接等快速交互 */
    quick: 'all 0.15s cubic-bezier(0.25, 0.1, 0.25, 1.0)',
    /** 卡片悬停、展开收起 */
    smooth: 'all 0.3s cubic-bezier(0.25, 0.1, 0.25, 1.0)',
    /** 弹性效果（卡片浮起、按钮按下）*/
    spring: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
    /** 页面切换 */
    page: 'all 0.45s cubic-bezier(0.0, 0.0, 0.2, 1)',
    /** 仅 transform 变化 */
    transform: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
    /** 仅 opacity 变化 */
    opacity: 'opacity 0.2s ease',
  },
} as const;
```

### 3.7 布局常量更新

```typescript
export const layout = {
  sidebarWidth: 240,        // 加宽（原 200），给图标和文字更多呼吸空间
  sidebarCollapsedWidth: 72, // 折叠态宽度
  headerHeight: 52,          // 标题栏（原 64，更紧凑）
  toolbarHeight: 60,         // 工具栏
  contentPadding: 20,        // 内容区（原 24）
  gridGap: 12,               // 网格间距
  cardGap: 16,               // 卡片间距
  sectionGap: 32,            // 区域间距
} as const;
```

---

## 四、各模块美化方案

### 4.1 侧边栏 (Sidebar) —— iPadOS 风格

**目标**：从传统 Ant Design Menu 变为 iPadOS 风格侧边栏

```
┌──────────────────────┐
│                      │
│   ✦ Yande Gallery    │  ← 应用名 + Logo（SF Pro Display Bold）
│                      │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│  ← 极淡分隔线
│                      │
│  🖼  图库             │  ← 主菜单项：圆角高亮背景 + 彩色图标
│  ☁  Booru            │
│  ⚙  设置             │
│                      │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
│                      │
│  🕐  最近             │  ← 子菜单：选中时左侧无竖线，
│  📱  所有             │     改为全行圆角背景色填充
│  📁  图集             │
│                      │
│                      │
│                      │
│                      │  ← 大量留白
│                      │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
│  🌙 / ☀             │  ← 底部：主题切换按钮
└──────────────────────┘
```

**核心改动**：

1. **背景**：纯白/深灰底 → 半透明毛玻璃效果
   ```css
   background: rgba(255, 255, 255, 0.72);
   backdrop-filter: blur(20px) saturate(180%);
   -webkit-backdrop-filter: blur(20px) saturate(180%);
   ```

2. **菜单项选中态**：Ant Design 的右侧蓝色竖线 → iOS 圆角背景填充
   ```css
   /* 选中菜单项 */
   .menu-item-active {
     background: rgba(0, 122, 255, 0.10);
     border-radius: 10px;
     color: #007AFF;
     font-weight: 600;
   }
   ```

3. **菜单项 hover**：
   ```css
   .menu-item:hover {
     background: rgba(0, 0, 0, 0.04);
     border-radius: 10px;
   }
   ```

4. **图标**：每个菜单项的图标使用 iOS 风格填充色
   - 图库：蓝色 (#007AFF)
   - Booru：紫色 (#AF52DE)
   - 设置：灰色 (#8E8E93)
   - 最近：橙色 (#FF9500)
   - 收藏：粉色 (#FF2D55)
   - 下载：绿色 (#34C759)

5. **间距**：菜单项内边距加大
   ```css
   padding: 10px 14px;
   margin: 2px 12px;  /* 左右留出间距，不贴边 */
   gap: 12px;          /* 图标与文字间距 */
   ```

6. **应用标识区**：
   ```css
   /* 顶部 Logo + 应用名 */
   padding: 20px 16px 12px;
   font-size: 18px;
   font-weight: 700;
   letter-spacing: -0.3px;
   ```

7. **底部操作区**：主题切换按钮，圆形，置于侧边栏底部

### 4.2 顶部标题栏 (Header) —— iOS 大标题风格

**目标**：从简单的 h2 标题变为 iOS 风格动态标题栏

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   图库 · 最近                              🔍  搜索         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**核心改动**：

1. **标题样式**：
   ```css
   font-size: 26px;       /* iOS Title1 */
   font-weight: 700;
   letter-spacing: -0.3px;
   color: textPrimary;
   ```

2. **背景**：毛玻璃效果
   ```css
   background: rgba(255, 255, 255, 0.72);
   backdrop-filter: blur(20px) saturate(180%);
   border-bottom: 0.5px solid rgba(0, 0, 0, 0.12);
   ```

3. **标题分隔符**：主标题 · 子标题格式，子标题用较浅颜色
   ```typescript
   // 例如 "图库" 为主标题，"· 最近" 用 textTertiary 色
   ```

4. **右侧区域**：可放置全局搜索入口或操作按钮

5. **高度**：52px，比原来的 64px 更紧凑

### 4.3 图片卡片 —— iOS 圆角卡片风格

#### 4.3.1 本地图库卡片 (ImageGrid 中的每张图片)

**目标**：从方角图片变为圆角悬浮卡片

```
┌─────────────────┐
│                  │
│                  │
│    [图片内容]    │  ← borderRadius: 14px
│                  │  ← 微妙的 box-shadow
│                  │
│                  │
├─────────────────┤   （hover 时显示以下叠加层）
│ ◻ 文件名.jpg     │  ← 半透明黑底 + 白字
│ 1920×1080 · 2MB │  ← 辅助信息
└─────────────────┘
```

**核心改动**：

1. **圆角**：8px → 14px
2. **阴影**：`shadows.sm` 默认态 → `shadows.md` 悬停态
3. **hover 效果**：
   ```css
   /* 默认 */
   transform: scale(1);
   box-shadow: shadows.sm;

   /* hover */
   transform: scale(1.02);          /* 微放大代替 translateY */
   box-shadow: shadows.md;
   transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
   ```
4. **图片加载动画**：
   ```css
   /* 图片从模糊到清晰的淡入效果 */
   opacity: 0 → 1;
   filter: blur(10px) → blur(0);
   transition: opacity 0.4s, filter 0.4s;
   ```
5. **信息叠加层**：hover 时底部渐变黑色蒙层 + 文件信息
   ```css
   background: linear-gradient(transparent, rgba(0, 0, 0, 0.6));
   padding: 12px;
   border-radius: 0 0 14px 14px;
   ```

#### 4.3.2 Booru 图片卡片 (BooruImageCard)

```
┌──────────────────────────┐
│                          │
│                          │
│       [预览图片]          │  ← 圆角 14px，顶部保留圆角
│                          │
│                          │
├──────────────────────────┤
│                          │
│  Score: 128  ⭐ Safe     │  ← 底部信息区：白底/深底
│                          │
│  girl  blue_eyes  ...    │  ← 标签：胶囊形小标签
│                          │
│  ❤️  👁  ⬇             │  ← 操作按钮：圆形图标按钮
│                          │
└──────────────────────────┘
```

**核心改动**：

1. **整体卡片**：
   ```css
   border-radius: 14px;
   overflow: hidden;
   background: bgPrimary;
   box-shadow: shadows.sm;
   border: 1px solid borderCard;  /* 几乎不可见的边框 */
   transition: all 0.3s spring;
   ```

2. **图片区域**：无内边距，图片填满宽度，只在顶部有圆角

3. **信息区域**：
   ```css
   padding: 12px 14px;
   gap: 8px;
   ```

4. **标签**：
   ```css
   /* 胶囊形小标签 */
   border-radius: 9999px;
   padding: 3px 10px;
   font-size: 11px;
   background: bgSecondary;
   color: textSecondary;
   border: none;          /* 去掉 Ant Design Tag 的边框 */
   ```

5. **操作按钮**：
   ```css
   /* 圆形图标按钮，iOS 风格 */
   width: 32px;
   height: 32px;
   border-radius: 50%;
   background: rgba(0, 0, 0, 0.04);
   display: flex;
   align-items: center;
   justify-content: center;
   transition: background 0.2s;
   ```

6. **评分标签**：
   ```css
   /* Safe: 绿色胶囊 */
   background: rgba(52, 199, 89, 0.12);
   color: #34C759;
   border-radius: 9999px;
   font-size: 11px;
   font-weight: 600;
   ```

### 4.4 Booru 工具栏 —— 毛玻璃浮动条

**目标**：从实色背景工具栏变为 iOS 风格浮动工具条

```
  ┌─────────────────────────────────────────────────────────┐
  │                                                         │
  │  [站点 ▼]    [🔍 搜索标签...           ]    全部 安全  │
  │                                                         │
  └─────────────────────────────────────────────────────────┘
         ↑ 毛玻璃背景 + 大圆角 (20px) + 柔和阴影
```

**核心改动**：

1. **容器**：
   ```css
   background: materialRegular;
   backdrop-filter: blur(20px) saturate(180%);
   border-radius: 20px;
   padding: 14px 20px;
   margin: 0 20px 16px;
   box-shadow: shadows.lg;
   border: 1px solid border;
   ```

2. **搜索框**：胶囊形
   ```css
   border-radius: 9999px;
   background: rgba(0, 0, 0, 0.04);
   border: none;
   padding: 8px 16px;
   font-size: 15px;
   /* focus 态 */
   box-shadow: inset 0 0 0 3.5px rgba(0, 122, 255, 0.30);
   ```

3. **站点选择器**：圆角下拉
   ```css
   border-radius: 10px;
   border: 1px solid separator;
   ```

4. **分级筛选 (Segmented)**：iOS 风格分段控件
   ```css
   background: rgba(0, 0, 0, 0.04);
   border-radius: 10px;
   padding: 2px;

   /* 选中段 */
   .segment-active {
     background: white;
     border-radius: 8px;
     box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
   }
   ```

### 4.5 设置页面 —— iOS Grouped Inset 风格

**目标**：从平铺表单变为 iOS 设置页面风格的分组卡片

```
┌──────────────────────────────────────────┐
│  图库设置                                │  ← 分组标题：大写灰字
├──────────────────────────────────────────┤
│                                          │
│  ┌──────────────────────────────────┐   │
│  │  图库路径                         │   │  ← 白色圆角卡片 (14px)
│  │  M:\booru_u                 [修改]│   │
│  ├──────────────────────────────────┤   │  ← 项间分隔线（左缩进）
│  │  自动扫描                    🔘  │   │  ← iOS Switch 开关
│  ├──────────────────────────────────┤   │
│  │  递归子目录                  🔘  │   │
│  └──────────────────────────────────┘   │
│                                          │
│  扫描间隔可在高级设置中配置               │  ← 分组脚注：小字灰色
│                                          │
│  下载设置                                │
├──────────────────────────────────────────┤
│                                          │
│  ┌──────────────────────────────────┐   │
│  │  下载目录                         │   │
│  │  M:\test                    [修改]│   │
│  ├──────────────────────────────────┤   │
│  │  最大并发数              [  3  ] │   │
│  ├──────────────────────────────────┤   │
│  │  文件名模板                       │   │
│  │  {id}_{md5:maxlength=8}.{ext}   │   │
│  └──────────────────────────────────┘   │
│                                          │
└──────────────────────────────────────────┘
```

**核心改动**：

1. **页面背景**：`bgGrouped` (#F2F2F7 / #000000)
2. **分组卡片**：
   ```css
   background: bgGroupedSecondary;  /* 白色 / #1C1C1E */
   border-radius: 14px;
   overflow: hidden;
   margin: 0 20px 24px;
   ```
3. **分组标题**：
   ```css
   font-size: 13px;
   color: textTertiary;
   text-transform: uppercase;
   padding: 8px 20px 8px 36px;  /* 左缩进对齐卡片内容 */
   font-weight: 400;
   ```
4. **列表项**：
   ```css
   padding: 12px 16px;
   display: flex;
   justify-content: space-between;
   align-items: center;
   min-height: 44px;            /* iOS 最小触摸区域 */
   ```
5. **分隔线**：
   ```css
   /* iOS 风格左缩进分隔线 */
   border-bottom: 0.5px solid separator;
   margin-left: 16px;           /* 不从最左边开始 */
   ```
6. **开关控件**：使用 iOS 风格 Switch（绿色激活态）

### 4.6 下载管理页面 —— iOS 列表风格

```
┌──────────────────────────────────────────────┐
│                                              │
│   下载队列                                    │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │  ○ yande_12345.jpg                    │   │
│  │  ████████████░░░░░░░░  67%           │   │  ← 圆角进度条
│  │  2.3 MB / 3.4 MB                     │   │
│  ├──────────────────────────────────────┤   │
│  │  ✓ yande_12346.png                   │   │  ← 完成：绿色勾
│  │  ████████████████████  100%          │   │
│  │  4.1 MB · 完成                       │   │
│  ├──────────────────────────────────────┤   │
│  │  ✕ yande_12347.jpg                   │   │  ← 失败：红色叉
│  │  ░░░░░░░░░░░░░░░░░░░  失败          │   │
│  │  连接超时 · [重试]                    │   │
│  └──────────────────────────────────────┘   │
│                                              │
└──────────────────────────────────────────────┘
```

**核心改动**：

1. **进度条**：
   ```css
   height: 4px;                /* iOS 细进度条 */
   border-radius: 9999px;      /* 完全圆角 */
   background: bgTertiary;
   /* 进度填充 */
   background: linear-gradient(90deg, #007AFF, #5AC8FA);
   ```

2. **状态图标**：SF Symbols 风格圆形图标
   - 下载中：蓝色旋转圈
   - 已完成：绿色圆形内勾 ✓
   - 失败：红色圆形内叉 ✕
   - 暂停：橙色圆形内暂停 ❚❚

### 4.7 图片预览 (Preview) —— 沉浸式全屏

**核心改动**：

1. **背景**：纯黑 → 毛玻璃暗色
   ```css
   background: rgba(0, 0, 0, 0.85);
   backdrop-filter: blur(30px);
   ```
2. **图片展示**：加入圆角
   ```css
   border-radius: 8px;
   box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
   ```
3. **工具栏**：底部毛玻璃浮动条
   ```css
   background: rgba(30, 30, 30, 0.72);
   backdrop-filter: blur(20px);
   border-radius: 14px;
   padding: 8px 16px;
   margin-bottom: 20px;
   ```
4. **切换动画**：图片左右切换时添加滑动 + 淡入淡出效果

---

## 五、全局样式注入方案

### 5.1 Ant Design 主题覆盖

通过 `ConfigProvider` 的 `theme` 属性全面覆盖 Ant Design 默认主题：

```typescript
const iosTheme = {
  token: {
    // 色彩
    colorPrimary: '#007AFF',
    colorSuccess: '#34C759',
    colorWarning: '#FF9500',
    colorError: '#FF3B30',
    colorInfo: '#5AC8FA',
    colorLink: '#007AFF',

    // 圆角
    borderRadius: 10,
    borderRadiusSM: 6,
    borderRadiusLG: 14,

    // 字体
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif',
    fontSize: 14,
    fontSizeSM: 12,
    fontSizeLG: 16,
    fontSizeXL: 20,
    fontSizeHeading1: 30,
    fontSizeHeading2: 26,
    fontSizeHeading3: 22,
    fontSizeHeading4: 20,
    fontSizeHeading5: 17,

    // 间距
    padding: 16,
    paddingSM: 12,
    paddingLG: 20,
    paddingXL: 24,
    margin: 16,
    marginSM: 12,
    marginLG: 20,
    marginXL: 24,

    // 阴影
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06), 0 2px 8px rgba(0, 0, 0, 0.04)',
    boxShadowSecondary: '0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04)',

    // 线条
    lineWidth: 0.5,
    lineType: 'solid',

    // 控件
    controlHeight: 36,
    controlHeightSM: 28,
    controlHeightLG: 44,

    // 动画
    motionDurationFast: '0.15s',
    motionDurationMid: '0.3s',
    motionDurationSlow: '0.45s',
    motionEaseInOut: 'cubic-bezier(0.25, 0.1, 0.25, 1.0)',
  },

  components: {
    // === Menu (侧边栏) ===
    Menu: {
      itemBorderRadius: 10,
      itemMarginInline: 8,
      itemMarginBlock: 2,
      itemPaddingInline: 14,
      itemHeight: 40,
      iconSize: 18,
      activeBarBorderWidth: 0,          // 去掉右侧竖线
      itemSelectedBg: 'rgba(0, 122, 255, 0.10)',
      itemSelectedColor: '#007AFF',
      itemHoverBg: 'rgba(0, 0, 0, 0.04)',
    },

    // === Card ===
    Card: {
      borderRadiusLG: 14,
      paddingLG: 16,
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06), 0 2px 8px rgba(0, 0, 0, 0.04)',
    },

    // === Button ===
    Button: {
      borderRadius: 10,
      controlHeight: 36,
      controlHeightSM: 28,
      controlHeightLG: 44,
      fontWeight: 500,
    },

    // === Input ===
    Input: {
      borderRadius: 10,
      controlHeight: 36,
      activeShadow: 'inset 0 0 0 3.5px rgba(0, 122, 255, 0.30)',
    },

    // === Select ===
    Select: {
      borderRadius: 10,
      controlHeight: 36,
    },

    // === Tag ===
    Tag: {
      borderRadiusSM: 9999,       // 胶囊形
      defaultBg: 'rgba(0, 0, 0, 0.04)',
      defaultColor: 'rgba(0, 0, 0, 0.65)',
    },

    // === Modal ===
    Modal: {
      borderRadiusLG: 20,
    },

    // === Segmented ===
    Segmented: {
      borderRadius: 10,
      borderRadiusSM: 8,
      itemSelectedBg: '#FFFFFF',
      trackBg: 'rgba(0, 0, 0, 0.04)',
    },

    // === Table ===
    Table: {
      borderRadius: 14,
      headerBg: 'transparent',
    },

    // === Pagination ===
    Pagination: {
      borderRadius: 10,
      itemActiveBg: '#007AFF',
    },

    // === Switch (iOS 绿色) ===
    Switch: {
      colorPrimary: '#34C759',
      colorPrimaryHover: '#2DB84D',
    },

    // === Progress ===
    Progress: {
      lineBorderRadius: 9999,
      remainingColor: 'rgba(0, 0, 0, 0.04)',
    },

    // === Tooltip ===
    Tooltip: {
      borderRadius: 8,
    },

    // === Dropdown ===
    Dropdown: {
      borderRadiusLG: 14,
    },

    // === Tabs ===
    Tabs: {
      inkBarColor: '#007AFF',
      itemSelectedColor: '#007AFF',
      itemHoverColor: '#007AFF',
    },
  },
};
```

### 5.2 全局 CSS 注入

在 `index.html` 或新建 `global.css` 中注入以下全局样式：

```css
/* ============================================================
   iOS 风格全局样式
   ============================================================ */

/* --- 毛玻璃材质 --- */
.material-regular {
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
}
.dark .material-regular {
  background: rgba(45, 45, 45, 0.72);
}

/* --- 自定义滚动条 (macOS 风格细滚动条) --- */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.15);
  border-radius: 9999px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.25);
}
.dark ::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
}
.dark ::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.25);
}

/* --- iOS 分隔线 --- */
.ios-separator {
  height: 0.5px;
  background: rgba(60, 60, 67, 0.12);
  margin-left: 16px;
}
.dark .ios-separator {
  background: rgba(84, 84, 88, 0.65);
}

/* --- 图片加载淡入 --- */
.image-fade-in {
  opacity: 0;
  transition: opacity 0.4s ease, filter 0.4s ease;
  filter: blur(8px);
}
.image-fade-in.loaded {
  opacity: 1;
  filter: blur(0);
}

/* --- 卡片悬停弹性效果 --- */
.card-hover {
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 0.3s ease;
}
.card-hover:hover {
  transform: scale(1.02);
}

/* --- 按钮按下效果 --- */
.btn-press:active {
  transform: scale(0.97);
  transition: transform 0.1s ease;
}

/* --- 胶囊标签 --- */
.pill-tag {
  border-radius: 9999px !important;
  border: none !important;
  padding: 2px 10px !important;
  font-size: 11px !important;
  font-weight: 500;
}

/* --- Ant Design 覆盖 --- */

/* Menu 选中项去掉右侧竖线 */
.ant-menu-item::after {
  display: none !important;
}

/* Menu 项圆角 */
.ant-menu-item {
  border-radius: 10px !important;
  margin-inline: 8px !important;
}

/* Segmented 选中态阴影 */
.ant-segmented-item-selected {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1) !important;
  border-radius: 8px !important;
}

/* Tag 胶囊化 */
.ant-tag {
  border-radius: 9999px !important;
  border: none !important;
}

/* Card 大圆角 */
.ant-card {
  border-radius: 14px !important;
}

/* 细线分隔 */
.ant-divider {
  border-color: rgba(60, 60, 67, 0.12) !important;
}

/* Switch iOS 绿 */
.ant-switch-checked {
  background: #34C759 !important;
}
```

---

## 六、关键交互动效方案

### 6.1 页面切换

```css
/* 页面切换：淡入 + 微上移 */
@keyframes pageEnter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.page-content {
  animation: pageEnter 0.35s cubic-bezier(0.0, 0.0, 0.2, 1) forwards;
}
```

### 6.2 卡片交互

```css
/* 卡片悬停 */
.image-card {
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 0.3s ease;
}
.image-card:hover {
  transform: scale(1.02);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04);
}
.image-card:active {
  transform: scale(0.98);
  transition-duration: 0.1s;
}
```

### 6.3 图片加载

```css
/* 骨架屏脉冲 */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.skeleton-shimmer {
  background: linear-gradient(
    90deg,
    rgba(0, 0, 0, 0.04) 25%,
    rgba(0, 0, 0, 0.08) 50%,
    rgba(0, 0, 0, 0.04) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease infinite;
  border-radius: 14px;
}
```

### 6.4 列表项出现

```css
/* 瀑布流中图片逐个淡入 */
@keyframes cardAppear {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.waterfall-item {
  animation: cardAppear 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  /* 通过 animation-delay 实现错开效果 */
}
```

### 6.5 按钮反馈

```css
/* 所有可交互元素的按下缩放 */
.interactive:active {
  transform: scale(0.97);
  transition: transform 0.1s ease;
}

/* 收藏按钮心跳效果 */
@keyframes heartbeat {
  0% { transform: scale(1); }
  25% { transform: scale(1.3); }
  50% { transform: scale(1.0); }
  75% { transform: scale(1.15); }
  100% { transform: scale(1); }
}

.favorite-pulse {
  animation: heartbeat 0.4s ease;
}
```

---

## 七、实施计划与优先级

### Phase 1：基础视觉升级（影响最大，工作量适中）

| 优先级 | 任务 | 涉及文件 | 预估改动 |
|--------|------|----------|----------|
| P0 | 更新 tokens.ts 色彩/圆角/阴影/字体/动画体系 | `tokens.ts` | 重写 |
| P0 | ConfigProvider 注入 iOS 主题 | `main.tsx` | 新增主题对象 |
| P0 | 新建 `global.css` 全局样式 | 新文件 | 新建 |
| P0 | index.html 更新字体和背景色 | `index.html` | 小改 |

### Phase 2：核心组件改造

| 优先级 | 任务 | 涉及文件 | 预估改动 |
|--------|------|----------|----------|
| P1 | 侧边栏 iPadOS 风格改造 | `App.tsx` | 中等 |
| P1 | 标题栏改造 | `App.tsx` | 小改 |
| P1 | ImageGrid 卡片圆角/阴影/动画 | `ImageGrid.tsx` | 中等 |
| P1 | BooruImageCard 卡片重构 | `BooruImageCard.tsx` | 中等 |
| P1 | BooruPageToolbar 毛玻璃工具栏 | `BooruPageToolbar.tsx` | 中等 |

### Phase 3：页面级改造

| 优先级 | 任务 | 涉及文件 | 预估改动 |
|--------|------|----------|----------|
| P2 | 设置页面 Grouped Inset 风格 | `SettingsPage.tsx`, `BooruSettingsPage.tsx` | 大改 |
| P2 | 下载页面 iOS 列表风格 | `BooruDownloadPage.tsx` | 中等 |
| P2 | 批量下载页面视觉统一 | `BooruBulkDownloadPage.tsx` 等 | 中等 |
| P2 | 收藏页面视觉统一 | `BooruFavoritesPage.tsx` | 小改 |
| P2 | 骨架屏升级 | `SkeletonGrid.tsx`, `SkeletonWaterfall.tsx` | 小改 |

### Phase 4：动效与细节打磨

| 优先级 | 任务 | 涉及文件 | 预估改动 |
|--------|------|----------|----------|
| P3 | 页面切换动画 | `App.tsx` | 小改 |
| P3 | 图片加载淡入效果 | `ImageGrid.tsx`, `BooruImageCard.tsx` | 小改 |
| P3 | 卡片悬停弹性动画 | 各卡片组件 | 小改 |
| P3 | 自定义滚动条 | `global.css` | 已包含 |
| P3 | 右键菜单 iOS 化 | `ContextMenu.tsx` | 中等 |
| P3 | 图片预览沉浸式升级 | `ImageGrid.tsx` 预览部分 | 中等 |

---

## 八、设计参考对照

### 8.1 配色对比

| 元素 | 当前 | 升级后 | 来源 |
|------|------|--------|------|
| 主色 | #1890ff | #007AFF | iOS System Blue |
| 成功 | #52c41a | #34C759 | iOS System Green |
| 警告 | #faad14 | #FF9500 | iOS System Orange |
| 危险 | #ff4d4f | #FF3B30 | iOS System Red |
| 页面背景 | #f0f2f5 / #f5f5f5 | #F2F2F7 | iOS Grouped Background |
| 卡片背景 | #ffffff | #FFFFFF | iOS Primary Background |
| 分隔线 | #f0f0f0 | rgba(60,60,67,0.12) | iOS Separator |

### 8.2 圆角对比

| 元素 | 当前 | 升级后 |
|------|------|--------|
| 小按钮/标签 | 4px | 6px / 9999px (胶囊) |
| 输入框/选择器 | 4-6px | 10px |
| 卡片 | 8px | 14px |
| 工具栏/弹窗 | 8px | 20px |
| 搜索框 | 4px | 9999px (胶囊) |

### 8.3 阴影对比

| 元素 | 当前 | 升级后 |
|------|------|--------|
| 卡片默认 | `0 2px 8px rgba(0,0,0,0.08)` | `0 1px 3px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.04)` |
| 卡片悬停 | `0 4px 16px rgba(0,0,0,0.12)` | `0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)` |
| 弹窗 | `0 8px 24px rgba(0,0,0,0.15)` | `0 16px 48px rgba(0,0,0,0.16), 0 4px 16px rgba(0,0,0,0.06)` |

---

## 九、暗色模式特别说明

iOS 暗色模式的设计要点：

1. **背景不是纯黑**：基础背景 #000000，但卡片/浮起面使用 #1C1C1E、#2C2C2E
2. **层级通过亮度表达**：越浮起的元素越亮（与亮色模式相反）
3. **色彩更鲜艳**：暗色模式下系统色略有调整，更明亮以保证对比度
4. **毛玻璃更深沉**：`rgba(45, 45, 45, 0.72)` 而非 `rgba(255, 255, 255, 0.72)`
5. **分隔线更明显**：`rgba(84, 84, 88, 0.65)` 确保在深色背景上可见
6. **阴影几乎不可见**：暗色模式下阴影加深但作用有限，主要靠亮度差异

---

## 十、实施注意事项

### 10.1 兼容性

- `backdrop-filter` 在 Chromium 76+ 支持良好（Electron 39 包含 Chromium 130+，完全支持）
- 0.5px 边框在 Retina 显示器上效果最佳，非 Retina 会渲染为 1px
- `cubic-bezier(0.34, 1.56, 0.64, 1)` 弹性曲线所有现代浏览器支持

### 10.2 性能考虑

- `backdrop-filter: blur()` 有 GPU 开销，应限制使用范围（仅侧边栏/工具栏/弹窗），不要在大量卡片上使用
- CSS `transform: scale()` 触发 GPU 合成层，性能优于 `width/height` 变化
- 动画使用 `transform` 和 `opacity`，避免触发 layout（reflow）
- 瀑布流中的卡片动画应使用 `will-change: transform, opacity` 提示

### 10.3 不修改的部分

- 数据流和状态管理逻辑不变
- IPC 通信接口不变
- 文件名命名规则不变
- 功能行为不变（仅视觉层面改动）

---

## 总结

本方案以 **Apple iOS/iPadOS 设计语言**为蓝本，从以下六个维度全面升级界面：

1. **色彩** — Ant Design 蓝 → iOS 系统色，更鲜明活泼
2. **形状** — 小圆角 → 大圆角 (14-20px)，胶囊形标签/搜索框
3. **层次** — 平面 → 立体，多层背景 + 毛玻璃 + 多层阴影
4. **字体** — 均匀层级 → 强对比层级（大标题 + 细正文）
5. **动效** — 线性过渡 → 弹性动画（spring curve）
6. **留白** — 紧凑排布 → 宽松呼吸感

最终效果：用户打开应用的第一感觉从"这是一个功能工具"变为"这是一个精心设计的现代应用"。
