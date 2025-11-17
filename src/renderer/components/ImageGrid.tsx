import React, { useState, useMemo, useEffect, useRef, memo, useCallback } from 'react';
import { Card, Image, Tag, Button, Modal, Descriptions, Space, Tooltip, Popover } from 'antd';
import { EyeOutlined, TagsOutlined, ZoomInOutlined, ZoomOutOutlined, LeftOutlined, RightOutlined, ReloadOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { formatFileSize } from '../utils/format';

interface ImageGridProps {
  images: any[];
  onReload: () => void;
  groupBy?: 'none' | 'day' | 'month' | 'year';
  // 排序方式：按时间（修改时间优先）或按文件名
  sortBy?: 'time' | 'name';
  // 是否显示右侧时间刻度（仅对按时间分组时生效）
  showTimeline?: boolean;
}

// 将本地文件路径转换为 app:// 协议 URL
const getImageUrl = (filePath: string): string => {
  if (!filePath) return '';
  // 如果已经是 app:// 协议，直接返回
  if (filePath.startsWith('app://')) return filePath;
  // 将 Windows 路径中的反斜杠替换为斜杠，不再整体做 URL 编码
  const normalized = filePath.replace(/\\/g, '/');
  // 形成形如 app://M:/booru/xxx.png 的路径，由主进程协议处理器转换为本地文件路径
  return `app://${normalized}`;
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

// 增强的图片预览组件
interface EnhancedImagePreviewProps {
  open: boolean;
  imageIndex: number | null;
  images: any[];
  onClose: () => void;
  onIndexChange: (index: number | null) => void;
}

const EnhancedImagePreview: React.FC<EnhancedImagePreviewProps> = ({
  open,
  imageIndex,
  images,
  onClose,
  onIndexChange
}) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentImage = imageIndex !== null && images[imageIndex] ? images[imageIndex] : null;
  const imageUrl = currentImage ? getImageUrl(currentImage.filepath) : null;
  const isFirst = imageIndex === 0;
  const isLast = imageIndex !== null && imageIndex === images.length - 1;

  // 切换到上一张
  const handlePrev = useCallback(() => {
    if (imageIndex !== null && imageIndex > 0) {
      onIndexChange(imageIndex - 1);
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }
  }, [imageIndex, onIndexChange]);

  // 切换到下一张
  const handleNext = useCallback(() => {
    if (imageIndex !== null && imageIndex < images.length - 1) {
      onIndexChange(imageIndex + 1);
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }
  }, [imageIndex, images.length, onIndexChange]);

  // 重置缩放和位置
  const handleReset = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  // 缩放（以鼠标位置为中心）
  const handleZoom = useCallback((delta: number, mouseX?: number, mouseY?: number) => {
    if (containerRef.current && imgRef.current && mouseX !== undefined && mouseY !== undefined) {
      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();
      
      // 获取鼠标相对于容器的位置
      const mouseContainerX = mouseX - containerRect.left;
      const mouseContainerY = mouseY - containerRect.top;
      
      // 获取容器中心点
      const containerCenterX = containerRect.width / 2;
      const containerCenterY = containerRect.height / 2;
      
      // 计算当前鼠标位置相对于图片的坐标（考虑当前的缩放和位移）
      const zoomFactor = delta > 0 ? 1.1 : 0.9;
      const newScale = Math.max(0.5, Math.min(15, scale * zoomFactor)); // 上限从 5x 提高到 15x
      
      if (newScale === scale) return; // 已达到缩放限制
      
      // 计算缩放前鼠标在图片上的相对位置（归一化坐标，以图片中心为原点）
      const relativeX = (mouseContainerX - containerCenterX - position.x) / scale;
      const relativeY = (mouseContainerY - containerCenterY - position.y) / scale;
      
      // 计算缩放后需要的新位置，使得鼠标位置在视觉上保持不变
      const newPositionX = mouseContainerX - containerCenterX - relativeX * newScale;
      const newPositionY = mouseContainerY - containerCenterY - relativeY * newScale;
      
      setScale(newScale);
      setPosition({ x: newPositionX, y: newPositionY });
    } else {
      // 如果没有鼠标位置，使用容器中心缩放
      setScale(prev => {
        const newScale = prev * (delta > 0 ? 1.1 : 0.9);
        return Math.max(0.5, Math.min(15, newScale)); // 上限从 5x 提高到 15x
      });
    }
  }, [scale, position]);

  // 鼠标滚轮缩放（Ctrl + 滚轮，以鼠标位置为中心）
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      handleZoom(e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);
    }
  }, [handleZoom]);

  // 鼠标按下（开始拖拽）
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0 && scale > 1) { // 只在放大时允许拖拽
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  }, [scale, position]);

  // 鼠标移动（拖拽中）
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging && scale > 1) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  }, [isDragging, scale, dragStart]);

  // 鼠标释放（结束拖拽）
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // 键盘事件
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, handlePrev, handleNext, onClose]);

  // 重置状态当图片切换时
  useEffect(() => {
    if (imageIndex !== null) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }
  }, [imageIndex]);

  if (!open || !currentImage || !imageUrl) {
    return null;
  }

  // 提示信息内容
  const helpContent = (
    <div style={{ fontSize: 12, lineHeight: 1.8 }}>
      <div><strong>文件名：</strong>{currentImage.filename}</div>
      <div><strong>当前缩放：</strong>{Math.round(scale * 100)}%</div>
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.2)' }}>
        <div><strong>操作提示：</strong></div>
        <div>• Ctrl + 滚轮：缩放图片</div>
        <div>• 鼠标左键拖拽：移动放大后的图片</div>
        <div>• ← → 或 ↑ ↓：切换上一张/下一张</div>
        <div>• Esc：关闭预览</div>
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      title={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <span>图片预览 ({imageIndex !== null ? imageIndex + 1 : 0} / {images.length})</span>
          <Space size="small" style={{ marginRight: 40 }}>
            <Tooltip title="放大 (Ctrl+滚轮)">
              <Button
                type="text"
                icon={<ZoomInOutlined />}
                onClick={() => handleZoom(1)}
                disabled={scale >= 15}
              />
            </Tooltip>
            <Tooltip title="缩小 (Ctrl+滚轮)">
              <Button
                type="text"
                icon={<ZoomOutOutlined />}
                onClick={() => handleZoom(-1)}
                disabled={scale <= 0.5}
              />
            </Tooltip>
            <Tooltip title="重置">
              <Button
                type="text"
                icon={<ReloadOutlined />}
                onClick={handleReset}
                disabled={scale === 1 && position.x === 0 && position.y === 0}
              />
            </Tooltip>
            <Popover content={helpContent} title="操作提示" trigger="click" placement="bottomRight">
              <Button
                type="text"
                icon={<QuestionCircleOutlined />}
                style={{ fontSize: 16 }}
              />
            </Popover>
          </Space>
        </div>
      }
      footer={null}
      onCancel={onClose}
      width="90%"
      style={{ maxWidth: '1400px' }}
      styles={{
        body: { padding: 0, height: '80vh', overflow: 'hidden', background: '#fff' }
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          overflow: 'hidden',
          background: '#fff',
          cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default'
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* 图片容器 */}
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 0.2s ease-out'
          }}
        >
          <img
            ref={imgRef}
            src={imageUrl}
            alt={currentImage.filename}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              userSelect: 'none',
              pointerEvents: 'none'
            }}
            draggable={false}
          />
        </div>

        {/* 左侧上一张按钮 */}
        {!isFirst && (
          <Button
            type="primary"
            shape="circle"
            icon={<LeftOutlined />}
            onClick={handlePrev}
            style={{
              position: 'absolute',
              left: 20,
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 10,
              width: 48,
              height: 48,
              fontSize: 18
            }}
          />
        )}

        {/* 右侧下一张按钮 */}
        {!isLast && (
          <Button
            type="primary"
            shape="circle"
            icon={<RightOutlined />}
            onClick={handleNext}
            style={{
              position: 'absolute',
              right: 20,
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 10,
              width: 48,
              height: 48,
              fontSize: 18
            }}
          />
        )}
      </div>
    </Modal>
  );
};

