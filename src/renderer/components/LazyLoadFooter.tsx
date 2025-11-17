import React from 'react';
import { Button } from 'antd';

interface LazyLoadFooterProps {
  current: number;
  total: number;
  onLoadMore: () => void;
  loadSize?: number; // 每次加载的数量，用于显示
}

/**
 * 懒加载底部组件，显示加载更多按钮
 */
export const LazyLoadFooter: React.FC<LazyLoadFooterProps> = ({
  current,
  total,
  onLoadMore,
  loadSize = 200
}) => {
  if (current >= total) {
    return null;
  }

  return (
    <div style={{ marginTop: 24, textAlign: 'center' }}>
      <Button onClick={onLoadMore}>
        加载更多（{current}/{total}）
      </Button>
    </div>
  );
};

