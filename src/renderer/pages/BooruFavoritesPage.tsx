import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Button, Empty, App, Typography, notification, Input, Modal, Popconfirm } from 'antd';
import { BookOutlined, PlusOutlined, EditOutlined, DeleteOutlined, FolderOutlined } from '@ant-design/icons';
import { BooruGridLayout } from '../components/BooruGridLayout';
import { BooruPageToolbar, RatingFilter } from '../components/BooruPageToolbar';
import { PaginationControl } from '../components/PaginationControl';
import { SkeletonGrid } from '../components/SkeletonGrid';
import { BooruPostDetailsPage } from './BooruPostDetailsPage';
import { BooruPost, BooruSite } from '../../shared/types';
import { getBooruPreviewUrl } from '../utils/url';
import { spacing } from '../styles/tokens';
import { useFavorite } from '../hooks/useFavorite';

const { Title } = Typography;

interface BooruFavoritesPageProps {
  onTagClick?: (tag: string, siteId?: number | null) => void;
  /** 当叠加页面激活时为 true，抑制详情弹窗显示 */
  suspended?: boolean;
}

/**
 * Booru 收藏页面
 * 展示、管理和下载收藏的图片
 */
export const BooruFavoritesPage: React.FC<BooruFavoritesPageProps> = ({
  onTagClick,
  suspended = false
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

  // 收藏夹分组状态
  const [groups, setGroups] = useState<any[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | 'all' | 'ungrouped'>('all');
  const [groupModalVisible, setGroupModalVisible] = useState(false);
  const [editingGroup, setEditingGroup] = useState<any | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [groupColor, setGroupColor] = useState('#1677ff');

  // 用 ref 持有最新的 posts 长度，避免 onSuccess 回调中的闭包过期
  const postsLengthRef = useRef(posts.length);
  postsLengthRef.current = posts.length;

  // 收藏状态管理（在收藏页面中，取消收藏会从列表移除）
  const { favorites, setFavorites, toggleFavorite } = useFavorite({
    siteId: selectedSiteId,
    onSuccess: (postId, isFavorited) => {
      if (!isFavorited) {
        // 取消收藏：从列表中移除
        setPosts(prevPosts => prevPosts.filter(p => p.postId !== postId));
        message.success('已取消收藏');
        // 如果当前页没有图片了，加载上一页（使用 ref 避免闭包过期）
        if (postsLengthRef.current === 1 && currentPage > 1) {
          loadFavorites(currentPage - 1);
        }
      }
    },
    logPrefix: '[BooruFavoritesPage]'
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
      console.error('[BooruFavoritesPage] 切换喜欢失败:', error);
      message.error('操作失败');
    }
  }, [selectedSiteId, serverFavorites]);

  // 加载外观配置
  const loadAppearanceConfig = async () => {
    console.log('[BooruFavoritesPage] 加载外观配置');
    try {
      if (!window.electronAPI?.booruPreferences?.appearance) {
        console.error('[BooruFavoritesPage] electronAPI is not available');
        return;
      }

      const result = await window.electronAPI.booruPreferences.appearance.get();
      if (result.success && result.data) {
        console.log('[BooruFavoritesPage] 加载外观配置成功:', result.data);
        setAppearanceConfig(result.data);
      }
    } catch (error) {
      console.error('[BooruFavoritesPage] 加载外观配置失败:', error);
    }
  };

  // 加载站点列表
  const loadSites = async () => {
    console.log('[BooruFavoritesPage] 加载站点列表');
    try {
      if (!window.electronAPI) {
        console.error('[BooruFavoritesPage] electronAPI is not available');
        return;
      }

      const result = await window.electronAPI.booru.getSites();
      if (result.success && result.data) {
        console.log('[BooruFavoritesPage] 加载站点列表成功:', result.data.length, '个站点');
        setSites(result.data);
        
        if (result.data.length > 0) {
          setSelectedSiteId(result.data[0].id);
        }
      } else {
        console.error('[BooruFavoritesPage] 加载站点列表失败:', result.error);
      }
    } catch (error) {
      console.error('[BooruFavoritesPage] 加载站点列表异常:', error);
    }
  };

  // 加载收藏夹分组
  const loadGroups = useCallback(async () => {
    if (!selectedSiteId) return;
    try {
      const result = await window.electronAPI.booru.getFavoriteGroups(selectedSiteId);
      if (result.success) {
        setGroups(result.data || []);
      }
    } catch (error) {
      console.error('[BooruFavoritesPage] 加载分组失败:', error);
    }
  }, [selectedSiteId]);

  // 创建/更新分组
  const handleSaveGroup = async () => {
    if (!newGroupName.trim()) return;
    try {
      if (editingGroup) {
        await window.electronAPI.booru.updateFavoriteGroup(editingGroup.id, { name: newGroupName.trim(), color: groupColor });
        message.success('分组已更新');
      } else {
        await window.electronAPI.booru.createFavoriteGroup(newGroupName.trim(), selectedSiteId || undefined, groupColor);
        message.success('分组已创建');
      }
      setGroupModalVisible(false);
      setEditingGroup(null);
      setNewGroupName('');
      loadGroups();
    } catch (error) {
      message.error('操作失败');
    }
  };

  // 删除分组
  const handleDeleteGroup = async (groupId: number) => {
    try {
      await window.electronAPI.booru.deleteFavoriteGroup(groupId);
      message.success('分组已删除');
      if (selectedGroupId === groupId) setSelectedGroupId('all');
      loadGroups();
      loadFavorites(1);
    } catch (error) {
      message.error('删除失败');
    }
  };

  // 加载收藏列表
  const loadFavorites = async (page: number = 1) => {
    if (!selectedSiteId) {
      message.warning('请先选择站点');
      return;
    }

    // 计算 groupId 参数
    const groupIdParam = selectedGroupId === 'all' ? undefined
      : selectedGroupId === 'ungrouped' ? null
      : selectedGroupId;

    console.log(`[BooruFavoritesPage] 加载收藏列表，站点: ${selectedSiteId}, 页码: ${page}, 分组: ${selectedGroupId}`);
    setLoading(true);

    try {
      if (!window.electronAPI) {
        setLoading(false);
        return;
      }

      const result = await window.electronAPI.booru.getFavorites(selectedSiteId, page, appearanceConfig.itemsPerPage, groupIdParam);
      if (result.success) {
        const data = result.data || [];
        console.log('[BooruFavoritesPage] 加载收藏成功:', data.length, '张图片');

        setPosts(data);
        setCurrentPage(page);
        setHasMore(data.length >= appearanceConfig.itemsPerPage);

        // 所有收藏的图片都是已收藏状态
        const favoriteIds = new Set(data.map(p => p.id));
        setFavorites(favoriteIds);

      } else {
        console.error('[BooruFavoritesPage] 加载收藏失败:', result.error);
        message.error('加载收藏失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BooruFavoritesPage] 加载收藏失败:', error);
      message.error('加载收藏失败');
    } finally {
      setLoading(false);
    }
  };

  // 处理站点切换
  const handleSiteChange = (siteId: number) => {
    console.log('[BooruFavoritesPage] 切换站点:', siteId);
    setSelectedSiteId(siteId);
    setPosts([]);
    setCurrentPage(1);
    setHasMore(true);
    loadFavorites(1);
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
    console.log('[BooruFavoritesPage] 下载图片:', post.postId);
    try {
      if (!window.electronAPI || !selectedSiteId) return;

      const result = await window.electronAPI.booru.addToDownload(post.postId, selectedSiteId);
      if (result.success) {
        message.success('已添加到下载队列');
      } else {
        message.error('下载失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BooruFavoritesPage] 下载失败:', error);
      message.error('下载失败');
    }
  };

  // 处理标签点击（导航到标签搜索页面）
  const handleTagClick = (tag: string) => {
    console.log('[BooruFavoritesPage] 点击标签:', tag);
    if (onTagClick) {
      onTagClick(tag, selectedSiteId);
    } else {
      message.info('点击标签功能需要从父组件传递导航函数');
    }
  };

  // 处理图片预览
  const handlePreview = (post: BooruPost) => {
    console.log('[BooruFavoritesPage] 预览图片:', post.postId);
    setSelectedPost(post);
    setDetailsPageOpen(true);
  };

  // 获取预览URL（委托给统一的 url 工具函数）
  const getPreviewUrl = (post: BooruPost): string => {
    return getBooruPreviewUrl(post, appearanceConfig.previewQuality);
  };

  // 初始化
  useEffect(() => {
    console.log('[BooruFavoritesPage] 初始化页面');
    loadAppearanceConfig();
    loadSites();
  }, []);

  // 监听后台收藏修复完成事件
  useEffect(() => {
    if (!window.electronAPI?.booru?.onFavoritesRepairDone) return;
    const unsubscribe = window.electronAPI.booru.onFavoritesRepairDone((data) => {
      console.log('[BooruFavoritesPage] 收藏修复完成:', data);
      if (data.siteId !== selectedSiteId) return;

      // 补全数据：普通提示
      if (data.repairedCount > 0) {
        message.success(`已补全 ${data.repairedCount} 个收藏的数据，点击刷新查看`);
      }

      // 删除已失效收藏：常驻弹窗提醒
      if (data.deletedCount > 0) {
        notification.warning({
          message: '收藏清理通知',
          description: `检测到 ${data.deletedCount} 个收藏的原帖已被站点删除，已自动清理 (ID: ${data.deletedIds.join(', ')})`,
          duration: 0, // 常驻，需手动关闭
          btn: (
            <Button type="primary" size="small" onClick={() => {
              loadFavorites(currentPage);
              notification.destroy();
            }}>
              刷新列表
            </Button>
          ),
        });
      }
    });
    return () => unsubscribe();
  }, [selectedSiteId, currentPage]);

  // 当站点切换时，加载收藏和分组
  useEffect(() => {
    if (selectedSiteId) {
      loadGroups();
      loadFavorites(1);
    }
  }, [selectedSiteId]);

  // 当选中分组变化时，重新加载收藏
  useEffect(() => {
    if (selectedSiteId) {
      loadFavorites(1);
    }
  }, [selectedGroupId]);

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

  // 创建/编辑分组的弹窗
  const GroupModal = (
    <Modal
      open={groupModalVisible}
      title={editingGroup ? '编辑分组' : '新建分组'}
      onOk={handleSaveGroup}
      onCancel={() => { setGroupModalVisible(false); setEditingGroup(null); setNewGroupName(''); }}
      okText="保存"
      cancelText="取消"
      width={340}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>
        <Input
          placeholder="分组名称"
          value={newGroupName}
          onChange={e => setNewGroupName(e.target.value)}
          onPressEnter={handleSaveGroup}
          autoFocus
        />
      </div>
    </Modal>
  );

  return (
    <div ref={contentRef} style={{ padding: appearanceConfig.margin }}>
      {GroupModal}
      {/* 页面标题 */}
      <div style={{ marginBottom: spacing.xl }}>
        <Title level={3} style={{ margin: 0 }}>
          <BookOutlined /> 我的收藏
        </Title>
      </div>

      {/* 分组筛选栏 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: spacing.md, alignItems: 'center' }}>
        <Button
          type={selectedGroupId === 'all' ? 'primary' : 'default'}
          size="small"
          onClick={() => setSelectedGroupId('all')}
        >
          全部
        </Button>
        <Button
          type={selectedGroupId === 'ungrouped' ? 'primary' : 'default'}
          size="small"
          icon={<FolderOutlined />}
          onClick={() => setSelectedGroupId('ungrouped')}
        >
          未分组
        </Button>
        {groups.map(g => (
          <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Button
              type={selectedGroupId === g.id ? 'primary' : 'default'}
              size="small"
              icon={<FolderOutlined />}
              onClick={() => setSelectedGroupId(g.id)}
              style={g.color ? { borderColor: g.color, color: selectedGroupId === g.id ? undefined : g.color } : undefined}
            >
              {g.name}
            </Button>
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              style={{ padding: '0 4px', opacity: 0.5 }}
              onClick={() => { setEditingGroup(g); setNewGroupName(g.name); setGroupColor(g.color || '#1677ff'); setGroupModalVisible(true); }}
            />
            <Popconfirm
              title="确定删除该分组？收藏不会被删除"
              onConfirm={() => handleDeleteGroup(g.id)}
              okText="删除"
              cancelText="取消"
            >
              <Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ padding: '0 4px', opacity: 0.5 }} />
            </Popconfirm>
          </div>
        ))}
        <Button
          type="dashed"
          size="small"
          icon={<PlusOutlined />}
          onClick={() => { setEditingGroup(null); setNewGroupName(''); setGroupModalVisible(true); }}
        >
          新建分组
        </Button>
      </div>

      {/* 工具栏 */}
      <BooruPageToolbar
        sites={sites}
        selectedSiteId={selectedSiteId}
        loading={loading}
        ratingFilter={ratingFilter}
        onSiteChange={handleSiteChange}
        onRatingChange={setRatingFilter}
        onRefresh={() => loadFavorites(currentPage)}
      />

      {/* 图片列表 */}
      <div>
        {loading && (
          <SkeletonGrid count={12} cardWidth={appearanceConfig.gridSize} gap={appearanceConfig.spacing} />
        )}

        {!loading && posts.length === 0 && (
          <Empty
            description="暂无收藏的图片"
            style={{ marginTop: '100px' }}
          >
            <Button
              type="primary"
              onClick={() => loadFavorites(1)}
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
              onPrevious={() => loadFavorites(Math.max(1, currentPage - 1))}
              onNext={() => loadFavorites(currentPage + 1)}
              onPageChange={(page) => loadFavorites(page)}
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
              onPrevious={() => loadFavorites(Math.max(1, currentPage - 1))}
              onNext={() => loadFavorites(currentPage + 1)}
              onPageChange={(page) => loadFavorites(page)}
            />
          </>
        )}
      </div>

      {/* 图片详情页面 */}
      <BooruPostDetailsPage
        open={detailsPageOpen && !suspended}
        post={selectedPost}
        site={selectedSite || null}
        posts={sortedPosts}
        initialIndex={selectedPost ? sortedPosts.findIndex(p => p.postId === selectedPost.postId) : 0}
        onClose={() => {
          setDetailsPageOpen(false);
          setSelectedPost(null);
        }}
        onToggleFavorite={handleToggleFavorite}
        onDownload={handleDownload}
        onTagClick={(tag: string) => {
          console.log('[BooruFavoritesPage] 详情页标签点击，打开子窗口:', tag);
          window.electronAPI?.window.openTagSearch(tag, selectedSiteId);
        }}
        isServerFavorited={(p) => serverFavorites.has(p.postId)}
        onToggleServerFavorite={selectedSite?.username ? handleToggleServerFavorite : undefined}
        onArtistClick={(name: string) => {
          console.log('[BooruFavoritesPage] 详情页艺术家点击，打开子窗口:', name);
          window.electronAPI?.window.openArtist(name, selectedSiteId);
        }}
        suspended={suspended}
      />
    </div>
  );
};

// BooruGridLayout 已提取到 src/renderer/components/BooruGridLayout.tsx

