/**
 * 子窗口应用组件
 * 通过 URL hash 参数决定渲染哪个页面，提供精简布局（无侧边栏）
 * 支持页面类型：tag-search / artist / character
 */

import React, { useMemo } from 'react';
import { App as AntApp } from 'antd';
import { BooruTagSearchPage } from './pages/BooruTagSearchPage';
import { BooruArtistPage } from './pages/BooruArtistPage';
import { BooruCharacterPage } from './pages/BooruCharacterPage';
import { colors, spacing, fontSize } from './styles/tokens';

interface SubWindowRoute {
  type: 'tag-search' | 'artist' | 'character' | 'unknown';
  params: URLSearchParams;
}

/** 解析 URL hash 获取子窗口路由信息 */
function parseHash(hash: string): SubWindowRoute {
  // hash 格式: "#tag-search?tag=xxx&siteId=1"
  const cleaned = hash.startsWith('#') ? hash.slice(1) : hash;
  const [type, queryStr] = cleaned.split('?');
  const params = new URLSearchParams(queryStr || '');

  if (['tag-search', 'artist', 'character'].includes(type)) {
    return { type: type as SubWindowRoute['type'], params };
  }
  return { type: 'unknown', params };
}

/** 在子窗口中打开新标签搜索（再开一个子窗口） */
const openTagSearchWindow = (tag: string, siteId?: number | null) => {
  console.log('[SubWindowApp] 打开标签搜索子窗口:', tag, siteId);
  window.electronAPI?.window.openTagSearch(tag, siteId);
};

/** 在子窗口中打开艺术家页面（再开一个子窗口） */
const openArtistWindow = (name: string, siteId?: number | null) => {
  console.log('[SubWindowApp] 打开艺术家子窗口:', name, siteId);
  window.electronAPI?.window.openArtist(name, siteId);
};

/** 在子窗口中打开角色页面（再开一个子窗口） */
const openCharacterWindow = (name: string, siteId?: number | null) => {
  console.log('[SubWindowApp] 打开角色子窗口:', name, siteId);
  window.electronAPI?.window.openCharacter(name, siteId);
};

const SubWindowContent: React.FC = () => {
  const route = useMemo(() => parseHash(window.location.hash), []);

  const handleClose = () => {
    window.close();
  };

  switch (route.type) {
    case 'tag-search': {
      const tag = route.params.get('tag') || '';
      const siteIdStr = route.params.get('siteId');
      const rawSiteId = siteIdStr ? Number(siteIdStr) : null;
      const siteId = rawSiteId !== null && Number.isNaN(rawSiteId) ? null : rawSiteId;
      // 设置窗口标题
      document.title = `${tag.replace(/_/g, ' ')} - Tag Search`;
      return (
        <div style={{
          height: '100vh',
          overflow: 'auto',
          background: colors.bgLight,
          padding: spacing.lg,
        }}>
          <BooruTagSearchPage
            initialTag={tag}
            initialSiteId={siteId}
            onBack={handleClose}
            onArtistClick={openArtistWindow}
            onDetailTagClick={openTagSearchWindow}
          />
        </div>
      );
    }

    case 'artist': {
      const name = route.params.get('name') || '';
      const siteIdStr = route.params.get('siteId');
      const rawSiteId = siteIdStr ? Number(siteIdStr) : null;
      const siteId = rawSiteId !== null && Number.isNaN(rawSiteId) ? null : rawSiteId;
      document.title = `${name.replace(/_/g, ' ')} - Artist`;
      return (
        <div style={{
          height: '100vh',
          overflow: 'auto',
          background: colors.bgLight,
          padding: spacing.lg,
        }}>
          <BooruArtistPage
            artistName={name}
            initialSiteId={siteId}
            onBack={handleClose}
            onTagClick={openTagSearchWindow}
            onDetailTagClick={openTagSearchWindow}
          />
        </div>
      );
    }

    case 'character': {
      const name = route.params.get('name') || '';
      const siteIdStr = route.params.get('siteId');
      const rawSiteId = siteIdStr ? Number(siteIdStr) : null;
      const siteId = rawSiteId !== null && Number.isNaN(rawSiteId) ? null : rawSiteId;
      document.title = `${name.replace(/_/g, ' ')} - Character`;
      return (
        <div style={{
          height: '100vh',
          overflow: 'auto',
          background: colors.bgLight,
          padding: spacing.lg,
        }}>
          <BooruCharacterPage
            characterName={name}
            initialSiteId={siteId}
            onBack={handleClose}
            onTagClick={openTagSearchWindow}
            onDetailTagClick={openTagSearchWindow}
          />
        </div>
      );
    }

    default:
      return (
        <div style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: colors.bgLight,
          color: colors.textTertiary,
          fontSize: fontSize.lg,
        }}>
          Unknown page type
        </div>
      );
  }
};

export const SubWindowApp: React.FC = () => (
  <AntApp>
    <SubWindowContent />
  </AntApp>
);
