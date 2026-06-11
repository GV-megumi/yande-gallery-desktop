/**
 * 可排序菜单组件
 * - 长按 500ms 激活拖拽，松手完成排序
 * - 右键单击显示上下文菜单（固定保活 / 快捷访问 / 关闭页面 / 单独窗口打开）
 * - 支持折叠（仅图标 + Tooltip）和展开（图标 + 文字）两种模式
 * - 排序结果通过 onReorder 回调通知父组件持久化
 */

import React, { useState } from 'react';
import { Tooltip, Dropdown, type MenuProps } from 'antd';
import { PushpinOutlined, ExportOutlined, ThunderboltOutlined, CloseOutlined } from '@ant-design/icons';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { colors } from '../styles/tokens';

export interface SortableMenuItem {
  key: string;
  icon?: React.ReactNode;
  label?: React.ReactNode;
}

export interface SortableMenuProps {
  items: SortableMenuItem[];
  selectedKey: string;
  onSelect: (key: string) => void;
  /** 拖拽结束后返回新的 key 顺序，由父组件持久化 */
  onReorder: (newKeys: string[]) => void;
  isCollapsed: boolean;
  isDark: boolean;
  style?: React.CSSProperties;
  /** 当前 section 内已固定（保持后台加载）的 key */
  pinnedKeys?: string[];
  /** 固定/取消固定回调（currentlyPinned=true 表示当前已固定，点击后取消） */
  onPinToggle?: (key: string, currentlyPinned: boolean) => void;
  /** 当前 section 内已加入快捷访问的 key */
  quickKeys?: string[];
  /** 添加/移除快捷访问回调（currentlyQuick=true 表示已在快捷栏，点击后移除） */
  onQuickToggle?: (key: string, currentlyQuick: boolean) => void;
  /** 当前 section 内已缓存（后台挂载）的 key，用于缓存指示点 */
  cachedKeys?: string[];
  /** 可"关闭页面"（释放缓存）的 key：已缓存且非当前页 */
  closableKeys?: string[];
  /** 关闭页面缓存回调 */
  onClosePage?: (key: string) => void;
  /** 在子窗口中打开对应页面的回调 */
  onOpenSubWindow?: (key: string) => void;
}

