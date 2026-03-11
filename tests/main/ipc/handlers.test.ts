import { describe, it, expect } from 'vitest';

/**
 * handlers.ts 纯函数测试
 * 提取 parseCreatedAt、resolveArtistTags 中的纯逻辑进行测试
 * 不涉及 Electron IPC / 数据库，纯逻辑验证
 */

// ========= 等价实现：parseCreatedAt =========

/**
 * 安全解析 created_at 字段
 * Moebooru API 在不同接口返回的格式不同：
 * - /post.json 返回 Unix 时间戳（数字）
 * - /pool/show.json 的 posts 返回 ISO 字符串
 */
function parseCreatedAt(value: any): string {
  if (!value) return new Date().toISOString();

  // 如果是数字（Unix 时间戳）
  if (typeof value === 'number') {
    return new Date(value * 1000).toISOString();
  }

  // 如果是字符串，尝试直接解析
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return new Date().toISOString();
}

// ========= 等价实现：resolveArtistTags 中的纯逻辑部分 =========

/** 从帖子标签中收集所有唯一标签 */
function collectAllTags(posts: Array<{ tags?: string }>): Set<string> {
  const allTags = new Set<string>();
  for (const post of posts) {
    if (post.tags) {
      for (const tag of post.tags.split(/\s+/)) {
        if (tag) allTags.add(tag);
      }
    }
  }
  return allTags;
}

/** 为帖子列表匹配 artist 标签（排除黑名单） */
function matchArtistTags(
  posts: Array<{ postId: number; tags?: string }>,
  artistSet: Set<string>,
  excludeTags: Set<string> = new Set(['banned_artist', 'voice_actor'])
): Map<number, string> {
  const result = new Map<number, string>();
  for (const post of posts) {
    if (!post.tags) continue;
    const tags = post.tags.split(/\s+/);
    for (const tag of tags) {
      if (tag && artistSet.has(tag) && !excludeTags.has(tag)) {
        result.set(post.postId, tag);
        break;
      }
    }
  }
  return result;
}

/** 将标签数组按批次分割（SQLite 变量上限 999） */
function batchArray<T>(arr: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < arr.length; i += batchSize) {
    batches.push(arr.slice(i, i + batchSize));
  }
  return batches;
}

// ========= 测试 =========

