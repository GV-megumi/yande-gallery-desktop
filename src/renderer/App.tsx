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

  // 当主菜单切换时，如果是图库，默认选择"最近"子菜单
  useEffect(() => {
    if (selectedKey === 'gallery' && !selectedSubKey) {
      console.log('[App] 默认选择图库的"最近"子菜单');
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
            console.log(`[App] 主菜单切换: ${key}`);
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
            onClick={({ key }) => {
              console.log(`[App] 图库子菜单切换: ${key}`);
              setSelectedSubKey(key);
            }}
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