import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Button, Empty, App, Typography, notification, Input, Modal, Popconfirm, Tooltip } from 'antd';
import { BookOutlined, PlusOutlined, EditOutlined, DeleteOutlined, FolderOutlined } from '@ant-design/icons';
import { BooruGridLayout } from '../components/BooruGridLayout';
import { BooruPageToolbar, RatingFilter } from '../components/BooruPageToolbar';
import { PaginationControl } from '../components/PaginationControl';
import { SkeletonGrid } from '../components/SkeletonGrid';
import { BooruPostDetailsPage } from './BooruPostDetailsPage';
import { BooruPost, BooruSite } from '../../shared/types';
import { getBooruPreviewUrl } from '../utils/url';
import { colors, spacing, radius, transitions } from '../styles/tokens';
import { useFavorite } from '../hooks/useFavorite';
import { useBooruPostActions } from '../hooks/useBooruPostActions';
import { useBooruDomainEvents } from '../hooks/useBooruDomainEvents';

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
  const contentRef = useRef<HTMLDivElement>(null);

  // 收藏夹分组状态
  const [groups, setGroups] = useState<any[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | 'all' | 'ungrouped'>('all');
  const [groupModalVisible, setGroupModalVisible] = useState(false);
  const [editingGroup, setEditingGroup] = useState<any | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [groupColor, setGroupColor] = useState<string>(colors.primary);

  // 用 ref 持有最新的 posts 长度，避免 onSuccess 回调中的闭包过期
  const postsLengthRef = useRef(posts.length);
  postsLengthRef.current = posts.length;

  // 收藏列表请求序号：丢弃过期响应，避免连续触发的刷新乱序覆盖新数据
  const loadFavoritesRequestIdRef = useRef(0);
  // 域事件触发刷新的防抖定时器（与 BlacklistedTagsPage 的守卫模式一致）
  const favoritesReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 用 ref 持有最新页码，防抖定时器触发时读取最新值
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;

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

  // Post 操作（下载、服务端收藏/取消收藏）统一走 useBooruPostActions
  const postActions = useBooruPostActions({
    siteId: selectedSiteId,
    updatePosts: (updater) => setPosts(prev => updater(prev)),
    toggleLocalFavorite: toggleFavorite,
    addToDownload: (postId, siteId) => window.electronAPI.booru.addToDownload(postId, siteId),
    serverFavorite: (siteId, postId) => window.electronAPI.booru.serverFavorite(siteId, postId),
    serverUnfavorite: (siteId, postId) => window.electronAPI.booru.serverUnfavorite(siteId, postId),
    message,
  });

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
        const siteList = result.data;
        console.log('[BooruFavoritesPage] 加载站点列表成功:', siteList.length, '个站点');
        setSites(siteList);

        if (siteList.length > 0) {
          // 已选站点仍然存在时保持选择不变：避免 booru:sites-changed 事件重新触发 loadSites 时
          // 把用户在下拉框中手动选中的站点重置为第一个站点
          setSelectedSiteId(prev => {
            if (prev !== null && siteList.some(s => s.id === prev)) {
              return prev;
            }
            return siteList[0].id;
          });
        } else {
          setSelectedSiteId(null);
          setPosts([]);
          setGroups([]);
          setFavorites(new Set());
          setCurrentPage(1);
          setHasMore(true);
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
    // 请求序号守卫：后发请求会使先发请求的响应失效，防止乱序覆盖
    const requestId = loadFavoritesRequestIdRef.current + 1;
    loadFavoritesRequestIdRef.current = requestId;
    setLoading(true);

    try {
      if (!window.electronAPI) {
        setLoading(false);
        return;
      }

      const result = await window.electronAPI.booru.getFavorites(selectedSiteId, page, appearanceConfig.itemsPerPage, groupIdParam);
      // 丢弃过期响应（期间已发起更新的加载请求）
      if (loadFavoritesRequestIdRef.current !== requestId) {
        console.log('[BooruFavoritesPage] 丢弃过期收藏响应，requestId:', requestId, 'current:', loadFavoritesRequestIdRef.current);
        return;
      }
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
      if (loadFavoritesRequestIdRef.current !== requestId) return;
      console.error('[BooruFavoritesPage] 加载收藏失败:', error);
      message.error('加载收藏失败');
    } finally {
      // 仅当前最新请求负责收尾 loading 状态，过期请求不得干扰
      if (loadFavoritesRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  };

  // 用 ref 持有最新的 loadFavorites 闭包，防抖定时器触发时总是使用最新的站点/分组/配置
  const loadFavoritesRef = useRef(loadFavorites);
  loadFavoritesRef.current = loadFavorites;

  // 防抖调度刷新：收藏修复等批量操作会逐条派发 favorite 域事件，
  // 合并短时间内的多次触发，避免对本地收藏库的 N 次全量重查（参照 BlacklistedTagsPage 的守卫模式）
  const scheduleFavoritesReload = () => {
    if (favoritesReloadTimerRef.current) {
      clearTimeout(favoritesReloadTimerRef.current);
    }
    favoritesReloadTimerRef.current = setTimeout(() => {
      favoritesReloadTimerRef.current = null;
      loadFavoritesRef.current(currentPageRef.current);
    }, 50);
  };

  // 卸载时清理防抖定时器
  useEffect(() => () => {
    if (favoritesReloadTimerRef.current) {
      clearTimeout(favoritesReloadTimerRef.current);
      favoritesReloadTimerRef.current = null;
    }
  }, []);

  useBooruDomainEvents({
    siteId: selectedSiteId,
    active: !suspended,
    onPostFavoriteChanged: () => {
      scheduleFavoritesReload();
    },
    onFavoriteGroupsChanged: () => {
      loadGroups();
      scheduleFavoritesReload();
    },
    onSitesChanged: () => {
      loadSites();
    },
  });

  // 处理站点切换：只重置状态，加载交给 selectedSiteId 的 useEffect 统一触发，
  // 避免这里直接调用 loadFavorites(1) 与 effect 形成双请求（与 BooruTagSearchPage 模式对齐）
  const handleSiteChange = (siteId: number) => {
    console.log('[BooruFavoritesPage] 切换站点:', siteId);
    setSelectedSiteId(siteId);
    setPosts([]);
    setCurrentPage(1);
    setHasMore(true);
  };

  // 处理收藏切换（委托给 useFavorite Hook）
  const handleToggleFavorite = async (post: BooruPost) => {
    const result = await toggleFavorite(post);
    if (!result.success) {
      message.error('操作失败');
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

  // 处理图片预览（委托给 useBooruPostActions）
  const handlePreview = (post: BooruPost) => {
    console.log('[BooruFavoritesPage] 预览图片:', post.postId);
    postActions.openDetails(post);
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
        {/* 预设分组颜色：点击色块选中，选中项用描边高亮 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
          {[colors.primary, colors.accent, colors.cyan, colors.success, colors.warning, colors.purple].map((presetColor) => (
            <div
              key={presetColor}
              role="button"
              aria-label={`选择分组颜色 ${presetColor}`}
              onClick={() => setGroupColor(presetColor)}
              style={{
                width: 20,
                height: 20,
                borderRadius: radius.round,
                background: presetColor,
                cursor: 'pointer',
                boxShadow: groupColor === presetColor
                  ? `0 0 0 2px ${colors.bgBase}, 0 0 0 4px ${presetColor}`
                  : 'none',
                transition: transitions.fast,
              }}
            />
          ))}
        </div>
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
            <Tooltip title="编辑分组">
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                aria-label="编辑分组"
                style={{ opacity: 0.6, transition: transitions.fast }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; }}
                onClick={() => { setEditingGroup(g); setNewGroupName(g.name); setGroupColor(g.color || colors.primary); setGroupModalVisible(true); }}
              />
            </Tooltip>
            <Popconfirm
              title="确定删除该分组？收藏不会被删除"
              onConfirm={() => handleDeleteGroup(g.id)}
              okText="删除"
              cancelText="取消"
            >
              <Tooltip title="删除分组">
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  aria-label="删除分组"
                  style={{ opacity: 0.6, transition: transitions.fast }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; }}
                />
              </Tooltip>
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

            {/* 当前页有数据但被评级筛选过滤为空时，给出轻量提示而非空白网格 */}
            {filteredSortedPosts.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="当前页没有符合评级筛选的图片"
                style={{ margin: `${spacing['3xl']}px 0` }}
              >
                <Button onClick={() => setRatingFilter('all')}>显示全部评级</Button>
              </Empty>
            ) : (
              <BooruGridLayout
                posts={filteredSortedPosts}
                gridSize={appearanceConfig.gridSize}
                spacing={appearanceConfig.spacing}
                borderRadius={appearanceConfig.borderRadius}
                selectedSite={selectedSite || null}
                onPreview={handlePreview}
                onDownload={postActions.download}
                onToggleFavorite={handleToggleFavorite}
                favorites={favorites}
                getPreviewUrl={getPreviewUrl}
                onTagClick={handleTagClick}
                onToggleServerFavorite={selectedSite?.username ? postActions.toggleServerFavorite : undefined}
                serverFavorites={postActions.serverFavorites}
              />
            )}

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
        open={postActions.detailOpen && !suspended}
        post={postActions.selectedPost}
        site={selectedSite || null}
        posts={sortedPosts}
        initialIndex={postActions.selectedPost ? sortedPosts.findIndex(p => p.postId === postActions.selectedPost!.postId) : 0}
        onClose={postActions.closeDetails}
        onToggleFavorite={handleToggleFavorite}
        onDownload={postActions.download}
        onTagClick={(tag: string) => {
          console.log('[BooruFavoritesPage] 详情页标签点击，打开子窗口:', tag);
          window.electronAPI?.window.openTagSearch(tag, selectedSiteId);
        }}
        isServerFavorited={postActions.isServerFavorited}
        onToggleServerFavorite={selectedSite?.username ? postActions.toggleServerFavorite : undefined}
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

