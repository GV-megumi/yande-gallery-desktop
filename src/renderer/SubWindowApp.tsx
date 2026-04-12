/**
 * 子窗口应用组件
 * 通过 URL hash 参数决定渲染哪个页面，提供精简布局（无侧边栏）
 * 支持页面类型：tag-search / artist / character / secondary-menu
 */

import React, { useMemo, Suspense } from 'react';
import { App as AntApp } from 'antd';
import { BooruTagSearchPage } from './pages/BooruTagSearchPage';
import { BooruArtistPage } from './pages/BooruArtistPage';
import { BooruCharacterPage } from './pages/BooruCharacterPage';
import { colors, spacing, fontSize } from './styles/tokens';

// 二级菜单页面：使用 React.lazy 实现代码分割
const GalleryPage = React.lazy(() => import('./pages/GalleryPage').then(m => ({ default: m.GalleryPage })));
const InvalidImagesPage = React.lazy(() => import('./pages/InvalidImagesPage').then(m => ({ default: m.InvalidImagesPage })));
const SettingsPage = React.lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const BooruPage = React.lazy(() => import('./pages/BooruPage').then(m => ({ default: m.BooruPage })));
const BooruSettingsPage = React.lazy(() => import('./pages/BooruSettingsPage').then(m => ({ default: m.BooruSettingsPage })));
const BooruFavoritesPage = React.lazy(() => import('./pages/BooruFavoritesPage').then(m => ({ default: m.BooruFavoritesPage })));
const BooruTagManagementPage = React.lazy(() => import('./pages/BooruTagManagementPage').then(m => ({ default: m.BooruTagManagementPage })));
const BooruDownloadHubPage = React.lazy(() => import('./pages/BooruDownloadHubPage').then(m => ({ default: m.BooruDownloadHubPage })));
const BooruPopularPage = React.lazy(() => import('./pages/BooruPopularPage').then(m => ({ default: m.BooruPopularPage })));
const BooruPoolsPage = React.lazy(() => import('./pages/BooruPoolsPage').then(m => ({ default: m.BooruPoolsPage })));
const BooruWikiPage = React.lazy(() => import('./pages/BooruWikiPage').then(m => ({ default: m.BooruWikiPage })));
const BooruUserPage = React.lazy(() => import('./pages/BooruUserPage').then(m => ({ default: m.BooruUserPage })));
const BooruSavedSearchesPage = React.lazy(() => import('./pages/BooruSavedSearchesPage').then(m => ({ default: m.BooruSavedSearchesPage })));
const BooruForumPage = React.lazy(() => import('./pages/BooruForumPage').then(m => ({ default: m.BooruForumPage })));
const BooruServerFavoritesPage = React.lazy(() => import('./pages/BooruServerFavoritesPage').then(m => ({ default: m.BooruServerFavoritesPage })));
const GoogleDrivePage = React.lazy(() => import('./pages/GoogleDrivePage').then(m => ({ default: m.GoogleDrivePage })));
const GooglePhotosPage = React.lazy(() => import('./pages/GooglePhotosPage').then(m => ({ default: m.GooglePhotosPage })));
const GeminiPage = React.lazy(() => import('./pages/GeminiPage').then(m => ({ default: m.GeminiPage })));

interface SubWindowRoute {
  type: 'tag-search' | 'artist' | 'character' | 'secondary-menu' | 'unknown';
  params: URLSearchParams;
}

