import React, { useState, useEffect } from 'react';
import { Button, Empty, message, Spin, Card, Image, Tag, Space, Input } from 'antd';
import { FolderOpenOutlined, SearchOutlined } from '@ant-design/icons';
import { ImageGrid } from '../components/ImageGrid';

const { Search } = Input;

export const GalleryPage: React.FC = () => {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // 加载图片列表
  const loadImages = async (page: number = 1) => {
    if (!window.electronAPI) {
      console.error('electronAPI is not available');
      return;
    }

    setLoading(true);
    try {
      const result = await window.electronAPI.db.getImages(page, 50);
      if (result.success) {
        setImages(result.data || []);
      } else {
        message.error('加载图片失败: ' + result.error);
      }
    } catch (error) {
      console.error('Failed to load images:', error);
      message.error('加载图片失败');
    } finally {
      setLoading(false);
    }
  };

  // 扫描文件夹
  const handleScanFolder = async () => {
    if (!window.electronAPI) {
      message.error('系统功能不可用');
      return;
    }

    const result = await window.electronAPI.system.selectFolder();
    if (!result.success || !result.data) {
      return;
    }

    setScanning(true);
    try {
      const scanResult = await window.electronAPI.image.scanFolder(result.data);
      if (scanResult.success) {
        message.success(`扫描完成，共找到 ${scanResult.data?.length || 0} 张图片`);
        loadImages();
      } else {
        message.error('扫描失败: ' + scanResult.error);
      }
    } catch (error) {
      console.error('Failed to scan folder:', error);
      message.error('扫描失败');
    } finally {
      setScanning(false);
    }
  };

  // 搜索图片
  const handleSearch = async (query: string) => {
    if (!window.electronAPI) return;

    if (!query.trim()) {
      loadImages();
      return;
    }

    try {
      const result = await window.electronAPI.db.searchImages(query);
      if (result.success) {
        setImages(result.data || []);
      } else {
        message.error('搜索失败: ' + result.error);
      }
    } catch (error) {
      console.error('Search failed:', error);
      message.error('搜索失败');
    }
  };

  useEffect(() => {
    loadImages();
  }, []);

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ marginBottom: '24px', display: 'flex', gap: '12px', alignItems: 'center' }}>
        <Button
          type="primary"
          icon={<FolderOpenOutlined />}
          onClick={handleScanFolder}
          loading={scanning}
        >
          扫描文件夹
        </Button>
        <Search
          placeholder="搜索图片..."
          allowClear
          enterButton={<SearchOutlined />}
          style={{ width: 300 }}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onSearch={handleSearch}
        />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px' }}>
          <Spin size="large" />
        </div>
      ) : images.length === 0 ? (
        <Empty
          description="暂无图片"
          style={{ marginTop: '100px' }}
        >
          <Button type="primary" onClick={handleScanFolder}>
            扫描文件夹
          </Button>
        </Empty>
      ) : (
        <ImageGrid images={images} onReload={loadImages} />
      )}
    </div>
  );
};