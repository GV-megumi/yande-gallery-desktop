import React from 'react';
import { Button } from 'antd';
import { spacing } from '../styles/tokens';

interface LazyLoadFooterProps {
  current: number;
  total: number;
  onLoadMore: () => void;
  loadSize?: number; // 每次加载的数量，用于显示
}

/**
 * 懒加载底部组件，显示加载更多按钮
 */
const footerStyle: React.CSSProperties = { marginTop: spacing.xl, textAlign: 'center' };

export const LazyLoadFooter: React.FC<LazyLoadFooterProps> = React.memo(({
  current,
  total,
  onLoadMore,
  loadSize = 200
}) => {
  if (current >= total) {
    return null;
  }

  return (
    <div style={footerStyle}>
      <Button onClick={onLoadMore}>
        加载更多（{current}/{total}）
      </Button>
    </div>
  );
});

LazyLoadFooter.displayName = 'LazyLoadFooter';