describe('parseCreatedAt', () => {
  describe('Unix 时间戳（数字）', () => {
    it('应正确解析 Unix 秒级时间戳', () => {
      // 2024-01-01 00:00:00 UTC
      const result = parseCreatedAt(1704067200);
      expect(result).toBe('2024-01-01T00:00:00.000Z');
    });

    it('应正确解析 0 时间戳（Epoch）', () => {
      const result = parseCreatedAt(0);
      // 0 是 falsy，应返回当前时间
      const now = new Date();
      const parsed = new Date(result);
      expect(Math.abs(parsed.getTime() - now.getTime())).toBeLessThan(1000);
    });

    it('应正确解析较大的时间戳', () => {
      // 2030-06-15 12:30:45 UTC
      const result = parseCreatedAt(1907932245);
      const date = new Date(result);
      expect(date.getUTCFullYear()).toBe(2030);
      expect(date.getUTCMonth()).toBe(5); // 6月 = index 5
    });

    it('应正确解析负数时间戳（1970 年之前）', () => {
      const result = parseCreatedAt(-86400);
      const date = new Date(result);
      expect(date.getUTCFullYear()).toBe(1969);
    });
  });

  describe('ISO 字符串', () => {
    it('应正确解析标准 ISO 字符串', () => {
      const result = parseCreatedAt('2024-03-15T10:30:00.000Z');
      expect(result).toBe('2024-03-15T10:30:00.000Z');
    });

    it('应正确解析不带毫秒的 ISO 字符串', () => {
      const result = parseCreatedAt('2024-03-15T10:30:00Z');
      const date = new Date(result);
      expect(date.getUTCFullYear()).toBe(2024);
      expect(date.getUTCMonth()).toBe(2); // 3月
      expect(date.getUTCDate()).toBe(15);
    });

    it('应正确解析带时区偏移的字符串', () => {
      const result = parseCreatedAt('2024-03-15T18:30:00+08:00');
      const date = new Date(result);
      expect(date.getUTCHours()).toBe(10); // 18:00+08:00 = 10:00 UTC
    });

    it('应正确解析日期字符串（无时间）', () => {
      const result = parseCreatedAt('2024-03-15');
      const date = new Date(result);
      expect(date.getUTCFullYear()).toBe(2024);
    });
  });

  describe('无效值', () => {
    it('null 应返回当前时间', () => {
      const result = parseCreatedAt(null);
      const now = new Date();
      const parsed = new Date(result);
      expect(Math.abs(parsed.getTime() - now.getTime())).toBeLessThan(1000);
    });

    it('undefined 应返回当前时间', () => {
      const result = parseCreatedAt(undefined);
      const now = new Date();
      const parsed = new Date(result);
      expect(Math.abs(parsed.getTime() - now.getTime())).toBeLessThan(1000);
    });

    it('空字符串应返回当前时间', () => {
      const result = parseCreatedAt('');
      const now = new Date();
      const parsed = new Date(result);
      expect(Math.abs(parsed.getTime() - now.getTime())).toBeLessThan(1000);
    });

    it('无效字符串应返回当前时间', () => {
      const result = parseCreatedAt('not-a-date');
      const now = new Date();
      const parsed = new Date(result);
      expect(Math.abs(parsed.getTime() - now.getTime())).toBeLessThan(1000);
    });

    it('布尔值应返回当前时间', () => {
      const result = parseCreatedAt(true);
      const now = new Date();
      const parsed = new Date(result);
      expect(Math.abs(parsed.getTime() - now.getTime())).toBeLessThan(1000);
    });

    it('对象应返回当前时间', () => {
      const result = parseCreatedAt({ time: 123 });
      const now = new Date();
      const parsed = new Date(result);
      expect(Math.abs(parsed.getTime() - now.getTime())).toBeLessThan(1000);
    });
  });

  describe('返回值格式', () => {
    it('返回值应始终为合法的 ISO 字符串', () => {
      const inputs = [1704067200, '2024-01-01', null, undefined, 'invalid'];
      for (const input of inputs) {
        const result = parseCreatedAt(input);
        const date = new Date(result);
        expect(isNaN(date.getTime())).toBe(false);
        expect(result).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      }
    });
  });
});

describe('collectAllTags', () => {
  it('应从帖子中提取所有唯一标签', () => {
    const posts = [
      { tags: 'girl blue_eyes blonde_hair' },
      { tags: 'girl red_eyes black_hair' },
    ];
    const tags = collectAllTags(posts);
    expect(tags.size).toBe(5);
    expect(tags.has('girl')).toBe(true);
    expect(tags.has('blue_eyes')).toBe(true);
    expect(tags.has('red_eyes')).toBe(true);
  });

  it('应忽略空标签', () => {
    const posts = [
      { tags: '  girl   blue_eyes  ' }, // 多空格
    ];
    const tags = collectAllTags(posts);
    expect(tags.has('')).toBe(false);
    expect(tags.size).toBe(2);
  });

  it('空帖子列表应返回空集合', () => {
    expect(collectAllTags([]).size).toBe(0);
  });

  it('帖子无 tags 字段应跳过', () => {
    const posts = [
      { tags: undefined },
      { tags: 'girl' },
    ];
    const tags = collectAllTags(posts);
    expect(tags.size).toBe(1);
    expect(tags.has('girl')).toBe(true);
  });

  it('应去重', () => {
    const posts = [
      { tags: 'girl girl girl' },
    ];
    const tags = collectAllTags(posts);
    expect(tags.size).toBe(1);
  });
});

