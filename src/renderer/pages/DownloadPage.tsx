import React, { useState, useEffect } from 'react';
import { Card, Button, Space, Input, Tag, Spin, message, List, Image, Pagination } from 'antd';
import { DownloadOutlined, SearchOutlined } from '@ant-design/icons';

const { Search } = Input;

export const DownloadPage: React.FC = () => {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTags, setSearchTags] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState(0);

  // 加载Yande.re图片
  const loadImages = async (page: number = 1, tags?: string[]) => {
    if (!window.electronAPI) {
      message.error('Yande.re功能暂不可用');
      return;
    }

    setLoading(true);
    try {
      const result = await window.electronAPI.yande.getImages(page, tags);
      if (result.success) {
        setImages(result.data || []);
        setTotal(200); // 模拟总数量
      } else {
        message.error('加载失败: ' + result.error);
      }
    } catch (error) {
      console.error('Failed to load images:', error);
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  // 搜索图片
  const handleSearch = (query: string) => {
    const tags = query.split(' ').filter(tag => tag.trim());
    setCurrentPage(1);
    loadImages(1, tags);
  };

  // 下载图片
  const handleDownload = async (image: any) => {
    if (!window.electronAPI) {
      message.error('下载功能暂不可用');
      return;
    }

    try {
      const result = await window.electronAPI.yande.downloadImage(image);
      if (result.success) {
        message.success('下载成功');
      } else {
        message.error('下载失败: ' + result.error);
      }
    } catch (error) {
      console.error('Download failed:', error);
      message.error('下载失败');
    }
  };

  // 分页变化
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    const tags = searchTags.split(' ').filter(tag => tag.trim());
    loadImages(page, tags);
  };

  useEffect(() => {
    loadImages();
  }, []);

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ marginBottom: '24px', display: 'flex', gap: '12px' }}>
        <Search
          placeholder="输入标签搜索，多个标签用空格分隔"
          allowClear
          enterButton={<SearchOutlined />}
          style={{ width: 400 }}
          value={searchTags}
          onChange={(e) => setSearchTags(e.target.value)}
          onSearch={handleSearch}
        />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px' }}>
          <Spin size="large" />
        </div>
      ) : (
        <>
          <List
            grid={{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 4, xl: 5, xxl: 6 }}
            dataSource={images}
            renderItem={(image) => (
              <List.Item>
                <Card
                  hoverable
                  cover={
                    <div style={{ height: '200px', overflow: 'hidden' }}>
                      <Image
                        src={image.previewUrl}
                        alt={image.filename}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        preview={false}
                      />
                    </div>
                  }
                  actions={[
                    <Button
                      key="download"
                      type="primary"
                      icon={<DownloadOutlined />}
                      size="small"
                      onClick={() => handleDownload(image)}
                    >
                      下载
                    </Button>
                  ]}
                >
                  <Card.Meta
                    title={image.filename}
                    description={
                      <Space direction="vertical" size="small" style={{ width: '100%' }}>
                        <Tag color={
                          image.rating === 'safe' ? 'green' :
                          image.rating === 'questionable' ? 'orange' : 'red'
                        }>
                          {image.rating}
                        </Tag>
                        <div style={{ maxHeight: '60px', overflow: 'hidden' }}>
                          {image.tags.slice(0, 5).map((tag: string) => (
                            <Tag key={tag} style={{ margin: '2px' }}>{tag}</Tag>
                          ))}
                        </div>
                      </Space>
                    }
                  />
                </Card>
              </List.Item>
            )}
          />

          <div style={{ textAlign: 'center', marginTop: '24px' }}>
            <Pagination
              current={currentPage}
              total={total}
              pageSize={20}
              showSizeChanger={false}
              onChange={handlePageChange}
            />
          </div>
        </>
      )}
    </div>
  );
};