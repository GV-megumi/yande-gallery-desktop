/**
 * Booru 分页控制 — 插画站风格
 * 页码按钮 + 省略号点击输入跳转
 */

import React, { useState, useRef, useEffect } from 'react';
import { Button, InputNumber } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { colors, spacing, radius, fontSize } from '../styles/tokens';

interface PaginationControlProps {
  currentPage: number;
  currentCount: number;
  itemsPerPage: number;
  paginationPosition: 'top' | 'bottom' | 'both';
  position: 'top' | 'bottom';
  onPrevious: () => void;
  onNext: () => void;
  /** 跳转到指定页码（可选，不提供时仅支持上下页） */
  onPageChange?: (page: number) => void;
}

const shouldRender = (config: string, position: string): boolean => {
  if (config === 'both') return true;
  return config === position;
};

/** 页码按钮样式 */
const pageButtonStyle = (active: boolean): React.CSSProperties => ({
  width: 32, height: 32,
  minWidth: 32,
  padding: 0,
  borderRadius: radius.sm,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: fontSize.sm,
  fontWeight: active ? 700 : 500,
  fontFamily: 'var(--font-mono, monospace)',
  color: active ? '#fff' : colors.textSecondary,
  background: active ? colors.primary : 'transparent',
  border: 'none',
  cursor: active ? 'default' : 'pointer',
  transition: 'all 0.15s ease',
});

/** 生成要显示的页码列表 */
function getPageNumbers(current: number, hasNext: boolean): number[] {
  // 估算总页数：如果 hasNext 则至少 current+1，否则就是 current
  const total = hasNext ? Math.max(current + 1, current + 5) : current;

  const pages: number[] = [];
  const range = new Set<number>();

  // 始终显示第 1 页
  range.add(1);

  // 当前页附近 (-2 ~ +2)
  for (let i = Math.max(2, current - 2); i <= Math.min(total, current + 2); i++) {
    range.add(i);
  }

  // 最后一页（如果确定是最后一页）
  if (!hasNext) range.add(current);

  const sorted = Array.from(range).sort((a, b) => a - b);

  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) {
      // 用 -1 表示省略号
      pages.push(-1);
    }
    pages.push(sorted[i]);
  }

  // 如果 hasNext 且最后显示的页码 <= current，追加省略号
  if (hasNext && sorted[sorted.length - 1] <= current + 2) {
    pages.push(-1);
  }

  return pages;
}

export const PaginationControl: React.FC<PaginationControlProps> = React.memo(({
  currentPage,
  currentCount,
  itemsPerPage,
  paginationPosition,
  position,
  onPrevious,
  onNext,
  onPageChange
}) => {
  if (!shouldRender(paginationPosition, position)) return null;

  const isTop = position === 'top';
  const hasPrev = currentPage > 1;
  const hasNext = currentCount >= itemsPerPage;

  const [jumpInputVisible, setJumpInputVisible] = useState(false);
  const [jumpValue, setJumpValue] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开跳转输入框时自动聚焦
  useEffect(() => {
    if (jumpInputVisible && inputRef.current) {
      inputRef.current.focus();
    }
  }, [jumpInputVisible]);

  const handleJump = () => {
    if (jumpValue && jumpValue >= 1 && jumpValue !== currentPage && onPageChange) {
      onPageChange(jumpValue);
    }
    setJumpInputVisible(false);
    setJumpValue(null);
  };

  const handlePageClick = (page: number) => {
    if (page === currentPage) return;
    if (onPageChange) {
      onPageChange(page);
    } else if (page === currentPage - 1) {
      onPrevious();
    } else if (page === currentPage + 1) {
      onNext();
    }
  };

  const pageNumbers = getPageNumbers(currentPage, hasNext);

  const arrowBtnStyle: React.CSSProperties = {
    width: 32, height: 32,
    borderRadius: radius.sm,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };

  return (
    <div style={{
      [isTop ? 'marginBottom' : 'marginTop']: spacing.lg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
    }}>
      {/* 上一页 */}
      <Button
        icon={<LeftOutlined />}
        disabled={!hasPrev}
        onClick={onPrevious}
        size="small"
        type="text"
        style={arrowBtnStyle}
      />

      {/* 页码按钮 */}
      {pageNumbers.map((page, idx) => {
        if (page === -1) {
          // 省略号 — 点击弹出输入框
          return jumpInputVisible ? (
            <InputNumber
              key={`jump-${idx}`}
              ref={inputRef as any}
              size="small"
              min={1}
              value={jumpValue}
              onChange={(v) => setJumpValue(v)}
              onPressEnter={handleJump}
              onBlur={handleJump}
              placeholder="页码"
              style={{
                width: 64, height: 32,
                borderRadius: radius.sm,
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: fontSize.sm,
              }}
              controls={false}
            />
          ) : (
            <button
              key={`ellipsis-${idx}`}
              onClick={() => {
                if (onPageChange) {
                  setJumpInputVisible(true);
                  setJumpValue(null);
                }
              }}
              style={{
                width: 32, height: 32,
                minWidth: 32,
                padding: 0,
                border: 'none',
                borderRadius: radius.sm,
                background: 'transparent',
                color: colors.textTertiary,
                fontSize: fontSize.sm,
                fontFamily: 'var(--font-mono, monospace)',
                cursor: onPageChange ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'color 0.15s ease',
                letterSpacing: 2,
              }}
              title={onPageChange ? '点击输入页码跳转' : undefined}
              onMouseEnter={(e) => { if (onPageChange) e.currentTarget.style.color = colors.primary; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = colors.textTertiary; }}
            >
              ...
            </button>
          );
        }

        return (
          <button
            key={page}
            onClick={() => handlePageClick(page)}
            style={pageButtonStyle(page === currentPage)}
            onMouseEnter={(e) => {
              if (page !== currentPage) {
                e.currentTarget.style.background = colors.bgGray;
              }
            }}
            onMouseLeave={(e) => {
              if (page !== currentPage) {
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            {page}
          </button>
        );
      })}

      {/* 下一页 */}
      <Button
        icon={<RightOutlined />}
        disabled={!hasNext}
        onClick={onNext}
        size="small"
        type="text"
        style={arrowBtnStyle}
      />
    </div>
  );
});

PaginationControl.displayName = 'PaginationControl';
