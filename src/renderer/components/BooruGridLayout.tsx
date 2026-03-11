/**
 * Booru 瀑布流网格布局 — JS 分列 Masonry（先左右后上下）
 * 按行将每张图片分配到当前最短的列，保持自然浏览顺序
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { BooruImageCard } from './BooruImageCard';
import { BooruPost, BooruSite } from '../../shared/types';

export interface BooruGridLayoutProps {
  /** posts 应由调用方预先排序好 */
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
  onToggleServerFavorite?: (post: BooruPost) => void;
  serverFavorites?: Set<number>;
}

/** 根据帖子元数据估算图片在指定列宽下的渲染高度 */
const estimateHeight = (post: BooruPost, colWidth: number): number => {
  if (post.width && post.height && post.width > 0) {
    return (post.height / post.width) * colWidth;
  }
  // 没有尺寸信息时使用默认比例 3:4
  return colWidth * 1.33;
};

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
  onTagClick,
  onToggleServerFavorite,
  serverFavorites
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(5);
  const [containerWidth, setContainerWidth] = useState(0);
  // 记录上一次 posts 引用，仅在 posts 真正变化时播放入场动画
  const prevPostsRef = useRef<BooruPost[]>(posts);
  const shouldAnimate = prevPostsRef.current !== posts;
  useEffect(() => { prevPostsRef.current = posts; }, [posts]);

  // 根据容器宽度和 gridSize 计算列数（rAF 防抖避免连续 resize 频繁重算）
  useEffect(() => {
    let rafId = 0;
    const updateColumns = () => {
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        const cols = Math.max(2, Math.floor((w + spacing) / (gridSize + spacing)));
        setColumnCount(cols);
        setContainerWidth(w);
      }
    };

    updateColumns();
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updateColumns);
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => { observer.disconnect(); cancelAnimationFrame(rafId); };
  }, [gridSize, spacing]);

  // 实际列宽
  const colWidth = useMemo(() => {
    if (!containerWidth) return gridSize;
    const totalGap = spacing * (columnCount - 1);
    return (containerWidth - totalGap) / columnCount;
  }, [containerWidth, columnCount, spacing, gridSize]);

  // 将 posts 分配到各列（贪心：每次放到最短列）
  const columns = useMemo(() => {
    const cols: BooruPost[][] = Array.from({ length: columnCount }, () => []);
    const heights = new Array(columnCount).fill(0);

    for (const post of posts) {
      // 找到当前最短的列
      let minIdx = 0;
      for (let i = 1; i < columnCount; i++) {
        if (heights[i] < heights[minIdx]) minIdx = i;
      }
      cols[minIdx].push(post);
      heights[minIdx] += estimateHeight(post, colWidth) + spacing;
    }

    return cols;
  }, [posts, columnCount, colWidth, spacing]);

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        gap: `${spacing}px`,
        width: '100%',
        alignItems: 'flex-start',
      }}
    >
      {columns.map((colPosts, colIdx) => (
        <div
          key={colIdx}
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: `${spacing}px`,
          }}
        >
          {colPosts.map((post, index) => (
            <div
              key={post.id}
              className={shouldAnimate ? 'ios-card-appear' : undefined}
              style={shouldAnimate ? {
                animationDelay: `${Math.min((colIdx + index * columnCount) * 0.03, 0.5)}s`,
              } : undefined}
            >
              <BooruImageCard
                post={post}
                siteName={selectedSite?.name || ''}
                siteUrl={selectedSite?.url}
                onPreview={onPreview}
                onDownload={onDownload}
                onToggleFavorite={onToggleFavorite}
                isFavorited={favorites.has(post.postId) || !!post.isFavorited}
                previewUrl={getPreviewUrl(post)}
                onTagClick={onTagClick}
                onToggleServerFavorite={onToggleServerFavorite}
                isServerFavorited={serverFavorites?.has(post.postId)}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
});

BooruGridLayout.displayName = 'BooruGridLayout';
