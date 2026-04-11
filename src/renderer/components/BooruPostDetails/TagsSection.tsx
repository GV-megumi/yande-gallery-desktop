import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Collapse, Tag, Space, Typography, Tooltip, App } from 'antd';
import { StarOutlined, StarFilled, CopyOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons';
import { BooruPost, BooruSite } from '../../../shared/types';
import { ContextMenu } from '../ContextMenu';

const { Text } = Typography;

interface TagsSectionProps {
  post: BooruPost;
  site: BooruSite | null;
  onTagClick?: (tag: string) => void;
  onArtistClick?: (artistName: string) => void;
  onCharacterClick?: (characterName: string) => void;
}

// 纯函数提取到组件外，避免每次渲染重建
const parseTags = (tags: string): string[] => {
  if (!tags) return [];
  return tags.split(' ').filter(t => t.trim());
};

const getTagColor = (category: string): string => {
  switch (category) {
    case 'artist': return 'red';
    case 'character': return 'green';
    case 'copyright': return 'purple';
    case 'meta': return 'orange';
    default: return 'blue';
  }
};

const categorizeTags = (tags: string[], tagCategories: Record<string, string>) => {
  const categories = {
    artist: [] as string[],
    character: [] as string[],
    copyright: [] as string[],
    general: [] as string[],
    meta: [] as string[]
  };
  tags.forEach(tag => {
    const category = tagCategories[tag] || 'general';
    if (category in categories) {
      (categories as any)[category].push(tag);
    } else {
      categories.general.push(tag);
    }
  });
  return categories;
};

/**
 * 标签部分组件
 * 可展开/折叠的标签列表，按分类显示
 */
export const TagsSection: React.FC<TagsSectionProps> = React.memo(({
  post,
  site,
  onTagClick,
  onArtistClick,
  onCharacterClick
}) => {
  const { message } = App.useApp();
  const [expanded, setExpanded] = useState(false);
  const [tagCategories, setTagCategories] = useState<Record<string, string>>({});
  const [favoritedTags, setFavoritedTags] = useState<Set<string>>(new Set());

  // 从数据库获取标签分类
  useEffect(() => {
    if (!site || !post.tags) return;

    const loadTagCategories = async () => {
      try {
        const allTags = parseTags(post.tags);
        if (allTags.length === 0) return;

        const result = await window.electronAPI.booru.getTagsCategories(site.id, allTags);
        if (result.success && result.data) {
          setTagCategories(result.data);
        } else {
          const defaultCategories: Record<string, string> = {};
          allTags.forEach(tag => { defaultCategories[tag] = 'general'; });
          setTagCategories(defaultCategories);
        }
      } catch (error) {
        console.error('[TagsSection] 获取标签分类异常:', error);
        const allTags = parseTags(post.tags);
        const defaultCategories: Record<string, string> = {};
        allTags.forEach(tag => { defaultCategories[tag] = 'general'; });
        setTagCategories(defaultCategories);
      }
    };

    loadTagCategories();
  }, [site, post.tags]);

  // 加载收藏标签状态
  useEffect(() => {
    if (!site) return;
    const loadFavoriteStatus = async () => {
      try {
        const result = await window.electronAPI.booru.getFavoriteTags({ siteId: site.id, limit: 0 });
        if (result.success && result.data) {
          setFavoritedTags(new Set(result.data.items.map((t) => t.tagName)));
        }
      } catch (error) {
        console.error('[TagsSection] 加载收藏标签状态失败:', error);
      }
    };
    loadFavoriteStatus();
  }, [site]);

  const toggleFavoriteTag = useCallback(async (tagName: string) => {
    if (!site) return;
    const isFav = favoritedTags.has(tagName);
    try {
      if (isFav) {
        const result = await window.electronAPI.booru.removeFavoriteTagByName(site.id, tagName);
        if (result.success) {
          setFavoritedTags(prev => { const next = new Set(prev); next.delete(tagName); return next; });
          message.success(`已取消收藏: ${tagName.replace(/_/g, ' ')}`);
        }
      } else {
        const result = await window.electronAPI.booru.addFavoriteTag(site.id, tagName);
        if (result.success) {
          setFavoritedTags(prev => new Set(prev).add(tagName));
          message.success(`已收藏: ${tagName.replace(/_/g, ' ')}`);
        }
      }
    } catch (error) {
      console.error('[TagsSection] 切换标签收藏失败:', error);
      message.error('操作失败');
    }
  }, [site, favoritedTags, message]);

  const addToBlacklist = useCallback(async (tagName: string) => {
    if (!site) return;
    try {
      const result = await window.electronAPI.booru.addBlacklistedTag(tagName, site.id);
      if (result.success) {
        message.success(`已加入黑名单: ${tagName.replace(/_/g, ' ')}`);
      } else {
        if (result.error?.includes('UNIQUE constraint')) {
          message.warning(`标签已在黑名单中: ${tagName.replace(/_/g, ' ')}`);
        } else {
          message.error('操作失败: ' + result.error);
        }
      }
    } catch (error) {
      console.error('[TagsSection] 添加黑名单标签失败:', error);
      message.error('操作失败');
    }
  }, [site, message]);

  // 使用 useMemo 缓存标签解析和分类结果
  const allTags = useMemo(() => parseTags(post.tags), [post.tags]);
  const categorized = useMemo(() => categorizeTags(allTags, tagCategories), [allTags, tagCategories]);
  const totalCount = allTags.length;

  const handleTagClick = useCallback((tag: string) => {
    console.log('[TagsSection] 点击标签:', tag);
    const category = tagCategories[tag] || 'general';
    if (category === 'artist' && onArtistClick) { onArtistClick(tag); return; }
    if (category === 'character' && onCharacterClick) { onCharacterClick(tag); return; }
    if (onTagClick) { onTagClick(tag); }
  }, [tagCategories, onArtistClick, onCharacterClick, onTagClick]);

  const renderTag = useCallback((tag: string, category: string, index: number) => {
    const isFav = favoritedTags.has(tag);
    const tagContextItems = [
      { key: 'copy', label: '复制标签', icon: <CopyOutlined />, onClick: () => {
        navigator.clipboard.writeText(tag);
        message.success('已复制: ' + tag.replace(/_/g, ' '));
      }},
      ...(onTagClick ? [{ key: 'search', label: '按该标签搜索', icon: <SearchOutlined />, onClick: () => onTagClick(tag) }] : []),
      { key: 'favorite', label: isFav ? '取消收藏标签' : '收藏标签', icon: isFav ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />, onClick: () => toggleFavoriteTag(tag) },
      { key: 'blacklist', label: '加入黑名单', icon: <StopOutlined style={{ color: '#FF3B30' }} />, onClick: () => addToBlacklist(tag) },
    ];
    return (
      <ContextMenu key={`${category}-${index}`} items={tagContextItems}>
        <Tooltip title="右键查看更多操作" mouseEnterDelay={0.6} placement="top">
          <Tag
            color={getTagColor(category)}
            style={{ cursor: 'pointer', marginBottom: '4px' }}
            onClick={() => handleTagClick(tag)}
          >
            <span
              onClick={(e) => { e.stopPropagation(); toggleFavoriteTag(tag); }}
              style={{ cursor: 'pointer', marginRight: 4 }}
            >
              {isFav
                ? <StarFilled style={{ color: '#faad14', fontSize: 12 }} />
                : <StarOutlined style={{ color: '#d9d9d9', fontSize: 12 }} />}
            </span>
            {tag.replace(/_/g, ' ')}
          </Tag>
        </Tooltip>
      </ContextMenu>
    );
  }, [favoritedTags, onTagClick, toggleFavoriteTag, addToBlacklist, handleTagClick, message]);

  return (
    <div style={{ marginBottom: '24px' }}>
      <Collapse
        activeKey={expanded ? ['tags'] : []}
        onChange={(keys) => setExpanded(keys.includes('tags'))}
        style={{ background: '#fff' }}
        items={[
          {
            key: 'tags',
            label: <Text strong>标签 ({totalCount})</Text>,
            children: (
              <>
                {categorized.artist.length > 0 && (
                  <div style={{ marginBottom: '12px' }}>
                    <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>艺术家</Text>
                    <Space wrap size={[4, 4]}>
                      {categorized.artist.map((tag, index) => renderTag(tag, 'artist', index))}
                    </Space>
                  </div>
                )}
                {categorized.character.length > 0 && (
                  <div style={{ marginBottom: '12px' }}>
                    <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>角色</Text>
                    <Space wrap size={[4, 4]}>
                      {categorized.character.map((tag, index) => renderTag(tag, 'character', index))}
                    </Space>
                  </div>
                )}
                {categorized.copyright.length > 0 && (
                  <div style={{ marginBottom: '12px' }}>
                    <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>版权</Text>
                    <Space wrap size={[4, 4]}>
                      {categorized.copyright.map((tag, index) => renderTag(tag, 'copyright', index))}
                    </Space>
                  </div>
                )}
                {categorized.general.length > 0 && (
                  <div style={{ marginBottom: '12px' }}>
                    <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>通用</Text>
                    <Space wrap size={[4, 4]}>
                      {categorized.general.map((tag, index) => renderTag(tag, 'general', index))}
                    </Space>
                  </div>
                )}
                {categorized.meta.length > 0 && (
                  <div style={{ marginBottom: '12px' }}>
                    <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>元数据</Text>
                    <Space wrap size={[4, 4]}>
                      {categorized.meta.map((tag, index) => renderTag(tag, 'meta', index))}
                    </Space>
                  </div>
                )}
              </>
            )
          }
        ]}
      />
    </div>
  );
});

TagsSection.displayName = 'TagsSection';
