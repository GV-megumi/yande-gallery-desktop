/**
 * Booru 艺术家详情页面
 * 展示艺术家信息（外部链接、别名）和作品列表
 * 支持从标签搜索页或帖子详情页导航到此页面
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Button, Empty, App, Typography, Tooltip, Tag, Spin } from 'antd';
import { LeftOutlined, StarOutlined, StarFilled, LinkOutlined, UserOutlined } from '@ant-design/icons';
import { BooruGridLayout } from '../components/BooruGridLayout';
import { BooruPageToolbar, RatingFilter } from '../components/BooruPageToolbar';
import { PaginationControl } from '../components/PaginationControl';
import { SkeletonGrid } from '../components/SkeletonGrid';
import { BooruPostDetailsPage } from './BooruPostDetailsPage';
import { BooruPost, BooruSite } from '../../shared/types';
import { getBooruPreviewUrl } from '../utils/url';
import { colors, spacing, fontSize, radius } from '../styles/tokens';
import { useFavorite } from '../hooks/useFavorite';

const { Text } = Typography;

/** 艺术家信息 */
interface ArtistInfo {
  id: number;
  name: string;
  aliases: string[];
  urls: string[];
  group_name?: string;
  is_banned?: boolean;
}

/** 外部链接类型识别 */
function classifyUrl(url: string): { label: string; color: string } {
  const lower = url.toLowerCase();
  if (lower.includes('pixiv.net')) return { label: 'Pixiv', color: '#0096FA' };
  if (lower.includes('twitter.com') || lower.includes('x.com')) return { label: 'Twitter/X', color: '#1DA1F2' };
  if (lower.includes('fanbox')) return { label: 'FANBOX', color: '#E0536E' };
  if (lower.includes('patreon')) return { label: 'Patreon', color: '#FF424D' };
  if (lower.includes('deviantart')) return { label: 'DeviantArt', color: '#05CC47' };
  if (lower.includes('artstation')) return { label: 'ArtStation', color: '#13AFF0' };
  if (lower.includes('tumblr')) return { label: 'Tumblr', color: '#36465D' };
  if (lower.includes('instagram')) return { label: 'Instagram', color: '#E4405F' };
  if (lower.includes('nicovideo') || lower.includes('seiga')) return { label: 'Niconico', color: '#252525' };
  if (lower.includes('booth.pm')) return { label: 'BOOTH', color: '#FC4D50' };
  if (lower.includes('skeb.jp')) return { label: 'Skeb', color: '#46BFB0' };
  if (lower.includes('misskey') || lower.includes('pawoo')) return { label: 'Fediverse', color: '#6364FF' };
  if (lower.includes('lofter')) return { label: 'LOFTER', color: '#22B6C5' };
  if (lower.includes('weibo')) return { label: '微博', color: '#E6162D' };
  return { label: '链接', color: colors.textSecondary };
}

interface BooruArtistPageProps {
  artistName: string;
  initialSiteId?: number | null;
  onBack?: () => void;
  onTagClick?: (tag: string, siteId?: number | null) => void;
  suspended?: boolean;
}

/**
 * Booru 艺术家详情页面
 * 展示艺术家外部链接、别名，以及作品列表
 */
