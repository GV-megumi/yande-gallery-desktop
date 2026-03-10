/**
 * Booru 页面工具栏组件
 * 提取自 BooruPage、BooruFavoritesPage、BooruTagSearchPage 的重复工具栏逻辑
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Select, Space, Segmented, Affix, Input, Tag, AutoComplete } from 'antd';
import { ReloadOutlined, SearchOutlined, CloseOutlined, HistoryOutlined } from '@ant-design/icons';
import { BooruSite } from '../../shared/types';
import { colors, spacing, radius, shadows, fontSize, zIndex } from '../styles/tokens';
import { SearchSyntaxHelp } from './SearchSyntaxHelp';

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

  // 标签自动补全状态
  const [tagSuggestions, setTagSuggestions] = useState<Array<{ name: string; count: number; type: number }>>([]);
  const autocompleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 标签类型颜色映射
  const tagTypeColors: Record<number, string> = {
    0: colors.textSecondary,  // general
    1: '#FF3B30',             // artist (红色)
    3: '#AF52DE',             // copyright (紫色)
    4: '#34C759',             // character (绿色)
    5: '#FF9500',             // meta (橙色)
  };

  // 标签类型名称映射
  const tagTypeNames: Record<number, string> = {
    0: '通用',
    1: '艺术家',
    3: '版权',
    4: '角色',
    5: '元数据',
  };

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

  /**
   * 从搜索输入中提取最后一个"词"（空格分隔），用于标签自动补全
   * 同时剥离 - 或 ~ 前缀操作符
   */
  const extractLastWord = (query: string): { prefix: string; operator: string; word: string } => {
    const parts = query.split(' ');
    const lastPart = parts[parts.length - 1] || '';
    const prefix = parts.slice(0, -1).join(' ');
    // 检查操作符前缀
    let operator = '';
    let word = lastPart;
    if (lastPart.startsWith('-') || lastPart.startsWith('~')) {
      operator = lastPart[0];
      word = lastPart.substring(1);
    }
    return { prefix, operator, word };
  };

  // 标签自动补全请求（防抖 300ms）
  const fetchTagSuggestions = useCallback(async (query: string) => {
    if (!selectedSiteId || !window.electronAPI?.booru?.autocompleteTags) return;
    const { word } = extractLastWord(query);
    // 至少输入 2 个字符才触发自动补全，且不能是 meta-tag（含冒号）
    if (word.length < 2 || word.includes(':')) {
      setTagSuggestions([]);
      return;
    }
    try {
      const result = await window.electronAPI.booru.autocompleteTags(selectedSiteId, word, 10);
      if (result.success && result.data) {
        setTagSuggestions(result.data);
      }
    } catch (error) {
      console.error('[BooruPageToolbar] 标签自动补全失败:', error);
    }
  }, [selectedSiteId]);

  // 输入变更时触发自动补全（防抖）
  const handleInputChange = useCallback((value: string) => {
    onSearchChange?.(value);
    // 清除之前的定时器
    if (autocompleteTimerRef.current) {
      clearTimeout(autocompleteTimerRef.current);
    }
    // 如果输入为空或最后一个字符是空格，显示历史而非自动补全
    const { word } = extractLastWord(value);
    if (!value.trim() || word.length < 2) {
      setTagSuggestions([]);
      setHistoryOpen(!value.trim());
      return;
    }
    // 有输入时关闭历史，开启自动补全（防抖 300ms）
    setHistoryOpen(false);
    autocompleteTimerRef.current = setTimeout(() => {
      fetchTagSuggestions(value);
    }, 300);
  }, [onSearchChange, fetchTagSuggestions]);

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
    setTagSuggestions([]);
    onSearch?.(value);
    // 搜索后刷新历史列表
    setTimeout(loadSearchHistory, 500);
  };

  // 选择自动补全的标签时，替换输入框中最后一个词
  const handleSelectTag = (tagName: string) => {
    const { prefix, operator } = extractLastWord(searchQuery);
    const newQuery = prefix
      ? `${prefix} ${operator}${tagName} `
      : `${operator}${tagName} `;
    onSearchChange?.(newQuery);
    setTagSuggestions([]);
    // 不立即搜索，让用户可以继续输入其他标签
  };

  // 构建下拉选项：优先显示标签自动补全，否则显示搜索历史
  const autoCompleteOptions = tagSuggestions.length > 0
    ? tagSuggestions.map(tag => ({
      value: tag.name,
      label: (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: tagTypeColors[tag.type] || colors.textPrimary }}>
            {tag.name.replace(/_/g, ' ')}
          </span>
          <span style={{ fontSize: fontSize.xs, color: colors.textTertiary }}>
            {tag.count.toLocaleString()}
            {tagTypeNames[tag.type] ? ` · ${tagTypeNames[tag.type]}` : ''}
          </span>
        </div>
      )
    }))
    : searchHistory.length > 0 ? [
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

          {/* 搜索框（带标签自动补全 + 搜索历史） */}
          {hasSearch && (
            <Space size={4}>
              <AutoComplete
                style={{ width: 400 }}
                options={autoCompleteOptions}
                value={searchQuery}
                open={(historyOpen || tagSuggestions.length > 0) && autoCompleteOptions.length > 0}
                onFocus={() => {
                  if (!searchQuery.trim()) setHistoryOpen(true);
                }}
                onBlur={() => setTimeout(() => {
                  setHistoryOpen(false);
                  setTagSuggestions([]);
                }, 200)}
                onChange={handleInputChange}
                onSelect={(value) => {
                  if (value === '__clear__') {
                    handleClearHistory();
                    return;
                  }
                  // 如果正在显示标签自动补全，替换最后一个词
                  if (tagSuggestions.length > 0) {
                    handleSelectTag(value);
                    return;
                  }
                  // 否则是搜索历史，直接搜索
                  onSearchChange?.(value);
                  handleSearch(value);
                }}
                disabled={!selectedSiteId || loading}
              >
                <Search
                  placeholder="搜索标签（支持 -排除 ~或 rating:safe score:>=100）"
                  allowClear
                  enterButton={<SearchOutlined />}
                  onSearch={handleSearch}
                  disabled={!selectedSiteId || loading}
                />
              </AutoComplete>
              <SearchSyntaxHelp />
            </Space>
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
