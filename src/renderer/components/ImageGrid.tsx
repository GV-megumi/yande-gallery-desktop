import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Card, Image, Tag, Button, Modal, Descriptions, Space, message, Tooltip, App } from 'antd';
import { TagsOutlined, FolderOpenOutlined, CopyOutlined, PictureOutlined as PicOutlined, ReloadOutlined, DeleteOutlined } from '@ant-design/icons';
import { formatFileSize } from '../utils/format';
import { localPathToAppUrl } from '../utils/url';
import { colors, spacing, radius, fontSize, zIndex, shadows, transitions, layout as layoutTokens } from '../styles/tokens';
import { ContextMenu } from './ContextMenu';
import { useGalleryDomainEvents } from '../hooks/useGalleryDomainEvents';

// --- 静态样式常量（避免每次渲染创建新对象） ---
const containerStyle: React.CSSProperties = { position: 'relative' };
const previewImgStyle: React.CSSProperties = { display: 'none' };
const batchGroupSeparator = '__';

export interface ImageGridProps {
  images: any[];
  onReload: () => void;
  active?: boolean;
  groupBy?: 'none' | 'day' | 'month' | 'year';
  // 排序方式：按时间（修改时间优先）或按文件名
  sortBy?: 'time' | 'name';
  // 排序顺序；未传时沿用旧行为：时间倒序、文件名升序
  sortOrder?: 'asc' | 'desc';
  // 是否显示右侧时间刻度（仅对按时间分组时生效）
  showTimeline?: boolean;
  // 布局方式：'waterfall' 瀑布流（默认），'grid' 网格
  layout?: 'waterfall' | 'grid';
  // 设置封面回调（用于图集）
  onSetCover?: (imageId: number) => void;
  // 当前图集信息（用于显示设置封面按钮）
  currentGallery?: any;
  // 批次大小：先按批次分组（每批多少张），再在每个批次内按时间分组（默认200）
  batchSize?: number;
  // 分组 DOM id 前缀：同一页面渲染多个 ImageGrid 时避免时间轴锚点冲突
  groupKeyPrefix?: string;
}

// 将本地文件路径转换为 app:// 协议 URL
const getImageUrl = (filePath: string): string => {
  if (!filePath) return '';
  if (filePath.startsWith('app://')) return filePath;
  return localPathToAppUrl(filePath);
};

// 按修改时间分组 key
const getDateGroupKey = (image: any, mode: 'day' | 'month' | 'year'): string => {
  const date = new Date(image.updatedAt || image.createdAt || Date.now());
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');

  if (mode === 'year') return `${y}年`;
  if (mode === 'month') return `${y}年${m}月`;
  return `${y}年${m}月${d}日`;
};

// ==================== ImageCard 子组件 ====================

const getBatchGroupKey = (batchIndex: number, timeKey: string): string =>
  `batch-${batchIndex + 1}${batchGroupSeparator}${timeKey}`;

const getBatchOnlyGroupKey = (batchIndex: number): string => `batch-${batchIndex + 1}`;

const getGroupDisplayTitle = (key: string): string => {
  const separatorIndex = key.indexOf(batchGroupSeparator);
  return key.startsWith('batch-') && separatorIndex >= 0
    ? key.slice(separatorIndex + batchGroupSeparator.length)
    : key;
};

/** ImageCard 的 props 接口 */
interface ImageCardProps {
  image: any;
  thumbnailPath: string | null | undefined;
  onImageInfo: (image: any) => void;
  onPreviewClick: (previewSrc: string, imageId: number, filename: string) => void;
  onReload: () => void;
  onSetCover?: (imageId: number) => void;
  currentGallery?: any;
}

/**
 * 独立的图片卡片组件，使用 React.memo 避免不必要的重渲染。
 * 从 ImageGrid 的 renderCard 中提取而来。
 */
