/**
 * Booru 角色详情页面
 * 展示指定角色标签的所有作品，结构类似 BooruArtistPage
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Button, Empty, App, Tag } from 'antd';
import { LeftOutlined, StarOutlined, StarFilled } from '@ant-design/icons';
import { BooruGridLayout } from '../components/BooruGridLayout';
import { BooruPageToolbar, RatingFilter } from '../components/BooruPageToolbar';
import { PaginationControl } from '../components/PaginationControl';
import { SkeletonGrid } from '../components/SkeletonGrid';
import { BooruPostDetailsPage } from './BooruPostDetailsPage';
import { BooruPost, BooruSite } from '../../shared/types';
import { colors, spacing, fontSize } from '../styles/tokens';
import { useFavorite } from '../hooks/useFavorite';
import { getBooruPreviewUrl } from '../utils/url';

interface BooruCharacterPageProps {
  characterName: string;
  initialSiteId?: number | null;
  onBack?: () => void;
  onTagClick?: (tag: string, siteId?: number | null) => void;
  suspended?: boolean;
}

/**
 * Booru 角色详情页面
 * 展示指定角色标签相关的作品列表（结构类似 BooruArtistPage）
 */
export const BooruCharacterPage: React.FC<BooruCharacterPageProps> = ({
  characterName,
  initialSiteId = null,
  onBack,
  onTagClick,
  suspended = false
}) => {
  const { message } = App.useApp();
  const [sites, setSites] = useState<BooruSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(initialSiteId);
  const [posts, setPosts] = useState<BooruPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedPost, setSelectedPost] = useState<BooruPost | null>(null);
  const [detailsPageOpen, setDetailsPageOpen] = useState(false);
  // 标记站点是否已加载完成（用于自动搜索的依赖判断）
  const [sitesLoaded, setSitesLoaded] = useState(false);

  // 标签收藏状态
  const [isTagFavorited, setIsTagFavorited] = useState(false);
  const [serverFavorites, setServerFavorites] = useState<Set<number>>(new Set());

  const [appearanceConfig, setAppearanceConfig] = useState({
    gridSize: 330,
    previewQuality: 'auto' as string,
    itemsPerPage: 20,
    paginationPosition: 'bottom' as 'top' | 'bottom' | 'both',
    spacing: 16,
    borderRadius: 14,
  });

  const { favorites, toggleFavorite, setFavorites } = useFavorite({
    siteId: selectedSiteId,
    onSuccess: (postId, isFavorited) => {
      setPosts(prev => prev.map(p => p.postId === postId ? { ...p, isFavorited } : p));
      message.success(isFavorited ? '已添加收藏' : '已取消收藏');
    },
    logPrefix: '[BooruCharacterPage]'
  });

  const selectedSite = useMemo(() => sites.find(s => s.id === selectedSiteId) || null, [sites, selectedSiteId]);

  // 过滤评级
  const filteredPosts = useMemo(() => {
    if (ratingFilter === 'all') return posts;
    return posts.filter(p => p.rating === ratingFilter);
  }, [posts, ratingFilter]);

  // 检查标签收藏状态
  const checkTagFavoriteStatus = useCallback(async () => {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.booru.isFavoriteTag(selectedSiteId, characterName);
      if (result.success) setIsTagFavorited(!!result.data);
    } catch (error) {
      console.error('[BooruCharacterPage] 检查标签收藏失败:', error);
    }
  }, [selectedSiteId, characterName]);

  // 切换标签收藏
  const handleToggleTagFavorite = useCallback(async () => {
    if (!window.electronAPI) return;
    try {
      if (isTagFavorited) {
        await window.electronAPI.booru.removeFavoriteTagByName(selectedSiteId, characterName);
        setIsTagFavorited(false);
        message.success('已取消收藏标签');
      } else {
        await window.electronAPI.booru.addFavoriteTag(selectedSiteId, characterName);
        setIsTagFavorited(true);
        message.success('已收藏标签');
      }
    } catch (error) {
      console.error('[BooruCharacterPage] 切换标签收藏失败:', error);
      message.error('操作失败');
    }
  }, [isTagFavorited, selectedSiteId, characterName]);

  // 加载外观配置
  const loadAppearanceConfig = async () => {
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
        });
      }
    } catch (error) {
      console.error('[BooruCharacterPage] 加载外观配置失败:', error);
    }
  };

  // 加载站点列表（只负责加载站点数据，不触发搜索）
  const loadSites = async () => {
    try {
      if (!window.electronAPI) return;
      const result = await window.electronAPI.booru.getSites();
      if (result.success && result.data) {
        setSites(result.data);
        let targetSiteId: number | null = null;
        if (initialSiteId) {
          const exists = result.data.some((s: BooruSite) => s.id === initialSiteId);
          targetSiteId = exists ? initialSiteId : (result.data.length > 0 ? result.data[0].id : null);
        } else if (result.data.length > 0) {
          targetSiteId = result.data[0].id;
        }
        if (targetSiteId) {
          setSelectedSiteId(targetSiteId);
        }
        setSitesLoaded(true);
      }
    } catch (error) {
      console.error('[BooruCharacterPage] 加载站点列表失败:', error);
    }
  };

  // 搜索角色作品
  const searchCharacterPosts = async (name: string, page: number) => {
    if (!selectedSiteId) return;
    const site = sites.find(s => s.id === selectedSiteId);
    if (!site) return;

    console.log(`[BooruCharacterPage] 搜索角色作品: ${name}, 页码: ${page}`);
    setLoading(true);

    try {
      if (!window.electronAPI) { setLoading(false); return; }
      const result = await window.electronAPI.booru.searchPosts(
        selectedSiteId, [name], page, appearanceConfig.itemsPerPage
      );
      if (result.success) {
        const data = result.data || [];
        console.log('[BooruCharacterPage] 搜索成功:', data.length, '张图片');
        setPosts(data);
        setCurrentPage(page);
        await loadFavoritesFromServer();
      } else {
        message.error('搜索失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BooruCharacterPage] 搜索失败:', error);
      message.error('搜索失败');
    } finally {
      setLoading(false);
    }
  };

  // 加载收藏状态
  const loadFavoritesFromServer = async () => {
    if (!selectedSiteId || !window.electronAPI) return;
    try {
      const result = await window.electronAPI.booru.getFavorites(selectedSiteId);
      if (result.success && result.data) {
        const favoriteIds = new Set<number>(result.data.map((f: any) => f.postId));
        setFavorites(favoriteIds);
        setPosts(prev => prev.map(p => ({ ...p, isFavorited: favoriteIds.has(p.postId) })));
      }
    } catch (error) {
      console.error('[BooruCharacterPage] 加载收藏状态失败:', error);
    }
  };

  const handleToggleFavorite = async (post: BooruPost) => {
    const result = await toggleFavorite(post);
    if (!result.success) message.error('操作失败');
  };

  const handleToggleServerFavorite = async (post: BooruPost) => {
    if (!selectedSiteId || !window.electronAPI) return;
    if (!selectedSite?.username) { message.warning('请先登录'); return; }
    const isCurrentlyFavorited = serverFavorites.has(post.postId);
    try {
      if (isCurrentlyFavorited) {
        const result = await window.electronAPI.booru.serverUnfavorite(selectedSiteId, post.postId);
        if (result.success) {
          setServerFavorites(prev => { const n = new Set(prev); n.delete(post.postId); return n; });
          message.success('已取消服务端收藏');
        }
      } else {
        const result = await window.electronAPI.booru.serverFavorite(selectedSiteId, post.postId);
        if (result.success) {
          setServerFavorites(prev => new Set([...prev, post.postId]));
          message.success('已添加服务端收藏');
        }
      }
    } catch (error) {
      message.error('操作失败');
    }
  };

  const handleDownload = async (post: BooruPost) => {
    if (!selectedSiteId || !window.electronAPI) return;
    try {
      const result = await window.electronAPI.download.addToQueue(selectedSiteId, post);
      if (result.success) message.success('已添加到下载队列');
      else message.error('添加失败: ' + result.error);
    } catch (error) {
      message.error('操作失败');
    }
  };

  const handlePreview = (post: BooruPost) => {
    setSelectedPost(post);
    setDetailsPageOpen(true);
  };

  const handleTagClick = (tag: string) => {
    if (onTagClick) onTagClick(tag, selectedSiteId);
  };

  const getPreviewUrl = (post: BooruPost) => {
    return getBooruPreviewUrl(post, appearanceConfig.previewQuality as any, selectedSite);
  };

  // 初始化：加载配置和站点列表
  useEffect(() => {
    loadAppearanceConfig();
    loadSites();
  }, []);

  // 自动搜索：站点加载完成后立即搜索
  const hasSearchedRef = useRef(false);
  useEffect(() => {
    if (sitesLoaded && selectedSiteId && characterName && !suspended && !hasSearchedRef.current) {
      console.log('[BooruCharacterPage] 自动搜索角色:', characterName, '站点:', selectedSiteId);
      hasSearchedRef.current = true;
      searchCharacterPosts(characterName, 1);
    }
  }, [sitesLoaded, selectedSiteId, characterName, suspended]);

  useEffect(() => {
    if (selectedSiteId) checkTagFavoriteStatus();
  }, [selectedSiteId, checkTagFavoriteStatus]);

  const displayName = characterName.replace(/_/g, ' ');

  return (
    <div>
      {/* 返回按钮 + 角色名 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg }}>
        {onBack && (
          <Button
            icon={<LeftOutlined />}
            type="text"
            onClick={onBack}
            style={{ color: colors.textSecondary, paddingLeft: 0 }}
          >
            返回
          </Button>
        )}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: spacing.sm }}>
          <span style={{ fontSize: fontSize.heading, fontWeight: 700, color: colors.textPrimary }}>
            {displayName}
          </span>
          <Tag color="green" style={{ fontSize: fontSize.sm }}>角色</Tag>
        </div>
        <Button
          icon={isTagFavorited ? <StarFilled style={{ color: '#FFB800' }} /> : <StarOutlined />}
          onClick={handleToggleTagFavorite}
          type="text"
          size="small"
        >
          {isTagFavorited ? '已收藏标签' : '收藏标签'}
        </Button>
      </div>

      {/* 工具栏 */}
      <BooruPageToolbar
        sites={sites}
        selectedSiteId={selectedSiteId}
        loading={loading}
        ratingFilter={ratingFilter}
        onSiteChange={(siteId) => {
          setSelectedSiteId(siteId);
          setPosts([]);
          setCurrentPage(1);
          hasSearchedRef.current = false; // 重置搜索标记，让自动搜索 effect 重新触发
        }}
        onRatingChange={setRatingFilter}
        onRefresh={() => searchCharacterPosts(characterName, currentPage)}
      />

      {/* 作品列表 */}
      <div>
        {loading && (
          <SkeletonGrid count={12} cardWidth={appearanceConfig.gridSize} gap={appearanceConfig.spacing} />
        )}

        {!loading && filteredPosts.length === 0 && (
          <Empty
            description={`未找到「${displayName}」的相关作品`}
            style={{ marginTop: '100px' }}
          >
            <Button
              type="primary"
              onClick={() => searchCharacterPosts(characterName, 1)}
              disabled={!selectedSiteId}
            >
              重新搜索
            </Button>
          </Empty>
        )}

        {!loading && filteredPosts.length > 0 && (
          <>
            <PaginationControl
              currentPage={currentPage}
              currentCount={filteredPosts.length}
              itemsPerPage={appearanceConfig.itemsPerPage}
              paginationPosition={appearanceConfig.paginationPosition}
              position="top"
              onPrevious={() => searchCharacterPosts(characterName, Math.max(1, currentPage - 1))}
              onNext={() => searchCharacterPosts(characterName, currentPage + 1)}
              onPageChange={(page) => searchCharacterPosts(characterName, page)}
            />
            <BooruGridLayout
              posts={filteredPosts}
              gridSize={appearanceConfig.gridSize}
              spacing={appearanceConfig.spacing}
              borderRadius={appearanceConfig.borderRadius}
              selectedSite={selectedSite}
              onPreview={handlePreview}
              onDownload={handleDownload}
              onToggleFavorite={handleToggleFavorite}
              favorites={favorites}
              getPreviewUrl={getPreviewUrl}
              onTagClick={handleTagClick}
              onToggleServerFavorite={selectedSite?.username ? handleToggleServerFavorite : undefined}
              serverFavorites={serverFavorites}
            />
            <PaginationControl
              currentPage={currentPage}
              currentCount={filteredPosts.length}
              itemsPerPage={appearanceConfig.itemsPerPage}
              paginationPosition={appearanceConfig.paginationPosition}
              position="bottom"
              onPrevious={() => searchCharacterPosts(characterName, Math.max(1, currentPage - 1))}
              onNext={() => searchCharacterPosts(characterName, currentPage + 1)}
              onPageChange={(page) => searchCharacterPosts(characterName, page)}
            />
          </>
        )}
      </div>

      {/* 图片详情页面 */}
      <BooruPostDetailsPage
        open={detailsPageOpen}
        post={selectedPost}
        site={selectedSite}
        posts={filteredPosts}
        initialIndex={selectedPost ? filteredPosts.findIndex(p => p.id === selectedPost.id) : 0}
        onClose={() => { setDetailsPageOpen(false); setSelectedPost(null); }}
        onToggleFavorite={handleToggleFavorite}
        onDownload={handleDownload}
        onTagClick={handleTagClick}
        isServerFavorited={(p: BooruPost) => serverFavorites.has(p.postId)}
        onToggleServerFavorite={selectedSite?.username ? handleToggleServerFavorite : undefined}
        suspended={suspended}
      />
    </div>
  );
};
