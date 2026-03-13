/**
 * 可排序菜单组件
 * - 长按 500ms 激活拖拽，松手完成排序
 * - 右键单击显示上下文菜单（固定到底部 / 取消固定）
 * - 支持折叠（仅图标 + Tooltip）和展开（图标 + 文字）两种模式
 * - 排序结果通过 onReorder 回调通知父组件持久化
 */

import React, { useState } from 'react';
import { Tooltip, Dropdown } from 'antd';
import { PushpinOutlined } from '@ant-design/icons';
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
  /** 当前 section 内已固定的 key */
  pinnedKeys?: string[];
  /** 全局是否还能继续添加固定项（已达 5 个时为 false） */
  canAddPin?: boolean;
  /** 固定/取消固定回调（currentlyPinned=true 表示当前已固定，点击后取消） */
  onPinToggle?: (key: string, currentlyPinned: boolean) => void;
}

/** 单个可排序菜单项 */
const SortableItem: React.FC<{
  item: SortableMenuItem;
  isActive: boolean;
  isCollapsed: boolean;
  isDark: boolean;
  onClick: () => void;
  isPinned: boolean;
  canPin: boolean;
  onPinToggle?: (key: string, currentlyPinned: boolean) => void;
}> = ({ item, isActive, isCollapsed, isDark, onClick, isPinned, canPin, onPinToggle }) => {
  const [hovered, setHovered] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.key });

  const activeBg    = isDark ? 'rgba(129,140,248,0.15)' : 'rgba(79,70,229,0.08)';
  const hoverBg     = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
  const activeColor = isDark ? '#818CF8' : '#4F46E5';
  const normalColor = isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.55)';

  const innerEl = (
    <div
      {...attributes}
      {...listeners}
      onClick={onClick}
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
      {/* 已固定小指示器 */}
      {isPinned && !isCollapsed && (
        <PushpinOutlined style={{ fontSize: 10, opacity: 0.35, flexShrink: 0, marginLeft: 2 }} />
      )}
    </div>
  );

  // 右键上下文菜单（固定/取消固定）
  const withContextMenu = onPinToggle ? (
    <Dropdown
      trigger={['contextMenu']}
      menu={{
        items: [
          {
            key: 'pin-action',
            icon: <PushpinOutlined style={{ transform: isPinned ? 'rotate(45deg)' : 'none' }} />,
            label: isPinned ? '取消固定' : '固定到底部',
            disabled: !isPinned && !canPin,
          },
        ],
        onClick: () => onPinToggle(item.key, isPinned),
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
  canAddPin = true,
  onPinToggle,
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
              canPin={canAddPin || pinnedKeys.includes(item.key)}
              onPinToggle={onPinToggle}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
};
