import React, { useEffect, useState, useMemo } from 'react';
import { Space, Tag, Typography } from 'antd';
import { BooruPost, BooruSite } from '../../../shared/types';

const { Text } = Typography;

interface InformationSectionProps {
  post: BooruPost;
  site: BooruSite | null;
}

// 纯函数提取到组件外，避免每次渲染重建
const parseTags = (tags: string): string[] => {
  if (!tags) return [];
  return tags.split(' ').filter(t => t.trim());
};

const formatDate = (dateString: string): string => {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor(diff / 60000);
    if (days > 0) return `${days} 天前`;
    if (hours > 0) return `${hours} 小时前`;
    if (minutes > 0) return `${minutes} 分钟前`;
    return '刚刚';
  } catch {
    return dateString;
  }
};

const generateCharacterName = (tags: string[]): string => {
  if (tags.length === 0) return '';
  if (tags.length === 1) return tags[0].replace(/_/g, ' ');
  const cleaned = tags.map(tag => {
    const index = tag.indexOf('(');
    return index > 0 ? tag.substring(0, index - 1) : tag;
  });
  if (cleaned.length <= 3) return cleaned.join(', ').replace(/_/g, ' ');
  return `${cleaned.slice(0, 3).join(', ').replace(/_/g, ' ')} 和其他 ${cleaned.length - 3} 个`;
};

const generateCopyrightName = (tags: string[]): string => {
  if (tags.length === 0) return '原创';
  if (tags.length === 1) return tags[0].replace(/_/g, ' ');
  return `${tags[0].replace(/_/g, ' ')} 和其他 ${tags.length - 1} 个`;
};

const chooseArtistTag = (tags: string[]): string => {
  if (tags.length === 0) return '未知艺术家';
  const excluded = ['banned_artist', 'voice_actor'];
  const artist = tags.find(tag => !excluded.some(ex => tag.includes(ex)));
  return artist ? artist.replace(/_/g, ' ') : tags[0].replace(/_/g, ' ');
};

/**
 * 信息部分组件
 */
export const InformationSection: React.FC<InformationSectionProps> = React.memo(({
  post,
  site
}) => {
  const [tagCategories, setTagCategories] = useState<Record<string, string>>({});

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
        console.error('[InformationSection] 获取标签分类异常:', error);
        const allTags = parseTags(post.tags);
        const defaultCategories: Record<string, string> = {};
        allTags.forEach(tag => { defaultCategories[tag] = 'general'; });
        setTagCategories(defaultCategories);
      }
    };

    loadTagCategories();
  }, [site, post.tags]);

  // 使用 useMemo 缓存标签分类和名称计算
  const { characterName, copyrightName, artistName } = useMemo(() => {
    const allTags = parseTags(post.tags);
    const extractByCategory = (category: string) =>
      allTags.filter(tag => (tagCategories[tag] || 'general') === category);

    return {
      characterName: generateCharacterName(extractByCategory('character')),
      copyrightName: generateCopyrightName(extractByCategory('copyright')),
      artistName: chooseArtistTag(extractByCategory('artist')),
    };
  }, [post.tags, tagCategories]);

  return (
    <div style={{ marginBottom: '24px' }}>
      {characterName && (
        <div style={{ marginBottom: '8px' }}>
          <Text strong style={{ fontSize: '20px', fontWeight: 800 }}>{characterName}</Text>
        </div>
      )}
      {copyrightName && (
        <div style={{ marginBottom: '8px' }}>
          <Text style={{ fontSize: '14px' }}>{copyrightName}</Text>
        </div>
      )}
      <Space size="middle" wrap>
        {artistName && (
          <Tag color="red" style={{ cursor: 'pointer' }}>
            {artistName}
          </Tag>
        )}
        {post.createdAt && (
          <Text type="secondary" style={{ fontSize: '12px' }}>{formatDate(post.createdAt)}</Text>
        )}
      </Space>
      {post.source && (
        <div style={{ marginTop: '8px' }}>
          <Text type="secondary" style={{ fontSize: '12px' }}>来源: </Text>
          <a
            href={post.source}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '12px', marginLeft: '4px' }}
            onClick={(e) => e.stopPropagation()}
          >
            {post.source.length > 50 ? post.source.substring(0, 50) + '...' : post.source}
          </a>
        </div>
      )}
    </div>
  );
});

InformationSection.displayName = 'InformationSection';