/** 解析 URL hash 获取子窗口路由信息 */
function parseHash(hash: string): SubWindowRoute {
  // hash 格式: "#tag-search?tag=xxx&siteId=1"
  const cleaned = hash.startsWith('#') ? hash.slice(1) : hash;
  const [type, queryStr] = cleaned.split('?');
  const params = new URLSearchParams(queryStr || '');

  if (['tag-search', 'artist', 'character', 'secondary-menu'].includes(type)) {
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

/** 在子窗口中打开用户页面（再开一个子窗口） */
const openUserWindow = (params: { userId?: number; username?: string }, _siteId?: number | null) => {
  console.log('[SubWindowApp] 打开用户子窗口:', params);
  // 用户页面目前没有独立子窗口类型，使用二级菜单方式打开
  window.electronAPI?.window.openSecondaryMenu('booru', 'user-profile');
};

/** 二级菜单页面的中文标题映射 */
const SECONDARY_MENU_TITLES: Record<string, Record<string, string>> = {
  gallery: {
    recent: '最近',
    all: '全部',
    galleries: '图集',
    'invalid-images': '无效图片',
    settings: '设置',
  },
  booru: {
    posts: '帖子',
    popular: '热门',
    pools: '图集',
    forums: '论坛',
    'user-profile': '用户',
    favorites: '收藏',
    'server-favorites': '服务端喜欢',
    'tag-management': '标签管理',
    download: '下载',
    'saved-searches': '保存的搜索',
    'booru-settings': '站点配置',
    settings: '设置',
  },
  google: {
    gdrive: 'Google Drive',
    gphotos: 'Google Photos',
    gemini: 'Gemini',
  },
};

/** Suspense 加载中占位 */
const suspenseFallback = (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
    <div style={{ color: colors.textTertiary }}>加载中...</div>
  </div>
);

/** 渲染二级菜单页面 */
const renderSecondaryMenuPage = (section: string, key: string, tab?: string): React.ReactNode => {
  // Gallery 区域
  if (section === 'gallery') {
    if (key === 'settings') return <SettingsPage />;
    if (key === 'invalid-images') return <InvalidImagesPage />;
    return <GalleryPage subTab={key as 'recent' | 'all' | 'galleries'} />;
  }

  // Booru 区域
  if (section === 'booru') {
    if (key === 'posts') return <BooruPage onTagClick={openTagSearchWindow} onArtistClick={openArtistWindow} onCharacterClick={openCharacterWindow} />;
    if (key === 'popular') return <BooruPopularPage onTagClick={openTagSearchWindow} onArtistClick={openArtistWindow} />;
    if (key === 'pools') return <BooruPoolsPage onTagClick={openTagSearchWindow} onArtistClick={openArtistWindow} />;
    if (key === 'forums') return <BooruForumPage onUserClick={openUserWindow} />;
    if (key === 'user-profile') return <BooruUserPage onTagClick={openTagSearchWindow} />;
    if (key === 'favorites') return <BooruFavoritesPage onTagClick={openTagSearchWindow} />;
    if (key === 'server-favorites') return <BooruServerFavoritesPage onTagClick={openTagSearchWindow} />;
    if (key === 'tag-management') return <BooruTagManagementPage onTagClick={openTagSearchWindow} defaultTab={(tab as 'favorite' | 'blacklist') ?? 'favorite'} />;
    if (key === 'download') return <BooruDownloadHubPage defaultTab={(tab as 'downloads' | 'bulk') ?? 'downloads'} />;
    if (key === 'saved-searches') return <BooruSavedSearchesPage />;
    if (key === 'booru-settings') return <BooruSettingsPage />;
    if (key === 'settings') return <SettingsPage />;
  }

  // Google 区域
  if (section === 'google') {
    if (key === 'gdrive') return <GoogleDrivePage />;
    if (key === 'gphotos') return <GooglePhotosPage />;
    if (key === 'gemini') return <GeminiPage />;
  }

  return null;
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

    case 'secondary-menu': {
      const section = route.params.get('section') || '';
      const key = route.params.get('key') || '';
      const tab = route.params.get('tab') || undefined;
      // 设置窗口标题
      const sectionTitles = SECONDARY_MENU_TITLES[section];
      const pageTitle = sectionTitles?.[key] || key;
      const sectionLabel = section === 'gallery' ? '图库' : section === 'booru' ? 'Booru' : '应用';
      document.title = `${pageTitle} - ${sectionLabel}`;

      // Google 嵌入页面需要全屏无内边距
      const isEmbedPage = section === 'google' && (key === 'gdrive' || key === 'gphotos' || key === 'gemini');

      return (
        <div style={{
          height: '100vh',
          overflow: isEmbedPage ? 'hidden' : 'auto',
          background: colors.bgLight,
          padding: isEmbedPage ? 0 : spacing.lg,
        }}>
          <Suspense fallback={suspenseFallback}>
            {renderSecondaryMenuPage(section, key, tab)}
          </Suspense>
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
