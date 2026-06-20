/**
 * Booru 分页控制 — 插画站风格
 * 页码按钮 + 省略号点击输入跳转
 */

import React, { useState, useRef, useEffect } from 'react';
import { Button, InputNumber, Tooltip } from 'antd';
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
  /** 已知总数。未提供时保持旧的未知总数分页行为 */
  total?: number;
  disabled?: boolean;
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
function getPageNumbers(current: number, hasNext: boolean, totalPages?: number): number[] {
  if (totalPages !== undefined) {
    const total = Math.max(1, totalPages);
    const pages: number[] = [];
    const range = new Set<number>();

    range.add(1);
    range.add(total);

    for (let i = Math.max(2, current - 2); i <= Math.min(total - 1, current + 2); i++) {
      range.add(i);
    }

    const sorted = Array.from(range).sort((a, b) => a - b);

    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i] - sorted[i - 1] > 1) {
        pages.push(-1);
      }
      pages.push(sorted[i]);
    }

    return pages;
  }

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
  onPageChange,
  total,
  disabled = false
}) => {
  // 跳页输入框：记录被点击省略号的索引，只在对应位置渲染输入框
  const [jumpInputIndex, setJumpInputIndex] = useState<number | null>(null);
  const [jumpValue, setJumpValue] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开跳转输入框时自动聚焦
  useEffect(() => {
    if (jumpInputIndex !== null && inputRef.current) {
      inputRef.current.focus();
    }
  }, [jumpInputIndex]);

  // 注意：条件返回必须放在所有 hooks 之后，
  // 否则运行时切换分页位置配置会导致 hooks 数量变化而崩溃
  if (!shouldRender(paginationPosition, position)) return null;

  const isTop = position === 'top';
  const hasPrev = currentPage > 1;
  const knownTotalPages = typeof total === 'number' && Number.isFinite(total)
    ? Math.max(1, Math.ceil(total / Math.max(1, itemsPerPage)))
    : undefined;
  const hasNext = knownTotalPages !== undefined
    ? currentPage < knownTotalPages
    : currentCount >= itemsPerPage;

  const handleJump = () => {
    if (disabled) return;
    if (jumpValue && jumpValue >= 1 && jumpValue !== currentPage && (!knownTotalPages || jumpValue <= knownTotalPages) && onPageChange) {
      onPageChange(jumpValue);
    }
    setJumpInputIndex(null);
    setJumpValue(null);
  };

  const handlePageClick = (page: number) => {
    if (disabled) return;
    if (page === currentPage) return;
    if (onPageChange) {
      onPageChange(page);
    } else if (page === currentPage - 1) {
      onPrevious();
    } else if (page === currentPage + 1) {
      onNext();
    }
  };

  const pageNumbers = getPageNumbers(currentPage, hasNext, knownTotalPages);

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
      <Tooltip title="上一页">
        <Button
          icon={<LeftOutlined />}
          aria-label="上一页"
          disabled={disabled || !hasPrev}
          onClick={onPrevious}
          size="small"
          type="text"
          style={arrowBtnStyle}
        />
      </Tooltip>

      {/* 页码按钮 */}
      {pageNumbers.map((page, idx) => {
        if (page === -1) {
          // 省略号 — 点击在原位置弹出输入框（仅被点击的那个省略号变为输入框）
          return jumpInputIndex === idx ? (
            <InputNumber
              key={`jump-${idx}`}
              ref={inputRef as any}
              size="small"
              min={1}
              max={knownTotalPages}
              value={jumpValue}
              onChange={(v) => setJumpValue(v)}
              onPressEnter={handleJump}
              onBlur={handleJump}
              disabled={disabled}
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
                if (!disabled && onPageChange) {
                  setJumpInputIndex(idx);
                  setJumpValue(null);
                }
              }}
              disabled={disabled}
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
                cursor: disabled ? 'not-allowed' : onPageChange ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'color 0.15s ease',
                letterSpacing: 2,
              }}
              title={!disabled && onPageChange ? '点击输入页码跳转' : undefined}
              onMouseEnter={(e) => { if (!disabled && onPageChange) e.currentTarget.style.color = colors.primary; }}
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
            disabled={disabled}
            aria-current={page === currentPage ? 'page' : undefined}
            style={{
              ...pageButtonStyle(page === currentPage),
              cursor: disabled ? 'not-allowed' : page === currentPage ? 'default' : 'pointer',
            }}
            onMouseEnter={(e) => {
              if (!disabled && page !== currentPage) {
                e.currentTarget.style.background = colors.bgGray;
              }
            }}
            onMouseLeave={(e) => {
              if (!disabled && page !== currentPage) {
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            {page}
          </button>
        );
      })}

      {/* 下一页 */}
      <Tooltip title="下一页">
        <Button
          icon={<RightOutlined />}
          aria-label="下一页"
          disabled={disabled || !hasNext}
          onClick={onNext}
          size="small"
          type="text"
          style={arrowBtnStyle}
        />
      </Tooltip>
    </div>
  );
});

PaginationControl.displayName = 'PaginationControl';