const ImageCard: React.FC<ImageCardProps> = React.memo(({
  image,
  thumbnailPath,
  onImageInfo,
  onPreviewClick,
  onReload,
  onSetCover,
  currentGallery,
}) => {
  // 判断缩略图状态：undefined=加载中，string=已加载，null=加载失败
  const isThumbnailLoading = thumbnailPath === undefined;
  const hasThumbnail = typeof thumbnailPath === 'string';
  const thumbnailFailed = thumbnailPath === null;

  // 计算图片的宽高比（用于创建占位符）
  const aspectRatio = image.width && image.height
    ? (image.height / image.width) * 100
    : 75; // 默认 4:3 比例 (3/4 * 100 = 75)

  // 确定显示的图片源：优先使用缩略图，失败时使用原图
  const displaySrc = hasThumbnail
    ? getImageUrl(thumbnailPath)  // 使用缩略图
    : (thumbnailFailed ? getImageUrl(image.filepath) : undefined); // 缩略图加载失败，使用原图

  // 预览时始终使用原图
  const previewSrc = getImageUrl(image.filepath);

  // 构建右键菜单项，使用 useMemo 缓存
  const imageContextItems = useMemo(() => {
    const items: any[] = [
      { key: 'info', label: '查看信息', icon: <TagsOutlined />, onClick: () => onImageInfo(image) },
      { key: 'showInFolder', label: '打开文件所在目录', icon: <FolderOpenOutlined />, onClick: () => {
        if (image.filepath && window.electronAPI) {
          console.log('[ImageGrid] 打开文件所在目录:', image.filepath);
          window.electronAPI.system.showItem(image.filepath);
        }
      }},
      { key: 'copyPath', label: '复制文件路径', icon: <CopyOutlined />, onClick: () => {
        if (image.filepath) {
          navigator.clipboard.writeText(image.filepath);
          message.success('已复制文件路径');
        }
      }},
    ];
    // 图集模式下添加「设为封面」
    if (onSetCover && currentGallery) {
      const isCurrent = currentGallery.coverImageId === image.id;
      items.push(
        { type: 'divider' },
        { key: 'setCover', label: isCurrent ? '当前封面' : '设为封面', icon: <PicOutlined />, disabled: isCurrent, onClick: () => {
          console.log(`[ImageGrid] 右键设置封面: 图片ID ${image.id}`);
          onSetCover(image.id);
        }}
      );
    }
    // 缩略图 & 删除操作
    items.push(
      { type: 'divider' },
      { key: 'regenThumbnail', label: '重新获取缩略图', icon: <ReloadOutlined />, onClick: async () => {
        if (image.filepath && window.electronAPI) {
          const result = await window.electronAPI.image.generateThumbnail(image.filepath, true);
          if (result.success) {
            message.success('缩略图已更新');
            onReload();
          } else {
            message.error('缩略图生成失败: ' + (result.error || ''));
          }
        }
      }},
      { key: 'deleteImage', label: '删除', icon: <DeleteOutlined />, danger: true, onClick: () => {
        Modal.confirm({
          title: '确认删除',
          content: `确定要删除「${image.filename}」吗？图集记录和文件都将被删除。`,
          okText: '删除',
          okType: 'danger',
          cancelText: '取消',
          closable: false,
          onOk: async () => {
            if (window.electronAPI) {
              const result = await window.electronAPI.image.deleteImage(image.id);
              if (result.success) {
                message.success('已删除');
                onReload();
              } else {
                message.error('删除失败: ' + (result.error || ''));
              }
            }
          },
        });
      }},
    );
    return items;
  }, [image, onImageInfo, onSetCover, currentGallery, onReload]);

  return (
    <ContextMenu items={imageContextItems}>
    <div
      className="card-ios-hover"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        // 键盘可达性：Enter/Space 等同点击打开预览
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPreviewClick(previewSrc, image.id, image.filename);
        }
      }}
      style={{
        borderRadius: radius.md,
        overflow: 'hidden',
        boxShadow: shadows.card,
        background: colors.bgBase,
        border: `1px solid ${colors.borderCard}`,
        position: 'relative',
        cursor: 'pointer',
      }}
    >
        <div
          style={{
            width: '100%',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {isThumbnailLoading ? (
            // 缩略图加载中：shimmer 骨架屏
            <div
              className="ios-skeleton-shimmer"
              style={{
                width: '100%',
                paddingBottom: `${aspectRatio}%`,
                display: 'block',
                position: 'relative',
                borderRadius: 0,
              }}
            />
          ) : displaySrc ? (
            // 有图片源，点击打开预览
            <img
              src={displaySrc}
              alt={image.filename}
              className="image-fade-in"
              style={{ width: '100%', height: 'auto', display: 'block', cursor: 'pointer' }}
              onLoad={(e) => {
                (e.target as HTMLImageElement).classList.add('loaded');
              }}
              onClick={() => {
                onPreviewClick(previewSrc, image.id, image.filename);
              }}
            />
          ) : (
            // 兜底占位
            <div
              style={{
                width: '100%',
                paddingBottom: `${aspectRatio}%`,
                backgroundColor: colors.bgDark,
                display: 'block',
                position: 'relative'
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  color: colors.textTertiary,
                  fontSize: fontSize.sm
                }}
              >
                加载失败
              </div>
            </div>
          )}
          {/* 右上角信息按钮 -- 圆形，hover 卡片时显隐 */}
          {!isThumbnailLoading && (
            <div
              className="card-overlay-buttons"
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                zIndex: zIndex.sticky,
              }}
            >
              <Tooltip title="查看信息">
                <Button
                  type="text"
                  size="small"
                  icon={<TagsOutlined />}
                  aria-label="查看信息"
                  className="overlay-btn overlay-btn-dark"
                  onClick={(e) => {
                    e.stopPropagation();
                    onImageInfo(image);
                  }}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: radius.round,
                    background: colors.overlayDark,
                    backdropFilter: 'blur(8px)',
                    color: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: 'none',
                  }}
                />
              </Tooltip>
            </div>
          )}
        </div>
    </div>
    </ContextMenu>
  );
});

