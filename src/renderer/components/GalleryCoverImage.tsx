import React from 'react';
import { Button, Tooltip } from 'antd';
import { InfoCircleOutlined, FolderOutlined } from '@ant-design/icons';
import { colors, spacing, radius, shadows } from '../styles/tokens';

interface GalleryCoverImageProps {
  coverImage?: any;
  /** 缩略图三态：undefined=加载中，string=缩略图路径，null=确认失败（回退原图） */
  thumbnailPath?: string | null;
  getImageUrl: (path: string) => string;
  onInfoClick?: () => void;
}

/**
 * 图集封面图片组件
 * 独立组件，不会影响图片列表的样式
 */
export const GalleryCoverImage: React.FC<GalleryCoverImageProps> = ({
  coverImage,
  thumbnailPath,
  getImageUrl,
  onInfoClick
}) => {
  // 缩略图三态：undefined=加载中（shimmer 占位），string=已加载，null=确认失败（回退原图）
  const isThumbnailLoading = !!coverImage && thumbnailPath === undefined;
  const displaySrc = typeof thumbnailPath === 'string'
    ? getImageUrl(thumbnailPath)
    : (coverImage?.filepath ? getImageUrl(coverImage.filepath) : undefined);

  return (
    <div
      className="card-hover-lift"
      style={{
        position: 'relative',
        width: '100%',
        paddingBottom: '100%', // 1:1 宽高比
        borderRadius: radius.sm,
        overflow: 'hidden',
        boxShadow: shadows.card,
        marginBottom: spacing.sm,
        background: colors.bgGray
      }}
    >
      {isThumbnailLoading ? (
        // 缩略图加载中：shimmer 骨架占位
        <div
          className="ios-skeleton-shimmer"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            borderRadius: 0
          }}
        />
      ) : displaySrc ? (
        <img
          src={displaySrc}
          alt="封面"
          className="image-fade-in"
          onLoad={(e) => {
            (e.target as HTMLImageElement).classList.add('loaded');
          }}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block'
          }}
        />
      ) : (
        // 无封面：文件夹图标占位
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: colors.bgGray
          }}
        >
          <FolderOutlined style={{ fontSize: 48, color: colors.textTertiary }} />
        </div>
      )}
      {onInfoClick && (
        <Tooltip title="图集信息">
          <Button
            type="text"
            size="small"
            icon={<InfoCircleOutlined />}
            aria-label="图集信息"
            onClick={(e) => {
              e.stopPropagation();
              onInfoClick();
            }}
            style={{
              position: 'absolute',
              top: spacing.xs,
              right: spacing.xs,
              width: 28,
              height: 28,
              borderRadius: radius.round,
              background: colors.overlayDark,
              backdropFilter: 'blur(8px)',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none'
            }}
          />
        </Tooltip>
      )}
    </div>
  );
};
