import React, { useState, useEffect, useCallback } from 'react';
import { Button, Input, List, Space, App, Typography, Empty } from 'antd';
import { CommentOutlined, SendOutlined, ReloadOutlined } from '@ant-design/icons';
import { BooruPost, BooruSite, BooruComment } from '../../../shared/types';
import { colors, spacing, fontSize } from '../../styles/tokens';
import { DTextRenderer } from '../DTextRenderer';

const { TextArea } = Input;
const { Text } = Typography;

interface CommentSectionProps {
  post: BooruPost;
  site: BooruSite | null;
}

/**
 * 评论区组件
 * 显示图片的评论列表，支持发表评论（需要登录）
 */
export const CommentSection: React.FC<CommentSectionProps> = ({ post, site }) => {
  const { message } = App.useApp();
  const [comments, setComments] = useState<BooruComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const isLoggedIn = !!site?.authenticated;

  // 加载评论
  const loadComments = useCallback(async () => {
    if (!site || !post.postId) return;

    setLoading(true);
    try {
      const result = await window.electronAPI.booru.getComments(site.id, post.postId);
      if (result.success && result.data) {
        setComments(result.data);
        console.log('[CommentSection] 加载评论:', result.data.length, '条');
      } else {
        console.error('[CommentSection] 加载评论失败:', result.error);
      }
    } catch (error) {
      console.error('[CommentSection] 加载评论失败:', error);
    } finally {
      setLoading(false);
    }
  }, [site, post.postId]);

  // 展开时加载评论
  useEffect(() => {
    if (expanded) {
      loadComments();
    }
  }, [expanded, loadComments]);

  // 提交评论
  const handleSubmit = async () => {
    if (!newComment.trim()) {
      message.warning('请输入评论内容');
      return;
    }
    if (!site || !isLoggedIn) {
      message.warning('需要登录才能评论');
      return;
    }

    setSubmitting(true);
    try {
      const result = await window.electronAPI.booru.createComment(site.id, post.postId, newComment.trim());
      if (result.success) {
        message.success('评论发表成功');
        setNewComment('');
        // 重新加载评论
        loadComments();
      } else {
        message.error('评论发表失败: ' + result.error);
      }
    } catch (error) {
      console.error('[CommentSection] 发表评论失败:', error);
      message.error('评论发表失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 格式化日期
  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleString('zh-CN');
    } catch {
      return dateStr;
    }
  };

  return (
    <div style={{ marginBottom: spacing.lg }}>
      {/* 标题 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          marginBottom: expanded ? spacing.md : 0,
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <Space>
          <CommentOutlined style={{ color: colors.textSecondary }} />
          <Text strong style={{ fontSize: fontSize.md }}>
            评论 {comments.length > 0 && `(${comments.length})`}
          </Text>
        </Space>
        <Text type="secondary" style={{ fontSize: fontSize.sm }}>
          {expanded ? '收起' : '展开'}
        </Text>
      </div>

      {expanded && (
        <>
          {/* 评论列表 */}
          {comments.length === 0 && !loading ? (
            <Empty
              description="暂无评论"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              style={{ margin: `${spacing.md}px 0` }}
            />
          ) : (
            <List
              loading={loading}
              dataSource={comments}
              size="small"
              renderItem={(comment) => (
                <List.Item style={{ padding: `${spacing.sm}px 0`, alignItems: 'flex-start' }}>
                  <div style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text strong style={{ fontSize: fontSize.sm }}>{comment.creator}</Text>
                      <Text type="secondary" style={{ fontSize: fontSize.xs }}>{formatDate(comment.createdAt)}</Text>
                    </div>
                    <div style={{ fontSize: fontSize.sm, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                      <DTextRenderer value={comment.body} mode={site?.type === 'danbooru' ? 'dtext' : 'bbcode'} />
                    </div>
                  </div>
                </List.Item>
              )}
            />
          )}

          {/* 刷新按钮 */}
          <div style={{ textAlign: 'center', marginTop: spacing.sm }}>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={loadComments}
              loading={loading}
            >
              刷新评论
            </Button>
          </div>

          {/* 发表评论 */}
          {isLoggedIn ? (
            <div style={{ marginTop: spacing.md }}>
              <TextArea
                rows={3}
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="发表评论..."
                style={{ marginBottom: spacing.sm }}
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleSubmit}
                loading={submitting}
                disabled={!newComment.trim()}
                size="small"
              >
                发表
              </Button>
            </div>
          ) : (
            <Text type="secondary" style={{ display: 'block', marginTop: spacing.sm, fontSize: fontSize.sm }}>
              登录后可以发表评论
            </Text>
          )}
        </>
      )}
    </div>
  );
};
