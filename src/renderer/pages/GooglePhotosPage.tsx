/**
 * Google Photos 页面
 * 通过嵌入式浏览器（<webview>）直接访问 photos.google.com
 * 账号登录由 Google 账号页面统一管理
 */

import React, { useState, useEffect, useRef } from 'react';
import { Button, Spin } from 'antd';

export const GooglePhotosPage: React.FC = () => {
  const [webviewLoading, setWebviewLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const webviewRef = useRef<any>(null);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const onStart = () => {
      setWebviewLoading(true);
      setLoadFailed(false);
    };
    const onStop = () => setWebviewLoading(false);
    const onFail = () => {
      setWebviewLoading(false);
      setLoadFailed(true);
    };

    webview.addEventListener('did-start-loading', onStart);
    webview.addEventListener('did-stop-loading', onStop);
    webview.addEventListener('did-fail-load', onFail);

    return () => {
      webview.removeEventListener('did-start-loading', onStart);
      webview.removeEventListener('did-stop-loading', onStop);
      webview.removeEventListener('did-fail-load', onFail);
    };
  }, []);

  const handleRetry = () => {
    setLoadFailed(false);
    setWebviewLoading(true);
    webviewRef.current?.reload?.();
  };

  const handleOpenExternal = () => {
    window.electronAPI?.system?.openExternal?.('https://photos.google.com');
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {webviewLoading && !loadFailed && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(255,255,255,0.8)', zIndex: 10,
        }}>
          <Spin size="large" />
        </div>
      )}
      {loadFailed && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 11,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 12, background: '#fff'
        }}>
          <div>Google Photos 加载失败</div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Button onClick={handleRetry}>重试</Button>
            <Button onClick={handleOpenExternal}>在外部浏览器打开</Button>
          </div>
        </div>
      )}
      {/* @ts-ignore */}
      <webview
        ref={webviewRef}
        src="https://photos.google.com"
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        allowpopups="true"
      />
    </div>
  );
};
