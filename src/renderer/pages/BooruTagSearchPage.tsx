import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Button, Empty, App, Typography, Tooltip, Tag, Card, Descriptions, Spin } from 'antd';
import { LeftOutlined, StarOutlined, StarFilled } from '@ant-design/icons';
import { BooruGridLayout } from '../components/BooruGridLayout';
import { BooruPageToolbar, RatingFilter } from '../components/BooruPageToolbar';
import { PaginationControl } from '../components/PaginationControl';
import { SkeletonGrid } from '../components/SkeletonGrid';
import { BooruPostDetailsPage } from './BooruPostDetailsPage';
import { BooruPost, BooruSite } from '../../shared/types';
import { getBooruPreviewUrl } from '../utils/url';
import { colors, spacing, fontSize, radius } from '../styles/tokens';
import { useFavorite } from '../hooks/useFavorite';

const { Title, Text } = Typography;

/** 标签类型名称和颜色 */
const TAG_TYPE_INFO: Record<number, { name: string; color: string }> = {
  0: { name: '通用', color: colors.textSecondary },
  1: { name: '艺术家', color: '#FF3B30' },
  3: { name: '版权', color: '#AF52DE' },
  4: { name: '角色', color: '#34C759' },
  5: { name: '元数据', color: '#FF9500' },
};

/** 标签详情信息 */
interface TagInfo {
  name: string;
  count: number;
  type: number;
}

interface BooruTagSearchPageProps {
  initialTag: string;
  initialSiteId?: number | null;
  onBack?: () => void;
  onArtistClick?: (artistName: string, siteId?: number | null) => void;
}

/**
 * Booru 标签搜索页面
 * 专门用于按标签搜索和浏览图片
 * 支持查看详情、收藏、下载等功能
 */
