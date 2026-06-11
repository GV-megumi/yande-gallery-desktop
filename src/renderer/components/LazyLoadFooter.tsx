import React, { useEffect, useRef } from 'react';
import { Button } from 'antd';
import { colors, spacing, fontSize } from '../styles/tokens';

interface LazyLoadFooterProps {
  current: number;
  total: number;
  onLoadMore: () => void;
  /** 进入视口时自动加载（默认开启），按钮保留为兜底 */
  autoLoad?: boolean;
}

/**
 * 懒加载底部组件：
 * - 还有更多时显示"加载更多"按钮，并支持滚动进入视口自动加载
 * - 全部加载完后显示"已加载全部"提示
 */
const footerStyle: React.CSSProperties = { marginTop: spacing.xl, textAlign: 'center' };

export const LazyLoadFooter: React.FC<LazyLoadFooterProps> = React.memo(({
  current,
  total,
  onLoadMore,
  autoLoad = true
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 始终持有最新的 onLoadMore，避免回调变化导致 observer 反复重建
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  const hasMore = current < total;

  // 进入视口自动加载：每个批次只触发一次，待 current 变化（加载完成）后才允许再次触发
  useEffect(() => {
    if (!autoLoad || !hasMore) return;
    const el = containerRef.current;
    if (!el) return;

    let triggered = false; // 加载中防重复触发
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && !triggered) {
          triggered = true;
          console.log(`[LazyLoadFooter] 进入视口自动加载更多（${current}/${total}）`);
          onLoadMoreRef.current();
        }
      }
    }, { rootMargin: '200px' });

    observer.observe(el);
    return () => observer.disconnect();
  }, [autoLoad, hasMore, current, total]);

  // 没有任何内容时不渲染（避免空列表显示"已加载全部 0 项"）
  if (total <= 0) {
    return null;
  }

  if (!hasMore) {
    return (
      <div
        style={{
          textAlign: 'center',
          padding: spacing.xl,
          fontSize: fontSize.sm,
          color: colors.textTertiary,
        }}
      >
        已加载全部 {total} 项
      </div>
    );
  }

  return (
    <div ref={containerRef} style={footerStyle}>
      <Button onClick={onLoadMore}>
        加载更多（{current}/{total}）
      </Button>
    </div>
  );
});

LazyLoadFooter.displayName = 'LazyLoadFooter';
