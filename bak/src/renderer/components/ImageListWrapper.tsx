import React, { useEffect } from 'react';
import { Spin, Empty } from 'antd';
import { ImageGrid, ImageGridProps } from './ImageGrid';

interface ImageListWrapperProps extends Omit<ImageGridProps, 'images'> {
  images: any[];
  loading?: boolean;
  emptyDescription?: string;
  children?: React.ReactNode; // 用于在 ImageGrid 之后添加额外内容（如分页器）
}

/**
 * 图片列表包装组件，统一处理 loading、empty 和 ImageGrid 的渲染逻辑
 */
export const ImageListWrapper: React.FC<ImageListWrapperProps> = ({
  images,
  loading = false,
  emptyDescription = '暂无图片',
  children,
  ...imageGridProps
}) => {
  // 所有 hooks 必须在任何早期返回之前调用
  useEffect(() => {
    console.log('[ImageListWrapper] 渲染，接收到的 props:', {
      imagesCount: images.length,
      loading,
      emptyDescription,
      layout: imageGridProps.layout,
      groupBy: imageGridProps.groupBy,
      sortBy: imageGridProps.sortBy,
      showTimeline: imageGridProps.showTimeline,
      hasOnSetCover: !!imageGridProps.onSetCover,
      hasCurrentGallery: !!imageGridProps.currentGallery,
      allProps: imageGridProps
    });
  }, [images.length, loading, emptyDescription, imageGridProps.layout, imageGridProps.groupBy, imageGridProps.sortBy, imageGridProps.showTimeline, imageGridProps.onSetCover, imageGridProps.currentGallery]);

  useEffect(() => {
    if (!loading && images.length > 0) {
      console.log('[ImageListWrapper] 传递 props 给 ImageGrid:', {
        imagesCount: images.length,
        layout: imageGridProps.layout,
        groupBy: imageGridProps.groupBy,
        sortBy: imageGridProps.sortBy
      });
    }
  }, [images.length, loading, imageGridProps.layout, imageGridProps.groupBy, imageGridProps.sortBy]);

  // 早期返回必须在所有 hooks 之后
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '50px' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (images.length === 0) {
    return <Empty description={emptyDescription} style={{ marginTop: '100px' }} />;
  }

  return (
    <>
      <ImageGrid images={images} {...imageGridProps} />
      {children}
    </>
  );
};

