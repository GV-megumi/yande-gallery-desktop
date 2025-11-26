import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Button, Empty, message as antdMessage, Spin, Select, Space, Segmented, Affix, App, Typography } from 'antd';
import { ReloadOutlined, BookOutlined, DownloadOutlined, DeleteOutlined } from '@ant-design/icons';
import { BooruImageCard } from '../components/BooruImageCard';
import { BooruPostDetailsPage } from './BooruPostDetailsPage';
import { BooruPost, BooruSite } from '../../shared/types';

const { Title } = Typography;
const { Option } = Select;

interface BooruFavoritesPageProps {
  onTagClick?: (tag: string, siteId?: number | null) => void;
}

/**
 * Booru 收藏页面
 * 展示、管理和下载收藏的图片
 */
export const BooruFavoritesPage: React.FC<BooruFavoritesPageProps> = ({
  onTagClick
}) => {
  const { message } = App.useApp();
  const [sites, setSites] = useState<BooruSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);
  const [posts, setPosts] = useState<BooruPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [ratingFilter, setRatingFilter] = useState<'all' | 'safe' | 'questionable' | 'explicit'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const [selectedPost, setSelectedPost] = useState<BooruPost | null>(null);
  const [detailsPageOpen, setDetailsPageOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [appearanceConfig, setAppearanceConfig] = useState({
    gridSize: 330,
    previewQuality: 'auto' as 'auto' | 'low' | 'medium' | 'high' | 'original',
    itemsPerPage: 20,
    paginationPosition: 'bottom' as 'top' | 'bottom' | 'both',
    pageMode: 'pagination' as 'pagination' | 'infinite',
    spacing: 16,
    borderRadius: 8,
    margin: 24
  });

  // 加载外观配置
  const loadAppearanceConfig = async () => {
    console.log('[BooruFavoritesPage] 加载外观配置');
    try {
      if (!window.electronAPI) {
        console.error('[BooruFavoritesPage] electronAPI is not available');
        return;
      }

      const result = await window.electronAPI.config.get();
      if (result.success && result.data) {
        const booruConfig = result.data.booru;
        if (booruConfig?.appearance) {
          console.log('[BooruFavoritesPage] 加载外观配置成功:', booruConfig.appearance);
          setAppearanceConfig({
            gridSize: booruConfig.appearance.gridSize || 330,
            previewQuality: booruConfig.appearance.previewQuality || 'auto',
            itemsPerPage: booruConfig.appearance.itemsPerPage || 20,
            paginationPosition: booruConfig.appearance.paginationPosition || 'bottom',
            pageMode: booruConfig.appearance.pageMode || 'pagination',
            spacing: booruConfig.appearance.spacing || 16,
            borderRadius: booruConfig.appearance.borderRadius || 8,
            margin: booruConfig.appearance.margin || 24
          });
        }
      }
    } catch (error) {
      console.error('[BooruFavoritesPage] 加载外观配置失败:', error);
    }
  };

  // 加载站点列表
  const loadSites = async () => {
    console.log('[BooruFavoritesPage] 加载站点列表');
    try {
      if (!window.electronAPI) {
        console.error('[BooruFavoritesPage] electronAPI is not available');
        return;
      }

      const result = await window.electronAPI.booru.getSites();
      if (result.success && result.data) {
        console.log('[BooruFavoritesPage] 加载站点列表成功:', result.data.length, '个站点');
        setSites(result.data);
        
        if (result.data.length > 0) {
          setSelectedSiteId(result.data[0].id);
        }
      } else {
        console.error('[BooruFavoritesPage] 加载站点列表失败:', result.error);
      }
    } catch (error) {
      console.error('[BooruFavoritesPage] 加载站点列表异常:', error);
    }
  };

  // 加载收藏列表
  const loadFavorites = async (page: number = 1) => {
    if (!selectedSiteId) {
      message.warning('请先选择站点');
      return;
    }

    console.log(`[BooruFavoritesPage] 加载收藏列表，站点: ${selectedSiteId}, 页码: ${page}`);
    setLoading(true);

    try {
      if (!window.electronAPI) {
        setLoading(false);
        return;
      }

      const result = await window.electronAPI.booru.getFavorites(selectedSiteId, page, appearanceConfig.itemsPerPage);
      if (result.success) {
        const data = result.data || [];
        console.log('[BooruFavoritesPage] 加载收藏成功:', data.length, '张图片');
        
        setPosts(data);
        setCurrentPage(page);
        setHasMore(data.length >= appearanceConfig.itemsPerPage);

        // 所有收藏的图片都是已收藏状态
        const favoriteIds = new Set(data.map(p => p.id));
        setFavorites(favoriteIds);
      } else {
        console.error('[BooruFavoritesPage] 加载收藏失败:', result.error);
        message.error('加载收藏失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BooruFavoritesPage] 加载收藏失败:', error);
      message.error('加载收藏失败');
    } finally {
      setLoading(false);
    }
  };

  // 处理站点切换
  const handleSiteChange = (siteId: number) => {
    console.log('[BooruFavoritesPage] 切换站点:', siteId);
    setSelectedSiteId(siteId);
    setPosts([]);
    setCurrentPage(1);
    setHasMore(true);
    loadFavorites(1);
  };

  // 处理收藏切换（在收藏页面中，点击就是取消收藏）
  const handleToggleFavorite = async (post: BooruPost) => {
    console.log('[BooruFavoritesPage] 取消收藏:', post.id);
    try {
      if (!window.electronAPI || !selectedSiteId) return;

      const result = await window.electronAPI.booru.removeFavorite(post.id);
      if (result.success) {
        setFavorites(prev => {
          const newSet = new Set(prev);
          newSet.delete(post.id);
          return newSet;
        });
        setPosts(prevPosts => prevPosts.filter(p => p.id !== post.id));
        message.success('已取消收藏');
        // 如果当前页没有图片了，加载上一页
        if (posts.length === 1 && currentPage > 1) {
          loadFavorites(currentPage - 1);
        }
      } else {
        message.error('取消收藏失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BooruFavoritesPage] 取消收藏失败:', error);
      message.error('操作失败');
    }
  };

  // 处理下载
  const handleDownload = async (post: BooruPost) => {
    console.log('[BooruFavoritesPage] 下载图片:', post.postId);
    try {
      if (!window.electronAPI || !selectedSiteId) return;

      const result = await window.electronAPI.booru.addToDownload(post.postId, selectedSiteId);
      if (result.success) {
        message.success('已添加到下载队列');
      } else {
        message.error('下载失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BooruFavoritesPage] 下载失败:', error);
      message.error('下载失败');
    }
  };

  // 处理标签点击（导航到标签搜索页面）
  const handleTagClick = (tag: string) => {
    console.log('[BooruFavoritesPage] 点击标签:', tag);
    if (onTagClick) {
      onTagClick(tag, selectedSiteId);
    } else {
      message.info('点击标签功能需要从父组件传递导航函数');
    }
  };

  // 处理图片预览
  const handlePreview = (post: BooruPost) => {
    console.log('[BooruFavoritesPage] 预览图片:', post.postId);
    setSelectedPost(post);
    setDetailsPageOpen(true);
  };

  // 获取预览URL（复用 BooruPage 的逻辑）
  const getPreviewUrl = (post: BooruPost): string => {
    if (!post) return '';
    
    // 优先检查是否有本地路径（已下载的图片）
    if (post.localPath) {
      try {
        let appUrl = post.localPath;
        if (appUrl.match(/^[A-Z]:\\/)) {
          const driveLetter = appUrl[0].toLowerCase();
          const pathPart = appUrl.substring(3).replace(/\\/g, '/');
          appUrl = `app://${driveLetter}/${pathPart}`;
        } else if (appUrl.startsWith('/')) {
          appUrl = `app://${appUrl}`;
        } else if (appUrl.startsWith('app://')) {
          // 已经是 app:// 协议，直接使用
        } else {
          appUrl = `app://${appUrl.replace(/\\/g, '/')}`;
        }
        console.log('[BooruFavoritesPage] 使用本地图片路径:', appUrl);
        return appUrl;
      } catch (e) {
        console.warn('[BooruFavoritesPage] 本地路径转换失败，使用远程URL:', e);
      }
    }
    
    const quality = appearanceConfig.previewQuality;
    let url = '';
    
    if (quality === 'original') {
      url = post.fileUrl || post.sampleUrl || post.previewUrl || '';
    } else if (quality === 'high') {
      url = post.sampleUrl || post.previewUrl || '';
    } else if (quality === 'medium') {
      url = post.sampleUrl || post.previewUrl || '';
    } else if (quality === 'low') {
      url = post.previewUrl || '';
    } else {
      url = post.sampleUrl || post.previewUrl || '';
    }
    
    // 如果 URL 包含标签（可能返回 307），自动回退到 previewUrl
    if (url && (url.includes('%20') || url.includes('yande.re%20'))) {
      console.warn('[BooruFavoritesPage] URL 包含标签，可能返回 307 重定向，回退到 previewUrl');
      url = post.previewUrl || '';
    }
    
    if (!url && post.fileUrl) {
      console.warn('[BooruFavoritesPage] 使用 fileUrl 作为后备');
      url = post.fileUrl;
    }
    
    return url;
  };

  // 初始化
  useEffect(() => {
    console.log('[BooruFavoritesPage] 初始化页面');
    loadAppearanceConfig();
    loadSites();
  }, []);

  // 当站点切换时，加载收藏
  useEffect(() => {
    if (selectedSiteId) {
      loadFavorites(1);
    }
  }, [selectedSiteId]);

  const selectedSite = sites.find(s => s.id === selectedSiteId);
  const ratingOptions = [
    { label: '全部', value: 'all' },
    { label: '安全', value: 'safe' },
    { label: '可疑', value: 'questionable' },
    { label: '明确', value: 'explicit' }
  ];

  // 按 ID 倒序排序（最新的在前）
  const sortedPosts = useMemo(() => {
    return [...posts].sort((a, b) => b.postId - a.postId);
  }, [posts]);

  return (
    <div ref={contentRef} style={{ padding: appearanceConfig.margin }}>
      {/* 页面标题 */}
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>
          <BookOutlined /> 我的收藏
        </Title>
      </div>

      {/* 工具栏 */}
      <Affix offsetTop={0}>
        <div style={{ 
          background: '#fff', 
          padding: '16px', 
          borderRadius: '8px',
          marginBottom: 16,
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}>
          <Space wrap>
            {/* 站点选择 */}
            <Space>
              <span>站点:</span>
              <Select
                value={selectedSiteId}
                onChange={handleSiteChange}
                style={{ width: 200 }}
                disabled={loading}
              >
                {sites.map(site => (
                  <Option key={site.id} value={site.id}>
                    {site.name}
                  </Option>
                ))}
              </Select>
            </Space>

            {/* 分级筛选 */}
            <Space wrap>
              <span>分级:</span>
              <Segmented
                value={ratingFilter}
                onChange={(value) => {
                  setRatingFilter(value as any);
                }}
                options={ratingOptions}
                disabled={loading}
              />
            </Space>

            {/* 操作按钮 */}
            <Space wrap>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => loadFavorites(currentPage)}
                loading={loading}
                disabled={!selectedSiteId}
              >
                刷新
              </Button>
            </Space>
          </Space>
        </div>
      </Affix>

      {/* 图片列表 */}
      <div>
        {loading && (
          <div style={{ textAlign: 'center', padding: '50px' }}>
            <Spin size="large" />
          </div>
        )}

        {!loading && posts.length === 0 && (
          <Empty
            description="暂无收藏的图片"
            style={{ marginTop: '100px' }}
          >
            <Button
              type="primary"
              onClick={() => loadFavorites(1)}
              disabled={!selectedSiteId}
            >
              重新加载
            </Button>
          </Empty>
        )}

        {!loading && posts.length > 0 && (
          <>
            {/* 顶部分页 */}
            {(appearanceConfig.paginationPosition === 'top' || appearanceConfig.paginationPosition === 'both') && (
              <div style={{ marginBottom: 24, textAlign: 'center' }}>
                <Space>
                  <Button
                    disabled={currentPage <= 1}
                    onClick={() => loadFavorites(Math.max(1, currentPage - 1))}
                  >
                    上一页
                  </Button>
                  <span>第 {currentPage} 页</span>
                  <Button
                    disabled={posts.length < appearanceConfig.itemsPerPage}
                    onClick={() => loadFavorites(currentPage + 1)}
                  >
                    下一页
                  </Button>
                </Space>
              </div>
            )}

            <BooruGridLayout
              posts={sortedPosts.filter(post => ratingFilter === 'all' || post.rating === ratingFilter)}
              gridSize={appearanceConfig.gridSize}
              spacing={appearanceConfig.spacing}
              borderRadius={appearanceConfig.borderRadius}
              selectedSite={selectedSite || null}
              onPreview={handlePreview}
              onDownload={handleDownload}
              onToggleFavorite={handleToggleFavorite}
              favorites={favorites}
              getPreviewUrl={getPreviewUrl}
            />

            {/* 底部分页 */}
            {(appearanceConfig.paginationPosition === 'bottom' || appearanceConfig.paginationPosition === 'both') && (
              <div style={{ marginTop: 24, textAlign: 'center' }}>
                <Space>
                  <Button
                    disabled={currentPage <= 1}
                    onClick={() => loadFavorites(Math.max(1, currentPage - 1))}
                  >
                    上一页
                  </Button>
                  <span>第 {currentPage} 页</span>
                  <Button
                    disabled={posts.length < appearanceConfig.itemsPerPage}
                    onClick={() => loadFavorites(currentPage + 1)}
                  >
                    下一页
                  </Button>
                </Space>
              </div>
            )}
          </>
        )}
      </div>

      {/* 图片详情页面 */}
      <BooruPostDetailsPage
        open={detailsPageOpen}
        post={selectedPost}
        site={selectedSite || null}
        posts={sortedPosts}
        initialIndex={selectedPost ? sortedPosts.findIndex(p => p.id === selectedPost.id) : 0}
        onClose={() => {
          setDetailsPageOpen(false);
          setSelectedPost(null);
        }}
        onToggleFavorite={handleToggleFavorite}
        onDownload={handleDownload}
        onTagClick={handleTagClick}
      />
    </div>
  );
};

/**
 * Booru 动态网格布局组件（复用自 BooruPage）
 */
interface BooruGridLayoutProps {
  posts: BooruPost[];
  gridSize: number;
  spacing: number;
  borderRadius: number;
  selectedSite: BooruSite | null;
  onPreview: (post: BooruPost) => void;
  onDownload: (post: BooruPost) => void;
  onToggleFavorite: (post: BooruPost) => void;
  favorites: Set<number>;
  getPreviewUrl: (post: BooruPost) => string;
}

const BooruGridLayout: React.FC<BooruGridLayoutProps> = ({
  posts,
  gridSize,
  spacing,
  borderRadius,
  selectedSite,
  onPreview,
  onDownload,
  onToggleFavorite,
  favorites,
  getPreviewUrl
}) => {
  // 按 ID 倒序排序（最新的在前）
  const sortedPosts = useMemo(() => {
    return [...posts].sort((a, b) => b.postId - a.postId);
  }, [posts]);

  // 计算每行能放多少张图片
  const containerRef = useRef<HTMLDivElement>(null);
  const [itemsPerRow, setItemsPerRow] = useState(5);
  const [imageHeights, setImageHeights] = useState<Record<number, number>>({});

  useEffect(() => {
    const updateItemsPerRow = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        const calculated = Math.floor((containerWidth + spacing) / (gridSize + spacing));
        setItemsPerRow(Math.max(1, calculated));
      }
    };

    updateItemsPerRow();
    window.addEventListener('resize', updateItemsPerRow);
    return () => window.removeEventListener('resize', updateItemsPerRow);
  }, [gridSize, spacing]);

  // 处理图片加载完成，记录高度
  const handleImageLoad = (postId: number, height: number) => {
    setImageHeights(prev => ({
      ...prev,
      [postId]: height
    }));
  };

  // 将图片分组为行
  const rows = useMemo(() => {
    const result: BooruPost[][] = [];
    for (let i = 0; i < sortedPosts.length; i += itemsPerRow) {
      result.push(sortedPosts.slice(i, i + itemsPerRow));
    }
    return result;
  }, [sortedPosts, itemsPerRow]);

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      {rows.map((row, rowIndex) => {
        // 计算该行的最大高度
        const rowHeights = row.map(post => {
          const height = imageHeights[post.postId];
          return height || (gridSize * 1.5);
        });
        const maxHeight = Math.max(...rowHeights);

        return (
          <div
            key={rowIndex}
            style={{
              display: 'flex',
              gap: `${spacing}px`,
              marginBottom: `${spacing}px`,
              minHeight: `${maxHeight}px`
            }}
          >
            {row.map(post => (
              <div
                key={post.id}
                style={{
                  width: `${gridSize}px`,
                  flexShrink: 0,
                  borderRadius: `${borderRadius}px`,
                  overflow: 'hidden',
                  height: '100%'
                }}
              >
                <BooruImageCard
                  post={post}
                  siteName={selectedSite?.name || ''}
                  onPreview={onPreview}
                  onDownload={onDownload}
                  onToggleFavorite={onToggleFavorite}
                  isFavorited={favorites.has(post.id) || post.isFavorited}
                  previewUrl={getPreviewUrl(post)}
                  onImageLoad={handleImageLoad}
                />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
};

