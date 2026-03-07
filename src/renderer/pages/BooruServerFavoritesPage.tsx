import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Button, Empty, App, Typography } from 'antd';
import { HeartOutlined } from '@ant-design/icons';
import { BooruGridLayout } from '../components/BooruGridLayout';
import { BooruPageToolbar, RatingFilter } from '../components/BooruPageToolbar';
import { PaginationControl } from '../components/PaginationControl';
import { SkeletonGrid } from '../components/SkeletonGrid';
import { BooruPostDetailsPage } from './BooruPostDetailsPage';
import { BooruPost, BooruSite } from '../../shared/types';
import { getBooruPreviewUrl } from '../utils/url';
import { spacing } from '../styles/tokens';

const { Title, Text } = Typography;

interface BooruServerFavoritesPageProps {
  onTagClick?: (tag: string, siteId?: number | null) => void;
}

/**
 * Booru 服务端喜欢页面
 * 展示用户在 Yande.re 账号中喜欢（vote:3）的图片列表
 * 与本地收藏不同，喜欢是存储在服务端的
 */
export const BooruServerFavoritesPage: React.FC<BooruServerFavoritesPageProps> = ({
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

  const [appearanceConfig, setAppearanceConfig] = useState({
    gridSize: 330,
    previewQuality: 'auto' as 'auto' | 'low' | 'medium' | 'high' | 'original',
    itemsPerPage: 20,
    paginationPosition: 'bottom' as 'top' | 'bottom' | 'both',
    pageMode: 'pagination' as 'pagination' | 'infinite',
    spacing: 16,
    borderRadius: 14,
    margin: 20
  });

  // 加载外观配置
  const loadAppearanceConfig = async () => {
    console.log('[BooruServerFavoritesPage] 加载外观配置');
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.config.get();
      if (result.success && result.data) {
        const booruConfig = result.data.booru;
        if (booruConfig?.appearance) {
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
      console.error('[BooruServerFavoritesPage] 加载外观配置失败:', error);
    }
  };

  // 加载站点列表（只显示已登录的站点）
  const loadSites = async () => {
    console.log('[BooruServerFavoritesPage] 加载站点列表');
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.booru.getSites();
      if (result.success && result.data) {
        // 只保留已登录的站点
        const loggedInSites = result.data.filter(
          (s: BooruSite) => s.username && s.passwordHash
        );
        console.log('[BooruServerFavoritesPage] 已登录站点:', loggedInSites.length, '个');
        setSites(loggedInSites);

        if (loggedInSites.length > 0) {
          setSelectedSiteId(loggedInSites[0].id);
        }
      }
    } catch (error) {
      console.error('[BooruServerFavoritesPage] 加载站点列表异常:', error);
    }
  };

  // 加载服务端喜欢列表
  const loadServerFavorites = async (page: number = 1) => {
    if (!selectedSiteId) return;

    console.log(`[BooruServerFavoritesPage] 加载喜欢列表，站点: ${selectedSiteId}, 页码: ${page}`);
    setLoading(true);

    try {
      if (!window.electronAPI) {
        setLoading(false);
        return;
      }

      const result = await window.electronAPI.booru.getServerFavorites(
        selectedSiteId, page, appearanceConfig.itemsPerPage
      );
      if (result.success) {
        const data = result.data || [];
        console.log('[BooruServerFavoritesPage] 加载喜欢成功:', data.length, '张图片');

        setPosts(data);
        setCurrentPage(page);
        setHasMore(data.length >= appearanceConfig.itemsPerPage);
      } else {
        console.error('[BooruServerFavoritesPage] 加载喜欢失败:', result.error);
        message.error('加载喜欢列表失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BooruServerFavoritesPage] 加载喜欢失败:', error);
      message.error('加载喜欢列表失败');
    } finally {
      setLoading(false);
    }
  };

  // 处理站点切换
  const handleSiteChange = (siteId: number) => {
    console.log('[BooruServerFavoritesPage] 切换站点:', siteId);
    setSelectedSiteId(siteId);
    setPosts([]);
    setCurrentPage(1);
    setHasMore(true);
  };

  // 处理服务端喜欢切换
  const handleToggleServerFavorite = async (post: BooruPost) => {
    if (!selectedSiteId) return;
    try {
      // 从喜欢列表取消喜欢
      await window.electronAPI.booru.serverUnfavorite(selectedSiteId, post.postId);
      message.success('已取消喜欢');
      // 从列表中移除
      setPosts(prev => prev.filter(p => p.postId !== post.postId));
      // 如果当前页空了，加载上一页
      if (posts.length === 1 && currentPage > 1) {
        loadServerFavorites(currentPage - 1);
      }
    } catch (error) {
      console.error('[BooruServerFavoritesPage] 取消喜欢失败:', error);
      message.error('操作失败');
    }
  };

  // 处理本地收藏切换
  const handleToggleFavorite = async (post: BooruPost) => {
    if (!selectedSiteId) return;
    try {
      if (post.isFavorited) {
        await window.electronAPI.booru.removeFavorite(post.postId);
        message.success('已取消收藏');
      } else {
        await window.electronAPI.booru.addFavorite(post.postId, selectedSiteId);
        message.success('已添加收藏');
      }
      setPosts(prev => prev.map(p =>
        p.postId === post.postId ? { ...p, isFavorited: !p.isFavorited } : p
      ));
    } catch (error) {
      console.error('[BooruServerFavoritesPage] 切换收藏失败:', error);
      message.error('操作失败');
    }
  };

  // 处理下载
  const handleDownload = async (post: BooruPost) => {
    console.log('[BooruServerFavoritesPage] 下载图片:', post.postId);
    try {
      if (!window.electronAPI || !selectedSiteId) return;

      const result = await window.electronAPI.booru.addToDownload(post.postId, selectedSiteId);
      if (result.success) {
        message.success('已添加到下载队列');
      } else {
        message.error('下载失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BooruServerFavoritesPage] 下载失败:', error);
      message.error('下载失败');
    }
  };

  // 处理标签点击
  const handleTagClick = (tag: string) => {
    console.log('[BooruServerFavoritesPage] 点击标签:', tag);
    if (onTagClick) {
      onTagClick(tag, selectedSiteId);
    }
  };

  // 处理图片预览
  const handlePreview = (post: BooruPost) => {
    console.log('[BooruServerFavoritesPage] 预览图片:', post.postId);
    setSelectedPost(post);
    setDetailsPageOpen(true);
  };

  // 获取预览URL
  const getPreviewUrl = (post: BooruPost): string => {
    return getBooruPreviewUrl(post, appearanceConfig.previewQuality);
  };

  // 初始化
  useEffect(() => {
    console.log('[BooruServerFavoritesPage] 初始化页面');
    loadAppearanceConfig();
    loadSites();
  }, []);

  // 当站点切换时，加载喜欢列表
  useEffect(() => {
    if (selectedSiteId) {
      loadServerFavorites(1);
    }
  }, [selectedSiteId]);

  const selectedSite = sites.find(s => s.id === selectedSiteId);

  // 按评级筛选
  const filteredPosts = useMemo(() => {
    if (ratingFilter === 'all') return posts;
    return posts.filter(post => post.rating === ratingFilter);
  }, [posts, ratingFilter]);

  // 未登录提示
  if (sites.length === 0 && !loading) {
    return (
      <div ref={contentRef} style={{ padding: appearanceConfig.margin }}>
        <div style={{ marginBottom: spacing.xl }}>
          <Title level={3} style={{ margin: 0 }}>
            <HeartOutlined /> 我的喜欢
          </Title>
        </div>
        <Empty
          description={
            <div>
              <Text>请先在站点设置中登录 Yande.re 账号</Text>
              <br />
              <Text type="secondary">喜欢功能需要登录后才能使用</Text>
            </div>
          }
          style={{ marginTop: '100px' }}
        />
      </div>
    );
  }

  return (
    <div ref={contentRef} style={{ padding: appearanceConfig.margin }}>
      {/* 页面标题 */}
      <div style={{ marginBottom: spacing.xl }}>
        <Title level={3} style={{ margin: 0 }}>
          <HeartOutlined /> 我的喜欢
        </Title>
        <Text type="secondary">服务端喜欢列表，与账号关联</Text>
      </div>

      {/* 工具栏 */}
      <BooruPageToolbar
        sites={sites}
        selectedSiteId={selectedSiteId}
        loading={loading}
        ratingFilter={ratingFilter}
        onSiteChange={handleSiteChange}
        onRatingChange={setRatingFilter}
        onRefresh={() => loadServerFavorites(currentPage)}
      />

      {/* 图片列表 */}
      <div>
        {loading && (
          <SkeletonGrid count={12} cardWidth={appearanceConfig.gridSize} gap={appearanceConfig.spacing} />
        )}

        {!loading && posts.length === 0 && (
          <Empty
            description="暂无喜欢的图片"
            style={{ marginTop: '100px' }}
          >
            <Button
              type="primary"
              onClick={() => loadServerFavorites(1)}
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
              onPrevious={() => loadServerFavorites(Math.max(1, currentPage - 1))}
              onNext={() => loadServerFavorites(currentPage + 1)}
            />

            <BooruGridLayout
              posts={filteredPosts}
              gridSize={appearanceConfig.gridSize}
              spacing={appearanceConfig.spacing}
              borderRadius={appearanceConfig.borderRadius}
              selectedSite={selectedSite || null}
              onPreview={handlePreview}
              onDownload={handleDownload}
              onToggleFavorite={handleToggleFavorite}
              favorites={new Set()}
              getPreviewUrl={getPreviewUrl}
              onTagClick={handleTagClick}
            />

            <PaginationControl
              currentPage={currentPage}
              currentCount={posts.length}
              itemsPerPage={appearanceConfig.itemsPerPage}
              paginationPosition={appearanceConfig.paginationPosition}
              position="bottom"
              onPrevious={() => loadServerFavorites(Math.max(1, currentPage - 1))}
              onNext={() => loadServerFavorites(currentPage + 1)}
            />
          </>
        )}
      </div>

      {/* 图片详情页面 */}
      <BooruPostDetailsPage
        open={detailsPageOpen}
        post={selectedPost}
        site={selectedSite || null}
        posts={posts}
        initialIndex={selectedPost ? posts.findIndex(p => p.id === selectedPost.id) : 0}
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

export default BooruServerFavoritesPage;
