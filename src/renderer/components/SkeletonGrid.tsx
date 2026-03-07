/**
 * 骨架屏组件 — iOS shimmer 风格
 * 替代 Spin 加载状态，提供更好的视觉反馈
 */

import React from 'react';
import { colors, spacing, radius, shadows } from '../styles/tokens';

interface SkeletonGridProps {
  /** 卡片数量（默认 12） */
  count?: number;
  /** 卡片宽度（默认 330） */
  cardWidth?: number;
  /** 卡片间距（默认 16） */
  gap?: number;
}

/**
 * Booru 图片网格骨架屏 — iOS shimmer 动画
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
          className="ios-skeleton-shimmer"
          style={{
            width: cardWidth,
            borderRadius: radius.md,
            overflow: 'hidden',
            boxShadow: shadows.subtle,
            border: `1px solid ${colors.borderCard}`,
          }}
        >
          {/* 图片占位 */}
          <div style={{
            width: '100%',
            height: cardWidth * 0.75,
            background: colors.bgLight,
          }} />
          {/* 文字占位 */}
          <div style={{ padding: spacing.md }}>
            <div style={{
              height: 12,
              width: '60%',
              borderRadius: radius.xs,
              background: colors.bgDark,
              marginBottom: 8,
            }} />
            <div style={{
              height: 10,
              width: '40%',
              borderRadius: radius.xs,
              background: colors.bgDark,
            }} />
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * 图库瀑布流骨架屏 — iOS shimmer 动画
 */
export const SkeletonWaterfall: React.FC<{ count?: number }> = ({ count = 8 }) => {
  const heights = React.useMemo(
    () => Array.from({ length: count }).map(() => 150 + Math.floor(Math.random() * 150)),
    [count]
  );

  return (
    <div style={{
      columnWidth: 220,
      columnGap: 16,
    }}>
      {heights.map((h, i) => (
        <div
          key={i}
          className="ios-skeleton-shimmer"
          style={{
            width: '100%',
            height: h,
            borderRadius: radius.md,
            marginBottom: 16,
            breakInside: 'avoid',
            boxShadow: shadows.subtle,
          }}
        />
      ))}
    </div>
  );
};
