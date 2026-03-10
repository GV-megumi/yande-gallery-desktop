import React, { useState, useEffect } from 'react';
import { Tag, Timeline, Button, Empty, Spin, Typography } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import { BooruPost, BooruSite } from '../../../shared/types';
import { colors, spacing, fontSize } from '../../styles/tokens';

const { Text } = Typography;

interface PostVersionData {
  id: number;
  post_id: number;
  version: number;
  updater_name: string;
  created_at: string;
  tags_added: string[];
  tags_removed: string[];
  rating?: string;
  rating_changed?: boolean;
  source?: string;
  source_changed?: boolean;
}

interface PostHistorySectionProps {
  post: BooruPost;
  site: BooruSite | null;
}

/**
 * 帖子版本历史区块（Danbooru 专属）
 * 展示帖子的标签编辑历史和元数据变更记录
 */
export const PostHistorySection: React.FC<PostHistorySectionProps> = ({ post, site }) => {
  const [versions, setVersions] = useState<PostVersionData[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded || !site || !post.postId) return;
    setVersions([]);
    setLoading(true);

    const loadVersions = async () => {
      try {
        const result = await window.electronAPI.booru.getPostVersions(site.id, post.postId);
        if (result.success && result.data) {
          console.log('[PostHistorySection] 加载版本历史:', result.data.length, '条');
          setVersions(result.data);
        }
      } catch (error) {
        console.error('[PostHistorySection] 加载版本历史失败:', error);
      } finally {
        setLoading(false);
      }
    };

    loadVersions();
  }, [expanded, post.postId, site?.id]);

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div style={{ marginTop: spacing.lg }}>
      {/* 区块标题 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: spacing.sm,
          cursor: 'pointer',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <HistoryOutlined style={{ color: colors.textSecondary }} />
          <span style={{ fontSize: fontSize.sm, fontWeight: 600, color: colors.textPrimary }}>
            版本历史
          </span>
        </div>
        <Button type="text" size="small" style={{ color: colors.textTertiary }}>
          {expanded ? '收起' : '展开'}
        </Button>
      </div>

      {expanded && (
        <div style={{ marginTop: spacing.sm }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: spacing.md }}>
              <Spin size="small" />
            </div>
          ) : versions.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无版本历史"
              style={{ margin: `${spacing.sm}px 0` }}
            />
          ) : (
            <Timeline
              style={{ paddingLeft: 4 }}
              items={versions.map((v) => ({
                key: v.id,
                dot: (
                  <div style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background: colors.bgLight,
                    border: `1.5px solid ${colors.separator}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 9,
                    color: colors.textTertiary,
                  }}>
                    {v.version}
                  </div>
                ),
                children: (
                  <div style={{ paddingBottom: spacing.sm }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                      <Text strong style={{ fontSize: fontSize.sm }}>
                        {v.updater_name}
                      </Text>
                      <Text type="secondary" style={{ fontSize: fontSize.xs }}>
                        {formatDate(v.created_at)}
                      </Text>
                    </div>

                    {v.rating_changed && v.rating && (
                      <div style={{ marginBottom: 4, fontSize: fontSize.xs }}>
                        <Text type="secondary">评级变更为 </Text>
                        <Tag color="blue" style={{ fontSize: fontSize.xs }}>{v.rating}</Tag>
                      </div>
                    )}

                    {v.source_changed && v.source && (
                      <div style={{ marginBottom: 4, fontSize: fontSize.xs, color: colors.textSecondary }}>
                        来源变更
                      </div>
                    )}

                    {v.tags_added.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 4 }}>
                        {v.tags_added.slice(0, 8).map(tag => (
                          <Tag key={tag} color="green" style={{ fontSize: fontSize.xs, margin: 0 }}>
                            +{tag}
                          </Tag>
                        ))}
                        {v.tags_added.length > 8 && (
                          <Text type="secondary" style={{ fontSize: fontSize.xs }}>
                            +{v.tags_added.length - 8} 个
                          </Text>
                        )}
                      </div>
                    )}

                    {v.tags_removed.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {v.tags_removed.slice(0, 8).map(tag => (
                          <Tag key={tag} color="red" style={{ fontSize: fontSize.xs, margin: 0 }}>
                            -{tag}
                          </Tag>
                        ))}
                        {v.tags_removed.length > 8 && (
                          <Text type="secondary" style={{ fontSize: fontSize.xs }}>
                            -{v.tags_removed.length - 8} 个
                          </Text>
                        )}
                      </div>
                    )}

                    {v.tags_added.length === 0 && v.tags_removed.length === 0 && !v.rating_changed && !v.source_changed && (
                      <Text type="secondary" style={{ fontSize: fontSize.xs }}>无标签变更</Text>
                    )}
                  </div>
                ),
              }))}
            />
          )}
        </div>
      )}
    </div>
  );
};
