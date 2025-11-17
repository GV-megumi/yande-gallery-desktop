import React from 'react';
import { Input } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

const { Search } = Input;

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
    <div style={{ marginBottom: '24px', display: 'flex', gap: '12px', alignItems: 'center' }}>
      <Search
        placeholder={placeholder}
        allowClear
        enterButton={<SearchOutlined />}
        style={style}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onSearch={onSearch}
      />
    </div>
  );
};

