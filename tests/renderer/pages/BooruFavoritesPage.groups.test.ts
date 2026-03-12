import { describe, it, expect } from 'vitest';

/**
 * BooruFavoritesPage 收藏夹分组 UI 纯逻辑测试
 *
 * 不渲染 React 组件，仅提取页面中可独立验证的纯逻辑：
 *   1. computeGroupIdParam — selectedGroupId 到 API 参数的转换
 *   2. 分组筛选状态机逻辑
 *   3. 分组名称验证（handleSaveGroup 前置检查）
 *   4. 删除分组后的状态重置逻辑
 *   5. 收藏列表排序与评级筛选
 */

// ========= 从 BooruFavoritesPage.tsx 提取的等价纯逻辑 =========

/**
 * 将 UI 层的 selectedGroupId 转换为 API 层的 groupId 参数
 * 对应 BooruFavoritesPage 中 loadFavorites 函数里的 groupIdParam 计算
 *
 * - 'all' → undefined（不过滤）
 * - 'ungrouped' → null（只取未分组收藏）
 * - number → number（取指定分组）
 */
function computeGroupIdParam(
  selectedGroupId: number | 'all' | 'ungrouped'
): number | null | undefined {
  if (selectedGroupId === 'all') return undefined;
  if (selectedGroupId === 'ungrouped') return null;
  return selectedGroupId;
}

/**
 * 删除分组后的 selectedGroupId 重置逻辑
 * 对应 handleDeleteGroup 中的条件判断：
 *   如果当前选中的分组被删除了，切回 'all'
 */
function computeGroupIdAfterDelete(
  currentGroupId: number | 'all' | 'ungrouped',
  deletedGroupId: number
): number | 'all' | 'ungrouped' {
  if (currentGroupId === deletedGroupId) return 'all';
  return currentGroupId;
}

/**
 * handleSaveGroup 的前置校验：名称不能为空
 */
function shouldAllowSave(name: string): boolean {
  return name.trim().length > 0;
}

/**
 * 收藏列表排序逻辑：按 postId 倒序
 */
function sortPostsByIdDesc<T extends { postId: number }>(posts: T[]): T[] {
  return [...posts].sort((a, b) => b.postId - a.postId);
}

/**
 * 评级筛选逻辑
 */
type RatingFilter = 'all' | 's' | 'q' | 'e';

function filterByRating<T extends { rating?: string }>(
  posts: T[],
  filter: RatingFilter
): T[] {
  if (filter === 'all') return posts;
  return posts.filter(post => post.rating === filter);
}

/**
 * 分组列表中编辑按钮点击时的状态设置
 */
function prepareEditState(group: { id: number; name: string; color?: string }) {
  return {
    editingGroup: group,
    newGroupName: group.name,
    groupColor: group.color || '#1677ff',
    groupModalVisible: true,
  };
}

/**
 * 新建按钮点击时的状态重置
 */
function prepareCreateState() {
  return {
    editingGroup: null,
    newGroupName: '',
    groupModalVisible: true,
  };
}

// ========= 测试 =========

describe('BooruFavoritesPage - computeGroupIdParam 分组参数转换', () => {
  it('"all" 应转换为 undefined（全部收藏，不过滤分组）', () => {
    expect(computeGroupIdParam('all')).toBeUndefined();
  });

  it('"ungrouped" 应转换为 null（未分组收藏）', () => {
    expect(computeGroupIdParam('ungrouped')).toBeNull();
  });

  it('数字应原样返回（指定分组）', () => {
    expect(computeGroupIdParam(1)).toBe(1);
    expect(computeGroupIdParam(42)).toBe(42);
  });

  it('数字 0 应原样返回（不与 null/undefined 混淆）', () => {
    // 虽然实际分组 ID 不太可能是 0，但逻辑上不应被误处理
    expect(computeGroupIdParam(0)).toBe(0);
  });

  it('转换结果类型应严格正确', () => {
    // undefined 和 null 在 JavaScript 中是不同的
    const allResult = computeGroupIdParam('all');
    const ungroupedResult = computeGroupIdParam('ungrouped');
    const numResult = computeGroupIdParam(5);

    expect(allResult).toBe(undefined);
    expect(ungroupedResult).toBe(null);
    expect(typeof numResult).toBe('number');
  });
});

describe('BooruFavoritesPage - 删除分组后状态重置', () => {
  it('删除当前选中的分组时，应重置为 "all"', () => {
    expect(computeGroupIdAfterDelete(5, 5)).toBe('all');
  });

  it('删除非当前选中的分组时，应保持不变（数字类型）', () => {
    expect(computeGroupIdAfterDelete(3, 5)).toBe(3);
  });

  it('当前选中 "all" 时，删除任何分组不影响', () => {
    expect(computeGroupIdAfterDelete('all', 5)).toBe('all');
  });

  it('当前选中 "ungrouped" 时，删除任何分组不影响', () => {
    expect(computeGroupIdAfterDelete('ungrouped', 5)).toBe('ungrouped');
  });
});

