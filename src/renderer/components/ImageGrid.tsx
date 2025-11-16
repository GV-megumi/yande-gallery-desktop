import React, { useState } from 'react';
import { Card, Image, Tag, Button, Modal, Descriptions, Space } from 'antd';
import { EyeOutlined, DownloadOutlined, TagsOutlined } from '@ant-design/icons';
import { formatFileSize } from '../utils/format';

interface ImageGridProps {
  images: any[];
  onReload: () => void;
}

export const ImageGrid: React.FC<ImageGridProps> = ({ images, onReload }) => {
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<any>(null);

  const handlePreview = (imagePath: string) => {
    setPreviewImage(imagePath);
  };

  const handleImageInfo = (image: any) => {
    setSelectedImage(image);
  };

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
        {images.map((image) => (
          <Card
            key={image.id}
            hoverable
            cover={
              <div style={{ height: '200px', overflow: 'hidden', cursor: 'pointer' }}>
                <Image
                  src={image.filepath}
                  alt={image.filename}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  preview={false}
                  onClick={() => handlePreview(image.filepath)}
                />
              </div>
            }
            actions={[
              <Button
                key="preview"
                type="text"
                icon={<EyeOutlined />}
                onClick={() => handlePreview(image.filepath)}
              >
                预览
              </Button>,
              <Button
                key="info"
                type="text"
                icon={<TagsOutlined />}
                onClick={() => handleImageInfo(image)}
              >
                信息
              </Button>
            ]}
          >
            <Card.Meta
              title={image.filename}
              description={
                <Space direction="vertical" size="small" style={{ width: '100%' }}>
                  <span>尺寸: {image.width} × {image.height}</span>
                  <span>大小: {formatFileSize(image.fileSize)}</span>
                  <span>格式: {image.format?.toUpperCase()}</span>
                  {image.tags && image.tags.length > 0 && (
                    <div>
                      {image.tags.slice(0, 3).map((tag: string) => (
                        <Tag key={tag} style={{ margin: '2px' }}>{tag}</Tag>
                      ))}
                    </div>
                  )}
                </Space>
              }
            />
          </Card>
        ))}
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