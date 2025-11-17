import React, { useState, useEffect } from 'react';
import { Button, Empty, message, Spin, Card, Tag, Space, Input, Row, Col, Segmented } from 'antd';
import { FolderOpenOutlined, SearchOutlined, ClockCircleOutlined, AppstoreOutlined } from '@ant-design/icons';
import { ImageGrid } from '../components/ImageGrid';

const { Search } = Input;

interface GalleryPageProps {
  subTab?: 'recent' | 'all' | 'galleries';
}

export const GalleryPage: React.FC<GalleryPageProps> = ({ subTab = 'recent' }) => {
  // 分离不同模式的状态，避免相互干扰
  const [recentImages, setRecentImages] = useState<any[]>([]); // 最近图片数据（懒加载，一次2000张）
  const [allImages, setAllImages] = useState<any[]>([]); // 所有图片分页数据（每次20张）
  const [galleryImages, setGalleryImages] = useState<any[]>([]); // 图集图片数据（懒加载，一次1000张）
  const [galleries, setGalleries] = useState<any[]>([]);
  const [selectedGallery, setSelectedGallery] = useState<any | null>(null);
  // 最近图片懒加载：当前可见数量
  const [recentVisibleCount, setRecentVisibleCount] = useState(200);
  const [gallerySort, setGallerySort] = useState<'time' | 'name'>('time');
  const [allPage, setAllPage] = useState(1);
  const [allHasMore, setAllHasMore] = useState(true);
  const [galleryVisibleCount, setGalleryVisibleCount] = useState(200);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [gallerySearchQuery, setGallerySearchQuery] = useState('');
  const [allGalleries, setAllGalleries] = useState<any[]>([]);
  // 搜索模式状态
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [searchHasMore, setSearchHasMore] = useState(true);
  const [searchTotal, setSearchTotal] = useState(0);

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
        const data = result.data || [];
        setRecentImages(data); // 存储到recentImages
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

  // 加载所有图片（分页加载，每次只加载一页，每页20张避免内存问题）
  const loadImages = async (page: number = 1, pageSize: number = 20) => {
    if (!window.electronAPI) {
      console.error('electronAPI is not available');
      return;
    }

    setLoading(true);
    // 切换页面时先清空旧数据，避免内存累积
    setAllImages([]); // 清空所有图片数据
    console.log(`[loadImages] 前端请求: page=${page}, pageSize=${pageSize}`);
    try {
      const result = await window.electronAPI.db.getImages(page, pageSize);
      if (result.success) {
        const list = result.data || [];
        console.log(`[loadImages] 前端收到数据数量: ${list.length}`);
        setAllImages(list); // 存储到allImages（只包含当前页的20张）
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
        const galleryList = result.data || [];
        setAllGalleries(galleryList);
        // 根据搜索查询过滤图集
        if (gallerySearchQuery.trim()) {
          const filtered = galleryList.filter((gallery: any) =>
            gallery.name.toLowerCase().includes(gallerySearchQuery.toLowerCase())
          );
          setGalleries(filtered);
        } else {
          setGalleries(galleryList);
        }
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

  // 搜索图集名称
  const handleGallerySearch = (query: string) => {
    setGallerySearchQuery(query);
    if (!query.trim()) {
      setGalleries(allGalleries);
    } else {
      const filtered = allGalleries.filter((gallery: any) =>
        gallery.name.toLowerCase().includes(query.toLowerCase())
      );
      setGalleries(filtered);
    }
  };

  // 搜索图片（支持分页，每次只加载一页，每页20张避免内存问题）
  const handleSearch = async (query: string, page: number = 1, pageSize: number = 20) => {
    if (!window.electronAPI) return;

    if (!query.trim()) {
      setIsSearchMode(false);
      setSearchQuery('');
      setSearchPage(1);
      loadImages(1, 20);
      return;
    }

    setLoading(true);
    setIsSearchMode(true);
    setSearchPage(page);
    // 切换页面时先清空旧数据，避免内存累积
    setAllImages([]); // 清空所有图片数据
    try {
      const result: any = await window.electronAPI.db.searchImages(query, page, pageSize);
      if (result.success) {
        const list = result.data || [];
        setAllImages(list); // 存储到allImages（搜索结果，只包含当前页的20张）
        setSearchTotal(result.total || 0);
        // 如果返回数量少于 pageSize，说明已经没有更多
        setSearchHasMore(list.length >= pageSize);
      } else {
        message.error('搜索失败: ' + result.error);
      }
    } catch (error) {
      console.error('Search failed:', error);
      message.error('搜索失败');
    } finally {
      setLoading(false);
    }
  };

  // 搜索输入框的回调（只接收一个参数）
  const handleSearchInput = (value: string) => {
    handleSearch(value, 1, 50);
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
          const data = result.data || [];
          setGalleryImages(data); // 存储到galleryImages
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
    if (subTab === 'recent') {
      // 切换到"最近图片"时，重置可见数量
      setRecentVisibleCount(200);
      setIsSearchMode(false);
      setSearchQuery('');
      // 切换tab时先清空其他模式的数据
      setAllImages([]);
      setGalleryImages([]);
      loadRecentImages(2000);
    } else if (subTab === 'all') {
      setAllPage(1);
      setIsSearchMode(false);
      setSearchQuery('');
      // 切换tab时先清空其他模式的数据
      setRecentImages([]);
      setGalleryImages([]);
      setAllImages([]);
      loadImages(1, 20);
    } else if (subTab === 'galleries') {
      // 切换tab时先清空其他模式的数据
      setRecentImages([]);
      setAllImages([]);
      setGalleryImages([]);
      loadGalleries();
    }
  }, [subTab]);

  // 当图集搜索查询改变时，重新过滤图集列表
  useEffect(() => {
    if (subTab === 'galleries' && allGalleries.length > 0) {
      if (!gallerySearchQuery.trim()) {
        setGalleries(allGalleries);
      } else {
        const filtered = allGalleries.filter((gallery: any) =>
          gallery.name.toLowerCase().includes(gallerySearchQuery.toLowerCase())
        );
        setGalleries(filtered);
      }
    }
  }, [gallerySearchQuery, allGalleries, subTab]);

  // 最近图片：滚动到底部附近时，自动再加载 200 张（懒加载渲染）
  useEffect(() => {
    if (subTab !== 'recent') return;

    const handleScroll = () => {
      const scrollElement = document.documentElement || document.body;
      const { scrollTop, scrollHeight, clientHeight } = scrollElement;

      // 距离底部 300px 以内并且还有未显示的图片时，增加可见数量
        if (scrollHeight - (scrollTop + clientHeight) < 300) {
          setRecentVisibleCount((prev) => {
            if (prev >= recentImages.length) return prev;
            return Math.min(prev + 200, recentImages.length);
          });
        }
    };

    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
    // 依赖于 recentImages.length，保证新数据加载后滚动逻辑仍然生效
  }, [subTab, recentImages.length, recentImages]);

  // 将本地文件路径转换为 app:// 协议 URL（用于图集封面）
  const getImageUrl = (filePath: string): string => {
    if (!filePath) return '';
    if (filePath.startsWith('app://')) return filePath;
    const normalized = filePath.replace(/\\/g, '/');
    return `app://${normalized}`;
  };

  // 根据 subTab 渲染不同内容
  const renderContent = () => {
    if (subTab === 'recent') {
      return (
        <>
          <div style={{ marginBottom: '24px', display: 'flex', gap: '12px', alignItems: 'center' }}>
            <Search
              placeholder="搜索图片..."
              allowClear
              enterButton={<SearchOutlined />}
              style={{ width: 300 }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onSearch={handleSearchInput}
            />
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '50px' }}>
              <Spin size="large" />
            </div>
          ) : recentImages.length === 0 ? (
            <Empty
              description="暂无最近图片"
              style={{ marginTop: '100px' }}
            />
          ) : (
            <>
              {/* 最近图片：懒加载模式，只渲染可见部分 */}
              <ImageGrid
                images={recentImages.slice(0, recentVisibleCount)}
                onReload={loadRecentImages}
                groupBy="day"
                showTimeline
              />
              {recentVisibleCount < recentImages.length && (
                <div style={{ marginTop: 24, textAlign: 'center' }}>
                  <Button
                    onClick={() =>
                      setRecentVisibleCount((prev) =>
                        Math.min(prev + 200, recentImages.length)
                      )
                    }
                  >
                    加载更多（{recentVisibleCount}/{recentImages.length}）
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      );
    } else if (subTab === 'all') {
      return (
        <>
          <div style={{ marginBottom: '24px', display: 'flex', gap: '12px', alignItems: 'center' }}>
            <Search
              placeholder="搜索图片..."
              allowClear
              enterButton={<SearchOutlined />}
              style={{ width: 300 }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onSearch={handleSearchInput}
            />
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '50px' }}>
              <Spin size="large" />
            </div>
          ) : allImages.length === 0 ? (
            <Empty
              description={isSearchMode ? `未找到匹配"${searchQuery}"的图片` : '暂无图片'}
              style={{ marginTop: '100px' }}
            />
          ) : (
            <>
              {isSearchMode && (
                <div style={{ marginBottom: '16px', color: '#666' }}>
                  找到 {searchTotal} 张匹配的图片
                </div>
              )}
              {/* 所有图片：分页模式，只渲染当前页的20张图片 */}
              <ImageGrid images={allImages} onReload={() => isSearchMode ? handleSearch(searchQuery, searchPage, 20) : loadImages(allPage, 20)} sortBy="time" groupBy="none" />
              <div style={{ marginTop: 24, textAlign: 'center' }}>
                <Space>
                  <Button
                    disabled={isSearchMode ? searchPage <= 1 : allPage <= 1}
                    onClick={() => {
                      if (isSearchMode) {
                        const next = Math.max(1, searchPage - 1);
                        handleSearch(searchQuery, next, 20);
                      } else {
                        const next = Math.max(1, allPage - 1);
                        setAllPage(next);
                        loadImages(next, 20);
                      }
                    }}
                  >
                    上一页
                  </Button>
                  <span>
                    第 {isSearchMode ? searchPage : allPage} 页
                    {isSearchMode && searchTotal > 0 && ` / 共 ${Math.ceil(searchTotal / 20)} 页`}
                  </span>
                  <Button
                    disabled={isSearchMode ? !searchHasMore : !allHasMore}
                    onClick={() => {
                      if (isSearchMode) {
                        if (!searchHasMore) return;
                        const next = searchPage + 1;
                        handleSearch(searchQuery, next, 20);
                      } else {
                        if (!allHasMore) return;
                        const next = allPage + 1;
                        setAllPage(next);
                        loadImages(next, 20);
                      }
                    }}
                  >
                    下一页
                  </Button>
                </Space>
              </div>
            </>
          )}
        </>
      );
    } else if (subTab === 'galleries') {
      return (
        <>
          <div style={{ marginBottom: '24px', display: 'flex', gap: '12px', alignItems: 'center' }}>
            <Button
              type="primary"
              icon={<FolderOpenOutlined />}
              onClick={handleCreateGallery}
            >
              创建图集
            </Button>
            <Search
              placeholder="搜索图集名称..."
              allowClear
              enterButton={<SearchOutlined />}
              style={{ width: 300 }}
              value={gallerySearchQuery}
              onChange={(e) => setGallerySearchQuery(e.target.value)}
              onSearch={handleGallerySearch}
            />
          </div>

          {selectedGallery ? (
            <>
              <div style={{ marginBottom: '16px' }}>
                <Button onClick={() => { 
                  setSelectedGallery(null); 
                  setGalleryImages([]);
                }}>
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
              ) : galleryImages.length === 0 ? (
                <Empty description="该图集暂无图片" style={{ marginTop: '100px' }} />
              ) : (
                <>
                  {/* 图集：懒加载模式，只渲染可见部分 */}
                  <ImageGrid
                    images={galleryImages.slice(0, galleryVisibleCount)}
                    onReload={() => loadGalleryImages(selectedGallery.id)}
                    groupBy={gallerySort === 'time' ? 'day' : 'none'}
                    sortBy={gallerySort}
                  />
                  {galleryVisibleCount < galleryImages.length && (
                    <div style={{ textAlign: 'center', marginTop: 24 }}>
                      <Button
                        onClick={() =>
                          setGalleryVisibleCount((prev) =>
                            Math.min(prev + 200, galleryImages.length)
                          )
                        }
                      >
                        加载更多（{galleryVisibleCount}/{galleryImages.length}）
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
              description={gallerySearchQuery ? '未找到匹配的图集' : '暂无图集'}
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
        </>
      );
    }
    return null;
  };

  return (
    <div style={{ padding: '24px' }}>
      {renderContent()}
    </div>
  );
};