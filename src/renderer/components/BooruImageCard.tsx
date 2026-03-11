/**
 * Booru 图片卡片 — 插画站风格
 * 全出血图片 + 悬停渐变遮罩 + 精简信息
 */
import React, { useState, useMemo, useCallback } from 'react';
import { message, Modal } from 'antd';
import {
  BookOutlined, BookFilled, DownloadOutlined, EyeOutlined,
  ReloadOutlined, PictureOutlined, CopyOutlined, GlobalOutlined,
  SearchOutlined, HeartOutlined, HeartFilled, InfoCircleOutlined,
  LinkOutlined, PlayCircleFilled
} from '@ant-design/icons';
import { BooruPost } from '../../shared/types';
import { colors, radius, shadows, fontSize } from '../styles/tokens';
import { ContextMenu } from './ContextMenu';

// --- 静态样式常量 ---
const overlayBtnBase: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: '50%',
  backdropFilter: 'blur(8px)',
  border: 'none',
  color: '#FFFFFF',
  fontSize: 14,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.2s, transform 0.15s',
};

const overlayBtnGroupStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  zIndex: 3,
};

// 视频检测
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mkv', 'mov', 'avi']);
const isVideoPost = (post: BooruPost): boolean => {
  if (post.fileExt && VIDEO_EXTENSIONS.has(post.fileExt.toLowerCase())) return true;
  const url = post.fileUrl || '';
  const ext = url.split('.').pop()?.split('?')[0]?.toLowerCase() || '';
  return VIDEO_EXTENSIONS.has(ext);
};

interface BooruImageCardProps {
  post: BooruPost;
  siteName: string;
  onPreview: (post: BooruPost) => void;
  onDownload: (post: BooruPost) => void;
  onToggleFavorite: (post: BooruPost) => void;
  isFavorited?: boolean;
  previewUrl?: string;
  siteUrl?: string;
  onTagClick?: (tag: string) => void;
  onToggleServerFavorite?: (post: BooruPost) => void;
  isServerFavorited?: boolean;
}

