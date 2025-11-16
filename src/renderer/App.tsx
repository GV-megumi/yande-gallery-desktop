import React, { useState, useEffect } from 'react';
import { Layout, Menu, theme, message } from 'antd';
import { PictureOutlined, CloudDownloadOutlined, SettingOutlined } from '@ant-design/icons';
import { GalleryPage } from './pages/GalleryPage';
import { DownloadPage } from './pages/DownloadPage';
import { SettingsPage } from './pages/SettingsPage';

const { Header, Content, Sider } = Layout;

type MenuItem = {
  key: string;
  icon: React.ReactNode;
  label: string;
};

const menuItems: MenuItem[] = [
  { key: 'gallery', icon: <PictureOutlined />, label: '本地图库' },
  { key: 'download', icon: <CloudDownloadOutlined />, label: 'Yande.re' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置' }
];

export const App: React.FC = () => {
  const [selectedKey, setSelectedKey] = useState('gallery');
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
        return <GalleryPage />;
      case 'download':
        return <DownloadPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <GalleryPage />;
    }
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={200} theme="light">
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => setSelectedKey(key)}
        />
      </Sider>

      <Layout>
        <Header style={{ padding: 0, background: colorBgContainer }}>
          <h2 style={{ margin: '0 24px' }}>
            {menuItems.find(item => item.key === selectedKey)?.label}
          </h2>
        </Header>
        <Content style={{ margin: '24px 16px 0', overflow: 'initial' }}>
          {renderContent()}
        </Content>
      </Layout>
    </Layout>
  );
};