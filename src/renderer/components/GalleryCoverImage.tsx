import React, { useState, useEffect } from 'react';
import { Button } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';

interface GalleryCoverImageProps {
  coverImage?: any;
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
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        paddingBottom: '100%', // 1:1 宽高比
        borderRadius: '8px',
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        transition: 'box-shadow 0.3s ease, transform 0.3s ease',
        marginBottom: '8px',
        background: '#f0f0f0'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {coverImage ? (
        <img
          src={thumbnailPath
            ? getImageUrl(thumbnailPath)
            : (coverImage.filepath ? getImageUrl(coverImage.filepath) : undefined)}
          alt="封面"
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
            background: '#f0f0f0'
          }}
        >
          <div style={{ fontSize: '48px', color: '#ccc' }}>📁</div>
        </div>
      )}
      {onInfoClick && (
        <Button
          type="text"
          size="small"
          icon={<InfoCircleOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            onInfoClick();
          }}
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            background: 'rgba(0,0,0,0.45)',
            color: '#fff'
          }}
        />
      )}
    </div>
  );
};

