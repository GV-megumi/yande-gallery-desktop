import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  SearchOutlined, SmileOutlined
} from '@ant-design/icons';
import { GalleryPage } from './pages/GalleryPage';
import { SettingsPage } from './pages/SettingsPage';
import { BooruPage } from './pages/BooruPage';
import { BooruSettingsPage } from './pages/BooruSettingsPage';
import BooruDownloadPage from './pages/BooruDownloadPage';
import { BooruBulkDownloadPage } from './pages/BooruBulkDownloadPage';
import { BooruTagSearchPage } from './pages/BooruTagSearchPage';
import { BooruFavoritesPage } from './pages/BooruFavoritesPage';
import { FavoriteTagsPage } from './pages/FavoriteTagsPage';
import { BlacklistedTagsPage } from './pages/BlacklistedTagsPage';
import { BooruPopularPage } from './pages/BooruPopularPage';
import { BooruPoolsPage } from './pages/BooruPoolsPage';
import { BooruArtistPage } from './pages/BooruArtistPage';
import { BooruCharacterPage } from './pages/BooruCharacterPage';
import { BooruSavedSearchesPage } from './pages/BooruSavedSearchesPage';
import { BooruServerFavoritesPage } from './pages/BooruServerFavoritesPage';
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

export const AppContent: React.FC = () => {
  const [selectedKey, setSelectedKey] = useState('gallery');
  const [selectedSubKey, setSelectedSubKey] = useState('recent');
  const [selectedBooruSubKey, setSelectedBooruSubKey] = useState('posts');
  const [loading, setLoading] = useState(true);
  const [tagSearchPage, setTagSearchPage] = useState<{ tag: string; siteId?: number | null } | null>(null);
  const [artistPage, setArtistPage] = useState<{ name: string; siteId?: number | null } | null>(null);
  const [characterPage, setCharacterPage] = useState<{ name: string; siteId?: number | null } | null>(null);
  const { isDark, themeMode, setThemeMode } = useTheme();
  const { t } = useLocale();
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);

  const mainMenuItems = useMemo(() => buildMainMenuItems(t), [t]);
  const gallerySubMenuItems = useMemo(() => buildGallerySubMenuItems(t), [t]);
  const booruSubMenuItems = useMemo(() => buildBooruSubMenuItems(t), [t]);

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
    { key: SHORTCUT_KEYS.GO_BACK, handler: () => { if (characterPage) handleBackFromCharacter(); else if (artistPage) handleBackFromArtist(); else if (tagSearchPage) handleBackFromTagSearch(); }, description: t('shortcuts.goBack') },
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
  }, [selectedKey, selectedSubKey, selectedBooruSubKey]);

  const navigateToTagSearch = (tag: string, siteId?: number | null) => {
    console.log('[App] 导航到标签搜索:', tag, siteId);
    setArtistPage(null);
    setTagSearchPage({ tag, siteId });
  };

  const handleBackFromTagSearch = () => { setTagSearchPage(null); };

  const navigateToArtist = (name: string, siteId?: number | null) => {
    console.log('[App] 导航到艺术家:', name, siteId);
    setTagSearchPage(null);
    setArtistPage({ name, siteId });
  };

  const handleBackFromArtist = () => { setArtistPage(null); };

  const navigateToCharacter = (name: string, siteId?: number | null) => {
    console.log('[App] 导航到角色:', name, siteId);
    setArtistPage(null);
    setTagSearchPage(null);
    setCharacterPage({ name, siteId });
  };

  const handleBackFromCharacter = () => { setCharacterPage(null); };

  const handleSavedSearchRun = (query: string, siteId?: number | null) => {
    console.log('[App] 执行保存的搜索:', query, siteId);
    setSelectedBooruSubKey('posts');
    navigateToTagSearch(query, siteId);
  };

  const pageTitle = useMemo(() => {
    if (characterPage) return { main: '角色', sub: characterPage.name.replace(/_/g, ' ') };
    if (artistPage) return { main: '艺术家', sub: artistPage.name.replace(/_/g, ' ') };
    if (tagSearchPage) return { main: t('pageTitle.tagSearch'), sub: tagSearchPage.tag.replace(/_/g, ' ') };
    switch (selectedKey) {
      case 'gallery':
        if (selectedSubKey === 'settings') return { main: t('pageTitle.settings') };
        return { main: t('pageTitle.gallery'), sub: gallerySubMenuItems.find(i => i.key === selectedSubKey)?.label };
      case 'booru':
        if (selectedBooruSubKey === 'booru-settings') return { main: t('pageTitle.booru'), sub: t('menu.siteConfig') };
        if (selectedBooruSubKey === 'settings') return { main: t('pageTitle.settings') };
        return { main: t('pageTitle.booru'), sub: booruSubMenuItems.find(i => i.key === selectedBooruSubKey)?.label };
      default:
        return { main: t('pageTitle.booru') };
    }
  }, [selectedKey, selectedSubKey, selectedBooruSubKey, tagSearchPage, artistPage, characterPage, t, gallerySubMenuItems, booruSubMenuItems]);

  const renderContent = () => {
    if (loading) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
          <h2 style={{ color: colors.textTertiary, fontWeight: 400, fontSize: fontSize.lg }}>{t('app.initializing')}</h2>
        </div>
      );
    }
    if (characterPage) {
      return <BooruCharacterPage characterName={characterPage.name} initialSiteId={characterPage.siteId} onBack={handleBackFromCharacter} onTagClick={navigateToTagSearch} />;
    }
    if (artistPage) {
      return <BooruArtistPage artistName={artistPage.name} initialSiteId={artistPage.siteId} onBack={handleBackFromArtist} onTagClick={navigateToTagSearch} />;
    }
    if (tagSearchPage) {
      return <BooruTagSearchPage initialTag={tagSearchPage.tag} initialSiteId={tagSearchPage.siteId} onBack={handleBackFromTagSearch} onArtistClick={navigateToArtist} />;
    }
    switch (selectedKey) {
      case 'gallery':
        if (selectedSubKey === 'settings') return <SettingsPage />;
        return <GalleryPage subTab={selectedSubKey as "recent" | "all" | "galleries" | undefined} />;
      case 'booru':
        if (selectedBooruSubKey === 'posts') return <BooruPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} onCharacterClick={navigateToCharacter} />;
        if (selectedBooruSubKey === 'popular') return <BooruPopularPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} />;
        if (selectedBooruSubKey === 'pools') return <BooruPoolsPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} />;
        if (selectedBooruSubKey === 'favorites') return <BooruFavoritesPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} />;
        if (selectedBooruSubKey === 'server-favorites') return <BooruServerFavoritesPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} />;
        if (selectedBooruSubKey === 'favorite-tags') return <FavoriteTagsPage onTagClick={navigateToTagSearch} />;
        if (selectedBooruSubKey === 'blacklisted-tags') return <BlacklistedTagsPage />;
        if (selectedBooruSubKey === 'downloads') return <BooruDownloadPage />;
        if (selectedBooruSubKey === 'bulk-download') return <BooruBulkDownloadPage />;
        if (selectedBooruSubKey === 'saved-searches') return <BooruSavedSearchesPage onRunSearch={handleSavedSearchRun} />;
        if (selectedBooruSubKey === 'booru-settings') return <BooruSettingsPage />;
        if (selectedBooruSubKey === 'settings') return <SettingsPage />;
        return <BooruPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} onCharacterClick={navigateToCharacter} />;
      default:
        return <BooruPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} onCharacterClick={navigateToCharacter} />;
    }
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
            if (key === 'gallery') setSelectedSubKey('recent');
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
          className="ios-page-enter noise-bg"
          key={`${selectedKey}-${selectedSubKey}-${selectedBooruSubKey}-${tagSearchPage?.tag || ''}-${artistPage?.name || ''}-${characterPage?.name || ''}`}
          style={{
            margin: 0,
            padding: `${spacing.lg}px ${spacing.lg}px`,
            overflowY: 'auto',
            overflowX: 'hidden',
            flex: 1,
            height: 0,
            position: 'relative',
          }}
        >
          {renderContent()}
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
