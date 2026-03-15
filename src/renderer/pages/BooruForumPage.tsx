/**
 * Booru 论坛浏览页面
 * 当前优先支持 Danbooru 的只读论坛浏览。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Card, Empty, List, Space, Spin, Tag, Typography } from 'antd';
import { ArrowLeftOutlined, MessageOutlined, ReloadOutlined } from '@ant-design/icons';
import type { BooruSite, BooruForumTopic, BooruForumPost } from '../../shared/types';
import { colors, spacing, fontSize, radius } from '../styles/tokens';
import { DTextRenderer } from '../components/DTextRenderer';

const { Title, Text, Paragraph } = Typography;

interface BooruForumPageProps {
  onUserClick?: (params: { userId?: number; username?: string }, siteId?: number | null) => void;
  suspended?: boolean;
}

const PAGE_SIZE = 20;

function formatTime(value?: string): string {
  if (!value) {
    return '未知时间';
  }
  try {
    return new Date(value).toLocaleString('zh-CN');
  } catch {
    return value;
  }
}

export const BooruForumPage: React.FC<BooruForumPageProps> = ({ onUserClick, suspended = false }) => {
  const { message } = App.useApp();
  const [activeSite, setActiveSite] = useState<BooruSite | null>(null);
  const [topics, setTopics] = useState<BooruForumTopic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [topicPage, setTopicPage] = useState(1);
  const [selectedTopic, setSelectedTopic] = useState<BooruForumTopic | null>(null);
  const [posts, setPosts] = useState<BooruForumPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postPage, setPostPage] = useState(1);

  const isDanbooru = activeSite?.type === 'danbooru';

  const loadActiveSite = useCallback(async (): Promise<BooruSite | null> => {
    try {
      const result = await window.electronAPI.booru.getActiveSite();
      if (result.success && result.data) {
        setActiveSite(result.data);
        return result.data;
      } else {
        setActiveSite(null);
        return null;
      }
    } catch (error) {
      console.error('[BooruForumPage] 加载活跃站点失败:', error);
      setActiveSite(null);
      return null;
    }
  }, []);

  const loadTopics = useCallback(async (siteOverride?: BooruSite | null, pageOverride?: number) => {
    const targetSite = siteOverride ?? activeSite;
    const targetPage = pageOverride ?? topicPage;

    if (!targetSite || targetSite.type !== 'danbooru') {
      setTopics([]);
      return;
    }

    setTopicsLoading(true);
    try {
      const result = await window.electronAPI.booru.getForumTopics(targetSite.id, targetPage, PAGE_SIZE);
      if (result.success && result.data) {
        setTopics(result.data.map(topic => ({
          id: topic.id,
          title: topic.title,
          responseCount: topic.response_count,
          isSticky: topic.is_sticky,
          isLocked: topic.is_locked,
          isHidden: topic.is_hidden,
          categoryId: topic.category_id,
          creatorId: topic.creator_id,
          updaterId: topic.updater_id,
          createdAt: topic.created_at,
          updatedAt: topic.updated_at,
        })));
      } else {
        setTopics([]);
        if (result.error) {
          message.error('加载论坛主题失败: ' + result.error);
        }
      }
    } catch (error) {
      console.error('[BooruForumPage] 加载论坛主题失败:', error);
      message.error('加载论坛主题失败');
      setTopics([]);
    } finally {
      setTopicsLoading(false);
    }
  }, [activeSite, topicPage, message]);

  const loadPosts = useCallback(async (siteOverride?: BooruSite | null, pageOverride?: number) => {
    const targetSite = siteOverride ?? activeSite;
    const targetPage = pageOverride ?? postPage;

    if (!targetSite || !selectedTopic || targetSite.type !== 'danbooru') {
      setPosts([]);
      return;
    }

    setPostsLoading(true);
    try {
      const result = await window.electronAPI.booru.getForumPosts(targetSite.id, selectedTopic.id, targetPage, PAGE_SIZE);
      if (result.success && result.data) {
        setPosts(result.data.map(post => ({
          id: post.id,
          topicId: post.topic_id,
          body: post.body,
          creatorId: post.creator_id,
          updaterId: post.updater_id,
          createdAt: post.created_at,
          updatedAt: post.updated_at,
          isDeleted: post.is_deleted,
          isHidden: post.is_hidden,
        })));
      } else {
        setPosts([]);
        if (result.error) {
          message.error('加载论坛帖子失败: ' + result.error);
        }
      }
    } catch (error) {
      console.error('[BooruForumPage] 加载论坛帖子失败:', error);
      message.error('加载论坛帖子失败');
      setPosts([]);
    } finally {
      setPostsLoading(false);
    }
  }, [activeSite, selectedTopic, postPage, message]);

  useEffect(() => {
    loadActiveSite();
  }, [loadActiveSite]);

  useEffect(() => {
    setSelectedTopic(null);
    setPosts([]);
    setPostPage(1);
    setTopicPage(1);
  }, [activeSite?.id]);

  useEffect(() => {
    if (!suspended && !selectedTopic) {
      loadTopics();
    }
  }, [loadTopics, selectedTopic, suspended]);

  useEffect(() => {
    if (!suspended && selectedTopic) {
      loadPosts();
    }
  }, [loadPosts, selectedTopic, suspended]);

  const topicEmptyDescription = useMemo(() => {
    if (!activeSite) {
      return '请先配置并选择站点';
    }
    if (!isDanbooru) {
      return '当前仅 Danbooru 站点支持论坛浏览';
    }
    return '暂无论坛主题';
  }, [activeSite, isDanbooru]);

  const hasNextTopicPage = topics.length === PAGE_SIZE;
  const hasNextPostPage = posts.length === PAGE_SIZE;

  if (selectedTopic) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg, flexWrap: 'wrap' }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => { setSelectedTopic(null); setPosts([]); setPostPage(1); }}>
            返回主题列表
          </Button>
          <div>
            <Title level={4} style={{ margin: 0 }}>{selectedTopic.title}</Title>
            <Text type="secondary">回复数: {selectedTopic.responseCount} · 更新时间: {formatTime(selectedTopic.updatedAt || selectedTopic.createdAt)}</Text>
          </div>
          <Button icon={<ReloadOutlined />} onClick={() => { void loadPosts(); }} disabled={postsLoading}>
            刷新
          </Button>
        </div>

        {postsLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '64px 0' }}><Spin size="large" /></div>
        ) : posts.length === 0 ? (
          <Empty description="该主题暂无帖子" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <List
            dataSource={posts}
            renderItem={(post, index) => (
              <List.Item key={post.id} style={{ padding: 0, marginBottom: spacing.md, border: 'none' }}>
                <Card
                  style={{ width: '100%', borderRadius: radius.lg }}
                  bodyStyle={{ padding: spacing.lg }}
                  title={
                    <Space wrap>
                      <Tag color="blue">#{index + 1 + (postPage - 1) * PAGE_SIZE}</Tag>
                      <Text strong>帖子 ID: {post.id}</Text>
                      {post.creatorId && onUserClick && (
                        <Button type="link" size="small" onClick={(event) => {
                          event.stopPropagation();
                          onUserClick({ userId: post.creatorId }, activeSite?.id);
                        }}>
                          用户 #{post.creatorId}
                        </Button>
                      )}
                      {post.isDeleted && <Tag color="red">已删除</Tag>}
                      {post.isHidden && <Tag color="orange">已隐藏</Tag>}
                    </Space>
                  }
                  extra={<Text type="secondary">创建于 {formatTime(post.createdAt)}</Text>}
                >
                  <div style={{ color: colors.textPrimary }}><DTextRenderer value={post.body} mode="dtext" /></div>
                </Card>
              </List.Item>
            )}
          />
        )}

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: spacing.lg }}>
          <Space>
            <Button onClick={() => setPostPage(prev => Math.max(prev - 1, 1))} disabled={postPage <= 1 || postsLoading}>
              上一页
            </Button>
            <Button onClick={() => setPostPage(prev => prev + 1)} disabled={!hasNextPostPage || postsLoading}>
              下一页
            </Button>
          </Space>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, marginBottom: spacing.lg, flexWrap: 'wrap' }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            <Space size="small">
              <MessageOutlined />
              <span>论坛浏览</span>
            </Space>
          </Title>
          <Text type="secondary" style={{ fontSize: fontSize.md }}>
            {activeSite ? `${activeSite.name} (${activeSite.type})` : '未选择站点'}
          </Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={async () => {
          const nextSite = await loadActiveSite();
          setSelectedTopic(null);
          setPosts([]);
          setPostPage(1);
          setTopicPage(1);
          await loadTopics(nextSite, 1);
        }} disabled={topicsLoading}>
          刷新
        </Button>
      </div>

      {activeSite && !isDanbooru && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: spacing.lg }}
          message="当前仅 Danbooru 站点提供论坛浏览支持"
          description="Moebooru 和 Gelbooru 客户端暂未实现论坛 API。切换到 Danbooru 站点后可查看主题和帖子。"
        />
      )}

      {topicsLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '64px 0' }}><Spin size="large" /></div>
      ) : topics.length === 0 ? (
        <Empty description={topicEmptyDescription} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <List
          dataSource={topics}
          renderItem={(topic) => (
            <List.Item key={topic.id} style={{ padding: 0, marginBottom: spacing.md, border: 'none' }}>
              <Card
                hoverable
                style={{ width: '100%', borderRadius: radius.lg }}
                bodyStyle={{ padding: spacing.lg }}
                onClick={() => { setSelectedTopic(topic); setPostPage(1); }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md }}>
                  <div style={{ flex: 1 }}>
                    <Space wrap style={{ marginBottom: spacing.xs }}>
                      <Text strong style={{ fontSize: fontSize.lg }}>{topic.title}</Text>
                      {topic.isSticky && <Tag color="gold">置顶</Tag>}
                      {topic.isLocked && <Tag color="red">锁定</Tag>}
                      {topic.isHidden && <Tag color="orange">隐藏</Tag>}
                    </Space>
                    <div>
                      <Text type="secondary">回复数: {topic.responseCount}</Text>
                      <Text type="secondary" style={{ marginLeft: spacing.md }}>更新时间: {formatTime(topic.updatedAt || topic.createdAt)}</Text>
                      {topic.creatorId && onUserClick && (
                        <Button type="link" size="small" onClick={(event) => {
                          event.stopPropagation();
                          onUserClick({ userId: topic.creatorId }, activeSite?.id);
                        }}>
                          用户 #{topic.creatorId}
                        </Button>
                      )}
                    </div>
                  </div>
                  <Button type="link" onClick={(event) => {
                    event.stopPropagation();
                    setSelectedTopic(topic);
                    setPostPage(1);
                  }}>查看讨论</Button>
                </div>
              </Card>
            </List.Item>
          )}
        />
      )}

      {topics.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: spacing.lg }}>
          <Space>
            <Button onClick={() => setTopicPage(prev => Math.max(prev - 1, 1))} disabled={topicPage <= 1 || topicsLoading}>
              上一页
            </Button>
            <Button onClick={() => setTopicPage(prev => prev + 1)} disabled={!hasNextTopicPage || topicsLoading}>
              下一页
            </Button>
          </Space>
        </div>
      )}
    </div>
  );
};
