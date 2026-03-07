/**
 * Booru 页面工具栏组件
 * 提取自 BooruPage、BooruFavoritesPage、BooruTagSearchPage 的重复工具栏逻辑
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button, Select, Space, Segmented, Affix, Input, Tag, AutoComplete } from 'antd';
import { ReloadOutlined, SearchOutlined, CloseOutlined, HistoryOutlined } from '@ant-design/icons';
import { BooruSite } from '../../shared/types';
import { colors, spacing, radius, shadows, fontSize, zIndex } from '../styles/tokens';

const { Search } = Input;
const { Option } = Select;

/** 分级筛选选项 */
const ratingOptions = [
  { label: '全部', value: 'all' },
  { label: '安全', value: 'safe' },
  { label: '存疑', value: 'questionable' },
  { label: '限制级', value: 'explicit' }
];

export type RatingFilter = 'all' | 'safe' | 'questionable' | 'explicit';

interface BooruPageToolbarProps {
  /** Booru 站点列表 */
  sites: BooruSite[];
  /** 当前选中站点 ID */
  selectedSiteId: number | null;
  /** 是否加载中 */
  loading: boolean;
  /** 分级筛选值 */
  ratingFilter: RatingFilter;
  /** Affix 顶部偏移 */
  offsetTop?: number;

  /** 站点变更回调 */
  onSiteChange: (siteId: number) => void;
  /** 分级变更回调 */
  onRatingChange: (rating: RatingFilter) => void;
  /** 刷新回调 */
  onRefresh: () => void;

  /** 是否显示搜索框（默认 false） */
  showSearch?: boolean;
  /** 搜索框值 */
  searchQuery?: string;
  /** 搜索框变更回调 */
  onSearchChange?: (value: string) => void;
  /** 搜索提交回调 */
  onSearch?: (value: string) => void;

  /** 已选标签列表 */
  selectedTags?: string[];
  /** 移除标签回调 */
  onRemoveTag?: (tag: string) => void;

  /** 额外的工具栏操作按钮 */
  extraActions?: React.ReactNode;
}

/**
 * 搜索历史下拉选项渲染
 */
const renderHistoryOption = (item: { query: string; resultCount: number }) => ({
  value: item.query,
  label: (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span>
        <HistoryOutlined style={{ marginRight: spacing.xs, color: colors.textTertiary }} />
        {item.query}
      </span>
      {item.resultCount > 0 && (
        <span style={{ fontSize: fontSize.xs, color: colors.textTertiary }}>
          {item.resultCount} 结果
        </span>
      )}
    </div>
  )
});

