import React, { useState, useEffect, useCallback } from 'react';
import { Card, Select, DatePicker, Space, Spin, Empty, App } from 'antd';
import { FireOutlined } from '@ant-design/icons';
import type { BooruPost, BooruSite } from '../../shared/types';
import { BooruImageCard } from '../components/BooruImageCard';
import { BooruPostDetailsPage } from './BooruPostDetailsPage';
import { colors, spacing, fontSize } from '../styles/tokens';
import { useFavorite } from '../hooks/useFavorite';
import { useBooruPostActions } from '../hooks/useBooruPostActions';
import dayjs from 'dayjs';

const { Option } = Select;

interface BooruPopularPageProps {
  onTagClick?: (tag: string, siteId?: number | null) => void;
  onArtistClick?: (artistName: string, siteId?: number | null) => void;
  /** 当叠加页面激活时为 true，抑制详情弹窗显示 */
  suspended?: boolean;
}

type PeriodType = 'recent' | 'day' | 'week' | 'month';

/**
 * Booru 热门图片页面
 * 支持查看近期热门和按日期查看热门
 */
export const BooruPopularPage: React.FC<BooruPopularPageProps> = ({ onTagClick, onArtistClick, suspended = false }) => {
  const { message } = App.useApp();
  const [posts, setPosts] = useState<BooruPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeSite, setActiveSite] = useState<BooruSite | null>(null);
  const [period, setPeriod] = useState<PeriodType>('recent');
  const [recentPeriod, setRecentPeriod] = useState<'1day' | '1week' | '1month'>('1day');
  const [selectedDate, setSelectedDate] = useState<dayjs.Dayjs>(dayjs());

  const { toggleFavorite: toggleLocalFavorite } = useFavorite({
    siteId: activeSite?.id ?? null,
    logPrefix: '[BooruPopularPage]'
  });

  const postActions = useBooruPostActions({
    siteId: activeSite?.id ?? null,
    updatePosts: (updater) => setPosts(prev => updater(prev)),
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
        console.error('[BooruPopularPage] 加载活跃站点失败:', error);
      }
    };
    loadActiveSite();
  }, []);

  // 加载热门图片
  const loadPopular = useCallback(async () => {
    if (!activeSite) return;

    setLoading(true);
    try {
      let result;
      const dateStr = selectedDate.format('YYYY-MM-DD');

      switch (period) {
        case 'recent':
          result = await window.electronAPI.booru.getPopularRecent(activeSite.id, recentPeriod);
          break;
        case 'day':
          result = await window.electronAPI.booru.getPopularByDay(activeSite.id, dateStr);
          break;
        case 'week':
          result = await window.electronAPI.booru.getPopularByWeek(activeSite.id, dateStr);
          break;
        case 'month':
          result = await window.electronAPI.booru.getPopularByMonth(activeSite.id, dateStr);
          break;
      }

      if (result?.success && result.data) {
        setPosts(result.data);
        console.log('[BooruPopularPage] 加载热门图片:', result.data.length, '张');
      } else {
        setPosts([]);
        if (result?.error) {
          message.error('加载失败: ' + result.error);
        }
      }
    } catch (error) {
      console.error('[BooruPopularPage] 加载热门图片失败:', error);
      message.error('加载热门图片失败');
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [activeSite, period, recentPeriod, selectedDate]);

  // 当条件变化时自动加载
  useEffect(() => {
    loadPopular();
  }, [loadPopular]);

  const handlePostClick = (post: BooruPost) => {
    postActions.openDetails(post);
  };

  const handleToggleFavorite = async (post: BooruPost) => {
    await postActions.toggleFavorite(post);
  };

  const handleToggleServerFavorite = useCallback(async (post: BooruPost) => {
    await postActions.toggleServerFavorite(post);
  }, [postActions]);

  const handleDownload = async (post: BooruPost) => {
    await postActions.download(post);
  };

  return (
    <div>
      {/* 筛选栏 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.lg,
      }}>
        <Space>
          <FireOutlined style={{ color: '#FF3B30', fontSize: 18 }} />
          <span style={{ fontSize: fontSize.lg, fontWeight: 600, color: colors.textPrimary }}>
            热门图片
          </span>
          <span style={{ color: colors.textSecondary, fontSize: fontSize.md }}>
            {posts.length} 张
          </span>
        </Space>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 280 }}>
          <Select
            value={period}
            onChange={(val: PeriodType) => setPeriod(val)}
            style={{ width: 120, flexShrink: 0 }}
          >
            <Option value="recent">近期热门</Option>
            <Option value="day">按日期</Option>
            <Option value="week">按周</Option>
            <Option value="month">按月</Option>
          </Select>

          <div style={{ width: 150 }}>
            {period === 'recent' ? (
              <Select
                value={recentPeriod}
                onChange={(val: '1day' | '1week' | '1month') => setRecentPeriod(val)}
                style={{ width: '100%' }}
              >
                <Option value="1day">今日</Option>
                <Option value="1week">本周</Option>
                <Option value="1month">本月</Option>
              </Select>
            ) : (
              <DatePicker
                value={selectedDate}
                onChange={(date) => date && setSelectedDate(date)}
                picker={period === 'month' ? 'month' : period === 'week' ? 'week' : 'date'}
                allowClear={false}
                style={{ width: '100%' }}
              />
            )}
          </div>
        </div>
      </div>

      {/* 图片网格 */}
      {loading ? (
        <Spin size="large" tip="加载中...">
          <div style={{ padding: 60 }} />
        </Spin>
      ) : posts.length === 0 ? (
        <Card>
          <Empty description="暂无热门图片" />
        </Card>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: spacing.md,
        }}>
          {posts.map((post, index) => (
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
      )}

      {/* 详情弹窗 */}
      <BooruPostDetailsPage
        open={postActions.detailOpen && !suspended}
        post={postActions.selectedPost}
        site={activeSite}
        posts={posts}
        onClose={postActions.closeDetails}
        onToggleFavorite={handleToggleFavorite}
        onDownload={handleDownload}
        onTagClick={(tag: string) => {
          console.log('[BooruPopularPage] 详情页标签点击，打开子窗口:', tag);
          window.electronAPI?.window.openTagSearch(tag, activeSite?.id);
        }}
        isServerFavorited={postActions.isServerFavorited}
        onToggleServerFavorite={activeSite?.username ? handleToggleServerFavorite : undefined}
        onArtistClick={(name: string) => {
          console.log('[BooruPopularPage] 详情页艺术家点击，打开子窗口:', name);
          window.electronAPI?.window.openArtist(name, activeSite?.id);
        }}
        suspended={suspended}
      />
    </div>
  );
};

export default BooruPopularPage;
