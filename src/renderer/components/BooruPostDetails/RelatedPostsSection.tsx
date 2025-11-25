import React, { useState, useEffect } from 'react';
import { Typography, Space, Spin, Empty } from 'antd';
import { BooruPost, BooruSite } from '../../../shared/types';

const { Title } = Typography;

interface RelatedPostsSectionProps {
  post: BooruPost;
  site: BooruSite | null;
  onPostClick?: (post: BooruPost) => void;
}

/**
 * 相关帖子部分组件
 * 显示相关图片
 * 参考 Boorusama 的 MoebooruRelatedPostsSection
 */
export const RelatedPostsSection: React.FC<RelatedPostsSectionProps> = ({
  post,
  site,
  onPostClick
}) => {
  const [relatedPosts, setRelatedPosts] = useState<BooruPost[]>([]);
  const [loading, setLoading] = useState(false);

  // 加载相关帖子
  useEffect(() => {
    if (!post || !site) return;

    // TODO: 实现加载相关帖子的逻辑
    // 可以通过以下方式获取相关帖子：
    // 1. 使用相同的标签搜索
    // 2. 使用 parent_id 或 has_children 字段
    // 3. 调用 Booru API 的相关帖子接口

    console.log('[RelatedPostsSection] 加载相关帖子:', post.postId);
    setLoading(true);

    // 模拟加载
    setTimeout(() => {
      setRelatedPosts([]);
      setLoading(false);
    }, 500);
  }, [post, site]);

  if (loading) {
    return (
      <div style={{ marginBottom: '24px', textAlign: 'center', padding: '20px' }}>
        <Spin />
      </div>
    );
  }

  if (relatedPosts.length === 0) {
    return null; // 没有相关帖子时不显示
  }

  return (
    <div style={{ marginBottom: '24px' }}>
      <Title level={5} style={{ marginBottom: '12px' }}>
        相关图片 ({relatedPosts.length})
      </Title>
      <Space wrap size={[8, 8]}>
        {relatedPosts.map(relatedPost => (
          <div
            key={relatedPost.id}
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '4px',
              overflow: 'hidden',
              cursor: 'pointer',
              background: '#f0f0f0'
            }}
            onClick={() => {
              console.log('[RelatedPostsSection] 点击相关图片:', relatedPost.postId);
              if (onPostClick) {
                onPostClick(relatedPost);
              }
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '0.8';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '1';
            }}
          >
            <img
              src={relatedPost.previewUrl || relatedPost.sampleUrl || ''}
              alt={`Post ${relatedPost.postId}`}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover'
              }}
            />
          </div>
        ))}
      </Space>
    </div>
  );
};

