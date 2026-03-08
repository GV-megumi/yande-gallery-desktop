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
          p.postId === postId ? { ...p, isFavorited } : p
        )
      );
      message[isFavorited ? 'success' : 'success'](isFavorited ? '已添加收藏' : '已取消收藏');
    },
    logPrefix: '[BooruPage]'
  });

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
      console.error('[BooruPage] 切换喜欢失败:', error);
      message.error('操作失败');
    }
  }, [selectedSiteId, serverFavorites]);

  // 黑名单标签名列表（用于前端过滤）
  const [blacklistTagNames, setBlacklistTagNames] = useState<string[]>([]);
  const [blacklistEnabled, setBlacklistEnabled] = useState(true);
  // 用户手动取消隐藏的黑名单标签（按标签粒度控制）
  const [disabledBlacklistTags, setDisabledBlacklistTags] = useState<Set<string>>(new Set());

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
            borderRadius: 14,
            margin: 20
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


  // 加载黑名单标签名列表
  const loadBlacklistTagNames = useCallback(async () => {
    if (!selectedSiteId) return;
    try {
      const result = await window.electronAPI.booru.getActiveBlacklistTagNames(selectedSiteId);
      if (result.success && result.data) {
        setBlacklistTagNames(result.data);
        console.log('[BooruPage] 加载黑名单标签:', result.data.length, '个');
      }
    } catch (error) {
      console.error('[BooruPage] 加载黑名单标签失败:', error);
    }
  }, [selectedSiteId]);

  // 当站点变化时重新加载黑名单，并重置按标签取消隐藏的状态
  useEffect(() => {
    loadBlacklistTagNames();
    setDisabledBlacklistTags(new Set());
  }, [loadBlacklistTagNames]);

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

  // 统计当前页面中每个黑名单标签命中的图片数量
  const blacklistHitStats = useMemo(() => {
    if (!blacklistTagNames.length) return new Map<string, number>();
    const hitMap = new Map<string, number>();
    const ratingFiltered = ratingFilter !== 'all'
      ? sortedPosts.filter(post => post.rating === ratingFilter)
      : sortedPosts;
    for (const post of ratingFiltered) {
      const postTags = post.tags.split(' ');
      for (const tag of postTags) {
        if (blacklistTagNames.includes(tag)) {
          hitMap.set(tag, (hitMap.get(tag) || 0) + 1);
        }
      }
    }
    return hitMap;
  }, [sortedPosts, ratingFilter, blacklistTagNames]);

  // 排序后按评级筛选 + 黑名单过滤（支持按标签粒度取消隐藏）
  const filteredSortedPosts = useMemo(() => {
    let result = sortedPosts;

    // 评级筛选
    if (ratingFilter !== 'all') {
      result = result.filter(post => post.rating === ratingFilter);
    }

    // 黑名单过滤：仅过滤启用中且未被用户单独取消的标签
    if (blacklistEnabled && blacklistTagNames.length > 0) {
      const activeBlacklist = blacklistTagNames.filter(t => !disabledBlacklistTags.has(t));
      if (activeBlacklist.length > 0) {
        const blacklistSet = new Set(activeBlacklist);
        const beforeCount = result.length;
        result = result.filter(post => {
          const postTags = post.tags.split(' ');
          return !postTags.some(tag => blacklistSet.has(tag));
        });
        const hiddenCount = beforeCount - result.length;
        if (hiddenCount > 0) {
          console.log(`[BooruPage] 黑名单过滤: 隐藏 ${hiddenCount} 张图片`);
        }
      }
    }

    return result;
  }, [sortedPosts, ratingFilter, blacklistEnabled, blacklistTagNames, disabledBlacklistTags]);

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

      {/* 黑名单过滤提示 - 按标签显示命中情况，支持按标签取消隐藏 */}
      {blacklistEnabled && blacklistHitStats.size > 0 && (
        <div style={{
          padding: '8px 12px',
          marginBottom: 8,
          background: 'rgba(255, 59, 48, 0.06)',
          borderRadius: 8,
          fontSize: 12,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ color: '#FF3B30' }}>
              黑名单命中 {blacklistHitStats.size} 个标签
              {(() => {
                const activeBlacklist = blacklistTagNames.filter(t => !disabledBlacklistTags.has(t));
                const activeSet = new Set(activeBlacklist);
                const ratingFiltered = ratingFilter !== 'all'
                  ? sortedPosts.filter(p => p.rating === ratingFilter)
                  : sortedPosts;
                const hiddenCount = ratingFiltered.filter(post => {
                  const postTags = post.tags.split(' ');
                  return postTags.some(tag => activeSet.has(tag));
                }).length;
                return hiddenCount > 0 ? `，已隐藏 ${hiddenCount} 张图片` : '';
              })()}
            </span>
            <Button type="link" size="small" onClick={() => setBlacklistEnabled(false)} style={{ fontSize: 12, padding: 0 }}>
              全部显示
            </Button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {Array.from(blacklistHitStats.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([tag, count]) => {
                const isDisabled = disabledBlacklistTags.has(tag);
                return (
                  <span
                    key={tag}
                    onClick={() => {
                      setDisabledBlacklistTags(prev => {
                        const next = new Set(prev);
                        if (isDisabled) {
                          next.delete(tag);
                        } else {
                          next.add(tag);
                        }
                        return next;
                      });
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '1px 6px',
                      borderRadius: 4,
                      cursor: 'pointer',
                      background: isDisabled ? 'rgba(0,0,0,0.04)' : 'rgba(255, 59, 48, 0.1)',
                      color: isDisabled ? '#999' : '#FF3B30',
                      textDecoration: isDisabled ? 'line-through' : 'none',
                      transition: 'all 0.2s',
                    }}
                  >
                    {tag.replace(/_/g, ' ')} ({count})
                  </span>
                );
              })}
          </div>
        </div>
      )}
      {!blacklistEnabled && blacklistTagNames.length > 0 && (
        <div style={{
          padding: '6px 12px',
          marginBottom: 8,
          background: 'rgba(255, 149, 0, 0.06)',
          borderRadius: 8,
          fontSize: 12,
          color: '#FF9500',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>黑名单过滤已暂时关闭</span>
          <Button type="link" size="small" onClick={() => {
            setBlacklistEnabled(true);
            setDisabledBlacklistTags(new Set());
          }} style={{ fontSize: 12, padding: 0 }}>
            重新启用
          </Button>
        </div>
      )}

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
              onToggleServerFavorite={selectedSite?.username ? handleToggleServerFavorite : undefined}
              serverFavorites={serverFavorites}
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
        isServerFavorited={(p) => serverFavorites.has(p.postId)}
        onToggleServerFavorite={selectedSite?.username ? handleToggleServerFavorite : undefined}
      />
    </div>
  );
};

export default BooruPage;
