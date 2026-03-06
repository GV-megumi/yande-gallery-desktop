/**
 * 主题管理 Hook
 * 提供暗色/亮色模式切换功能
 */

import { useState, useEffect, useCallback, createContext, useContext } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  /** 当前主题模式设置 */
  themeMode: ThemeMode;
  /** 实际生效的主题（解析 system 后的结果） */
  isDark: boolean;
  /** 切换主题 */
  setThemeMode: (mode: ThemeMode) => void;
}

const STORAGE_KEY = 'app-theme-mode';

/**
 * 获取系统偏好的主题
 */
function getSystemTheme(): boolean {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
}

/**
 * 从本地存储读取主题设置
 */
function loadThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch (e) {
    // localStorage 不可用
  }
  return 'light';
}

/**
 * 主题管理 Hook
 */
export function useThemeProvider() {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(loadThemeMode);
  const [systemDark, setSystemDark] = useState(getSystemTheme);

  // 监听系统主题变化
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setSystemDark(e.matches);
    };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // 计算实际主题
  const isDark = themeMode === 'dark' || (themeMode === 'system' && systemDark);

  // 更新 HTML class（便于 CSS 选择器使用）
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    console.log('[useTheme] 切换主题:', mode);
    setThemeModeState(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch (e) {
      // localStorage 不可用
    }
  }, []);

  return { themeMode, isDark, setThemeMode };
}

// React Context
export const ThemeContext = createContext<ThemeContextValue>({
  themeMode: 'light',
  isDark: false,
  setThemeMode: () => {}
});

/**
 * 使用主题 Context
 */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
