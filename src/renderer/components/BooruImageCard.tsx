import React, { useState, useMemo } from 'react';
import { Card, Image, Tag, Space, Button, message, Modal } from 'antd';
import { BookOutlined, BookFilled, DownloadOutlined, EyeOutlined, ReloadOutlined, PictureOutlined, CopyOutlined, GlobalOutlined, SearchOutlined, HeartOutlined, HeartFilled, InfoCircleOutlined, LinkOutlined } from '@ant-design/icons';
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
  previewUrl?: string;
  onImageLoad?: (postId: number, height: number) => void;
  siteUrl?: string;
  onTagClick?: (tag: string) => void;
  onToggleServerFavorite?: (post: BooruPost) => void;
  isServerFavorited?: boolean;
}

// 格式化标签
const formatTags = (tags: string): string[] => {
  if (!tags) return [];
  return tags.split(' ').slice(0, 10);
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
  onTagClick,
  onToggleServerFavorite,
  isServerFavorited = false
}) => {
  // 获取预览图URL
  const getPreviewUrl = (): string => {
    let url = (previewUrl || post.previewUrl || post.sampleUrl || post.fileUrl || '').trim();
    if (!url) return '';
    if (url.startsWith('//')) url = 'https:' + url;
    else if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('app://')) url = 'https://' + url;
    return url;
  };

  const [loading, setLoading] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  // 动画反馈状态：'bounce' 成功 | 'shake' 失败 | null 无
  const [favAnim, setFavAnim] = useState<string | null>(null);
  const [heartAnim, setHeartAnim] = useState<string | null>(null);

  const triggerAnim = (setter: (v: string | null) => void, cls: string) => {
    setter(cls);
    setTimeout(() => setter(null), 400);
  };

  const handleDownload = () => {
    console.log('[BooruImageCard] 点击下载按钮:', post.postId);
    setLoading(true);
    onDownload(post);
    setTimeout(() => setLoading(false), 1000);
  };

  const handleToggleFavorite = () => {
    console.log('[BooruImageCard] 点击收藏按钮:', post.postId, '当前状态:', isFavorited);
    onToggleFavorite(post);
    triggerAnim(setFavAnim, 'overlay-btn-bounce');
  };

  const handleToggleServerFavorite = () => {
    if (onToggleServerFavorite) {
      console.log('[BooruImageCard] 点击喜欢按钮:', post.postId, '当前状态:', isServerFavorited);
      onToggleServerFavorite(post);
      triggerAnim(setHeartAnim, 'overlay-btn-bounce');
    }
  };

  const handlePreview = () => {
    console.log('[BooruImageCard] 点击图片预览:', post.postId);
    onPreview(post);
  };

  const postPageUrl = siteUrl ? `${siteUrl.replace(/\/$/, '')}/post/show/${post.postId}` : '';

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
      ...(onToggleServerFavorite ? [{ key: 'server-favorite', label: isServerFavorited ? '取消喜欢' : '喜欢', icon: isServerFavorited ? <HeartFilled /> : <HeartOutlined />, onClick: handleToggleServerFavorite }] : []),
      { key: 'download', label: '下载', icon: <DownloadOutlined />, onClick: handleDownload },
      { type: 'divider' },
      { key: 'copyImageUrl', label: '复制原图链接', icon: <CopyOutlined />, onClick: () => {
        const url = getFullFileUrl();
        if (url) {
          navigator.clipboard.writeText(url);
          message.success('已复制原图链接');
        }
      }},
      { key: 'copyPreviewUrl', label: '复制预览图链接', icon: <LinkOutlined />, onClick: () => {
        const url = getPreviewUrl();
        if (url) {
          navigator.clipboard.writeText(url);
          message.success('已复制预览图链接');
        }
      }},
    ];
    if (postPageUrl) {
      items.push({ key: 'openInBrowser', label: '在浏览器中打开', icon: <GlobalOutlined />, onClick: () => {
        console.log('[BooruImageCard] 在浏览器中打开:', postPageUrl);
        window.electronAPI?.system.openExternal(postPageUrl);
      }});
    }
    items.push({ type: 'divider' });
    items.push({ key: 'imageInfo', label: '查看图片信息', icon: <InfoCircleOutlined />, onClick: () => {
      const fileUrl = getFullFileUrl();
      const ext = fileUrl ? fileUrl.split('.').pop()?.split('?')[0]?.toUpperCase() || '未知' : '未知';
      Modal.info({
        title: `图片信息 #${post.postId}`,
        content: (
          <div style={{ lineHeight: 2 }}>
            <div><strong>ID：</strong>{post.postId}</div>
            {post.width && post.height && <div><strong>尺寸：</strong>{post.width} × {post.height}</div>}
            {post.fileSize && <div><strong>文件大小：</strong>{(post.fileSize / 1024 / 1024).toFixed(2)} MB</div>}
            <div><strong>格式：</strong>{ext}</div>
            {post.rating && <div><strong>分级：</strong>{post.rating}</div>}
            {post.score !== undefined && post.score !== null && <div><strong>评分：</strong>{post.score}</div>}
            {post.md5 && <div><strong>MD5：</strong><span style={{ fontSize: 11, wordBreak: 'break-all' }}>{post.md5}</span></div>}
            {post.source && <div><strong>来源：</strong><a onClick={() => { window.electronAPI?.system.openExternal(post.source!); }} style={{ cursor: 'pointer', wordBreak: 'break-all' }}>{post.source}</a></div>}
          </div>
        ),
        okText: '关闭',
        width: 420,
      });
    }});
    return items;
  }, [isFavorited, isServerFavorited, postPageUrl, post.fileUrl, post.postId, post.width, post.height, post.fileSize, post.rating, post.score, post.md5, post.source]);

  // iOS 风格评分颜色
  const ratingConfig = post.rating === 'safe'
    ? { bg: 'rgba(52, 199, 89, 0.12)', color: colors.ratingSafe, text: '安全' }
    : post.rating === 'questionable'
    ? { bg: 'rgba(255, 149, 0, 0.12)', color: colors.ratingQuestionable, text: '存疑' }
    : { bg: 'rgba(255, 59, 48, 0.12)', color: colors.ratingExplicit, text: '限制级' };

  return (
    <ContextMenu items={cardContextItems}>
    <div
      className="card-ios-hover"
      style={{
        height: '100%',
        borderRadius: radius.md,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: colors.bgBase,
        boxShadow: shadows.card,
        border: `1px solid ${colors.borderCard}`,
      }}
    >
      {/* 图片区域 */}
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
        {/* 加载占位 — shimmer 骨架 */}
        {!imageLoaded && !imageError && (
          <div
            className="ios-skeleton-shimmer"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 0,
            }}
          >
            <PictureOutlined style={{ fontSize: 28, color: colors.textQuaternary || colors.textTertiary }} />
          </div>
        )}

        {/* 加载失败 */}
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
            <PictureOutlined style={{ fontSize: 28, color: colors.textTertiary }} />
            <span style={{ fontSize: fontSize.sm, color: colors.textTertiary }}>加载失败</span>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                setImageError(false);
                setImageLoaded(false);
              }}
              style={{ borderRadius: radius.sm }}
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
            transition: 'opacity 0.4s ease, filter 0.4s ease',
            filter: imageLoaded ? 'blur(0)' : 'blur(8px)',
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

        {/* 右上角操作按钮组 — iOS 圆形毛玻璃按钮，hover 时显示，竖排 */}
        <div
          className={`card-overlay-buttons${isFavorited || isServerFavorited ? ' has-active' : ''}`}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <button
            className="overlay-btn"
            onClick={(e) => { e.stopPropagation(); handlePreview(); }}
            title="预览"
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'rgba(0, 0, 0, 0.35)',
              backdropFilter: 'blur(8px)',
              border: 'none',
              color: '#FFFFFF',
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.2s, transform 0.15s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.55)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.35)'}
          >
            <EyeOutlined />
          </button>
          {onToggleServerFavorite && (
            <button
              className={`overlay-btn${heartAnim ? ` ${heartAnim}` : ''}`}
              onClick={(e) => { e.stopPropagation(); handleToggleServerFavorite(); }}
              title={isServerFavorited ? '取消喜欢' : '喜欢'}
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: isServerFavorited ? 'rgba(255, 45, 85, 0.85)' : 'rgba(0, 0, 0, 0.35)',
                backdropFilter: 'blur(8px)',
                border: 'none',
                color: '#FFFFFF',
                fontSize: 14,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.2s, transform 0.15s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = isServerFavorited ? 'rgba(255, 45, 85, 1)' : 'rgba(0, 0, 0, 0.55)'}
              onMouseLeave={(e) => e.currentTarget.style.background = isServerFavorited ? 'rgba(255, 45, 85, 0.85)' : 'rgba(0, 0, 0, 0.35)'}
            >
              {isServerFavorited ? <HeartFilled /> : <HeartOutlined />}
            </button>
          )}
          <button
            className={`overlay-btn${favAnim ? ` ${favAnim}` : ''}`}
            onClick={(e) => { e.stopPropagation(); handleToggleFavorite(); }}
            title={isFavorited ? '取消收藏' : '收藏'}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: isFavorited ? 'rgba(255, 149, 0, 0.85)' : 'rgba(0, 0, 0, 0.35)',
              backdropFilter: 'blur(8px)',
              border: 'none',
              color: '#FFFFFF',
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.2s, transform 0.15s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = isFavorited ? 'rgba(255, 149, 0, 1)' : 'rgba(0, 0, 0, 0.55)'}
            onMouseLeave={(e) => e.currentTarget.style.background = isFavorited ? 'rgba(255, 149, 0, 0.85)' : 'rgba(0, 0, 0, 0.35)'}
          >
            {isFavorited ? <BookFilled /> : <BookOutlined />}
          </button>
          <button
            className="overlay-btn"
            onClick={(e) => { e.stopPropagation(); handleDownload(); }}
            title="下载"
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'rgba(0, 0, 0, 0.35)',
              backdropFilter: 'blur(8px)',
              border: 'none',
              color: '#FFFFFF',
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.2s, transform 0.15s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.55)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.35)'}
          >
            <DownloadOutlined />
          </button>
        </div>
      </div>

      {/* 底部信息区 */}
      <div style={{ padding: `${spacing.sm}px ${spacing.md}px ${spacing.md}px` }}>
        {/* 评分行：站点 + 评分 + 分级 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          {/* 站点胶囊标签 */}
          <span style={{
            fontSize: fontSize.xs,
            fontWeight: 600,
            color: colors.primary,
            background: colors.primaryBg,
            padding: '2px 8px',
            borderRadius: radius.pill,
          }}>
            {siteName}
          </span>
          {/* 评分 */}
          {post.score !== undefined && post.score !== null && (
            <span style={{
              fontSize: fontSize.xs,
              fontWeight: 600,
              color: colors.textSecondary,
              background: colors.bgLight,
              padding: '2px 8px',
              borderRadius: radius.pill,
            }}>
              {post.score}
            </span>
          )}
          {/* 分级胶囊 */}
          <span style={{
            fontSize: fontSize.xs,
            fontWeight: 600,
            color: ratingConfig.color,
            background: ratingConfig.bg,
            padding: '2px 8px',
            borderRadius: radius.pill,
          }}>
            {ratingConfig.text}
          </span>
        </div>

        {/* 标签 */}
        {post.tags && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
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
                <span
                  style={{
                    fontSize: fontSize.xs,
                    color: colors.textTertiary,
                    background: colors.bgLight,
                    padding: '1px 7px',
                    borderRadius: radius.pill,
                    cursor: onTagClick ? 'pointer' : 'default',
                    transition: 'color 0.15s, background 0.15s',
                  }}
                  onClick={() => onTagClick?.(tag)}
                  onMouseEnter={(e) => {
                    if (onTagClick) {
                      e.currentTarget.style.color = colors.primary;
                      e.currentTarget.style.background = colors.primaryBg;
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = colors.textTertiary;
                    e.currentTarget.style.background = colors.bgLight;
                  }}
                >
                  {tag}
                </span>
              </ContextMenu>
            ))}
          </div>
        )}

        {/* 尺寸和ID */}
        <div style={{ display: 'flex', gap: 8 }}>
          {post.width && post.height && (
            <span style={{ fontSize: fontSize.xs, color: colors.textTertiary }}>
              {post.width}x{post.height}
            </span>
          )}
          <span style={{ fontSize: fontSize.xs, color: colors.textQuaternary || colors.textTertiary }}>
            #{post.postId}
          </span>
        </div>
      </div>
    </div>
    </ContextMenu>
  );
});

BooruImageCard.displayName = 'BooruImageCard';

export default BooruImageCard;
