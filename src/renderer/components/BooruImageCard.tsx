import React, { useState } from 'react';
import { Card, Image, Tag, Space, Button, message } from 'antd';
import { BookOutlined, BookFilled, DownloadOutlined, EyeOutlined, ReloadOutlined, PictureOutlined } from '@ant-design/icons';
import { BooruPost } from '../../shared/types';
import { colors, radius, shadows, transitions } from '../styles/tokens';

interface BooruImageCardProps {
  post: BooruPost;
  siteName: string;
  onPreview: (post: BooruPost) => void;
  onDownload: (post: BooruPost) => void;
  onToggleFavorite: (post: BooruPost) => void;
  isFavorited?: boolean;
  previewUrl?: string; // 可选的预览图URL，如果不提供则使用默认逻辑
  onImageLoad?: (postId: number, height: number) => void; // 图片加载完成回调
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
  previewUrl,
  onImageLoad
}) => {
  // 获取预览图URL：优先使用外部传入的 previewUrl，否则按优先级选择
  const getPreviewUrl = (): string => {
    let url = (previewUrl || post.previewUrl || post.sampleUrl || post.fileUrl || '').trim();

    if (!url) return '';

    // 确保 URL 包含协议
    if (url.startsWith('//')) {
      url = 'https:' + url;
    } else if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('app://')) {
      url = 'https://' + url;
    }

    return url;
  };
  const [loading, setLoading] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

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
      styles={{ body: { padding: 8, height: '100%', display: 'flex', flexDirection: 'column' } }}
      style={{
        height: '100%',
        borderRadius: radius.md,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}
      cover={
        <div
          style={{
            position: 'relative',
            cursor: 'pointer',
            overflow: 'hidden',
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 0
          }}
          onClick={handlePreview}
        >
          {/* 图片加载占位背景 */}
          {!imageLoaded && !imageError && (
            <div style={{
              position: 'absolute',
              inset: 0,
              background: colors.bgLight,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <PictureOutlined style={{ fontSize: 32, color: colors.borderGray }} />
            </div>
          )}

          {/* 图片加载失败状态 */}
          {imageError && (
            <div style={{
              position: 'absolute',
              inset: 0,
              background: colors.bgLight,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}>
              <PictureOutlined style={{ fontSize: 32, color: colors.borderGray }} />
              <span style={{ fontSize: 12, color: colors.textTertiary }}>加载失败</span>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  setImageError(false);
                  setImageLoaded(false);
                }}
              >
                重试
              </Button>
            </div>
          )}

          <img
            src={imageError ? undefined : getPreviewUrl()}
            alt={`Post ${post.postId}`}
            style={{
              width: '100%',
              height: '100%',
              display: imageError ? 'none' : 'block',
              objectFit: 'contain',
              opacity: imageLoaded ? 1 : 0,
              transition: 'opacity 0.3s ease',
            }}
            loading="lazy"
            onError={() => {
              setImageError(true);
              setImageLoaded(false);
            }}
            onLoad={(e) => {
              setImageLoaded(true);
              setImageError(false);
              if (onImageLoad && e.target && e.target instanceof HTMLImageElement) {
                const height = e.target.offsetHeight || e.target.naturalHeight;
                onImageLoad(post.postId, height);
              }
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
                background: colors.overlayDark,
                color: '#fff',
                border: 'none'
              }}
              title="预览"
            />
            <Button
              type="text"
              size="small"
              icon={isFavorited ? <BookFilled /> : <BookOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                handleToggleFavorite();
              }}
              style={{
                background: colors.overlayDark,
                color: isFavorited ? colors.danger : '#fff',
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
                background: colors.overlayDark,
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
            <span style={{ fontSize: 11, color: colors.textSecondary }}>
              {post.width}×{post.height}
            </span>
          )}
          <span style={{ fontSize: 11, color: colors.textTertiary }}>
            ID: {post.postId}
          </span>
        </Space>
      </div>
    </Card>
  );
};

export default BooruImageCard;