export const BooruArtistPage: React.FC<BooruArtistPageProps> = ({
  artistName,
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
  const [hasMore, setHasMore] = useState(true);
  const [selectedPost, setSelectedPost] = useState<BooruPost | null>(null);
  const [detailsPageOpen, setDetailsPageOpen] = useState(false);
  // 标记站点是否已加载完成（用于自动搜索的依赖判断）
  const [sitesLoaded, setSitesLoaded] = useState(false);

  // 艺术家信息
  const [artistInfo, setArtistInfo] = useState<ArtistInfo | null>(null);
  const [artistLoading, setArtistLoading] = useState(false);

  // 收藏状态管理
  const { favorites, toggleFavorite, setFavorites } = useFavorite({
    siteId: selectedSiteId,
    onSuccess: (postId, isFavorited) => {
      setPosts(prevPosts =>
        prevPosts.map(p =>
          p.postId === postId ? { ...p, isFavorited } : p
        )
      );
      message[isFavorited ? 'success' : 'success'](isFavorited ? '已添加收藏' : '已取消收藏');
    },
    logPrefix: '[BooruArtistPage]'
  });

  // 标签收藏状态
  const [isTagFavorited, setIsTagFavorited] = useState(false);

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

  // 服务端喜欢状态管理
  const [serverFavorites, setServerFavorites] = useState<Set<number>>(new Set());

  // 加载艺术家信息
  const loadArtistInfo = useCallback(async () => {
    if (!selectedSiteId || !window.electronAPI?.booru?.getArtist) return;
    setArtistLoading(true);
    try {
      console.log('[BooruArtistPage] 加载艺术家信息:', artistName);
      const result = await window.electronAPI.booru.getArtist(selectedSiteId, artistName);
      if (result.success && result.data) {
        setArtistInfo(result.data);
        console.log('[BooruArtistPage] 艺术家信息:', result.data.name, 'urls:', result.data.urls.length);
      } else {
        console.log('[BooruArtistPage] 未获取到艺术家信息');
        setArtistInfo(null);
      }
    } catch (error) {
      console.error('[BooruArtistPage] 加载艺术家信息失败:', error);
    } finally {
      setArtistLoading(false);
    }
  }, [selectedSiteId, artistName]);

  // 检查标签收藏状态
  const checkTagFavoriteStatus = useCallback(async () => {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.booru.isFavoriteTag(selectedSiteId, artistName);
      if (result.success) {
        setIsTagFavorited(!!result.data);
      }
    } catch (error) {
      console.error('[BooruArtistPage] 检查标签收藏状态失败:', error);
    }
  }, [selectedSiteId, artistName]);

  // 切换标签收藏
  const handleToggleTagFavorite = useCallback(async () => {
    if (!window.electronAPI) return;
    try {
      if (isTagFavorited) {
        await window.electronAPI.booru.removeFavoriteTagByName(selectedSiteId, artistName);
        setIsTagFavorited(false);
        message.success('已取消收藏标签');
      } else {
        await window.electronAPI.booru.addFavoriteTag(selectedSiteId, artistName);
        setIsTagFavorited(true);
        message.success('已收藏标签');
      }
    } catch (error) {
      console.error('[BooruArtistPage] 切换标签收藏失败:', error);
      message.error('操作失败');
    }
  }, [isTagFavorited, selectedSiteId, artistName]);

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
          pageMode: a.pageMode || 'pagination',
          spacing: a.spacing || 16,
          borderRadius: a.borderRadius || 8,
          margin: a.margin || 24
        });
      }
    } catch (error) {
      console.error('[BooruArtistPage] 加载外观配置失败:', error);
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
          const siteExists = result.data.some(s => s.id === initialSiteId);
          targetSiteId = siteExists ? initialSiteId : (result.data.length > 0 ? result.data[0].id : null);
        } else if (result.data.length > 0) {
          targetSiteId = result.data[0].id;
        }

        if (targetSiteId) {
          setSelectedSiteId(targetSiteId);
        }
        setSitesLoaded(true);
      }
    } catch (error) {
      console.error('[BooruArtistPage] 加载站点列表异常:', error);
    }
  };

  // 搜索艺术家作品
  const searchArtistPosts = async (name: string, page: number) => {
    if (!selectedSiteId) return;

    const site = sites.find(s => s.id === selectedSiteId);
    if (!site) return;

    console.log(`[BooruArtistPage] 搜索艺术家作品: ${name}, 页码: ${page}`);
    setLoading(true);

    try {
      if (!window.electronAPI) { setLoading(false); return; }

      const result = await window.electronAPI.booru.searchPosts(
        selectedSiteId, [name], page, appearanceConfig.itemsPerPage
      );
      if (result.success) {
        const data = result.data || [];
        console.log('[BooruArtistPage] 搜索成功:', data.length, '张图片');
        setPosts(data);
        setCurrentPage(page);
        setHasMore(data.length >= appearanceConfig.itemsPerPage);
        await loadFavoritesFromServer();
      } else {
        message.error('搜索失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BooruArtistPage] 搜索失败:', error);
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
        const favoriteIds = new Set(result.data.map((f: any) => f.postId));
        setFavorites(favoriteIds);
        setPosts(prevPosts =>
          prevPosts.map(p => ({ ...p, isFavorited: favoriteIds.has(p.postId) }))
        );
      }
    } catch (error) {
      console.error('[BooruArtistPage] 加载收藏状态失败:', error);
    }
  };

  // 处理收藏切换
  const handleToggleFavorite = async (post: BooruPost) => {
    const result = await toggleFavorite(post);
    if (!result.success) message.error('操作失败');
  };

  // 处理下载
  const handleDownload = async (post: BooruPost) => {
    try {
      if (!window.electronAPI || !selectedSiteId) return;
      const result = await window.electronAPI.booru.addToDownload(post.postId, selectedSiteId);
      if (result.success) {
        message.success('已添加到下载队列');
      } else {
        message.error('下载失败: ' + result.error);
      }
    } catch (error) {
      message.error('下载失败');
    }
  };

  // 服务端喜欢切换
  const handleToggleServerFavorite = useCallback(async (post: BooruPost) => {
    if (!selectedSiteId) return;
    const isCurrentlyFavorited = serverFavorites.has(post.postId);
    try {
      if (isCurrentlyFavorited) {
        await window.electronAPI.booru.serverUnfavorite(selectedSiteId, post.postId);
        setServerFavorites(prev => { const next = new Set(prev); next.delete(post.postId); return next; });
        message.success('已取消喜欢');
      } else {
        await window.electronAPI.booru.serverFavorite(selectedSiteId, post.postId);
        setServerFavorites(prev => new Set(prev).add(post.postId));
        message.success('已喜欢');
      }
    } catch (error) {
      message.error('操作失败');
    }
  }, [selectedSiteId, serverFavorites]);

  // 处理标签点击
  const handleTagClick = (tag: string) => {
    if (onTagClick) {
      onTagClick(tag, selectedSiteId);
    }
  };

  // 预览图片
  const handlePreview = (post: BooruPost) => {
    console.log('[BooruArtistPage] 预览图片:', post.postId);
    setSelectedPost(post);
    setDetailsPageOpen(true);
  };

  // 获取预览 URL
  const getPreviewUrl = (post: BooruPost): string => {
    return getBooruPreviewUrl(post, appearanceConfig.previewQuality);
  };

  // 当前选中的站点对象
  const selectedSite = sites.find(s => s.id === selectedSiteId) || null;

  // 按 ID 倒序排序
  const sortedPosts = useMemo(() => {
    return [...posts].sort((a, b) => b.postId - a.postId);
  }, [posts]);

  // 按评级筛选
  const filteredSortedPosts = useMemo(() => {
    if (ratingFilter === 'all') return sortedPosts;
    return sortedPosts.filter(post => post.rating === ratingFilter);
  }, [sortedPosts, ratingFilter]);

  // 初始化：加载配置和站点列表
  useEffect(() => {
    loadSites();
    loadAppearanceConfig();
  }, []);

  // 自动搜索：站点加载完成后立即搜索
  const hasSearchedRef = useRef(false);
  useEffect(() => {
    if (sitesLoaded && selectedSiteId && artistName && !suspended && !hasSearchedRef.current) {
      console.log('[BooruArtistPage] 自动搜索艺术家:', artistName, '站点:', selectedSiteId);
      hasSearchedRef.current = true;
      searchArtistPosts(artistName, 1);
    }
  }, [sitesLoaded, selectedSiteId, artistName, suspended]);

  // 站点变化时加载艺术家信息和收藏状态
  useEffect(() => {
    if (selectedSiteId) {
      loadArtistInfo();
      checkTagFavoriteStatus();
    }
  }, [selectedSiteId, loadArtistInfo, checkTagFavoriteStatus]);

  // 相关标签推荐
  const relatedTags = useMemo(() => {
    if (posts.length === 0) return [];
    const excludeTags = new Set([artistName.toLowerCase(), 'highres', 'absurdres', 'commentary_request', 'tagme']);
    const tagCount = new Map<string, number>();
    for (const post of posts) {
      const postTags = post.tags.split(' ').filter(t => t.trim());
      for (const tag of postTags) {
        const lower = tag.toLowerCase();
        if (!excludeTags.has(lower)) {
          tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
        }
      }
    }
    return Array.from(tagCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([tag, count]) => ({ tag, count }));
  }, [posts, artistName]);

  return (
    <div>
      {/* 返回按钮和标题 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: spacing.sm,
        marginBottom: spacing.md,
      }}>
        {onBack && (
          <Button
            type="text"
            icon={<LeftOutlined />}
            onClick={onBack}
            style={{ color: colors.primary }}
          >
            返回
          </Button>
        )}
        <UserOutlined style={{ fontSize: 20, color: '#FF3B30' }} />
        <Text strong style={{ fontSize: fontSize.xl }}>
          {artistName.replace(/_/g, ' ')}
        </Text>
        <Tag color="#FF3B30">艺术家</Tag>
        <Tooltip title={isTagFavorited ? '取消收藏标签' : '收藏标签'}>
          {isTagFavorited ? (
            <StarFilled
              style={{ fontSize: 18, color: '#FF9500', cursor: 'pointer' }}
              onClick={handleToggleTagFavorite}
            />
          ) : (
            <StarOutlined
              style={{ fontSize: 18, color: colors.textTertiary, cursor: 'pointer' }}
              onClick={handleToggleTagFavorite}
            />
          )}
        </Tooltip>
      </div>

      {/* 艺术家详情卡片 */}
      <div style={{
        padding: `${spacing.md}px ${spacing.lg}px`,
        marginBottom: spacing.md,
        background: colors.bgGroupedSecondary,
        borderRadius: radius.lg,
        border: `1px solid ${colors.border}`,
      }}>
        {artistLoading ? (
          <Spin size="small" />
        ) : artistInfo ? (
          <div>
            {/* 别名 */}
            {artistInfo.aliases.length > 0 && (
              <div style={{ marginBottom: spacing.sm }}>
                <Text type="secondary" style={{ fontSize: fontSize.xs, marginRight: spacing.sm }}>
                  别名:
                </Text>
                {artistInfo.aliases.map((alias, i) => (
                  <Tag
                    key={i}
                    style={{ cursor: 'pointer', fontSize: fontSize.xs }}
                    onClick={() => handleTagClick(alias)}
                  >
                    {alias.replace(/_/g, ' ')}
                  </Tag>
                ))}
              </div>
            )}

            {/* 所属组 */}
            {artistInfo.group_name && (
              <div style={{ marginBottom: spacing.sm }}>
                <Text type="secondary" style={{ fontSize: fontSize.xs, marginRight: spacing.sm }}>
                  社团:
                </Text>
                <Tag
                  style={{ cursor: 'pointer', fontSize: fontSize.xs }}
                  onClick={() => handleTagClick(artistInfo.group_name!)}
                >
                  {artistInfo.group_name.replace(/_/g, ' ')}
                </Tag>
              </div>
            )}

            {/* 外部链接 */}
            {artistInfo.urls.length > 0 && (
              <div>
                <Text type="secondary" style={{ fontSize: fontSize.xs, marginRight: spacing.sm }}>
                  外部链接:
                </Text>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {artistInfo.urls.map((url, i) => {
                    const { label, color } = classifyUrl(url);
                    return (
                      <Tag
                        key={i}
                        color={color}
                        style={{ cursor: 'pointer', fontSize: fontSize.xs, margin: 0 }}
                        icon={<LinkOutlined />}
                        onClick={() => window.electronAPI?.system.openExternal(url)}
                      >
                        {label}
                      </Tag>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 无链接时的提示 */}
            {artistInfo.urls.length === 0 && artistInfo.aliases.length === 0 && (
              <Text type="secondary" style={{ fontSize: fontSize.sm }}>
                暂无外部链接信息
              </Text>
            )}
          </div>
        ) : (
          <Text type="secondary" style={{ fontSize: fontSize.sm }}>
            该站点不支持艺术家信息查询，或未找到艺术家数据
          </Text>
        )}

        {/* 相关标签 */}
        {relatedTags.length > 0 && (
          <div style={{ marginTop: spacing.sm, borderTop: `1px solid ${colors.border}`, paddingTop: spacing.sm }}>
            <Text type="secondary" style={{ fontSize: fontSize.xs, marginRight: spacing.sm }}>
              常用标签:
            </Text>
            {relatedTags.map(({ tag, count }) => (
              <Tag
                key={tag}
                style={{ cursor: 'pointer', marginBottom: 2, fontSize: fontSize.xs }}
                onClick={() => handleTagClick(tag)}
              >
                {tag.replace(/_/g, ' ')} <span style={{ color: 'rgba(0,0,0,0.3)' }}>{count}</span>
              </Tag>
            ))}
          </div>
        )}
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
          setHasMore(true);
          hasSearchedRef.current = false; // 重置搜索标记，让自动搜索 effect 重新触发
        }}
        onRatingChange={setRatingFilter}
        onRefresh={() => searchArtistPosts(artistName, currentPage)}
      />

      {/* 作品列表 */}
      <div>
        {loading && (
          <SkeletonGrid count={12} cardWidth={appearanceConfig.gridSize} gap={appearanceConfig.spacing} />
        )}

        {!loading && posts.length === 0 && (
          <Empty
            description="未找到该艺术家的作品"
            style={{ marginTop: '100px' }}
          >
            <Button
              type="primary"
              onClick={() => searchArtistPosts(artistName, 1)}
              disabled={!selectedSiteId}
            >
              重新搜索
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
              onPrevious={() => searchArtistPosts(artistName, Math.max(1, currentPage - 1))}
              onNext={() => searchArtistPosts(artistName, currentPage + 1)}
              onPageChange={(page) => searchArtistPosts(artistName, page)}
            />
            <BooruGridLayout
              posts={filteredSortedPosts}
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
              currentCount={posts.length}
              itemsPerPage={appearanceConfig.itemsPerPage}
              paginationPosition={appearanceConfig.paginationPosition}
              position="bottom"
              onPrevious={() => searchArtistPosts(artistName, Math.max(1, currentPage - 1))}
              onNext={() => searchArtistPosts(artistName, currentPage + 1)}
              onPageChange={(page) => searchArtistPosts(artistName, page)}
            />
          </>
        )}
      </div>

      {/* 图片详情页面 */}
      <BooruPostDetailsPage
        open={detailsPageOpen}
        post={selectedPost}
        site={selectedSite}
        posts={sortedPosts}
        initialIndex={selectedPost ? sortedPosts.findIndex(p => p.id === selectedPost.id) : 0}
        onClose={() => {
          setDetailsPageOpen(false);
          setSelectedPost(null);
        }}
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
