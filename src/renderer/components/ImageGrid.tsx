import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Card, Image, Tag, Button, Modal, Descriptions, Space, message } from 'antd';
import { TagsOutlined, FolderOpenOutlined, CopyOutlined, PictureOutlined as PicOutlined } from '@ant-design/icons';
import { formatFileSize } from '../utils/format';
import { localPathToAppUrl } from '../utils/url';
import { colors, spacing, radius, fontSize, zIndex, shadows, transitions, layout as layoutTokens } from '../styles/tokens';
import { ContextMenu } from './ContextMenu';

// --- 静态样式常量（避免每次渲染创建新对象） ---
const cardWrapperStyle: React.CSSProperties = {
  borderRadius: radius.md,
  overflow: 'hidden',
  boxShadow: shadows.card,
  background: colors.bgBase,
  border: `1px solid ${colors.borderCard}`,
  position: 'relative',
  cursor: 'pointer',
};
const imageWrapperStyle: React.CSSProperties = { width: '100%', position: 'relative', overflow: 'hidden' };
const imgStyle: React.CSSProperties = { width: '100%', height: 'auto', display: 'block', cursor: 'pointer' };
const infoBtnStyle: React.CSSProperties = {
  position: 'absolute', top: 6, right: 6, width: 28, height: 28,
  borderRadius: radius.round, background: 'rgba(0, 0, 0, 0.35)',
  backdropFilter: 'blur(8px)', color: '#FFFFFF', zIndex: zIndex.sticky,
  display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none',
};
const containerStyle: React.CSSProperties = { position: 'relative' };
const previewImgStyle: React.CSSProperties = { display: 'none' };

