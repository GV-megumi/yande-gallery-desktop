import React, { useState, useEffect } from 'react';
import { Layout, Menu, message, App as AntApp } from 'antd';
import { useTheme } from './hooks/useTheme';
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

const mainMenuItems: MenuItem[] = [
  { key: 'gallery', icon: <IconBadge color={iconColors.gallery} icon={<PictureOutlined />} />, label: '图库' },
  { key: 'booru', icon: <IconBadge color={iconColors.booru} icon={<CloudOutlined />} />, label: 'Booru' },
];

const gallerySubMenuItems: MenuItem[] = [
  { key: 'recent', icon: <ClockCircleOutlined style={{ color: iconColors.recent }} />, label: '最近' },
  { key: 'all', icon: <AppstoreOutlined style={{ color: iconColors.all }} />, label: '所有' },
  { key: 'galleries', icon: <FolderOutlined style={{ color: iconColors.galleries }} />, label: '图集' }
];

const booruSubMenuItems: MenuItem[] = [
  { key: 'posts', icon: <CloudOutlined style={{ color: iconColors.posts }} />, label: '图片浏览' },
  { key: 'popular', icon: <FireOutlined style={{ color: iconColors.popular }} />, label: '热门图片' },
  { key: 'pools', icon: <DatabaseOutlined style={{ color: iconColors.pools }} />, label: 'Pool 图集' },
  { key: 'favorites', icon: <BookOutlined style={{ color: iconColors.favorites }} />, label: '我的收藏' },
  { key: 'server-favorites', icon: <HeartOutlined style={{ color: iconColors.serverFavorites }} />, label: '我的喜欢' },
  { key: 'favorite-tags', icon: <StarOutlined style={{ color: iconColors.favoriteTags }} />, label: '收藏标签' },
  { key: 'blacklisted-tags', icon: <StopOutlined style={{ color: '#FF3B30' }} />, label: '黑名单' },
  { key: 'downloads', icon: <CloudDownloadOutlined style={{ color: iconColors.downloads }} />, label: '下载管理' },
  { key: 'bulk-download', icon: <CloudDownloadOutlined style={{ color: iconColors.bulkDownload }} />, label: '批量下载' },
];

/** 获取页面标题 */
function getPageTitle(
  selectedKey: string,
  selectedSubKey: string,
  selectedBooruSubKey: string,
  tagSearchPage: { tag: string } | null
): { main: string; sub?: string } {
  if (tagSearchPage) {
    return { main: '标签搜索', sub: tagSearchPage.tag.replace(/_/g, ' ') };
  }
  switch (selectedKey) {
    case 'gallery':
      if (selectedSubKey === 'settings') return { main: '设置' };
      return { main: '图库', sub: gallerySubMenuItems.find(i => i.key === selectedSubKey)?.label };
    case 'booru':
      if (selectedBooruSubKey === 'booru-settings') return { main: 'Booru', sub: '站点配置' };
      if (selectedBooruSubKey === 'settings') return { main: '设置' };
      return { main: 'Booru', sub: booruSubMenuItems.find(i => i.key === selectedBooruSubKey)?.label };
    default:
      return { main: 'Booru' };
  }
}

export const AppContent: React.FC = () => {
  const [selectedKey, setSelectedKey] = useState('gallery');
  const [selectedSubKey, setSelectedSubKey] = useState('recent');
  const [selectedBooruSubKey, setSelectedBooruSubKey] = useState('posts');
  const [loading, setLoading] = useState(true);
  const [tagSearchPage, setTagSearchPage] = useState<{ tag: string; siteId?: number | null } | null>(null);
  const { isDark, themeMode, setThemeMode } = useTheme();

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
    setTagSearchPage({ tag, siteId });
  };

  const handleBackFromTagSearch = () => {
    console.log('[App] 从标签搜索页面返回');
    setTagSearchPage(null);
  };

  const pageTitle = getPageTitle(selectedKey, selectedSubKey, selectedBooruSubKey, tagSearchPage);

  const renderContent = () => {
    if (loading) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
          <h2 style={{ color: colors.textTertiary, fontWeight: 400, fontSize: fontSize.lg }}>正在初始化应用...</h2>
        </div>
      );
    }
    if (tagSearchPage) {
      return (
        <BooruTagSearchPage
          initialTag={tagSearchPage.tag}
          initialSiteId={tagSearchPage.siteId}
          onBack={handleBackFromTagSearch}
        />
      );
    }
    switch (selectedKey) {
      case 'gallery':
        if (selectedSubKey === 'settings') return <SettingsPage />;
        return <GalleryPage subTab={selectedSubKey as "recent" | "all" | "galleries" | undefined} />;
      case 'booru':
        if (selectedBooruSubKey === 'posts') return <BooruPage onTagClick={navigateToTagSearch} />;
        if (selectedBooruSubKey === 'popular') return <BooruPopularPage onTagClick={navigateToTagSearch} />;
        if (selectedBooruSubKey === 'pools') return <BooruPoolsPage onTagClick={navigateToTagSearch} />;
        if (selectedBooruSubKey === 'favorites') return <BooruFavoritesPage onTagClick={navigateToTagSearch} />;
        if (selectedBooruSubKey === 'server-favorites') return <BooruServerFavoritesPage onTagClick={navigateToTagSearch} />;
        if (selectedBooruSubKey === 'favorite-tags') return <FavoriteTagsPage onTagClick={navigateToTagSearch} />;
        if (selectedBooruSubKey === 'blacklisted-tags') return <BlacklistedTagsPage />;
        if (selectedBooruSubKey === 'downloads') return <BooruDownloadPage />;
        if (selectedBooruSubKey === 'bulk-download') return <BooruBulkDownloadPage />;
        if (selectedBooruSubKey === 'booru-settings') return <BooruSettingsPage />;
        if (selectedBooruSubKey === 'settings') return <SettingsPage />;
        return <BooruPage onTagClick={navigateToTagSearch} />;
      default:
        return <BooruPage onTagClick={navigateToTagSearch} />;
    }
  };

  /** 切换主题 */
  const toggleTheme = () => {
    const next = isDark ? 'light' : 'dark';
    setThemeMode(next);
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
              浏览
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
                  { key: 'settings', icon: <SettingOutlined style={{ color: iconColors.settings }} />, label: '设置' }
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
                  { key: 'booru-settings', icon: <CloudOutlined style={{ color: iconColors.booruSettings }} />, label: '站点配置' },
                  { key: 'settings', icon: <SettingOutlined style={{ color: iconColors.settings }} />, label: '设置' },
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
            {isDark ? '浅色模式' : '深色模式'}
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
          key={`${selectedKey}-${selectedSubKey}-${selectedBooruSubKey}-${tagSearchPage?.tag || ''}`}
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
    </Layout>
  );
};

export const App: React.FC = () => (
  <AntApp>
    <AppContent />
  </AntApp>
);
