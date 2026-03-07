/**
 * iOS 风格设计 Token 体系
 * 以 Apple iOS/iPadOS Human Interface Guidelines 为蓝本
 * 支持亮色/暗色主题切换（Proxy 动态代理）
 */

import React from 'react';

// ============================================================
// 亮色主题颜色 — iOS System Colors
// ============================================================

const lightColors = {
  // 品牌色 (iOS System Blue)
  primary: '#007AFF',
  primaryHover: '#0A84FF',
  primaryActive: '#0060CC',
  primaryBg: 'rgba(0, 122, 255, 0.08)',

  // iOS 系统功能色
  success: '#34C759',
  successBg: 'rgba(52, 199, 89, 0.08)',
  warning: '#FF9500',
  warningBg: 'rgba(255, 149, 0, 0.08)',
  danger: '#FF3B30',
  dangerBg: 'rgba(255, 59, 48, 0.08)',
  info: '#5AC8FA',
  purple: '#AF52DE',
  pink: '#FF2D55',
  indigo: '#5856D6',

  // 文本色 — iOS 标准灰度层级
  textPrimary: '#000000',
  textSecondary: 'rgba(60, 60, 67, 0.85)',
  textTertiary: 'rgba(60, 60, 67, 0.60)',
  textQuaternary: 'rgba(60, 60, 67, 0.30)',
  textDisabled: 'rgba(60, 60, 67, 0.30)',
  textDark: '#1C1C1E',
  textLink: '#007AFF',

  // 背景色 — iOS 三层灰白体系
  bgBase: '#FFFFFF',
  bgLight: '#F2F2F7',
  bgGray: '#F2F2F7',
  bgDark: '#E5E5EA',
  bgElevated: '#FFFFFF',
  bgGrouped: '#F2F2F7',
  bgGroupedSecondary: '#FFFFFF',

  // 分隔与边框 — iOS 极淡风格
  border: 'rgba(60, 60, 67, 0.12)',
  borderLight: 'rgba(60, 60, 67, 0.08)',
  borderGray: '#C6C6C8',
  borderCard: 'rgba(0, 0, 0, 0.04)',
  separator: 'rgba(60, 60, 67, 0.12)',
  separatorOpaque: '#C6C6C8',

  // 叠加层
  overlayLight: 'rgba(255, 255, 255, 0.72)',
  overlayDark: 'rgba(0, 0, 0, 0.40)',
  overlayDarker: 'rgba(0, 0, 0, 0.55)',

  // 毛玻璃材质
  materialThin: 'rgba(255, 255, 255, 0.50)',
  materialRegular: 'rgba(255, 255, 255, 0.72)',
  materialThick: 'rgba(255, 255, 255, 0.85)',

  // Booru 评分色
  ratingSafe: '#34C759',
  ratingQuestionable: '#FF9500',
  ratingExplicit: '#FF3B30',

  // Overlay 按钮激活色
  heartActive: 'rgba(255, 45, 85, 0.85)',       // 喜欢：粉红
  bookmarkActive: 'rgba(255, 149, 0, 0.85)',     // 收藏：橙色
};

/** 颜色 Token 类型 */
export type ColorTokens = typeof lightColors;

// ============================================================
// 暗色主题颜色 — iOS Dark Mode
// ============================================================

const darkColors: ColorTokens = {
  // 品牌色
  primary: '#0A84FF',
  primaryHover: '#409CFF',
  primaryActive: '#0064D2',
  primaryBg: 'rgba(10, 132, 255, 0.12)',

  // 功能色
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

  // 文本色
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(235, 235, 245, 0.60)',
  textTertiary: 'rgba(235, 235, 245, 0.30)',
  textQuaternary: 'rgba(235, 235, 245, 0.18)',
  textDisabled: 'rgba(235, 235, 245, 0.18)',
  textDark: '#FFFFFF',
  textLink: '#0A84FF',

  // 背景色 — iOS Dark 三层体系
  bgBase: '#1C1C1E',
  bgLight: '#2C2C2E',
  bgGray: '#1C1C1E',
  bgDark: '#3A3A3C',
  bgElevated: '#2C2C2E',
  bgGrouped: '#000000',
  bgGroupedSecondary: '#1C1C1E',

  // 分隔与边框
  border: 'rgba(84, 84, 88, 0.65)',
  borderLight: 'rgba(84, 84, 88, 0.40)',
  borderGray: '#48484A',
  borderCard: 'rgba(255, 255, 255, 0.06)',
  separator: 'rgba(84, 84, 88, 0.65)',
  separatorOpaque: '#38383A',

  // 叠加层
  overlayLight: 'rgba(30, 30, 30, 0.72)',
  overlayDark: 'rgba(0, 0, 0, 0.55)',
  overlayDarker: 'rgba(0, 0, 0, 0.70)',

  // 毛玻璃材质
  materialThin: 'rgba(45, 45, 45, 0.50)',
  materialRegular: 'rgba(45, 45, 45, 0.72)',
  materialThick: 'rgba(45, 45, 45, 0.85)',

  // Booru 评分色
  ratingSafe: '#30D158',
  ratingQuestionable: '#FF9F0A',
  ratingExplicit: '#FF453A',

  // Overlay 按钮激活色
  heartActive: 'rgba(255, 55, 95, 0.85)',
  bookmarkActive: 'rgba(255, 159, 10, 0.85)',
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
// 间距 Token（基于 4px 栅格，iOS 宽松风格）
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
// 阴影 Token — iOS 多层立体阴影
// ============================================================

const lightShadows = {
  /** 卡片默认阴影（双层，柔和立体） */
  card: '0 1px 3px rgba(0, 0, 0, 0.06), 0 2px 8px rgba(0, 0, 0, 0.04)',
  /** 卡片悬浮阴影 */
  cardHover: '0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04)',
  /** 工具栏阴影 */
  toolbar: '0 8px 28px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.04)',
  /** 下拉菜单阴影 */
  dropdown: '0 8px 28px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.04)',
  /** 弹窗阴影 */
  modal: '0 16px 48px rgba(0, 0, 0, 0.16), 0 4px 16px rgba(0, 0, 0, 0.06)',
  /** 微弱阴影 */
  subtle: '0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.02)',
  /** 无阴影 */
  none: 'none',
};

type ShadowTokens = typeof lightShadows;

const darkShadows: ShadowTokens = {
  card: '0 1px 3px rgba(0, 0, 0, 0.30), 0 2px 8px rgba(0, 0, 0, 0.15)',
  cardHover: '0 4px 12px rgba(0, 0, 0, 0.35), 0 2px 4px rgba(0, 0, 0, 0.20)',
  toolbar: '0 8px 28px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.20)',
  dropdown: '0 8px 28px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.20)',
  modal: '0 16px 48px rgba(0, 0, 0, 0.55), 0 4px 16px rgba(0, 0, 0, 0.25)',
  subtle: '0 1px 2px rgba(0, 0, 0, 0.20)',
  none: 'none',
};

export const shadows: ShadowTokens = new Proxy(lightShadows, {
  get(_target, prop: string) {
    return _isDark ? (darkShadows as any)[prop] : (lightShadows as any)[prop];
  }
}) as ShadowTokens;

// ============================================================
// 圆角 Token — iOS 大圆角风格
// ============================================================

export const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 9999,
  round: '50%',
} as const;

