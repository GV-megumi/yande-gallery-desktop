import React from 'react';
import { Button, Input, Space } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { spacing } from '../styles/tokens';

interface ImageSearchBarProps {
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  onSearch: (value: string) => void;
  style?: React.CSSProperties;
}

/**
 * 图片搜索栏组件，统一搜索框的样式和行为
 */
export const ImageSearchBar: React.FC<ImageSearchBarProps> = ({
  placeholder = '搜索图片...',
  value,
  onChange,
  onSearch,
  style = { width: 300 }
}) => {
  return (
    <div style={{ marginBottom: spacing.xl, display: 'flex', gap: spacing.md, alignItems: 'center' }}>
      <Space.Compact style={style}>
        <Input
          placeholder={placeholder}
          allowClear
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPressEnter={(e) => onSearch(e.currentTarget.value)}
        />
        <Button icon={<SearchOutlined />} onClick={() => onSearch(value)} />
      </Space.Compact>
    </div>
  );
};

