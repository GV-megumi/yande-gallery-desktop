import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, Empty, App, Typography, Space } from 'antd';
import { HeartOutlined } from '@ant-design/icons';
import { BooruGridLayout } from '../components/BooruGridLayout';
import { PaginationControl } from '../components/PaginationControl';
import { SkeletonGrid } from '../components/SkeletonGrid';
import { BooruPostDetailsPage } from './BooruPostDetailsPage';
import { BooruPost, BooruSite } from '../../shared/types';
import { getBooruPreviewUrl } from '../utils/url';
import { spacing, colors, fontSize } from '../styles/tokens';

const { Text } = Typography;

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
  const [activeSite, setActiveSite] = useState<BooruSite | null>(null);
  const [posts, setPosts] = useState<BooruPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedPost, setSelectedPost] = useState<BooruPost | null>(null);
  const [detailsPageOpen, setDetailsPageOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const [appearanceConfig, setAppearanceConfig] = useState({
    gridSize: 330,
    previewQuality: 'auto' as 'auto' | 'low' | 'medium' | 'high' | 'original',
    itemsPerPage: 20,
    paginationPosition: 'bottom' as 'top' | 'bottom' | 'both',
    spacing: 16,
    borderRadius: 14,
    margin: 20
  });

  // 加载外观配置
  useEffect(() => {
    const loadConfig = async () => {
      try {
        if (!window.electronAPI) return;
        const result = await window.electronAPI.config.get();
        if (result.success && result.data?.booru?.appearance) {
          const a = result.data.booru.appearance;
          setAppearanceConfig({
            gridSize: a.gridSize || 330,
            previewQuality: a.previewQuality || 'auto',
            itemsPerPage: a.itemsPerPage || 20,
            paginationPosition: a.paginationPosition || 'bottom',
            spacing: a.spacing || 16,
            borderRadius: a.borderRadius || 8,
            margin: a.margin || 24
          });
        }
      } catch (error) {
        console.error('[BooruServerFavoritesPage] 加载外观配置失败:', error);
      }
    };
    loadConfig();
  }, []);

  // 加载活跃站点
  useEffect(() => {
    const loadActiveSite = async () => {
      try {
        if (!window.electronAPI) return;
        const result = await window.electronAPI.booru.getActiveSite();
        if (result.success && result.data) {
          const site = result.data;
          console.log('[BooruServerFavoritesPage] 活跃站点:', site.name, '用户:', site.username || '未登录');
          setActiveSite(site);
          setIsLoggedIn(!!(site.username && site.passwordHash));
        }
      } catch (error) {
        console.error('[BooruServerFavoritesPage] 加载活跃站点失败:', error);
      }
    };
    loadActiveSite();
  }, []);

  // 加载服务端喜欢列表
  const loadServerFavorites = useCallback(async (page: number = 1) => {
    if (!activeSite || !isLoggedIn) return;

    console.log(`[BooruServerFavoritesPage] 加载喜欢列表，站点: ${activeSite.id}, 页码: ${page}`);
    setLoading(true);

    try {
      const result = await window.electronAPI.booru.getServerFavorites(
        activeSite.id, page, appearanceConfig.itemsPerPage
      );
      if (result.success) {
        const data = result.data || [];
        console.log('[BooruServerFavoritesPage] 加载喜欢成功:', data.length, '张图片');
        setPosts(data);
        setCurrentPage(page);
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
  }, [activeSite, isLoggedIn, appearanceConfig.itemsPerPage]);

  // 当站点和登录状态就绪时，加载喜欢列表
  useEffect(() => {
    if (activeSite && isLoggedIn) {
      loadServerFavorites(1);
    }
  }, [activeSite, isLoggedIn]);

  // 处理本地收藏切换
  const handleToggleFavorite = async (post: BooruPost) => {
    if (!activeSite) return;
    try {
      if (post.isFavorited) {
        await window.electronAPI.booru.removeFavorite(post.postId);
        message.success('已取消收藏');
      } else {
        await window.electronAPI.booru.addFavorite(post.postId, activeSite.id);
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
    if (!activeSite) return;
    try {
      const result = await window.electronAPI.booru.addToDownload(post.postId, activeSite.id);
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
    if (onTagClick) {
      onTagClick(tag, activeSite?.id);
    }
  };

  // 处理图片预览
  const handlePreview = (post: BooruPost) => {
    setSelectedPost(post);
    setDetailsPageOpen(true);
  };

  // 获取预览URL
  const getPreviewUrl = (post: BooruPost): string => {
    return getBooruPreviewUrl(post, appearanceConfig.previewQuality);
  };

  // 未登录提示
  if (activeSite && !isLoggedIn) {
    return (
      <div style={{ padding: appearanceConfig.margin }}>
        <div style={{ marginBottom: spacing.xl }}>
          <Space>
            <HeartOutlined style={{ color: '#FF2D55', fontSize: 18 }} />
            <span style={{ fontSize: fontSize.lg, fontWeight: 600, color: colors.textPrimary }}>
              我的喜欢
            </span>
          </Space>
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
    <div style={{ padding: appearanceConfig.margin }}>
      {/* 页面标题 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.lg,
      }}>
        <Space>
          <HeartOutlined style={{ color: '#FF2D55', fontSize: 18 }} />
          <span style={{ fontSize: fontSize.lg, fontWeight: 600, color: colors.textPrimary }}>
            我的喜欢
          </span>
          <Text type="secondary" style={{ fontSize: fontSize.md }}>
            {activeSite?.username ? `@${activeSite.username}` : ''}
          </Text>
          <Text type="secondary" style={{ fontSize: fontSize.md }}>
            {posts.length > 0 ? `${posts.length} 张` : ''}
          </Text>
        </Space>

        <Button onClick={() => loadServerFavorites(currentPage)} loading={loading}>
          刷新
        </Button>
      </div>

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
              posts={posts}
              gridSize={appearanceConfig.gridSize}
              spacing={appearanceConfig.spacing}
              borderRadius={appearanceConfig.borderRadius}
              selectedSite={activeSite}
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
        site={activeSite}
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
