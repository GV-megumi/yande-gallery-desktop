import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Button, Empty, App } from 'antd';
import { BooruGridLayout } from '../components/BooruGridLayout';
import { BooruPageToolbar, RatingFilter } from '../components/BooruPageToolbar';
import { PaginationControl } from '../components/PaginationControl';
import { SkeletonGrid } from '../components/SkeletonGrid';
import { BooruPostDetailsPage } from './BooruPostDetailsPage';
import { BooruPost, BooruSite } from '../../shared/types';
import { getBooruPreviewUrl } from '../utils/url';
import { useFavorite } from '../hooks/useFavorite';

interface BooruPageProps {
  onTagClick?: (tag: string, siteId?: number | null) => void;
}

export const BooruPage: React.FC<BooruPageProps> = ({ onTagClick }) => {
  const { message } = App.useApp();
  const [sites, setSites] = useState<BooruSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);
  const [posts, setPosts] = useState<BooruPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [selectedPost, setSelectedPost] = useState<BooruPost | null>(null);
  const [detailsPageOpen, setDetailsPageOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  // 请求计数器：用于丢弃快速切换站点时的过期响应
  const loadRequestIdRef = useRef(0);
  // 收藏状态管理
  const { favorites, toggleFavorite, loadFavoritesFromPosts } = useFavorite({
    siteId: selectedSiteId,
    onSuccess: (postId, isFavorited) => {
      // 更新图片数据中的收藏状态
      setPosts(prevPosts =>
        prevPosts.map(p =>
          p.id === postId ? { ...p, isFavorited } : p
        )
      );
      message[isFavorited ? 'success' : 'success'](isFavorited ? '已添加收藏' : '已取消收藏');
    },
    logPrefix: '[BooruPage]'
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
    console.log('[BooruPage] 加载外观配置');
    try {
      if (!window.electronAPI) {
        console.error('[BooruPage] electronAPI is not available');
        return;
      }

      const result = await window.electronAPI.config.get();
      if (result.success && result.data) {
        const config = result.data;
        const booruConfig = config.booru || {
          appearance: {
            gridSize: 330,
            previewQuality: 'auto',
            itemsPerPage: 20,
            paginationPosition: 'bottom',
            pageMode: 'pagination',
            spacing: 16,
            borderRadius: 8,
            margin: 24
          }
        };

        console.log('[BooruPage] 外观配置加载成功:', booruConfig.appearance);
        setAppearanceConfig(booruConfig.appearance);
      } else {
        console.error('[BooruPage] 加载外观配置失败:', result.error);
      }
    } catch (error) {
      console.error('[BooruPage] 加载外观配置失败:', error);
    }
  };

  // 加载站点列表
  const loadSites = async () => {
    console.log('[BooruPage] 加载Booru站点列表');
    try {
      if (!window.electronAPI) {
        console.error('[BooruPage] electronAPI is not available');
        return;
      }

      const result = await window.electronAPI.booru.getSites();
      if (result.success) {
        const siteList = result.data || [];
        console.log('[BooruPage] 站点列表加载成功:', siteList.length, '个站点');
        setSites(siteList);

        // 如果有激活站点，默认选中
        const activeSite = siteList.find(s => s.active);
        if (activeSite) {
          console.log('[BooruPage] 默认选中激活站点:', activeSite.name);
          setSelectedSiteId(activeSite.id);
        } else if (siteList.length > 0) {
          console.log('[BooruPage] 没有激活站点，默认选中第一个:', siteList[0].name);
          setSelectedSiteId(siteList[0].id);
        }
      } else {
        console.error('[BooruPage] 加载站点列表失败:', result.error);
        message.error('加载站点列表失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BooruPage] 加载站点列表失败:', error);
      message.error('加载站点列表失败');
    }
  };


  // 从Booru站点加载图片
  const loadPosts = async (page: number = 1) => {
    if (!selectedSiteId) return;

    const site = sites.find(s => s.id === selectedSiteId);
    if (!site) return;

    // 递增请求 ID，丢弃快速切换站点时的过期响应
    const requestId = ++loadRequestIdRef.current;

    console.log(`[BooruPage] 加载Booru图片，站点: ${site.name}, 页码: ${page}`);
    setLoading(true);

    try {
      if (!window.electronAPI) {
        setLoading(false);
        return;
      }

      // 清空搜索结果
      setIsSearchMode(false);
      setSearchQuery('');
      setSelectedTags([]);

      const result = await window.electronAPI.booru.getPosts(selectedSiteId, page, [], appearanceConfig.itemsPerPage);

      // 丢弃过期响应（用户可能已切换到其他站点）
      if (requestId !== loadRequestIdRef.current) {
        console.log('[BooruPage] 丢弃过期响应，requestId:', requestId, 'current:', loadRequestIdRef.current);
        return;
      }
      if (result.success) {
        const data = result.data || [];
        console.log('[BooruPage] 图片加载成功:', data.length, '张图片, 配置每页数量:', appearanceConfig.itemsPerPage);
        
        // 调试：检查第一个 post 的 URL 是否完整
        if (data.length > 0 && data[0]) {
          const firstPost = data[0];
          console.log('[BooruPage] 前端接收到的第一个 post URL:', {
            postId: firstPost.postId,
            fileUrlLength: firstPost.fileUrl?.length || 0,
            previewUrlLength: firstPost.previewUrl?.length || 0,
            sampleUrlLength: firstPost.sampleUrl?.length || 0,
            fileUrl: firstPost.fileUrl,
            previewUrl: firstPost.previewUrl,
            sampleUrl: firstPost.sampleUrl,
            fileUrlEndsWith: firstPost.fileUrl?.slice(-30) || '',
            previewUrlEndsWith: firstPost.previewUrl?.slice(-30) || '',
            sampleUrlEndsWith: firstPost.sampleUrl?.slice(-30) || ''
          });
        }
        
        setPosts(data);
        setCurrentPage(page);
        setHasMore(data.length >= appearanceConfig.itemsPerPage);

        // 加载收藏状态（从当前图片数据中提取）
        loadFavoritesFromPosts(data);
      } else {
        console.error('[BooruPage] 加载图片失败:', result.error);
        message.error('加载图片失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BooruPage] 加载图片失败:', error);
      message.error('加载图片失败');
    } finally {
      setLoading(false);
      console.log('[BooruPage] 图片加载完成');
    }
  };

  // 搜索Booru图片
  const searchPosts = async (query: string, page: number = 1) => {
    if (!selectedSiteId) {
      message.warning('请先选择站点');
      return;
    }

    if (!query.trim()) {
      message.info('请输入搜索关键词');
      return;
    }

    const site = sites.find(s => s.id === selectedSiteId);
    if (!site) return;

    console.log(`[BooruPage] 搜索Booru图片，站点: ${site.name}, 查询: "${query}", 页码: ${page}`);
    setLoading(true);
    setIsSearchMode(true);

    try {
      if (!window.electronAPI) {
        setLoading(false);
        return;
      }

      // 图片浏览界面需要标签分类，所以传递 fetchTagCategories: true
      const result = await window.electronAPI.booru.searchPosts(selectedSiteId, query.split(' ').filter(t => t.trim()), page, appearanceConfig.itemsPerPage, true);
      if (result.success) {
        const data = result.data || [];
        console.log('[BooruPage] 搜索成功:', data.length, '张图片, 配置每页数量:', appearanceConfig.itemsPerPage);
        
        // 调试：检查第一个 post 的 URL 是否完整
        if (data.length > 0 && data[0]) {
          const firstPost = data[0];
          console.log('[BooruPage] 搜索后前端接收到的第一个 post URL:', {
            postId: firstPost.postId,
            fileUrlLength: firstPost.fileUrl?.length || 0,
            previewUrlLength: firstPost.previewUrl?.length || 0,
            sampleUrlLength: firstPost.sampleUrl?.length || 0,
            fileUrl: firstPost.fileUrl,
            previewUrl: firstPost.previewUrl,
            sampleUrl: firstPost.sampleUrl,
            fileUrlEndsWith: firstPost.fileUrl?.slice(-30) || '',
            previewUrlEndsWith: firstPost.previewUrl?.slice(-30) || '',
            sampleUrlEndsWith: firstPost.sampleUrl?.slice(-30) || ''
          });
        }
        
        setPosts(data);
        setCurrentPage(page);
        setHasMore(data.length >= appearanceConfig.itemsPerPage);

        // 加载收藏状态（从当前图片数据中提取）
        loadFavoritesFromPosts(data);

        // 保存搜索历史（仅首页搜索时保存）
        if (page === 1 && selectedSiteId) {
          window.electronAPI.booru.addSearchHistory?.(selectedSiteId, query, data.length);
        }
      } else {
        console.error('[BooruPage] 搜索失败:', result.error);
        message.error('搜索失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BooruPage] 搜索失败:', error);
      message.error('搜索失败');
    } finally {
      setLoading(false);
    }
  };

  // 处理站点切换
  const handleSiteChange = (siteId: number) => {
    console.log('[BooruPage] 切换站点:', siteId);
    setSelectedSiteId(siteId);
    setPosts([]);
    setCurrentPage(1);
    setHasMore(true);
    setIsSearchMode(false);
    setSearchQuery('');
    setSelectedTags([]);
  };

  // 处理搜索
  const handleSearch = (value: string) => {
    const query = value.trim();
    if (!query) {
      // 如果搜索为空，重新加载当前页
      setIsSearchMode(false);
      loadPosts(1);
      return;
    }

    setSearchQuery(query);
    searchPosts(query, 1);
  };

  // 处理收藏切换（委托给 useFavorite Hook）
  const handleToggleFavorite = useCallback(async (post: BooruPost) => {
    const result = await toggleFavorite(post);
    if (!result.success) {
      message.error('操作失败');
    }
  }, [toggleFavorite, message]);

  // 处理下载
  const handleDownload = useCallback(async (post: BooruPost) => {
    console.log('[BooruPage] 下载图片:', post.postId);
    try {
      if (!window.electronAPI || !selectedSiteId) return;

      const result = await window.electronAPI.booru.addToDownload(post.postId, selectedSiteId);
      if (result.success) {
        console.log('[BooruPage] 已添加到下载队列:', result.data);
        message.success('已添加到下载队列');
      } else {
        console.error('[BooruPage] 下载失败:', result.error);
        message.error('下载失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BooruPage] 下载失败:', error);
      message.error('下载失败');
    }
  }, [selectedSiteId, message]);

  // 处理标签点击
  const handleTagClick = (tag: string) => {
    console.log('[BooruPage] 点击标签:', tag);
    // 如果提供了 onTagClick 回调，导航到标签搜索页面
    if (onTagClick) {
      onTagClick(tag, selectedSiteId);
    } else {
      // 否则使用原来的逻辑（添加到当前搜索）
      const newTags = [...selectedTags, tag];
      setSelectedTags(newTags);
      const query = newTags.join(' ');
      setSearchQuery(query);
      searchPosts(query, 1);
    }
  };

  // 处理标签移除
  const handleRemoveTag = (tag: string) => {
    console.log('[BooruPage] 移除标签:', tag);
    const newTags = selectedTags.filter(t => t !== tag);
    setSelectedTags(newTags);
    const query = newTags.join(' ');
    setSearchQuery(query);
    if (query) {
      searchPosts(query, 1);
    } else {
      setIsSearchMode(false);
      loadPosts(1);
    }
  };

  // 处理图片预览
  const handlePreview = useCallback((post: BooruPost) => {
    console.log('[BooruPage] 预览图片:', post.postId);
    setSelectedPost(post);
    setDetailsPageOpen(true);
  }, []);

  // 按 ID 倒序排序（最新的在前），用于 BooruGridLayout 和 BooruPostDetailsPage
  const sortedPosts = useMemo(() => {
    return [...posts].sort((a, b) => b.postId - a.postId);
  }, [posts]);

  // 排序后再按评级筛选，避免重复排序
  const filteredSortedPosts = useMemo(() => {
    if (ratingFilter === 'all') return sortedPosts;
    return sortedPosts.filter(post => post.rating === ratingFilter);
  }, [sortedPosts, ratingFilter]);

  // 初始化
  useEffect(() => {
    console.log('[BooruPage] 初始化页面');
    loadAppearanceConfig();
    loadSites();
  }, []);

  // 监听配置变更事件（事件驱动，替代轮询）
  useEffect(() => {
    if (!window.electronAPI?.config?.onConfigChanged) return;
    const unsubscribe = window.electronAPI.config.onConfigChanged((config: any) => {
      console.log('[BooruPage] 收到配置变更事件');
      const booruConfig = config?.booru?.appearance;
      if (booruConfig) {
        setAppearanceConfig(booruConfig);
      } else {
        // 配置结构不包含 booru.appearance 时重新加载完整配置
        loadAppearanceConfig();
      }
    });
    return () => unsubscribe();
  }, []);

  // 监听配置变化，重新加载图片
  const prevItemsPerPageRef = useRef(appearanceConfig.itemsPerPage);
  useEffect(() => {
    if (selectedSiteId && prevItemsPerPageRef.current !== appearanceConfig.itemsPerPage) {
      console.log('[BooruPage] 每页数量配置变化，重新加载:', prevItemsPerPageRef.current, '->', appearanceConfig.itemsPerPage);
      prevItemsPerPageRef.current = appearanceConfig.itemsPerPage;
      if (isSearchMode) {
        searchPosts(searchQuery, 1);
      } else {
        loadPosts(1);
      }
    }
  }, [appearanceConfig.itemsPerPage, selectedSiteId, isSearchMode, searchQuery]);

  // 站点切换时重新加载图片
  useEffect(() => {
    if (selectedSiteId) {
      console.log('[BooruPage] 站点改变，重新加载图片');
      loadPosts(1);
    }
  }, [selectedSiteId]);

  const selectedSite = selectedSiteId ? sites.find(s => s.id === selectedSiteId) : null;

  // 根据预览质量获取图片URL（委托给统一的 url 工具函数）
  const getPreviewUrl = useCallback((post: BooruPost): string => {
    return getBooruPreviewUrl(post, appearanceConfig.previewQuality);
  }, [appearanceConfig.previewQuality]);

  return (
    <div ref={contentRef} style={{ padding: `${appearanceConfig.margin}px` }}>
      {/* 顶部控制栏 */}
      <BooruPageToolbar
        sites={sites}
        selectedSiteId={selectedSiteId}
        loading={loading}
        ratingFilter={ratingFilter}
        offsetTop={24}
        onSiteChange={handleSiteChange}
        onRatingChange={(rating) => {
          console.log('[BooruPage] 分级筛选改变:', rating);
          setRatingFilter(rating);
          if (isSearchMode) {
            searchPosts(searchQuery, 1);
          } else {
            loadPosts(1);
          }
        }}
        onRefresh={() => {
          console.log('[BooruPage] 刷新页面');
          if (isSearchMode) {
            searchPosts(searchQuery, 1);
          } else {
            loadPosts(1);
          }
        }}
        showSearch
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSearch={handleSearch}
        selectedTags={selectedTags}
        onRemoveTag={handleRemoveTag}
      />

      {/* 图片列表 */}
      <div>
        {loading && (
          <SkeletonGrid count={12} cardWidth={appearanceConfig.gridSize} gap={appearanceConfig.spacing} />
        )}

        {!loading && posts.length === 0 && (
          <Empty
            description={isSearchMode ? '未找到匹配的图片' : '暂无图片'}
            style={{ marginTop: '100px' }}
          >
            <Button
              type="primary"
              onClick={() => loadPosts(1)}
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
              onPrevious={() => {
                const next = Math.max(1, currentPage - 1);
                isSearchMode ? searchPosts(searchQuery, next) : loadPosts(next);
              }}
              onNext={() => {
                const next = currentPage + 1;
                isSearchMode ? searchPosts(searchQuery, next) : loadPosts(next);
              }}
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
              onPrevious={() => {
                const next = Math.max(1, currentPage - 1);
                isSearchMode ? searchPosts(searchQuery, next) : loadPosts(next);
              }}
              onNext={() => {
                const next = currentPage + 1;
                isSearchMode ? searchPosts(searchQuery, next) : loadPosts(next);
              }}
            />
          </>
        )}
      </div>

      {/* 图片详情页面 - 使用排序后的 posts 数组，确保索引与显示顺序一致 */}
      <BooruPostDetailsPage
        open={detailsPageOpen}
        post={selectedPost}
        site={selectedSite || null}
        posts={sortedPosts}
        initialIndex={selectedPost ? sortedPosts.findIndex(p => p.id === selectedPost.id) : 0}
        onClose={() => {
          console.log('[BooruPage] 关闭详情页面');
          setDetailsPageOpen(false);
          setSelectedPost(null);
        }}
        onToggleFavorite={handleToggleFavorite}
        onDownload={handleDownload}
        onTagClick={(tag: string) => {
          // 如果提供了 onTagClick prop，使用它导航到标签搜索页面
          if (onTagClick) {
            onTagClick(tag, selectedSiteId);
          } else {
            // 否则使用原来的逻辑
            handleTagClick(tag);
          }
        }}
      />
    </div>
  );
};

export default BooruPage;
