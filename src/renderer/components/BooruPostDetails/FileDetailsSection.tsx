import React, { useState } from 'react';
import { Collapse, Descriptions, Space, Button, message, Typography } from 'antd';
import { CopyOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { BooruPost, BooruSite } from '../../../shared/types';

const { Text } = Typography;

interface FileDetailsSectionProps {
  post: BooruPost;
  site: BooruSite | null;
}

/**
 * 文件详情部分组件
 * 显示：ID、评分、文件大小、分辨率、格式、上传者
 * 参考 Boorusama 的 FileDetailsSection
 */
export const FileDetailsSection: React.FC<FileDetailsSectionProps> = ({
  post,
  site
}) => {
  const [expanded, setExpanded] = useState(false);

  // 格式化文件大小
  const formatFileSize = (bytes?: number): string => {
    if (!bytes || bytes === 0) return '未知';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  // 格式化评分
  const formatRating = (rating?: string): string => {
    if (!rating) return '未知';
    const ratingMap: Record<string, string> = {
      's': '安全',
      'safe': '安全',
      'q': '存疑',
      'questionable': '存疑',
      'e': '限制级',
      'explicit': '限制级'
    };
    return ratingMap[rating.toLowerCase()] || rating;
  };

  // 复制ID
  const handleCopyId = () => {
    if (post.postId) {
      navigator.clipboard.writeText(post.postId.toString()).then(() => {
        message.success('ID 已复制到剪贴板');
      }).catch(err => {
        console.error('[FileDetailsSection] 复制失败:', err);
        message.error('复制失败');
      });
    }
  };

  // 搜索上传者
  const handleSearchUploader = () => {
    // TODO: 实现搜索上传者的功能
    console.log('[FileDetailsSection] 搜索上传者');
    message.info('搜索上传者功能开发中...');
  };

  // 生成摘要信息（显示在折叠面板标题下方）
  const generateSummary = (): string => {
    const parts: string[] = [];
    
    if (post.width && post.height) {
      parts.push(`${post.width}×${post.height}`);
    }
    
    if (post.fileExt) {
      parts.push(post.fileExt.toUpperCase());
    }
    
    if (post.fileSize) {
      parts.push(formatFileSize(post.fileSize));
    }
    
    if (post.rating) {
      parts.push(formatRating(post.rating).charAt(0));
    }
    
    return parts.join(' • ');
  };

  return (
    <div style={{ marginBottom: '24px' }}>
      <Collapse
        activeKey={expanded ? ['details'] : []}
        onChange={(keys) => {
          setExpanded(keys.includes('details'));
        }}
        style={{ background: '#fff' }}
        items={[
          {
            key: 'details',
            label: (
              <Text strong>
                文件详情
              </Text>
            ),
            extra: (
              <Text type="secondary" style={{ fontSize: '12px' }}>
                {generateSummary()}
              </Text>
            ),
            children: (
              <Descriptions
                bordered
                column={1}
                size="small"
                style={{ marginTop: '8px' }}
              >
                {/* ID */}
                <Descriptions.Item label="ID">
                  <Space>
                    <Text>{post.postId || '未知'}</Text>
                    <Button
                      type="text"
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={handleCopyId}
                      style={{ marginLeft: '8px' }}
                    />
                  </Space>
                </Descriptions.Item>

                {/* 评分 */}
                <Descriptions.Item label="评分">
                  <Space>
                    <Text>{formatRating(post.rating)}</Text>
                    {post.score !== undefined && post.score !== null && (
                      <Text type="secondary">({post.score} 分)</Text>
                    )}
                  </Space>
                </Descriptions.Item>

                {/* 文件大小 */}
                {post.fileSize && (
                  <Descriptions.Item label="文件大小">
                    {formatFileSize(post.fileSize)}
                  </Descriptions.Item>
                )}

                {/* 分辨率 */}
                {post.width && post.height && (
                  <Descriptions.Item label="分辨率">
                    {post.width} × {post.height}
                  </Descriptions.Item>
                )}

                {/* 文件格式 */}
                {post.fileExt && (
                  <Descriptions.Item label="文件格式">
                    {post.fileExt.toUpperCase()}
                  </Descriptions.Item>
                )}

                {/* MD5 */}
                {post.md5 && (
                  <Descriptions.Item label="MD5">
                    <Text code style={{ fontSize: '11px' }}>
                      {post.md5}
                    </Text>
                  </Descriptions.Item>
                )}
              </Descriptions>
            )
          }
        ]}
      />
    </div>
  );
};

