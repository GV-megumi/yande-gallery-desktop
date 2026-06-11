import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Button, Empty, App, Tooltip, Tag } from 'antd';
import { CheckSquareOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { BooruGridLayout } from '../components/BooruGridLayout';
import { BooruPageToolbar, RatingFilter } from '../components/BooruPageToolbar';
import { PaginationControl } from '../components/PaginationControl';
import { SkeletonGrid } from '../components/SkeletonGrid';
import { BooruPostDetailsPage } from './BooruPostDetailsPage';
import { AdvancedFilterPanel, FilterConfig, filterConfigToMetaTags } from '../components/AdvancedFilterPanel';
import {
  BooruPost,
  BooruSite,
  RendererBooruPostFavoriteChangedPayload,
  RendererBooruPostServerFavoriteChangedPayload,
} from '../../shared/types';
import { colors } from '../styles/tokens';
import { getBooruPreviewUrl } from '../utils/url';
import { useFavorite } from '../hooks/useFavorite';
import { useBooruDomainEvents } from '../hooks/useBooruDomainEvents';
import { getCommonPostTags, toggleSelectedPost } from '../utils/multiSelect';

interface BooruPageProps {
  onTagClick?: (tag: string, siteId?: number | null) => void;
  onArtistClick?: (artistName: string, siteId?: number | null) => void;
  onCharacterClick?: (characterName: string, siteId?: number | null) => void;
  /** 当叠加页面（标签搜索等）激活时为 true，抑制详情弹窗显示 */
  suspended?: boolean;
}

type BooruRequestSource = 'manual' | 'pagination';

export const BooruPage: React.FC<BooruPageProps> = ({ onTagClick, onArtistClick, onCharacterClick, suspended = false }) => {
  const { message } = App.useApp();
  const [sites, setSites] = useState<BooruSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);
  const selectedSiteIdRef = useRef<number | null>(null);
  const [posts, setPosts] = useState<BooruPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pendingPage, setPendingPage] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [isSearchMode, setIsSearchMode] = useState(false);
  // 高级过滤配置（转换为 meta-tags 追加到搜索查询）
  const [filterConfig, setFilterConfig] = useState<FilterConfig>({});
  const [selectedPost, setSelectedPost] = useState<BooruPost | null>(null);
  const [detailsPageOpen, setDetailsPageOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPostIds, setSelectedPostIds] = useState<Set<number>>(new Set());
  const contentRef = useRef<HTMLDivElement>(null);
  // 挂起时保存/恢复详情弹窗状态（导航栈机制）
  // 请求计数器：用于丢弃快速切换站点时的过期响应
  const loadRequestIdRef = useRef(0);
  const paginationRequestInFlightRef = useRef(false);
  const blacklistRequestIdRef = useRef(0);

  useEffect(() => {
    selectedSiteIdRef.current = selectedSiteId;
    blacklistRequestIdRef.current += 1;
  }, [selectedSiteId]);
  // 批量收藏进行中标记：抑制单张收藏成功 toast，改由批量逻辑统一汇总提示
  const batchFavoriteInProgressRef = useRef(false);
  // 收藏状态管理
  const { favorites, setFavorites, toggleFavorite, loadFavoritesFromPosts } = useFavorite({
    siteId: selectedSiteId,
    onSuccess: (postId, isFavorited) => {
      // 更新图片数据中的收藏状态
      setPosts(prevPosts =>
        prevPosts.map(p =>
          p.postId === postId ? { ...p, isFavorited } : p
        )
      );
      if (!batchFavoriteInProgressRef.current) {
        message.success(isFavorited ? '已添加收藏' : '已取消收藏');
      }
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
    itemsPerPage: 60,
    paginationPosition: 'both' as 'top' | 'bottom' | 'both',
    pageMode: 'pagination' as 'pagination' | 'infinite',
    spacing: 16,
    borderRadius: 8,
    margin: 24
  });

  // 加载外观配置
  const loadAppearanceConfig = async () => {
    console.log('[BooruPage] 加载外观配置');
    try {
      if (!window.electronAPI?.booruPreferences?.appearance) {
        console.error('[BooruPage] electronAPI is not available');
        return;
      }

      const result = await window.electronAPI.booruPreferences.appearance.get();
      if (result.success && result.data) {
        console.log('[BooruPage] 外观配置加载成功:', result.data);
        setAppearanceConfig(result.data);
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

        if (siteList.length > 0) {
          // 已选站点仍然存在时保持选择不变：避免 booru:sites-changed 事件（重命名/登录/激活切换等）
          // 重新触发 loadSites 时把用户手动选中的站点重置为激活站点，进而由 [selectedSiteId] effect
          // 清空当前列表并跳回第 1 页，丢失浏览位置
          setSelectedSiteId(prev => {
            if (prev !== null && siteList.some(s => s.id === prev)) {
              return prev;
            }
            // 首次加载或原选中站点已被删除：优先选激活站点，否则选第一个
            const fallback = siteList.find(s => s.active) ?? siteList[0];
            console.log('[BooruPage] 默认选中站点:', fallback.name);
            return fallback.id;
          });
        } else {
          setSelectedSiteId(null);
          setPosts([]);
          setFavorites(new Set());
          setServerFavorites(new Set());
          setBlacklistTagNames([]);
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
    const siteId = selectedSiteId;
    const requestId = blacklistRequestIdRef.current + 1;
    blacklistRequestIdRef.current = requestId;
    try {
      const result = await window.electronAPI.booru.getActiveBlacklistTagNames(siteId);
      if (blacklistRequestIdRef.current !== requestId || selectedSiteIdRef.current !== siteId) return;
      if (result.success && result.data) {
        setBlacklistTagNames(result.data);
        console.log('[BooruPage] 加载黑名单标签:', result.data.length, '个');
      }
    } catch (error) {
      if (blacklistRequestIdRef.current !== requestId || selectedSiteIdRef.current !== siteId) return;
      console.error('[BooruPage] 加载黑名单标签失败:', error);
    }
  }, [selectedSiteId]);

  // 当站点变化时重新加载黑名单，并重置按标签取消隐藏的状态
  useEffect(() => {
    loadBlacklistTagNames();
    setDisabledBlacklistTags(new Set());
  }, [loadBlacklistTagNames]);

  const applyPostFavoriteEvent = useCallback((payload: RendererBooruPostFavoriteChangedPayload) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (payload.isFavorited) next.add(payload.postId);
      else next.delete(payload.postId);
      return next;
    });
    setPosts(prevPosts =>
      prevPosts.map(post =>
        post.postId === payload.postId
          ? { ...post, isFavorited: payload.isFavorited }
          : post
      )
    );
  }, [setFavorites]);

  const applyServerFavoriteEvent = useCallback((payload: RendererBooruPostServerFavoriteChangedPayload) => {
    const postIds = payload.postIds ?? (payload.postId === undefined ? [] : [payload.postId]);
    if (postIds.length === 0) return;
    const postIdSet = new Set(postIds);

    setServerFavorites(prev => {
      const next = new Set(prev);
      for (const postId of postIdSet) {
        if (payload.isLiked) next.add(postId);
        else next.delete(postId);
      }
      return next;
    });
    setPosts(prevPosts =>
      prevPosts.map(post =>
        postIdSet.has(post.postId)
          ? { ...post, isLiked: payload.isLiked }
          : post
      )
    );
  }, []);

  useBooruDomainEvents({
    siteId: selectedSiteId,
    active: !suspended,
    onPostFavoriteChanged: applyPostFavoriteEvent,
    onServerFavoriteChanged: applyServerFavoriteEvent,
    onBlacklistTagsChanged: () => {
      loadBlacklistTagNames();
      setDisabledBlacklistTags(new Set());
    },
    onSitesChanged: () => {
      loadSites();
    },
  });

  const beginBooruRequest = (page: number, source: BooruRequestSource) => {
    const requestId = ++loadRequestIdRef.current;
    paginationRequestInFlightRef.current = source === 'pagination';
    setPendingPage(page);
    setLoading(true);
    return requestId;
  };

  const isActiveBooruRequest = (requestId: number) => requestId === loadRequestIdRef.current;

  const finishBooruRequest = (requestId: number) => {
    if (!isActiveBooruRequest(requestId)) return false;
    paginationRequestInFlightRef.current = false;
    setPendingPage(null);
    setLoading(false);
    return true;
  };

  const invalidateBooruRequests = () => {
    loadRequestIdRef.current += 1;
    paginationRequestInFlightRef.current = false;
    setPendingPage(null);
    setLoading(false);
  };

  // 从Booru站点加载图片
  const loadPosts = async (page: number = 1, source: BooruRequestSource = 'manual') => {
    if (!selectedSiteId) return;

    const site = sites.find(s => s.id === selectedSiteId);
    if (!site) return;

    const requestId = beginBooruRequest(page, source);

    console.log(`[BooruPage] 加载Booru图片，站点: ${site.name}, 页码: ${page}`);

    try {
      if (!window.electronAPI) {
        return;
      }

      // 清空搜索结果
      setIsSearchMode(false);
      setSearchQuery('');
      setSelectedTags([]);

      const result = await window.electronAPI.booru.getPosts(selectedSiteId, page, [], appearanceConfig.itemsPerPage);

      // 丢弃过期响应（用户可能已切换到其他站点）
      if (!isActiveBooruRequest(requestId)) {
        console.log('[BooruPage] 丢弃过期响应，requestId:', requestId, 'current:', loadRequestIdRef.current);
        return;
      }
      if (result.success) {
        const data = result.data || [];
        console.log('[BooruPage] 图片加载成功:', data.length, '张图片');
        setPosts(data);
        setCurrentPage(page);
        setHasMore(data.length >= appearanceConfig.itemsPerPage);

        // 加载收藏状态（从当前图片数据中提取）
        loadFavoritesFromPosts(data);
        // 从 DB 持久化的 isLiked 字段恢复服务端喜欢状态
        setServerFavorites(new Set(data.filter((p: any) => p.isLiked).map((p: any) => p.postId)));
      } else {
        console.error('[BooruPage] 加载图片失败:', result.error);
        message.error('加载图片失败: ' + result.error);
      }
    } catch (error) {
      if (!isActiveBooruRequest(requestId)) return;
      console.error('[BooruPage] 加载图片失败:', error);
      message.error('加载图片失败');
    } finally {
      if (finishBooruRequest(requestId)) {
        console.log('[BooruPage] 图片加载完成');
      }
    }
  };

  // 搜索Booru图片
  const searchPosts = async (query: string, page: number = 1, filterOverride?: FilterConfig, source: BooruRequestSource = 'manual') => {
    if (!selectedSiteId) {
      message.warning('请先选择站点');
      return;
    }

    // 使用 filterOverride（如果提供）或当前 filterConfig
    const activeFilter = filterOverride ?? filterConfig;
    const filterMetaTags = filterConfigToMetaTags(activeFilter);

    // 如果没有查询文本且没有过滤条件，提示用户输入
    if (!query.trim() && filterMetaTags.length === 0) {
      message.info('请输入搜索关键词');
      return;
    }

    const site = sites.find(s => s.id === selectedSiteId);
    if (!site) return;

    const requestId = beginBooruRequest(page, source);

    console.log(`[BooruPage] 搜索Booru图片，站点: ${site.name}, 查询: "${query}", 页码: ${page}`);
    setIsSearchMode(true);

    try {
      if (!window.electronAPI) {
        return;
      }

      // 合并搜索标签和高级过滤 meta-tags
      const allTags = [...query.split(' ').filter(t => t.trim()), ...filterMetaTags];
      console.log('[BooruPage] 搜索标签（含过滤器 meta-tags）:', allTags);
      // 图片浏览界面需要标签分类，所以传递 fetchTagCategories: true
      const result = await window.electronAPI.booru.searchPosts(selectedSiteId, allTags, page, appearanceConfig.itemsPerPage, true);
      if (!isActiveBooruRequest(requestId)) {
        console.log('[BooruPage] 丢弃过期搜索响应，requestId:', requestId, 'current:', loadRequestIdRef.current);
        return;
      }
      if (result.success) {
        const data = result.data || [];
        console.log('[BooruPage] 搜索成功:', data.length, '张图片');
        setPosts(data);
        setCurrentPage(page);
        setHasMore(data.length >= appearanceConfig.itemsPerPage);

        // 加载收藏状态（从当前图片数据中提取）
        loadFavoritesFromPosts(data);
        // 从 DB 持久化的 isLiked 字段恢复服务端喜欢状态
        setServerFavorites(new Set(data.filter((p: any) => p.isLiked).map((p: any) => p.postId)));

        // 保存搜索历史（仅首页搜索时保存）
        if (page === 1 && selectedSiteId) {
          window.electronAPI.booru.addSearchHistory?.(selectedSiteId, query, data.length);
        }
      } else {
        console.error('[BooruPage] 搜索失败:', result.error);
        message.error('搜索失败: ' + result.error);
      }
    } catch (error) {
      if (!isActiveBooruRequest(requestId)) return;
      console.error('[BooruPage] 搜索失败:', error);
      message.error('搜索失败');
    } finally {
      finishBooruRequest(requestId);
    }
  };

  // 处理站点切换
  const handleSiteChange = (siteId: number) => {
    console.log('[BooruPage] 切换站点:', siteId);
    invalidateBooruRequests();
    setSelectedSiteId(siteId);
    setPosts([]);
    setCurrentPage(1);
    setHasMore(true);
    setIsSearchMode(false);
    setSearchQuery('');
    setSelectedTags([]);
    setFilterConfig({});
    setSelectionMode(false);
    setSelectedPostIds(new Set());
  };

  // 处理搜索
  const handleSearch = (value: string) => {
    const query = value.trim();
    const hasFilters = filterConfigToMetaTags(filterConfig).length > 0;
    if (!query && !hasFilters) {
      // 如果搜索为空且无过滤条件，重新加载当前页
      setIsSearchMode(false);
      loadPosts(1);
      return;
    }

    setSearchQuery(query);
    searchPosts(query, 1);
  };

  // 随机帖子：基于当前搜索条件加上 order:random
  const handleRandomPosts = useCallback(() => {
    if (!selectedSiteId) {
      message.warning('请先选择站点');
      return;
    }
    console.log('[BooruPage] 随机帖子');
    // 在当前标签基础上添加 order:random
    const baseTags = isSearchMode && searchQuery.trim()
      ? searchQuery.trim().replace(/\border:random\b/g, '').trim()
      : '';
    const randomQuery = baseTags ? `${baseTags} order:random` : 'order:random';
    setSearchQuery(randomQuery);
    searchPosts(randomQuery, 1);
  }, [selectedSiteId, isSearchMode, searchQuery]);

  // 处理收藏切换（委托给 useFavorite Hook）
  const handleToggleFavorite = useCallback(async (post: BooruPost) => {
    const result = await toggleFavorite(post);
    if (!result.success) {
      message.error('操作失败');
    }
  }, [toggleFavorite, message]);

  // 处理下载（silent 时不弹单张成功 toast，供批量下载汇总提示使用）
  const handleDownload = useCallback(async (post: BooruPost, silent?: boolean) => {
    console.log('[BooruPage] 下载图片:', post.postId);
    try {
      if (!window.electronAPI || !selectedSiteId) return;

      const result = await window.electronAPI.booru.addToDownload(post.postId, selectedSiteId);
      if (result.success) {
        console.log('[BooruPage] 已添加到下载队列:', result.data);
        if (!silent) message.success('已添加到下载队列');
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
    if (selectionMode) {
      setSelectedPostIds((current) => toggleSelectedPost(current, post.postId));
      return;
    }
    setSelectedPost(post);
    setDetailsPageOpen(true);
  }, [selectionMode]);

  // 按 ID 倒序排序（最新的在前），用于 BooruGridLayout 和 BooruPostDetailsPage
  const sortedPosts = useMemo(() => {
    return [...posts].sort((a, b) => b.postId - a.postId);
  }, [posts]);

  // 预解析每个帖子的标签数组，避免在多个 useMemo 中重复 split
  const parsedPostTags = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const post of sortedPosts) {
      map.set(post.postId, post.tags ? post.tags.split(' ').filter(Boolean) : []);
    }
    return map;
  }, [sortedPosts]);

  // 将黑名单标签数组转为 Set，O(1) 查找替代 O(n)
  const blacklistTagSet = useMemo(() => new Set(blacklistTagNames), [blacklistTagNames]);

  // 统计当前页面中每个黑名单标签命中的图片数量
  const blacklistHitStats = useMemo(() => {
    if (!blacklistTagSet.size) return new Map<string, number>();
    const hitMap = new Map<string, number>();
    const ratingFiltered = ratingFilter !== 'all'
      ? sortedPosts.filter(post => post.rating === ratingFilter)
      : sortedPosts;
    for (const post of ratingFiltered) {
      const postTags = parsedPostTags.get(post.postId) || [];
      for (const tag of postTags) {
        if (blacklistTagSet.has(tag)) {
          hitMap.set(tag, (hitMap.get(tag) || 0) + 1);
        }
      }
    }
    return hitMap;
  }, [sortedPosts, parsedPostTags, ratingFilter, blacklistTagSet]);

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
          const postTags = parsedPostTags.get(post.postId) || [];
          return !postTags.some(tag => blacklistSet.has(tag));
        });
        const hiddenCount = beforeCount - result.length;
        if (hiddenCount > 0) {
          console.log(`[BooruPage] 黑名单过滤: 隐藏 ${hiddenCount} 张图片`);
        }
      }
    }

    return result;
  }, [sortedPosts, parsedPostTags, ratingFilter, blacklistEnabled, blacklistTagNames, disabledBlacklistTags]);

  // 相关标签推荐：从当前帖子标签中统计高频标签（排除已搜索的标签）
  const relatedTags = useMemo(() => {
    if (posts.length === 0) return [];
    const searchTags = new Set(selectedTags.map(t => t.toLowerCase()));
    // 排除常见的 meta 标签和搜索关键词
    const excludeTags = new Set([...searchTags, 'order:random', 'highres', 'absurdres', 'commentary_request', 'tagme']);
    const tagCount = new Map<string, number>();
    for (const post of posts) {
      const postTags = parsedPostTags.get(post.postId) || [];
      for (const tag of postTags) {
        if (tag && !excludeTags.has(tag.toLowerCase())) {
          tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
        }
      }
    }
    // 按出现频率排序，取前 15 个
    return Array.from(tagCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([tag, count]) => ({ tag, count }));
  }, [posts, parsedPostTags, selectedTags]);

  const selectedPosts = useMemo(() => posts.filter((post) => selectedPostIds.has(post.postId)), [posts, selectedPostIds]);
  const commonSelectedTags = useMemo(() => getCommonPostTags(selectedPosts), [selectedPosts]);

  const handleBatchFavorite = useCallback(async () => {
    if (!selectedSiteId || selectedPosts.length === 0) return;
    const key = 'booru-batch-favorite';
    batchFavoriteInProgressRef.current = true;
    let added = 0;
    try {
      const targets = selectedPosts.filter(post => !favorites.has(post.postId) && !post.isFavorited);
      for (let i = 0; i < targets.length; i++) {
        // 同 key 更新进度提示，避免逐张弹 toast 风暴
        message.open({ key, type: 'loading', content: `正在批量收藏 ${i + 1}/${targets.length}`, duration: 0 });
        const result = await toggleFavorite(targets[i]);
        if (result.success) added += 1;
      }
    } finally {
      batchFavoriteInProgressRef.current = false;
    }
    message.open({ key, type: 'success', content: `已处理 ${added} 张图片的收藏`, duration: 2 });
  }, [selectedSiteId, selectedPosts, favorites, toggleFavorite, message]);

  const handleBatchDownload = useCallback(async () => {
    if (!selectedSiteId || selectedPosts.length === 0) return;
    const key = 'booru-batch-download';
    const total = selectedPosts.length;
    for (let i = 0; i < total; i++) {
      // 同 key 更新进度提示，单张静默加入队列
      message.open({ key, type: 'loading', content: `正在加入下载队列 ${i + 1}/${total}`, duration: 0 });
      await handleDownload(selectedPosts[i], true);
    }
    message.open({ key, type: 'success', content: `已将 ${total} 张图片加入下载队列`, duration: 2 });
  }, [selectedSiteId, selectedPosts, handleDownload, message]);

  const handleAppendSelectedTag = useCallback((tag: string) => {
    const nextTags = Array.from(new Set([...selectedTags, tag]));
    const nextQuery = nextTags.join(' ');
    setSelectedTags(nextTags);
    setSearchQuery(nextQuery);
    searchPosts(nextQuery, 1);
  }, [selectedTags]);

  // 初始化
  useEffect(() => {
    console.log('[BooruPage] 初始化页面');
    loadAppearanceConfig();
    loadSites();
  }, []);

  // 监听配置变更事件（事件驱动，替代轮询）
  useEffect(() => {
    if (!window.electronAPI?.booruPreferences?.appearance?.onChanged) return;
    const unsubscribe = window.electronAPI.booruPreferences.appearance.onChanged((appearance) => {
      console.log('[BooruPage] 收到配置变更事件');
      setAppearanceConfig(appearance);
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
  const displayPage = pendingPage ?? currentPage;
  const paginationCount = loading ? appearanceConfig.itemsPerPage : posts.length;
  const showPagination = posts.length > 0 || (loading && pendingPage !== null);

  const handlePreviousPage = () => {
    if (loading || paginationRequestInFlightRef.current) return;
    const next = Math.max(1, currentPage - 1);
    isSearchMode ? searchPosts(searchQuery, next, undefined, 'pagination') : loadPosts(next, 'pagination');
  };

  const handleNextPage = () => {
    if (loading || paginationRequestInFlightRef.current) return;
    const next = currentPage + 1;
    isSearchMode ? searchPosts(searchQuery, next, undefined, 'pagination') : loadPosts(next, 'pagination');
  };

  const handlePageChange = (page: number) => {
    if (loading || paginationRequestInFlightRef.current) return;
    isSearchMode ? searchPosts(searchQuery, page, undefined, 'pagination') : loadPosts(page, 'pagination');
  };

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
        offsetTop={appearanceConfig.margin}
        onSiteChange={handleSiteChange}
        onRatingChange={(rating) => {
          console.log('[BooruPage] 分级筛选改变:', rating);
          // 评级过滤是纯前端筛选（filteredSortedPosts），无需重新请求，保留当前页码
          setRatingFilter(rating);
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
        extraActions={
          <>
            <AdvancedFilterPanel
              filterConfig={filterConfig}
              onFilterChange={(config) => {
                setFilterConfig(config);
                // 过滤条件变化后自动重新搜索（传入新配置避免状态延迟）
                if (isSearchMode && searchQuery.trim()) {
                  searchPosts(searchQuery, 1, config);
                }
              }}
              disabled={!selectedSiteId || loading}
            />
            <Tooltip title="随机浏览">
              <Button
                icon={<ThunderboltOutlined />}
                onClick={handleRandomPosts}
                disabled={!selectedSiteId || loading}
              />
            </Tooltip>
            <Tooltip title={selectionMode ? '退出多选' : '进入多选'}>
              <Button
                icon={<CheckSquareOutlined />}
                type={selectionMode ? 'primary' : 'default'}
                onClick={() => {
                  setSelectionMode((value) => !value);
                  setSelectedPostIds(new Set());
                }}
                disabled={!posts.length}
              />
            </Tooltip>
          </>
        }
      />

      {selectionMode && (
        <div style={{ padding: '8px 12px', marginBottom: 8, background: colors.successBg, borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: selectedPosts.length > 0 ? 8 : 0 }}>
            <span style={{ fontSize: 13, color: colors.textSecondary }}>已选择 {selectedPosts.length} 张图片</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button
                size="small"
                onClick={() => setSelectedPostIds(new Set(filteredSortedPosts.map(p => p.postId)))}
                disabled={filteredSortedPosts.length === 0}
              >
                全选本页
              </Button>
              <Button size="small" onClick={handleBatchFavorite} disabled={selectedPosts.length === 0}>批量收藏</Button>
              <Button size="small" onClick={handleBatchDownload} disabled={selectedPosts.length === 0}>批量下载</Button>
              <Button size="small" onClick={() => setSelectedPostIds(new Set())} disabled={selectedPosts.length === 0}>清空选择</Button>
            </div>
          </div>
          {commonSelectedTags.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ color: colors.textTertiary, fontSize: 12 }}>共同标签:</span>
              {commonSelectedTags.slice(0, 12).map((tag) => (
                <Tag key={tag} style={{ cursor: 'pointer', marginBottom: 0 }} onClick={() => handleAppendSelectedTag(tag)}>
                  {tag}
                </Tag>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 相关标签推荐 — 在搜索模式下显示当前结果中的高频标签 */}
      {isSearchMode && relatedTags.length > 0 && (
        <div style={{
          padding: '6px 12px',
          marginBottom: 8,
          background: colors.primaryBg,
          borderRadius: 8,
          fontSize: 12,
        }}>
          <span style={{ color: colors.textTertiary, marginRight: 8 }}>相关标签:</span>
          {relatedTags.map(({ tag, count }) => (
            <Tag
              key={tag}
              style={{ cursor: 'pointer', marginBottom: 2 }}
              onClick={() => handleTagClick(tag)}
            >
              {tag} <span style={{ color: colors.textQuaternary }}>{count}</span>
            </Tag>
          ))}
        </div>
      )}

      {/* 黑名单过滤提示 - 按标签显示命中情况，支持按标签取消隐藏 */}
      {blacklistEnabled && blacklistHitStats.size > 0 && (
        <div style={{
          padding: '8px 12px',
          marginBottom: 8,
          background: colors.dangerBg,
          borderRadius: 8,
          fontSize: 12,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ color: colors.danger }}>
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
                      background: isDisabled ? colors.bgGray : colors.dangerBg,
                      color: isDisabled ? colors.textTertiary : colors.danger,
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
          background: colors.warningBg,
          borderRadius: 8,
          fontSize: 12,
          color: colors.warning,
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
        {loading && showPagination && (
          <PaginationControl
            currentPage={displayPage}
            currentCount={paginationCount}
            itemsPerPage={appearanceConfig.itemsPerPage}
            paginationPosition={appearanceConfig.paginationPosition}
            position="top"
            disabled
            onPrevious={handlePreviousPage}
            onNext={handleNextPage}
            onPageChange={handlePageChange}
          />
        )}

        {loading && (
          <SkeletonGrid count={appearanceConfig.itemsPerPage} cardWidth={appearanceConfig.gridSize} gap={appearanceConfig.spacing} />
        )}

        {loading && showPagination && (
          <PaginationControl
            currentPage={displayPage}
            currentCount={paginationCount}
            itemsPerPage={appearanceConfig.itemsPerPage}
            paginationPosition={appearanceConfig.paginationPosition}
            position="bottom"
            disabled
            onPrevious={handlePreviousPage}
            onNext={handleNextPage}
            onPageChange={handlePageChange}
          />
        )}

        {/* 空态分流：未配置站点 / 搜索无结果 / 普通空页 */}
        {!loading && posts.length === 0 && (
          sites.length === 0 ? (
            <Empty
              description="尚未配置 Booru 站点，请先到 Booru → 站点配置 添加站点"
              style={{ marginTop: '100px' }}
            />
          ) : (
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
          )
        )}

        {!loading && posts.length > 0 && (
          <>
            <PaginationControl
              currentPage={currentPage}
              currentCount={posts.length}
              itemsPerPage={appearanceConfig.itemsPerPage}
              paginationPosition={appearanceConfig.paginationPosition}
              position="top"
              onPrevious={handlePreviousPage}
              onNext={handleNextPage}
              onPageChange={handlePageChange}
            />

            {/* 本页有数据但全部被前端过滤掉时，渲染内联空态而非空白网格 */}
            {filteredSortedPosts.length === 0 ? (
              <Empty
                description="本页图片已全部被评级筛选或黑名单隐藏"
                style={{ margin: '60px 0' }}
              >
                {ratingFilter !== 'all' && (
                  <Button onClick={() => setRatingFilter('all')}>显示全部评级</Button>
                )}
              </Empty>
            ) : (
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
                selectionMode={selectionMode}
                selectedPostIds={selectedPostIds}
                onToggleSelect={(post) => setSelectedPostIds((current) => toggleSelectedPost(current, post.postId))}
              />
            )}

            <PaginationControl
              currentPage={currentPage}
              currentCount={posts.length}
              itemsPerPage={appearanceConfig.itemsPerPage}
              paginationPosition={appearanceConfig.paginationPosition}
              position="bottom"
              onPrevious={handlePreviousPage}
              onNext={handleNextPage}
              onPageChange={handlePageChange}
            />
          </>
        )}
      </div>

      {/* 图片详情页面 - 使用排序后的 posts 数组，确保索引与显示顺序一致 */}
      <BooruPostDetailsPage
        open={detailsPageOpen && !suspended}
        post={selectedPost}
        site={selectedSite || null}
        posts={sortedPosts}
        initialIndex={selectedPost ? sortedPosts.findIndex(p => p.postId === selectedPost.postId) : 0}
        onClose={() => {
          console.log('[BooruPage] 关闭详情页面');
          setDetailsPageOpen(false);
          setSelectedPost(null);
        }}
        onToggleFavorite={handleToggleFavorite}
        onDownload={handleDownload}
        onTagClick={(tag: string) => {
          // 从详情页点击标签 → 打开独立子窗口，避免丢失当前详情页状态
          console.log('[BooruPage] 详情页标签点击，打开子窗口:', tag);
          window.electronAPI?.window.openTagSearch(tag, selectedSiteId);
        }}
        isServerFavorited={(p) => serverFavorites.has(p.postId)}
        onToggleServerFavorite={selectedSite?.username ? handleToggleServerFavorite : undefined}
        onArtistClick={(name: string) => {
          console.log('[BooruPage] 详情页艺术家点击，打开子窗口:', name);
          window.electronAPI?.window.openArtist(name, selectedSiteId);
        }}
        onCharacterClick={(name: string) => {
          console.log('[BooruPage] 详情页角色点击，打开子窗口:', name);
          window.electronAPI?.window.openCharacter(name, selectedSiteId);
        }}
        suspended={suspended}
      />
    </div>
  );
};

export default BooruPage;