/** 单个可排序菜单项 */
const SortableItem: React.FC<{
  item: SortableMenuItem;
  isActive: boolean;
  isCollapsed: boolean;
  isDark: boolean;
  onClick: () => void;
  isPinned: boolean;
  isQuick: boolean;
  isCached: boolean;
  isClosable: boolean;
  onPinToggle?: (key: string, currentlyPinned: boolean) => void;
  onQuickToggle?: (key: string, currentlyQuick: boolean) => void;
  onClosePage?: (key: string) => void;
  onOpenSubWindow?: (key: string) => void;
}> = ({ item, isActive, isCollapsed, onClick, isPinned, isQuick, isCached, isClosable, onPinToggle, onQuickToggle, onClosePage, onOpenSubWindow }) => {
  const [hovered, setHovered] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.key });

  // 颜色统一走设计 token（colors 为随主题切换的 Proxy，渲染时按当前主题取值）
  const activeBg    = colors.sidebarActiveBg;
  const hoverBg     = colors.sidebarHoverBg;
  const activeColor = colors.sidebarActiveColor;
  const normalColor = colors.textSecondary;

  const innerEl = (
    <div
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      onClick={onClick}
      // 键盘可达性：Enter / Space 等同点击
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: isCollapsed ? 'center' : 'flex-start',
        height: 40,
        margin: '1px 8px',
        padding: isCollapsed ? 0 : '0 8px 0 12px',
        borderRadius: 8,
        cursor: isDragging ? 'grabbing' : 'pointer',
        background: isActive
          ? activeBg
          : hovered && !isDragging
            ? hoverBg
            : 'transparent',
        color: isActive ? activeColor : normalColor,
        fontSize: 14,
        fontWeight: isActive ? 600 : 400,
        transition: 'background 0.15s',
        userSelect: 'none',
        gap: isCollapsed ? 0 : 10,
        overflow: 'hidden',
      }}
    >
      {item.icon}
      {!isCollapsed && (
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.label}
        </span>
      )}
      {/* 已缓存（后台挂载）指示点 */}
      {isCached && !isActive && !isCollapsed && (
        <span
          title="页面已在后台保持运行"
          style={{ width: 6, height: 6, borderRadius: '50%', background: colors.primary, opacity: 0.45, flexShrink: 0 }}
        />
      )}
      {/* 已固定小指示器 */}
      {isPinned && !isCollapsed && (
        <PushpinOutlined style={{ fontSize: 10, opacity: 0.35, flexShrink: 0, marginLeft: 2 }} />
      )}
    </div>
  );

  // 右键上下文菜单：固定（保活）/ 快捷访问 / 关闭页面 / 单独窗口打开
  const contextMenuItems: NonNullable<MenuProps['items']> = [];
  if (onPinToggle) {
    contextMenuItems.push({
      key: 'pin-action',
      icon: <PushpinOutlined style={{ transform: isPinned ? 'rotate(45deg)' : 'none' }} />,
      label: isPinned ? '取消固定' : '固定（后台保持运行）',
    });
  }
  if (onQuickToggle) {
    contextMenuItems.push({
      key: 'quick-action',
      icon: <ThunderboltOutlined />,
      label: isQuick ? '移除快捷访问' : '添加快捷访问',
    });
  }
  if (onClosePage && isClosable) {
    contextMenuItems.push({
      key: 'close-page',
      icon: <CloseOutlined />,
      label: '关闭页面（释放缓存）',
    });
  }
  if (onOpenSubWindow) {
    if (contextMenuItems.length > 0) contextMenuItems.push({ type: 'divider' });
    contextMenuItems.push({
      key: 'open-sub-window',
      icon: <ExportOutlined />,
      label: '单独窗口打开',
    });
  }

  const withContextMenu = contextMenuItems.length > 0 ? (
    <Dropdown
      trigger={['contextMenu']}
      menu={{
        items: contextMenuItems,
        onClick: ({ key: menuKey }) => {
          if (menuKey === 'pin-action' && onPinToggle) {
            onPinToggle(item.key, isPinned);
          } else if (menuKey === 'quick-action' && onQuickToggle) {
            onQuickToggle(item.key, isQuick);
          } else if (menuKey === 'close-page' && onClosePage) {
            onClosePage(item.key);
          } else if (menuKey === 'open-sub-window' && onOpenSubWindow) {
            onOpenSubWindow(item.key);
          }
        },
      }}
    >
      {innerEl}
    </Dropdown>
  ) : innerEl;

  const el = (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition ?? undefined,
        opacity: isDragging ? 0.45 : 1,
        touchAction: 'none',
      }}
    >
      {withContextMenu}
    </div>
  );

  return isCollapsed ? (
    <Tooltip title={item.label} placement="right" mouseEnterDelay={0.3}>
      {el}
    </Tooltip>
  ) : el;
};

/** 可排序菜单容器 */
export const SortableMenu: React.FC<SortableMenuProps> = ({
  items,
  selectedKey,
  onSelect,
  onReorder,
  isCollapsed,
  isDark,
  style,
  pinnedKeys = [],
  onPinToggle,
  quickKeys = [],
  onQuickToggle,
  cachedKeys = [],
  closableKeys = [],
  onClosePage,
  onOpenSubWindow,
}) => {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { delay: 500, tolerance: 5 },
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex(i => i.key === String(active.id));
    const newIndex = items.findIndex(i => i.key === String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(items, oldIndex, newIndex);
    console.log('[SortableMenu] 菜单排序变更:', reordered.map(i => i.key));
    onReorder(reordered.map(i => i.key));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
    >
      <SortableContext items={items.map(i => i.key)} strategy={verticalListSortingStrategy}>
        <div style={{ padding: '4px 0', ...style }}>
          {items.map(item => (
            <SortableItem
              key={item.key}
              item={item}
              isActive={selectedKey === item.key}
              isCollapsed={isCollapsed}
              isDark={isDark}
              onClick={() => onSelect(item.key)}
              isPinned={pinnedKeys.includes(item.key)}
              isQuick={quickKeys.includes(item.key)}
              isCached={cachedKeys.includes(item.key)}
              isClosable={closableKeys.includes(item.key)}
              onPinToggle={onPinToggle}
              onQuickToggle={onQuickToggle}
              onClosePage={onClosePage}
              onOpenSubWindow={onOpenSubWindow}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
};