// 图片卡片组件，移到外部以避免每次重新创建
interface ImageCardProps {
  image: any;
  onPreview: (imagePath: string, originalPath?: string, imageId?: number) => void;
  onImageInfo: (image: any) => void;
}

const ImageCard: React.FC<ImageCardProps> = memo(({ image, onPreview, onImageInfo }) => {
  const [thumbnailPath, setThumbnailPath] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  // 使用 ref 记录是否已经加载过，避免重复加载
  const hasLoadedRef = useRef(false);
  const loadingRef = useRef(false);

  // 尝试获取或生成缩略图（只执行一次）
  useEffect(() => {
    if (!window.electronAPI || !image.filepath || hasLoadedRef.current || loadingRef.current) {
      return;
    }

    loadingRef.current = true;

    // 先尝试获取已存在的缩略图路径
    window.electronAPI.image
      .getThumbnail(image.filepath)
      .then((result) => {
        if (result.success && result.data) {
          // 缩略图已存在，直接使用
          setThumbnailPath(result.data);
          hasLoadedRef.current = true;
          loadingRef.current = false;
          return null; // 标记为已找到，不继续生成
        } else {
          // 缩略图不存在，尝试生成
          setIsGenerating(true);
          return window.electronAPI.image.generateThumbnail(image.filepath, false);
        }
      })
      .then((generateResult) => {
        // 如果生成了缩略图，使用生成的路径
        if (generateResult && generateResult.success && generateResult.data) {
          setThumbnailPath(generateResult.data);
        }
        setIsGenerating(false);
        hasLoadedRef.current = true;
        loadingRef.current = false;
      })
      .catch((error) => {
        // 获取或生成失败时使用原图
        console.error('获取或生成缩略图失败:', error);
        setIsGenerating(false);
        hasLoadedRef.current = true;
        loadingRef.current = false;
      });
  }, [image.filepath]);

  // 确定要使用的图片路径：优先使用缩略图，如果不存在则使用原图
  const imageSrc = thumbnailPath || image.filepath;

  return (
    <Card
      hoverable
      bodyStyle={{ padding: 0 }}
      style={{ borderRadius: 8, overflow: 'hidden', margin: 0 }}
      cover={
        <div
          style={{
            width: '100%',
            position: 'relative',
            overflow: 'hidden',
            cursor: 'pointer',
            paddingBottom: '0',
            background: '#f0f0f0'
          }}
        >
          <img
            src={getImageUrl(imageSrc)}
            alt={image.filename}
            style={{ 
              width: '100%', 
              height: 'auto', 
              display: 'block',
              objectFit: 'cover',
              minHeight: '200px'
            }}
              onClick={() => onPreview(imageSrc, image.filepath, image.id)}
              loading="lazy"
          />
          {/* 右上角信息按钮 */}
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
              top: 4,
              right: 4,
              background: 'rgba(0,0,0,0.45)',
              color: '#fff'
            }}
          />
        </div>
      }
    />
  );
}, (prevProps, nextProps) => {
  // 只有当图片 ID 或 filepath 改变时才重新渲染
  // 返回 true 表示 props 相同，不需要重新渲染
  // 返回 false 表示 props 不同，需要重新渲染
  return prevProps.image.id === nextProps.image.id && 
         prevProps.image.filepath === nextProps.image.filepath &&
         prevProps.onPreview === nextProps.onPreview &&
         prevProps.onImageInfo === nextProps.onImageInfo;
});

