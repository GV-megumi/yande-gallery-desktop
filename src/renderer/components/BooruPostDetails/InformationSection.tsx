import React, { useEffect, useState } from 'react';
import { Space, Tag, Typography } from 'antd';
import { BooruPost, BooruSite } from '../../../shared/types';

const { Text } = Typography;

interface InformationSectionProps {
  post: BooruPost;
  site: BooruSite | null;
}

/**
 * 信息部分组件
 * 显示：角色标签、艺术家标签、版权标签、创建时间、来源
 * 参考 Boorusama 的 InformationSection
 */
export const InformationSection: React.FC<InformationSectionProps> = ({
  post,
  site
}) => {
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
          console.log('[InformationSection] 获取标签分类成功:', result.data);
          setTagCategories(result.data);
        } else {
          console.warn('[InformationSection] 获取标签分类失败:', result.error);
          // 失败时使用默认分类
          const defaultCategories: Record<string, string> = {};
          allTags.forEach(tag => {
            defaultCategories[tag] = 'general';
          });
          setTagCategories(defaultCategories);
        }
      } catch (error) {
        console.error('[InformationSection] 获取标签分类异常:', error);
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

  // 提取特定类别的标签（根据数据库查询的分类信息）
  const extractTagsByCategory = (tags: string[], category: string): string[] => {
    return tags.filter(tag => {
      const tagCategory = tagCategories[tag] || 'general';
      return tagCategory === category;
    });
  };

  const allTags = parseTags(post.tags);
  const characterTags = extractTagsByCategory(allTags, 'character');
  const artistTags = extractTagsByCategory(allTags, 'artist');
  const copyrightTags = extractTagsByCategory(allTags, 'copyright');

  // 格式化创建时间
  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diff = now.getTime() - date.getTime();
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (days > 0) {
        return `${days} 天前`;
      } else if (hours > 0) {
        return `${hours} 小时前`;
      } else if (minutes > 0) {
        return `${minutes} 分钟前`;
      } else {
        return '刚刚';
      }
    } catch (e) {
      return dateString;
    }
  };

  // 生成角色名称（参考 Boorusama）
  const generateCharacterName = (tags: string[]): string => {
    if (tags.length === 0) return '';
    if (tags.length === 1) return tags[0].replace(/_/g, ' ');
    
    // 清理标签（移除括号内容）
    const cleaned = tags.map(tag => {
      const index = tag.indexOf('(');
      return index > 0 ? tag.substring(0, index - 1) : tag;
    });

    if (cleaned.length <= 3) {
      return cleaned.join(', ').replace(/_/g, ' ');
    } else {
      return `${cleaned.slice(0, 3).join(', ').replace(/_/g, ' ')} 和其他 ${cleaned.length - 3} 个`;
    }
  };

  // 生成版权名称（参考 Boorusama）
  const generateCopyrightName = (tags: string[]): string => {
    if (tags.length === 0) return '原创';
    if (tags.length === 1) return tags[0].replace(/_/g, ' ');
    return `${tags[0].replace(/_/g, ' ')} 和其他 ${tags.length - 1} 个`;
  };

  // 选择艺术家标签（参考 Boorusama）
  const chooseArtistTag = (tags: string[]): string => {
    if (tags.length === 0) return '未知艺术家';
    
    // 排除某些标签
    const excluded = ['banned_artist', 'voice_actor'];
    const artist = tags.find(tag => !excluded.some(ex => tag.includes(ex)));
    
    return artist ? artist.replace(/_/g, ' ') : tags[0].replace(/_/g, ' ');
  };

  const characterName = generateCharacterName(characterTags);
  const copyrightName = generateCopyrightName(copyrightTags);
  const artistName = chooseArtistTag(artistTags);

  return (
    <div style={{ marginBottom: '24px' }}>
      {/* 角色名称（大标题） */}
      {characterName && (
        <div style={{ marginBottom: '8px' }}>
          <Text strong style={{ fontSize: '20px', fontWeight: 800 }}>
            {characterName}
          </Text>
        </div>
      )}

      {/* 版权标签 */}
      {copyrightName && (
        <div style={{ marginBottom: '8px' }}>
          <Text style={{ fontSize: '14px' }}>
            {copyrightName}
          </Text>
        </div>
      )}

      {/* 艺术家和创建时间 */}
      <Space size="middle" wrap>
        {artistName && (
          <Tag
            color="red"
            style={{ cursor: 'pointer' }}
            onClick={() => {
              console.log('[InformationSection] 点击艺术家标签:', artistName);
              // TODO: 跳转到艺术家页面
            }}
          >
            {artistName}
          </Tag>
        )}
        {post.createdAt && (
          <Text type="secondary" style={{ fontSize: '12px' }}>
            {formatDate(post.createdAt)}
          </Text>
        )}
      </Space>

      {/* 来源 */}
      {post.source && (
        <div style={{ marginTop: '8px' }}>
          <Text type="secondary" style={{ fontSize: '12px' }}>
            来源: 
          </Text>
          <a
            href={post.source}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '12px', marginLeft: '4px' }}
            onClick={(e) => {
              e.stopPropagation();
              console.log('[InformationSection] 点击来源链接:', post.source);
            }}
          >
            {post.source.length > 50 ? post.source.substring(0, 50) + '...' : post.source}
          </a>
        </div>
      )}
    </div>
  );
};

