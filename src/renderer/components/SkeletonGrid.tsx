/**
 * 骨架屏网格组件
 * 替代 Spin 加载状态，提供更好的视觉反馈
 */

import React from 'react';
import { Skeleton } from 'antd';
import { spacing, radius, shadows } from '../styles/tokens';

interface SkeletonGridProps {
  /** 卡片数量（默认 12） */
  count?: number;
  /** 卡片宽度（默认 330） */
  cardWidth?: number;
  /** 卡片间距（默认 16） */
  gap?: number;
}

/**
 * Booru 图片网格骨架屏
 * 模拟图片卡片的加载占位效果
 */
export const SkeletonGrid: React.FC<SkeletonGridProps> = ({
  count = 12,
  cardWidth = 330,
  gap = spacing.lg,
}) => {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            width: cardWidth,
            borderRadius: radius.md,
            overflow: 'hidden',
            boxShadow: shadows.card,
            background: '#fff',
          }}
        >
          {/* 图片占位 */}
          <Skeleton.Image
            active
            style={{ width: cardWidth, height: cardWidth * 0.75, display: 'block' }}
          />
          {/* 文字占位 */}
          <div style={{ padding: spacing.sm }}>
            <Skeleton active paragraph={{ rows: 1, width: '60%' }} title={false} />
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * 图库瀑布流骨架屏
 * 模拟本地图库的加载占位效果
 */
export const SkeletonWaterfall: React.FC<{ count?: number }> = ({ count = 8 }) => {
  // 随机高度模拟瀑布流
  const heights = React.useMemo(
    () => Array.from({ length: count }).map(() => 150 + Math.floor(Math.random() * 150)),
    [count]
  );

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm }}>
      {heights.map((h, i) => (
        <div
          key={i}
          style={{
            width: 200,
            height: h,
            borderRadius: radius.md,
            overflow: 'hidden',
          }}
        >
          <Skeleton.Image active style={{ width: 200, height: h, display: 'block' }} />
        </div>
      ))}
    </div>
  );
};
