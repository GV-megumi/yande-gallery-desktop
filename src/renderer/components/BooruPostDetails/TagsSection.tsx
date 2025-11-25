import React, { useState, useEffect } from 'react';
import { Collapse, Tag, Space, Typography } from 'antd';
import { BooruPost, BooruSite } from '../../../shared/types';

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
                {categorized.artist.map((tag, index) => (
                  <Tag
                    key={`artist-${index}`}
                    color={getTagColor('artist')}
                    style={{ cursor: 'pointer', marginBottom: '4px' }}
                    onClick={() => handleTagClick(tag)}
                  >
                    {tag.replace(/_/g, ' ')}
                  </Tag>
                ))}
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
                {categorized.character.map((tag, index) => (
                  <Tag
                    key={`character-${index}`}
                    color={getTagColor('character')}
                    style={{ cursor: 'pointer', marginBottom: '4px' }}
                    onClick={() => handleTagClick(tag)}
                  >
                    {tag.replace(/_/g, ' ')}
                  </Tag>
                ))}
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
                {categorized.copyright.map((tag, index) => (
                  <Tag
                    key={`copyright-${index}`}
                    color={getTagColor('copyright')}
                    style={{ cursor: 'pointer', marginBottom: '4px' }}
                    onClick={() => handleTagClick(tag)}
                  >
                    {tag.replace(/_/g, ' ')}
                  </Tag>
                ))}
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
                {categorized.general.map((tag, index) => (
                  <Tag
                    key={`general-${index}`}
                    color={getTagColor('general')}
                    style={{ cursor: 'pointer', marginBottom: '4px' }}
                    onClick={() => handleTagClick(tag)}
                  >
                    {tag.replace(/_/g, ' ')}
                  </Tag>
                ))}
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
                {categorized.meta.map((tag, index) => (
                  <Tag
                    key={`meta-${index}`}
                    color={getTagColor('meta')}
                    style={{ cursor: 'pointer', marginBottom: '4px' }}
                    onClick={() => handleTagClick(tag)}
                  >
                    {tag.replace(/_/g, ' ')}
                  </Tag>
                ))}
              </Space>
            </div>
          )}
        </Panel>
      </Collapse>
    </div>
  );
};

