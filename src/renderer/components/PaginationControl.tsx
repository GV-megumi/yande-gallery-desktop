/**
 * Booru 分页控制组件
 * 提取自 BooruPage、BooruFavoritesPage、BooruTagSearchPage 的重复分页逻辑
 */

import React from 'react';
import { Button, Space } from 'antd';
import { spacing } from '../styles/tokens';

interface PaginationControlProps {
  /** 当前页码 */
  currentPage: number;
  /** 当前页数据量（用于判断是否有下一页） */
  currentCount: number;
  /** 每页数据量 */
  itemsPerPage: number;
  /** 分页器位置配置 */
  paginationPosition: 'top' | 'bottom' | 'both';
  /** 当前渲染位置 */
  position: 'top' | 'bottom';
  /** 上一页回调 */
  onPrevious: () => void;
  /** 下一页回调 */
  onNext: () => void;
}

/**
 * 判断是否应在指定位置渲染分页器
 */
const shouldRender = (config: string, position: string): boolean => {
  if (config === 'both') return true;
  return config === position;
};

export const PaginationControl: React.FC<PaginationControlProps> = React.memo(({
  currentPage,
  currentCount,
  itemsPerPage,
  paginationPosition,
  position,
  onPrevious,
  onNext
}) => {
  if (!shouldRender(paginationPosition, position)) return null;

  const isTop = position === 'top';

  return (
    <div style={{
      [isTop ? 'marginBottom' : 'marginTop']: spacing.xl,
      textAlign: 'center'
    }}>
      <Space>
        <Button
          disabled={currentPage <= 1}
          onClick={onPrevious}
        >
          上一页
        </Button>
        <span>第 {currentPage} 页</span>
        <Button
          disabled={currentCount < itemsPerPage}
          onClick={onNext}
        >
          下一页
        </Button>
      </Space>
    </div>
  );
});

PaginationControl.displayName = 'PaginationControl';
