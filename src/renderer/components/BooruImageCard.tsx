import React, { useState } from 'react';
import { Card, Image, Tag, Space, Button, message } from 'antd';
import { HeartOutlined, HeartFilled, DownloadOutlined, EyeOutlined } from '@ant-design/icons';
import { BooruPost } from '../../shared/types';

interface BooruImageCardProps {
  post: BooruPost;
  siteName: string;
  onPreview: (post: BooruPost) => void;
  onDownload: (post: BooruPost) => void;
  onToggleFavorite: (post: BooruPost) => void;
  isFavorited?: boolean;
  previewUrl?: string; // 可选的预览图URL，如果不提供则使用默认逻辑
}

// 格式化标签
const formatTags = (tags: string): string[] => {
  if (!tags) return [];
  return tags.split(' ').slice(0, 10); // 最多显示10个标签
};

export const BooruImageCard: React.FC<BooruImageCardProps> = ({
  post,
  siteName,
  onPreview,
  onDownload,
  onToggleFavorite,
  isFavorited = false,
  previewUrl
}) => {
  // 获取预览图URL
  const getPreviewUrl = (): string => {
    let url = '';
    
    // 如果外部传入了 previewUrl，优先使用
    if (previewUrl && previewUrl.trim()) {
      url = previewUrl.trim();
      console.log('[BooruImageCard] 使用外部传入的 previewUrl:', url.substring(0, 80) + '...');
    } else {
      // 否则按优先级选择：previewUrl -> sampleUrl -> fileUrl
      url = (post.previewUrl || post.sampleUrl || post.fileUrl || '').trim();
    }
    
    if (!url) {
      console.error('[BooruImageCard] 图片没有有效的URL:', {
        postId: post.postId,
        previewUrl: post.previewUrl,
        sampleUrl: post.sampleUrl,
        fileUrl: post.fileUrl,
        externalPreviewUrl: previewUrl
      });
      return ''; // 返回空字符串，让 Image 组件处理错误
    }
    
    // 确保 URL 是完整的（包含协议）
    // 支持 app:// 协议（本地图片）和 http/https 协议（远程图片）
    if (url.startsWith('app://')) {
      // 本地图片，直接使用
      // 不需要修改
    } else if (url.startsWith('//')) {
      url = 'https:' + url;
    } else if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('app://')) {
      // 如果是相对路径，尝试添加协议
      console.warn('[BooruImageCard] URL 缺少协议，尝试修复:', url);
      url = 'https://' + url;
    }
    
    // 注意：不要解码 URL，因为 yande.re 的 URL 中的 %20 等编码是必需的
    // 浏览器会自动处理 URL 编码
    
    console.log('[BooruImageCard] 最终图片URL:', url.substring(0, 100) + '...', 'postId:', post.postId);
    return url;
  };
  const [loading, setLoading] = useState(false);

  const handleDownload = () => {
    console.log('[BooruImageCard] 点击下载按钮:', post.postId);
    setLoading(true);
    onDownload(post);
    // 模拟加载完成
    setTimeout(() => {
      setLoading(false);
    }, 1000);
  };

  const handleToggleFavorite = () => {
    console.log('[BooruImageCard] 点击收藏按钮:', post.postId, '当前状态:', isFavorited);
    onToggleFavorite(post);
  };

  const handlePreview = () => {
    console.log('[BooruImageCard] 点击图片预览:', post.postId);
    onPreview(post);
  };

  const ratingColor = post.rating === 'safe'
    ? 'green'
    : post.rating === 'questionable'
    ? 'orange'
    : 'red';

  const ratingText = post.rating === 'safe'
    ? '安全'
    : post.rating === 'questionable'
    ? '存疑'
    : '限制级';

  return (
    <Card
      hoverable
      bodyStyle={{ padding: 8, height: '100%' }}
      style={{
        height: '100%',
        borderRadius: 8,
        overflow: 'hidden'
      }}
      cover={
        <div
          style={{
            position: 'relative',
            cursor: 'pointer',
            overflow: 'hidden'
          }}
          onClick={handlePreview}
        >
          <img
            src={getPreviewUrl()}
            alt={`Post ${post.postId}`}
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
              minHeight: '100px',
              objectFit: 'contain'
            }}
            loading="lazy"
            onError={(e) => {
              console.error('[BooruImageCard] 图片加载失败:', {
                postId: post.postId,
                src: getPreviewUrl(),
                error: e,
                target: e.target
              });
              // 尝试使用 fallback
              if (e.target && e.target instanceof HTMLImageElement) {
                e.target.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
              }
            }}
            onLoad={() => {
              console.log('[BooruImageCard] 图片加载成功:', post.postId);
            }}
          />
          {/* 右上角操作按钮组 */}
          <Space
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              gap: 4
            }}
          >
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                handlePreview();
              }}
              style={{
                background: 'rgba(0,0,0,0.6)',
                color: '#fff',
                border: 'none'
              }}
              title="预览"
            />
            <Button
              type="text"
              size="small"
              icon={isFavorited ? <HeartFilled /> : <HeartOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                handleToggleFavorite();
              }}
              style={{
                background: 'rgba(0,0,0,0.6)',
                color: isFavorited ? '#ff4d4f' : '#fff',
                border: 'none'
              }}
              title={isFavorited ? '取消收藏' : '收藏'}
              danger={isFavorited}
            />
            <Button
              type="text"
              size="small"
              icon={<DownloadOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                handleDownload();
              }}
              style={{
                background: 'rgba(0,0,0,0.6)',
                color: '#fff',
                border: 'none'
              }}
              title="下载"
              loading={loading}
            />
          </Space>
        </div>
      }
    >
      {/* 底部信息 */}
      <div style={{ padding: '4px 0' }}>
        {/* 顶部标签行：站点、评分、分级 */}
        <Space size={4} style={{ marginBottom: 4 }} wrap>
          <Tag color="blue" style={{ fontSize: '12px' }}>
            {siteName}
          </Tag>
          {post.score !== undefined && post.score !== null && (
            <Tag color="geekblue" style={{ fontSize: '12px' }}>
              评分: {post.score}
            </Tag>
          )}
          <Tag color={ratingColor} style={{ fontSize: '12px' }}>
            {ratingText}
          </Tag>
        </Space>

        {/* 标签显示 */}
        {post.tags && (
          <div style={{ marginTop: 4 }}>
            <Space size={2} wrap>
              {formatTags(post.tags).map((tag, index) => (
                <Tag
                  key={index}
                  style={{
                    fontSize: 10,
                    padding: '0 4px',
                    marginBottom: 2
                  }}
                >
                  {tag}
                </Tag>
              ))}
            </Space>
          </div>
        )}

        {/* 尺寸和ID信息 */}
        <Space size={4} style={{ marginTop: 4 }}>
          {post.width && post.height && (
            <span style={{ fontSize: 11, color: '#666' }}>
              {post.width}×{post.height}
            </span>
          )}
          <span style={{ fontSize: 11, color: '#999' }}>
            ID: {post.postId}
          </span>
        </Space>
      </div>
    </Card>
  );
};

export default BooruImageCard;
