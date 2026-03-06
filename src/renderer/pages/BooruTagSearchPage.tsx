import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Button, Empty, message as antdMessage, Spin, Select, Space, Segmented, Affix, App, Typography } from 'antd';
import { ReloadOutlined, LeftOutlined, DownloadOutlined } from '@ant-design/icons';
import { BooruImageCard } from '../components/BooruImageCard';
import { BooruGridLayout } from '../components/BooruGridLayout';
import { BooruPostDetailsPage } from './BooruPostDetailsPage';
import { BooruPost, BooruSite } from '../../shared/types';
import { getBooruPreviewUrl } from '../utils/url';

const { Title } = Typography;
const { Option } = Select;

interface BooruTagSearchPageProps {
  initialTag: string;
  initialSiteId?: number | null;
  onBack?: () => void;
}

/**
 * Booru 标签搜索页面
 * 专门用于按标签搜索和浏览图片
 * 支持查看详情、收藏、下载等功能
 */
export const BooruTagSearchPage: React.FC<BooruTagSearchPageProps> = ({
  initialTag,
  initialSiteId = null,
  onBack
}) => {
  const { message } = App.useApp();
  const [sites, setSites] = useState<BooruSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(initialSiteId);
  const [posts, setPosts] = useState<BooruPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTag, setSearchTag] = useState(initialTag);
  const [ratingFilter, setRatingFilter] = useState<'all' | 'safe' | 'questionable' | 'explicit'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const [selectedPost, setSelectedPost] = useState<BooruPost | null>(null);
  const [detailsPageOpen, setDetailsPageOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const hasSearchedRef = useRef(false); // 标记是否已经搜索过
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
        await loadFavorites(data);
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

  // 加载收藏状态
  const loadFavorites = async (postsToCheck: BooruPost[]) => {
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
            isFavorited: favoriteIds.has(p.id)
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

  // 处理收藏切换
  const handleToggleFavorite = async (post: BooruPost) => {
    const isCurrentlyFavorited = favorites.has(post.id) || post.isFavorited;
    console.log('[BooruTagSearchPage] 切换收藏状态:', post.id, '当前:', isCurrentlyFavorited);
    try {
      if (!window.electronAPI || !selectedSiteId) return;

      if (isCurrentlyFavorited) {
        const result = await window.electronAPI.booru.removeFavorite(post.id);
        if (result.success) {
          setFavorites(prev => {
            const newSet = new Set(prev);
            newSet.delete(post.id);
            return newSet;
          });
          setPosts(prevPosts => 
            prevPosts.map(p => 
              p.id === post.id ? { ...p, isFavorited: false } : p
            )
          );
          message.success('已取消收藏');
        } else {
          message.error('取消收藏失败: ' + result.error);
        }
      } else {
        const result = await window.electronAPI.booru.addFavorite(post.id, selectedSiteId, false);
        if (result.success) {
          setFavorites(prev => {
            const newSet = new Set(prev);
            newSet.add(post.id);
            return newSet;
          });
          setPosts(prevPosts => 
            prevPosts.map(p => 
              p.id === post.id ? { ...p, isFavorited: true } : p
            )
          );
          message.success('已添加收藏');
        } else {
          message.error('添加收藏失败: ' + result.error);
        }
      }
    } catch (error) {
      console.error('[BooruTagSearchPage] 切换收藏失败:', error);
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
  const ratingOptions = [
    { label: '全部', value: 'all' },
    { label: '安全', value: 'safe' },
    { label: '可疑', value: 'questionable' },
    { label: '明确', value: 'explicit' }
  ];

  return (
    <div ref={contentRef} style={{ padding: appearanceConfig.margin }}>
      {/* 页面标题和返回按钮 */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 16 }}>
        {onBack && (
          <Button icon={<LeftOutlined />} onClick={onBack}>
            返回
          </Button>
        )}
        <Title level={3} style={{ margin: 0 }}>
          标签搜索: {searchTag.replace(/_/g, ' ')}
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
                onClick={() => {
                  if (searchTag) {
                    searchTagPosts(searchTag, currentPage);
                  }
                }}
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
            {/* 顶部分页 */}
            {(appearanceConfig.paginationPosition === 'top' || appearanceConfig.paginationPosition === 'both') && (
              <div style={{ marginBottom: 24, textAlign: 'center' }}>
                <Space>
                  <Button
                    disabled={currentPage <= 1}
                    onClick={() => {
                      const next = Math.max(1, currentPage - 1);
                      searchTagPosts(searchTag, next);
                    }}
                  >
                    上一页
                  </Button>
                  <span>第 {currentPage} 页</span>
                  <Button
                    disabled={posts.length < appearanceConfig.itemsPerPage}
                    onClick={() => {
                      const next = currentPage + 1;
                      searchTagPosts(searchTag, next);
                    }}
                  >
                    下一页
                  </Button>
                </Space>
              </div>
            )}

            <BooruGridLayout
              posts={posts.filter(post => ratingFilter === 'all' || post.rating === ratingFilter)}
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
                    onClick={() => {
                      const next = Math.max(1, currentPage - 1);
                      searchTagPosts(searchTag, next);
                    }}
                  >
                    上一页
                  </Button>
                  <span>第 {currentPage} 页</span>
                  <Button
                    disabled={posts.length < appearanceConfig.itemsPerPage}
                    onClick={() => {
                      const next = currentPage + 1;
                      searchTagPosts(searchTag, next);
                    }}
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

// BooruGridLayout 已提取到 src/renderer/components/BooruGridLayout.tsx

