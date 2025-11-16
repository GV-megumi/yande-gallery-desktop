import React, { useState, useEffect } from 'react';
import { Button, Empty, message, Spin, Card, Tag, Space, Input, Tabs, Row, Col, Segmented } from 'antd';
import { FolderOpenOutlined, SearchOutlined, ClockCircleOutlined, AppstoreOutlined } from '@ant-design/icons';
import { ImageGrid } from '../components/ImageGrid';

const { Search } = Input;
const { TabPane } = Tabs;

export const GalleryPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState('recent');
  const [images, setImages] = useState<any[]>([]);
  const [galleries, setGalleries] = useState<any[]>([]);
  const [selectedGallery, setSelectedGallery] = useState<any | null>(null);
  // 最近图片懒加载：当前可见数量
  const [recentVisibleCount, setRecentVisibleCount] = useState(200);
  const [gallerySort, setGallerySort] = useState<'time' | 'name'>('time');
  const [allPage, setAllPage] = useState(1);
  const [allHasMore, setAllHasMore] = useState(true);
  const [galleryVisibleCount, setGalleryVisibleCount] = useState(200);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // 加载最近图片
  const loadRecentImages = async (count: number = 2000) => {
    if (!window.electronAPI) {
      console.error('electronAPI is not available');
      return;
    }

    setLoading(true);
    // 每次重新加载最近图片时，重置可见数量
    setRecentVisibleCount(200);
    try {
      const result = await window.electronAPI.gallery.getRecentImages(count);
      if (result.success) {
        setImages(result.data || []);
      } else {
        message.error('加载最近图片失败: ' + result.error);
      }
    } catch (error) {
      console.error('Failed to load recent images:', error);
      message.error('加载最近图片失败');
    } finally {
      setLoading(false);
    }
  };

  // 加载所有图片
  const loadImages = async (page: number = 1, pageSize: number = 500) => {
    if (!window.electronAPI) {
      console.error('electronAPI is not available');
      return;
    }

    setLoading(true);
    try {
      const result = await window.electronAPI.db.getImages(page, pageSize);
      if (result.success) {
        const list = result.data || [];
        setImages(list);
        // 如果返回数量少于 pageSize，说明已经没有更多
        setAllHasMore(list.length >= pageSize);
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

  // 加载图集列表
  const loadGalleries = async () => {
    if (!window.electronAPI) {
      console.error('electronAPI is not available');
      return;
    }

    setLoading(true);
    try {
      const result = await window.electronAPI.gallery.getGalleries();
      if (result.success) {
        setGalleries(result.data || []);
      } else {
        message.error('加载图集失败: ' + result.error);
      }
    } catch (error) {
      console.error('Failed to load galleries:', error);
      message.error('加载图集失败');
    } finally {
      setLoading(false);
    }
  };

  // 扫描文件夹
  const handleScanFolder = async () => {
    if (!window.electronAPI) {
      console.error('electronAPI is not available. Preload script may not be loaded.');
      message.error('系统功能不可用：electronAPI 未加载，请检查 preload 脚本');
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

  // 加载图集图片
  const loadGalleryImages = async (galleryId: number) => {
    if (!window.electronAPI) return;

    setLoading(true);
    try {
      // 每次加载新图集时重置可见数量
      setGalleryVisibleCount(200);
      const galleryResult = await window.electronAPI.gallery.getGallery(galleryId);
      if (galleryResult.success && galleryResult.data) {
        const folderPath = galleryResult.data.folderPath;
        // 单个图集一次性加载较多图片（例如 1000 张），方便浏览
        const result = await window.electronAPI.gallery.getImagesByFolder(folderPath, 1, 1000);
        if (result.success) {
          setImages(result.data || []);
        } else {
          message.error('加载图集图片失败: ' + result.error);
        }
      }
    } catch (error) {
      console.error('Failed to load gallery images:', error);
      message.error('加载图集图片失败');
    } finally {
      setLoading(false);
    }
  };

  // 创建新图集
  const handleCreateGallery = async () => {
    if (!window.electronAPI) {
      message.error('系统功能不可用');
      return;
    }

    const result = await window.electronAPI.system.selectFolder();
    if (!result.success || !result.data) {
      return;
    }

    const folderPath = result.data;
    const folderName = folderPath.split(/[/\\]/).pop() || '新图集';

    try {
      const createResult = await window.electronAPI.gallery.createGallery({
        folderPath,
        name: folderName,
        recursive: true
      });

      if (createResult.success) {
        message.success('图集创建成功');
        loadGalleries();
      } else {
        message.error('创建图集失败: ' + createResult.error);
      }
    } catch (error) {
      console.error('Failed to create gallery:', error);
      message.error('创建图集失败');
    }
  };

  useEffect(() => {
    if (activeTab === 'recent') {
      // 切换到“最近图片”标签时，重置可见数量
      setRecentVisibleCount(200);
      loadRecentImages(2000);
    } else if (activeTab === 'all') {
      setAllPage(1);
      loadImages(1, 500);
    } else if (activeTab === 'galleries') {
      loadGalleries();
    }
  }, [activeTab]);

  // 最近图片：滚动到底部附近时，自动再加载 200 张（懒加载渲染）
  useEffect(() => {
    if (activeTab !== 'recent') return;

    const handleScroll = () => {
      const scrollElement = document.documentElement || document.body;
      const { scrollTop, scrollHeight, clientHeight } = scrollElement;

      // 距离底部 300px 以内并且还有未显示的图片时，增加可见数量
      if (scrollHeight - (scrollTop + clientHeight) < 300) {
        setRecentVisibleCount((prev) => {
          if (prev >= images.length) return prev;
          return Math.min(prev + 200, images.length);
        });
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
    // 依赖于 images.length，保证新数据加载后滚动逻辑仍然生效
  }, [activeTab, images.length, images]);

  // 将本地文件路径转换为 app:// 协议 URL（用于图集封面）
  const getImageUrl = (filePath: string): string => {
    if (!filePath) return '';
    if (filePath.startsWith('app://')) return filePath;
    const normalized = filePath.replace(/\\/g, '/');
    return `app://${normalized}`;
  };

  return (
    <div style={{ padding: '24px' }}>
      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        <TabPane
          tab={
            <span>
              <ClockCircleOutlined />
              最近图片
            </span>
          }
          key="recent"
        >
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
              description="暂无最近图片"
              style={{ marginTop: '100px' }}
            >
              <Button type="primary" onClick={handleScanFolder}>
                扫描文件夹
              </Button>
            </Empty>
          ) : (
            <>
              <ImageGrid
                images={images.slice(0, recentVisibleCount)}
                onReload={loadRecentImages}
                groupBy="day"
                showTimeline
              />
              {recentVisibleCount < images.length && (
                <div style={{ marginTop: 24, textAlign: 'center' }}>
                  <Button
                    onClick={() =>
                      setRecentVisibleCount((prev) =>
                        Math.min(prev + 200, images.length)
                      )
                    }
                  >
                    加载更多（{recentVisibleCount}/{images.length}）
                  </Button>
                </div>
              )}
            </>
          )}
        </TabPane>

        <TabPane
          tab={
            <span>
              <AppstoreOutlined />
              所有图片
            </span>
          }
          key="all"
        >
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
            <>
              <ImageGrid images={images} onReload={() => loadImages(allPage, 500)} sortBy="time" />
              <div style={{ marginTop: 24, textAlign: 'center' }}>
                <Space>
                  <Button
                    disabled={allPage <= 1}
                    onClick={() => {
                      const next = Math.max(1, allPage - 1);
                      setAllPage(next);
                      loadImages(next, 500);
                    }}
                  >
                    上一页
                  </Button>
                  <span>第 {allPage} 页</span>
                  <Button
                    disabled={!allHasMore}
                    onClick={() => {
                      if (!allHasMore) return;
                      const next = allPage + 1;
                      setAllPage(next);
                      loadImages(next, 500);
                    }}
                  >
                    下一页
                  </Button>
                </Space>
              </div>
            </>
          )}
        </TabPane>

        <TabPane
          tab={
            <span>
              <AppstoreOutlined />
              图集
            </span>
          }
          key="galleries"
        >
          <div style={{ marginBottom: '24px' }}>
            <Button
              type="primary"
              icon={<FolderOpenOutlined />}
              onClick={handleCreateGallery}
            >
              创建图集
            </Button>
          </div>

          {selectedGallery ? (
            <>
              <div style={{ marginBottom: '16px' }}>
                <Button onClick={() => { setSelectedGallery(null); setImages([]); }}>
                  返回图集列表
                </Button>
                <span style={{ marginLeft: 16, fontWeight: 'bold' }}>
                  当前图集：{selectedGallery.name}
                </span>
                <span style={{ marginLeft: 24 }}>
                  排序：
                  <Segmented
                    size="small"
                    style={{ marginLeft: 8 }}
                    value={gallerySort}
                    onChange={(val) => setGallerySort(val as 'time' | 'name')}
                    options={[
                      { label: '按时间', value: 'time' },
                      { label: '按文件名', value: 'name' }
                    ]}
                  />
                </span>
              </div>
              {loading ? (
                <div style={{ textAlign: 'center', padding: '50px' }}>
                  <Spin size="large" />
                </div>
              ) : images.length === 0 ? (
                <Empty description="该图集暂无图片" style={{ marginTop: '100px' }} />
              ) : (
                <>
                  <ImageGrid
                    images={images.slice(0, galleryVisibleCount)}
                    onReload={() => loadGalleryImages(selectedGallery.id)}
                    groupBy={gallerySort === 'time' ? 'day' : 'none'}
                    sortBy={gallerySort}
                  />
                  {galleryVisibleCount < images.length && (
                    <div style={{ textAlign: 'center', marginTop: 24 }}>
                      <Button
                        onClick={() =>
                          setGalleryVisibleCount((prev) =>
                            Math.min(prev + 200, images.length)
                          )
                        }
                      >
                        加载更多（{galleryVisibleCount}/{images.length}）
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          ) : loading ? (
            <div style={{ textAlign: 'center', padding: '50px' }}>
              <Spin size="large" />
            </div>
          ) : galleries.length === 0 ? (
            <Empty
              description="暂无图集"
              style={{ marginTop: '100px' }}
            >
              <Button type="primary" onClick={handleCreateGallery}>
                创建图集
              </Button>
            </Empty>
          ) : (
            <Row gutter={[16, 16]}>
              {galleries.map((gallery: any) => (
                <Col key={gallery.id} xs={24} sm={12} md={8} lg={6}>
                  <Card
                    hoverable
                    cover={
                      gallery.coverImage ? (
                        <div style={{ height: '200px', overflow: 'hidden' }}>
                          <img
                            src={gallery.coverImage.filepath ? getImageUrl(gallery.coverImage.filepath) : undefined}
                            alt={gallery.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        </div>
                      ) : (
                        <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f0f0' }}>
                          <AppstoreOutlined style={{ fontSize: '48px', color: '#ccc' }} />
                        </div>
                      )
                    }
                    onClick={() => {
                      setSelectedGallery(gallery);
                      loadGalleryImages(gallery.id);
                    }}
                  >
                    <Card.Meta
                      title={gallery.name}
                      description={
                        <Space direction="vertical" size="small" style={{ width: '100%' }}>
                          <span>图片数量: {gallery.imageCount}</span>
                          {gallery.lastScannedAt && (
                            <span>最后扫描: {new Date(gallery.lastScannedAt).toLocaleString()}</span>
                          )}
                          <span style={{ fontSize: '12px', color: '#999', wordBreak: 'break-all' }}>
                            {gallery.folderPath}
                          </span>
                        </Space>
                      }
                    />
                  </Card>
                </Col>
              ))}
            </Row>
          )}
        </TabPane>
      </Tabs>
    </div>
  );
};