import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Modal, Space, Button, Tooltip, Slider } from 'antd';
import { LeftOutlined, RightOutlined, CloseOutlined, PlayCircleOutlined, PauseCircleOutlined, RotateLeftOutlined, RotateRightOutlined, BorderOutlined } from '@ant-design/icons';

// 检测是否为视频格式
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mkv', 'mov', 'avi']);
function isVideoPost(post: { fileExt?: string; fileUrl?: string } | null): boolean {
  if (!post) return false;
  if (post.fileExt && VIDEO_EXTENSIONS.has(post.fileExt.toLowerCase())) return true;
  const url = post.fileUrl || '';
  const ext = url.split('.').pop()?.split('?')[0]?.toLowerCase() || '';
  return VIDEO_EXTENSIONS.has(ext);
}
import { BooruPost, BooruSite } from '../../shared/types';
import { InformationSection } from '../components/BooruPostDetails/InformationSection';
import { Toolbar } from '../components/BooruPostDetails/Toolbar';
import { TagsSection } from '../components/BooruPostDetails/TagsSection';
import { FileDetailsSection } from '../components/BooruPostDetails/FileDetailsSection';
import { RelatedPostsSection } from '../components/BooruPostDetails/RelatedPostsSection';
import { CommentSection } from '../components/BooruPostDetails/CommentSection';
import { NotesOverlay } from '../components/BooruPostDetails/NotesOverlay';
import { PostHistorySection } from '../components/BooruPostDetails/PostHistorySection';
import { colors, spacing, radius, fontSize } from '../styles/tokens';
import { buildViewerTransform, getComparablePreviewUrl, rotateBy } from '../utils/viewerControls';

interface BooruPostDetailsPageProps {
  open: boolean;
  post: BooruPost | null;
  site: BooruSite | null;
  posts?: BooruPost[]; // 用于导航到上一张/下一张
  /** @deprecated 不再使用，索引通过 post.postId 在 posts 中自动定位 */
  initialIndex?: number;
  onClose: () => void;
  onToggleFavorite?: (post: BooruPost) => void;
  onDownload?: (post: BooruPost) => void;
  onTagClick?: (tag: string) => void;
  onArtistClick?: (artistName: string) => void;
  onCharacterClick?: (characterName: string) => void;
  /** 服务端喜欢状态判断（传入当前 post 是否已喜欢） */
  isServerFavorited?: (post: BooruPost) => boolean;
  /** 服务端喜欢切换回调 */
  onToggleServerFavorite?: (post: BooruPost) => void;
  /** 页面挂起时隐藏 Modal（不触发关闭/打开动画） */
  suspended?: boolean;
}

/**
 * Booru 图片详情页面
 * 参考 Boorusama 的实现，包含：
 * - 图片展示区域（可缩放、拖拽）
 * - 信息部分（角色、艺术家、版权、创建时间、来源）
 * - 工具栏（收藏、下载、幻灯片等）
 * - 标签部分（可展开/折叠，按分类显示）
 * - 文件详情（ID、评分、文件大小、分辨率、格式、上传者）
 * - 相关帖子（相关图片）
 */
