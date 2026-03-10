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
  FireOutlined, DatabaseOutlined, HeartOutlined
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
import { BooruServerFavoritesPage } from './pages/BooruServerFavoritesPage';
import { colors, spacing, radius, layout, fontSize, iconColors, shadows } from './styles/tokens';

const { Content, Sider } = Layout;

type MenuItem = {
  key: string;
  icon: React.ReactNode;
  label: string;
};

/** iOS 风格图标包裹器：彩色背景 + 白色图标 */
const IconBadge: React.FC<{ color: string; icon: React.ReactNode }> = ({ color, icon }) => (
  <span style={{
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: 7,
    background: color,
    color: '#FFFFFF',
    fontSize: 15,
    flexShrink: 0,
  }}>
    {icon}
  </span>
);

/** 创建主菜单项（依赖翻译） */
function buildMainMenuItems(t: (path: string) => string): MenuItem[] {
  return [
    { key: 'gallery', icon: <IconBadge color={iconColors.gallery} icon={<PictureOutlined />} />, label: t('menu.gallery') },
    { key: 'booru', icon: <IconBadge color={iconColors.booru} icon={<CloudOutlined />} />, label: t('menu.booru') },
  ];
}

function buildGallerySubMenuItems(t: (path: string) => string): MenuItem[] {
  return [
    { key: 'recent', icon: <ClockCircleOutlined style={{ color: iconColors.recent }} />, label: t('menu.recent') },
    { key: 'all', icon: <AppstoreOutlined style={{ color: iconColors.all }} />, label: t('menu.all') },
    { key: 'galleries', icon: <FolderOutlined style={{ color: iconColors.galleries }} />, label: t('menu.galleries') }
  ];
}

function buildBooruSubMenuItems(t: (path: string) => string): MenuItem[] {
  return [
    { key: 'posts', icon: <CloudOutlined style={{ color: iconColors.posts }} />, label: t('menu.posts') },
    { key: 'popular', icon: <FireOutlined style={{ color: iconColors.popular }} />, label: t('menu.popular') },
    { key: 'pools', icon: <DatabaseOutlined style={{ color: iconColors.pools }} />, label: t('menu.pools') },
    { key: 'favorites', icon: <BookOutlined style={{ color: iconColors.favorites }} />, label: t('menu.favorites') },
    { key: 'server-favorites', icon: <HeartOutlined style={{ color: iconColors.serverFavorites }} />, label: t('menu.serverFavorites') },
    { key: 'favorite-tags', icon: <StarOutlined style={{ color: iconColors.favoriteTags }} />, label: t('menu.favoriteTags') },
    { key: 'blacklisted-tags', icon: <StopOutlined style={{ color: '#FF3B30' }} />, label: t('menu.blacklist') },
    { key: 'downloads', icon: <CloudDownloadOutlined style={{ color: iconColors.downloads }} />, label: t('menu.downloads') },
    { key: 'bulk-download', icon: <CloudDownloadOutlined style={{ color: iconColors.bulkDownload }} />, label: t('menu.bulkDownload') },
  ];
}

