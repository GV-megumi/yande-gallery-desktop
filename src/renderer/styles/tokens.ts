/**
 * 插画站风格设计 Token 体系
 * 融合 Pixiv/Danbooru 的视觉语言 + 亮暗双模式
 * 暗色模式：深蓝黑底 + 霓虹强调色 + 发光效果
 * 亮色模式：温暖浅灰底 + 鲜艳强调色 + 柔和阴影
 */

import React from 'react';

// ============================================================
// 亮色主题颜色 — 插画站亮色风格
// ============================================================

const lightColors = {
  // 品牌色 — 鲜艳的蓝紫渐变感
  primary: '#4F46E5',
  primaryHover: '#6366F1',
  primaryActive: '#4338CA',
  primaryBg: 'rgba(79, 70, 229, 0.08)',

  // 强调色 — 霓虹粉（收藏/喜欢等情感化操作）
  accent: '#EC4899',
  accentHover: '#F472B6',
  accentBg: 'rgba(236, 72, 153, 0.08)',

  // 第二强调色 — 青蓝（信息/链接）
  cyan: '#06B6D4',
  cyanBg: 'rgba(6, 182, 212, 0.08)',

  // 功能色
  success: '#10B981',
  successBg: 'rgba(16, 185, 129, 0.08)',
  warning: '#F59E0B',
  warningBg: 'rgba(245, 158, 11, 0.08)',
  danger: '#EF4444',
  dangerBg: 'rgba(239, 68, 68, 0.08)',
  info: '#06B6D4',
  purple: '#8B5CF6',
  pink: '#EC4899',
  indigo: '#6366F1',

  // 文本色 — 高对比度层级
  textPrimary: '#111827',
  textSecondary: '#4B5563',
  textTertiary: '#9CA3AF',
  textQuaternary: '#D1D5DB',
  textDisabled: '#D1D5DB',
  textDark: '#111827',
  textLink: '#4F46E5',

  // 背景色 — 温暖的浅灰体系
  bgBase: '#FFFFFF',
  bgLight: '#F8F8FC',
  bgGray: '#F3F4F6',
  bgDark: '#E5E7EB',
  bgElevated: '#FFFFFF',
  bgGrouped: '#F3F4F6',
  bgGroupedSecondary: '#FFFFFF',

  // 分隔与边框
  border: 'rgba(0, 0, 0, 0.08)',
  borderLight: 'rgba(0, 0, 0, 0.05)',
  borderGray: '#E5E7EB',
  borderCard: 'rgba(0, 0, 0, 0.06)',
  separator: 'rgba(0, 0, 0, 0.06)',
  separatorOpaque: '#E5E7EB',

  // 叠加层
  overlayLight: 'rgba(255, 255, 255, 0.80)',
  overlayDark: 'rgba(0, 0, 0, 0.50)',
  overlayDarker: 'rgba(0, 0, 0, 0.65)',

  // 毛玻璃材质
  materialThin: 'rgba(255, 255, 255, 0.60)',
  materialRegular: 'rgba(255, 255, 255, 0.80)',
  materialThick: 'rgba(255, 255, 255, 0.92)',

  // Booru 评分色
  ratingSafe: '#10B981',
  ratingQuestionable: '#F59E0B',
  ratingExplicit: '#EF4444',

  // Overlay 按钮激活色
  heartActive: 'rgba(236, 72, 153, 0.90)',
  bookmarkActive: 'rgba(245, 158, 11, 0.90)',

  // 侧边栏
  sidebarBg: '#FFFFFF',
  sidebarActiveBg: 'rgba(79, 70, 229, 0.08)',
  sidebarActiveColor: '#4F46E5',
  sidebarHoverBg: 'rgba(0, 0, 0, 0.04)',

  // 标签类型色 (Booru tag categories)
  tagGeneral: '#6B7280',
  tagArtist: '#EF4444',
  tagCopyright: '#8B5CF6',
  tagCharacter: '#10B981',
  tagMeta: '#F59E0B',
};

/** 颜色 Token 类型 */
export type ColorTokens = typeof lightColors;

// ============================================================
// 暗色主题颜色 — 插画站暗色风格（深蓝黑 + 霓虹光）
// ============================================================