export const ImageGrid: React.FC<ImageGridProps> = ({
  images,
  onReload,
  groupBy = 'none',
  sortBy = 'time',
  showTimeline = false
}) => {
  const [previewImageIndex, setPreviewImageIndex] = useState<number | null>(null);
  const [selectedImage, setSelectedImage] = useState<any>(null);
  
  // 所有图片的扁平列表（用于预览导航）
  const flatImages = useMemo(() => {
    const sorted = sortBy === 'name' 
      ? [...images].sort((a, b) => (a.filename || '').localeCompare(b.filename || ''))
      : images;
    
    if (groupBy === 'none') {
      return sorted;
    }
    
    // 按分组顺序展平
    const groups: Record<string, any[]> = {};
    for (const img of sorted) {
      const key = getDateGroupKey(img, groupBy);
      if (!groups[key]) groups[key] = [];
      groups[key].push(img);
    }
    
    // 展平所有组
    return Object.values(groups).flat();
  }, [images, groupBy, sortBy]);

  // 使用 useCallback 稳定函数引用，避免不必要的重新渲染
  const handlePreview = useCallback((imagePath: string, originalPath?: string, imageId?: number) => {
    // 找到当前图片在列表中的索引
    const imageObj = flatImages.find(img => 
      img.filepath === (originalPath || imagePath) || img.id === imageId
    );
    if (imageObj) {
      const index = flatImages.findIndex(img => img.id === imageObj.id);
      setPreviewImageIndex(index >= 0 ? index : null);
    } else {
      // 如果找不到，尝试通过路径匹配
      const index = flatImages.findIndex(img => 
        img.filepath === (originalPath || imagePath)
      );
      setPreviewImageIndex(index >= 0 ? index : null);
    }
  }, [flatImages]);

  const handleImageInfo = useCallback((image: any) => {
    setSelectedImage(image);
  }, []);

  // 根据 groupBy 对图片按修改时间分组（降序）
  // 注意：这里直接使用传入的images数组，不做额外处理
  // 对于"所有图片"分页模式，传入的就是当前页的20张图片
  // 对于"最近图片"和"图集"懒加载模式，传入的是已经slice过的图片
  const groupedImages = useMemo(() => {
    console.log(`[ImageGrid] 收到图片数量: ${images.length}`);
    
    // 直接使用传入的images，不进行额外排序（因为数据库已经排序了）
    // 只有在需要按文件名排序时才排序
    let sorted = images;
    if (sortBy === 'name') {
      sorted = [...images].sort((a, b) => {
        return (a.filename || '').localeCompare(b.filename || '');
      });
    }

    if (groupBy === 'none') {
      console.log(`[ImageGrid] 分组后数量: ${sorted.length} (groupBy=none)`);
      return { '__all__': sorted };
    }

    const groups: Record<string, any[]> = {};
    for (const img of sorted) {
      const key = getDateGroupKey(img, groupBy);
      if (!groups[key]) groups[key] = [];
      groups[key].push(img);
    }
    const totalInGroups = Object.values(groups).reduce((sum, group) => sum + group.length, 0);
    console.log(`[ImageGrid] 分组后总数量: ${totalInGroups} (groupBy=${groupBy})`);
    return groups;
  }, [images, groupBy, sortBy]);

  // 使用 useCallback 稳定 renderCard 函数引用
  const renderCard = useCallback((image: any) => {
    return <ImageCard key={image.id} image={image} onPreview={handlePreview} onImageInfo={handleImageInfo} />;
  }, [handlePreview, handleImageInfo]);

  return (
    <>
      <div style={{ position: 'relative' }}>
        {/* 主内容：按时间分段 + 瀑布流排版 */}
        <div>
          {Object.entries(groupedImages).map(([key, group]) => (
            <div key={key} style={{ marginBottom: groupBy === 'none' ? 0 : 32 }} id={key}>
              {groupBy !== 'none' && (
                <div
                  style={{
                    margin: '8px 0 12px',
                    fontWeight: 600,
                    fontSize: groupBy === 'year' ? 20 : groupBy === 'month' ? 18 : 16,
                    color: '#666'
                  }}
                >
                  {key}
                </div>
              )}
              <div
                style={{
                  columnWidth: '220px',
                  columnGap: '16px',
                  columnCount: 'auto',
                  columnFill: 'balance'
                } as React.CSSProperties}
              >
                {group.map((image: any) => {
                  return (
                    <div key={image.id} style={{ breakInside: 'avoid', marginBottom: '16px' }}>
                      {renderCard(image)}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* 右侧时间刻度，仅在按时间分组时显示 */}
        {showTimeline && groupBy !== 'none' && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              paddingLeft: 8,
              paddingRight: 4,
              fontSize: 12,
              color: '#999',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              pointerEvents: 'none'
            }}
          >
            {Object.keys(groupedImages).map((key) => (
              <div
                key={`timeline-${key}`}
                style={{ marginBottom: 16, cursor: 'pointer', pointerEvents: 'auto' }}
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

      {/* 图片预览模态框 - 增强版：支持缩放、拖拽、上一张/下一张 */}
      <EnhancedImagePreview
        open={previewImageIndex !== null}
        imageIndex={previewImageIndex}
        images={flatImages}
        onClose={() => setPreviewImageIndex(null)}
        onIndexChange={setPreviewImageIndex}
      />

      {/* 图片信息模态框 */}
      <Modal
        open={!!selectedImage}
        title="图片信息"
        footer={null}
        onCancel={() => setSelectedImage(null)}
        width={600}
      >
        {selectedImage && (
          <Descriptions bordered column={1}>
            <Descriptions.Item label="文件名">{selectedImage.filename}</Descriptions.Item>
            <Descriptions.Item label="路径">{selectedImage.filepath}</Descriptions.Item>
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
        )}
      </Modal>
    </>
  );
};