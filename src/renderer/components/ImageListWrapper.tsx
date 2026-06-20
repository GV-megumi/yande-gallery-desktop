import React, { useEffect } from 'react';
import { Spin, Empty, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ImageGrid, ImageGridProps } from './ImageGrid';
import { SkeletonWaterfall } from './SkeletonGrid';

interface ImageListWrapperProps extends Omit<ImageGridProps, 'images'> {
  images: any[];
  loading?: boolean;
  emptyDescription?: string;
  children?: React.ReactNode; // 用于在 ImageGrid 之后添加额外内容（如分页器）
}

/**
 * 图片列表包装组件，统一处理 loading、empty 和 ImageGrid 的渲染逻辑
 */
export const ImageListWrapper: React.FC<ImageListWrapperProps> = React.memo(({
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
      sortOrder: imageGridProps.sortOrder,
      showTimeline: imageGridProps.showTimeline,
      hasOnSetCover: !!imageGridProps.onSetCover,
      hasCurrentGallery: !!imageGridProps.currentGallery,
      allProps: imageGridProps
    });
  }, [images.length, loading, emptyDescription, imageGridProps.layout, imageGridProps.groupBy, imageGridProps.sortBy, imageGridProps.sortOrder, imageGridProps.showTimeline, imageGridProps.onSetCover, imageGridProps.currentGallery]);

  useEffect(() => {
    if (!loading && images.length > 0) {
      console.log('[ImageListWrapper] 传递 props 给 ImageGrid:', {
        imagesCount: images.length,
        layout: imageGridProps.layout,
        groupBy: imageGridProps.groupBy,
        sortBy: imageGridProps.sortBy,
        sortOrder: imageGridProps.sortOrder,
      });
    }
  }, [images.length, loading, imageGridProps.layout, imageGridProps.groupBy, imageGridProps.sortBy, imageGridProps.sortOrder]);

  // 早期返回必须在所有 hooks 之后
  if (loading) {
    return <SkeletonWaterfall count={12} />;
  }

  if (images.length === 0) {
    // 空列表时仍然渲染 children（如分页器），保证空页可以点击"上一页"返回
    return (
      <>
        <Empty description={emptyDescription} style={{ marginTop: '100px' }}>
          {/* 注意：不要直接把 onClick 事件对象透传给 onReload（部分调用方带可选参数） */}
          {imageGridProps.onReload && (
            <Button icon={<ReloadOutlined />} onClick={() => imageGridProps.onReload()}>
              重新加载
            </Button>
          )}
        </Empty>
        {children}
      </>
    );
  }

  return (
    <>
      <ImageGrid images={images} {...imageGridProps} />
      {children}
    </>
  );
});

ImageListWrapper.displayName = 'ImageListWrapper';