export const BooruPostDetailsPage: React.FC<BooruPostDetailsPageProps> = ({
  open,
  post,
  site,
  posts = [],
  initialIndex = 0,
  onClose,
  onToggleFavorite,
  onDownload,
  onTagClick,
  onArtistClick,
  onCharacterClick,
  isServerFavorited,
  onToggleServerFavorite,
  suspended = false
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [imageScale, setImageScale] = useState(1);
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [previewQuality, setPreviewQuality] = useState<'auto' | 'low' | 'medium' | 'high' | 'original'>('auto');
  const [imageUrl, setImageUrl] = useState<string>('');
  const [isCaching, setIsCaching] = useState(false);
  const [imageMetadata, setImageMetadata] = useState<{
    format?: string;
    width?: number;
    height?: number;
    space?: string;
    density?: number;
    hasAlpha?: boolean;
    orientation?: number;
    channels?: number;
    hasExif: boolean;
    pathSource: 'local' | 'cache';
  } | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);

  // 幻灯片模式
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [slideshowInterval, setSlideshowInterval] = useState(5); // 秒
  const slideshowTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 记录已同步的 postId，用于区分"索引未同步"和"用户手动导航"
  const [syncedPostId, setSyncedPostId] = useState<number | null>(null);

  // 通过 useEffect 同步索引（弹窗打开或 post 变化时）
  useEffect(() => {
    if (open && post && posts.length > 0) {
      const idx = posts.findIndex(p => p.postId === post.postId);
      if (idx >= 0) {
        console.log('[BooruPostDetailsPage] 同步索引:', idx, 'postId:', post.postId);
        setCurrentIndex(idx);
        setSyncedPostId(post.postId);
      }
    }
  }, [open, post?.postId, posts]);

  // 弹窗关闭时重置同步状态
  useEffect(() => {
    if (!open) {
      setSyncedPostId(null);
    }
  }, [open]);

  // 当前显示的图片：
  // - 如果索引尚未同步（syncedPostId 与 post.postId 不一致），直接使用 post prop
  //   这避免了在 useEffect 同步前显示错误的图片（如第一张）
  // - 同步完成后，使用 posts[currentIndex]（支持左右箭头导航）
  const currentPost = useMemo(() => {
    if (post && syncedPostId !== post.postId) {
      // 索引尚未同步，直接显示点击的图片
      return post;
    }
    if (posts.length > 0 && currentIndex >= 0 && currentIndex < posts.length) {
      return posts[currentIndex];
    }
    return post;
  }, [post, posts, currentIndex, syncedPostId]);

  // 重置图片缩放和位置
  useEffect(() => {
    if (open && currentPost) {
      setImageScale(1);
      setImagePosition({ x: 0, y: 0 });
      setRotation(0);
      setFlipX(false);
      setFlipY(false);
      setCompareMode(false);
    }
  }, [open, currentPost]);

  useEffect(() => {
    if (!open || !currentPost || isVideoPost(currentPost)) {
      setImageMetadata(null);
      return;
    }

    let cancelled = false;
    const loadMetadata = async () => {
      setMetadataLoading(true);
      try {
        const result = await window.electronAPI.booru.getImageMetadata({
          localPath: currentPost.localPath,
          fileUrl: currentPost.fileUrl,
          md5: currentPost.md5,
          fileExt: currentPost.fileExt,
        });
        if (!cancelled) {
          setImageMetadata(result.success && result.data ? result.data : null);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('[BooruPostDetailsPage] 加载图片元数据失败:', error);
          setImageMetadata(null);
        }
      } finally {
        if (!cancelled) {
          setMetadataLoading(false);
        }
      }
    };

    void loadMetadata();
    return () => {
      cancelled = true;
    };
  }, [open, currentPost]);

  // 加载并缓存原图
  useEffect(() => {
    if (!open || !currentPost) {
      setImageUrl('');
      return;
    }

    const loadOriginalImage = async () => {
      // 优先使用本地路径
      if (currentPost.localPath) {
        try {
          let appUrl = currentPost.localPath;
          if (appUrl.match(/^[A-Z]:\\/)) {
            const driveLetter = appUrl[0].toLowerCase();
            const pathPart = appUrl.substring(3).replace(/\\/g, '/');
            appUrl = `app://${driveLetter}/${pathPart}`;
          } else if (appUrl.startsWith('/')) {
            appUrl = `app://${appUrl}`;
          }
          console.log('[BooruPostDetailsPage] 使用本地图片路径:', appUrl);
          setImageUrl(appUrl);
          return;
        } catch (e) {
          console.warn('[BooruPostDetailsPage] 本地路径转换失败:', e);
        }
      }

      // 如果没有原图 URL，使用 sampleUrl 或 previewUrl
      if (!currentPost.fileUrl) {
        const url = currentPost.sampleUrl || currentPost.previewUrl || '';
        console.log('[BooruPostDetailsPage] 没有原图URL，使用:', url ? 'sampleUrl/previewUrl' : '无');
        setImageUrl(url);
        return;
      }

      // 视频帖子直接使用原图 URL，不走缓存（视频文件过大）
      if (isVideoPost(currentPost)) {
        console.log('[BooruPostDetailsPage] 视频帖子，直接使用原图URL');
        setImageUrl(currentPost.fileUrl);
        return;
      }

      // 检查是否有 MD5 和扩展名
      if (!currentPost.md5 || !currentPost.fileExt) {
        console.warn('[BooruPostDetailsPage] 缺少 MD5 或扩展名，直接使用原图URL');
        setImageUrl(currentPost.fileUrl);
        return;
      }

      // 先检查缓存
      setIsCaching(true);
      try {
        const cachedUrlResult = await window.electronAPI.booru.getCachedImageUrl(currentPost.md5, currentPost.fileExt);
        if (cachedUrlResult.success && cachedUrlResult.data) {
          console.log('[BooruPostDetailsPage] 使用缓存图片:', cachedUrlResult.data);
          setImageUrl(cachedUrlResult.data);
          setIsCaching(false);
          return;
        }

        // 缓存不存在，下载并缓存
        console.log('[BooruPostDetailsPage] 缓存不存在，开始下载并缓存原图...');
        const cacheResult = await window.electronAPI.booru.cacheImage(
          currentPost.fileUrl,
          currentPost.md5,
          currentPost.fileExt
        );

        if (cacheResult.success && cacheResult.data) {
          console.log('[BooruPostDetailsPage] 原图缓存成功:', cacheResult.data);
          setImageUrl(cacheResult.data);
        } else {
          console.warn('[BooruPostDetailsPage] 原图缓存失败，使用原图URL:', cacheResult.error);
          setImageUrl(currentPost.fileUrl);
        }
      } catch (error) {
        console.error('[BooruPostDetailsPage] 加载原图失败:', error);
        setImageUrl(currentPost.fileUrl);
      } finally {
        setIsCaching(false);
      }
    };

    loadOriginalImage();
  }, [open, currentPost]);

  // 预加载前后3张图片（带并发控制和取消机制）
  useEffect(() => {
    if (!open || !posts.length || currentIndex < 0) {
      return;
    }

    let cancelled = false;

    const preloadImages = async () => {
      // 计算需要预加载的图片索引范围（前后各3张）
      const preloadRange = 3;
      const startIndex = Math.max(0, currentIndex - preloadRange);
      const endIndex = Math.min(posts.length - 1, currentIndex + preloadRange);

      console.log(`[BooruPostDetailsPage] 开始预加载图片: 索引 ${startIndex} 到 ${endIndex} (当前: ${currentIndex})`);

      // 收集需要预加载的图片（排除当前图片），优先加载相邻的
      const postsToPreload: BooruPost[] = [];
      // 先添加下一张和上一张（距离近的优先）
      for (let distance = 1; distance <= preloadRange; distance++) {
        if (currentIndex + distance <= endIndex && posts[currentIndex + distance]) {
          const p = posts[currentIndex + distance];
          if (p.fileUrl && p.md5 && p.fileExt && !p.localPath) postsToPreload.push(p);
        }
        if (currentIndex - distance >= startIndex && posts[currentIndex - distance]) {
          const p = posts[currentIndex - distance];
          if (p.fileUrl && p.md5 && p.fileExt && !p.localPath) postsToPreload.push(p);
        }
      }

      console.log(`[BooruPostDetailsPage] 需要预加载 ${postsToPreload.length} 张图片`);

      // 限制并发数为 2，逐批预加载
      const concurrency = 2;
      for (let i = 0; i < postsToPreload.length; i += concurrency) {
        if (cancelled) {
          console.log('[BooruPostDetailsPage] 预加载已取消（翻页）');
          return;
        }

        const batch = postsToPreload.slice(i, i + concurrency);
        await Promise.all(batch.map(async (post) => {
          if (cancelled) return;
          try {
            // 先检查缓存
            const cachedUrlResult = await window.electronAPI.booru.getCachedImageUrl(post.md5!, post.fileExt!);
            if (cancelled) return;
            if (cachedUrlResult.success && cachedUrlResult.data) {
              console.log(`[BooruPostDetailsPage] 预加载: 图片 ${post.postId} 已在缓存中`);
              return;
            }

            // 缓存不存在，后台下载
            console.log(`[BooruPostDetailsPage] 预加载: 开始下载图片 ${post.postId}...`);
            const cacheResult = await window.electronAPI.booru.cacheImage(
              post.fileUrl!,
              post.md5!,
              post.fileExt!
            );

            if (cancelled) return;
            if (cacheResult.success) {
              console.log(`[BooruPostDetailsPage] 预加载: 图片 ${post.postId} 缓存成功`);
            } else {
              console.warn(`[BooruPostDetailsPage] 预加载: 图片 ${post.postId} 缓存失败:`, cacheResult.error);
            }
          } catch (error) {
            if (!cancelled) {
              console.error(`[BooruPostDetailsPage] 预加载: 图片 ${post.postId} 失败:`, error);
            }
          }
        }));
      }
    };

    // 延迟一下，让当前图片先加载
    const timer = setTimeout(() => {
      preloadImages();
    }, 1000);

    return () => {
      // 翻页或关闭时取消旧的预加载任务
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, currentIndex, posts]);

  // 加载预览质量配置
  useEffect(() => {
    const loadPreviewQuality = async () => {
      try {
        if (!window.electronAPI) {
          console.error('[BooruPostDetailsPage] electronAPI is not available');
          return;
        }

        const result = await window.electronAPI.config.get();
        if (result.success && result.data) {
          const config = result.data;
          const booruConfig = config.booru || {};
          const appearanceConfig = booruConfig.appearance || {};
          const quality = appearanceConfig.previewQuality || 'auto';
          console.log('[BooruPostDetailsPage] 加载预览质量配置:', quality);
          setPreviewQuality(quality);
        }
      } catch (error) {
        console.error('[BooruPostDetailsPage] 加载预览质量配置失败:', error);
      }
    };

    if (open) {
      loadPreviewQuality();
    }
  }, [open]);


  // 上一张
  const handlePrevious = () => {
    if (posts.length > 0 && currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      console.log('[BooruPostDetailsPage] 上一张，索引:', currentIndex - 1);
    }
  };

  // 下一张
  const handleNext = () => {
    if (posts.length > 0 && currentIndex < posts.length - 1) {
      setCurrentIndex(currentIndex + 1);
      console.log('[BooruPostDetailsPage] 下一张，索引:', currentIndex + 1);
    }
  };

  // 键盘导航
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrevious();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, currentIndex, posts.length]);

  // 幻灯片自动播放
  useEffect(() => {
    if (slideshowActive && open && posts.length > 1) {
      slideshowTimerRef.current = setInterval(() => {
        setCurrentIndex(prev => {
          if (prev < posts.length - 1) {
            return prev + 1;
          }
          // 到最后一张时循环回第一张
          return 0;
        });
      }, slideshowInterval * 1000);
    }

    return () => {
      if (slideshowTimerRef.current) {
        clearInterval(slideshowTimerRef.current);
        slideshowTimerRef.current = null;
      }
    };
  }, [slideshowActive, open, posts.length, slideshowInterval]);

  // 关闭详情页时停止幻灯片
  useEffect(() => {
    if (!open) {
      setSlideshowActive(false);
    }
  }, [open]);

  // 图片缩放
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setImageScale(prev => Math.max(0.5, Math.min(3, prev + delta)));
    }
  };

  // 图片拖拽
  const handleMouseDown = (e: React.MouseEvent) => {
    if (imageScale > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - imagePosition.x, y: e.clientY - imagePosition.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && imageScale > 1) {
      setImagePosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const viewerTransform = useMemo(() => buildViewerTransform({
    rotation,
    flipX,
    flipY,
    scale: imageScale,
    positionX: imagePosition.x,
    positionY: imagePosition.y,
  }), [rotation, flipX, flipY, imageScale, imagePosition]);

  const comparePreviewUrl = useMemo(() => currentPost ? getComparablePreviewUrl(currentPost) : '', [currentPost]);

  if (!currentPost) {
    return null;
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width="100%"
      style={{ top: 0, paddingBottom: 0 }}
      styles={{
        body: { padding: 0, height: 'calc(100vh - 55px)', overflow: 'hidden' },
        mask: { backgroundColor: 'rgba(0, 0, 0, 0.9)' }
      }}
      rootClassName={suspended ? 'modal-suspended-hidden' : undefined}
      closable={false}
      footer={null}
    >
      <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>
        {/* 顶部工具栏 — 精简：ID + 页码 + 关闭 */}
        <div style={{
          padding: `${spacing.sm}px ${spacing.lg}px`,
          borderBottom: `0.5px solid ${colors.separator}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: colors.bgBase,
          zIndex: 10,
          minHeight: 48,
        }}>
          {currentPost.postId ? (
            <span style={{ color: colors.textTertiary, fontSize: fontSize.md }}>
              ID: {currentPost.postId}
            </span>
          ) : <span />}
          {posts.length > 0 && (
            <span style={{
              fontSize: fontSize.md,
              color: colors.textSecondary,
            }}>
              {currentIndex + 1} / {posts.length}
            </span>
          )}
          <Button
            icon={<CloseOutlined />}
            onClick={onClose}
          >
            关闭
          </Button>
        </div>

        {/* 主内容区域 */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* 左侧：图片展示区域 */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#000',
              overflow: 'hidden',
              position: 'relative',
              cursor: imageScale > 1 ? 'move' : 'default'
            }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {isCaching && (
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                color: '#fff',
                fontSize: '16px',
                zIndex: 10,
                background: 'rgba(0, 0, 0, 0.7)',
                padding: '12px 24px',
                borderRadius: '8px'
              }}>
                正在加载原图...
              </div>
            )}
            {!isVideoPost(currentPost) && (
              <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 8, zIndex: 10, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '60%' }}>
                <Button size="small" icon={<RotateLeftOutlined />} onClick={() => setRotation((value) => rotateBy(value, -90))}>左转</Button>
                <Button size="small" icon={<RotateRightOutlined />} onClick={() => setRotation((value) => rotateBy(value, 90))}>右转</Button>
                <Button size="small" onClick={() => setFlipX((value) => !value)}>水平翻转</Button>
                <Button size="small" onClick={() => setFlipY((value) => !value)}>垂直翻转</Button>
                <Button size="small" icon={<BorderOutlined />} type={compareMode ? 'primary' : 'default'} onClick={() => setCompareMode((value) => !value)} disabled={!comparePreviewUrl}>对比</Button>
                <Button size="small" onClick={() => {
                  setImageScale(1);
                  setImagePosition({ x: 0, y: 0 });
                  setRotation(0);
                  setFlipX(false);
                  setFlipY(false);
                  setCompareMode(false);
                }}>重置</Button>
              </div>
            )}
            {/* 左侧导航按钮 — 半透明悬浮 */}
            {posts.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); handlePrevious(); }}
                disabled={currentIndex <= 0}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 40,
                  height: 80,
                  background: currentIndex <= 0 ? 'transparent' : 'rgba(0, 0, 0, 0.2)',
                  border: 'none',
                  borderRadius: '0 8px 8px 0',
                  color: currentIndex <= 0 ? 'rgba(255,255,255,0.3)' : '#fff',
                  fontSize: 18,
                  cursor: currentIndex <= 0 ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 5,
                  transition: 'background 0.2s, opacity 0.2s',
                  opacity: 0.6,
                }}
                onMouseEnter={(e) => { if (currentIndex > 0) { e.currentTarget.style.background = 'rgba(0, 0, 0, 0.5)'; e.currentTarget.style.opacity = '1'; } }}
                onMouseLeave={(e) => { e.currentTarget.style.background = currentIndex <= 0 ? 'transparent' : 'rgba(0, 0, 0, 0.2)'; e.currentTarget.style.opacity = '0.6'; }}
              >
                <LeftOutlined />
              </button>
            )}

            {/* 右侧导航按钮 — 半透明悬浮 */}
            {posts.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); handleNext(); }}
                disabled={currentIndex >= posts.length - 1}
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 40,
                  height: 80,
                  background: currentIndex >= posts.length - 1 ? 'transparent' : 'rgba(0, 0, 0, 0.2)',
                  border: 'none',
                  borderRadius: '8px 0 0 8px',
                  color: currentIndex >= posts.length - 1 ? 'rgba(255,255,255,0.3)' : '#fff',
                  fontSize: 18,
                  cursor: currentIndex >= posts.length - 1 ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 5,
                  transition: 'background 0.2s, opacity 0.2s',
                  opacity: 0.6,
                }}
                onMouseEnter={(e) => { if (currentIndex < posts.length - 1) { e.currentTarget.style.background = 'rgba(0, 0, 0, 0.5)'; e.currentTarget.style.opacity = '1'; } }}
                onMouseLeave={(e) => { e.currentTarget.style.background = currentIndex >= posts.length - 1 ? 'transparent' : 'rgba(0, 0, 0, 0.2)'; e.currentTarget.style.opacity = '0.6'; }}
              >
                <RightOutlined />
              </button>
            )}

            {imageUrl && isVideoPost(currentPost) ? (
              /* 视频播放器 */
              <video
                key={imageUrl}
                src={imageUrl}
                controls
                autoPlay
                loop
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                  userSelect: 'none',
                }}
                onError={() => {
                  console.error('[BooruPostDetailsPage] 视频加载失败:', imageUrl);
                }}
                onLoadedData={() => {
                  console.log('[BooruPostDetailsPage] 视频加载成功:', currentPost?.postId);
                }}
              />
            ) : imageUrl && compareMode && comparePreviewUrl ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: '100%', height: '100%', padding: 24 }}>
                {[{ label: '原图', src: imageUrl }, { label: '对比图', src: comparePreviewUrl }].map((item) => (
                  <div key={item.label} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <span style={{ color: '#fff', fontSize: 12, marginBottom: 8 }}>{item.label}</span>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12, background: 'rgba(255,255,255,0.04)' }}>
                      <img
                        src={item.src}
                        alt={`${item.label}-${currentPost?.postId || ''}`}
                        style={{
                          maxWidth: '100%',
                          maxHeight: '100%',
                          objectFit: 'contain',
                          transform: viewerTransform,
                          transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                          userSelect: 'none'
                        }}
                        draggable={false}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : imageUrl ? (
              /* 图片查看器 */
              <img
                src={imageUrl}
                alt={`Post ${currentPost?.postId || ''}`}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                  transform: viewerTransform,
                  transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                  userSelect: 'none'
                }}
                draggable={false}
                onError={(e) => {
                  const img = e.currentTarget;
                  console.error('[BooruPostDetailsPage] 图片加载失败:', {
                    postId: currentPost?.postId,
                    url: imageUrl,
                    attemptedUrl: img.src,
                    error: e
                  });
                  // 如果缓存图片加载失败，尝试使用原图 URL
                  if (currentPost && imageUrl.startsWith('app://') && currentPost.fileUrl) {
                    console.log('[BooruPostDetailsPage] 缓存图片加载失败，尝试使用原图URL');
                    setImageUrl(currentPost.fileUrl);
                  } else if (currentPost && currentPost.sampleUrl) {
                    console.log('[BooruPostDetailsPage] 图片加载失败，尝试使用 sampleUrl');
                    setImageUrl(currentPost.sampleUrl);
                  } else if (currentPost && currentPost.previewUrl) {
                    console.log('[BooruPostDetailsPage] 图片加载失败，尝试使用 previewUrl');
                    setImageUrl(currentPost.previewUrl);
                  }
                }}
                onLoad={() => {
                  console.log('[BooruPostDetailsPage] 图片加载成功:', {
                    postId: currentPost?.postId,
                    url: imageUrl,
                    urlType: imageUrl.startsWith('app://') ? '缓存' : '远程'
                  });
                }}
              />
            ) : null}

            {/* 注释叠加层（仅图片帖子显示） */}
            {!isVideoPost(currentPost) && (
              <NotesOverlay post={currentPost} site={site} />
            )}

            {/* 幻灯片控制条 — 底部中央悬浮 */}
            {posts.length > 1 && (
              <div style={{
                position: 'absolute',
                bottom: 16,
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                background: 'rgba(0, 0, 0, 0.6)',
                borderRadius: 24,
                padding: '6px 16px',
                zIndex: 10,
                backdropFilter: 'blur(8px)',
              }}>
                <Tooltip title={slideshowActive ? '暂停' : '自动播放'}>
                  <Button
                    type="text"
                    size="small"
                    icon={slideshowActive ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                    onClick={(e) => { e.stopPropagation(); setSlideshowActive(!slideshowActive); }}
                    style={{ color: '#fff', fontSize: 18 }}
                  />
                </Tooltip>
                <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, whiteSpace: 'nowrap' }}>
                  {slideshowInterval}s
                </span>
                <Slider
                  min={2}
                  max={15}
                  step={1}
                  value={slideshowInterval}
                  onChange={(val) => setSlideshowInterval(val)}
                  style={{ width: 80, margin: 0 }}
                  tooltip={{ formatter: (val) => `${val}秒` }}
                />
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>
                  {currentIndex + 1}/{posts.length}
                </span>
              </div>
            )}
          </div>

          {/* 右侧：详情面板 */}
          <div style={{
            width: 380,
            minWidth: 320,
            borderLeft: `0.5px solid ${colors.separator}`,
            overflowY: 'auto',
            background: colors.bgBase,
          }}>
            <div style={{ padding: spacing.lg }}>
              {/* 信息部分 */}
              <InformationSection
                post={currentPost}
                site={site}
              />

              {/* 工具栏 */}
              <Toolbar
                post={currentPost}
                site={site}
                onToggleFavorite={onToggleFavorite}
                onDownload={onDownload}
                isServerFavorited={isServerFavorited ? isServerFavorited(currentPost) : undefined}
                onToggleServerFavorite={onToggleServerFavorite}
              />

              {!isVideoPost(currentPost) && (
                <div style={{ marginBottom: spacing.lg, padding: spacing.md, borderRadius: radius.md, background: colors.bgGroupedSecondary, border: `1px solid ${colors.separator}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: spacing.sm, alignItems: 'center' }}>
                    <strong>图像元数据</strong>
                    <span style={{ color: colors.textTertiary, fontSize: fontSize.sm }}>{metadataLoading ? '读取中...' : imageMetadata?.pathSource === 'local' ? '本地文件' : '缓存文件'}</span>
                  </div>
                  {imageMetadata ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.sm, fontSize: fontSize.sm }}>
                      <span>格式: {imageMetadata.format || '-'}</span>
                      <span>尺寸: {imageMetadata.width || '-'} x {imageMetadata.height || '-'}</span>
                      <span>色彩空间: {imageMetadata.space || '-'}</span>
                      <span>DPI: {imageMetadata.density || '-'}</span>
                      <span>通道数: {imageMetadata.channels || '-'}</span>
                      <span>Alpha: {imageMetadata.hasAlpha ? '有' : '无'}</span>
                      <span>方向: {imageMetadata.orientation || '-'}</span>
                      <span>EXIF: {imageMetadata.hasExif ? '存在' : '无'}</span>
                    </div>
                  ) : (
                    <span style={{ color: colors.textTertiary, fontSize: fontSize.sm }}>未读取到额外元数据</span>
                  )}
                </div>
              )}

              {/* 标签部分 */}
              <TagsSection
                post={currentPost}
                site={site}
                onTagClick={onTagClick}
                onArtistClick={onArtistClick}
                onCharacterClick={onCharacterClick}
              />

              {/* 文件详情 */}
              <FileDetailsSection
                post={currentPost}
                site={site}
              />

              {/* 相关帖子 */}
              <RelatedPostsSection
                post={currentPost}
                site={site}
                onPostClick={(p) => {
                  if (posts.length > 0) {
                    const index = posts.findIndex(pp => pp.postId === p.postId);
                    if (index >= 0) {
                      setCurrentIndex(index);
                    }
                  }
                }}
              />

              {/* 评论区 */}
              <CommentSection
                post={currentPost}
                site={site}
              />

              {/* 版本历史（Danbooru 专属） */}
              {site?.type === 'danbooru' && (
                <PostHistorySection
                  post={currentPost}
                  site={site}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};

