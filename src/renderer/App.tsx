import React, { useState, useEffect } from 'react';
import { Layout, Menu, theme, message } from 'antd';
import { PictureOutlined, CloudDownloadOutlined, SettingOutlined, ClockCircleOutlined, AppstoreOutlined } from '@ant-design/icons';
import { GalleryPage } from './pages/GalleryPage';
import { DownloadPage } from './pages/DownloadPage';
import { SettingsPage } from './pages/SettingsPage';

const { Header, Content, Sider } = Layout;

type MenuItem = {
  key: string;
  icon: React.ReactNode;
  label: string;
};

const mainMenuItems: MenuItem[] = [
  { key: 'gallery', icon: <PictureOutlined />, label: '图库' },
  { key: 'download', icon: <CloudDownloadOutlined />, label: 'Yande.re' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置' }
];

const gallerySubMenuItems: MenuItem[] = [
  { key: 'recent', icon: <ClockCircleOutlined />, label: '最近' },
  { key: 'all', icon: <AppstoreOutlined />, label: '所有' },
  { key: 'galleries', icon: <AppstoreOutlined />, label: '图集' }
];

export const App: React.FC = () => {
  const [selectedKey, setSelectedKey] = useState('gallery');
  const [selectedSubKey, setSelectedSubKey] = useState('recent');
  const [loading, setLoading] = useState(true);
  const {
    token: { colorBgContainer },
  } = theme.useToken();

  // 初始化数据库
  useEffect(() => {
    const initDatabase = async () => {
      try {
        if (window.electronAPI) {
          const result = await window.electronAPI.db.init();
          if (!result.success) {
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

  // 当主菜单切换时，如果是图库，默认选择"最近"子菜单
  useEffect(() => {
    if (selectedKey === 'gallery' && !selectedSubKey) {
      setSelectedSubKey('recent');
    }
  }, [selectedKey]);

  const renderContent = () => {
    if (loading) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
          <h2>正在初始化应用...</h2>
        </div>
      );
    }

    switch (selectedKey) {
      case 'gallery':
        return <GalleryPage subTab={selectedSubKey} />;
      case 'download':
        return <DownloadPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <GalleryPage subTab={selectedSubKey} />;
    }
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={200} theme="light" style={{ display: 'flex', flexDirection: 'column' }}>
        {/* 主菜单 - 顶部 */}
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={mainMenuItems}
          onClick={({ key }) => {
            setSelectedKey(key);
            if (key === 'gallery') {
              setSelectedSubKey('recent');
            }
          }}
          style={{ borderBottom: '1px solid #f0f0f0' }}
        />
        
        {/* 子菜单 - 只在图库模式下显示 */}
        {selectedKey === 'gallery' && (
          <Menu
            mode="inline"
            selectedKeys={[selectedSubKey]}
            items={gallerySubMenuItems}
            onClick={({ key }) => setSelectedSubKey(key)}
            style={{ flex: 1 }}
          />
        )}
      </Sider>

      <Layout>
        <Header style={{ padding: 0, background: colorBgContainer }}>
          <h2 style={{ margin: '0 24px' }}>
            {selectedKey === 'gallery' 
              ? `图库 - ${gallerySubMenuItems.find(item => item.key === selectedSubKey)?.label}`
              : mainMenuItems.find(item => item.key === selectedKey)?.label}
          </h2>
        </Header>
        <Content style={{ margin: '24px 16px 0', overflow: 'initial' }}>
          {renderContent()}
        </Content>
      </Layout>
    </Layout>
  );
};