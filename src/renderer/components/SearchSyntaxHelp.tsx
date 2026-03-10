/**
 * 搜索语法帮助弹窗组件
 * 展示 Booru 搜索支持的高级语法：标签操作符、Meta-tags 等
 */

import React from 'react';
import { Popover, Typography, Divider, Tag } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { colors, fontSize, spacing } from '../styles/tokens';

const { Text } = Typography;

/** 语法条目 */
interface SyntaxEntry {
  syntax: string;
  description: string;
  example?: string;
}

/** 标签操作符 */
const tagOperators: SyntaxEntry[] = [
  { syntax: 'tag1 tag2', description: 'AND — 同时包含两个标签', example: 'blue_eyes blonde_hair' },
  { syntax: '-tag', description: 'NOT — 排除包含该标签的结果', example: '-comic' },
  { syntax: '~tag1 ~tag2', description: 'OR — 包含任意一个标签即可', example: '~blue_eyes ~green_eyes' },
];

/** Meta-tags（搜索修饰符） */
const metaTags: SyntaxEntry[] = [
  { syntax: 'rating:safe', description: '按评级过滤 (safe/questionable/explicit)', example: 'rating:safe' },
  { syntax: 'score:>=100', description: '按评分过滤 (>, >=, <, <=)', example: 'score:>=50' },
  { syntax: 'order:score', description: '按评分排序', example: 'order:score' },
  { syntax: 'order:random', description: '随机排序', example: 'order:random' },
  { syntax: 'width:>=1920', description: '按宽度过滤', example: 'width:>=1920' },
  { syntax: 'height:>=1080', description: '按高度过滤', example: 'height:>=1080' },
  { syntax: 'id:12345', description: '按帖子 ID 搜索', example: 'id:12345' },
  { syntax: 'user:username', description: '按上传者搜索', example: 'user:admin' },
  { syntax: 'source:url', description: '按来源搜索', example: 'source:pixiv' },
  { syntax: 'parent:12345', description: '搜索指定帖子的子帖', example: 'parent:12345' },
];

/** 组合示例 */
const combinedExamples: SyntaxEntry[] = [
  { syntax: 'blue_eyes -comic rating:safe', description: '蓝眼、排除漫画、仅安全级别' },
  { syntax: '~cat_ears ~dog_ears score:>=50', description: '猫耳或狗耳、评分 ≥50' },
  { syntax: 'blonde_hair order:score', description: '金发、按评分排序' },
];

/** 渲染单个语法行 */
const SyntaxRow: React.FC<{ entry: SyntaxEntry }> = ({ entry }) => (
  <div style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'baseline' }}>
    <Tag
      color="blue"
      style={{
        fontFamily: 'monospace',
        fontSize: fontSize.xs,
        flexShrink: 0,
        margin: 0,
      }}
    >
      {entry.syntax}
    </Tag>
    <Text style={{ fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: '20px' }}>
      {entry.description}
    </Text>
  </div>
);

/** 搜索语法帮助弹窗内容 */
const SyntaxHelpContent: React.FC = () => (
  <div style={{ maxWidth: 420, maxHeight: 480, overflowY: 'auto' }}>
    {/* 标签操作符 */}
    <Text strong style={{ fontSize: fontSize.sm, display: 'block', marginBottom: spacing.xs }}>
      标签操作符
    </Text>
    {tagOperators.map((entry, i) => (
      <SyntaxRow key={i} entry={entry} />
    ))}

    <Divider style={{ margin: `${spacing.sm}px 0` }} />

    {/* Meta-tags */}
    <Text strong style={{ fontSize: fontSize.sm, display: 'block', marginBottom: spacing.xs }}>
      Meta-tags（搜索修饰符）
    </Text>
    {metaTags.map((entry, i) => (
      <SyntaxRow key={i} entry={entry} />
    ))}

    <Divider style={{ margin: `${spacing.sm}px 0` }} />

    {/* 组合示例 */}
    <Text strong style={{ fontSize: fontSize.sm, display: 'block', marginBottom: spacing.xs }}>
      组合示例
    </Text>
    {combinedExamples.map((entry, i) => (
      <SyntaxRow key={i} entry={entry} />
    ))}

    <Divider style={{ margin: `${spacing.sm}px 0` }} />

    <Text type="secondary" style={{ fontSize: fontSize.xs }}>
      提示：不同站点支持的 meta-tags 可能有所不同。Moebooru (Yande.re, Konachan) 与 Danbooru 支持大部分语法。
    </Text>
  </div>
);

interface SearchSyntaxHelpProps {
  /** 触发器子元素（默认为问号图标） */
  children?: React.ReactNode;
}

/**
 * 搜索语法帮助按钮
 * 点击或悬停显示搜索语法参考
 */
export const SearchSyntaxHelp: React.FC<SearchSyntaxHelpProps> = ({ children }) => {
  return (
    <Popover
      content={<SyntaxHelpContent />}
      title="搜索语法参考"
      trigger="click"
      placement="bottomRight"
      overlayStyle={{ zIndex: 1050 }}
    >
      {children || (
        <QuestionCircleOutlined
          style={{
            fontSize: 16,
            color: colors.textTertiary,
            cursor: 'pointer',
            transition: 'color 0.2s',
          }}
        />
      )}
    </Popover>
  );
};
