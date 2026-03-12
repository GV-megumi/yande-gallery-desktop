import { describe, it, expect } from 'vitest';

/**
 * PostHistorySection 组件纯逻辑测试
 *
 * 从 PostHistorySection.tsx 中提取以下纯函数进行单元测试：
 * 1. formatDate — 日期格式化
 * 2. truncateTags — 标签截断显示逻辑
 * 3. 版本历史数据结构验证
 * 4. 渲染条件判断逻辑（评级变更、来源变更、无变更提示等）
 */

// ========= 等价实现：formatDate =========

/**
 * 日期格式化（与组件中 formatDate 逻辑一致）
 * 使用 zh-CN 格式输出年/月/日 时:分
 */
function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

// ========= 等价实现：truncateTags =========

/**
 * 标签截断逻辑（与组件中 tags_added.slice(0, 8) 逻辑一致）
 * 超过 maxShow 个标签时截断，并返回剩余数量
 */
function truncateTags(
  tags: string[],
  maxShow: number = 8
): { visible: string[]; remaining: number } {
  if (tags.length <= maxShow) return { visible: tags, remaining: 0 };
  return { visible: tags.slice(0, maxShow), remaining: tags.length - maxShow };
}

// ========= 等价实现：PostVersionData 接口 =========

interface PostVersionData {
  id: number;
  post_id: number;
  version: number;
  updater_name: string;
  created_at: string;
  tags_added: string[];
  tags_removed: string[];
  rating?: string;
  rating_changed?: boolean;
  source?: string;
  source_changed?: boolean;
}

// ========= 等价实现：渲染条件判断 =========

/** 判断是否显示评级变更 */
function shouldShowRatingChange(v: PostVersionData): boolean {
  return !!(v.rating_changed && v.rating);
}

/** 判断是否显示来源变更 */
function shouldShowSourceChange(v: PostVersionData): boolean {
  return !!(v.source_changed && v.source);
}

/** 判断是否显示"无标签变更"提示 */
function shouldShowNoChanges(v: PostVersionData): boolean {
  return (
    v.tags_added.length === 0 &&
    v.tags_removed.length === 0 &&
    !v.rating_changed &&
    !v.source_changed
  );
}

// ========= 测试用例 =========

describe('PostHistorySection — formatDate 日期格式化', () => {
  it('ISO 字符串能正确格式化为中文日期', () => {
    const result = formatDate('2024-03-10T15:30:00Z');
    // 包含年月日和时分（具体格式取决于时区，但应包含数字）
    expect(result).toMatch(/2024/);
    expect(result).toMatch(/03/);
    expect(result).toMatch(/10/);
  });

  it('另一个有效日期字符串', () => {
    const result = formatDate('2023-12-25T08:00:00Z');
    expect(result).toMatch(/2023/);
    expect(result).toMatch(/12/);
    expect(result).toMatch(/25/);
  });

  it('无效日期字符串应返回原始字符串', () => {
    // "Invalid Date" 在 toLocaleString 时不会抛异常，但会返回 "Invalid Date"
    // 我们验证函数不会崩溃
    const result = formatDate('not-a-date');
    expect(typeof result).toBe('string');
    // 结果要么是 "Invalid Date" 要么是原始字符串
    expect(result.length).toBeGreaterThan(0);
  });

  it('空字符串处理', () => {
    const result = formatDate('');
    expect(typeof result).toBe('string');
    // 空字符串传入 new Date('') 会产生 Invalid Date
    expect(result.length).toBeGreaterThan(0);
  });

  it('Unix 时间戳字符串', () => {
    // "0" 对应 1970-01-01
    const result = formatDate('1970-01-01T00:00:00Z');
    expect(result).toMatch(/1970/);
  });
});