export const BooruPageToolbar: React.FC<BooruPageToolbarProps> = React.memo(({
  sites,
  selectedSiteId,
  loading,
  ratingFilter,
  offsetTop = 0,
  onSiteChange,
  onRatingChange,
  onRefresh,
  showSearch = false,
  searchQuery = '',
  onSearchChange,
  onSearch,
  selectedTags = [],
  onRemoveTag,
  extraActions
}) => {
  const hasSearch = showSearch && onSearch;
  const hasTags = selectedTags.length > 0 && onRemoveTag;

  // 搜索历史状态
  const [searchHistory, setSearchHistory] = useState<Array<{ query: string; resultCount: number }>>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  // 加载搜索历史
  const loadSearchHistory = useCallback(async () => {
    if (!hasSearch || !selectedSiteId || !window.electronAPI?.booru?.getSearchHistory) return;
    try {
      const result = await window.electronAPI.booru.getSearchHistory(selectedSiteId, 15);
      if (result.success && result.data) {
        setSearchHistory(result.data);
      }
    } catch (error) {
      console.error('[BooruPageToolbar] 加载搜索历史失败:', error);
    }
  }, [hasSearch, selectedSiteId]);

  // 站点变化时加载搜索历史
  useEffect(() => {
    loadSearchHistory();
  }, [loadSearchHistory]);

  // 清除搜索历史
  const handleClearHistory = async () => {
    if (!selectedSiteId || !window.electronAPI?.booru?.clearSearchHistory) return;
    try {
      await window.electronAPI.booru.clearSearchHistory(selectedSiteId);
      setSearchHistory([]);
      console.log('[BooruPageToolbar] 搜索历史已清除');
    } catch (error) {
      console.error('[BooruPageToolbar] 清除搜索历史失败:', error);
    }
  };

  // 搜索提交
  const handleSearch = (value: string) => {
    setHistoryOpen(false);
    onSearch?.(value);
    // 搜索后刷新历史列表
    setTimeout(loadSearchHistory, 500);
  };

  // 构建下拉选项
  const autoCompleteOptions = searchHistory.length > 0 ? [
    ...searchHistory.map(renderHistoryOption),
    {
      value: '__clear__',
      label: (
        <div
          style={{
            textAlign: 'center',
            color: colors.textTertiary,
            fontSize: fontSize.xs,
            borderTop: `1px solid ${colors.border}`,
            paddingTop: spacing.xs,
            cursor: 'pointer'
          }}
        >
          <CloseOutlined style={{ marginRight: 4 }} />
          清除搜索历史
        </div>
      )
    }
  ] : [];

  return (
    <Affix offsetTop={offsetTop}>
      <div style={{
        background: colors.materialRegular,
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        padding: `${spacing.md}px ${spacing.xl}px`,
        borderRadius: radius.lg,
        marginBottom: hasSearch ? spacing.xl : spacing.lg,
        boxShadow: shadows.toolbar,
        zIndex: zIndex.sticky,
        border: `1px solid ${colors.border}`,
      }}>
        <Space wrap style={{
          width: '100%',
          ...(hasSearch ? { justifyContent: 'space-between' } : {})
        }}>
          {/* 站点选择 */}
          <Space wrap>
            <span>站点:</span>
            <Select
              value={selectedSiteId || undefined}
              onChange={onSiteChange}
              style={{ width: hasSearch ? 180 : 200 }}
              placeholder="选择Booru站点"
              disabled={loading}
            >
              {sites.map(site => (
                <Option key={site.id} value={site.id}>
                  {site.name}
                </Option>
              ))}
            </Select>
          </Space>

          {/* 搜索框（带搜索历史下拉） */}
          {hasSearch && (
            <AutoComplete
              style={{ width: 400 }}
              options={autoCompleteOptions}
              value={searchQuery}
              open={historyOpen && autoCompleteOptions.length > 0}
              onFocus={() => setHistoryOpen(true)}
              onBlur={() => setTimeout(() => setHistoryOpen(false), 200)}
              onChange={(value) => {
                onSearchChange?.(value);
              }}
              onSelect={(value) => {
                if (value === '__clear__') {
                  handleClearHistory();
                  return;
                }
                onSearchChange?.(value);
                handleSearch(value);
              }}
              disabled={!selectedSiteId || loading}
            >
              <Search
                placeholder="输入标签搜索 (使用空格分隔多个标签)"
                allowClear
                enterButton={<SearchOutlined />}
                onSearch={handleSearch}
                disabled={!selectedSiteId || loading}
              />
            </AutoComplete>
          )}

          {/* 分级筛选 */}
          <Space wrap>
            <span>分级:</span>
            <Segmented
              value={ratingFilter}
              onChange={(value) => onRatingChange(value as RatingFilter)}
              options={ratingOptions}
              disabled={loading}
            />
          </Space>

          {/* 操作按钮 */}
          <Space wrap>
            <Button
              icon={<ReloadOutlined />}
              onClick={onRefresh}
              loading={loading}
              disabled={!selectedSiteId}
            >
              刷新
            </Button>
            {extraActions}
          </Space>
        </Space>

        {/* 已选标签显示（可选） */}
        {hasTags && (
          <div style={{ marginTop: spacing.sm, paddingTop: spacing.sm, borderTop: `1px solid ${colors.border}` }}>
            <Space wrap>
              <span style={{ fontSize: fontSize.sm, color: colors.textSecondary }}>已选标签:</span>
              {selectedTags.map(tag => (
                <Tag
                  key={tag}
                  closable
                  onClose={() => onRemoveTag!(tag)}
                  style={{ fontSize: fontSize.sm }}
                >
                  {tag}
                </Tag>
              ))}
            </Space>
          </div>
        )}
      </div>
    </Affix>
  );
});

BooruPageToolbar.displayName = 'BooruPageToolbar';