export const AppContent: React.FC = () => {
  const [selectedKey, setSelectedKey] = useState('gallery');
  const [selectedSubKey, setSelectedSubKey] = useState('recent');
  const [selectedBooruSubKey, setSelectedBooruSubKey] = useState('posts');
  const [loading, setLoading] = useState(true);
  const [tagSearchPage, setTagSearchPage] = useState<{ tag: string; siteId?: number | null } | null>(null);
  const [artistPage, setArtistPage] = useState<{ name: string; siteId?: number | null } | null>(null);
  const { isDark, themeMode, setThemeMode } = useTheme();
  const { t } = useLocale();
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);

  // 使用 useMemo 缓存菜单项，语言变化时重新生成
  const mainMenuItems = useMemo(() => buildMainMenuItems(t), [t]);
  const gallerySubMenuItems = useMemo(() => buildGallerySubMenuItems(t), [t]);
  const booruSubMenuItems = useMemo(() => buildBooruSubMenuItems(t), [t]);

  // 全局快捷键
  const toggleTheme = useCallback(() => {
    setThemeMode(isDark ? 'light' : 'dark');
  }, [isDark, setThemeMode]);

  const openSettings = useCallback(() => {
    if (selectedKey === 'gallery') {
      setSelectedSubKey('settings');
    } else {
      setSelectedBooruSubKey('settings');
    }
  }, [selectedKey]);

  const focusSearch = useCallback(() => {
    // 查找页面中的搜索输入框并聚焦
    const searchInput = document.querySelector<HTMLInputElement>(
      '.ant-input-search input, .ant-input-affix-wrapper input, input[type="search"]'
    );
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  }, []);

  useKeyboardShortcuts([
    { key: SHORTCUT_KEYS.TOGGLE_THEME, handler: toggleTheme, description: t('shortcuts.toggleTheme') },
    { key: SHORTCUT_KEYS.OPEN_SETTINGS, handler: openSettings, description: t('shortcuts.openSettings') },
    { key: SHORTCUT_KEYS.FOCUS_SEARCH, handler: focusSearch, description: t('shortcuts.focusSearch'), enableInInput: true },
    { key: SHORTCUT_KEYS.SHOW_SHORTCUTS, handler: () => setShortcutsModalOpen(true), description: t('shortcuts.showShortcuts') },
    { key: SHORTCUT_KEYS.GO_BACK, handler: () => { if (artistPage) handleBackFromArtist(); else if (tagSearchPage) handleBackFromTagSearch(); }, description: t('shortcuts.goBack') },
  ]);

  // 初始化数据库
  useEffect(() => {
    console.log('[App] 应用启动，开始初始化数据库');
    const initDatabase = async () => {
      try {
        if (window.electronAPI) {
          console.log('[App] 调用 db.init() 初始化数据库');
          const result = await window.electronAPI.db.init();
          if (result.success) {
            console.log('[App] 数据库初始化成功');
          } else {
            console.error('[App] 数据库初始化失败:', result.error);
            message.error('数据库初始化失败: ' + result.error);
          }
        } else {
          console.error('[App] electronAPI 不可用，无法初始化数据库');
        }
      } catch (error) {
        console.error('Failed to initialize database:', error);
        message.error('数据库初始化失败');
      } finally {
        setLoading(false);
        console.log('[App] 应用初始化完成');
      }
    };
    initDatabase();
  }, []);

  // 当主菜单切换时，设置默认子菜单
  useEffect(() => {
    if (selectedKey === 'gallery' && !selectedSubKey) {
      setSelectedSubKey('recent');
    }
    if (selectedKey === 'booru' && !selectedBooruSubKey) {
      setSelectedBooruSubKey('posts');
    }
  }, [selectedKey, selectedSubKey, selectedBooruSubKey]);

  const navigateToTagSearch = (tag: string, siteId?: number | null) => {
    console.log('[App] 导航到标签搜索页面:', tag, siteId);
    setArtistPage(null); // 清除艺术家页面
    setTagSearchPage({ tag, siteId });
  };

  const handleBackFromTagSearch = () => {
    console.log('[App] 从标签搜索页面返回');
    setTagSearchPage(null);
  };

  const navigateToArtist = (name: string, siteId?: number | null) => {
    console.log('[App] 导航到艺术家页面:', name, siteId);
    setTagSearchPage(null); // 清除标签搜索页面
    setArtistPage({ name, siteId });
  };

  const handleBackFromArtist = () => {
    console.log('[App] 从艺术家页面返回');
    setArtistPage(null);
  };

  // 计算页面标题
  const pageTitle = useMemo(() => {
    if (artistPage) {
      return { main: '艺术家', sub: artistPage.name.replace(/_/g, ' ') };
    }
    if (tagSearchPage) {
      return { main: t('pageTitle.tagSearch'), sub: tagSearchPage.tag.replace(/_/g, ' ') };
    }
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
  }, [selectedKey, selectedSubKey, selectedBooruSubKey, tagSearchPage, artistPage, t, gallerySubMenuItems, booruSubMenuItems]);

  const renderContent = () => {
    if (loading) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
          <h2 style={{ color: colors.textTertiary, fontWeight: 400, fontSize: fontSize.lg }}>{t('app.initializing')}</h2>
        </div>
      );
    }
    if (artistPage) {
      return (
        <BooruArtistPage
          artistName={artistPage.name}
          initialSiteId={artistPage.siteId}
          onBack={handleBackFromArtist}
          onTagClick={navigateToTagSearch}
        />
      );
    }
    if (tagSearchPage) {
      return (
        <BooruTagSearchPage
          initialTag={tagSearchPage.tag}
          initialSiteId={tagSearchPage.siteId}
          onBack={handleBackFromTagSearch}
          onArtistClick={navigateToArtist}
        />
      );
    }
    switch (selectedKey) {
      case 'gallery':
        if (selectedSubKey === 'settings') return <SettingsPage />;
        return <GalleryPage subTab={selectedSubKey as "recent" | "all" | "galleries" | undefined} />;
      case 'booru':
        if (selectedBooruSubKey === 'posts') return <BooruPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} />;
        if (selectedBooruSubKey === 'popular') return <BooruPopularPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} />;
        if (selectedBooruSubKey === 'pools') return <BooruPoolsPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} />;
        if (selectedBooruSubKey === 'favorites') return <BooruFavoritesPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} />;
        if (selectedBooruSubKey === 'server-favorites') return <BooruServerFavoritesPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} />;
        if (selectedBooruSubKey === 'favorite-tags') return <FavoriteTagsPage onTagClick={navigateToTagSearch} />;
        if (selectedBooruSubKey === 'blacklisted-tags') return <BlacklistedTagsPage />;
        if (selectedBooruSubKey === 'downloads') return <BooruDownloadPage />;
        if (selectedBooruSubKey === 'bulk-download') return <BooruBulkDownloadPage />;
        if (selectedBooruSubKey === 'booru-settings') return <BooruSettingsPage />;
        if (selectedBooruSubKey === 'settings') return <SettingsPage />;
        return <BooruPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} />;
      default:
        return <BooruPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} />;
    }
  };

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden', background: colors.bgLight }}>
      {/* ===== iPadOS 风格侧边栏 ===== */}
      <Sider
        width={layout.sidebarWidth}
        theme={isDark ? 'dark' : 'light'}
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          overflow: 'hidden',
          background: isDark ? colors.bgBase : '#FFFFFF',
          borderRight: `0.5px solid ${colors.separator}`,
        }}
      >
        {/* 应用标识区 */}
        <div style={{
          padding: '20px 16px 8px',
          flexShrink: 0,
        }}>
          <div style={{
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: '-0.3px',
            color: colors.textPrimary,
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
          }}>
            Yande Gallery
          </div>
        </div>

        {/* 主菜单 */}
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
            borderBottom: `0.5px solid ${colors.separator}`,
            flexShrink: 0,
            background: 'transparent',
            borderRight: 'none',
          }}
        />

        {/* 子菜单 — 独立滚动 */}
        {selectedKey === 'gallery' && (
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{
              padding: `${spacing.sm}px ${spacing.xl}px 4px`,
              fontSize: fontSize.xs,
              fontWeight: 600,
              color: colors.textTertiary,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.5px',
            }}>
              {t('menu.browse')}
            </div>
            <Menu
              mode="inline"
              selectedKeys={[selectedSubKey]}
              items={gallerySubMenuItems}
              onClick={({ key }) => {
                console.log(`[App] 图库子菜单切换: ${key}`);
                setSelectedSubKey(key);
              }}
              style={{ background: 'transparent', borderRight: 'none' }}
            />
            <div style={{ flex: 1 }} />
            <div style={{ borderTop: `0.5px solid ${colors.separator}`, paddingTop: spacing.xs }}>
              <Menu
                mode="inline"
                selectedKeys={[selectedSubKey]}
                items={[
                  { key: 'settings', icon: <SettingOutlined style={{ color: iconColors.settings }} />, label: t('menu.settings') }
                ]}
                onClick={({ key }) => {
                  console.log(`[App] 图库子菜单切换: ${key}`);
                  setSelectedSubKey(key);
                }}
                style={{ background: 'transparent', borderRight: 'none' }}
              />
            </div>
          </div>
        )}
        {selectedKey === 'booru' && (
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{
              padding: `${spacing.sm}px ${spacing.xl}px 4px`,
              fontSize: fontSize.xs,
              fontWeight: 600,
              color: colors.textTertiary,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.5px',
            }}>
              Booru
            </div>
            <Menu
              mode="inline"
              selectedKeys={[selectedBooruSubKey]}
              items={booruSubMenuItems}
              onClick={({ key }) => {
                console.log(`[App] Booru子菜单切换: ${key}`);
                setSelectedBooruSubKey(key);
              }}
              style={{ background: 'transparent', borderRight: 'none' }}
            />
            <div style={{ flex: 1 }} />
            <div style={{ borderTop: `0.5px solid ${colors.separator}`, paddingTop: spacing.xs }}>
              <Menu
                mode="inline"
                selectedKeys={[selectedBooruSubKey]}
                items={[
                  { key: 'booru-settings', icon: <CloudOutlined style={{ color: iconColors.booruSettings }} />, label: t('menu.siteConfig') },
                  { key: 'settings', icon: <SettingOutlined style={{ color: iconColors.settings }} />, label: t('menu.settings') },
                ]}
                onClick={({ key }) => {
                  console.log(`[App] Booru子菜单切换: ${key}`);
                  setSelectedBooruSubKey(key);
                }}
                style={{ background: 'transparent', borderRight: 'none' }}
              />
            </div>
          </div>
        )}

        {/* 底部：主题切换 */}
        <div style={{
          flexShrink: 0,
          padding: `${spacing.md}px ${spacing.lg}px`,
          borderTop: `0.5px solid ${colors.separator}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <button
            onClick={toggleTheme}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              width: '100%',
              padding: '8px 12px',
              borderRadius: radius.sm,
              border: 'none',
              background: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
              color: colors.textSecondary,
              fontSize: fontSize.md,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(0, 0, 0, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)';
            }}
          >
            {isDark ? <SunOutlined /> : <MoonOutlined />}
            {isDark ? t('app.lightMode') : t('app.darkMode')}
          </button>
        </div>
      </Sider>

      {/* ===== 主内容区 ===== */}
      <Layout style={{
        height: '100vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: colors.bgLight,
      }}>
        {/* iOS 风格标题栏 */}
        <div style={{
          padding: `0 ${spacing.xxl}px`,
          height: layout.headerHeight,
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
          background: isDark
            ? 'rgba(28, 28, 30, 0.72)'
            : 'rgba(255, 255, 255, 0.72)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          borderBottom: `0.5px solid ${colors.separator}`,
          zIndex: 10,
        }}>
          <span style={{
            fontSize: fontSize.heading,
            fontWeight: 700,
            letterSpacing: '-0.3px',
            color: colors.textPrimary,
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
          }}>
            {pageTitle.main}
          </span>
          {pageTitle.sub && (
            <span style={{
              fontSize: fontSize.heading,
              fontWeight: 700,
              letterSpacing: '-0.3px',
              color: colors.textTertiary,
              marginLeft: 8,
              fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
            }}>
              · {pageTitle.sub}
            </span>
          )}
        </div>

        {/* 内容区 */}
        <Content
          className="ios-page-enter"
          key={`${selectedKey}-${selectedSubKey}-${selectedBooruSubKey}-${tagSearchPage?.tag || ''}-${artistPage?.name || ''}`}
          style={{
            margin: 0,
            padding: `${spacing.xl}px ${spacing.xl}px`,
            overflowY: 'auto',
            overflowX: 'hidden',
            flex: 1,
            height: 0,
          }}
        >
          {renderContent()}
        </Content>
      </Layout>

      {/* 快捷键帮助弹窗 */}
      <ShortcutsModal open={shortcutsModalOpen} onClose={() => setShortcutsModalOpen(false)} />
    </Layout>
  );
};

export const App: React.FC = () => (
  <AntApp>
    <AppContent />
  </AntApp>
);
