/**
 * Gemini 页面
 * 通过嵌入式浏览器（<webview>）直接访问 gemini.google.com
 */

import React, { useState, useEffect, useRef } from 'react';
import { Button } from 'antd';

export const GeminiPage: React.FC = () => {
  const [loadFailed, setLoadFailed] = useState(false);
  const webviewRef = useRef<any>(null);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    // 不再显示加载覆盖层：webview 内容渐进渲染即可，等待全部请求结束反而长时间遮挡页面。
    // 仅主框架的真实加载失败才显示失败覆盖层；子框架失败与跳转中止（errorCode -3）不应遮挡正常页面
    const onFail = (event: any) => {
      if (event?.isMainFrame === false || event?.errorCode === -3) return;
      setLoadFailed(true);
    };

    webview.addEventListener('did-fail-load', onFail);
    return () => {
      webview.removeEventListener('did-fail-load', onFail);
    };
  }, []);

  const handleRetry = () => {
    setLoadFailed(false);
    webviewRef.current?.reload?.();
  };

  const handleOpenExternal = () => {
    window.electronAPI?.system?.openExternal?.('https://gemini.google.com');
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {loadFailed && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 11,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 12, background: '#fff'
        }}>
          <div>Gemini 加载失败</div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Button onClick={handleRetry}>重试</Button>
            <Button onClick={handleOpenExternal}>在外部浏览器打开</Button>
          </div>
        </div>
      )}
      {/* @ts-ignore */}
      <webview
        ref={webviewRef}
        src="https://gemini.google.com"
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        allowpopups="true"
      />
    </div>
  );
};
