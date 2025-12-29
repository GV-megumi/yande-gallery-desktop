import React, { useState, useMemo, useEffect } from 'react';
import { Card, Image, Tag, Button, Modal, Descriptions, Space } from 'antd';
import { TagsOutlined } from '@ant-design/icons';
import { formatFileSize } from '../utils/format';

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
  // 如果已经是 app:// 协议，直接返回
  if (filePath.startsWith('app://')) return filePath;
  
  // Windows 路径处理: M:\path\to\file.png -> app://m/path/to/file.png
  if (filePath.match(/^[A-Z]:\\/i)) {
    const driveLetter = filePath[0].toLowerCase();
    const pathPart = filePath.substring(3).replace(/\\/g, '/');
    // 对路径中的每个部分单独编码，保留路径分隔符
    const encodedPath = pathPart.split('/').map(part => encodeURIComponent(part)).join('/');
    return `app://${driveLetter}/${encodedPath}`;
  }
  
  // Unix 路径或其他格式
  const normalized = filePath.replace(/\\/g, '/');
  const encodedPath = normalized.split('/').map(part => encodeURIComponent(part)).join('/');
  return `app://${encodedPath}`;
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

export const ImageGrid: React.FC<ImageGridProps> = ({
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

  // 加载所有图片的缩略图（异步批量加载）
  useEffect(() => {
    if (!window.electronAPI || images.length === 0) return;

    console.log(`[ImageGrid] 开始加载 ${images.length} 张图片的缩略图`);
    
    const loadThumbnails = async () => {
      const thumbnails: Record<number, string | null> = {};
      
      // 批量加载缩略图，但限制并发数量以避免过载
      const batchSize = 10; // 每次处理10张图片
      for (let i = 0; i < images.length; i += batchSize) {
        const batch = images.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (image) => {
            if (!image.filepath) return;
            
            try {
              const result = await window.electronAPI.image.getThumbnail(image.filepath);
              if (result.success && result.data) {
                thumbnails[image.id] = result.data;
                console.log(`[ImageGrid] 缩略图加载成功: ${image.filename} (ID: ${image.id})`);
              } else {
                console.warn(`[ImageGrid] 缩略图加载失败: ${image.filename} (ID: ${image.id}), 错误: ${result.error}`);
                thumbnails[image.id] = null;
              }
            } catch (error) {
              console.error(`[ImageGrid] 获取缩略图异常: ${image.filename} (ID: ${image.id})`, error);
              thumbnails[image.id] = null;
            }
          })
        );
        
        // 每批处理完后更新状态，让用户看到渐进式加载
        setThumbnailPaths((prev) => ({ ...prev, ...thumbnails }));
      }
      
      console.log(`[ImageGrid] 缩略图加载完成，成功: ${Object.values(thumbnails).filter(t => t !== null).length}/${images.length}`);
    };

    loadThumbnails();
  }, [images]);

  const handleImageInfo = (image: any) => {
    console.log(`[ImageGrid] 查看图片信息: ${image.filename} (ID: ${image.id})`);
    setSelectedImage(image);
  };

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

  const renderCard = (image: any) => {
    // 获取该图片的缩略图路径
    const thumbnailPath = thumbnailPaths[image.id];
    
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

    return (
      <Card
        key={image.id}
        hoverable
        styles={{ body: { padding: 0 } }}
        style={{ borderRadius: 8, overflow: 'hidden' }}
        cover={
          <div
            style={{
              width: '100%',
              position: 'relative',
              overflow: 'hidden',
              cursor: 'pointer'
            }}
          >
            {isThumbnailLoading ? (
              // 缩略图加载中：显示占位符，使用 padding-bottom 技巧保持宽高比
              <div
                style={{
                  width: '100%',
                  paddingBottom: `${aspectRatio}%`,
                  backgroundColor: '#f0f0f0',
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
                    color: '#999',
                    fontSize: '12px'
                  }}
                >
                  加载中...
                </div>
              </div>
            ) : displaySrc ? (
              // 有图片源（缩略图或原图），显示图片
              <Image
                src={displaySrc}
                alt={image.filename}
                // 宽度自适应列宽，高度按图片实际比例缩放
                style={{ width: '100%', height: 'auto', display: 'block' }}
                // 使用 Ant Design 的 preview 属性，支持上一张、下一张导航
                preview={{
                  src: previewSrc,
                  mask: <div style={{ color: '#fff', fontSize: '14px' }}>点击查看原图</div>
                }}
              />
            ) : (
              // 兜底：如果既没有缩略图也没有原图，显示占位符
              <div
                style={{
                  width: '100%',
                  paddingBottom: `${aspectRatio}%`,
                  backgroundColor: '#f0f0f0',
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
                    color: '#999',
                    fontSize: '12px'
                  }}
                >
                  加载失败
                </div>
              </div>
            )}
            {/* 右上角信息按钮 */}
            <Button
              type="text"
              size="small"
              icon={<TagsOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                handleImageInfo(image);
              }}
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                background: 'rgba(0,0,0,0.45)',
                color: '#fff',
                zIndex: 10,
                // 加载中时隐藏按钮
                display: isThumbnailLoading ? 'none' : 'block'
              }}
            />
          </div>
        }
      />
    );
  };

  return (
    <>
      <div style={{ position: 'relative' }}>
        {/* 使用 Image.PreviewGroup 包裹所有图片，支持上一张、下一张导航 */}
        <Image.PreviewGroup preview={{ 
          onChange: (current, prev) => {
            console.log(`[ImageGrid] 预览切换: ${prev} -> ${current}`);
          }
        }}>
          {/* 主内容：按时间分段 + 瀑布流排版 */}
          <div>
            {Object.entries(groupedImages).map(([key, group]) => {
              // 解析分组键：如果是批次格式 "批次1_2024年11月17日"，提取时间部分
              const displayTitle = key.includes('_') ? key.split('_').slice(1).join('_') : key;
              
              return (
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
                      {displayTitle}
                    </div>
                  )}
                <div
                  style={{
                    columnWidth: 220,
                    columnGap: 16
                  }}
                >
                  {group.map((image: any) => (
                    <div key={image.id} style={{ breakInside: 'avoid', marginBottom: 16 }}>
                      {renderCard(image)}
                    </div>
                  ))}
                </div>
              </div>
            );
            })}
          </div>
        </Image.PreviewGroup>

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
                    color: '#1890ff', 
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
              <div style={{ marginTop: 16, textAlign: 'right' }}>
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
};