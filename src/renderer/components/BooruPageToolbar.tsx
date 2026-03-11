/**
 * Booru 页面工具栏 — 插画站风格
 * 紧凑、无标签、一体化搜索栏
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Select, Space, Segmented, Affix, Input, Tag, AutoComplete, Tooltip, Popover } from 'antd';
import { ReloadOutlined, SearchOutlined, CloseOutlined, HistoryOutlined, FilterOutlined } from '@ant-design/icons';
import { BooruSite } from '../../shared/types';
import { colors, spacing, radius, shadows, fontSize, zIndex } from '../styles/tokens';
import { SearchSyntaxHelp } from './SearchSyntaxHelp';

const { Search } = Input;
const { Option } = Select;

/** 分级筛选 */
const ratingOptions = [
  { label: '全部', value: 'all' },
  { label: '安全(S)', value: 'safe' },
  { label: '可疑(Q)', value: 'questionable' },
  { label: '限制(E)', value: 'explicit' }
];

export type RatingFilter = 'all' | 'safe' | 'questionable' | 'explicit';

interface BooruPageToolbarProps {
  sites: BooruSite[];
  selectedSiteId: number | null;
  loading: boolean;
  ratingFilter: RatingFilter;
  offsetTop?: number;
  onSiteChange: (siteId: number) => void;
  onRatingChange: (rating: RatingFilter) => void;
  onRefresh: () => void;
  showSearch?: boolean;
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
  onSearch?: (value: string) => void;
  selectedTags?: string[];
  onRemoveTag?: (tag: string) => void;
  extraActions?: React.ReactNode;
}

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
          {item.resultCount}
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

  const [searchHistory, setSearchHistory] = useState<Array<{ query: string; resultCount: number }>>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [tagSuggestions, setTagSuggestions] = useState<Array<{ name: string; count: number; type: number }>>([]);
  const autocompleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tagTypeColors: Record<number, string> = {
    0: colors.tagGeneral,
    1: colors.tagArtist,
    3: colors.tagCopyright,
    4: colors.tagCharacter,
    5: colors.tagMeta,
  };

  const tagTypeNames: Record<number, string> = {
    0: '通用', 1: '艺术家', 3: '版权', 4: '角色', 5: '元数据',
  };

  const loadSearchHistory = useCallback(async () => {
    if (!hasSearch || !selectedSiteId || !window.electronAPI?.booru?.getSearchHistory) return;
    try {
      const result = await window.electronAPI.booru.getSearchHistory(selectedSiteId, 15);
      if (result.success && result.data) setSearchHistory(result.data);
    } catch (error) {
      console.error('[BooruPageToolbar] 加载搜索历史失败:', error);
    }
  }, [hasSearch, selectedSiteId]);

  useEffect(() => { loadSearchHistory(); }, [loadSearchHistory]);

  const extractLastWord = (query: string): { prefix: string; operator: string; word: string } => {
    const parts = query.split(' ');
    const lastPart = parts[parts.length - 1] || '';
    const prefix = parts.slice(0, -1).join(' ');
    let operator = '';
    let word = lastPart;
    if (lastPart.startsWith('-') || lastPart.startsWith('~')) {
      operator = lastPart[0];
      word = lastPart.substring(1);
    }
    return { prefix, operator, word };
  };

  const fetchTagSuggestions = useCallback(async (query: string) => {
    if (!selectedSiteId || !window.electronAPI?.booru?.autocompleteTags) return;
    const { word } = extractLastWord(query);
    if (word.length < 2 || word.includes(':')) { setTagSuggestions([]); return; }
    try {
      const result = await window.electronAPI.booru.autocompleteTags(selectedSiteId, word, 10);
      if (result.success && result.data) setTagSuggestions(result.data);
    } catch (error) {
      console.error('[BooruPageToolbar] 标签自动补全失败:', error);
    }
  }, [selectedSiteId]);

  const handleInputChange = useCallback((value: string) => {
    onSearchChange?.(value);
    if (autocompleteTimerRef.current) clearTimeout(autocompleteTimerRef.current);
    const { word } = extractLastWord(value);
    if (!value.trim() || word.length < 2) {
      setTagSuggestions([]);
      setHistoryOpen(!value.trim());
      return;
    }
    setHistoryOpen(false);
    autocompleteTimerRef.current = setTimeout(() => fetchTagSuggestions(value), 300);
  }, [onSearchChange, fetchTagSuggestions]);

  const handleClearHistory = async () => {
    if (!selectedSiteId || !window.electronAPI?.booru?.clearSearchHistory) return;
    try {
      await window.electronAPI.booru.clearSearchHistory(selectedSiteId);
      setSearchHistory([]);
    } catch (error) {
      console.error('[BooruPageToolbar] 清除搜索历史失败:', error);
    }
  };

  const handleSearch = (value: string) => {
    setHistoryOpen(false);
    setTagSuggestions([]);
    onSearch?.(value);
    setTimeout(loadSearchHistory, 500);
  };

  const handleSelectTag = (tagName: string) => {
    const { prefix, operator } = extractLastWord(searchQuery);
    const newQuery = prefix ? `${prefix} ${operator}${tagName} ` : `${operator}${tagName} `;
    onSearchChange?.(newQuery);
    setTagSuggestions([]);
  };

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
          <div style={{
            textAlign: 'center', color: colors.textTertiary,
            fontSize: fontSize.xs, borderTop: `1px solid ${colors.border}`,
            paddingTop: spacing.xs, cursor: 'pointer'
          }}>
            <CloseOutlined style={{ marginRight: 4 }} /> 清除历史
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
        padding: `${spacing.sm}px ${spacing.lg}px`,
        borderRadius: radius.md,
        marginBottom: spacing.lg,
        boxShadow: shadows.toolbar,
        zIndex: zIndex.sticky,
        border: `1px solid ${colors.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: spacing.sm,
        flexWrap: 'wrap',
      }}>
        {/* 站点选择 — 无标签 */}
        <Select
          value={selectedSiteId || undefined}
          onChange={onSiteChange}
          style={{ width: 160, flexShrink: 0 }}
          placeholder="选择站点"
          disabled={loading}
          size="middle"
        >
          {sites.map(site => (
            <Option key={site.id} value={site.id}>{site.name}</Option>
          ))}
        </Select>

        {/* 搜索框 — 占据主要空间 */}
        {hasSearch && (
          <div style={{ flex: 1, minWidth: 200, display: 'flex', alignItems: 'center', gap: 4 }}>
            <AutoComplete
              style={{ flex: 1 }}
              options={autoCompleteOptions}
              value={searchQuery}
              open={(historyOpen || tagSuggestions.length > 0) && autoCompleteOptions.length > 0}
              onFocus={() => { if (!searchQuery.trim()) setHistoryOpen(true); }}
              onBlur={() => setTimeout(() => { setHistoryOpen(false); setTagSuggestions([]); }, 200)}
              onChange={handleInputChange}
              onSelect={(value) => {
                if (value === '__clear__') { handleClearHistory(); return; }
                if (tagSuggestions.length > 0) { handleSelectTag(value); return; }
                onSearchChange?.(value);
                handleSearch(value);
              }}
              disabled={!selectedSiteId || loading}
            >
              <Search
                placeholder="搜索标签..."
                allowClear
                enterButton={<SearchOutlined />}
                onSearch={handleSearch}
                disabled={!selectedSiteId || loading}
                size="middle"
              />
            </AutoComplete>
            <SearchSyntaxHelp />
          </div>
        )}

        {/* 刷新 + 分级 + 额外操作 */}
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <Tooltip title="刷新">
            <Button
              icon={<ReloadOutlined />}
              onClick={onRefresh}
              loading={loading}
              disabled={!selectedSiteId}
              size="middle"
            />
          </Tooltip>
          <Select
            value={ratingFilter}
            onChange={(value) => onRatingChange(value as RatingFilter)}
            disabled={loading}
            size="middle"
            style={{ width: 100, flexShrink: 0 }}
          >
            {ratingOptions.map(opt => (
              <Option key={opt.value} value={opt.value}>{opt.label}</Option>
            ))}
          </Select>
          {extraActions}
        </div>
      </div>

      {/* 已选标签 */}
      {hasTags && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 4,
          padding: `0 ${spacing.lg}px`,
          marginTop: -spacing.sm, marginBottom: spacing.md,
        }}>
          {selectedTags.map(tag => (
            <Tag
              key={tag}
              closable
              onClose={() => onRemoveTag!(tag)}
              style={{ fontSize: fontSize.sm, margin: 0 }}
            >
              {tag}
            </Tag>
          ))}
        </div>
      )}
    </Affix>
  );
});

BooruPageToolbar.displayName = 'BooruPageToolbar';
