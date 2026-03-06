import React, { useState, useEffect, useCallback } from 'react';
import { Collapse, Tag, Space, Typography, message } from 'antd';
import { StarOutlined, StarFilled, CopyOutlined, SearchOutlined } from '@ant-design/icons';
import { BooruPost, BooruSite } from '../../../shared/types';
import { ContextMenu } from '../ContextMenu';

const { Panel } = Collapse;
const { Text } = Typography;

interface TagsSectionProps {
  post: BooruPost;
  site: BooruSite | null;
  onTagClick?: (tag: string) => void;
}

/**
 * 标签部分组件
 * 可展开/折叠的标签列表，按分类显示
 * 参考 Boorusama 的 DefaultInheritedTagsTile
 */
export const TagsSection: React.FC<TagsSectionProps> = ({
  post,
  site,
  onTagClick
}) => {
  const [expanded, setExpanded] = useState(false);
  const [tagCategories, setTagCategories] = useState<Record<string, string>>({});
  // 收藏标签状态：记录哪些标签已被收藏
  const [favoritedTags, setFavoritedTags] = useState<Set<string>>(new Set());

  // 解析标签字符串
  const parseTags = (tags: string): string[] => {
    if (!tags) return [];
    return tags.split(' ').filter(t => t.trim());
  };

  // 从数据库获取标签分类
  useEffect(() => {
    if (!site || !post.tags) return;

    const loadTagCategories = async () => {
      try {
        const allTags = parseTags(post.tags);
        if (allTags.length === 0) return;

        const result = await window.electronAPI.booru.getTagsCategories(site.id, allTags);
        if (result.success && result.data) {
          console.log('[TagsSection] 获取标签分类成功:', result.data);
          setTagCategories(result.data);
        } else {
          console.warn('[TagsSection] 获取标签分类失败:', result.error);
          // 失败时使用默认分类（全部为 general）
          const defaultCategories: Record<string, string> = {};
          allTags.forEach(tag => {
            defaultCategories[tag] = 'general';
          });
          setTagCategories(defaultCategories);
        }
      } catch (error) {
        console.error('[TagsSection] 获取标签分类异常:', error);
        // 异常时使用默认分类
        const allTags = parseTags(post.tags);
        const defaultCategories: Record<string, string> = {};
        allTags.forEach(tag => {
          defaultCategories[tag] = 'general';
        });
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
        const result = await window.electronAPI.booru.getFavoriteTags(site.id);
        if (result.success && result.data) {
          const favSet = new Set(result.data.map((t: any) => t.tagName));
          setFavoritedTags(favSet);
        }
      } catch (error) {
        console.error('[TagsSection] 加载收藏标签状态失败:', error);
      }
    };
    loadFavoriteStatus();
  }, [site]);

  // 切换标签收藏状态
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
  }, [site, favoritedTags]);

  // 分类标签（根据数据库查询的分类信息）
  const categorizeTags = (tags: string[]): {
    artist: string[];
    character: string[];
    copyright: string[];
    general: string[];
    meta: string[];
  } => {
    const categories = {
      artist: [] as string[],
      character: [] as string[],
      copyright: [] as string[],
      general: [] as string[],
      meta: [] as string[]
    };

    tags.forEach(tag => {
      const category = tagCategories[tag] || 'general';
      if (category === 'artist') {
        categories.artist.push(tag);
      } else if (category === 'character') {
        categories.character.push(tag);
      } else if (category === 'copyright') {
        categories.copyright.push(tag);
      } else if (category === 'meta') {
        categories.meta.push(tag);
      } else {
        categories.general.push(tag);
      }
    });

    return categories;
  };

  const allTags = parseTags(post.tags);
  const categorized = categorizeTags(allTags);
  const totalCount = allTags.length;

  // 渲染单个标签（带收藏星标 + 右键菜单）
  const renderTag = (tag: string, category: string, index: number) => {
    const isFav = favoritedTags.has(tag);
    const tagContextItems = [
      { key: 'copy', label: '复制标签', icon: <CopyOutlined />, onClick: () => {
        navigator.clipboard.writeText(tag);
        message.success('已复制: ' + tag.replace(/_/g, ' '));
      }},
      ...(onTagClick ? [{ key: 'search', label: '按该标签搜索', icon: <SearchOutlined />, onClick: () => onTagClick(tag) }] : []),
      { key: 'favorite', label: isFav ? '取消收藏标签' : '收藏标签', icon: isFav ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />, onClick: () => toggleFavoriteTag(tag) },
    ];
    return (
      <ContextMenu key={`${category}-${index}`} items={tagContextItems}>
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
      </ContextMenu>
    );
  };

  const handleTagClick = (tag: string) => {
    console.log('[TagsSection] 点击标签:', tag);
    if (onTagClick) {
      onTagClick(tag);
    }
  };

  // 标签颜色映射（参考 Boorusama 的颜色方案）
  const getTagColor = (category: string): string => {
    switch (category) {
      case 'artist':
        return 'red'; // 红色
      case 'character':
        return 'green'; // 绿色
      case 'copyright':
        return 'purple'; // 紫色
      case 'meta':
        return 'orange'; // 橙色/黄色
      default:
        return 'blue'; // 蓝色（通用标签）
    }
  };

  return (
    <div style={{ marginBottom: '24px' }}>
      <Collapse
        activeKey={expanded ? ['tags'] : []}
        onChange={(keys) => {
          setExpanded(keys.includes('tags'));
        }}
        style={{ background: '#fff' }}
      >
        <Panel
          header={
            <Text strong>
              标签 ({totalCount})
            </Text>
          }
          key="tags"
        >
          {/* 艺术家标签 */}
          {categorized.artist.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>
                艺术家
              </Text>
              <Space wrap size={[4, 4]}>
                {categorized.artist.map((tag, index) => renderTag(tag, 'artist', index))}
              </Space>
            </div>
          )}

          {/* 角色标签 */}
          {categorized.character.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>
                角色
              </Text>
              <Space wrap size={[4, 4]}>
                {categorized.character.map((tag, index) => renderTag(tag, 'character', index))}
              </Space>
            </div>
          )}

          {/* 版权标签 */}
          {categorized.copyright.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>
                版权
              </Text>
              <Space wrap size={[4, 4]}>
                {categorized.copyright.map((tag, index) => renderTag(tag, 'copyright', index))}
              </Space>
            </div>
          )}

          {/* 通用标签 */}
          {categorized.general.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>
                通用
              </Text>
              <Space wrap size={[4, 4]}>
                {categorized.general.map((tag, index) => renderTag(tag, 'general', index))}
              </Space>
            </div>
          )}

          {/* 元标签 */}
          {categorized.meta.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: '4px' }}>
                元数据
              </Text>
              <Space wrap size={[4, 4]}>
                {categorized.meta.map((tag, index) => renderTag(tag, 'meta', index))}
              </Space>
            </div>
          )}
        </Panel>
      </Collapse>
    </div>
  );
};

