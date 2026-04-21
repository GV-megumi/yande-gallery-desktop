import React, { useState, useEffect, useCallback } from 'react';
import { Card, Input, List, Space, Spin, Empty, App, Button, Tag, Typography } from 'antd';
import { DatabaseOutlined, SearchOutlined, ArrowLeftOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import type { BooruPost, BooruSite, BooruPool } from '../../shared/types';
import { BooruImageCard } from '../components/BooruImageCard';
import { BooruPostDetailsPage } from './BooruPostDetailsPage';
import { colors, spacing, fontSize } from '../styles/tokens';
import { useFavorite } from '../hooks/useFavorite';
import { useBooruPostActions } from '../hooks/useBooruPostActions';

const { Text } = Typography;

interface BooruPoolsPageProps {
  onTagClick?: (tag: string, siteId?: number | null) => void;
  onArtistClick?: (artistName: string, siteId?: number | null) => void;
  /** 当叠加页面激活时为 true，抑制详情弹窗显示 */
  suspended?: boolean;
}

/**
 * Booru Pool（图集）浏览页面
 * 支持搜索和浏览 Pool 列表，点击查看 Pool 详情
 */
export const BooruPoolsPage: React.FC<BooruPoolsPageProps> = ({ onTagClick, onArtistClick, suspended = false }) => {
  const { message } = App.useApp();
  const [pools, setPools] = useState<BooruPool[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeSite, setActiveSite] = useState<BooruSite | null>(null);
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDraft, setSearchDraft] = useState('');

  // Pool 详情状态
  const [selectedPool, setSelectedPool] = useState<BooruPool | null>(null);
  const [poolPosts, setPoolPosts] = useState<BooruPost[]>([]);
  const [poolLoading, setPoolLoading] = useState(false);
  const [poolPage, setPoolPage] = useState(1);

  const { toggleFavorite: toggleLocalFavorite } = useFavorite({
    siteId: activeSite?.id ?? null,
    logPrefix: '[BooruPoolsPage]'
  });

  const postActions = useBooruPostActions({
    siteId: activeSite?.id ?? null,
    updatePosts: (updater) => setPoolPosts(prev => updater(prev)),
    toggleLocalFavorite,
    addToDownload: (postId, siteId) => window.electronAPI.booru.addToDownload(postId, siteId),
    serverFavorite: (siteId, postId) => window.electronAPI.booru.serverFavorite(siteId, postId),
    serverUnfavorite: (siteId, postId) => window.electronAPI.booru.serverUnfavorite(siteId, postId),
    message,
  });

  // 加载活跃站点
  useEffect(() => {
    const loadActiveSite = async () => {
      try {
        const result = await window.electronAPI.booru.getActiveSite();
        if (result.success && result.data) {
          setActiveSite(result.data);
        }
      } catch (error) {
        console.error('[BooruPoolsPage] 加载活跃站点失败:', error);
      }
    };
    loadActiveSite();
  }, []);

  // 加载 Pool 列表
  const loadPools = useCallback(async () => {
    if (!activeSite) return;

    setLoading(true);
    try {
      let result;
      if (searchQuery.trim()) {
        result = await window.electronAPI.booru.searchPools(activeSite.id, searchQuery.trim(), page);
      } else {
        result = await window.electronAPI.booru.getPools(activeSite.id, page);
      }

      if (result?.success && result.data) {
        setPools(result.data);
        console.log('[BooruPoolsPage] 加载 Pool 列表:', result.data.length, '个');
      } else {
        setPools([]);
        if (result?.error) {
          message.error('加载失败: ' + result.error);
        }
      }
    } catch (error) {
      console.error('[BooruPoolsPage] 加载 Pool 列表失败:', error);
      message.error('加载 Pool 列表失败');
      setPools([]);
    } finally {
      setLoading(false);
    }
  }, [activeSite, page, searchQuery]);

  useEffect(() => {
    if (!selectedPool) {
      loadPools();
    }
  }, [loadPools, selectedPool]);

  // 加载 Pool 详情
  const loadPoolDetail = useCallback(async (pool: BooruPool, targetPage = poolPage) => {
    if (!activeSite) return;

    setPoolLoading(true);
    try {
      const result = await window.electronAPI.booru.getPool(activeSite.id, pool.id, targetPage);
      if (result?.success && result.data) {
        setPoolPosts(result.data.posts || []);
        console.log('[BooruPoolsPage] 加载 Pool 详情:', pool.name, '页码:', targetPage, '图片数:', result.data.posts?.length || 0);
      } else {
        setPoolPosts([]);
        if (result?.error) {
          message.error('加载 Pool 详情失败: ' + result.error);
        }
      }
    } catch (error) {
      console.error('[BooruPoolsPage] 加载 Pool 详情失败:', error);
      message.error('加载 Pool 详情失败');
    } finally {
      setPoolLoading(false);
    }
  }, [activeSite, poolPage]);

  // 点击 Pool
  const handlePoolClick = (pool: BooruPool) => {
    setSelectedPool(pool);
    setPoolPage(1);
    loadPoolDetail(pool, 1);
  };

  // 返回列表
  const handleBack = () => {
    setSelectedPool(null);
    setPoolPosts([]);
  };

  // 搜索
  const handleSearch = (value: string) => {
    setSearchDraft(value);
    setSearchQuery(value);
    setPage(1);
  };

  // 图片详情（记录索引用于 Pool 内导航）
  const handlePostClick = (post: BooruPost, index?: number) => {
    void index;
    postActions.openDetails(post);
  };

  // 收藏切换
  const handleToggleFavorite = async (post: BooruPost) => {
    await postActions.toggleFavorite(post);
  };

  const handleToggleServerFavorite = useCallback(async (post: BooruPost) => {
    await postActions.toggleServerFavorite(post);
  }, [postActions]);

  // 下载
  const handleDownload = async (post: BooruPost) => {
    await postActions.download(post);
  };

  // Pool 详情视图
  if (selectedPool) {
    return (
      <div>
        {/* 标题栏 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          marginBottom: spacing.lg,
          gap: spacing.md,
        }}>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={handleBack}
          >
            返回列表
          </Button>
          <Text type="secondary" style={{ fontSize: fontSize.md }}>/</Text>
          <div>
            <Text strong style={{ fontSize: fontSize.lg }}>
              {selectedPool.name.replace(/_/g, ' ')}
            </Text>
            <Text type="secondary" style={{ marginLeft: spacing.sm }}>
              {selectedPool.postCount} 张图片
            </Text>
          </div>
        </div>

        {/* 描述 */}
        {selectedPool.description && (
          <Card style={{ marginBottom: spacing.lg }} size="small">
            <Text>{selectedPool.description}</Text>
          </Card>
        )}

        {/* Pool 内导航栏 */}
        {poolPosts.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: spacing.md, marginBottom: spacing.lg,
            padding: `${spacing.sm}px ${spacing.lg}px`,
            background: 'rgba(0,0,0,0.02)', borderRadius: 8,
          }}>
            <Button
              icon={<LeftOutlined />}
              disabled={poolPage <= 1}
              onClick={() => {
                const newPage = poolPage - 1;
                setPoolPage(newPage);
                loadPoolDetail(selectedPool, newPage);
              }}
            >
              上一页
            </Button>
            <Text>
              第 {poolPage} 页 · {poolPosts.length} 张图片
              {selectedPool.postCount > 0 && ` / 共 ${selectedPool.postCount} 张`}
            </Text>
            <Button
              disabled={poolPosts.length < 20}
              onClick={() => {
                const newPage = poolPage + 1;
                setPoolPage(newPage);
                loadPoolDetail(selectedPool, newPage);
              }}
            >
              下一页 <RightOutlined />
            </Button>
          </div>
        )}

        {/* Pool 图片网格 */}
        {poolLoading ? (
          <Spin size="large" tip="加载中...">
            <div style={{ padding: 60 }} />
          </Spin>
        ) : poolPosts.length === 0 ? (
          <Empty description="该 Pool 暂无图片" />
        ) : (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: spacing.md,
            }}>
              {poolPosts.map((post, index) => (
                <BooruImageCard
                  key={`${post.postId}-${index}`}
                  post={post}
                  siteName={activeSite?.name || ''}
                  siteUrl={activeSite?.url}
                  isFavorited={!!post.isFavorited}
                  onPreview={() => handlePostClick(post)}
                  onToggleFavorite={() => handleToggleFavorite(post)}
                  onDownload={() => handleDownload(post)}
                  onTagClick={onTagClick ? (tag) => onTagClick(tag, activeSite?.id) : undefined}
                  onToggleServerFavorite={activeSite?.username ? () => handleToggleServerFavorite(post) : undefined}
                  isServerFavorited={postActions.isServerFavorited(post)}
                />
              ))}
            </div>

            {/* 翻页 */}
            <div style={{ textAlign: 'center', marginTop: spacing.lg }}>
              <Space>
                <Button
                  disabled={poolPage <= 1}
                  onClick={() => {
                    const newPage = poolPage - 1;
                    setPoolPage(newPage);
                    loadPoolDetail(selectedPool, newPage);
                  }}
                >
                  上一页
                </Button>
                <Text>第 {poolPage} 页</Text>
                <Button
                  disabled={poolPosts.length < 20}
                  onClick={() => {
                    const newPage = poolPage + 1;
                    setPoolPage(newPage);
                    loadPoolDetail(selectedPool, newPage);
                  }}
                >
                  下一页
                </Button>
              </Space>
            </div>
          </>
        )}

        {/* 详情弹窗 */}
        <BooruPostDetailsPage
          open={postActions.detailOpen && !suspended}
          post={postActions.selectedPost}
          site={activeSite}
          posts={poolPosts}
          initialIndex={postActions.selectedPost ? poolPosts.findIndex(p => p.postId === postActions.selectedPost.postId) : 0}
          onClose={postActions.closeDetails}
          onToggleFavorite={handleToggleFavorite}
          onDownload={handleDownload}
          onTagClick={(tag: string) => {
            console.log('[BooruPoolsPage] 详情页标签点击，打开子窗口:', tag);
            window.electronAPI?.window.openTagSearch(tag, activeSite?.id);
          }}
          isServerFavorited={postActions.isServerFavorited}
          onToggleServerFavorite={activeSite?.username ? handleToggleServerFavorite : undefined}
          onArtistClick={(name: string) => {
            console.log('[BooruPoolsPage] 详情页艺术家点击，打开子窗口:', name);
            window.electronAPI?.window.openArtist(name, activeSite?.id);
          }}
          suspended={suspended}
        />
      </div>
    );
  }

  // Pool 列表视图
  return (
    <div>
      {/* 标题和搜索 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.lg,
      }}>
        <Space>
          <DatabaseOutlined style={{ color: '#5856D6', fontSize: 18 }} />
          <span style={{ fontSize: fontSize.lg, fontWeight: 600, color: colors.textPrimary }}>
            Pool 图集
          </span>
        </Space>

        <Space.Compact style={{ width: 300 }}>
          <Input
            placeholder="搜索 Pool..."
            allowClear
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onPressEnter={(e) => handleSearch(e.currentTarget.value)}
          />
          <Button icon={<SearchOutlined />} onClick={() => handleSearch(searchDraft)} />
        </Space.Compact>
      </div>

      {/* Pool 列表 */}
      {loading ? (
        <Spin size="large" tip="加载中...">
          <div style={{ padding: 60 }} />
        </Spin>
      ) : pools.length === 0 ? (
        <Card>
          <Empty description="暂无 Pool" />
        </Card>
      ) : (
        <>
          <List
            grid={{ gutter: 16, xs: 1, sm: 1, md: 2, lg: 2, xl: 3, xxl: 3 }}
            dataSource={pools}
            renderItem={(pool) => (
              <List.Item>
                <Card
                  hoverable
                  onClick={() => handlePoolClick(pool)}
                  style={{ cursor: 'pointer' }}
                >
                  <Card.Meta
                    title={
                      <Space>
                        <Text strong>{pool.name.replace(/_/g, ' ')}</Text>
                        <Tag color="blue">{pool.postCount} 张</Tag>
                      </Space>
                    }
                    description={
                      <div>
                        {pool.description && (
                          <Typography.Paragraph
                            type="secondary"
                            ellipsis={{ rows: 2 }}
                            style={{ marginBottom: 4 }}
                          >
                            {pool.description}
                          </Typography.Paragraph>
                        )}
                        <Text type="secondary" style={{ fontSize: fontSize.xs }}>
                          创建于 {pool.createdAt ? new Date(pool.createdAt).toLocaleDateString('zh-CN') : '未知'}
                        </Text>
                      </div>
                    }
                  />
                </Card>
              </List.Item>
            )}
          />

          {/* 翻页 */}
          <div style={{ textAlign: 'center', marginTop: spacing.lg }}>
            <Space>
              <Button
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >
                上一页
              </Button>
              <Text>第 {page} 页</Text>
              <Button
                disabled={pools.length < 20}
                onClick={() => setPage(p => p + 1)}
              >
                下一页
              </Button>
            </Space>
          </div>
        </>
      )}
    </div>
  );
};

export default BooruPoolsPage;
