import React from 'react';
import { Button, Tooltip } from 'antd';

/**
 * IconOnlyButton
 *
 * 纯图标按钮的统一封装：自动包裹 Tooltip，并设置 aria-label。
 * 用于新代码中所有"只有图标、没有文字"的按钮，确保悬停时
 * 能看到操作说明，同时对屏幕阅读器友好。
 *
 * 已有代码不强制迁移，新增纯图标按钮优先使用本组件。
 */

interface IconOnlyButtonProps {
  /** Tooltip 文案，同时用作 aria-label */
  title: string;
  icon: React.ReactNode;
  onClick?: (e?: React.MouseEvent<HTMLElement>) => void;
  loading?: boolean;
  danger?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
  size?: 'small' | 'middle' | 'large';
  /** 按钮类型，默认 "text" */
  type?: 'text' | 'link' | 'default' | 'primary' | 'dashed';
}

export const IconOnlyButton: React.FC<IconOnlyButtonProps> = ({
  title,
  icon,
  onClick,
  loading,
  danger,
  disabled,
  style,
  size,
  type = 'text',
}) => (
  <Tooltip title={title}>
    <Button
      type={type}
      icon={icon}
      onClick={onClick}
      loading={loading}
      danger={danger}
      disabled={disabled}
      aria-label={title}
      style={style}
      size={size}
    />
  </Tooltip>
);

export default IconOnlyButton;
