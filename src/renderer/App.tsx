import React, { useState, useEffect } from 'react';
import { Layout, Menu, theme, message, App as AntApp } from 'antd';
import { useTheme } from './hooks/useTheme';
import { PictureOutlined, SettingOutlined, ClockCircleOutlined, AppstoreOutlined, CloudOutlined, SettingOutlined as BooruSettingOutlined, BookOutlined, CloudDownloadOutlined, StarOutlined } from '@ant-design/icons';
import { GalleryPage } from './pages/GalleryPage';
import { SettingsPage } from './pages/SettingsPage';
import { BooruPage } from './pages/BooruPage';
import { BooruSettingsPage } from './pages/BooruSettingsPage';
import BooruDownloadPage from './pages/BooruDownloadPage';
import { BooruBulkDownloadPage } from './pages/BooruBulkDownloadPage';
import { BooruTagSearchPage } from './pages/BooruTagSearchPage';
import { BooruFavoritesPage } from './pages/BooruFavoritesPage';
import { FavoriteTagsPage } from './pages/FavoriteTagsPage';

const { Header, Content, Sider } = Layout;

type MenuItem = {
  key: string;
  icon: React.ReactNode;
  label: string;
};

const mainMenuItems: MenuItem[] = [
  { key: 'gallery', icon: <PictureOutlined />, label: '图库' },
  { key: 'booru', icon: <CloudOutlined />, label: 'Booru' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置' }
];

const gallerySubMenuItems: MenuItem[] = [
  { key: 'recent', icon: <ClockCircleOutlined />, label: '最近' },
  { key: 'all', icon: <AppstoreOutlined />, label: '所有' },
  { key: 'galleries', icon: <AppstoreOutlined />, label: '图集' }
];

const booruSubMenuItems: MenuItem[] = [
  { key: 'posts', icon: <CloudOutlined />, label: '图片浏览' },
  { key: 'favorites', icon: <BookOutlined />, label: '我的收藏' },
  { key: 'favorite-tags', icon: <StarOutlined />, label: '收藏标签' },
  { key: 'downloads', icon: <CloudDownloadOutlined />, label: '下载管理' },
  { key: 'bulk-download', icon: <CloudDownloadOutlined />, label: '批量下载' },
  { key: 'settings', icon: <BooruSettingOutlined />, label: '站点配置' }
];

export const AppContent: React.FC = () => {
  const [selectedKey, setSelectedKey] = useState('gallery');
  const [selectedSubKey, setSelectedSubKey] = useState('recent');
  const [selectedBooruSubKey, setSelectedBooruSubKey] = useState('posts');
  const [loading, setLoading] = useState(true);
  // 标签搜索页面状态
  const [tagSearchPage, setTagSearchPage] = useState<{ tag: string; siteId?: number | null } | null>(null);
  const {
    token: { colorBgContainer },
  } = theme.useToken();
  const { isDark } = useTheme();

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
      console.log('[App] 默认选择图库的"最近"子菜单');
      setSelectedSubKey('recent');
    }
    if (selectedKey === 'booru' && !selectedBooruSubKey) {
      console.log('[App] 默认选择Booru的"图片浏览"子菜单');
      setSelectedBooruSubKey('posts');
    }
  }, [selectedKey, selectedSubKey, selectedBooruSubKey]);

  // 导航到标签搜索页面
  const navigateToTagSearch = (tag: string, siteId?: number | null) => {
    console.log('[App] 导航到标签搜索页面:', tag, siteId);
    setTagSearchPage({ tag, siteId });
  };

  // 返回上一页（从标签搜索页面返回）
  const handleBackFromTagSearch = () => {
    console.log('[App] 从标签搜索页面返回');
    setTagSearchPage(null);
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
          <h2>正在初始化应用...</h2>
        </div>
      );
    }

    // 如果显示标签搜索页面，优先渲染
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
        return <GalleryPage subTab={selectedSubKey as "recent" | "all" | "galleries" | undefined} />;
      case 'booru':
        if (selectedBooruSubKey === 'posts') return <BooruPage onTagClick={navigateToTagSearch} />;
        if (selectedBooruSubKey === 'favorites') return <BooruFavoritesPage onTagClick={navigateToTagSearch} />;
        if (selectedBooruSubKey === 'favorite-tags') return <FavoriteTagsPage onTagClick={navigateToTagSearch} />;
        if (selectedBooruSubKey === 'downloads') return <BooruDownloadPage />;
        if (selectedBooruSubKey === 'bulk-download') return <BooruBulkDownloadPage />;
        if (selectedBooruSubKey === 'settings') return <BooruSettingsPage />;
        return <BooruPage onTagClick={navigateToTagSearch} />;
      case 'settings':
        return <SettingsPage />;
      // case 'downloads': return <BooruDownloadPage />; // Removed as it's now a sub-menu of booru
      default:
        return <BooruPage onTagClick={navigateToTagSearch} />;
    }
  };

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      <Sider width={200} theme={isDark ? 'dark' : 'light'} style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        {/* 主菜单 - 顶部固定 */}
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={mainMenuItems}
          onClick={({ key }) => {
            console.log(`[App] 主菜单切换: ${key}`);
            setSelectedKey(key);
            if (key === 'gallery') {
              setSelectedSubKey('recent');
            }
          }}
          style={{ borderBottom: `1px solid ${isDark ? '#303030' : '#f0f0f0'}`, flexShrink: 0 }}
        />
        
        {/* 子菜单 - 只在图库和Booru模式下显示，独立滚动 */}
        {selectedKey === 'gallery' && (
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
            <Menu
              mode="inline"
              selectedKeys={[selectedSubKey]}
              items={gallerySubMenuItems}
              onClick={({ key }) => {
                console.log(`[App] 图库子菜单切换: ${key}`);
                setSelectedSubKey(key);
              }}
            />
          </div>
        )}
        {selectedKey === 'booru' && (
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
            <Menu
              mode="inline"
              selectedKeys={[selectedBooruSubKey]}
              items={booruSubMenuItems}
              onClick={({ key }) => {
                console.log(`[App] Booru子菜单切换: ${key}`);
                setSelectedBooruSubKey(key);
              }}
            />
          </div>
        )}
      </Sider>

      <Layout style={{ height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Header style={{ padding: 0, background: colorBgContainer, flexShrink: 0 }}>
          <h2 style={{ margin: '0 24px' }}>
            {tagSearchPage
              ? `标签搜索: ${tagSearchPage.tag.replace(/_/g, ' ')}`
              : selectedKey === 'gallery'
              ? `图库 - ${gallerySubMenuItems.find(item => item.key === selectedSubKey)?.label}`
              : selectedKey === 'booru'
              ? `Booru - ${booruSubMenuItems.find(item => item.key === selectedBooruSubKey)?.label}`
              : mainMenuItems.find(item => item.key === selectedKey)?.label}
          </h2>
        </Header>
        <Content style={{ 
          margin: '24px 16px', 
          overflowY: 'auto', 
          overflowX: 'hidden',
          flex: 1,
          height: 0 // 用于 flex 布局中正确计算高度
        }}>
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