export const BooruImageCard: React.FC<BooruImageCardProps> = React.memo(({
  post,
  siteName,
  onPreview,
  onDownload,
  onToggleFavorite,
  isFavorited = false,
  previewUrl,
  siteUrl,
  onTagClick,
  onToggleServerFavorite,
  isServerFavorited = false
}) => {
  const computedPreviewUrl = useMemo((): string => {
    let url = (previewUrl || post.previewUrl || post.sampleUrl || post.fileUrl || '').trim();
    if (!url) return '';
    if (url.startsWith('//')) url = 'https:' + url;
    else if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('app://')) url = 'https://' + url;
    return url;
  }, [previewUrl, post.previewUrl, post.sampleUrl, post.fileUrl]);

  const [loading, setLoading] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [favAnim, setFavAnim] = useState<string | null>(null);
  const [heartAnim, setHeartAnim] = useState<string | null>(null);

  const triggerAnim = useCallback((setter: (v: string | null) => void, cls: string) => {
    setter(cls);
    setTimeout(() => setter(null), 400);
  }, []);

  const handleDownload = useCallback(() => {
    console.log('[BooruImageCard] 下载:', post.postId);
    setLoading(true);
    onDownload(post);
    setTimeout(() => setLoading(false), 1000);
  }, [onDownload, post]);

  const handleToggleFavorite = useCallback(() => {
    console.log('[BooruImageCard] 收藏:', post.postId, isFavorited);
    onToggleFavorite(post);
    triggerAnim(setFavAnim, 'overlay-btn-bounce');
  }, [onToggleFavorite, post, isFavorited, triggerAnim]);

  const handleToggleServerFavorite = useCallback(() => {
    if (onToggleServerFavorite) {
      console.log('[BooruImageCard] 喜欢:', post.postId, isServerFavorited);
      onToggleServerFavorite(post);
      triggerAnim(setHeartAnim, 'overlay-btn-bounce');
    }
  }, [onToggleServerFavorite, post, isServerFavorited, triggerAnim]);

  const handlePreview = useCallback(() => {
    console.log('[BooruImageCard] 预览:', post.postId);
    onPreview(post);
  }, [onPreview, post]);

  const postPageUrl = useMemo(() =>
    siteUrl ? `${siteUrl.replace(/\/$/, '')}/post/show/${post.postId}` : '',
    [siteUrl, post.postId]
  );

  const fullFileUrl = useMemo((): string => {
    let url = (post.fileUrl || '').trim();
    if (!url) return '';
    if (url.startsWith('//')) url = 'https:' + url;
    else if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
    return url;
  }, [post.fileUrl]);

  // 右键菜单
  const cardContextItems = useMemo(() => {
    const items: any[] = [
      { key: 'preview', label: '预览', icon: <EyeOutlined />, onClick: handlePreview },
      { key: 'favorite', label: isFavorited ? '取消收藏' : '收藏', icon: isFavorited ? <BookFilled /> : <BookOutlined />, onClick: handleToggleFavorite },
      ...(onToggleServerFavorite ? [{ key: 'server-favorite', label: isServerFavorited ? '取消喜欢' : '喜欢', icon: isServerFavorited ? <HeartFilled /> : <HeartOutlined />, onClick: handleToggleServerFavorite }] : []),
      { key: 'download', label: '下载', icon: <DownloadOutlined />, onClick: handleDownload },
      { type: 'divider' },
      { key: 'copyImageUrl', label: '复制原图链接', icon: <CopyOutlined />, onClick: () => {
        if (fullFileUrl) { navigator.clipboard.writeText(fullFileUrl); message.success('已复制原图链接'); }
      }},
      { key: 'copyPreviewUrl', label: '复制预览图链接', icon: <LinkOutlined />, onClick: () => {
        if (computedPreviewUrl) { navigator.clipboard.writeText(computedPreviewUrl); message.success('已复制预览图链接'); }
      }},
    ];
    if (postPageUrl) {
      items.push({ key: 'openInBrowser', label: '在浏览器中打开', icon: <GlobalOutlined />, onClick: () => {
        window.electronAPI?.system.openExternal(postPageUrl);
      }});
    }
    items.push({ type: 'divider' });
    items.push({ key: 'imageInfo', label: '查看图片信息', icon: <InfoCircleOutlined />, onClick: () => {
      const ext = fullFileUrl ? fullFileUrl.split('.').pop()?.split('?')[0]?.toUpperCase() || '未知' : '未知';
      Modal.info({
        title: `#${post.postId}`,
        content: (
          <div style={{ lineHeight: 2 }}>
            {post.width && post.height && <div><strong>尺寸：</strong>{post.width} x {post.height}</div>}
            {post.fileSize && <div><strong>大小：</strong>{(post.fileSize / 1024 / 1024).toFixed(2)} MB</div>}
            <div><strong>格式：</strong>{ext}</div>
            {post.rating && <div><strong>分级：</strong>{post.rating}</div>}
            {post.score !== undefined && post.score !== null && <div><strong>评分：</strong>{post.score}</div>}
            {post.md5 && <div><strong>MD5：</strong><span style={{ fontSize: 11, wordBreak: 'break-all' }}>{post.md5}</span></div>}
            {post.source && <div><strong>来源：</strong><a onClick={() => window.electronAPI?.system.openExternal(post.source!)} style={{ cursor: 'pointer', wordBreak: 'break-all' }}>{post.source}</a></div>}
          </div>
        ),
        okText: '关闭',
        width: 420,
      });
    }});
    return items;
  }, [handlePreview, handleToggleFavorite, handleToggleServerFavorite, handleDownload, isFavorited, isServerFavorited, postPageUrl, fullFileUrl, computedPreviewUrl, post.postId, post.width, post.height, post.fileSize, post.rating, post.score, post.md5, post.source]);

  // 评分色
  const ratingConfig = post.rating === 'safe'
    ? { color: colors.ratingSafe, text: 'S' }
    : post.rating === 'questionable'
    ? { color: colors.ratingQuestionable, text: 'Q' }
    : { color: colors.ratingExplicit, text: 'E' };

  return (
    <ContextMenu items={cardContextItems}>
      <div
        className="card-ios-hover"
        style={{
          position: 'relative',
          borderRadius: radius.sm,
          overflow: 'hidden',
          cursor: 'pointer',
          background: colors.bgElevated,
        }}
        onClick={handlePreview}
      >
        {/* 图片区域 — 全出血 */}
        <div style={{ position: 'relative', width: '100%' }}>
          {/* 骨架占位 */}
          {!imageLoaded && !imageError && (
            <div
              className="ios-skeleton-shimmer"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1,
              }}
            >
              <PictureOutlined style={{ fontSize: 28, color: colors.textQuaternary }} />
            </div>
          )}

          {/* 加载失败 */}
          {imageError && (
            <div style={{
              position: 'absolute',
              inset: 0,
              background: colors.bgGray,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              zIndex: 1,
            }}>
              <PictureOutlined style={{ fontSize: 28, color: colors.textTertiary }} />
              <span style={{ fontSize: fontSize.sm, color: colors.textTertiary }}>加载失败</span>
              <button
                onClick={(e) => { e.stopPropagation(); setImageError(false); setImageLoaded(false); }}
                style={{
                  ...overlayBtnBase,
                  width: 'auto',
                  height: 'auto',
                  padding: '4px 12px',
                  borderRadius: radius.xs,
                  background: colors.primaryBg,
                  color: colors.primary,
                  fontSize: fontSize.sm,
                }}
              >
                <ReloadOutlined style={{ marginRight: 4 }} /> 重试
              </button>
            </div>
          )}

          <img
            src={imageError ? undefined : computedPreviewUrl}
            alt={`#${post.postId}`}
            style={{
              width: '100%',
              display: imageError ? 'none' : 'block',
              opacity: imageLoaded ? 1 : 0,
              transition: 'opacity 0.35s ease',
              verticalAlign: 'bottom',
            }}
            loading="lazy"
            onError={() => { setImageError(true); setImageLoaded(false); }}
            onLoad={() => { setImageLoaded(true); setImageError(false); }}
          />

          {/* 视频播放图标 */}
          {isVideoPost(post) && imageLoaded && !imageError && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none', zIndex: 2,
            }}>
              <PlayCircleFilled style={{ fontSize: 48, color: 'rgba(255,255,255,0.85)', filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.6))' }} />
            </div>
          )}

          {/* 视频格式徽章 */}
          {isVideoPost(post) && (
            <div style={{
              position: 'absolute', bottom: 6, left: 6,
              background: 'rgba(0,0,0,0.65)', color: '#fff',
              fontSize: 10, fontWeight: 600, padding: '1px 6px',
              borderRadius: 4, letterSpacing: 0.5, pointerEvents: 'none', zIndex: 3,
            }}>
              {(post.fileExt || 'VIDEO').toUpperCase()}
            </div>
          )}

          {/* 左上角：分级徽章（始终可见） */}
          <div style={{
            position: 'absolute', top: 8, left: 8,
            display: 'flex', gap: 4, zIndex: 3,
          }}>
            <span style={{
              fontSize: 10, fontWeight: 700,
              color: '#fff',
              background: ratingConfig.color,
              padding: '2px 6px',
              borderRadius: 4,
              lineHeight: '14px',
              letterSpacing: 0.5,
              textShadow: '0 1px 2px rgba(0,0,0,0.3)',
            }}>
              {ratingConfig.text}
            </span>
            {post.score !== undefined && post.score !== null && post.score > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700,
                color: '#fff',
                background: 'rgba(0,0,0,0.50)',
                backdropFilter: 'blur(4px)',
                padding: '2px 6px',
                borderRadius: 4,
                lineHeight: '14px',
                fontFamily: 'var(--font-mono, monospace)',
              }}>
                {post.score >= 1000 ? `${(post.score / 1000).toFixed(1)}k` : post.score}
              </span>
            )}
          </div>

          {/* 右上角操作按钮组 — hover 时显示 */}
          <div
            className={`card-overlay-buttons${isFavorited || isServerFavorited ? ' has-active' : ''}`}
            style={overlayBtnGroupStyle}
          >
            {onToggleServerFavorite && (
              <button
                className={`overlay-btn${heartAnim ? ` ${heartAnim}` : ''}`}
                onClick={(e) => { e.stopPropagation(); handleToggleServerFavorite(); }}
                title={isServerFavorited ? '取消喜欢' : '喜欢'}
                style={{ ...overlayBtnBase, background: isServerFavorited ? colors.heartActive : 'rgba(0,0,0,0.40)' }}
                onMouseEnter={(e) => e.currentTarget.style.background = isServerFavorited ? 'rgba(236,72,153,1)' : 'rgba(0,0,0,0.60)'}
                onMouseLeave={(e) => e.currentTarget.style.background = isServerFavorited ? (colors.heartActive as string) : 'rgba(0,0,0,0.40)'}
              >
                {isServerFavorited ? <HeartFilled /> : <HeartOutlined />}
              </button>
            )}
            <button
              className={`overlay-btn${favAnim ? ` ${favAnim}` : ''}`}
              onClick={(e) => { e.stopPropagation(); handleToggleFavorite(); }}
              title={isFavorited ? '取消收藏' : '收藏'}
              style={{ ...overlayBtnBase, background: isFavorited ? colors.bookmarkActive : 'rgba(0,0,0,0.40)' }}
              onMouseEnter={(e) => e.currentTarget.style.background = isFavorited ? 'rgba(245,158,11,1)' : 'rgba(0,0,0,0.60)'}
              onMouseLeave={(e) => e.currentTarget.style.background = isFavorited ? (colors.bookmarkActive as string) : 'rgba(0,0,0,0.40)'}
            >
              {isFavorited ? <BookFilled /> : <BookOutlined />}
            </button>
            <button
              className="overlay-btn"
              onClick={(e) => { e.stopPropagation(); handleDownload(); }}
              title="下载"
              style={{ ...overlayBtnBase, background: 'rgba(0,0,0,0.40)' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.60)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.40)'}
            >
              <DownloadOutlined />
            </button>
          </div>

          {/* 底部渐变遮罩 + 信息 — hover 时显示 */}
          <div
            className="card-overlay-gradient"
            style={{
              position: 'absolute',
              bottom: 0, left: 0, right: 0,
              background: 'linear-gradient(transparent, rgba(0,0,0,0.65))',
              padding: '20px 10px 8px',
              zIndex: 2,
            }}
          >
            {/* 艺术家名（如有） */}
            {post.author && (
              <div
                style={{
                  fontSize: 11, fontWeight: 600,
                  color: 'rgba(255,255,255,0.90)',
                  marginBottom: 4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  cursor: onTagClick ? 'pointer' : 'default',
                }}
                onClick={(e) => {
                  if (onTagClick) { e.stopPropagation(); onTagClick(post.author!); }
                }}
                title={post.author}
              >
                {post.author.replace(/_/g, ' ')}
              </div>
            )}
            {/* 尺寸 + ID */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{
                fontSize: 10, color: 'rgba(255,255,255,0.60)',
                fontFamily: 'var(--font-mono, monospace)',
              }}>
                {post.width && post.height ? `${post.width}x${post.height}` : ''}
              </span>
              <span style={{
                fontSize: 10, color: 'rgba(255,255,255,0.40)',
                fontFamily: 'var(--font-mono, monospace)',
              }}>
                #{post.postId}
              </span>
            </div>
          </div>
        </div>
      </div>
    </ContextMenu>
  );
});

BooruImageCard.displayName = 'BooruImageCard';

export default BooruImageCard;
