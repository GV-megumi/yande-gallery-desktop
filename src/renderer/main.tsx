import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, theme as antTheme } from 'antd';
import antdZhCN from 'antd/locale/zh_CN';
import antdEnUS from 'antd/locale/en_US';
import { App } from './App';
import { SubWindowApp } from './SubWindowApp';
import { ThemeContext, useThemeProvider } from './hooks/useTheme';
import { LocaleContext, useLocaleProvider } from './locales';
import { setDarkMode } from './styles/tokens';
import 'antd/dist/reset.css';
import './styles/global.css';

// 确保electronAPI可用
if (!window.electronAPI) {
  console.error('electronAPI is not available');
} else {
  console.log('[main] electronAPI 可用，准备启动应用');
}

// 检测是否为子窗口（通过 URL hash 判断）
const SUB_WINDOW_TYPES = ['tag-search', 'artist', 'character'];
const hashType = window.location.hash.replace('#', '').split('?')[0];
const isSubWindow = SUB_WINDOW_TYPES.includes(hashType);
if (isSubWindow) {
  console.log('[main] 检测到子窗口模式, 类型:', hashType);
}

/**
 * 插画站风格 Ant Design 主题配置 — 亮色
 */
const galleryLightTheme = {
  algorithm: antTheme.defaultAlgorithm,
  token: {
    // 品牌色 — 蓝紫
    colorPrimary: '#4F46E5',
    colorSuccess: '#10B981',
    colorWarning: '#F59E0B',
    colorError: '#EF4444',
    colorInfo: '#06B6D4',
    colorLink: '#4F46E5',

    // 圆角 — 偏小，硬朗感
    borderRadius: 8,
    borderRadiusSM: 6,
    borderRadiusLG: 12,
    borderRadiusXS: 4,

    // 字体
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
    fontSize: 14,
    fontSizeSM: 12,
    fontSizeLG: 16,
    fontSizeXL: 20,
    fontSizeHeading1: 28,
    fontSizeHeading2: 24,
    fontSizeHeading3: 20,
    fontSizeHeading4: 18,
    fontSizeHeading5: 16,

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
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)',
    boxShadowSecondary: '0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04)',

    // 线条
    lineWidth: 1,
    lineType: 'solid' as const,

    // 控件尺寸
    controlHeight: 36,
    controlHeightSM: 28,
    controlHeightLG: 44,

    // 动画
    motionDurationFast: '0.15s',
    motionDurationMid: '0.25s',
    motionDurationSlow: '0.4s',
    motionEaseInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',

    // 背景色
    colorBgContainer: '#FFFFFF',
    colorBgElevated: '#FFFFFF',
    colorBgLayout: '#F8F8FC',
    colorBorderSecondary: 'rgba(0, 0, 0, 0.06)',
  },
  components: {
    Menu: {
      itemBorderRadius: 8,
      itemMarginInline: 8,
      itemMarginBlock: 2,
      itemPaddingInline: 12,
      itemHeight: 40,
      iconSize: 18,
      activeBarBorderWidth: 0,
      itemSelectedBg: 'rgba(79, 70, 229, 0.08)',
      itemSelectedColor: '#4F46E5',
      itemHoverBg: 'rgba(0, 0, 0, 0.04)',
    },
    Card: {
      borderRadiusLG: 12,
      paddingLG: 16,
    },
    Button: {
      borderRadius: 8,
      controlHeight: 36,
      controlHeightSM: 28,
      controlHeightLG: 44,
      fontWeight: 500,
    },
    Input: {
      borderRadius: 8,
      controlHeight: 36,
    },
    Select: {
      borderRadius: 8,
      controlHeight: 36,
    },
    Tag: {
      borderRadiusSM: 9999,
    },
    Modal: {
      borderRadiusLG: 16,
    },
    Segmented: {
      borderRadius: 8,
      borderRadiusSM: 6,
      itemSelectedBg: '#FFFFFF',
      trackBg: 'rgba(0, 0, 0, 0.04)',
    },
    Table: {
      borderRadius: 12,
      headerBg: 'transparent',
    },
    Pagination: {
      borderRadius: 8,
    },
    Switch: {
      colorPrimary: '#4F46E5',
      colorPrimaryHover: '#6366F1',
    },
    Progress: {
      lineBorderRadius: 9999,
      remainingColor: 'rgba(0, 0, 0, 0.04)',
    },
    Tooltip: {
      borderRadius: 6,
    },
    Tabs: {
      inkBarColor: '#4F46E5',
      itemSelectedColor: '#4F46E5',
      itemHoverColor: '#6366F1',
    },
  },
};

/**
 * 插画站风格 Ant Design 主题配置 — 暗色（深蓝黑）
 */
const galleryDarkTheme = {
  algorithm: antTheme.darkAlgorithm,
  token: {
    ...galleryLightTheme.token,
    colorPrimary: '#818CF8',
    colorSuccess: '#34D399',
    colorWarning: '#FBBF24',
    colorError: '#F87171',
    colorInfo: '#22D3EE',
    colorLink: '#818CF8',
    colorBgContainer: '#161822',
    colorBgElevated: '#1E2130',
    colorBgLayout: '#0F1117',
    colorBorderSecondary: 'rgba(255, 255, 255, 0.06)',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.40), 0 1px 2px rgba(0, 0, 0, 0.20)',
    boxShadowSecondary: '0 4px 12px rgba(0, 0, 0, 0.40), 0 2px 4px rgba(0, 0, 0, 0.20)',
  },
  components: {
    ...galleryLightTheme.components,
    Menu: {
      ...galleryLightTheme.components.Menu,
      itemSelectedBg: 'rgba(129, 140, 248, 0.12)',
      itemSelectedColor: '#818CF8',
      itemHoverBg: 'rgba(255, 255, 255, 0.05)',
    },
    Segmented: {
      ...galleryLightTheme.components.Segmented,
      itemSelectedBg: '#1E2130',
      trackBg: 'rgba(255, 255, 255, 0.05)',
    },
    Switch: {
      colorPrimary: '#818CF8',
      colorPrimaryHover: '#A5B4FC',
    },
    Progress: {
      lineBorderRadius: 9999,
      remainingColor: 'rgba(255, 255, 255, 0.06)',
    },
  },
};

/** Antd locale 映射 */
const antdLocales = {
  'zh-CN': antdZhCN,
  'en-US': antdEnUS,
};

/**
 * 主题 + 语言包装器
 */
const ThemedApp: React.FC = () => {
  const themeValue = useThemeProvider();
  const localeValue = useLocaleProvider();

  // 同步暗色模式到 Token 系统
  setDarkMode(themeValue.isDark);

  const currentTheme = themeValue.isDark ? galleryDarkTheme : galleryLightTheme;
  const antdLocale = antdLocales[localeValue.locale] || antdZhCN;

  return (
    <ThemeContext.Provider value={themeValue}>
      <LocaleContext.Provider value={localeValue}>
        <ConfigProvider
          locale={antdLocale}
          theme={currentTheme}
        >
          {isSubWindow ? <SubWindowApp /> : <App />}
        </ConfigProvider>
      </LocaleContext.Provider>
    </ThemeContext.Provider>
  );
};

console.log('[main] 开始渲染 React 应用');
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemedApp />
  </React.StrictMode>
);
console.log('[main] React 应用渲染完成');
