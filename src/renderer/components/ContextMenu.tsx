/**
 * 右键上下文菜单组件
 * 提供两种使用模式：
 * 1. ContextMenu 包装组件 - 右键子元素触发菜单
 * 2. useContextMenu + ContextMenuPortal - 用于 Table 等需要定位的场景
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Dropdown } from 'antd';
import type { MenuProps } from 'antd';

// ============================================================
// 模式1：包装组件（用于 Card、Tag 等）
// ============================================================

interface ContextMenuProps {
  /** 菜单项（Ant Design MenuProps['items'] 格式） */
  items: MenuProps['items'];
  /** 子元素 */
  children: React.ReactElement;
  /** 是否禁用 */
  disabled?: boolean;
}

/**
 * 右键菜单包装组件
 * 用法：
 * ```tsx
 * <ContextMenu items={[{ key: 'copy', label: '复制', onClick: handleCopy }]}>
 *   <Card>...</Card>
 * </ContextMenu>
 * ```
 */
export const ContextMenu: React.FC<ContextMenuProps> = ({ items, children, disabled }) => {
  if (disabled || !items || items.length === 0) return children;

  return (
    <Dropdown menu={{ items }} trigger={['contextMenu']}>
      {children}
    </Dropdown>
  );
};

// ============================================================
// 模式2：Hook + Portal（用于 Table 行等场景）
// ============================================================

interface ContextMenuState<T> {
  open: boolean;
  x: number;
  y: number;
  data: T | null;
}

/**
 * 右键菜单 Hook
 * 用于 Table onRow 等需要手动控制位置的场景
 *
 * 用法：
 * ```tsx
 * const menu = useContextMenu<DownloadQueueItem>();
 * <Table onRow={(record) => ({ onContextMenu: (e) => menu.show(e, record) })} />
 * <ContextMenuPortal open={menu.open} x={menu.x} y={menu.y} items={...} onClose={menu.close} />
 * ```
 */
export function useContextMenu<T = any>() {
  const [state, setState] = useState<ContextMenuState<T>>({
    open: false, x: 0, y: 0, data: null
  });

  const show = useCallback((e: React.MouseEvent, data: T) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ open: true, x: e.clientX, y: e.clientY, data });
  }, []);

  const close = useCallback(() => {
    setState(prev => ({ ...prev, open: false, data: null }));
  }, []);

  return { ...state, show, close };
}

interface ContextMenuPortalProps {
  open: boolean;
  x: number;
  y: number;
  items: MenuProps['items'];
  onClose: () => void;
}

/**
 * 右键菜单浮层
 * 配合 useContextMenu 使用，渲染在鼠标点击位置
 */
export const ContextMenuPortal: React.FC<ContextMenuPortalProps> = ({
  open, x, y, items, onClose
}) => {
  // 点击/右键其他位置时关闭
  useEffect(() => {
    if (!open) return;
    const handleClose = () => onClose();
    // 延迟添加监听，避免当前右键事件立即触发关闭
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClose);
      document.addEventListener('scroll', handleClose, true);
    }, 10);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClose);
      document.removeEventListener('scroll', handleClose, true);
    };
  }, [open, onClose]);

  if (!open || !items || items.length === 0) return null;

  return (
    <Dropdown
      open={true}
      onOpenChange={(vis) => { if (!vis) onClose(); }}
      menu={{ items, onClick: () => onClose() }}
      trigger={[]}
    >
      <div style={{
        position: 'fixed',
        left: x,
        top: y,
        width: 1,
        height: 1,
        pointerEvents: 'none'
      }} />
    </Dropdown>
  );
};
