/**
 * Webview 嵌入页通用组件
 * 通过嵌入式浏览器（<webview>）直接访问外部站点，
 * 提供统一的加载失败覆盖层、重试与"在外部浏览器打开"退路。
 * Gemini / Google Drive / Google Photos 等嵌入页共用此实现。
 */

import React, { useState, useEffect, useRef } from 'react';
import { Button } from 'antd';

export interface WebviewEmbedPageProps {
  /** webview 加载的站点地址，同时用于"在外部浏览器打开" */
  src: string;
  /** 失败覆盖层中显示的站点名称，如 "Gemini" */
  title: string;
}

export const WebviewEmbedPage: React.FC<WebviewEmbedPageProps> = ({ src, title }) => {
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
    // 主框架后续加载成功（SPA 自行恢复、重试、站内跳转）时清除失败覆盖层，
    // 否则一次瞬时失败会让覆盖层永久挡住已恢复的页面
    const onFinish = () => {
      setLoadFailed(false);
    };

    webview.addEventListener('did-fail-load', onFail);
    webview.addEventListener('did-finish-load', onFinish);
    return () => {
      webview.removeEventListener('did-fail-load', onFail);
      webview.removeEventListener('did-finish-load', onFinish);
    };
  }, []);

  const handleRetry = () => {
    setLoadFailed(false);
    webviewRef.current?.reload?.();
  };

  const handleOpenExternal = () => {
    window.electronAPI?.system?.openExternal?.(src);
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {loadFailed && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 11,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 12, background: '#fff'
        }}>
          <div>{title} 加载失败</div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Button onClick={handleRetry}>重试</Button>
            <Button onClick={handleOpenExternal}>在外部浏览器打开</Button>
          </div>
        </div>
      )}
      <webview
        ref={webviewRef}
        src={src}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        // @ts-ignore React 类型把 allowpopups 声明为 boolean，但它是 HTML 属性，需要字符串才会渲染到 DOM
        allowpopups="true"
      />
    </div>
  );
};
