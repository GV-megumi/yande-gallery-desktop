/**
 * Gemini 页面
 * 通过嵌入式浏览器（<webview>）直接访问 gemini.google.com
 */

import React from 'react';
import { WebviewEmbedPage } from '../components/WebviewEmbedPage';

export const GeminiPage: React.FC = () => (
  <WebviewEmbedPage src="https://gemini.google.com" title="Gemini" />
);
