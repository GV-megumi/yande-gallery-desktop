import React, { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { Layout, Menu, message, App as AntApp } from 'antd';
import { useTheme } from './hooks/useTheme';
import { useLocale } from './locales';
import { useKeyboardShortcuts, SHORTCUT_KEYS } from './hooks/useKeyboardShortcuts';
import { ShortcutsModal } from './components/ShortcutsModal';
import {
  PictureOutlined, SettingOutlined, ClockCircleOutlined,
  AppstoreOutlined, CloudOutlined, BookOutlined,
  CloudDownloadOutlined, StarOutlined, FolderOutlined,
  SunOutlined, MoonOutlined, StopOutlined,
  FireOutlined, DatabaseOutlined, HeartOutlined,
  SearchOutlined, SmileOutlined, GoogleOutlined,
  HddOutlined, CameraOutlined
} from '@ant-design/icons';

// 页面级组件：使用 React.lazy 实现代码分割
const GalleryPage = React.lazy(() => import('./pages/GalleryPage').then(m => ({ default: m.GalleryPage })));
const SettingsPage = React.lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const BooruPage = React.lazy(() => import('./pages/BooruPage').then(m => ({ default: m.BooruPage })));
const BooruSettingsPage = React.lazy(() => import('./pages/BooruSettingsPage').then(m => ({ default: m.BooruSettingsPage })));
const BooruDownloadPage = React.lazy(() => import('./pages/BooruDownloadPage'));
const BooruBulkDownloadPage = React.lazy(() => import('./pages/BooruBulkDownloadPage').then(m => ({ default: m.BooruBulkDownloadPage })));
const BooruTagSearchPage = React.lazy(() => import('./pages/BooruTagSearchPage').then(m => ({ default: m.BooruTagSearchPage })));
const BooruFavoritesPage = React.lazy(() => import('./pages/BooruFavoritesPage').then(m => ({ default: m.BooruFavoritesPage })));
const FavoriteTagsPage = React.lazy(() => import('./pages/FavoriteTagsPage').then(m => ({ default: m.FavoriteTagsPage })));
const BlacklistedTagsPage = React.lazy(() => import('./pages/BlacklistedTagsPage').then(m => ({ default: m.BlacklistedTagsPage })));
const BooruPopularPage = React.lazy(() => import('./pages/BooruPopularPage').then(m => ({ default: m.BooruPopularPage })));
const BooruPoolsPage = React.lazy(() => import('./pages/BooruPoolsPage').then(m => ({ default: m.BooruPoolsPage })));
const BooruArtistPage = React.lazy(() => import('./pages/BooruArtistPage').then(m => ({ default: m.BooruArtistPage })));
const BooruCharacterPage = React.lazy(() => import('./pages/BooruCharacterPage').then(m => ({ default: m.BooruCharacterPage })));
const BooruSavedSearchesPage = React.lazy(() => import('./pages/BooruSavedSearchesPage').then(m => ({ default: m.BooruSavedSearchesPage })));
const BooruServerFavoritesPage = React.lazy(() => import('./pages/BooruServerFavoritesPage').then(m => ({ default: m.BooruServerFavoritesPage })));
const GoogleDrivePage = React.lazy(() => import('./pages/GoogleDrivePage').then(m => ({ default: m.GoogleDrivePage })));
const GooglePhotosPage = React.lazy(() => import('./pages/GooglePhotosPage').then(m => ({ default: m.GooglePhotosPage })));
import { colors, spacing, radius, layout, fontSize, iconColors, shadows } from './styles/tokens';

const { Content, Sider } = Layout;

type MenuItem = {
  key: string;
  icon: React.ReactNode;
  label: string;
};

/** 侧边栏图标：小圆角方块 + 品牌色 */
const IconBadge: React.FC<{ color: string; icon: React.ReactNode }> = ({ color, icon }) => (
  <span style={{
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 26,
    height: 26,
    borderRadius: 6,
    background: color,
    color: '#FFFFFF',
    fontSize: 13,
    flexShrink: 0,
  }}>
    {icon}
  </span>
);

/** 侧边栏小圆点图标（子菜单用） */
const DotIcon: React.FC<{ color: string; icon: React.ReactNode }> = ({ color, icon }) => (
  <span style={{ color, fontSize: 15, display: 'inline-flex', alignItems: 'center' }}>
    {icon}
  </span>
);

function buildMainMenuItems(t: (path: string) => string): MenuItem[] {
  return [
    { key: 'gallery', icon: <IconBadge color={iconColors.gallery} icon={<PictureOutlined />} />, label: t('menu.gallery') },
    { key: 'booru', icon: <IconBadge color={iconColors.booru} icon={<CloudOutlined />} />, label: t('menu.booru') },
    { key: 'google', icon: <IconBadge color={iconColors.google} icon={<GoogleOutlined />} />, label: 'Google' },
  ];
}

function buildGoogleSubMenuItems(): MenuItem[] {
  return [
    { key: 'gdrive', icon: <DotIcon color={iconColors.gdrive} icon={<HddOutlined />} />, label: 'Drive' },
    { key: 'gphotos', icon: <DotIcon color={iconColors.gphotos} icon={<CameraOutlined />} />, label: 'Photos' },
  ];
}

function buildGallerySubMenuItems(t: (path: string) => string): MenuItem[] {
  return [
    { key: 'recent', icon: <DotIcon color={iconColors.recent} icon={<ClockCircleOutlined />} />, label: t('menu.recent') },
    { key: 'all', icon: <DotIcon color={iconColors.all} icon={<AppstoreOutlined />} />, label: t('menu.all') },
    { key: 'galleries', icon: <DotIcon color={iconColors.galleries} icon={<FolderOutlined />} />, label: t('menu.galleries') }
  ];
}

function buildBooruSubMenuItems(t: (path: string) => string): MenuItem[] {
  return [
    { key: 'posts', icon: <DotIcon color={iconColors.posts} icon={<CloudOutlined />} />, label: t('menu.posts') },
    { key: 'popular', icon: <DotIcon color={iconColors.popular} icon={<FireOutlined />} />, label: t('menu.popular') },
    { key: 'pools', icon: <DotIcon color={iconColors.pools} icon={<DatabaseOutlined />} />, label: t('menu.pools') },
    { key: 'favorites', icon: <DotIcon color={iconColors.favorites} icon={<BookOutlined />} />, label: t('menu.favorites') },
    { key: 'server-favorites', icon: <DotIcon color={iconColors.serverFavorites} icon={<HeartOutlined />} />, label: t('menu.serverFavorites') },
    { key: 'favorite-tags', icon: <DotIcon color={iconColors.favoriteTags} icon={<StarOutlined />} />, label: t('menu.favoriteTags') },
    { key: 'blacklisted-tags', icon: <DotIcon color="#EF4444" icon={<StopOutlined />} />, label: t('menu.blacklist') },
    { key: 'downloads', icon: <DotIcon color={iconColors.downloads} icon={<CloudDownloadOutlined />} />, label: t('menu.downloads') },
    { key: 'bulk-download', icon: <DotIcon color={iconColors.bulkDownload} icon={<CloudDownloadOutlined />} />, label: t('menu.bulkDownload') },
    { key: 'saved-searches', icon: <DotIcon color="#6366F1" icon={<SearchOutlined />} />, label: t('menu.savedSearches') },
  ];
}

/** 导航栈条目类型（参考 Boorusama 的 GoRouter push/pop 机制） */
type NavigationEntry =
  | { type: 'tag-search'; tag: string; siteId?: number | null }
  | { type: 'artist'; name: string; siteId?: number | null }
  | { type: 'character'; name: string; siteId?: number | null };

export const AppContent: React.FC = () => {
  const [selectedKey, setSelectedKey] = useState('gallery');
  const [selectedSubKey, setSelectedSubKey] = useState('recent');
  const [selectedBooruSubKey, setSelectedBooruSubKey] = useState('posts');
  const [selectedGoogleSubKey, setSelectedGoogleSubKey] = useState('gdrive');
  const [loading, setLoading] = useState(true);
  // 导航栈：支持嵌套页面（详情→标签搜索→详情→标签搜索→...）
  const [navigationStack, setNavigationStack] = useState<NavigationEntry[]>([]);
  const { isDark, themeMode, setThemeMode } = useTheme();
  const { t } = useLocale();
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);

  const mainMenuItems = useMemo(() => buildMainMenuItems(t), [t]);
  const gallerySubMenuItems = useMemo(() => buildGallerySubMenuItems(t), [t]);
  const booruSubMenuItems = useMemo(() => buildBooruSubMenuItems(t), [t]);
  const googleSubMenuItems = useMemo(() => buildGoogleSubMenuItems(), []);

  const toggleTheme = useCallback(() => {
    setThemeMode(isDark ? 'light' : 'dark');
  }, [isDark, setThemeMode]);

  const openSettings = useCallback(() => {
    if (selectedKey === 'gallery') setSelectedSubKey('settings');
    else setSelectedBooruSubKey('settings');
  }, [selectedKey]);

  const focusSearch = useCallback(() => {
    const searchInput = document.querySelector<HTMLInputElement>(
      '.ant-input-search input, .ant-input-affix-wrapper input, input[type="search"]'
    );
    if (searchInput) { searchInput.focus(); searchInput.select(); }
  }, []);

  useKeyboardShortcuts([
    { key: SHORTCUT_KEYS.TOGGLE_THEME, handler: toggleTheme, description: t('shortcuts.toggleTheme') },
    { key: SHORTCUT_KEYS.OPEN_SETTINGS, handler: openSettings, description: t('shortcuts.openSettings') },
    { key: SHORTCUT_KEYS.FOCUS_SEARCH, handler: focusSearch, description: t('shortcuts.focusSearch'), enableInInput: true },
    { key: SHORTCUT_KEYS.SHOW_SHORTCUTS, handler: () => setShortcutsModalOpen(true), description: t('shortcuts.showShortcuts') },
    { key: SHORTCUT_KEYS.GO_BACK, handler: () => { if (navigationStack.length > 0) popNavigation(); }, description: t('shortcuts.goBack') },
  ]);

  useEffect(() => {
    console.log('[App] 应用启动，初始化数据库');
    const initDatabase = async () => {
      try {
        if (window.electronAPI) {
          const result = await window.electronAPI.db.init();
          if (result.success) {
            console.log('[App] 数据库初始化成功');
          } else {
            console.error('[App] 数据库初始化失败:', result.error);
            message.error('数据库初始化失败: ' + result.error);
          }
        }
      } catch (error) {
        console.error('Failed to initialize database:', error);
        message.error('数据库初始化失败');
      } finally {
        setLoading(false);
      }
    };
    initDatabase();
  }, []);

  useEffect(() => {
    if (selectedKey === 'gallery' && !selectedSubKey) setSelectedSubKey('recent');
    if (selectedKey === 'booru' && !selectedBooruSubKey) setSelectedBooruSubKey('posts');
    if (selectedKey === 'google' && !selectedGoogleSubKey) setSelectedGoogleSubKey('gdrive');
  }, [selectedKey, selectedSubKey, selectedBooruSubKey, selectedGoogleSubKey]);

  // 导航栈操作：push 压栈（保留下层页面），pop 弹栈（返回上一页）
  const pushNavigation = useCallback((entry: NavigationEntry) => {
    console.log('[App] 导航栈 push:', entry.type, entry.type === 'tag-search' ? entry.tag : entry.name);
    setNavigationStack(prev => [...prev, entry]);
  }, []);

  const popNavigation = useCallback(() => {
    console.log('[App] 导航栈 pop');
    setNavigationStack(prev => prev.slice(0, -1));
  }, []);

  const navigateToTagSearch = useCallback((tag: string, siteId?: number | null) => {
    pushNavigation({ type: 'tag-search', tag, siteId });
  }, [pushNavigation]);

  const navigateToArtist = useCallback((name: string, siteId?: number | null) => {
    pushNavigation({ type: 'artist', name, siteId });
  }, [pushNavigation]);

  const navigateToCharacter = useCallback((name: string, siteId?: number | null) => {
    pushNavigation({ type: 'character', name, siteId });
  }, [pushNavigation]);

  const handleSavedSearchRun = (query: string, siteId?: number | null) => {
    console.log('[App] 执行保存的搜索:', query, siteId);
    setSelectedBooruSubKey('posts');
    navigateToTagSearch(query, siteId);
  };

  // 导航栈顶部条目（当前显示的叠加页面）
  const topNavEntry = navigationStack.length > 0 ? navigationStack[navigationStack.length - 1] : null;

  const pageTitle = useMemo(() => {
    // 导航栈有内容时，显示栈顶页面的标题
    if (topNavEntry) {
      switch (topNavEntry.type) {
        case 'character': return { main: '角色', sub: topNavEntry.name.replace(/_/g, ' ') };
        case 'artist': return { main: '艺术家', sub: topNavEntry.name.replace(/_/g, ' ') };
        case 'tag-search': return { main: t('pageTitle.tagSearch'), sub: topNavEntry.tag.replace(/_/g, ' ') };
      }
    }
    switch (selectedKey) {
      case 'gallery':
        if (selectedSubKey === 'settings') return { main: t('pageTitle.settings') };
        return { main: t('pageTitle.gallery'), sub: gallerySubMenuItems.find(i => i.key === selectedSubKey)?.label };
      case 'booru':
        if (selectedBooruSubKey === 'booru-settings') return { main: t('pageTitle.booru'), sub: t('menu.siteConfig') };
        if (selectedBooruSubKey === 'settings') return { main: t('pageTitle.settings') };
        return { main: t('pageTitle.booru'), sub: booruSubMenuItems.find(i => i.key === selectedBooruSubKey)?.label };
      case 'google':
        return { main: 'Google', sub: googleSubMenuItems.find(i => i.key === selectedGoogleSubKey)?.label };
      default:
        return { main: t('pageTitle.booru') };
    }
  }, [selectedKey, selectedSubKey, selectedBooruSubKey, selectedGoogleSubKey, topNavEntry, t, gallerySubMenuItems, booruSubMenuItems, googleSubMenuItems]);

  /** 渲染导航栈中的单个条目 */
  const renderNavigationEntry = (entry: NavigationEntry, index: number) => {
    const isSuspended = index < navigationStack.length - 1;
    switch (entry.type) {
      case 'tag-search':
        return (
          <BooruTagSearchPage
            initialTag={entry.tag}
            initialSiteId={entry.siteId}
            onBack={popNavigation}
            onTagClick={navigateToTagSearch}
            onArtistClick={navigateToArtist}
            onCharacterClick={navigateToCharacter}
            suspended={isSuspended}
          />
        );
      case 'artist':
        return (
          <BooruArtistPage
            artistName={entry.name}
            initialSiteId={entry.siteId}
            onBack={popNavigation}
            onTagClick={navigateToTagSearch}
            suspended={isSuspended}
          />
        );
      case 'character':
        return (
          <BooruCharacterPage
            characterName={entry.name}
            initialSiteId={entry.siteId}
            onBack={popNavigation}
            onTagClick={navigateToTagSearch}
            suspended={isSuspended}
          />
        );
    }
  };

  /** 渲染基础页面（底层页面） */
  const renderBasePage = () => {
    const baseSuspended = navigationStack.length > 0;
    switch (selectedKey) {
      case 'gallery':
        if (selectedSubKey === 'settings') return <SettingsPage />;
        return <GalleryPage subTab={selectedSubKey as "recent" | "all" | "galleries" | undefined} />;
      case 'booru':
        if (selectedBooruSubKey === 'posts') return <BooruPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} onCharacterClick={navigateToCharacter} suspended={baseSuspended} />;
        if (selectedBooruSubKey === 'popular') return <BooruPopularPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} suspended={baseSuspended} />;
        if (selectedBooruSubKey === 'pools') return <BooruPoolsPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} suspended={baseSuspended} />;
        if (selectedBooruSubKey === 'favorites') return <BooruFavoritesPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} suspended={baseSuspended} />;
        if (selectedBooruSubKey === 'server-favorites') return <BooruServerFavoritesPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} suspended={baseSuspended} />;
        if (selectedBooruSubKey === 'favorite-tags') return <FavoriteTagsPage onTagClick={navigateToTagSearch} />;
        if (selectedBooruSubKey === 'blacklisted-tags') return <BlacklistedTagsPage />;
        if (selectedBooruSubKey === 'downloads') return <BooruDownloadPage />;
        if (selectedBooruSubKey === 'bulk-download') return <BooruBulkDownloadPage />;
        if (selectedBooruSubKey === 'saved-searches') return <BooruSavedSearchesPage onRunSearch={handleSavedSearchRun} />;
        if (selectedBooruSubKey === 'booru-settings') return <BooruSettingsPage />;
        if (selectedBooruSubKey === 'settings') return <SettingsPage />;
        return <BooruPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} onCharacterClick={navigateToCharacter} suspended={baseSuspended} />;
      case 'google':
        if (selectedGoogleSubKey === 'gdrive') return <GoogleDrivePage />;
        if (selectedGoogleSubKey === 'gphotos') return <GooglePhotosPage />;
        return <GoogleDrivePage />;
      default:
        return <BooruPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} onCharacterClick={navigateToCharacter} suspended={baseSuspended} />;
    }
  };

  // 是否有叠加页面（导航栈非空时表示有叠加页面）
  const hasOverlay = navigationStack.length > 0;

  /** Suspense 加载中占位 */
  const suspenseFallback = (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
      <div style={{ color: colors.textTertiary }}>加载中...</div>
    </div>
  );

  /** 渲染基础页面内容（不含叠加页面） */
  const renderBaseContent = () => {
    if (loading) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
          <h2 style={{ color: colors.textTertiary, fontWeight: 400, fontSize: fontSize.lg }}>{t('app.initializing')}</h2>
        </div>
      );
    }

    const basePage = renderBasePage();
    const hasStack = navigationStack.length > 0;

    // 始终保持一致的 React 树结构，避免基础页面因树结构变化而被卸载/重新挂载
    // 导航栈非空时，基础页面用 display:none 隐藏但保持挂载（保留状态）
    return (
      <>
        <div style={hasStack ? { display: 'none' } : undefined}>{basePage}</div>
        {navigationStack.map((entry, index) => {
          const isTop = index === navigationStack.length - 1;
          return (
            <div key={`nav-${entry.type}-${index}`} style={isTop ? undefined : { display: 'none' }}>
              {renderNavigationEntry(entry, index)}
            </div>
          );
        })}
      </>
    );
  };

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden', background: colors.bgLight }}>
      {/* 侧边栏 */}
      <Sider
        width={layout.sidebarWidth}
        theme={isDark ? 'dark' : 'light'}
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          overflow: 'hidden',
          background: colors.sidebarBg,
          borderRight: `1px solid ${colors.separator}`,
        }}
      >
        {/* Logo 区域 */}
        <div style={{
          padding: '20px 16px 12px',
          flexShrink: 0,
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            {/* Logo 图标 */}
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: `linear-gradient(135deg, ${colors.primary}, ${colors.accent})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
              fontSize: 16,
              fontWeight: 700,
              flexShrink: 0,
            }}>
              Y
            </div>
            <div>
              <div style={{
                fontSize: 15,
                fontWeight: 700,
                letterSpacing: '-0.3px',
                color: colors.textPrimary,
                lineHeight: '18px',
                fontFamily: 'var(--font-display, sans-serif)',
              }}>
                Yande Gallery
              </div>
              <div style={{
                fontSize: 10,
                color: colors.textTertiary,
                letterSpacing: '0.5px',
                textTransform: 'uppercase' as const,
                fontWeight: 600,
                lineHeight: '12px',
                marginTop: 2,
              }}>
                Desktop
              </div>
            </div>
          </div>
        </div>

        {/* 主导航 */}
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={mainMenuItems}
          onClick={({ key }) => {
            console.log(`[App] 主菜单切换: ${key}`);
            setSelectedKey(key);
            setNavigationStack([]); // 切换主菜单时清空导航栈
            if (key === 'gallery') setSelectedSubKey('recent');
            if (key === 'google') setSelectedGoogleSubKey('gdrive');
          }}
          style={{
            borderBottom: `1px solid ${colors.separator}`,
            flexShrink: 0,
            background: 'transparent',
            borderRight: 'none',
            paddingBottom: spacing.xs,
          }}
        />

        {/* 子菜单 */}
        {selectedKey === 'gallery' && (
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{
              padding: `${spacing.md}px ${spacing.lg}px ${spacing.xs}px`,
              fontSize: 10,
              fontWeight: 700,
              color: colors.textTertiary,
              textTransform: 'uppercase' as const,
              letterSpacing: '1px',
            }}>
              {t('menu.browse')}
            </div>
            <Menu
              mode="inline"
              selectedKeys={[selectedSubKey]}
              items={gallerySubMenuItems}
              onClick={({ key }) => {
                console.log(`[App] 图库子菜单: ${key}`);
                setSelectedSubKey(key);
              }}
              style={{ background: 'transparent', borderRight: 'none' }}
            />
            <div style={{ flex: 1 }} />
            <div style={{ borderTop: `1px solid ${colors.separator}`, paddingTop: spacing.xs }}>
              <Menu
                mode="inline"
                selectedKeys={[selectedSubKey]}
                items={[
                  { key: 'settings', icon: <DotIcon color={iconColors.settings} icon={<SettingOutlined />} />, label: t('menu.settings') }
                ]}
                onClick={({ key }) => setSelectedSubKey(key)}
                style={{ background: 'transparent', borderRight: 'none' }}
              />
            </div>
          </div>
        )}
        {selectedKey === 'booru' && (
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{
              padding: `${spacing.md}px ${spacing.lg}px ${spacing.xs}px`,
              fontSize: 10,
              fontWeight: 700,
              color: colors.textTertiary,
              textTransform: 'uppercase' as const,
              letterSpacing: '1px',
            }}>
              BOORU
            </div>
            <Menu
              mode="inline"
              selectedKeys={[selectedBooruSubKey]}
              items={booruSubMenuItems}
              onClick={({ key }) => {
                console.log(`[App] Booru子菜单: ${key}`);
                setSelectedBooruSubKey(key);
                setNavigationStack([]); // 切换子菜单时清空导航栈
              }}
              style={{ background: 'transparent', borderRight: 'none' }}
            />
            <div style={{ flex: 1 }} />
            <div style={{ borderTop: `1px solid ${colors.separator}`, paddingTop: spacing.xs }}>
              <Menu
                mode="inline"
                selectedKeys={[selectedBooruSubKey]}
                items={[
                  { key: 'booru-settings', icon: <DotIcon color={iconColors.booruSettings} icon={<CloudOutlined />} />, label: t('menu.siteConfig') },
                  { key: 'settings', icon: <DotIcon color={iconColors.settings} icon={<SettingOutlined />} />, label: t('menu.settings') },
                ]}
                onClick={({ key }) => setSelectedBooruSubKey(key)}
                style={{ background: 'transparent', borderRight: 'none' }}
              />
            </div>
          </div>
        )}
        {selectedKey === 'google' && (
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{
              padding: `${spacing.md}px ${spacing.lg}px ${spacing.xs}px`,
              fontSize: 10,
              fontWeight: 700,
              color: colors.textTertiary,
              textTransform: 'uppercase' as const,
              letterSpacing: '1px',
            }}>
              GOOGLE
            </div>
            <Menu
              mode="inline"
              selectedKeys={[selectedGoogleSubKey]}
              items={googleSubMenuItems}
              onClick={({ key }) => {
                console.log(`[App] Google子菜单: ${key}`);
                setSelectedGoogleSubKey(key);
              }}
              style={{ background: 'transparent', borderRight: 'none' }}
            />
            <div style={{ flex: 1 }} />
          </div>
        )}

        {/* 底部主题切换 */}
        <div style={{
          flexShrink: 0,
          padding: `${spacing.sm}px ${spacing.md}px`,
          borderTop: `1px solid ${colors.separator}`,
        }}>
          <button
            onClick={toggleTheme}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              width: '100%',
              padding: '8px 12px',
              borderRadius: radius.sm,
              border: 'none',
              background: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)',
              color: colors.textSecondary,
              fontSize: fontSize.sm,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)';
            }}
          >
            {isDark ? <SunOutlined /> : <MoonOutlined />}
            {isDark ? t('app.lightMode') : t('app.darkMode')}
          </button>
        </div>
      </Sider>

      {/* 主内容区 */}
      <Layout style={{
        height: '100vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: colors.bgLight,
      }}>
        {/* 标题栏 */}
        <div style={{
          padding: `0 ${spacing.xl}px`,
          height: layout.headerHeight,
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
          background: isDark
            ? 'rgba(15, 17, 23, 0.80)'
            : 'rgba(248, 248, 252, 0.80)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          borderBottom: `1px solid ${colors.separator}`,
          zIndex: 10,
        }}>
          <span style={{
            fontSize: fontSize.xl,
            fontWeight: 700,
            letterSpacing: '-0.3px',
            color: colors.textPrimary,
            fontFamily: 'var(--font-display, sans-serif)',
          }}>
            {pageTitle.main}
          </span>
          {pageTitle.sub && (
            <>
              <span style={{
                fontSize: fontSize.xl,
                fontWeight: 700,
                color: colors.textQuaternary,
                margin: '0 8px',
                fontFamily: 'var(--font-display, sans-serif)',
              }}>
                /
              </span>
              <span style={{
                fontSize: fontSize.xl,
                fontWeight: 700,
                letterSpacing: '-0.3px',
                color: colors.textTertiary,
                fontFamily: 'var(--font-display, sans-serif)',
              }}>
                {pageTitle.sub}
              </span>
            </>
          )}
        </div>

        {/* 内容区 */}
        <Content
          style={{
            margin: 0,
            flex: 1,
            height: 0,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* 页面内容：renderBaseContent 内部管理基础页面与导航栈的显示/隐藏 */}
          <div
            className="ios-page-enter noise-bg"
            key={`${selectedKey}-${selectedSubKey}-${selectedBooruSubKey}`}
            style={{
              padding: `${spacing.lg}px ${spacing.lg}px`,
              overflowY: 'auto',
              overflowX: 'hidden',
              height: '100%',
            }}
          >
            <Suspense fallback={suspenseFallback}>
              {renderBaseContent()}
            </Suspense>
          </div>
        </Content>
      </Layout>

      <ShortcutsModal open={shortcutsModalOpen} onClose={() => setShortcutsModalOpen(false)} />
    </Layout>
  );
};

export const App: React.FC = () => (
  <AntApp>
    <AppContent />
  </AntApp>
);
