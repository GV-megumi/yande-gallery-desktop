import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, theme as antTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { App } from './App';
import { ThemeContext, useThemeProvider } from './hooks/useTheme';
import { setDarkMode } from './styles/tokens';
import 'antd/dist/reset.css';
import './styles/global.css';

// 确保electronAPI可用
if (!window.electronAPI) {
  console.error('electronAPI is not available');
} else {
  console.log('[main] electronAPI 可用，准备启动应用');
}

/**
 * iOS 风格 Ant Design 主题配置
 * 覆盖默认主题，实现 iOS 设计语言
 */
const iosLightTheme = {
  algorithm: antTheme.defaultAlgorithm,
  token: {
    // 色彩 — iOS System Colors
    colorPrimary: '#007AFF',
    colorSuccess: '#34C759',
    colorWarning: '#FF9500',
    colorError: '#FF3B30',
    colorInfo: '#5AC8FA',
    colorLink: '#007AFF',

    // 圆角 — iOS 大圆角
    borderRadius: 10,
    borderRadiusSM: 6,
    borderRadiusLG: 14,
    borderRadiusXS: 4,

    // 字体 — SF Pro 回退链
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
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

    // 阴影 — iOS 多层阴影
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06), 0 2px 8px rgba(0, 0, 0, 0.04)',
    boxShadowSecondary: '0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04)',

    // 线条 — iOS 极细线
    lineWidth: 1,
    lineType: 'solid' as const,

    // 控件尺寸
    controlHeight: 36,
    controlHeightSM: 28,
    controlHeightLG: 44,

    // 动画
    motionDurationFast: '0.15s',
    motionDurationMid: '0.3s',
    motionDurationSlow: '0.45s',
    motionEaseInOut: 'cubic-bezier(0.25, 0.1, 0.25, 1.0)',

    // 背景色
    colorBgContainer: '#FFFFFF',
    colorBgElevated: '#FFFFFF',
    colorBgLayout: '#F2F2F7',
    colorBorderSecondary: 'rgba(60, 60, 67, 0.08)',
  },
  components: {
    Menu: {
      itemBorderRadius: 10,
      itemMarginInline: 10,
      itemMarginBlock: 2,
      itemPaddingInline: 14,
      itemHeight: 40,
      iconSize: 18,
      activeBarBorderWidth: 0,
      itemSelectedBg: 'rgba(0, 122, 255, 0.10)',
      itemSelectedColor: '#007AFF',
      itemHoverBg: 'rgba(0, 0, 0, 0.04)',
    },
    Card: {
      borderRadiusLG: 14,
      paddingLG: 16,
    },
    Button: {
      borderRadius: 10,
      controlHeight: 36,
      controlHeightSM: 28,
      controlHeightLG: 44,
      fontWeight: 500,
    },
    Input: {
      borderRadius: 10,
      controlHeight: 36,
    },
    Select: {
      borderRadius: 10,
      controlHeight: 36,
    },
    Tag: {
      borderRadiusSM: 9999,
    },
    Modal: {
      borderRadiusLG: 20,
    },
    Segmented: {
      borderRadius: 10,
      borderRadiusSM: 8,
      itemSelectedBg: '#FFFFFF',
      trackBg: 'rgba(0, 0, 0, 0.04)',
    },
    Table: {
      borderRadius: 14,
      headerBg: 'transparent',
    },
    Pagination: {
      borderRadius: 10,
    },
    Switch: {
      colorPrimary: '#34C759',
      colorPrimaryHover: '#2DB84D',
    },
    Progress: {
      lineBorderRadius: 9999,
      remainingColor: 'rgba(0, 0, 0, 0.04)',
    },
    Tooltip: {
      borderRadius: 8,
    },
    Tabs: {
      inkBarColor: '#007AFF',
      itemSelectedColor: '#007AFF',
      itemHoverColor: '#007AFF',
    },
  },
};

/** 暗色主题：继承亮色主题的组件配置，覆盖颜色 */
const iosDarkTheme = {
  algorithm: antTheme.darkAlgorithm,
  token: {
    ...iosLightTheme.token,
    colorPrimary: '#0A84FF',
    colorSuccess: '#30D158',
    colorWarning: '#FF9F0A',
    colorError: '#FF453A',
    colorInfo: '#64D2FF',
    colorLink: '#0A84FF',
    colorBgContainer: '#1C1C1E',
    colorBgElevated: '#2C2C2E',
    colorBgLayout: '#000000',
    colorBorderSecondary: 'rgba(84, 84, 88, 0.40)',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.30), 0 2px 8px rgba(0, 0, 0, 0.15)',
    boxShadowSecondary: '0 4px 12px rgba(0, 0, 0, 0.35), 0 2px 4px rgba(0, 0, 0, 0.20)',
  },
  components: {
    ...iosLightTheme.components,
    Menu: {
      ...iosLightTheme.components.Menu,
      itemSelectedBg: 'rgba(10, 132, 255, 0.15)',
      itemSelectedColor: '#0A84FF',
      itemHoverBg: 'rgba(255, 255, 255, 0.06)',
    },
    Segmented: {
      ...iosLightTheme.components.Segmented,
      itemSelectedBg: '#2C2C2E',
      trackBg: 'rgba(255, 255, 255, 0.06)',
    },
    Switch: {
      colorPrimary: '#30D158',
      colorPrimaryHover: '#28B84F',
    },
    Progress: {
      lineBorderRadius: 9999,
      remainingColor: 'rgba(255, 255, 255, 0.06)',
    },
  },
};

/**
 * 主题包装器
 * 同步 useTheme 状态到 Ant Design ConfigProvider 和 Token 系统
 */
const ThemedApp: React.FC = () => {
  const themeValue = useThemeProvider();

  // 同步暗色模式到 Token 系统
  setDarkMode(themeValue.isDark);

  const currentTheme = themeValue.isDark ? iosDarkTheme : iosLightTheme;

  return (
    <ThemeContext.Provider value={themeValue}>
      <ConfigProvider
        locale={zhCN}
        theme={currentTheme}
      >
        <App />
      </ConfigProvider>
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
