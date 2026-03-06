/**
 * 设计 Token 体系
 * 集中管理所有样式常量，替代散落各文件的硬编码值
 * 支持亮色/暗色主题切换
 */

import React from 'react';

// ============================================================
// 亮色主题颜色
// ============================================================

const lightColors = {
  // 品牌色
  primary: '#1890ff',
  primaryHover: '#40a9ff',
  primaryActive: '#096dd9',
  primaryBg: '#e6f7ff',

  // 功能色
  success: '#52c41a',
  successBg: '#f6ffed',
  warning: '#faad14',
  warningBg: '#fff7e6',
  danger: '#ff4d4f',
  dangerBg: '#fff1f0',
  info: '#1890ff',

  // 文本色
  textPrimary: 'rgba(0, 0, 0, 0.85)',
  textSecondary: '#666666',
  textTertiary: '#999999',
  textDisabled: 'rgba(0, 0, 0, 0.25)',
  textDark: '#333333',

  // 背景色
  bgBase: '#ffffff',
  bgLight: '#f5f5f5',
  bgGray: '#fafafa',
  bgDark: '#f0f0f0',

  // 边框色
  border: '#f0f0f0',
  borderLight: '#e8e8e8',
  borderGray: '#d9d9d9',

  // 叠加层
  overlayLight: 'rgba(255, 255, 255, 0.8)',
  overlayDark: 'rgba(0, 0, 0, 0.5)',
  overlayDarker: 'rgba(0, 0, 0, 0.7)',

  // Booru 评分色
  ratingSafe: '#52c41a',
  ratingQuestionable: '#faad14',
  ratingExplicit: '#ff4d4f',
};

/** 颜色 Token 类型 */
export type ColorTokens = typeof lightColors;

// ============================================================
// 暗色主题颜色
// ============================================================

const darkColors: ColorTokens = {
  // 品牌色
  primary: '#177ddc',
  primaryHover: '#3c9ae8',
  primaryActive: '#095cb5',
  primaryBg: '#111d2c',

  // 功能色
  success: '#49aa19',
  successBg: '#162312',
  warning: '#d89614',
  warningBg: '#2b2111',
  danger: '#d32029',
  dangerBg: '#2a1215',
  info: '#177ddc',

  // 文本色
  textPrimary: 'rgba(255, 255, 255, 0.85)',
  textSecondary: 'rgba(255, 255, 255, 0.65)',
  textTertiary: 'rgba(255, 255, 255, 0.45)',
  textDisabled: 'rgba(255, 255, 255, 0.25)',
  textDark: 'rgba(255, 255, 255, 0.85)',

  // 背景色
  bgBase: '#141414',
  bgLight: '#1f1f1f',
  bgGray: '#1a1a1a',
  bgDark: '#262626',

  // 边框色
  border: '#303030',
  borderLight: '#3a3a3a',
  borderGray: '#434343',

  // 叠加层
  overlayLight: 'rgba(0, 0, 0, 0.6)',
  overlayDark: 'rgba(0, 0, 0, 0.7)',
  overlayDarker: 'rgba(0, 0, 0, 0.85)',

  // Booru 评分色（暗色模式下略微调整）
  ratingSafe: '#6abe39',
  ratingQuestionable: '#d89614',
  ratingExplicit: '#d32029',
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
// 颜色 Token（使用 Proxy 实现动态主题切换）
// ============================================================

export const colors: ColorTokens = new Proxy(lightColors, {
  get(_target, prop: string) {
    return _isDark ? (darkColors as any)[prop] : (lightColors as any)[prop];
  }
}) as ColorTokens;

// ============================================================
// 间距 Token（基于 4px 栅格）
// ============================================================

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

// ============================================================
// 阴影 Token
// ============================================================

const lightShadows = {
  /** 卡片默认阴影 */
  card: '0 2px 8px rgba(0, 0, 0, 0.08)',
  /** 卡片悬浮阴影 */
  cardHover: '0 4px 16px rgba(0, 0, 0, 0.12)',
  /** 工具栏阴影 */
  toolbar: '0 2px 8px rgba(0, 0, 0, 0.1)',
  /** 下拉菜单阴影 */
  dropdown: '0 4px 12px rgba(0, 0, 0, 0.1)',
  /** 弹窗阴影 */
  modal: '0 8px 24px rgba(0, 0, 0, 0.15)',
  /** 微弱阴影 */
  subtle: '0 1px 3px rgba(0, 0, 0, 0.1)',
  /** 无阴影 */
  none: 'none',
};

type ShadowTokens = typeof lightShadows;

const darkShadows: ShadowTokens = {
  card: '0 2px 8px rgba(0, 0, 0, 0.3)',
  cardHover: '0 4px 16px rgba(0, 0, 0, 0.4)',
  toolbar: '0 2px 8px rgba(0, 0, 0, 0.35)',
  dropdown: '0 4px 12px rgba(0, 0, 0, 0.35)',
  modal: '0 8px 24px rgba(0, 0, 0, 0.45)',
  subtle: '0 1px 3px rgba(0, 0, 0, 0.3)',
  none: 'none',
};

export const shadows: ShadowTokens = new Proxy(lightShadows, {
  get(_target, prop: string) {
    return _isDark ? (darkShadows as any)[prop] : (lightShadows as any)[prop];
  }
}) as ShadowTokens;

// ============================================================
// 圆角 Token
// ============================================================

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  round: '50%',
} as const;

// ============================================================
// 过渡动画 Token
// ============================================================

export const transitions = {
  fast: 'all 0.15s ease',
  normal: 'all 0.2s ease',
  slow: 'all 0.3s ease',
} as const;

// ============================================================
// 布局 Token
// ============================================================

export const layout = {
  /** 侧边栏宽度 */
  sidebarWidth: 200,
  /** 工具栏高度 */
  toolbarHeight: 56,
  /** 内容区内边距 */
  contentPadding: 24,
  /** 网格间距 */
  gridGap: 16,
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
// 复合样式（常用组合）
// ============================================================

/** 卡片默认样式 */
export const cardStyle: React.CSSProperties = {
  borderRadius: radius.md,
  boxShadow: shadows.card,
  transition: transitions.normal,
  overflow: 'hidden',
};

/** 卡片悬浮样式（合并到 onMouseEnter） */
export const cardHoverStyle: React.CSSProperties = {
  boxShadow: shadows.cardHover,
  transform: 'translateY(-2px)',
};

/** 卡片默认状态（合并到 onMouseLeave） */
export const cardDefaultStyle: React.CSSProperties = {
  boxShadow: shadows.card,
  transform: 'translateY(0)',
};

/** 工具栏容器样式 */
export const toolbarStyle: React.CSSProperties = {
  padding: `${spacing.md}px ${spacing.lg}px`,
  background: colors.bgBase,
  boxShadow: shadows.toolbar,
  zIndex: zIndex.toolbar,
};

/** 页面内容容器样式 */
export const contentStyle: React.CSSProperties = {
  padding: layout.contentPadding,
};