export interface ImageGridProps {
  images: any[];
  onReload: () => void;
  groupBy?: 'none' | 'day' | 'month' | 'year';
  // 排序方式：按时间（修改时间优先）或按文件名
  sortBy?: 'time' | 'name';
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

/** ImageCard 的 props 接口 */
interface ImageCardProps {
  image: any;
  thumbnailPath: string | null | undefined;
  onImageInfo: (image: any) => void;
  onPreviewClick: (previewSrc: string, imageId: number, filename: string) => void;
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
    return items;
  }, [image, onImageInfo, onSetCover, currentGallery]);

  return (
    <ContextMenu items={imageContextItems}>
    <div
      className="card-ios-hover"
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
          {/* 右上角信息按钮 -- 圆形 */}
          {!isThumbnailLoading && (
            <Button
              type="text"
              size="small"
              icon={<TagsOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                onImageInfo(image);
              }}
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                width: 28,
                height: 28,
                borderRadius: radius.round,
                background: 'rgba(0, 0, 0, 0.35)',
                backdropFilter: 'blur(8px)',
                color: '#FFFFFF',
                zIndex: zIndex.sticky,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
              }}
            />
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
  groupBy = 'none',
  sortBy = 'time',
  showTimeline = false,
  layout = 'waterfall',
  onSetCover,
  currentGallery,
  batchSize = 200
}) => {
  const [selectedImage, setSelectedImage] = useState<any>(null);
  // 存储每个图片的缩略图路径，key 是 image.id
  const [thumbnailPaths, setThumbnailPaths] = useState<Record<number, string | null>>({});
  // 单图预览状态（替代 Image.PreviewGroup，避免 2000+ 图片创建隐藏预览节点）
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewImage, setPreviewImage] = useState<string>('');

  // 加载所有图片的缩略图（异步批量加载）
  useEffect(() => {
    if (!window.electronAPI || images.length === 0) {
      // 图片列表为空时清空缩略图缓存，释放内存
      setThumbnailPaths({});
      return;
    }

    console.log(`[ImageGrid] 开始加载 ${images.length} 张图片的缩略图`);

    // 重置缩略图状态，避免旧数据无界累积
    setThumbnailPaths({});

    // 用于取消已过时的加载任务
    let cancelled = false;

    const loadThumbnails = async () => {
      const thumbnails: Record<number, string | null> = {};
      let pendingSinceLastFlush = 0;

      // 批量加载缩略图，限制并发数量以避免过载
      const concurrency = 10; // 每次并发10张
      const flushInterval = 100; // 每100张刷新一次UI
      for (let i = 0; i < images.length; i += concurrency) {
        if (cancelled) return;

        const batch = images.slice(i, i + concurrency);

        await Promise.all(
          batch.map(async (image) => {
            if (!image.filepath || cancelled) return;
            try {
              const result = await window.electronAPI.image.getThumbnail(image.filepath);
              if (cancelled) return;
              if (result.success && result.data) {
                thumbnails[image.id] = result.data;
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
        if (!cancelled && (pendingSinceLastFlush >= flushInterval || i + concurrency >= images.length)) {
          setThumbnailPaths({ ...thumbnails });
          pendingSinceLastFlush = 0;
        }
      }

      if (!cancelled) {
        console.log(`[ImageGrid] 缩略图加载完成，成功: ${Object.values(thumbnails).filter(t => t !== null).length}/${images.length}`);
      }
    };

    loadThumbnails();

    // 清理函数：images 变化时取消旧的加载任务
    return () => {
      cancelled = true;
    };
  }, [images]);

  // 使用 useCallback 包裹回调，确保 ImageCard 的 React.memo 能正确跳过重渲染
  const handleImageInfo = useCallback((image: any) => {
    console.log(`[ImageGrid] 查看图片信息: ${image.filename} (ID: ${image.id})`);
    setSelectedImage(image);
  }, []);

  // 点击预览回调：先检查源文件是否存在，丢失则提示并上报（仅首次入库）
  const handlePreviewClick = useCallback(async (previewSrc: string, imageId: number, filename: string) => {
    if (imageId && window.electronAPI) {
      try {
        const result = await window.electronAPI.gallery.reportInvalidImage(imageId);
        if (result.success || result.error === '图片记录不存在') {
          // 文件丢失（首次或已迁移），仅提示，不刷新页面
          message.warning(`源文件已丢失: ${filename}`);
          return;
        }
        // '源文件仍然存在' → 文件正常，继续预览
      } catch {
        // 检查失败，继续尝试预览
      }
    }
    setPreviewImage(previewSrc);
    setPreviewVisible(true);
  }, []);

  // 先按批次分组，再在每个批次内按时间分组
  const groupedImages = useMemo(() => {
    console.log(`[ImageGrid] 重新计算图片分组和排序，图片数量: ${images.length}, 分组: ${groupBy}, 排序: ${sortBy}, 批次大小: ${batchSize}`);
    const sorted = [...images].sort((a, b) => {
      if (sortBy === 'name') {
        return (a.filename || '').localeCompare(b.filename || '');
      }
      // 默认按修改时间倒序（最近的在前）
      return (
        new Date(b.updatedAt || b.createdAt || 0).getTime() -
        new Date(a.updatedAt || a.createdAt || 0).getTime()
      );
    });

    if (groupBy === 'none') {
      console.log('[ImageGrid] 不分组，直接返回所有图片');
      return { '__all__': sorted };
    }

    // 先按批次分组
    const batches: any[][] = [];
    for (let i = 0; i < sorted.length; i += batchSize) {
      batches.push(sorted.slice(i, i + batchSize));
    }
    console.log(`[ImageGrid] 分为 ${batches.length} 个批次`);

    // 在每个批次内按时间分组
    const finalGroups: Record<string, any[]> = {};
    batches.forEach((batch, batchIndex) => {
      const batchGroups: Record<string, any[]> = {};
      for (const img of batch) {
        const timeKey = getDateGroupKey(img, groupBy);
        if (!batchGroups[timeKey]) batchGroups[timeKey] = [];
        batchGroups[timeKey].push(img);
      }

      // 将批次内的分组添加到最终分组，使用批次前缀区分
      for (const [timeKey, imgs] of Object.entries(batchGroups)) {
        // 如果只有一个批次，直接使用时间键；否则添加批次前缀
        const finalKey = batches.length === 1 ? timeKey : `批次${batchIndex + 1}_${timeKey}`;
        finalGroups[finalKey] = imgs;
      }
    });

    const groupKeys = Object.keys(finalGroups);
    console.log(`[ImageGrid] 分组完成，分组数量: ${groupKeys.length}, 分组键: ${groupKeys.join(', ')}`);
    return finalGroups;
  }, [images, groupBy, sortBy, batchSize]);



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
              // 解析分组键：如果是批次格式 "批次1_2024年11月17日"，提取时间部分
              const displayTitle = key.includes('_') ? key.split('_').slice(1).join('_') : key;

              return (
                <div key={key} style={{ marginBottom: groupBy === 'none' ? 0 : spacing.xxl }} id={key}>
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
                key={`timeline-${key}`}
                style={{ marginBottom: spacing.lg, cursor: 'pointer', pointerEvents: 'auto' }}
                onClick={() => {
                  const el = document.getElementById(key);
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                }}
              >
                {key}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 图片信息模态框 */}
      <Modal
        open={!!selectedImage}
        title="图片信息"
        footer={null}
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
