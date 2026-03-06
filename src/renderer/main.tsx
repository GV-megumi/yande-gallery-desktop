import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, theme as antTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { App } from './App';
import { ThemeContext, useThemeProvider } from './hooks/useTheme';
import { setDarkMode } from './styles/tokens';
import 'antd/dist/reset.css';

// 确保electronAPI可用
if (!window.electronAPI) {
  console.error('electronAPI is not available');
} else {
  console.log('[main] electronAPI 可用，准备启动应用');
}

/**
 * 主题包装器
 * 同步 useTheme 状态到 Ant Design ConfigProvider 和 Token 系统
 */
const ThemedApp: React.FC = () => {
  const themeValue = useThemeProvider();

  // 同步暗色模式到 Token 系统
  setDarkMode(themeValue.isDark);

  return (
    <ThemeContext.Provider value={themeValue}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: themeValue.isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
          token: {
            colorPrimary: '#1890ff',
          }
        }}
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
