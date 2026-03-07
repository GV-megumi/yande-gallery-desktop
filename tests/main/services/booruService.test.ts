import { describe, it, expect } from 'vitest';

/**
 * booruService 纯逻辑测试
 * 由于 booruService 依赖数据库连接，
 * 这里测试其核心数据转换和验证逻辑
 */

describe('booruService - 布尔值转换', () => {
  // SQLite 返回 0/1，需要转换为 boolean
  function convertSiteBooleans(site: Record<string, any>) {
    return {
      ...site,
      favoriteSupport: Boolean(site.favoriteSupport),
      active: Boolean(site.active),
    };
  }

  it('SQLite 1 应转换为 true', () => {
    const site = { name: 'Test', favoriteSupport: 1, active: 1 };
    const result = convertSiteBooleans(site);
    expect(result.favoriteSupport).toBe(true);
    expect(result.active).toBe(true);
  });

  it('SQLite 0 应转换为 false', () => {
    const site = { name: 'Test', favoriteSupport: 0, active: 0 };
    const result = convertSiteBooleans(site);
    expect(result.favoriteSupport).toBe(false);
    expect(result.active).toBe(false);
  });

  it('null/undefined 应转换为 false', () => {
    const site = { name: 'Test', favoriteSupport: null, active: undefined };
    const result = convertSiteBooleans(site);
    expect(result.favoriteSupport).toBe(false);
    expect(result.active).toBe(false);
  });

  it('已是 boolean 的值应保持不变', () => {
    const site = { name: 'Test', favoriteSupport: true, active: false };
    const result = convertSiteBooleans(site);
    expect(result.favoriteSupport).toBe(true);
    expect(result.active).toBe(false);
  });
});

describe('booruService - 标签解析', () => {
  // Booru post 的 tags 是空格分隔的字符串
  function parseTags(tagString: string): string[] {
    if (!tagString || tagString.trim() === '') return [];
    return tagString.trim().split(/\s+/);
  }

  it('应正确解析空格分隔的标签', () => {
    expect(parseTags('girl blue_eyes long_hair')).toEqual(['girl', 'blue_eyes', 'long_hair']);
  });

  it('空字符串应返回空数组', () => {
    expect(parseTags('')).toEqual([]);
  });

  it('只有空格的字符串应返回空数组', () => {
    expect(parseTags('   ')).toEqual([]);
  });

  it('多余空格应被忽略', () => {
    expect(parseTags('  girl   blue_eyes  ')).toEqual(['girl', 'blue_eyes']);
  });

  it('单个标签应返回单元素数组', () => {
    expect(parseTags('solo')).toEqual(['solo']);
  });

  it('应处理大量标签', () => {
    const tags = Array.from({ length: 100 }, (_, i) => `tag_${i}`).join(' ');
    expect(parseTags(tags)).toHaveLength(100);
  });
});

describe('booruService - 下载队列优先级', () => {
  interface MockDownload {
    id: number;
    priority: number;
    createdAt: string;
  }

  // 按优先级排序（数字越大优先级越高），相同优先级按创建时间排序
  function sortByPriority(items: MockDownload[]): MockDownload[] {
    return [...items].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }

  it('应按优先级降序排列', () => {
    const items = [
      { id: 1, priority: 1, createdAt: '2024-01-01' },
      { id: 2, priority: 3, createdAt: '2024-01-01' },
      { id: 3, priority: 2, createdAt: '2024-01-01' },
    ];
    const sorted = sortByPriority(items);
    expect(sorted[0].id).toBe(2);
    expect(sorted[1].id).toBe(3);
    expect(sorted[2].id).toBe(1);
  });

  it('相同优先级应按创建时间排序（先创建先下载）', () => {
    const items = [
      { id: 1, priority: 0, createdAt: '2024-01-03' },
      { id: 2, priority: 0, createdAt: '2024-01-01' },
      { id: 3, priority: 0, createdAt: '2024-01-02' },
    ];
    const sorted = sortByPriority(items);
    expect(sorted[0].id).toBe(2);
    expect(sorted[1].id).toBe(3);
    expect(sorted[2].id).toBe(1);
  });
});

describe('booruService - MD5 去重检查', () => {
  function isDuplicate(md5: string, existingMd5Set: Set<string>): boolean {
    if (!md5) return false; // 没有 MD5 无法判断
    return existingMd5Set.has(md5);
  }

  it('已存在的 MD5 应判断为重复', () => {
    const existing = new Set(['abc123', 'def456']);
    expect(isDuplicate('abc123', existing)).toBe(true);
  });

  it('不存在的 MD5 不应判断为重复', () => {
    const existing = new Set(['abc123']);
    expect(isDuplicate('xyz789', existing)).toBe(false);
  });

  it('MD5 为空时不应判断为重复', () => {
    const existing = new Set(['abc123']);
    expect(isDuplicate('', existing)).toBe(false);
  });

  it('空集合不应有重复', () => {
    expect(isDuplicate('abc123', new Set())).toBe(false);
  });
});

describe('booruService - 搜索历史去重', () => {
  interface SearchHistory {
    query: string;
    createdAt: string;
  }

  // 去重逻辑：相同查询词只保留最新的
  function deduplicateHistory(history: SearchHistory[]): SearchHistory[] {
    const map = new Map<string, SearchHistory>();
    for (const item of history) {
      const existing = map.get(item.query);
      if (!existing || new Date(item.createdAt) > new Date(existing.createdAt)) {
        map.set(item.query, item);
      }
    }
    return Array.from(map.values());
  }

  it('相同查询词应只保留最新的', () => {
    const history = [
      { query: 'blue_eyes', createdAt: '2024-01-01' },
      { query: 'blue_eyes', createdAt: '2024-01-05' },
      { query: 'red_hair', createdAt: '2024-01-03' },
    ];
    const result = deduplicateHistory(history);
    expect(result).toHaveLength(2);
    const blueEyes = result.find(h => h.query === 'blue_eyes');
    expect(blueEyes?.createdAt).toBe('2024-01-05');
  });

  it('空历史应返回空数组', () => {
    expect(deduplicateHistory([])).toEqual([]);
  });

  it('无重复时应全部保留', () => {
    const history = [
      { query: 'a', createdAt: '2024-01-01' },
      { query: 'b', createdAt: '2024-01-02' },
    ];
    expect(deduplicateHistory(history)).toHaveLength(2);
  });
});

describe('booruService - 收藏标签 labels JSON 解析', () => {
  function parseLabels(labelsJson: string | null | undefined): string[] {
    if (!labelsJson) return [];
    try {
      const parsed = JSON.parse(labelsJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  it('应正确解析 JSON 数组', () => {
    expect(parseLabels('["group1","group2"]')).toEqual(['group1', 'group2']);
  });

  it('null 应返回空数组', () => {
    expect(parseLabels(null)).toEqual([]);
  });

  it('undefined 应返回空数组', () => {
    expect(parseLabels(undefined)).toEqual([]);
  });

  it('空字符串应返回空数组', () => {
    expect(parseLabels('')).toEqual([]);
  });

  it('非法 JSON 应返回空数组', () => {
    expect(parseLabels('not json')).toEqual([]);
  });

  it('JSON 对象而非数组应返回空数组', () => {
    expect(parseLabels('{"key":"value"}')).toEqual([]);
  });

  it('空 JSON 数组应返回空数组', () => {
    expect(parseLabels('[]')).toEqual([]);
  });
});