const darkColors: ColorTokens = {
  // 品牌色 — 更亮的蓝紫，带发光感
  primary: '#818CF8',
  primaryHover: '#A5B4FC',
  primaryActive: '#6366F1',
  primaryBg: 'rgba(129, 140, 248, 0.12)',

  // 强调色 — 霓虹粉
  accent: '#F472B6',
  accentHover: '#FB7185',
  accentBg: 'rgba(244, 114, 182, 0.12)',

  // 青蓝
  cyan: '#22D3EE',
  cyanBg: 'rgba(34, 211, 238, 0.12)',

  // 功能色
  success: '#34D399',
  successBg: 'rgba(52, 211, 153, 0.12)',
  warning: '#FBBF24',
  warningBg: 'rgba(251, 191, 36, 0.12)',
  danger: '#F87171',
  dangerBg: 'rgba(248, 113, 113, 0.12)',
  info: '#22D3EE',
  purple: '#A78BFA',
  pink: '#F472B6',
  indigo: '#818CF8',

  // 文本色
  textPrimary: '#F9FAFB',
  textSecondary: '#D1D5DB',
  textTertiary: '#6B7280',
  textQuaternary: '#374151',
  textDisabled: '#374151',
  textDark: '#F9FAFB',
  textLink: '#818CF8',

  // 背景色 — 深蓝黑体系
  bgBase: '#0F1117',
  bgLight: '#161822',
  bgGray: '#1A1D2E',
  bgDark: '#252A3A',
  bgElevated: '#1E2130',
  bgGrouped: '#0F1117',
  bgGroupedSecondary: '#161822',

  // 分隔与边框
  border: 'rgba(255, 255, 255, 0.08)',
  borderLight: 'rgba(255, 255, 255, 0.05)',
  borderGray: '#2D3348',
  borderCard: 'rgba(255, 255, 255, 0.06)',
  separator: 'rgba(255, 255, 255, 0.06)',
  separatorOpaque: '#2D3348',

  // 叠加层
  overlayLight: 'rgba(15, 17, 23, 0.80)',
  overlayDark: 'rgba(0, 0, 0, 0.60)',
  overlayDarker: 'rgba(0, 0, 0, 0.75)',

  // 毛玻璃材质
  materialThin: 'rgba(22, 24, 34, 0.60)',
  materialRegular: 'rgba(22, 24, 34, 0.80)',
  materialThick: 'rgba(22, 24, 34, 0.92)',

  // Booru 评分色（暗色下更亮）
  ratingSafe: '#34D399',
  ratingQuestionable: '#FBBF24',
  ratingExplicit: '#F87171',

  // Overlay 按钮激活色
  heartActive: 'rgba(244, 114, 182, 0.90)',
  bookmarkActive: 'rgba(251, 191, 36, 0.90)',

  // 侧边栏
  sidebarBg: '#0F1117',
  sidebarActiveBg: 'rgba(129, 140, 248, 0.12)',
  sidebarActiveColor: '#818CF8',
  sidebarHoverBg: 'rgba(255, 255, 255, 0.05)',

  // 标签类型色
  tagGeneral: '#9CA3AF',
  tagArtist: '#F87171',
  tagCopyright: '#A78BFA',
  tagCharacter: '#34D399',
  tagMeta: '#FBBF24',
};

// ============================================================
// 主题状态管理
// ============================================================

let _isDark = false;

/** 设置暗色模式（由 ThemeProvider 调用） */
export function setDarkMode(isDark: boolean): void {
  _isDark = isDark;
}

/** 获取当前是否为暗色模式 */
export function isDarkMode(): boolean {
  return _isDark;
}

// ============================================================
// 颜色 Token（Proxy 动态切换）
// ============================================================

export const colors: ColorTokens = new Proxy(lightColors, {
  get(_target, prop: string) {
    return _isDark ? (darkColors as any)[prop] : (lightColors as any)[prop];
  }
}) as ColorTokens;

// ============================================================
// 间距 Token — 插画站紧凑风格
// ============================================================

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  '3xl': 32,
  '4xl': 40,
} as const;

// ============================================================
// 阴影 Token — 插画站风格（暗色带发光）
// ============================================================

const lightShadows = {
  /** 卡片默认阴影 */
  card: '0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)',
  /** 卡片悬浮阴影 */
  cardHover: '0 8px 25px rgba(0, 0, 0, 0.12), 0 4px 10px rgba(0, 0, 0, 0.06)',
  /** 工具栏阴影 */
  toolbar: '0 4px 20px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04)',
  /** 下拉菜单阴影 */
  dropdown: '0 10px 40px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.06)',
  /** 弹窗阴影 */
  modal: '0 20px 60px rgba(0, 0, 0, 0.15), 0 4px 16px rgba(0, 0, 0, 0.06)',
  /** 微弱阴影 */
  subtle: '0 1px 2px rgba(0, 0, 0, 0.04)',
  /** 发光效果（亮色模式下是柔和的品牌色阴影） */
  glow: '0 0 20px rgba(79, 70, 229, 0.15)',
  glowAccent: '0 0 20px rgba(236, 72, 153, 0.15)',
  /** 无阴影 */
  none: 'none',
};

type ShadowTokens = typeof lightShadows;

