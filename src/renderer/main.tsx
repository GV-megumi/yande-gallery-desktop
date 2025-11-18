import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { App } from './App';
import 'antd/dist/reset.css';

// 确保electronAPI可用
if (!window.electronAPI) {
  console.error('electronAPI is not available');
} else {
  console.log('[main] electronAPI 可用，准备启动应用');
}

console.log('[main] 开始渲染 React 应用');
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#1890ff' } }}>
      <App />
    </ConfigProvider>
  </React.StrictMode>
);
console.log('[main] React 应用渲染完成');