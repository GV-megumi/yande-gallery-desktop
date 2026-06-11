/**
 * Google Photos 页面
 * 通过嵌入式浏览器（<webview>）直接访问 photos.google.com
 * 账号登录由 Google 账号页面统一管理
 */

import React from 'react';
import { WebviewEmbedPage } from '../components/WebviewEmbedPage';

export const GooglePhotosPage: React.FC = () => (
  <WebviewEmbedPage src="https://photos.google.com" title="Google Photos" />
);
