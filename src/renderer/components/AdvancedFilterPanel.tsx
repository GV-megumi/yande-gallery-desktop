/**
 * 高级帖子过滤面板
 * 提供评分范围、尺寸范围、排序方式等过滤条件
 * 过滤条件会转换为 meta-tags 追加到搜索查询中
 */

import React, { useState, useCallback } from 'react';
import { Popover, Button, InputNumber, Select, Space, Tag, Divider } from 'antd';
import { FilterOutlined } from '@ant-design/icons';
import { colors, fontSize, spacing } from '../styles/tokens';

const { Option } = Select;

/** 过滤条件 */
export interface FilterConfig {
  scoreMin?: number;
  scoreMax?: number;
  widthMin?: number;
  widthMax?: number;
  heightMin?: number;
  heightMax?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/** 排序选项 */
const sortOptions = [
  { label: '默认', value: '' },
  { label: '评分', value: 'score' },
  { label: 'ID', value: 'id' },
  { label: '日期', value: 'date' },
  { label: '收藏数', value: 'favcount' },
  { label: '文件大小', value: 'filesize' },
  { label: '尺寸（横向）', value: 'landscape' },
  { label: '尺寸（纵向）', value: 'portrait' },
  { label: '随机', value: 'random' },
];

/**
 * 将过滤条件转换为 Booru meta-tags 数组
 */
export function filterConfigToMetaTags(config: FilterConfig): string[] {
  const tags: string[] = [];
  if (config.scoreMin !== undefined && config.scoreMin > 0) {
    tags.push(`score:>=${config.scoreMin}`);
  }
  if (config.scoreMax !== undefined && config.scoreMax > 0) {
    tags.push(`score:<=${config.scoreMax}`);
  }
  if (config.widthMin !== undefined && config.widthMin > 0) {
    tags.push(`width:>=${config.widthMin}`);
  }
  if (config.widthMax !== undefined && config.widthMax > 0) {
    tags.push(`width:<=${config.widthMax}`);
  }
  if (config.heightMin !== undefined && config.heightMin > 0) {
    tags.push(`height:>=${config.heightMin}`);
  }
  if (config.heightMax !== undefined && config.heightMax > 0) {
    tags.push(`height:<=${config.heightMax}`);
  }
  if (config.sortBy) {
    if (config.sortBy === 'random') {
      tags.push('order:random');
    } else {
      tags.push(`order:${config.sortBy}`);
    }
  }
  return tags;
}

/**
 * 统计过滤条件中活跃的条件数量
 */
export function countActiveFilters(config: FilterConfig): number {
  let count = 0;
  if (config.scoreMin !== undefined && config.scoreMin > 0) count++;
  if (config.scoreMax !== undefined && config.scoreMax > 0) count++;
  if (config.widthMin !== undefined && config.widthMin > 0) count++;
  if (config.widthMax !== undefined && config.widthMax > 0) count++;
  if (config.heightMin !== undefined && config.heightMin > 0) count++;
  if (config.heightMax !== undefined && config.heightMax > 0) count++;
  if (config.sortBy) count++;
  return count;
}

/** 范围输入行 */
const RangeRow: React.FC<{
  label: string;
  minValue?: number;
  maxValue?: number;
  onMinChange: (value: number | null) => void;
  onMaxChange: (value: number | null) => void;
  min?: number;
  step?: number;
  placeholder?: [string, string];
}> = ({ label, minValue, maxValue, onMinChange, onMaxChange, min = 0, step = 1, placeholder = ['最小', '最大'] }) => (
  <div style={{ marginBottom: spacing.sm }}>
    <div style={{ fontSize: fontSize.xs, color: colors.textSecondary, marginBottom: 4 }}>{label}</div>
    <Space>
      <InputNumber
        size="small"
        style={{ width: 100 }}
        min={min}
        step={step}
        value={minValue}
        onChange={onMinChange}
        placeholder={placeholder[0]}
      />
      <span style={{ color: colors.textTertiary }}>~</span>
      <InputNumber
        size="small"
        style={{ width: 100 }}
        min={min}
        step={step}
        value={maxValue}
        onChange={onMaxChange}
        placeholder={placeholder[1]}
      />
    </Space>
  </div>
);

interface AdvancedFilterPanelProps {
  /** 当前过滤配置 */
  filterConfig: FilterConfig;
  /** 配置变更回调 */
  onFilterChange: (config: FilterConfig) => void;
  /** 是否禁用 */
  disabled?: boolean;
}

/** 过滤面板内容 */
const FilterContent: React.FC<{
  config: FilterConfig;
  onChange: (config: FilterConfig) => void;
}> = ({ config, onChange }) => {
  const update = useCallback((partial: Partial<FilterConfig>) => {
    onChange({ ...config, ...partial });
  }, [config, onChange]);

  const handleReset = () => {
    onChange({});
  };

  const activeCount = countActiveFilters(config);
  const metaTags = filterConfigToMetaTags(config);

  return (
    <div style={{ width: 280 }}>
      {/* 评分范围 */}
      <RangeRow
        label="评分范围"
        minValue={config.scoreMin}
        maxValue={config.scoreMax}
        onMinChange={(v) => update({ scoreMin: v ?? undefined })}
        onMaxChange={(v) => update({ scoreMax: v ?? undefined })}
        placeholder={['最低分', '最高分']}
      />

      {/* 宽度范围 */}
      <RangeRow
        label="宽度（像素）"
        minValue={config.widthMin}
        maxValue={config.widthMax}
        onMinChange={(v) => update({ widthMin: v ?? undefined })}
        onMaxChange={(v) => update({ widthMax: v ?? undefined })}
        step={100}
        placeholder={['最小宽度', '最大宽度']}
      />

      {/* 高度范围 */}
      <RangeRow
        label="高度（像素）"
        minValue={config.heightMin}
        maxValue={config.heightMax}
        onMinChange={(v) => update({ heightMin: v ?? undefined })}
        onMaxChange={(v) => update({ heightMax: v ?? undefined })}
        step={100}
        placeholder={['最小高度', '最大高度']}
      />

      <Divider style={{ margin: `${spacing.sm}px 0` }} />

      {/* 排序方式 */}
      <div style={{ marginBottom: spacing.sm }}>
        <div style={{ fontSize: fontSize.xs, color: colors.textSecondary, marginBottom: 4 }}>排序方式</div>
        <Select
          size="small"
          style={{ width: '100%' }}
          value={config.sortBy || ''}
          onChange={(value) => update({ sortBy: value || undefined })}
        >
          {sortOptions.map(opt => (
            <Option key={opt.value} value={opt.value}>{opt.label}</Option>
          ))}
        </Select>
      </div>

      <Divider style={{ margin: `${spacing.sm}px 0` }} />

      {/* 当前生成的 meta-tags 预览 */}
      {metaTags.length > 0 && (
        <div style={{ marginBottom: spacing.sm }}>
          <div style={{ fontSize: fontSize.xs, color: colors.textTertiary, marginBottom: 4 }}>
            将追加到搜索查询:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {metaTags.map(tag => (
              <Tag key={tag} color="blue" style={{ fontSize: fontSize.xs, margin: 0 }}>
                {tag}
              </Tag>
            ))}
          </div>
        </div>
      )}

      {/* 重置按钮 */}
      <Button
        size="small"
        type="text"
        danger
        onClick={handleReset}
        disabled={activeCount === 0}
        style={{ width: '100%' }}
      >
        重置所有过滤条件
      </Button>
    </div>
  );
};

/**
 * 高级过滤按钮（带 Popover 弹出面板）
 */
export const AdvancedFilterPanel: React.FC<AdvancedFilterPanelProps> = ({
  filterConfig,
  onFilterChange,
  disabled = false,
}) => {
  const activeCount = countActiveFilters(filterConfig);

  return (
    <Popover
      content={<FilterContent config={filterConfig} onChange={onFilterChange} />}
      title="高级过滤"
      trigger="click"
      placement="bottomRight"
      overlayStyle={{ zIndex: 1050 }}
    >
      <Button
        icon={<FilterOutlined />}
        disabled={disabled}
        type={activeCount > 0 ? 'primary' : 'default'}
        ghost={activeCount > 0}
      >
        过滤{activeCount > 0 ? ` (${activeCount})` : ''}
      </Button>
    </Popover>
  );
};
