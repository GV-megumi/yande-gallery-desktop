import React, { useState, useMemo } from 'react';
import { Card, Image, Tag, Space, Button, message } from 'antd';
import { BookOutlined, BookFilled, DownloadOutlined, EyeOutlined, ReloadOutlined, PictureOutlined, CopyOutlined, GlobalOutlined, SearchOutlined } from '@ant-design/icons';
import { BooruPost } from '../../shared/types';
import { colors, radius, shadows, transitions, spacing, fontSize } from '../styles/tokens';
import { ContextMenu } from './ContextMenu';

interface BooruImageCardProps {
  post: BooruPost;
  siteName: string;
  onPreview: (post: BooruPost) => void;
  onDownload: (post: BooruPost) => void;
  onToggleFavorite: (post: BooruPost) => void;
  isFavorited?: boolean;
  previewUrl?: string; // 可选的预览图URL，如果不提供则使用默认逻辑
  onImageLoad?: (postId: number, height: number) => void; // 图片加载完成回调
  siteUrl?: string; // 站点URL，用于在浏览器中打开原始页面
  onTagClick?: (tag: string) => void; // 标签点击回调
}

// 格式化标签
const formatTags = (tags: string): string[] => {
  if (!tags) return [];
  return tags.split(' ').slice(0, 10); // 最多显示10个标签
};

export const BooruImageCard: React.FC<BooruImageCardProps> = React.memo(({
  post,
  siteName,
  onPreview,
  onDownload,
  onToggleFavorite,
  isFavorited = false,
  previewUrl,
  onImageLoad,
  siteUrl,
  onTagClick
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

  // 构造原始页面URL（Moebooru 格式）
  const postPageUrl = siteUrl ? `${siteUrl.replace(/\/$/, '')}/post/show/${post.postId}` : '';

  // 获取完整的图片文件URL
  const getFullFileUrl = (): string => {
    let url = (post.fileUrl || '').trim();
    if (!url) return '';
    if (url.startsWith('//')) url = 'https:' + url;
    else if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
    return url;
  };

  // 右键菜单项
  const cardContextItems = useMemo(() => {
    const items: any[] = [
      { key: 'preview', label: '预览', icon: <EyeOutlined />, onClick: handlePreview },
      { key: 'favorite', label: isFavorited ? '取消收藏' : '收藏', icon: isFavorited ? <BookFilled /> : <BookOutlined />, onClick: handleToggleFavorite },
      { key: 'download', label: '下载', icon: <DownloadOutlined />, onClick: handleDownload },
      { type: 'divider' },
      { key: 'copyImageUrl', label: '复制图片链接', icon: <CopyOutlined />, onClick: () => {
        const url = getFullFileUrl();
        if (url) {
          navigator.clipboard.writeText(url);
          message.success('已复制图片链接');
        }
      }},
    ];
    if (postPageUrl) {
      items.push({ key: 'openInBrowser', label: '在浏览器中打开', icon: <GlobalOutlined />, onClick: () => {
        console.log('[BooruImageCard] 在浏览器中打开:', postPageUrl);
        window.electronAPI?.system.openExternal(postPageUrl);
      }});
    }
    return items;
  }, [isFavorited, postPageUrl, post.fileUrl]);

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
    <ContextMenu items={cardContextItems}>
    <Card
      hoverable
      styles={{ body: { padding: spacing.sm, height: '100%', display: 'flex', flexDirection: 'column' } }}
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
              gap: spacing.sm,
            }}>
              <PictureOutlined style={{ fontSize: 32, color: colors.borderGray }} />
              <span style={{ fontSize: fontSize.sm, color: colors.textTertiary }}>加载失败</span>
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
              top: spacing.xs,
              right: spacing.xs,
              gap: spacing.xs
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
      <div style={{ padding: `${spacing.xs}px 0` }}>
        {/* 顶部标签行：站点、评分、分级 */}
        <Space size={spacing.xs} style={{ marginBottom: spacing.xs }} wrap>
          <Tag color="blue" style={{ fontSize: fontSize.sm }}>
            {siteName}
          </Tag>
          {post.score !== undefined && post.score !== null && (
            <Tag color="geekblue" style={{ fontSize: fontSize.sm }}>
              评分: {post.score}
            </Tag>
          )}
          <Tag color={ratingColor} style={{ fontSize: fontSize.sm }}>
            {ratingText}
          </Tag>
        </Space>

        {/* 标签显示 */}
        {post.tags && (
          <div style={{ marginTop: spacing.xs }}>
            <Space size={2} wrap>
              {formatTags(post.tags).map((tag, index) => (
                <ContextMenu
                  key={index}
                  items={[
                    { key: 'copy', label: '复制标签', icon: <CopyOutlined />, onClick: () => {
                      navigator.clipboard.writeText(tag);
                      message.success('已复制标签');
                    }},
                    ...(onTagClick ? [{ key: 'search', label: '按该标签搜索', icon: <SearchOutlined />, onClick: () => onTagClick(tag) }] : []),
                  ]}
                >
                  <Tag
                    style={{
                      fontSize: fontSize.xs,
                      padding: `0 ${spacing.xs}px`,
                      marginBottom: 2,
                      cursor: onTagClick ? 'pointer' : 'default'
                    }}
                    onClick={() => onTagClick?.(tag)}
                  >
                    {tag}
                  </Tag>
                </ContextMenu>
              ))}
            </Space>
          </div>
        )}

        {/* 尺寸和ID信息 */}
        <Space size={spacing.xs} style={{ marginTop: spacing.xs }}>
          {post.width && post.height && (
            <span style={{ fontSize: fontSize.xs, color: colors.textSecondary }}>
              {post.width}×{post.height}
            </span>
          )}
          <span style={{ fontSize: fontSize.xs, color: colors.textTertiary }}>
            ID: {post.postId}
          </span>
        </Space>
      </div>
    </Card>
    </ContextMenu>
  );
});

BooruImageCard.displayName = 'BooruImageCard';

export default BooruImageCard;