export const BooruTagSearchPage: React.FC<BooruTagSearchPageProps> = ({
  initialTag,
  initialSiteId = null,
  onBack,
  onArtistClick
}) => {
  const { message } = App.useApp();
  const [sites, setSites] = useState<BooruSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(initialSiteId);
  const [posts, setPosts] = useState<BooruPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTag, setSearchTag] = useState(initialTag);
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [selectedPost, setSelectedPost] = useState<BooruPost | null>(null);
  const [detailsPageOpen, setDetailsPageOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const hasSearchedRef = useRef(false); // 标记是否已经搜索过

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
    logPrefix: '[BooruTagSearchPage]'
  });
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

  // 标签详情信息
  const [tagInfo, setTagInfo] = useState<TagInfo | null>(null);
  const [tagInfoLoading, setTagInfoLoading] = useState(false);

  // 当前搜索标签的收藏状态
  const [isTagFavorited, setIsTagFavorited] = useState(false);

  // 检查当前搜索标签是否已收藏
  const checkTagFavoriteStatus = useCallback(async (tag: string) => {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.booru.isFavoriteTag(selectedSiteId, tag);
      if (result.success) {
        setIsTagFavorited(!!result.data);
      }
    } catch (error) {
      console.error('[BooruTagSearchPage] 检查标签收藏状态失败:', error);
    }
  }, [selectedSiteId]);

  // 切换当前标签的收藏状态
  const handleToggleTagFavorite = useCallback(async () => {
    if (!window.electronAPI) return;
    try {
      if (isTagFavorited) {
        await window.electronAPI.booru.removeFavoriteTagByName(selectedSiteId, searchTag);
        setIsTagFavorited(false);
        message.success('已取消收藏标签');
      } else {
        await window.electronAPI.booru.addFavoriteTag(selectedSiteId, searchTag);
        setIsTagFavorited(true);
        message.success('已收藏标签');
      }
    } catch (error) {
      console.error('[BooruTagSearchPage] 切换标签收藏失败:', error);
      message.error('操作失败');
    }
  }, [isTagFavorited, selectedSiteId, searchTag]);

  // 加载标签详情信息（类型、帖子数量）
  const loadTagInfo = useCallback(async (tag: string) => {
    if (!selectedSiteId || !window.electronAPI?.booru?.autocompleteTags) return;
    setTagInfoLoading(true);
    try {
      const result = await window.electronAPI.booru.autocompleteTags(selectedSiteId, tag, 5);
      if (result.success && result.data) {
        // 查找精确匹配的标签
        const exactMatch = result.data.find(t => t.name === tag);
        if (exactMatch) {
          setTagInfo(exactMatch);
        } else if (result.data.length > 0) {
          // 如果没有精确匹配，使用第一个结果
          setTagInfo(result.data[0]);
        } else {
          setTagInfo(null);
        }
      }
    } catch (error) {
      console.error('[BooruTagSearchPage] 加载标签信息失败:', error);
    } finally {
      setTagInfoLoading(false);
    }
  }, [selectedSiteId]);

  // 搜索标签变化时加载标签信息和检查收藏状态
  useEffect(() => {
    if (searchTag) {
      checkTagFavoriteStatus(searchTag);
      loadTagInfo(searchTag);
    }
  }, [searchTag, selectedSiteId, checkTagFavoriteStatus, loadTagInfo]);

  // 相关标签推荐：从当前帖子标签中统计高频标签（排除当前搜索标签）
  const relatedTags = useMemo(() => {
    if (posts.length === 0) return [];
    const excludeTags = new Set([searchTag.toLowerCase(), 'highres', 'absurdres', 'commentary_request', 'tagme']);
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
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count }));
  }, [posts, searchTag]);

  // 服务端喜欢状态管理
  const [serverFavorites, setServerFavorites] = useState<Set<number>>(new Set());

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
      console.error('[BooruTagSearchPage] 切换喜欢失败:', error);
      message.error('操作失败');
    }
  }, [selectedSiteId, serverFavorites]);

  // 加载外观配置
  const loadAppearanceConfig = async () => {
    console.log('[BooruTagSearchPage] 加载外观配置');
    try {
      if (!window.electronAPI) {
        console.error('[BooruTagSearchPage] electronAPI is not available');
        return;
      }

      const result = await window.electronAPI.config.get();
      if (result.success && result.data) {
        const booruConfig = result.data.booru;
        if (booruConfig?.appearance) {
          console.log('[BooruTagSearchPage] 加载外观配置成功:', booruConfig.appearance);
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
      console.error('[BooruTagSearchPage] 加载外观配置失败:', error);
    }
  };

  // 加载站点列表
  const loadSites = async () => {
    console.log('[BooruTagSearchPage] 加载站点列表');
    try {
      if (!window.electronAPI) {
        console.error('[BooruTagSearchPage] electronAPI is not available');
        return;
      }

      const result = await window.electronAPI.booru.getSites();
      if (result.success && result.data) {
        console.log('[BooruTagSearchPage] 加载站点列表成功:', result.data.length, '个站点');
        setSites(result.data);
        
        // 确定要使用的站点ID
        let targetSiteId: number | null = null;
        if (initialSiteId) {
          const siteExists = result.data.some(s => s.id === initialSiteId);
          if (siteExists) {
            targetSiteId = initialSiteId;
          } else if (result.data.length > 0) {
            targetSiteId = result.data[0].id;
          }
        } else if (result.data.length > 0) {
          targetSiteId = result.data[0].id;
        }
        
        // 设置站点ID
        if (targetSiteId) {
          console.log('[BooruTagSearchPage] 设置站点ID:', targetSiteId, '当前标签:', searchTag, '已搜索:', hasSearchedRef.current);
          const siteIdChanged = targetSiteId !== selectedSiteId;
          setSelectedSiteId(targetSiteId);
          
          // 如果标签已经设置好且还没有搜索过，立即触发搜索
          // 或者如果站点ID发生了变化，也需要重新搜索
          // 直接传入站点列表，避免状态更新延迟问题
          if (searchTag && (!hasSearchedRef.current || siteIdChanged)) {
            console.log('[BooruTagSearchPage] 站点加载完成，立即搜索标签:', searchTag, '使用站点列表:', result.data.length);
            // 直接使用 result.data，不等待状态更新
            setTimeout(() => {
              searchTagPosts(searchTag, 1, result.data);
            }, 100);
          }
        }
      } else {
        console.error('[BooruTagSearchPage] 加载站点列表失败:', result.error);
      }
    } catch (error) {
      console.error('[BooruTagSearchPage] 加载站点列表异常:', error);
    }
  };

  // 搜索标签
  const searchTagPosts = async (tag: string, page: number, siteList?: BooruSite[]) => {
    if (!selectedSiteId) {
      message.warning('请先选择站点');
      return;
    }

    if (!tag.trim()) {
      message.info('请输入标签');
      return;
    }

    // 优先使用传入的站点列表，否则使用状态中的站点列表
    const siteListToUse = siteList || sites;
    const site = siteListToUse.find(s => s.id === selectedSiteId);
    if (!site) {
      console.warn('[BooruTagSearchPage] 站点未找到，等待站点加载完成', {
        selectedSiteId,
        siteListLength: siteListToUse.length,
        siteIds: siteListToUse.map(s => s.id)
      });
      return;
    }

    console.log(`[BooruTagSearchPage] 搜索标签图片，站点: ${site.name}, 标签: "${tag}", 页码: ${page}`);
    setLoading(true);
    hasSearchedRef.current = true; // 标记已搜索

    try {
      if (!window.electronAPI) {
        setLoading(false);
        return;
      }

      const result = await window.electronAPI.booru.searchPosts(selectedSiteId, [tag], page, appearanceConfig.itemsPerPage);
      if (result.success) {
        const data = result.data || [];
        console.log('[BooruTagSearchPage] 搜索成功:', data.length, '张图片');
        
        setPosts(data);
        setCurrentPage(page);
        setHasMore(data.length >= appearanceConfig.itemsPerPage);

        // 加载收藏状态
        await loadFavoritesFromServer();
      } else {
        console.error('[BooruTagSearchPage] 搜索失败:', result.error);
        message.error('搜索失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BooruTagSearchPage] 搜索失败:', error);
      message.error('搜索失败');
    } finally {
      setLoading(false);
    }
  };

  // 加载收藏状态（从服务端获取完整收藏列表）
  const loadFavoritesFromServer = async () => {
    if (!selectedSiteId || !window.electronAPI) return;

    try {
      const result = await window.electronAPI.booru.getFavorites(selectedSiteId);
      if (result.success && result.data) {
        const favoriteIds = new Set(result.data.map((f: any) => f.postId));
        setFavorites(favoriteIds);

        // 更新图片数据中的收藏状态
        setPosts(prevPosts =>
          prevPosts.map(p => ({
            ...p,
            isFavorited: favoriteIds.has(p.postId)
          }))
        );
      }
    } catch (error) {
      console.error('[BooruTagSearchPage] 加载收藏状态失败:', error);
    }
  };

  // 处理站点切换
  const handleSiteChange = (siteId: number) => {
    console.log('[BooruTagSearchPage] 切换站点:', siteId);
    setSelectedSiteId(siteId);
    setPosts([]);
    setCurrentPage(1);
    setHasMore(true);
    // 切换站点后重新搜索
    if (searchTag) {
      searchTagPosts(searchTag, 1);
    }
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
    console.log('[BooruTagSearchPage] 下载图片:', post.postId);
    try {
      if (!window.electronAPI || !selectedSiteId) return;

      const result = await window.electronAPI.booru.addToDownload(post.postId, selectedSiteId);
      if (result.success) {
        message.success('已添加到下载队列');
      } else {
        message.error('下载失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BooruTagSearchPage] 下载失败:', error);
      message.error('下载失败');
    }
  };

  // 处理标签点击（在新页面中打开另一个标签搜索）
  const handleTagClick = (tag: string) => {
    console.log('[BooruTagSearchPage] 点击标签:', tag);
    // 更新当前搜索标签
    setSearchTag(tag);
    searchTagPosts(tag, 1);
  };

  // 处理艺术家点击：如果提供了 onArtistClick 回调则使用它，否则在当前页面搜索该艺术家标签
  const handleArtistClick = useCallback((artistName: string) => {
    console.log('[BooruTagSearchPage] 点击艺术家:', artistName);
    if (onArtistClick) {
      onArtistClick(artistName, selectedSiteId);
    } else {
      // 在当前页面更新搜索标签为艺术家名称
      setSearchTag(artistName);
      searchTagPosts(artistName, 1);
    }
  }, [onArtistClick, selectedSiteId]);

  // 处理图片预览
  const handlePreview = (post: BooruPost) => {
    console.log('[BooruTagSearchPage] 预览图片:', post.postId);
    setSelectedPost(post);
    setDetailsPageOpen(true);
  };

  // 获取预览URL（委托给统一的 url 工具函数）
  const getPreviewUrl = (post: BooruPost): string => {
    return getBooruPreviewUrl(post, appearanceConfig.previewQuality);
  };

  // 初始化
  useEffect(() => {
    console.log('[BooruTagSearchPage] 初始化页面，标签:', initialTag, '站点ID:', initialSiteId);
    hasSearchedRef.current = false; // 重置搜索标记
    loadAppearanceConfig();
    loadSites();
  }, [initialTag, initialSiteId]); // 当 initialTag 或 initialSiteId 变化时重新初始化

  // 当站点和标签准备好后，自动搜索（仅在首次加载时）
  useEffect(() => {
    if (selectedSiteId && searchTag && !hasSearchedRef.current) {
      console.log('[BooruTagSearchPage] 自动搜索标签:', searchTag, '站点:', selectedSiteId);
      // 延迟搜索，确保状态更新完成
      const timer = setTimeout(() => {
        searchTagPosts(searchTag, 1);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [selectedSiteId, searchTag]);

  // 当初始标签变化时，更新搜索
  useEffect(() => {
    if (initialTag && initialTag !== searchTag) {
      console.log('[BooruTagSearchPage] 初始标签变化:', initialTag);
      hasSearchedRef.current = false; // 重置搜索标记
      setSearchTag(initialTag);
      // 如果站点已经准备好，立即搜索；否则等待站点准备好的 useEffect 触发搜索
      if (selectedSiteId) {
        // 延迟搜索，确保状态更新完成
        const timer = setTimeout(() => {
          searchTagPosts(initialTag, 1);
        }, 200);
        return () => clearTimeout(timer);
      }
    }
  }, [initialTag, selectedSiteId]);

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
      {/* 页面标题和返回按钮 */}
      <div style={{ marginBottom: spacing.md, display: 'flex', alignItems: 'center', gap: spacing.lg }}>
        {onBack && (
          <Button icon={<LeftOutlined />} onClick={onBack}>
            返回
          </Button>
        )}
        <Title level={3} style={{ margin: 0 }}>
          标签搜索: {searchTag.replace(/_/g, ' ')}
        </Title>
        <Tooltip title={isTagFavorited ? '取消收藏此标签' : '收藏此标签'}>
          <Button
            type="text"
            icon={isTagFavorited
              ? <StarFilled style={{ color: '#faad14', fontSize: 20 }} />
              : <StarOutlined style={{ fontSize: 20 }} />}
            onClick={handleToggleTagFavorite}
          />
        </Tooltip>
      </div>

      {/* 标签详情信息卡片 */}
      <div style={{
        padding: `${spacing.md}px ${spacing.lg}px`,
        marginBottom: spacing.md,
        background: colors.bgGroupedSecondary,
        borderRadius: radius.lg,
        border: `1px solid ${colors.border}`,
      }}>
        {tagInfoLoading ? (
          <Spin size="small" />
        ) : tagInfo ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
              <Text strong style={{ fontSize: fontSize.lg }}>
                {tagInfo.name.replace(/_/g, ' ')}
              </Text>
              <Tag color={TAG_TYPE_INFO[tagInfo.type]?.color || colors.textSecondary}>
                {TAG_TYPE_INFO[tagInfo.type]?.name || `类型 ${tagInfo.type}`}
              </Tag>
              <Text type="secondary" style={{ fontSize: fontSize.sm }}>
                {tagInfo.count.toLocaleString()} 张帖子
              </Text>
            </div>
          </div>
        ) : (
          <Text type="secondary" style={{ fontSize: fontSize.sm }}>
            标签信息加载中...
          </Text>
        )}

        {/* 相关标签推荐 */}
        {relatedTags.length > 0 && (
          <div style={{ marginTop: spacing.sm }}>
            <Text type="secondary" style={{ fontSize: fontSize.xs, marginRight: spacing.sm }}>
              相关标签:
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
        onSiteChange={handleSiteChange}
        onRatingChange={setRatingFilter}
        onRefresh={() => {
          if (searchTag) searchTagPosts(searchTag, currentPage);
        }}
      />

      {/* 图片列表 */}
      <div>
        {loading && (
          <SkeletonGrid count={12} cardWidth={appearanceConfig.gridSize} gap={appearanceConfig.spacing} />
        )}

        {!loading && posts.length === 0 && (
          <Empty
            description="未找到匹配的图片"
            style={{ marginTop: '100px' }}
          >
            <Button
              type="primary"
              onClick={() => searchTagPosts(searchTag, 1)}
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
              onPrevious={() => searchTagPosts(searchTag, Math.max(1, currentPage - 1))}
              onNext={() => searchTagPosts(searchTag, currentPage + 1)}
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
              onToggleServerFavorite={selectedSite?.username ? handleToggleServerFavorite : undefined}
              serverFavorites={serverFavorites}
            />

            <PaginationControl
              currentPage={currentPage}
              currentCount={posts.length}
              itemsPerPage={appearanceConfig.itemsPerPage}
              paginationPosition={appearanceConfig.paginationPosition}
              position="bottom"
              onPrevious={() => searchTagPosts(searchTag, Math.max(1, currentPage - 1))}
              onNext={() => searchTagPosts(searchTag, currentPage + 1)}
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
        isServerFavorited={(p) => serverFavorites.has(p.postId)}
        onToggleServerFavorite={selectedSite?.username ? handleToggleServerFavorite : undefined}
        onArtistClick={handleArtistClick}
      />
    </div>
  );
};

// BooruGridLayout 已提取到 src/renderer/components/BooruGridLayout.tsx