describe('BooruFavoritesPage - 分组名称验证', () => {
  it('正常名称应允许保存', () => {
    expect(shouldAllowSave('收藏夹1')).toBe(true);
  });

  it('空字符串不允许保存', () => {
    expect(shouldAllowSave('')).toBe(false);
  });

  it('纯空格不允许保存', () => {
    expect(shouldAllowSave('   ')).toBe(false);
  });

  it('含空格的名称应允许（trim 后非空）', () => {
    expect(shouldAllowSave('  好名字  ')).toBe(true);
  });

  it('Tab 字符应不允许（trim 后为空）', () => {
    expect(shouldAllowSave('\t\t')).toBe(false);
  });

  it('换行符应不允许（trim 后为空）', () => {
    expect(shouldAllowSave('\n')).toBe(false);
  });
});

describe('BooruFavoritesPage - 收藏列表排序', () => {
  it('应按 postId 倒序排列（最新在前）', () => {
    const posts = [
      { postId: 100 },
      { postId: 300 },
      { postId: 200 },
    ];
    const sorted = sortPostsByIdDesc(posts);
    expect(sorted.map(p => p.postId)).toEqual([300, 200, 100]);
  });

  it('单个元素应返回原样', () => {
    const posts = [{ postId: 1 }];
    expect(sortPostsByIdDesc(posts)).toEqual([{ postId: 1 }]);
  });

  it('空数组应返回空数组', () => {
    expect(sortPostsByIdDesc([])).toEqual([]);
  });

  it('不应修改原数组', () => {
    const posts = [{ postId: 2 }, { postId: 1 }];
    const sorted = sortPostsByIdDesc(posts);
    expect(posts[0].postId).toBe(2); // 原数组不变
    expect(sorted[0].postId).toBe(2);
  });
});

describe('BooruFavoritesPage - 评级筛选', () => {
  const posts = [
    { postId: 1, rating: 's' },
    { postId: 2, rating: 'q' },
    { postId: 3, rating: 'e' },
    { postId: 4, rating: 's' },
  ];

  it('"all" 应返回所有帖子', () => {
    expect(filterByRating(posts, 'all')).toHaveLength(4);
  });

  it('"s" 应只返回 safe 评级', () => {
    const result = filterByRating(posts, 's');
    expect(result).toHaveLength(2);
    expect(result.every(p => p.rating === 's')).toBe(true);
  });

  it('"q" 应只返回 questionable 评级', () => {
    const result = filterByRating(posts, 'q');
    expect(result).toHaveLength(1);
    expect(result[0].postId).toBe(2);
  });

  it('"e" 应只返回 explicit 评级', () => {
    const result = filterByRating(posts, 'e');
    expect(result).toHaveLength(1);
    expect(result[0].postId).toBe(3);
  });

  it('没有匹配项时应返回空数组', () => {
    const safePosts = [{ postId: 1, rating: 's' }];
    expect(filterByRating(safePosts, 'e')).toEqual([]);
  });

  it('帖子无 rating 字段时不应匹配任何筛选', () => {
    const noRating = [{ postId: 1 }];
    expect(filterByRating(noRating, 's')).toEqual([]);
  });
});

describe('BooruFavoritesPage - 编辑/新建分组状态准备', () => {
  it('编辑已有分组时，应填充已有数据', () => {
    const group = { id: 1, name: '我的收藏', color: '#ff0000' };
    const state = prepareEditState(group);
    expect(state.editingGroup).toBe(group);
    expect(state.newGroupName).toBe('我的收藏');
    expect(state.groupColor).toBe('#ff0000');
    expect(state.groupModalVisible).toBe(true);
  });

  it('编辑分组无 color 时，应使用默认颜色', () => {
    const group = { id: 2, name: '测试' };
    const state = prepareEditState(group);
    expect(state.groupColor).toBe('#1677ff');
  });

  it('新建分组时，应重置所有字段', () => {
    const state = prepareCreateState();
    expect(state.editingGroup).toBeNull();
    expect(state.newGroupName).toBe('');
    expect(state.groupModalVisible).toBe(true);
  });
});

describe('BooruFavoritesPage - 分组筛选与 API 参数的端到端逻辑', () => {
  // 模拟完整的分组筛选流程：UI 选择 → 参数转换 → SQL 条件
  // 这里联合验证 computeGroupIdParam 与 buildGroupFilter 的逻辑一致性

  function buildGroupFilter(siteId: number, groupId?: number | null) {
    let groupFilter = '';
    const params: any[] = [siteId];
    if (groupId === null) {
      groupFilter = 'AND f.groupId IS NULL';
    } else if (groupId != null) {
      groupFilter = 'AND f.groupId = ?';
      params.push(groupId);
    }
    return { groupFilter, params };
  }

  it('选择 "全部" → 不过滤 → SQL 无额外条件', () => {
    const apiParam = computeGroupIdParam('all');
    const { groupFilter } = buildGroupFilter(1, apiParam);
    expect(groupFilter).toBe('');
  });

  it('选择 "未分组" → null → SQL 加 IS NULL', () => {
    const apiParam = computeGroupIdParam('ungrouped');
    const { groupFilter } = buildGroupFilter(1, apiParam);
    expect(groupFilter).toBe('AND f.groupId IS NULL');
  });

  it('选择具体分组 → 数字 → SQL 加等值条件', () => {
    const apiParam = computeGroupIdParam(7);
    const { groupFilter, params } = buildGroupFilter(1, apiParam);
    expect(groupFilter).toBe('AND f.groupId = ?');
    expect(params).toContain(7);
  });
});
