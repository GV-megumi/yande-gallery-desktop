/**
 * Booru Wiki 页面
 * 当前优先支持 Danbooru Wiki，提供基础 DText 链接跳转与正文浏览。
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Alert, App, Button, Empty, Select, Space, Spin, Tag, Typography } from 'antd';
import { BookOutlined, LeftOutlined, LinkOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { BooruSite, BooruWiki } from '../../shared/types';
import { colors, spacing, radius, fontSize } from '../styles/tokens';

const { Title, Paragraph, Text } = Typography;

interface BooruWikiPageProps {
  wikiTitle: string;
  initialSiteId?: number | null;
  onBack?: () => void;
  onTagClick?: (tag: string, siteId?: number | null) => void;
  onWikiClick?: (title: string, siteId?: number | null) => void;
}

let wikiRenderKey = 0;

function buildWikiUrl(site: BooruSite | null, title: string): string | null {
  if (!site || site.type !== 'danbooru') {
    return null;
  }
  return `${site.url.replace(/\/$/, '')}/wiki_pages/${encodeURIComponent(title)}`;
}

function formatWikiTime(value?: string): string {
  if (!value) {
    return '未知';
  }
  try {
    return new Date(value).toLocaleString('zh-CN');
  } catch {
    return value;
  }
}

function renderInlineWikiText(
  text: string,
  onTagClick?: (tag: string) => void,
  onWikiClick?: (title: string) => void
): React.ReactNode[] {
  const pattern = /(\[\[([^\]|]+)(?:\|([^\]]+))?\]\])|(\{\{([^}]+)\}\})|(https?:\/\/[^\s<]+)/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const before = text.slice(lastIndex, index);
    if (before) {
      nodes.push(before);
    }

    const wikiTarget = match[2];
    const wikiLabel = match[3];
    const tagTarget = match[5];
    const url = match[6];

    if (wikiTarget) {
      const title = wikiTarget.trim();
      nodes.push(
        <Button
          key={`wk${wikiRenderKey++}`}
          type="link"
          size="small"
          style={{ paddingInline: 2, height: 'auto' }}
          onClick={() => onWikiClick?.(title)}
        >
          {wikiLabel?.trim() || title.replace(/_/g, ' ')}
        </Button>
      );
    } else if (tagTarget) {
      const tag = tagTarget.trim();
      nodes.push(
        <Button
          key={`tg${wikiRenderKey++}`}
          type="link"
          size="small"
          style={{ paddingInline: 2, height: 'auto' }}
          onClick={() => onTagClick?.(tag)}
        >
          {tag.replace(/_/g, ' ')}
        </Button>
      );
    } else if (url) {
      nodes.push(
        <a
          key={`url${wikiRenderKey++}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ wordBreak: 'break-all' }}
        >
          {url}
        </a>
      );
    }

    lastIndex = index + match[0].length;
  }

  const tail = text.slice(lastIndex);
  if (tail) {
    nodes.push(tail);
  }

  return nodes.length > 0 ? nodes : [text];
}

function renderWikiBody(
  body: string,
  onTagClick?: (tag: string) => void,
  onWikiClick?: (title: string) => void
): React.ReactNode {
  const lines = body.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }
    blocks.push(
      <ul key={`list${wikiRenderKey++}`} style={{ paddingLeft: 20, marginBottom: spacing.md }}>
        {listItems.map((item, index) => (
          <li key={`li${index}`} style={{ marginBottom: 4, color: colors.textPrimary }}>
            {renderInlineWikiText(item, onTagClick, onWikiClick)}
          </li>
        ))}
      </ul>
    );
    listItems = [];
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      return;
    }

    if (line.startsWith('* ')) {
      listItems.push(line.slice(2));
      return;
    }

    flushList();

    const headingMatch = line.match(/^(h[1-6])\.\s+(.*)$/i);
    if (headingMatch) {
      const level = Number(headingMatch[1].slice(1));
      blocks.push(
        <Title key={`hd${wikiRenderKey++}`} level={Math.min(level + 1, 5) as 1 | 2 | 3 | 4 | 5} style={{ marginTop: spacing.lg }}>
          {headingMatch[2]}
        </Title>
      );
      return;
    }

    blocks.push(
      <Paragraph key={`p${wikiRenderKey++}`} style={{ whiteSpace: 'pre-wrap', marginBottom: spacing.sm }}>
        {renderInlineWikiText(line, onTagClick, onWikiClick)}
      </Paragraph>
    );
  });

  flushList();

  if (blocks.length === 0) {
    return <Text type="secondary">该 Wiki 页面暂无正文。</Text>;
  }

  return <>{blocks}</>;
}

export const BooruWikiPage: React.FC<BooruWikiPageProps> = ({
  wikiTitle,
  initialSiteId = null,
  onBack,
  onTagClick,
  onWikiClick,
}) => {
  const { message } = App.useApp();
  const [sites, setSites] = useState<BooruSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(initialSiteId);
  const [sitesLoaded, setSitesLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [wiki, setWiki] = useState<BooruWiki | null>(null);

  const selectedSite = useMemo(
    () => sites.find(site => site.id === selectedSiteId) || null,
    [sites, selectedSiteId]
  );

  const externalWikiUrl = useMemo(
    () => buildWikiUrl(selectedSite, wikiTitle),
    [selectedSite, wikiTitle]
  );

  const loadSites = useCallback(async () => {
    try {
      const result = await window.electronAPI.booru.getSites();
      if (result.success && result.data) {
        setSites(result.data);
        let nextSiteId = initialSiteId;
        if (!nextSiteId || !result.data.some(site => site.id === nextSiteId)) {
          nextSiteId = result.data[0]?.id ?? null;
        }
        setSelectedSiteId(nextSiteId ?? null);
      }
    } catch (error) {
      console.error('[BooruWikiPage] 加载站点失败:', error);
    } finally {
      setSitesLoaded(true);
    }
  }, [initialSiteId]);

  const loadWiki = useCallback(async () => {
    if (!selectedSiteId || !wikiTitle) {
      return;
    }

    if (selectedSite && selectedSite.type !== 'danbooru') {
      setWiki(null);
      return;
    }

    setLoading(true);
    try {
      console.log('[BooruWikiPage] 加载 Wiki:', wikiTitle, 'siteId:', selectedSiteId);
      const result = await window.electronAPI.booru.getWiki(selectedSiteId, wikiTitle);
      if (result.success) {
        if (result.data) {
          setWiki(result.data);
        } else {
          setWiki(null);
        }
      } else {
        setWiki(null);
        message.error('加载 Wiki 失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BooruWikiPage] 加载 Wiki 失败:', error);
      message.error('加载 Wiki 失败');
      setWiki(null);
    } finally {
      setLoading(false);
    }
  }, [selectedSite, selectedSiteId, wikiTitle, message]);

  useEffect(() => {
    loadSites();
  }, [loadSites]);

  useEffect(() => {
    if (sitesLoaded && selectedSiteId) {
      loadWiki();
    }
  }, [sitesLoaded, selectedSiteId, loadWiki]);

  return (
    <div style={{ padding: spacing.lg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md, flexWrap: 'wrap' }}>
        {onBack && (
          <Button icon={<LeftOutlined />} onClick={onBack}>
            返回
          </Button>
        )}
        <Title level={3} style={{ margin: 0 }}>
          <Space size="small">
            <BookOutlined />
            <span>Wiki: {wikiTitle.replace(/_/g, ' ')}</span>
          </Space>
        </Title>
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.sm,
        marginBottom: spacing.md,
        flexWrap: 'wrap'
      }}>
        <Space wrap>
          <Select
            value={selectedSiteId ?? undefined}
            style={{ width: 220 }}
            placeholder="选择站点"
            options={sites.map(site => ({ value: site.id, label: `${site.name} (${site.type})` }))}
            onChange={(value) => setSelectedSiteId(value)}
          />
          <Button icon={<ReloadOutlined />} onClick={loadWiki} disabled={!selectedSiteId || loading}>
            刷新
          </Button>
          {onTagClick && (
            <Button icon={<SearchOutlined />} onClick={() => onTagClick(wikiTitle, selectedSiteId)}>
              搜索该标签
            </Button>
          )}
          {externalWikiUrl && (
            <Button icon={<LinkOutlined />} onClick={() => window.electronAPI.system.openExternal(externalWikiUrl)}>
              浏览器打开
            </Button>
          )}
        </Space>
      </div>

      {selectedSite && selectedSite.type !== 'danbooru' && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: spacing.md }}
          message="当前仅 Danbooru 站点提供内置 Wiki 浏览支持"
          description="Moebooru 和 Gelbooru 客户端暂未实现 Wiki API，因此这里可能会显示为空。"
        />
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '64px 0' }}>
          <Spin size="large" />
        </div>
      ) : !wiki ? (
        <Empty
          description={selectedSite ? `未找到 ${selectedSite.name} 上的 Wiki 页面` : '请先选择站点'}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <div style={{
          background: colors.bgElevated,
          border: `1px solid ${colors.border}`,
          borderRadius: radius.lg,
          padding: spacing.lg,
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.04)'
        }}>
          <div style={{ marginBottom: spacing.md }}>
            <Space wrap size={[8, 8]}>
              <Text strong style={{ fontSize: fontSize.xl }}>{wiki.title.replace(/_/g, ' ')}</Text>
              {wiki.isLocked && <Tag color="orange">已锁定</Tag>}
              {wiki.isDeleted && <Tag color="red">已删除</Tag>}
              <Tag color="blue">{selectedSite?.name || '未知站点'}</Tag>
            </Space>
            <div style={{ marginTop: spacing.xs }}>
              <Text type="secondary">更新时间: {formatWikiTime(wiki.updatedAt || wiki.createdAt)}</Text>
            </div>
          </div>

          {wiki.otherNames.length > 0 && (
            <div style={{ marginBottom: spacing.md }}>
              <Text strong style={{ marginRight: spacing.sm }}>别名:</Text>
              <Space wrap size={[6, 6]}>
                {wiki.otherNames.map(name => (
                  <Tag key={name}>{name}</Tag>
                ))}
              </Space>
            </div>
          )}

          <div style={{
            padding: spacing.md,
            background: colors.bgGroupedSecondary,
            borderRadius: radius.md,
            border: `1px solid ${colors.separator}`
          }}>
            {renderWikiBody(
              wiki.body,
              onTagClick ? (tag) => onTagClick(tag, selectedSiteId) : undefined,
              onWikiClick ? (title) => onWikiClick(title, selectedSiteId) : undefined
            )}
          </div>
        </div>
      )}
    </div>
  );
};
