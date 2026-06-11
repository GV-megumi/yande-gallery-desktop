/**
 * Google Drive 页面
 * 通过嵌入式浏览器（<webview>）直接访问 drive.google.com
 * 账号登录在 webview 内由用户自行完成
 */

import React from 'react';
import { WebviewEmbedPage } from '../components/WebviewEmbedPage';

export const GoogleDrivePage: React.FC = () => (
  <WebviewEmbedPage src="https://drive.google.com" title="Google Drive" />
);