ImageCard.displayName = 'ImageCard';

// ==================== ImageGrid 主组件 ====================

export const ImageGrid: React.FC<ImageGridProps> = React.memo(({
  images,
  onReload,
  active = true,
  groupBy = 'none',
  sortBy = 'time',
  sortOrder,
  showTimeline = false,
  layout = 'waterfall',
  onSetCover,
  currentGallery,
  batchSize = 200,
  groupKeyPrefix
}) => {
  // antd v5 上下文化 message（避免静态调用无法响应主题/容器配置）
  const { message: contextMessage } = App.useApp();
  const [selectedImage, setSelectedImage] = useState<any>(null);
  const [hiddenImageIds, setHiddenImageIds] = useState<Set<number>>(() => new Set());
  // 存储每个图片的缩略图路径，key 是 image.id
  const [thumbnailPaths, setThumbnailPaths] = useState<Record<number, string | null>>({});
  const thumbnailPathsRef = useRef<Record<number, string | null>>({});
  // 单图预览状态（替代 Image.PreviewGroup，避免 2000+ 图片创建隐藏预览节点）
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewImage, setPreviewImage] = useState<string>('');
  // 预览请求序号：防止晚返回的丢失校验误关用户后续打开的其他预览
  const previewRequestIdRef = useRef(0);
  const imageIdsKey = useMemo(
    () => images.map((image) => `${typeof image.id === 'number' ? image.id : ''}`).join('|'),
    [images]
  );
  const visibleImages = useMemo(
    () => hiddenImageIds.size === 0
      ? images
      : images.filter((image) => typeof image.id !== 'number' || !hiddenImageIds.has(image.id)),
    [images, hiddenImageIds]
  );
  const visibleImageIdSet = useMemo(
    () => new Set(
      visibleImages
        .map((image) => image.id)
        .filter((id): id is number => typeof id === 'number')
    ),
    [visibleImages]
  );
  const thumbnailLoadKey = useMemo(
    () => visibleImages.map((image) => `${image.id}:${image.filepath || ''}`).join('|'),
    [visibleImages]
  );

  useEffect(() => {
    const currentImageIds = new Set(
      images
        .map((image) => image.id)
        .filter((id): id is number => typeof id === 'number')
    );

    setHiddenImageIds((current) => {
      let changed = false;
      const next = new Set<number>();
      current.forEach((id) => {
        if (currentImageIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [imageIdsKey, images]);

  const hideImagesById = useCallback((ids: Array<number | undefined>) => {
    const uniqueIds = Array.from(new Set(ids.filter((id): id is number => typeof id === 'number')));
    if (uniqueIds.length === 0) return;

    const affectsVisibleImages = uniqueIds.some((id) => visibleImageIdSet.has(id));
    setHiddenImageIds((current) => {
      let changed = false;
      const next = new Set(current);
      uniqueIds.forEach((id) => {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      });
      return changed ? next : current;
    });

    setThumbnailPaths((current) => {
      let changed = false;
      const next = { ...current };
      uniqueIds.forEach((id) => {
        if (id in next) {
          delete next[id];
          changed = true;
        }
      });
      if (changed) {
        thumbnailPathsRef.current = next;
      }
      return changed ? next : current;
    });

    if (!affectsVisibleImages) return;

    setSelectedImage((current: any) => (
      current && uniqueIds.includes(current.id) ? null : current
    ));
    onReload();
  }, [onReload, visibleImageIdSet]);

  useGalleryDomainEvents({
    active,
    replayDirtyOnActive: false,
    onImagesChanged: (payload) => {
      if (payload.action !== 'deleted' && payload.action !== 'invalidated') return;
      hideImagesById([payload.imageId, ...(payload.affectedImageIds ?? [])]);
    },
    onInvalidImagesChanged: (payload) => {
      if (payload.action !== 'reported') return;
      hideImagesById([payload.originalImageId]);
    },
    onThumbnailGenerated: (payload) => {
      const matchedImage = visibleImages.find((image) => (
        image.filepath === payload.imagePath &&
        typeof image.id === 'number'
      ));
      if (!matchedImage || typeof matchedImage.id !== 'number') return;

      const nextValue = payload.success && payload.thumbnailPath
        ? payload.thumbnailPath
        : null;

      setThumbnailPaths((current) => {
        const nextPaths = { ...current, [matchedImage.id]: nextValue };
        thumbnailPathsRef.current = nextPaths;
        return nextPaths;
      });

      if (!payload.success && payload.missing) {
        window.electronAPI?.gallery?.reportInvalidImage?.(matchedImage.id).catch(() => {});
      }
    },
  });

  // 加载所有图片的缩略图（异步批量加载）
  useEffect(() => {
    if (!window.electronAPI || visibleImages.length === 0) {
      // 图片列表为空时清空缩略图缓存，释放内存
      thumbnailPathsRef.current = {};
      setThumbnailPaths({});
      return;
    }

    // 用于取消已过时的加载任务
    const visibleImageIds = new Set(
      visibleImages
        .map((image) => image.id)
        .filter((id): id is number => typeof id === 'number')
    );

    let currentPaths = thumbnailPathsRef.current;
    let prunedPathsChanged = false;
    const prunedPaths: Record<number, string | null> = {};
    for (const [idKey, thumbnailPath] of Object.entries(currentPaths)) {
      const id = Number(idKey);
      if (visibleImageIds.has(id)) {
        prunedPaths[id] = thumbnailPath;
      } else {
        prunedPathsChanged = true;
      }
    }

    if (prunedPathsChanged) {
      thumbnailPathsRef.current = prunedPaths;
      currentPaths = prunedPaths;
      setThumbnailPaths(prunedPaths);
    }

    const imagesToLoad = visibleImages.filter((image) => (
      typeof image.id === 'number' &&
      !!image.filepath &&
      !(image.id in currentPaths)
    ));

    if (imagesToLoad.length === 0) {
      return;
    }

    console.log(`[ImageGrid] load thumbnails for ${imagesToLoad.length} newly visible images`);

    let cancelled = false;

    const loadThumbnails = async () => {
      const thumbnails: Record<number, string | null> = {};
      let pendingSinceLastFlush = 0;

      // 批量加载缩略图，限制并发数量以避免过载
      const concurrency = 4; // 控制前台缩略图请求压力，实际生成并发由主进程队列兜底
      const flushInterval = 100; // 每100张刷新一次UI
      for (let i = 0; i < imagesToLoad.length; i += concurrency) {
        if (cancelled) return;

        const batch = imagesToLoad.slice(i, i + concurrency);

        await Promise.all(
          batch.map(async (image) => {
            if (!image.filepath || cancelled) return;
            try {
              const result = await window.electronAPI.image.getThumbnail(image.filepath);
              if (cancelled) return;
              if (result.success && result.data) {
                thumbnails[image.id] = result.data;
              } else if ((result as any).pending) {
                return;
              } else {
                thumbnails[image.id] = null;
                // 源文件丢失：异步上报为无效图片
                if ((result as any).missing && image.id) {
                  console.log(`[ImageGrid] 检测到源文件丢失，上报无效图片: ${image.filename} (ID: ${image.id})`);
                  window.electronAPI.gallery.reportInvalidImage(image.id).catch(() => {});
                }
              }
            } catch (error) {
              thumbnails[image.id] = null;
            }
          })
        );

        pendingSinceLastFlush += batch.length;

        // 每 flushInterval 张或最后一批时刷新UI（减少 setState 次数）
        if (!cancelled && (pendingSinceLastFlush >= flushInterval || i + concurrency >= imagesToLoad.length)) {
          const nextPaths = { ...thumbnailPathsRef.current, ...thumbnails };
          thumbnailPathsRef.current = nextPaths;
          setThumbnailPaths(nextPaths);
          pendingSinceLastFlush = 0;
        }
      }

      if (!cancelled) {
        console.log(`[ImageGrid] thumbnails loaded for new images: ${Object.values(thumbnails).filter(t => t !== null).length}/${imagesToLoad.length}`);
      }
    };

    loadThumbnails();

    // 清理函数：images 变化时取消旧的加载任务
    return () => {
      cancelled = true;
    };
  }, [thumbnailLoadKey]);

  // 使用 useCallback 包裹回调，确保 ImageCard 的 React.memo 能正确跳过重渲染
  const handleImageInfo = useCallback((image: any) => {
    console.log(`[ImageGrid] 查看图片信息: ${image.filename} (ID: ${image.id})`);
    setSelectedImage(image);
  }, []);

  // 点击预览回调：乐观打开预览，源文件校验改为后台异步执行（仅首次入库上报）
  const handlePreviewClick = useCallback((previewSrc: string, imageId: number, filename: string) => {
    // 先立即打开预览，避免等待 IPC 校验造成点击延迟
    const requestId = ++previewRequestIdRef.current;
    setPreviewImage(previewSrc);
    setPreviewVisible(true);

    if (imageId && window.electronAPI) {
      window.electronAPI.gallery.reportInvalidImage(imageId)
        .then((result) => {
          if (result.success || result.error === '图片记录不存在') {
            // 文件丢失（首次或已迁移）：仅当预览仍属于本次点击时才关闭，避免误关后续预览
            if (previewRequestIdRef.current === requestId) {
              setPreviewVisible(false);
              setPreviewImage('');
            }
            contextMessage.warning(`源文件已丢失: ${filename}`);
          }
          // '源文件仍然存在' → 文件正常，保持预览打开
        })
        .catch(() => {
          // 校验失败，保持预览打开
        });
    }
  }, [contextMessage]);

  // 先按批次分组，再在每个批次内按时间分组
  const groupedImages = useMemo(() => {
    const effectiveSortOrder = sortOrder ?? (sortBy === 'name' ? 'asc' : 'desc');
    console.log(`[ImageGrid] 重新计算图片分组和排序，图片数量: ${visibleImages.length}, 分组: ${groupBy}, 排序: ${sortBy}, 顺序: ${effectiveSortOrder}, 批次大小: ${batchSize}`);
    const sortImages = (items: any[]) => [...items].sort((a, b) => {
      if (sortBy === 'name') {
        const diff = (a.filename || '').localeCompare(b.filename || '');
        return effectiveSortOrder === 'asc' ? diff : -diff;
      }
      const diff = (
        new Date(a.updatedAt || a.createdAt || 0).getTime() -
        new Date(b.updatedAt || b.createdAt || 0).getTime()
      );
      return effectiveSortOrder === 'asc' ? diff : -diff;
    });

    // 时间排序保持全局顺序；文件名排序保持批次成员稳定，避免追加图片时旧瀑布流批次重排。
    const imagesForBatching = sortBy === 'time' ? sortImages(visibleImages) : visibleImages;

    // 先按批次分组
    const batches: any[][] = [];
    const effectiveBatchSize = Math.max(1, batchSize);
    for (let i = 0; i < imagesForBatching.length; i += effectiveBatchSize) {
      batches.push(imagesForBatching.slice(i, i + effectiveBatchSize));
    }
    console.log(`[ImageGrid] 分为 ${batches.length} 个批次`);

    if (groupBy === 'none') {
      const batchGroups: Record<string, any[]> = {};
      batches.forEach((batch, batchIndex) => {
        batchGroups[getBatchOnlyGroupKey(batchIndex)] = sortImages(batch);
      });
      return batchGroups;
    }

    // 在每个批次内按时间分组
    const finalGroups: Record<string, any[]> = {};
    batches.forEach((batch, batchIndex) => {
      const batchGroups: Record<string, any[]> = {};
      for (const img of sortImages(batch)) {
        const timeKey = getDateGroupKey(img, groupBy);
        if (!batchGroups[timeKey]) batchGroups[timeKey] = [];
        batchGroups[timeKey].push(img);
      }

      // 将批次内的分组添加到最终分组，使用批次前缀区分
      for (const [timeKey, imgs] of Object.entries(batchGroups)) {
        const finalKey = getBatchGroupKey(batchIndex, timeKey);
        finalGroups[finalKey] = imgs;
      }
    });

    const groupKeys = Object.keys(finalGroups);
    console.log(`[ImageGrid] 分组完成，分组数量: ${groupKeys.length}, 分组键: ${groupKeys.join(', ')}`);
    return finalGroups;
  }, [visibleImages, groupBy, sortBy, sortOrder, batchSize]);



  return (
    <>
      <div style={containerStyle}>
        {/* 单图预览组件（替代 Image.PreviewGroup，避免 2000+ 隐藏预览节点的内存开销） */}
        <Image
          style={previewImgStyle}
          preview={{
            visible: previewVisible,
            src: previewImage,
            onVisibleChange: (visible) => {
              setPreviewVisible(visible);
              if (!visible) setPreviewImage('');
            }
          }}
        />
        {/* 主内容：按时间分段 + 瀑布流排版 */}
          <div>
            {Object.entries(groupedImages).map(([key, group]) => {
              const displayTitle = getGroupDisplayTitle(key);
              const groupDomId = groupKeyPrefix ? `${groupKeyPrefix}${batchGroupSeparator}${key}` : key;

              return (
                <div key={key} style={{ marginBottom: groupBy === 'none' ? spacing['4xl'] : spacing.xxl }} id={groupDomId}>
                  {groupBy !== 'none' && (
                    <div
                      style={{
                        margin: `${spacing.sm}px 0 ${spacing.md}px`,
                        fontWeight: 700,
                        fontSize: groupBy === 'year' ? fontSize.xxl : groupBy === 'month' ? fontSize.xl : fontSize.lg,
                        color: colors.textPrimary,
                        letterSpacing: '-0.3px',
                      }}
                    >
                      {displayTitle}
                    </div>
                  )}
                <div
                  style={{
                    columnWidth: 220,
                    columnGap: layoutTokens.cardGap,
                  }}
                >
                  {group.map((image: any) => (
                    <div
                      key={image.id}
                      style={{
                        breakInside: 'avoid',
                        marginBottom: layoutTokens.cardGap,
                      }}
                    >
                      <ImageCard
                        image={image}
                        thumbnailPath={thumbnailPaths[image.id]}
                        onImageInfo={handleImageInfo}
                        onPreviewClick={handlePreviewClick}
                        onReload={onReload}
                        onSetCover={onSetCover}
                        currentGallery={currentGallery}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
            })}
          </div>

        {/* 右侧时间刻度，仅在按时间分组时显示 */}
        {showTimeline && groupBy !== 'none' && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              paddingLeft: spacing.sm,
              paddingRight: spacing.xs,
              fontSize: fontSize.sm,
              color: colors.textTertiary,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              pointerEvents: 'none'
            }}
          >
            {Object.keys(groupedImages).map((key) => (
              <div
                key={`timeline-${groupKeyPrefix ? `${groupKeyPrefix}${batchGroupSeparator}${key}` : key}`}
                style={{ marginBottom: spacing.lg, cursor: 'pointer', pointerEvents: 'auto' }}
                onClick={() => {
                  const groupDomId = groupKeyPrefix ? `${groupKeyPrefix}${batchGroupSeparator}${key}` : key;
                  const el = document.getElementById(groupDomId);
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                }}
              >
                {getGroupDisplayTitle(key)}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 图片信息模态框 */}
      <Modal
        open={!!selectedImage}
        title="图片信息"
        closable={false}
        footer={
          <Button onClick={() => { console.log('[ImageGrid] 关闭图片信息'); setSelectedImage(null); }}>
            关闭
          </Button>
        }
        onCancel={() => {
          console.log('[ImageGrid] 关闭图片信息');
          setSelectedImage(null);
        }}
        width={600}
      >
        {selectedImage && (
          <>
            <Descriptions bordered column={1}>
              <Descriptions.Item label="文件名">{selectedImage.filename}</Descriptions.Item>
              <Descriptions.Item label="路径">
                <span
                  style={{
                    color: colors.primary,
                    cursor: 'pointer',
                    textDecoration: 'underline'
                  }}
                  onClick={() => {
                    if (selectedImage.filepath && window.electronAPI) {
                      console.log('[ImageGrid] 在资源管理器中显示:', selectedImage.filepath);
                      window.electronAPI.system.showItem(selectedImage.filepath);
                    }
                  }}
                  title="点击在资源管理器中显示"
                >
                  {selectedImage.filepath}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="尺寸">{selectedImage.width} × {selectedImage.height}</Descriptions.Item>
              <Descriptions.Item label="文件大小">{formatFileSize(selectedImage.fileSize)}</Descriptions.Item>
              <Descriptions.Item label="格式">{selectedImage.format?.toUpperCase()}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{new Date(selectedImage.createdAt).toLocaleString()}</Descriptions.Item>
              <Descriptions.Item label="修改时间">{new Date(selectedImage.updatedAt).toLocaleString()}</Descriptions.Item>
              {selectedImage.tags && selectedImage.tags.length > 0 && (
                <Descriptions.Item label="标签">
                  <Space wrap>
                    {selectedImage.tags.map((tag: string) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </Space>
                </Descriptions.Item>
              )}
            </Descriptions>
            {onSetCover && currentGallery && (
              <div style={{ marginTop: spacing.lg, textAlign: 'right' }}>
                <Button
                  type={currentGallery.coverImageId === selectedImage.id ? 'primary' : 'default'}
                  onClick={() => {
                    if (onSetCover && selectedImage.id) {
                      console.log(`[ImageGrid] 设置封面请求: 图片ID ${selectedImage.id}`);
                      onSetCover(selectedImage.id);
                      setSelectedImage(null);
                    }
                  }}
                >
                  {currentGallery.coverImageId === selectedImage.id ? '当前封面' : '设为封面'}
                </Button>
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
});

ImageGrid.displayName = 'ImageGrid';
