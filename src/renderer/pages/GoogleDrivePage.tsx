/**
 * Google Drive 页面
 * 通过嵌入式浏览器（<webview>）直接访问 drive.google.com
 * 账号登录在 webview 内由用户自行完成
 */

import React, { useState, useEffect, useRef } from 'react';
import { Spin } from 'antd';

export const GoogleDrivePage: React.FC = () => {
  const [webviewLoading, setWebviewLoading] = useState(true);
  const webviewRef = useRef<any>(null);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const onStart = () => setWebviewLoading(true);
    const onStop = () => setWebviewLoading(false);

    webview.addEventListener('did-start-loading', onStart);
    webview.addEventListener('did-stop-loading', onStop);
    webview.addEventListener('did-fail-load', onStop);

    return () => {
      webview.removeEventListener('did-start-loading', onStart);
      webview.removeEventListener('did-stop-loading', onStop);
      webview.removeEventListener('did-fail-load', onStop);
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {webviewLoading && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(255,255,255,0.8)', zIndex: 10,
        }}>
          <Spin size="large" />
        </div>
      )}
      {/* @ts-ignore */}
      <webview
        ref={webviewRef}
        src="https://drive.google.com"
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        allowpopups="true"
      />
    </div>
  );
};