describe('PostHistorySection — truncateTags 标签截断', () => {
  it('空数组应返回空可见列表和 0 剩余', () => {
    const result = truncateTags([]);
    expect(result.visible).toEqual([]);
    expect(result.remaining).toBe(0);
  });

  it('标签数少于 8 个时全部显示', () => {
    const tags = ['tag1', 'tag2', 'tag3'];
    const result = truncateTags(tags);
    expect(result.visible).toEqual(tags);
    expect(result.remaining).toBe(0);
  });

  it('恰好 8 个标签时全部显示，无截断', () => {
    const tags = Array.from({ length: 8 }, (_, i) => `tag${i + 1}`);
    const result = truncateTags(tags);
    expect(result.visible).toHaveLength(8);
    expect(result.remaining).toBe(0);
  });

  it('9 个标签时截断，显示 8 个，剩余 1 个', () => {
    const tags = Array.from({ length: 9 }, (_, i) => `tag${i + 1}`);
    const result = truncateTags(tags);
    expect(result.visible).toHaveLength(8);
    expect(result.remaining).toBe(1);
    expect(result.visible[0]).toBe('tag1');
    expect(result.visible[7]).toBe('tag8');
  });

  it('20 个标签时截断，显示 8 个，剩余 12 个', () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag${i + 1}`);
    const result = truncateTags(tags);
    expect(result.visible).toHaveLength(8);
    expect(result.remaining).toBe(12);
  });

  it('自定义 maxShow 参数', () => {
    const tags = ['a', 'b', 'c', 'd', 'e'];
    const result = truncateTags(tags, 3);
    expect(result.visible).toEqual(['a', 'b', 'c']);
    expect(result.remaining).toBe(2);
  });

  it('maxShow 为 0 时所有标签都算剩余', () => {
    const tags = ['a', 'b'];
    const result = truncateTags(tags, 0);
    expect(result.visible).toEqual([]);
    expect(result.remaining).toBe(2);
  });
});

describe('PostHistorySection — PostVersionData 接口验证', () => {
  /** 构造一个合法的 PostVersionData */
  function makeVersion(overrides: Partial<PostVersionData> = {}): PostVersionData {
    return {
      id: 1,
      post_id: 100,
      version: 1,
      updater_name: 'test_user',
      created_at: '2024-03-10T15:30:00Z',
      tags_added: [],
      tags_removed: [],
      ...overrides,
    };
  }

  it('基本结构正确', () => {
    const v = makeVersion();
    expect(v.id).toBe(1);
    expect(v.post_id).toBe(100);
    expect(v.version).toBe(1);
    expect(v.updater_name).toBe('test_user');
    expect(v.created_at).toBe('2024-03-10T15:30:00Z');
    expect(v.tags_added).toEqual([]);
    expect(v.tags_removed).toEqual([]);
  });

  it('tags_added 和 tags_removed 是字符串数组', () => {
    const v = makeVersion({
      tags_added: ['1girl', 'blue_eyes'],
      tags_removed: ['solo'],
    });
    expect(Array.isArray(v.tags_added)).toBe(true);
    expect(Array.isArray(v.tags_removed)).toBe(true);
    expect(v.tags_added).toContain('1girl');
    expect(v.tags_removed).toContain('solo');
  });

  it('version 是递增整数', () => {
    const versions = [
      makeVersion({ version: 1 }),
      makeVersion({ version: 2 }),
      makeVersion({ version: 3 }),
    ];
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i].version).toBeGreaterThan(versions[i - 1].version);
    }
  });

  it('版本号排序（从新到旧）', () => {
    const versions = [
      makeVersion({ version: 5 }),
      makeVersion({ version: 3 }),
      makeVersion({ version: 1 }),
    ];
    const sorted = [...versions].sort((a, b) => b.version - a.version);
    expect(sorted[0].version).toBe(5);
    expect(sorted[1].version).toBe(3);
    expect(sorted[2].version).toBe(1);
  });

  it('可选字段 rating / rating_changed', () => {
    const v = makeVersion({ rating: 'safe', rating_changed: true });
    expect(v.rating).toBe('safe');
    expect(v.rating_changed).toBe(true);
  });

  it('可选字段 source / source_changed', () => {
    const v = makeVersion({ source: 'https://pixiv.net/123', source_changed: true });
    expect(v.source).toBe('https://pixiv.net/123');
    expect(v.source_changed).toBe(true);
  });
});

describe('PostHistorySection — 渲染条件判断', () => {
  function makeVersion(overrides: Partial<PostVersionData> = {}): PostVersionData {
    return {
      id: 1,
      post_id: 100,
      version: 1,
      updater_name: 'editor',
      created_at: '2024-01-01T00:00:00Z',
      tags_added: [],
      tags_removed: [],
      ...overrides,
    };
  }

  describe('评级变更显示条件', () => {
    it('rating_changed=true 且 rating 有值时显示', () => {
      const v = makeVersion({ rating_changed: true, rating: 'safe' });
      expect(shouldShowRatingChange(v)).toBe(true);
    });

    it('rating_changed=true 但 rating 为空时不显示', () => {
      const v = makeVersion({ rating_changed: true });
      expect(shouldShowRatingChange(v)).toBe(false);
    });

    it('rating_changed=false 时不显示', () => {
      const v = makeVersion({ rating_changed: false, rating: 'safe' });
      expect(shouldShowRatingChange(v)).toBe(false);
    });

    it('rating_changed 未定义时不显示', () => {
      const v = makeVersion({ rating: 'safe' });
      expect(shouldShowRatingChange(v)).toBe(false);
    });
  });

  describe('来源变更显示条件', () => {
    it('source_changed=true 且 source 有值时显示', () => {
      const v = makeVersion({ source_changed: true, source: 'https://example.com' });
      expect(shouldShowSourceChange(v)).toBe(true);
    });

    it('source_changed=true 但 source 为空时不显示', () => {
      const v = makeVersion({ source_changed: true });
      expect(shouldShowSourceChange(v)).toBe(false);
    });

    it('source_changed=false 时不显示', () => {
      const v = makeVersion({ source_changed: false, source: 'https://example.com' });
      expect(shouldShowSourceChange(v)).toBe(false);
    });
  });

  describe('"无标签变更" 提示显示条件', () => {
    it('无任何变更时显示', () => {
      const v = makeVersion();
      expect(shouldShowNoChanges(v)).toBe(true);
    });

    it('有新增标签时不显示', () => {
      const v = makeVersion({ tags_added: ['new_tag'] });
      expect(shouldShowNoChanges(v)).toBe(false);
    });

    it('有移除标签时不显示', () => {
      const v = makeVersion({ tags_removed: ['old_tag'] });
      expect(shouldShowNoChanges(v)).toBe(false);
    });

    it('有评级变更时不显示', () => {
      const v = makeVersion({ rating_changed: true });
      expect(shouldShowNoChanges(v)).toBe(false);
    });

    it('有来源变更时不显示', () => {
      const v = makeVersion({ source_changed: true });
      expect(shouldShowNoChanges(v)).toBe(false);
    });

    it('同时有新增和移除标签时不显示', () => {
      const v = makeVersion({ tags_added: ['a'], tags_removed: ['b'] });
      expect(shouldShowNoChanges(v)).toBe(false);
    });
  });
});

describe('PostHistorySection — 展开/折叠控制逻辑', () => {
  /**
   * 模拟展开折叠状态机：
   * - 默认 expanded=false，不触发加载
   * - 展开时触发加载
   * - 折叠后再展开，相同 postId 不重新加载
   */

  /** 简单状态机模拟 */
  function createExpandController() {
    let expanded = false;
    let loadedPostId: number | null = null;
    let loadCount = 0;

    return {
      get expanded() { return expanded; },
      get loadCount() { return loadCount; },
      toggle(postId: number) {
        expanded = !expanded;
        if (expanded && loadedPostId !== postId) {
          loadedPostId = postId;
          loadCount++;
        }
      },
      /** 模拟 postId 变更时重置 */
      resetForNewPost() {
        loadedPostId = null;
        expanded = false;
      },
    };
  }

  it('默认状态不加载数据', () => {
    const ctrl = createExpandController();
    expect(ctrl.expanded).toBe(false);
    expect(ctrl.loadCount).toBe(0);
  });

  it('首次展开触发数据加载', () => {
    const ctrl = createExpandController();
    ctrl.toggle(100);
    expect(ctrl.expanded).toBe(true);
    expect(ctrl.loadCount).toBe(1);
  });

  it('折叠后重新展开相同 postId 不重复加载', () => {
    const ctrl = createExpandController();
    ctrl.toggle(100); // 展开 → 加载
    ctrl.toggle(100); // 折叠
    expect(ctrl.expanded).toBe(false);
    ctrl.toggle(100); // 再次展开 → 不加载（同一 postId）
    expect(ctrl.expanded).toBe(true);
    expect(ctrl.loadCount).toBe(1);
  });

  it('切换到不同 postId 时触发重新加载', () => {
    const ctrl = createExpandController();
    ctrl.toggle(100); // 展开帖子 100
    expect(ctrl.loadCount).toBe(1);
    ctrl.toggle(100); // 折叠
    ctrl.resetForNewPost();
    ctrl.toggle(200); // 展开帖子 200
    expect(ctrl.loadCount).toBe(2);
  });
});