// ============================================================
// 动画 Token — iOS 弹性动画
// ============================================================

export const transitions = {
  /** 快速交互（按钮、链接） */
  fast: 'all 0.15s cubic-bezier(0.25, 0.1, 0.25, 1.0)',
  /** 标准交互（卡片悬停） */
  normal: 'all 0.3s cubic-bezier(0.25, 0.1, 0.25, 1.0)',
  /** 慢速过渡（页面切换） */
  slow: 'all 0.45s cubic-bezier(0.0, 0.0, 0.2, 1)',
  /** 弹性效果（卡片浮起、按钮按下） */
  spring: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
  /** 仅 transform */
  transform: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
  /** 仅 opacity */
  opacity: 'opacity 0.25s ease',
} as const;

// ============================================================
// 布局 Token
// ============================================================

export const layout = {
  /** 侧边栏宽度（加宽，呼吸感） */
  sidebarWidth: 220,
  /** 侧边栏折叠宽度 */
  sidebarCollapsedWidth: 72,
  /** 标题栏高度 */
  headerHeight: 52,
  /** 工具栏高度 */
  toolbarHeight: 56,
  /** 内容区内边距 */
  contentPadding: 20,
  /** 网格间距 */
  gridGap: 12,
  /** 卡片间距 */
  cardGap: 16,
} as const;

// ============================================================
// 字体大小 Token — iOS 字体层级
// ============================================================

export const fontSize = {
  /** 极小 (caption2) */
  xs: 11,
  /** 小 (caption1) */
  sm: 12,
  /** 中 (footnote) */
  md: 13,
  /** 正文 (body) */
  base: 14,
  /** 大 (callout) */
  lg: 16,
  /** 加大 (headline) */
  xl: 17,
  /** 特大 (title3) */
  xxl: 20,
  /** 标题 (title1) */
  heading: 26,
  /** 大标题 (largeTitle) */
  largeTitle: 30,
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
// iOS 风格菜单图标颜色
// ============================================================

export const iconColors = {
  gallery: '#007AFF',
  booru: '#AF52DE',
  settings: '#8E8E93',
  recent: '#FF9500',
  all: '#5AC8FA',
  galleries: '#34C759',
  posts: '#AF52DE',
  favorites: '#FF2D55',
  favoriteTags: '#FF9500',
  downloads: '#34C759',
  bulkDownload: '#5856D6',
  booruSettings: '#8E8E93',
  popular: '#FF3B30',
  pools: '#5856D6',
  serverFavorites: '#FF2D55',
} as const;

// ============================================================
// 复合样式（常用组合）— iOS 风格
// ============================================================

/** 卡片默认样式 */
export const cardStyle: React.CSSProperties = {
  borderRadius: radius.md,
  boxShadow: shadows.card,
  transition: transitions.normal,
  overflow: 'hidden',
  border: '1px solid',
  borderColor: 'rgba(0, 0, 0, 0.04)',
};

/** 卡片悬浮样式 */
export const cardHoverStyle: React.CSSProperties = {
  boxShadow: shadows.cardHover,
  transform: 'scale(1.02)',
};

/** 卡片默认状态 */
export const cardDefaultStyle: React.CSSProperties = {
  boxShadow: shadows.card,
  transform: 'scale(1)',
};

/** 工具栏容器样式 — 毛玻璃风格 */
export const toolbarStyle: React.CSSProperties = {
  padding: `${spacing.md}px ${spacing.xl}px`,
  background: colors.materialRegular,
  backdropFilter: 'blur(20px) saturate(180%)',
  WebkitBackdropFilter: 'blur(20px) saturate(180%)',
  borderRadius: radius.lg,
  boxShadow: shadows.toolbar,
  zIndex: zIndex.toolbar,
  border: '1px solid',
  borderColor: colors.border,
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
