/**
 * Booru 用户主页
 * 当前优先支持 Danbooru 的只读用户资料浏览。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, App, Avatar, Button, Card, Descriptions, Empty, Space, Spin, Statistic, Typography } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined, SearchOutlined, UserOutlined } from '@ant-design/icons';
import type { BooruSite, BooruUserProfile } from '../../shared/types';
import { colors, spacing, radius } from '../styles/tokens';

const { Title, Text } = Typography;

interface BooruUserPageProps {
  userId?: number;
  username?: string;
  initialSiteId?: number | null;
  onBack?: () => void;
  onTagClick?: (tag: string, siteId?: number | null) => void;
}

function formatTime(value?: string): string {
  if (!value) {
    return '未知';
  }
  try {
    return new Date(value).toLocaleString('zh-CN');
  } catch {
    return value;
  }
}

export const BooruUserPage: React.FC<BooruUserPageProps> = ({
  userId,
  username,
  initialSiteId = null,
  onBack,
  onTagClick,
}) => {
  const { message } = App.useApp();
  const [site, setSite] = useState<BooruSite | null>(null);
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<BooruUserProfile | null>(null);

  const targetLabel = useMemo(() => {
    if (username) {
      return username;
    }
    if (userId) {
      return `#${userId}`;
    }
    return site?.username || '当前用户';
  }, [username, userId, site?.username]);

  const loadSite = useCallback(async () => {
    try {
      if (initialSiteId) {
        const result = await window.electronAPI.booru.getSites();
        if (result.success && result.data) {
          const matched = result.data.find((item: BooruSite) => item.id === initialSiteId) || null;
          setSite(matched);
          return matched;
        }
      }

      const activeResult = await window.electronAPI.booru.getActiveSite();
      if (activeResult.success && activeResult.data) {
        setSite(activeResult.data);
        return activeResult.data;
      }
      setSite(null);
      return null;
    } catch (error) {
      console.error('[BooruUserPage] 加载站点失败:', error);
      setSite(null);
      return null;
    }
  }, [initialSiteId]);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const targetSite = site || await loadSite();
      if (!targetSite) {
        setProfile(null);
        return;
      }

      if (targetSite.type !== 'danbooru') {
        setProfile(null);
        return;
      }

      let result;
      if (userId || username) {
        result = await window.electronAPI.booru.getUserProfile(targetSite.id, { userId, username });
      } else {
        result = await window.electronAPI.booru.getProfile(targetSite.id);
      }

      if (result.success && result.data) {
        setProfile({
          id: result.data.id,
          name: result.data.name,
          levelString: result.data.level_string,
          createdAt: result.data.created_at,
          avatarUrl: result.data.avatar_url,
          postUploadCount: result.data.post_upload_count,
          postUpdateCount: result.data.post_update_count,
          noteUpdateCount: result.data.note_update_count,
          commentCount: result.data.comment_count,
          forumPostCount: result.data.forum_post_count,
          favoriteCount: result.data.favorite_count,
          feedbackCount: result.data.feedback_count,
        });
      } else {
        setProfile(null);
        if (result.error) {
          message.error('加载用户主页失败: ' + result.error);
        }
      }
    } catch (error) {
      console.error('[BooruUserPage] 加载用户主页失败:', error);
      message.error('加载用户主页失败');
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [site, loadSite, userId, username, message]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const uploadsQuery = profile?.name ? `user:${profile.name}` : undefined;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, marginBottom: spacing.lg, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
          {onBack && (
            <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
              返回
            </Button>
          )}
          <div>
            <Title level={3} style={{ margin: 0 }}>用户主页: {targetLabel}</Title>
            <Text type="secondary">{site ? `${site.name} (${site.type})` : '未选择站点'}</Text>
          </div>
        </div>
        <Space>
          {uploadsQuery && onTagClick && (
            <Button icon={<SearchOutlined />} onClick={() => onTagClick(uploadsQuery, site?.id)}>
              查看上传
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={loadProfile} disabled={loading}>
            刷新
          </Button>
        </Space>
      </div>

      {site && site.type !== 'danbooru' && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: spacing.lg }}
          message="当前仅 Danbooru 站点提供用户主页支持"
          description="Moebooru 和 Gelbooru 客户端暂未实现用户主页 API。"
        />
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '64px 0' }}><Spin size="large" /></div>
      ) : !profile ? (
        <Empty description="未找到用户信息，或当前站点未登录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div style={{ display: 'grid', gap: spacing.lg }}>
          <Card style={{ borderRadius: radius.lg }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.lg, flexWrap: 'wrap' }}>
              <Avatar src={profile.avatarUrl} size={84} icon={<UserOutlined />} />
              <div>
                <Title level={4} style={{ margin: 0 }}>{profile.name}</Title>
                <Text type="secondary">用户 ID: {profile.id}</Text>
                <div style={{ marginTop: spacing.xs }}>
                  <Text>{profile.levelString || '未知等级'}</Text>
                </div>
              </div>
            </div>
          </Card>

          <Card style={{ borderRadius: radius.lg }}>
            <Descriptions column={1} size="small" labelStyle={{ width: 140 }}>
              <Descriptions.Item label="注册时间">{formatTime(profile.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="收藏数">{profile.favoriteCount ?? 0}</Descriptions.Item>
              <Descriptions.Item label="反馈数">{profile.feedbackCount ?? 0}</Descriptions.Item>
            </Descriptions>
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: spacing.md }}>
            <Card style={{ borderRadius: radius.lg }}><Statistic title="上传帖子" value={profile.postUploadCount ?? 0} /></Card>
            <Card style={{ borderRadius: radius.lg }}><Statistic title="帖子编辑" value={profile.postUpdateCount ?? 0} /></Card>
            <Card style={{ borderRadius: radius.lg }}><Statistic title="Note 编辑" value={profile.noteUpdateCount ?? 0} /></Card>
            <Card style={{ borderRadius: radius.lg }}><Statistic title="评论数" value={profile.commentCount ?? 0} /></Card>
            <Card style={{ borderRadius: radius.lg }}><Statistic title="论坛发帖" value={profile.forumPostCount ?? 0} /></Card>
          </div>

          {uploadsQuery && onTagClick && (
            <Card style={{ borderRadius: radius.lg, background: colors.bgGroupedSecondary, border: `1px solid ${colors.border}` }}>
              <Space direction="vertical" size="small">
                <Text strong>快速入口</Text>
                <Button icon={<SearchOutlined />} onClick={() => onTagClick(uploadsQuery, site?.id)}>
                  使用 `user:{profile.name}` 查看该用户上传
                </Button>
              </Space>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};
