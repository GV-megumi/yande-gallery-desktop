import React, { useState, useEffect, useRef } from 'react';
import { Button, Empty, message as antdMessage, Spin, Select, Input, Tag, Space, Segmented, Affix, App } from 'antd';
import { ReloadOutlined, SearchOutlined, HeartOutlined, DownloadOutlined } from '@ant-design/icons';
import { BooruImageCard } from '../components/BooruImageCard';
import { BooruPost, BooruSite } from '../../shared/types';

const { Search } = Input;
const { Option } = Select;

interface BooruPageProps {}

export const BooruPage: React.FC<BooruPageProps> = () => {
  const { message } = App.useApp();
  const [sites, setSites] = useState<BooruSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);
  const [posts, setPosts] = useState<BooruPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [ratingFilter, setRatingFilter] = useState<'all' | 'safe' | 'questionable' | 'explicit'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const contentRef = useRef<HTMLDivElement>(null);
  const [appearanceConfig, setAppearanceConfig] = useState({
    gridSize: 220,
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
            gridSize: 220,
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

  // 加载当前页面图片的收藏状态
  const loadFavorites = async (currentPosts: BooruPost[]) => {
    console.log('[BooruPage] 加载收藏状态，图片数量:', currentPosts.length);
    try {
      if (!window.electronAPI || currentPosts.length === 0) {
        setFavorites(new Set());
        return;
      }

      // 从当前图片列表中提取已收藏的图片ID
      const favoriteIds = new Set<number>();
      currentPosts.forEach(post => {
        if (post.isFavorited) {
          favoriteIds.add(post.id);
        }
      });
      
      console.log('[BooruPage] 收藏状态加载成功:', favoriteIds.size, '个收藏, IDs:', Array.from(favoriteIds));
      setFavorites(favoriteIds);
    } catch (error) {
      console.error('[BooruPage] 加载收藏状态失败:', error);
      setFavorites(new Set());
    }
  };

  // 从Booru站点加载图片
  const loadPosts = async (page: number = 1) => {
    if (!selectedSiteId) return;

    const site = sites.find(s => s.id === selectedSiteId);
    if (!site) return;

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
      if (result.success) {
        const data = result.data || [];
        console.log('[BooruPage] 图片加载成功:', data.length, '张图片, 配置每页数量:', appearanceConfig.itemsPerPage);
        setPosts(data);
        setCurrentPage(page);
        setHasMore(data.length >= appearanceConfig.itemsPerPage);

        // 加载收藏状态（从当前图片数据中提取）
        await loadFavorites(data);
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

      const result = await window.electronAPI.booru.searchPosts(selectedSiteId, query.split(' ').filter(t => t.trim()), page, appearanceConfig.itemsPerPage);
      if (result.success) {
        const data = result.data || [];
        console.log('[BooruPage] 搜索成功:', data.length, '张图片, 配置每页数量:', appearanceConfig.itemsPerPage);
        setPosts(data);
        setCurrentPage(page);
        setHasMore(data.length >= appearanceConfig.itemsPerPage);

        // 加载收藏状态（从当前图片数据中提取）
        await loadFavorites(data);
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

  // 处理收藏切换
  const handleToggleFavorite = async (post: BooruPost) => {
    const isCurrentlyFavorited = favorites.has(post.id) || post.isFavorited;
    console.log('[BooruPage] 切换收藏状态:', post.id, '当前:', isCurrentlyFavorited);
    try {
      if (!window.electronAPI || !selectedSiteId) return;

      if (isCurrentlyFavorited) {
        // 取消收藏
        const result = await window.electronAPI.booru.removeFavorite(post.id);
        if (result.success) {
          console.log('[BooruPage] 取消收藏成功:', post.id);
          // 更新本地状态
          setFavorites(prev => {
            const newSet = new Set(prev);
            newSet.delete(post.id);
            return newSet;
          });
          // 更新图片数据中的收藏状态
          setPosts(prevPosts => 
            prevPosts.map(p => 
              p.id === post.id ? { ...p, isFavorited: false } : p
            )
          );
          message.success('已取消收藏');
        } else {
          console.error('[BooruPage] 取消收藏失败:', result.error);
          message.error('取消收藏失败: ' + result.error);
        }
      } else {
        // 添加收藏
        const result = await window.electronAPI.booru.addFavorite(post.id, selectedSiteId, false);
        if (result.success) {
          console.log('[BooruPage] 添加收藏成功:', post.id);
          // 更新本地状态
          setFavorites(prev => {
            const newSet = new Set(prev);
            newSet.add(post.id);
            return newSet;
          });
          // 更新图片数据中的收藏状态
          setPosts(prevPosts => 
            prevPosts.map(p => 
              p.id === post.id ? { ...p, isFavorited: true } : p
            )
          );
          message.success('已添加收藏');
        } else {
          console.error('[BooruPage] 添加收藏失败:', result.error);
          message.error('添加收藏失败: ' + result.error);
        }
      }
    } catch (error) {
      console.error('[BooruPage] 切换收藏失败:', error);
      message.error('操作失败');
    }
  };

  // 处理下载
  const handleDownload = async (post: BooruPost) => {
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
  };

  // 处理标签点击
  const handleTagClick = (tag: string) => {
    console.log('[BooruPage] 点击标签:', tag);
    const newTags = [...selectedTags, tag];
    setSelectedTags(newTags);
    const query = newTags.join(' ');
    setSearchQuery(query);
    searchPosts(query, 1);
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
  const handlePreview = (post: BooruPost) => {
    console.log('[BooruPage] 预览图片:', post.postId);
    message.info('预览功能开发中...');
  };

  // 初始化
  useEffect(() => {
    console.log('[BooruPage] 初始化页面');
    loadAppearanceConfig();
    loadSites();
  }, []);

  // 监听配置变化，重新加载配置
  useEffect(() => {
    const interval = setInterval(async () => {
      await loadAppearanceConfig();
    }, 2000); // 每2秒检查一次配置更新

    return () => clearInterval(interval);
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
  }, [appearanceConfig.itemsPerPage, selectedSiteId]);

  // 站点切换时重新加载图片
  useEffect(() => {
    if (selectedSiteId) {
      console.log('[BooruPage] 站点改变，重新加载图片');
      loadPosts(1);
    }
  }, [selectedSiteId]);

  const selectedSite = selectedSiteId ? sites.find(s => s.id === selectedSiteId) : null;
  const ratingOptions = [
    { label: '全部', value: 'all' },
    { label: '安全', value: 'safe' },
    { label: '存疑', value: 'questionable' },
    { label: '限制级', value: 'explicit' }
  ];

  // 根据预览质量获取图片URL
  const getPreviewUrl = (post: BooruPost): string => {
    // 优先检查是否有本地路径（已下载的图片）
    if (post.localPath) {
      // 将本地路径转换为 app:// 协议
      // localPath 格式可能是: M:\booru\mignon2\1237041_9d03c2a8.png
      // 需要转换为: app://m/booru/mignon2/1237041_9d03c2a8.png
      try {
        let appUrl = post.localPath;
        // Windows 路径处理: M:\path\to\file.png -> app://m/path/to/file.png
        if (appUrl.match(/^[A-Z]:\\/)) {
          // Windows 路径格式
          const driveLetter = appUrl[0].toLowerCase();
          const pathPart = appUrl.substring(3).replace(/\\/g, '/');
          appUrl = `app://${driveLetter}/${pathPart}`;
        } else if (appUrl.startsWith('/')) {
          // Unix 路径: /path/to/file.png -> app:///path/to/file.png
          appUrl = `app://${appUrl}`;
        } else if (appUrl.startsWith('app://')) {
          // 已经是 app:// 协议，直接使用
          // 不需要转换
        } else {
          // 其他格式，尝试直接添加 app://
          appUrl = `app://${appUrl.replace(/\\/g, '/')}`;
        }
        console.log('[BooruPage] 使用本地图片路径:', appUrl);
        return appUrl;
      } catch (e) {
        console.warn('[BooruPage] 本地路径转换失败，使用远程URL:', e);
      }
    }
    
    // 确保总是返回有效的URL
    const quality = appearanceConfig.previewQuality;
    let url = '';
    
    // 优先使用 preview_url，因为它使用基于 MD5 的简单路径格式，更可靠
    // preview_url 格式: https://assets.yande.re/data/preview/40/59/40591ededcfa8326ea31afc563bb0e72.jpg
    // 这种格式不包含标签，更稳定
    
    // URL 选择策略（参考 Boorusama）：
    // Boorusama 使用：
    // - thumbnailImageUrl = previewUrl（缩略图，最可靠）
    // - largeImageUrl = jpegUrl（JPEG 大图）
    // - sampleImageUrl = sampleUrl（样本图）
    // - originalImageUrl = fileUrl（原图）
    // 
    // 但 yande.re 的 file_url 和 jpeg_url 可能返回 307 重定向（包含标签的文件名格式已失效）
    // 所以优先使用 preview_url 和 sample_url（它们使用基于 MD5 的简单路径，不包含标签）
    
    // 参考 Boorusama 的 DefaultMediaUrlResolver 逻辑：
    // - preview -> thumbnailImageUrl (previewUrl)
    // - sample -> sampleImageUrl (sampleUrl)
    // - original -> originalImageUrl (fileUrl)
    //
    // 但由于 yande.re 的 file_url、sample_url、jpeg_url 都包含标签且可能返回 307 重定向
    // 而 preview_url 使用基于 MD5 的简单路径格式，不包含标签，最可靠
    // 因此，我们需要在检测到 URL 包含标签时，自动回退到 previewUrl
    
    if (quality === 'original') {
      // 最高质量：使用 originalImageUrl (fileUrl)
      url = post.fileUrl || post.sampleUrl || post.previewUrl || '';
    } else if (quality === 'high') {
      // 高质量：使用 sampleImageUrl (sampleUrl)
      url = post.sampleUrl || post.previewUrl || '';
    } else if (quality === 'medium') {
      // 中等质量：使用 sampleImageUrl (sampleUrl)
      url = post.sampleUrl || post.previewUrl || '';
    } else if (quality === 'low') {
      // 低质量：使用 thumbnailImageUrl (previewUrl)
      url = post.previewUrl || '';
    } else {
      // auto: 使用 sampleImageUrl (sampleUrl)，如果没有则使用 previewUrl
      url = post.sampleUrl || post.previewUrl || '';
    }
    
    // 如果 URL 包含标签（可能返回 307），自动回退到 previewUrl
    // previewUrl 使用基于 MD5 的简单路径格式，不包含标签，最可靠
    if (url && (url.includes('%20') || url.includes('yande.re%20'))) {
      console.warn('[BooruPage] URL 包含标签，可能返回 307 重定向，回退到 previewUrl:', url.substring(0, 100));
      if (post.previewUrl) {
        console.log('[BooruPage] 使用 previewUrl:', post.previewUrl.substring(0, 100));
        url = post.previewUrl;
      } else {
        console.error('[BooruPage] 没有可用的 previewUrl，URL 可能无法加载');
      }
    }
    
    if (!url || !url.trim()) {
      console.error('[BooruPage] 无法获取图片URL:', {
        postId: post.postId,
        quality,
        fileUrl: post.fileUrl,
        sampleUrl: post.sampleUrl,
        previewUrl: post.previewUrl,
        localPath: post.localPath
      });
    } else {
      console.log('[BooruPage] 获取图片URL成功:', {
        postId: post.postId,
        quality,
        url: url.substring(0, 100) + '...',
        hasLocalPath: !!post.localPath
      });
    }
    
    return url;
  };

  return (
    <div ref={contentRef} style={{ padding: `${appearanceConfig.margin}px` }}>
      {/* 顶部控制栏 - 使用 Affix 固定在顶部 */}
      <Affix offsetTop={24}>
        <div style={{
          background: '#fff',
          padding: '16px',
          borderRadius: '8px',
          marginBottom: '24px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          zIndex: 10
        }}>
          <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
            {/* 站点选择 */}
            <Space wrap>
              <span>站点:</span>
              <Select
                value={selectedSiteId || undefined}
                onChange={handleSiteChange}
                style={{ width: 180 }}
                placeholder="选择Booru站点"
                disabled={loading}
              >
                {sites.map(site => (
                  <Option key={site.id} value={site.id}>
                    {site.name}
                  </Option>
                ))}
              </Select>
            </Space>

            {/* 搜索框 */}
            <Search
              placeholder="输入标签搜索 (使用空格分隔多个标签)"
              allowClear
              enterButton={<SearchOutlined />}
              style={{ width: 400 }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onSearch={handleSearch}
              disabled={!selectedSiteId || loading}
            />

            {/* 分级筛选 */}
            <Space wrap>
              <span>分级:</span>
              <Segmented
                value={ratingFilter}
                onChange={(value) => {
                  console.log('[BooruPage] 分级筛选改变:', value);
                  setRatingFilter(value as any);
                  // 重新加载当前内容
                  if (isSearchMode) {
                    searchPosts(searchQuery, 1);
                  } else {
                    loadPosts(1);
                  }
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
                  console.log('[BooruPage] 刷新页面');
                  if (isSearchMode) {
                    searchPosts(searchQuery, 1);
                  } else {
                    loadPosts(1);
                  }
                }}
                loading={loading}
                disabled={!selectedSiteId}
              >
                刷新
              </Button>
            </Space>
          </Space>

          {/* 已选标签显示 */}
          {selectedTags.length > 0 && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #f0f0f0' }}>
              <Space wrap>
                <span style={{ fontSize: 12, color: '#666' }}>已选标签:</span>
                {selectedTags.map(tag => (
                  <Tag
                    key={tag}
                    closable
                    onClose={() => handleRemoveTag(tag)}
                    style={{ fontSize: 12 }}
                  >
                    {tag}
                  </Tag>
                ))}
              </Space>
            </div>
          )}
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
            {/* 顶部分页（如果配置为 top 或 both） */}
            {(appearanceConfig.paginationPosition === 'top' || appearanceConfig.paginationPosition === 'both') && (
              <div style={{ marginBottom: 24, textAlign: 'center' }}>
                <Space>
                  <Button
                    disabled={currentPage <= 1}
                    onClick={() => {
                      const next = Math.max(1, currentPage - 1);
                      if (isSearchMode) {
                        searchPosts(searchQuery, next);
                      } else {
                        loadPosts(next);
                      }
                    }}
                  >
                    上一页
                  </Button>
                  <span>第 {currentPage} 页</span>
                  <Button
                    disabled={posts.length < appearanceConfig.itemsPerPage}
                    onClick={() => {
                      const next = currentPage + 1;
                      if (isSearchMode) {
                        searchPosts(searchQuery, next);
                      } else {
                        loadPosts(next);
                      }
                    }}
                  >
                    下一页
                  </Button>
                </Space>
              </div>
            )}

            <div style={{
              columnWidth: appearanceConfig.gridSize,
              columnGap: appearanceConfig.spacing
            }}>
              {posts.map(post => {
                // 根据分级筛选
                if (ratingFilter !== 'all' && post.rating !== ratingFilter) {
                  return null;
                }

                return (
                  <div 
                    key={post.id} 
                    style={{ 
                      breakInside: 'avoid', 
                      marginBottom: appearanceConfig.spacing,
                      borderRadius: `${appearanceConfig.borderRadius}px`,
                      overflow: 'hidden'
                    }}
                  >
                    <BooruImageCard
                      post={post}
                      siteName={selectedSite?.name || ''}
                      onPreview={handlePreview}
                      onDownload={handleDownload}
                      onToggleFavorite={handleToggleFavorite}
                      isFavorited={favorites.has(post.id) || post.isFavorited}
                      previewUrl={getPreviewUrl(post)}
                    />
                  </div>
                );
              })}
            </div>

            {/* 底部分页（如果配置为 bottom 或 both） */}
            {(appearanceConfig.paginationPosition === 'bottom' || appearanceConfig.paginationPosition === 'both') && (
              <div style={{ marginTop: 24, textAlign: 'center' }}>
                <Space>
                  <Button
                    disabled={currentPage <= 1}
                    onClick={() => {
                      const next = Math.max(1, currentPage - 1);
                      if (isSearchMode) {
                        searchPosts(searchQuery, next);
                      } else {
                        loadPosts(next);
                      }
                    }}
                  >
                    上一页
                  </Button>
                  <span>第 {currentPage} 页</span>
                  <Button
                    disabled={posts.length < appearanceConfig.itemsPerPage}
                    onClick={() => {
                      const next = currentPage + 1;
                      if (isSearchMode) {
                        searchPosts(searchQuery, next);
                      } else {
                        loadPosts(next);
                      }
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
    </div>
  );
};

export default BooruPage;
