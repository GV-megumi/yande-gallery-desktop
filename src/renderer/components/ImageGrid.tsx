import React, { useState, useMemo } from 'react';
import { Card, Image, Tag, Button, Modal, Descriptions, Space } from 'antd';
import { EyeOutlined, TagsOutlined } from '@ant-design/icons';
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

export const ImageGrid: React.FC<ImageGridProps> = ({
  images,
  onReload,
  groupBy = 'none',
  sortBy = 'time',
  showTimeline = false,
  layout = 'waterfall',
  onSetCover,
  currentGallery
}) => {
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<any>(null);

  const handlePreview = (imagePath: string) => {
    setPreviewImage(getImageUrl(imagePath));
  };

  const handleImageInfo = (image: any) => {
    setSelectedImage(image);
  };

  // 根据 groupBy 对图片按修改时间分组（降序）
  const groupedImages = useMemo(() => {
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
      return { '__all__': sorted };
    }

    const groups: Record<string, any[]> = {};
    for (const img of sorted) {
      const key = getDateGroupKey(img, groupBy);
      if (!groups[key]) groups[key] = [];
      groups[key].push(img);
    }
    return groups;
  }, [images, groupBy, sortBy]);

  const renderCard = (image: any) => {
    return (
      <Card
        key={image.id}
        hoverable
        bodyStyle={{ padding: 0 }}
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
            <Image
              src={getImageUrl(image.filepath)}
              alt={image.filename}
              // 宽度自适应列宽，高度按图片实际比例缩放
              style={{ width: '100%', height: 'auto', display: 'block' }}
              preview={false}
              onClick={() => handlePreview(image.filepath)}
            />
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
                color: '#fff'
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

      {/* 图片预览模态框 */}
      <Modal
        open={!!previewImage}
        title="图片预览"
        footer={null}
        onCancel={() => setPreviewImage(null)}
        width="80%"
        style={{ maxWidth: '1200px' }}
      >
        {previewImage && (
          <div style={{ textAlign: 'center' }}>
            <Image
              src={previewImage}
              alt="Preview"
              style={{ maxWidth: '100%', maxHeight: '80vh' }}
              fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
            />
          </div>
        )}
      </Modal>

      {/* 图片信息模态框 */}
      <Modal
        open={!!selectedImage}
        title="图片信息"
        footer={null}
        onCancel={() => setSelectedImage(null)}
        width={600}
      >
        {selectedImage && (
          <>
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
            {onSetCover && currentGallery && (
              <div style={{ marginTop: 16, textAlign: 'right' }}>
                <Button
                  type={currentGallery.coverImageId === selectedImage.id ? 'primary' : 'default'}
                  onClick={() => {
                    if (onSetCover && selectedImage.id) {
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