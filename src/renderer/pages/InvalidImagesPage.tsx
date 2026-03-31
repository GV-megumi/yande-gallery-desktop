import React, { useState, useEffect, useCallback } from 'react';
import { Button, Empty, message, Modal, Tooltip } from 'antd';
import { DeleteOutlined, ClearOutlined, CopyOutlined, WarningOutlined } from '@ant-design/icons';
import { localPathToAppUrl } from '../utils/url';
import { colors, spacing, radius, fontSize, zIndex, shadows } from '../styles/tokens';
import { ContextMenu } from '../components/ContextMenu';
import { LazyLoadFooter } from '../components/LazyLoadFooter';

interface InvalidImage {
  id: number;
  originalImageId: number;
  filename: string;
  filepath: string;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
  thumbnailPath: string | null;
  detectedAt: string;
  galleryId: number | null;
}

const PAGE_SIZE = 200;

export const InvalidImagesPage: React.FC = () => {
  const [images, setImages] = useState<InvalidImage[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  const loadImages = useCallback(async (pageNum: number, append: boolean = false) => {
    if (!window.electronAPI) return;
    setLoading(true);
    try {
      const result = await window.electronAPI.gallery.getInvalidImages(pageNum, PAGE_SIZE);
      if (result.success) {
        const data = result.data || [];
        setImages(prev => append ? [...prev, ...data] : data);
        setTotal(result.total ?? 0);
        setHasMore(data.length >= PAGE_SIZE);
        setPage(pageNum);
      } else {
        message.error('加载无效图片失败: ' + result.error);
      }
    } catch (error) {
      message.error('加载无效图片失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadImages(1);
  }, [loadImages]);

  const handleLoadMore = useCallback(() => {
    if (!loading && hasMore) {
      loadImages(page + 1, true);
    }
  }, [loading, hasMore, page, loadImages]);

  const handleDelete = useCallback(async (id: number) => {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.gallery.deleteInvalidImage(id);
      if (result.success) {
        setImages(prev => prev.filter(img => img.id !== id));
        setTotal(prev => prev - 1);
        message.success('已删除');
      } else {
        message.error('删除失败: ' + result.error);
      }
    } catch {
      message.error('删除失败');
    }
  }, []);

  const handleClearAll = useCallback(() => {
    Modal.confirm({
      title: '清空所有无效项',
      content: `确定要删除全部 ${total} 个无效项及其缩略图吗？此操作不可恢复。`,
      okText: '清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        if (!window.electronAPI) return;
        try {
          const result = await window.electronAPI.gallery.clearInvalidImages();
          if (result.success) {
            setImages([]);
            setTotal(0);
            setHasMore(false);
            message.success(`已清空 ${result.data?.deleted ?? 0} 个无效项`);
          } else {
            message.error('清空失败: ' + result.error);
          }
        } catch {
          message.error('清空失败');
        }
      },
    });
  }, [total]);

  const getImageUrl = (filePath: string | null): string | null => {
    if (!filePath) return null;
    if (filePath.startsWith('app://')) return filePath;
    return localPathToAppUrl(filePath);
  };

  if (!loading && images.length === 0) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <Empty
          description="没有无效图片"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </div>
    );
  }

  return (
    <div>
      {/* 顶部操作栏 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing.lg,
      }}>
        <span style={{ color: colors.textSecondary, fontSize: fontSize.sm }}>
          共 {total} 项无效图片
        </span>
        {total > 0 && (
          <Button
            danger
            icon={<ClearOutlined />}
            onClick={handleClearAll}
          >
            清空所有
          </Button>
        )}
      </div>

      {/* 瀑布流布局 */}
      <div style={{ columnWidth: 220, columnGap: 12 }}>
        {images.map(img => (
          <InvalidImageCard
            key={img.id}
            image={img}
            thumbnailUrl={getImageUrl(img.thumbnailPath)}
            onDelete={handleDelete}
          />
        ))}
      </div>

      {/* 懒加载底部 */}
      <LazyLoadFooter
        current={images.length}
        total={total}
        onLoadMore={handleLoadMore}
      />
    </div>
  );
};

/** 单个无效图片卡片 */
const InvalidImageCard: React.FC<{
  image: InvalidImage;
  thumbnailUrl: string | null;
  onDelete: (id: number) => void;
}> = React.memo(({ image, thumbnailUrl, onDelete }) => {
  const aspectRatio = image.width && image.height
    ? (image.height / image.width) * 100
    : 75;

  const contextItems = [
    {
      key: 'copyPath',
      label: '复制原路径',
      icon: <CopyOutlined />,
      onClick: () => {
        navigator.clipboard.writeText(image.filepath);
        message.success('已复制文件路径');
      },
    },
    { type: 'divider' as const },
    {
      key: 'delete',
      label: '删除此项',
      icon: <DeleteOutlined />,
      danger: true,
      onClick: () => onDelete(image.id),
    },
  ];

  return (
    <ContextMenu items={contextItems}>
      <div
        className="card-ios-hover"
        style={{
          breakInside: 'avoid',
          marginBottom: 12,
          borderRadius: radius.md,
          overflow: 'hidden',
          boxShadow: shadows.card,
          background: colors.bgBase,
          border: `1px solid ${colors.borderCard}`,
          position: 'relative',
          cursor: 'default',
        }}
      >
        {/* 缩略图区域 */}
        <div style={{ width: '100%', position: 'relative', overflow: 'hidden' }}>
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={image.filename}
              style={{ width: '100%', height: 'auto', display: 'block', opacity: 0.6 }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                paddingBottom: `${aspectRatio}%`,
                backgroundColor: colors.bgDark,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
              }}
            >
              <WarningOutlined style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: 32,
                color: colors.textQuaternary,
              }} />
            </div>
          )}

          {/* 右上角删除按钮 */}
          <Button
            type="text"
            size="small"
            icon={<DeleteOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(image.id);
            }}
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'rgba(0, 0, 0, 0.45)',
              backdropFilter: 'blur(8px)',
              color: '#FFFFFF',
              zIndex: zIndex.sticky,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
            }}
          />
        </div>

        {/* 信息区域 */}
        <div style={{ padding: `${spacing.sm}px ${spacing.sm}px`, lineHeight: 1.4 }}>
          <div style={{
            fontSize: fontSize.sm,
            fontWeight: 600,
            color: colors.textPrimary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {image.filename}
          </div>
          <Tooltip title={image.filepath} placement="bottom">
            <div style={{
              fontSize: 11,
              color: colors.textTertiary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginTop: 2,
            }}>
              {image.filepath}
            </div>
          </Tooltip>
          <div style={{
            fontSize: 11,
            color: colors.textQuaternary,
            marginTop: 2,
          }}>
            {new Date(image.detectedAt).toLocaleString()}
          </div>
        </div>
      </div>
    </ContextMenu>
  );
});

InvalidImageCard.displayName = 'InvalidImageCard';
