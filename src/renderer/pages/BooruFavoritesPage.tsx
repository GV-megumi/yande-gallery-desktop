import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Button, Empty, App, Typography } from 'antd';
import { BookOutlined } from '@ant-design/icons';
import { BooruGridLayout } from '../components/BooruGridLayout';
import { BooruPageToolbar, RatingFilter } from '../components/BooruPageToolbar';
import { PaginationControl } from '../components/PaginationControl';
import { SkeletonGrid } from '../components/SkeletonGrid';
import { BooruPostDetailsPage } from './BooruPostDetailsPage';
import { BooruPost, BooruSite } from '../../shared/types';
import { getBooruPreviewUrl } from '../utils/url';
import { spacing } from '../styles/tokens';
import { useFavorite } from '../hooks/useFavorite';

const { Title } = Typography;

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
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [selectedPost, setSelectedPost] = useState<BooruPost | null>(null);
  const [detailsPageOpen, setDetailsPageOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // 用 ref 持有最新的 posts 长度，避免 onSuccess 回调中的闭包过期
  const postsLengthRef = useRef(posts.length);
  postsLengthRef.current = posts.length;

  // 收藏状态管理（在收藏页面中，取消收藏会从列表移除）
  const { favorites, setFavorites, toggleFavorite } = useFavorite({
    siteId: selectedSiteId,
    onSuccess: (postId, isFavorited) => {
      if (!isFavorited) {
        // 取消收藏：从列表中移除
        setPosts(prevPosts => prevPosts.filter(p => p.id !== postId));
        message.success('已取消收藏');
        // 如果当前页没有图片了，加载上一页（使用 ref 避免闭包过期）
        if (postsLengthRef.current === 1 && currentPage > 1) {
          loadFavorites(currentPage - 1);
        }
      }
    },
    logPrefix: '[BooruFavoritesPage]'
  });

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

  // 处理收藏切换（委托给 useFavorite Hook）
  const handleToggleFavorite = async (post: BooruPost) => {
    const result = await toggleFavorite(post);
    if (!result.success) {
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

  // 获取预览URL（委托给统一的 url 工具函数）
  const getPreviewUrl = (post: BooruPost): string => {
    return getBooruPreviewUrl(post, appearanceConfig.previewQuality);
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

  // 按 ID 倒序排序（最新的在前）
  const sortedPosts = useMemo(() => {
    return [...posts].sort((a, b) => b.postId - a.postId);
  }, [posts]);

  // 排序后再按评级筛选
  const filteredSortedPosts = useMemo(() => {
    if (ratingFilter === 'all') return sortedPosts;
    return sortedPosts.filter(post => post.rating === ratingFilter);
  }, [sortedPosts, ratingFilter]);

  return (
    <div ref={contentRef} style={{ padding: appearanceConfig.margin }}>
      {/* 页面标题 */}
      <div style={{ marginBottom: spacing.xl }}>
        <Title level={3} style={{ margin: 0 }}>
          <BookOutlined /> 我的收藏
        </Title>
      </div>

      {/* 工具栏 */}
      <BooruPageToolbar
        sites={sites}
        selectedSiteId={selectedSiteId}
        loading={loading}
        ratingFilter={ratingFilter}
        onSiteChange={handleSiteChange}
        onRatingChange={setRatingFilter}
        onRefresh={() => loadFavorites(currentPage)}
      />

      {/* 图片列表 */}
      <div>
        {loading && (
          <SkeletonGrid count={12} cardWidth={appearanceConfig.gridSize} gap={appearanceConfig.spacing} />
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
            <PaginationControl
              currentPage={currentPage}
              currentCount={posts.length}
              itemsPerPage={appearanceConfig.itemsPerPage}
              paginationPosition={appearanceConfig.paginationPosition}
              position="top"
              onPrevious={() => loadFavorites(Math.max(1, currentPage - 1))}
              onNext={() => loadFavorites(currentPage + 1)}
            />

            <BooruGridLayout
              posts={filteredSortedPosts}
              gridSize={appearanceConfig.gridSize}
              spacing={appearanceConfig.spacing}
              borderRadius={appearanceConfig.borderRadius}
              selectedSite={selectedSite || null}
              onPreview={handlePreview}
              onDownload={handleDownload}
              onToggleFavorite={handleToggleFavorite}
              favorites={favorites}
              getPreviewUrl={getPreviewUrl}
              onTagClick={handleTagClick}
            />

            <PaginationControl
              currentPage={currentPage}
              currentCount={posts.length}
              itemsPerPage={appearanceConfig.itemsPerPage}
              paginationPosition={appearanceConfig.paginationPosition}
              position="bottom"
              onPrevious={() => loadFavorites(Math.max(1, currentPage - 1))}
              onNext={() => loadFavorites(currentPage + 1)}
            />
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

// BooruGridLayout 已提取到 src/renderer/components/BooruGridLayout.tsx

