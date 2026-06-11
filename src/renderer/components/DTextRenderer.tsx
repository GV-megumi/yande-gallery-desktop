import React, { useMemo, useState } from 'react';
import { Typography } from 'antd';
import { colors, spacing } from '../styles/tokens';

const { Paragraph, Text } = Typography;

/**
 * 剧透文本：默认遮挡（同色块覆盖），点击切换显示/隐藏
 */
const SpoilerText: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      onClick={() => setRevealed((value) => !value)}
      title={revealed ? undefined : '点击显示剧透'}
      style={{
        background: revealed ? 'transparent' : colors.textPrimary,
        color: revealed ? 'inherit' : 'transparent',
        padding: '0 4px',
        borderRadius: 2,
        cursor: 'pointer',
      }}
    >
      {children}
    </span>
  );
};

export type MarkupMode = 'dtext' | 'bbcode';

let renderKey = 0;

function nextKey(prefix: string): string {
  renderKey += 1;
  return `${prefix}-${renderKey}`;
}

function renderInline(text: string): React.ReactNode[] {
  const pattern = /(\[\[([^\]|]+)(?:\|([^\]]+))?\]\])|(\{\{([^}]+)\}\})|(\[url=(.*?)\](.*?)\[\/url\])|(https?:\/\/[^\s<\]]+)|(\[b\](.*?)\[\/b\])|(\[i\](.*?)\[\/i\])|(\[u\](.*?)\[\/u\])|(\[s\](.*?)\[\/s\])|(\[spoiler\](.*?)\[\/spoiler\])/gis;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }

    if (match[2]) {
      nodes.push(<strong key={nextKey('wiki')}>{match[3] || match[2].replace(/_/g, ' ')}</strong>);
    } else if (match[5]) {
      nodes.push(<strong key={nextKey('tag')}>{match[5].replace(/_/g, ' ')}</strong>);
    } else if (match[7] && match[8]) {
      nodes.push(<a key={nextKey('url')} href={match[7]} target="_blank" rel="noopener noreferrer">{match[8]}</a>);
    } else if (match[9]) {
      nodes.push(<a key={nextKey('link')} href={match[9]} target="_blank" rel="noopener noreferrer">{match[9]}</a>);
    } else if (match[11]) {
      nodes.push(<strong key={nextKey('b')}>{match[11]}</strong>);
    } else if (match[13]) {
      nodes.push(<em key={nextKey('i')}>{match[13]}</em>);
    } else if (match[15]) {
      nodes.push(<u key={nextKey('u')}>{match[15]}</u>);
    } else if (match[17]) {
      nodes.push(<del key={nextKey('s')}>{match[17]}</del>);
    } else if (match[19]) {
      nodes.push(<SpoilerText key={nextKey('spoiler')}>{match[19]}</SpoilerText>);
    }

    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

function renderBlocks(text: string): React.ReactNode {
  const quotePattern = /\[quote\]([\s\S]*?)\[\/quote\]/gi;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(quotePattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      const before = text.slice(lastIndex, index).trim();
      if (before) {
        parts.push(<Paragraph key={nextKey('p')} style={{ whiteSpace: 'pre-wrap', marginBottom: spacing.sm }}>{renderInline(before)}</Paragraph>);
      }
    }

    parts.push(
      <div key={nextKey('quote')} style={{ borderLeft: `3px solid ${colors.separatorOpaque}`, paddingLeft: 12, marginBottom: spacing.sm, opacity: 0.8 }}>
        <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{renderInline(match[1].trim())}</Paragraph>
      </div>
    );
    lastIndex = index + match[0].length;
  }

  const tail = text.slice(lastIndex).trim();
  if (tail) {
    tail.split(/\r?\n/).filter(Boolean).forEach((line) => {
      parts.push(<Paragraph key={nextKey('tail')} style={{ whiteSpace: 'pre-wrap', marginBottom: spacing.sm }}>{renderInline(line)}</Paragraph>);
    });
  }

  return parts.length > 0 ? parts : <Text type="secondary">暂无文本内容</Text>;
}

interface DTextRendererProps {
  value: string;
  mode?: MarkupMode;
}

export const DTextRenderer: React.FC<DTextRendererProps> = ({ value, mode = 'dtext' }) => {
  // 缓存元素树：nextKey 是全局自增计数器，每次重新生成节点 key 都会变化，
  // 不缓存会导致 SpoilerText 等有状态子组件在父组件任意重渲染时被重挂载、丢失展开状态
  const content = useMemo(() => {
    const normalized = mode === 'bbcode' ? value : value.replace(/~([\w:.-]+)/g, '{{$1}}');
    return renderBlocks(normalized);
  }, [value, mode]);
  return <>{content}</>;
};

export default DTextRenderer;
