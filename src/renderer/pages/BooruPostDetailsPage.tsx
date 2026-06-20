import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Modal, Space, Button, Tooltip, Slider } from 'antd';
import { LeftOutlined, RightOutlined, CloseOutlined, PlayCircleOutlined, PauseCircleOutlined, RotateLeftOutlined, RotateRightOutlined, BorderOutlined, PictureOutlined, ReloadOutlined } from '@ant-design/icons';

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
import { colors, spacing, radius, fontSize, transitions } from '../styles/tokens';
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
  const [imageVersion, setImageVersion] = useState(0);
  const [isCaching, setIsCaching] = useState(false);
  const [activeImageRequestId, setActiveImageRequestId] = useState(0);
  const [activeImagePostId, setActiveImagePostId] = useState<number | null>(null);
  const imageRequestIdRef = useRef(0);
  const detailsScrollRef = useRef<HTMLDivElement | null>(null);
  // 记录当前回退链中已失败的图片 URL，避免 onError 在 sample/preview 之间无限往返重试
  const failedImageUrlsRef = useRef<Set<string>>(new Set());
  // 图片加载失败终态：回退链全部耗尽时置 true，渲染错误占位并提供重试
  const [imageLoadError, setImageLoadError] = useState(false);
  // 当前 imageUrl 是否仅为切换帖子时的预览图占位（占位期间不渲染注释层等依赖最终图的内容）
  const [isImagePlaceholder, setIsImagePlaceholder] = useState(false);
  // 重试令牌：点击重试时递增，重新触发图片加载流程
  const [imageRetryToken, setImageRetryToken] = useState(0);
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

  // 幻灯片控制条自动隐藏：查看区 2 秒无鼠标移动视为空闲
  const [controlsIdle, setControlsIdle] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 标记查看区活跃，重置空闲计时（同值 setState 会被 React 跳过，频繁调用开销可忽略）
  const markViewerActivity = useCallback(() => {
    setControlsIdle(false);
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = setTimeout(() => setControlsIdle(true), 2000);
  }, []);

  // 打开详情页时启动一次空闲计时；关闭/卸载时清理计时器
  useEffect(() => {
    if (open) {
      markViewerActivity();
    }
    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [open, markViewerActivity]);

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

  const imageLoadKey = useMemo(() => {
    if (!open || !currentPost) return 'closed';
    return JSON.stringify([
      currentPost.postId,
      currentPost.siteId,
      currentPost.localPath || '',
      currentPost.fileUrl || '',
      currentPost.sampleUrl || '',
      currentPost.previewUrl || '',
      currentPost.md5 || '',
      currentPost.fileExt || '',
    ]);
  }, [
    open,
    currentPost?.postId,
    currentPost?.siteId,
    currentPost?.localPath,
    currentPost?.fileUrl,
    currentPost?.sampleUrl,
    currentPost?.previewUrl,
    currentPost?.md5,
    currentPost?.fileExt,
  ]);

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
    if (!open || !currentPost) return;
    if (detailsScrollRef.current) {
      detailsScrollRef.current.scrollTop = 0;
    }
  }, [open, currentPost?.siteId, currentPost?.postId]);

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
    const requestId = imageRequestIdRef.current + 1;
    imageRequestIdRef.current = requestId;
    // 帖子或图片 URL 集合变化时重置失败记录，让新图片的回退链重新开始
    failedImageUrlsRef.current = new Set();
    let cancelled = false;

    const isCurrentRequest = () => !cancelled && imageRequestIdRef.current === requestId;
    const clearImageForRequest = () => {
      if (!isCurrentRequest()) return;
      // 切换帖子时先用预览图/样张占位，避免原图就绪前出现黑屏闪烁；
      // 视频帖子无法用图片占位（渲染分支会把 imageUrl 当视频源），保持为空
      const placeholderUrl = currentPost && !isVideoPost(currentPost)
        ? (currentPost.previewUrl || currentPost.sampleUrl || '')
        : '';
      setImageUrl(placeholderUrl);
      setIsImagePlaceholder(!!placeholderUrl);
      setActiveImageRequestId(requestId);
      setActiveImagePostId(currentPost?.postId ?? null);
    };
    const setCachingForRequest = (value: boolean) => {
      if (isCurrentRequest()) {
        setIsCaching(value);
      }
    };
    const commitImageUrl = (url: string) => {
      if (!isCurrentRequest()) return false;
      setImageUrl(url);
      setIsImagePlaceholder(false);
      // 占位图直连失败与主进程加载成功存在竞态：成功提交时必须清除失败终态，
      // 否则错误占位会永久遮住已加载成功的图片
      setImageLoadError(false);
      setImageVersion((value) => value + 1);
      setActiveImageRequestId(requestId);
      setActiveImagePostId(currentPost?.postId ?? null);
      return true;
    };

    clearImageForRequest();
    setCachingForRequest(false);
    // 切换帖子或重试时重置加载失败终态
    setImageLoadError(false);

    if (!open || !currentPost) {
      return () => {
        cancelled = true;
      };
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
          commitImageUrl(appUrl);
          return;
        } catch (e) {
          console.warn('[BooruPostDetailsPage] 本地路径转换失败:', e);
        }
      }

      // 如果没有原图 URL，使用 sampleUrl 或 previewUrl
      if (!currentPost.fileUrl) {
        const url = currentPost.sampleUrl || currentPost.previewUrl || '';
        console.log('[BooruPostDetailsPage] 没有原图URL，使用:', url ? 'sampleUrl/previewUrl' : '无');
        commitImageUrl(url);
        return;
      }

      // 视频帖子直接使用原图 URL，不走缓存（视频文件过大）
      if (isVideoPost(currentPost)) {
        console.log('[BooruPostDetailsPage] 视频帖子，直接使用原图URL');
        commitImageUrl(currentPost.fileUrl);
        return;
      }

      // 检查是否有 MD5 和扩展名
      if (!currentPost.md5 || !currentPost.fileExt) {
        console.warn('[BooruPostDetailsPage] 缺少 MD5 或扩展名，直接使用原图URL');
        commitImageUrl(currentPost.fileUrl);
        return;
      }

      // 先检查缓存
      setCachingForRequest(true);
      try {
        const cachedUrlResult = await window.electronAPI.booru.getCachedImageUrl(currentPost.md5, currentPost.fileExt);
        if (!isCurrentRequest()) return;
        if (cachedUrlResult.success && cachedUrlResult.data) {
          console.log('[BooruPostDetailsPage] 使用缓存图片:', cachedUrlResult.data);
          commitImageUrl(cachedUrlResult.data);
          return;
        }

        // 缓存不存在，下载并缓存
        console.log('[BooruPostDetailsPage] 缓存不存在，开始下载并缓存原图...');
        const cacheResult = await window.electronAPI.booru.cacheImage(
          currentPost.fileUrl,
          currentPost.md5,
          currentPost.fileExt
        );

        if (!isCurrentRequest()) return;
        if (cacheResult.success && cacheResult.data) {
          console.log('[BooruPostDetailsPage] 原图缓存成功:', cacheResult.data);
          commitImageUrl(cacheResult.data);
        } else {
          console.warn('[BooruPostDetailsPage] 原图缓存失败，使用原图URL:', cacheResult.error);
          commitImageUrl(currentPost.fileUrl);
        }
      } catch (error) {
        if (!isCurrentRequest()) return;
        console.error('[BooruPostDetailsPage] 加载原图失败:', error);
        commitImageUrl(currentPost.fileUrl);
      } finally {
        setCachingForRequest(false);
      }
    };

    void loadOriginalImage();
    return () => {
      cancelled = true;
    };
  }, [imageLoadKey, imageRetryToken]);

  // 重试加载：清空失败记录并重新触发加载流程
  const handleRetryImage = useCallback(() => {
    console.log('[BooruPostDetailsPage] 用户点击重试，重新加载图片');
    failedImageUrlsRef.current = new Set();
    setImageLoadError(false);
    setImageRetryToken((value) => value + 1);
  }, []);

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

        const result = await window.electronAPI.booruPreferences.appearance.get();
        if (result.success && result.data) {
          const quality = result.data.previewQuality || 'auto';
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
      // 焦点在输入框/可编辑区域时不响应快捷键，避免评论输入时左右键误触翻页
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
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

  // 以光标为锚点缩放：补偿 position 使光标下的图片内容在缩放前后保持不动。
  // 仅在未旋转/未翻转时补偿（旋转后坐标系转换复杂，退化为居中缩放）
  const applyZoom = (e: React.MouseEvent | React.WheelEvent, prevScale: number, nextScale: number) => {
    if (nextScale === prevScale) return;
    if (rotation === 0 && !flipX && !flipY) {
      // 图片居中显示，光标坐标转换为相对容器中心（即图片变换原点）的偏移
      const rect = e.currentTarget.getBoundingClientRect();
      const cursorX = e.clientX - rect.left - rect.width / 2;
      const cursorY = e.clientY - rect.top - rect.height / 2;
      const ratio = nextScale / prevScale;
      setImagePosition(prev => ({
        x: cursorX - ratio * (cursorX - prev.x),
        y: cursorY - ratio * (cursorY - prev.y),
      }));
    }
    setImageScale(nextScale);
  };

  // 图片缩放：查看区无滚动需求（overflow hidden），普通滚轮直接缩放，无需按住 Ctrl
  const handleWheel = (e: React.WheelEvent) => {
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const nextScale = Math.max(0.5, Math.min(3, imageScale + delta));
    applyZoom(e, imageScale, nextScale);
  };

  // 双击在适配（1x，位置归零）与 2 倍之间切换
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (isVideoPost(currentPost)) return;
    // 忽略来自按钮/滑杆的双击冒泡（如快速连点翻页按钮），避免误触缩放
    if ((e.target as HTMLElement).closest('button, .ant-slider')) return;
    if (imageScale !== 1) {
      setImageScale(1);
      setImagePosition({ x: 0, y: 0 });
      return;
    }
    applyZoom(e, imageScale, 2);
  };

  // 图片拖拽
  const handleMouseDown = (e: React.MouseEvent) => {
    if (imageScale > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - imagePosition.x, y: e.clientY - imagePosition.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    // 任何鼠标移动都视为活跃，重置幻灯片控制条的自动隐藏计时
    markViewerActivity();
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
            onDoubleClick={handleDoubleClick}
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
                key={`${activeImageRequestId}:${imageVersion}:${imageUrl}`}
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
                        key={`${item.label}:${item.src}:${item.src === imageUrl ? imageVersion : 0}`}
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
            ) : imageLoadError ? (
              /* 图片加载失败终态占位（查看区始终为黑色背景，文字使用半透明白） */
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: spacing.md,
                color: 'rgba(255, 255, 255, 0.65)',
              }}>
                <PictureOutlined style={{ fontSize: 48 }} />
                <span style={{ fontSize: fontSize.base }}>图片加载失败</span>
                <Button icon={<ReloadOutlined />} onClick={handleRetryImage}>
                  重试
                </Button>
              </div>
            ) : imageUrl ? (
              /* 图片查看器 */
              <img
                key={`${activeImageRequestId}:${imageVersion}:${imageUrl}`}
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
                  const canCommitFallback =
                    activeImageRequestId === imageRequestIdRef.current &&
                    activeImagePostId === (currentPost?.postId ?? null);
                  if (!canCommitFallback) return;
                  // 记录本次失败的 URL（imageUrl 与 img.src 可能因解析差异不同，两个都记录），
                  // 后续回退时排除所有已失败 URL，避免 sample/preview 互相往返导致无限重试
                  const failedUrls = failedImageUrlsRef.current;
                  if (imageUrl) failedUrls.add(imageUrl);
                  if (img.src) failedUrls.add(img.src);
                  const commitFallbackImageUrl = (url: string) => {
                    setImageUrl(url);
                    setIsImagePlaceholder(false);
                    setImageVersion((value) => value + 1);
                    setActiveImageRequestId(activeImageRequestId);
                    setActiveImagePostId(currentPost?.postId ?? null);
                  };
                  const fallbackOptions = currentPost ? [
                    ...(imageUrl.startsWith('app://') && currentPost.fileUrl
                      ? [{ label: '原图URL', url: currentPost.fileUrl }]
                      : []),
                    ...(currentPost.sampleUrl ? [{ label: 'sampleUrl', url: currentPost.sampleUrl }] : []),
                    ...(currentPost.previewUrl ? [{ label: 'previewUrl', url: currentPost.previewUrl }] : []),
                  ] : [];
                  const fallback = fallbackOptions.find(({ url }) => !failedUrls.has(url));
                  if (!fallback) {
                    // 所有候选 URL 均已失败，进入加载失败终态，渲染错误占位（不再触发网络请求）
                    console.warn('[BooruPostDetailsPage] 所有候选图片 URL 均加载失败，停止重试:', currentPost?.postId);
                    setImageLoadError(true);
                    return;
                  }

                  console.log(`[BooruPostDetailsPage] 图片加载失败，尝试使用 ${fallback.label}`);
                  commitFallbackImageUrl(fallback.url);
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

            {/* 注释叠加层（仅图片帖子显示；占位图阶段不渲染，等最终图就绪） */}
            {imageUrl && !isImagePlaceholder && !imageLoadError && !compareMode && !isVideoPost(currentPost) && (
              <NotesOverlay
                key={`${currentPost.postId}:${activeImageRequestId}:${imageVersion}`}
                post={currentPost}
                site={site}
              />
            )}

            {/* 幻灯片控制条 — 底部中央悬浮；空闲 2 秒且未在播放时自动淡出（页码与顶栏重复，已移除） */}
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
                opacity: controlsIdle && !slideshowActive ? 0 : 1,
                pointerEvents: controlsIdle && !slideshowActive ? 'none' : 'auto',
                transition: transitions.opacity,
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
              </div>
            )}
          </div>

          {/* 右侧：详情面板 */}
          <div
            ref={detailsScrollRef}
            data-testid="booru-details-scroll-panel"
            style={{
              width: 380,
              minWidth: 320,
              borderLeft: `0.5px solid ${colors.separator}`,
              overflowY: 'auto',
              background: colors.bgBase,
            }}
          >
            <div style={{ padding: spacing.lg }}>
              {/* 信息部分 */}
              <InformationSection
                post={currentPost}
                site={site}
                onArtistClick={onArtistClick}
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

