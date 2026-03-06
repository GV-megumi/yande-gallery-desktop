/**
 * Booru 动态网格布局组件
 * 按 ID 排序，每行显示多张图片，每行高度取该行图片的最大高度
 * 提取自 BooruPage、BooruFavoritesPage、BooruTagSearchPage 的重复实现
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { BooruImageCard } from './BooruImageCard';
import { BooruPost, BooruSite } from '../../shared/types';

export interface BooruGridLayoutProps {
  posts: BooruPost[];
  gridSize: number;
  spacing: number;
  borderRadius: number;
  selectedSite: BooruSite | null;
  onPreview: (post: BooruPost) => void;
  onDownload: (post: BooruPost) => void;
  onToggleFavorite: (post: BooruPost) => void;
  favorites: Set<number>;
  getPreviewUrl: (post: BooruPost) => string;
  onTagClick?: (tag: string) => void;
}

export const BooruGridLayout: React.FC<BooruGridLayoutProps> = React.memo(({
  posts,
  gridSize,
  spacing,
  borderRadius,
  selectedSite,
  onPreview,
  onDownload,
  onToggleFavorite,
  favorites,
  getPreviewUrl,
  onTagClick
}) => {
  // 按 ID 倒序排序（最新的在前）
  const sortedPosts = useMemo(() => {
    return [...posts].sort((a, b) => b.postId - a.postId);
  }, [posts]);

  // 计算每行能放多少张图片（根据容器宽度和 gridSize）
  const containerRef = useRef<HTMLDivElement>(null);
  const [itemsPerRow, setItemsPerRow] = useState(5);
  const [imageHeights, setImageHeights] = useState<Record<number, number>>({});

  useEffect(() => {
    const updateItemsPerRow = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        // 计算每行能放多少张：容器宽度 / (gridSize + spacing)
        const calculated = Math.floor((containerWidth + spacing) / (gridSize + spacing));
        setItemsPerRow(Math.max(1, calculated));
      }
    };

    updateItemsPerRow();
    window.addEventListener('resize', updateItemsPerRow);
    return () => window.removeEventListener('resize', updateItemsPerRow);
  }, [gridSize, spacing]);

  // 处理图片加载完成，记录高度
  const handleImageLoad = (postId: number, height: number) => {
    setImageHeights(prev => ({ ...prev, [postId]: height }));
  };

  // 将图片分组为行
  const rows = useMemo(() => {
    const result: BooruPost[][] = [];
    for (let i = 0; i < sortedPosts.length; i += itemsPerRow) {
      result.push(sortedPosts.slice(i, i + itemsPerRow));
    }
    return result;
  }, [sortedPosts, itemsPerRow]);

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      {rows.map((row, rowIndex) => {
        // 计算该行的最大高度
        // 如果该行的所有图片都已加载，使用实际高度；否则使用默认高度（gridSize 的 1.5 倍）
        const rowHeights = row.map(post => {
          const height = imageHeights[post.postId];
          return height || (gridSize * 1.5);
        });
        const maxHeight = Math.max(...rowHeights);

        return (
          <div
            key={rowIndex}
            style={{
              display: 'flex',
              gap: `${spacing}px`,
              marginBottom: `${spacing}px`,
              minHeight: `${maxHeight}px`
            }}
          >
            {row.map(post => (
              <div
                key={post.id}
                style={{
                  width: `${gridSize}px`,
                  flexShrink: 0,
                  borderRadius: `${borderRadius}px`,
                  overflow: 'hidden',
                  height: '100%'
                }}
              >
                <BooruImageCard
                  post={post}
                  siteName={selectedSite?.name || ''}
                  siteUrl={selectedSite?.url}
                  onPreview={onPreview}
                  onDownload={onDownload}
                  onToggleFavorite={onToggleFavorite}
                  isFavorited={favorites.has(post.id) || post.isFavorited}
                  previewUrl={getPreviewUrl(post)}
                  onImageLoad={handleImageLoad}
                  onTagClick={onTagClick}
                />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
});

BooruGridLayout.displayName = 'BooruGridLayout';