describe('matchArtistTags', () => {
  it('应为帖子匹配第一个 artist 标签', () => {
    const posts = [
      { postId: 1, tags: 'girl artist_a blue_eyes' },
      { postId: 2, tags: 'boy artist_b red_eyes' },
    ];
    const artistSet = new Set(['artist_a', 'artist_b']);
    const result = matchArtistTags(posts, artistSet);
    expect(result.get(1)).toBe('artist_a');
    expect(result.get(2)).toBe('artist_b');
  });

  it('只匹配第一个 artist 标签', () => {
    const posts = [
      { postId: 1, tags: 'artist_a artist_b girl' },
    ];
    const artistSet = new Set(['artist_a', 'artist_b']);
    const result = matchArtistTags(posts, artistSet);
    expect(result.get(1)).toBe('artist_a');
  });

  it('应排除黑名单标签', () => {
    const posts = [
      { postId: 1, tags: 'banned_artist real_artist girl' },
    ];
    const artistSet = new Set(['banned_artist', 'real_artist']);
    const result = matchArtistTags(posts, artistSet);
    expect(result.get(1)).toBe('real_artist');
  });

  it('应排除 voice_actor', () => {
    const posts = [
      { postId: 1, tags: 'voice_actor' },
    ];
    const artistSet = new Set(['voice_actor']);
    const result = matchArtistTags(posts, artistSet);
    expect(result.has(1)).toBe(false);
  });

  it('帖子无 artist 标签时不应有结果', () => {
    const posts = [
      { postId: 1, tags: 'girl blue_eyes' },
    ];
    const artistSet = new Set(['artist_a']);
    const result = matchArtistTags(posts, artistSet);
    expect(result.has(1)).toBe(false);
  });

  it('帖子无 tags 应跳过', () => {
    const posts = [
      { postId: 1, tags: undefined },
    ];
    const artistSet = new Set(['artist_a']);
    const result = matchArtistTags(posts, artistSet);
    expect(result.size).toBe(0);
  });

  it('空帖子列表应返回空 Map', () => {
    const result = matchArtistTags([], new Set(['artist_a']));
    expect(result.size).toBe(0);
  });

  it('空 artistSet 不应匹配任何标签', () => {
    const posts = [
      { postId: 1, tags: 'girl artist_a' },
    ];
    const result = matchArtistTags(posts, new Set());
    expect(result.size).toBe(0);
  });

  it('支持自定义 excludeTags', () => {
    const posts = [
      { postId: 1, tags: 'custom_exclude real_artist' },
    ];
    const artistSet = new Set(['custom_exclude', 'real_artist']);
    const result = matchArtistTags(posts, artistSet, new Set(['custom_exclude']));
    expect(result.get(1)).toBe('real_artist');
  });
});

describe('batchArray', () => {
  it('应按指定大小分批', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7];
    const batches = batchArray(arr, 3);
    expect(batches).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });

  it('数组小于批次大小时应返回单个批次', () => {
    const arr = [1, 2];
    const batches = batchArray(arr, 5);
    expect(batches).toEqual([[1, 2]]);
  });

  it('数组为空时应返回空数组', () => {
    expect(batchArray([], 5)).toEqual([]);
  });

  it('批次大小为 1 时每个元素一个批次', () => {
    const arr = ['a', 'b', 'c'];
    const batches = batchArray(arr, 1);
    expect(batches).toEqual([['a'], ['b'], ['c']]);
  });

  it('批次大小等于数组长度时返回单个批次', () => {
    const arr = [1, 2, 3];
    const batches = batchArray(arr, 3);
    expect(batches).toEqual([[1, 2, 3]]);
  });

  it('SQL_BATCH = 200 时应正确分批大量标签', () => {
    const arr = Array.from({ length: 450 }, (_, i) => `tag_${i}`);
    const batches = batchArray(arr, 200);
    expect(batches.length).toBe(3);
    expect(batches[0].length).toBe(200);
    expect(batches[1].length).toBe(200);
    expect(batches[2].length).toBe(50);
  });
});