const darkShadows: ShadowTokens = {
  card: '0 1px 3px rgba(0, 0, 0, 0.40), 0 1px 2px rgba(0, 0, 0, 0.20)',
  cardHover: '0 8px 25px rgba(0, 0, 0, 0.50), 0 0 15px rgba(129, 140, 248, 0.10)',
  toolbar: '0 4px 20px rgba(0, 0, 0, 0.40), 0 0 1px rgba(255, 255, 255, 0.05)',
  dropdown: '0 10px 40px rgba(0, 0, 0, 0.55), 0 0 1px rgba(255, 255, 255, 0.08)',
  modal: '0 20px 60px rgba(0, 0, 0, 0.65), 0 0 1px rgba(255, 255, 255, 0.08)',
  subtle: '0 1px 2px rgba(0, 0, 0, 0.30)',
  glow: '0 0 20px rgba(129, 140, 248, 0.20), 0 0 40px rgba(129, 140, 248, 0.05)',
  glowAccent: '0 0 20px rgba(244, 114, 182, 0.20), 0 0 40px rgba(244, 114, 182, 0.05)',
  none: 'none',
};

export const shadows: ShadowTokens = new Proxy(lightShadows, {
  get(_target, prop: string) {
    return _isDark ? (darkShadows as any)[prop] : (lightShadows as any)[prop];
  }
}) as ShadowTokens;

// ============================================================
// 圆角 Token — 偏小圆角（插画站风格更硬朗）
// ============================================================

export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 9999,
  round: '50%',
} as const;

// ============================================================
// 动画 Token
// ============================================================

export const transitions = {
  /** 快速交互 */
  fast: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
  /** 标准交互 */
  normal: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
  /** 慢速过渡 */
  slow: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
  /** 弹性效果 */
  spring: 'all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
  /** 仅 transform */
  transform: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
  /** 仅 opacity */
  opacity: 'opacity 0.2s ease',
} as const;

// ============================================================
// 布局 Token
// ============================================================

export const layout = {
  /** 侧边栏宽度 */
  sidebarWidth: 240,
  /** 侧边栏折叠宽度 */
  sidebarCollapsedWidth: 72,
  /** 标题栏高度 */
  headerHeight: 56,
  /** 工具栏高度 */
  toolbarHeight: 56,
  /** 内容区内边距 */
  contentPadding: 20,
  /** 网格间距（插画站紧凑风格） */
  gridGap: 8,
  /** 卡片间距 */
  cardGap: 8,
} as const;

// ============================================================
// 字体大小 Token
// ============================================================

export const fontSize = {
  xs: 11,
  sm: 12,
  md: 13,
  base: 14,
  lg: 16,
  xl: 18,
  xxl: 20,
  heading: 24,
  largeTitle: 28,
} as const;

// ============================================================
// Z-index Token
// ============================================================

export const zIndex = {
  base: 1,
  sticky: 10,
  toolbar: 100,
  overlay: 999,
  modal: 1000,
  top: 1001,
} as const;

// ============================================================
// 插画站风格菜单图标颜色
// ============================================================

export const iconColors = {
  gallery: '#4F46E5',
  booru: '#8B5CF6',
  settings: '#6B7280',
  recent: '#F59E0B',
  all: '#06B6D4',
  galleries: '#10B981',
  posts: '#8B5CF6',
  favorites: '#EC4899',
  favoriteTags: '#F59E0B',
  downloads: '#10B981',
  bulkDownload: '#6366F1',
  booruSettings: '#6B7280',
  popular: '#EF4444',
  pools: '#6366F1',
  serverFavorites: '#EC4899',
  google: '#4285F4',
  gdrive: '#0F9D58',
  gphotos: '#FBBC04',
  invalidImages: '#F97316',
} as const;

// ============================================================
// 复合样式 — 插画站风格
// ============================================================

/** 卡片默认样式 */
export const cardStyle: React.CSSProperties = {
  borderRadius: radius.sm,
  boxShadow: shadows.card,
  transition: transitions.normal,
  overflow: 'hidden',
  border: 'none',
};

/** 卡片悬浮样式 */
export const cardHoverStyle: React.CSSProperties = {
  boxShadow: shadows.cardHover,
  transform: 'translateY(-2px)',
};

/** 卡片默认状态 */
export const cardDefaultStyle: React.CSSProperties = {
  boxShadow: shadows.card,
  transform: 'translateY(0)',
};

/** 工具栏容器样式 — 毛玻璃 */
export const toolbarStyle: React.CSSProperties = {
  padding: `${spacing.sm}px ${spacing.lg}px`,
  background: colors.materialRegular,
  backdropFilter: 'blur(20px) saturate(180%)',
  WebkitBackdropFilter: 'blur(20px) saturate(180%)',
  borderRadius: radius.md,
  boxShadow: shadows.toolbar,
  zIndex: zIndex.toolbar,
  border: `1px solid ${colors.border}`,
};

/** 页面内容容器样式 */
export const contentStyle: React.CSSProperties = {
  padding: layout.contentPadding,
};

/** 毛玻璃材质样式 */
export const glassStyle: React.CSSProperties = {
  background: colors.materialRegular,
  backdropFilter: 'blur(20px) saturate(180%)',
  WebkitBackdropFilter: 'blur(20px) saturate(180%)',
};
