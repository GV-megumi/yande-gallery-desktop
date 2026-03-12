import { describe, it, expect } from 'vitest';

/**
 * booruService 收藏夹分组纯逻辑测试
 *
 * 由于 getFavoriteGroups / createFavoriteGroup 等函数依赖数据库连接，
 * 这里提取其中可独立验证的纯逻辑进行测试：
 *   1. 参数验证逻辑
 *   2. groupId 参数转换逻辑
 *   3. getFavorites 中 SQL WHERE 条件的构建逻辑
 *   4. updateFavoriteGroup 中 SET 子句的动态构建逻辑
 *   5. getFavoriteGroups 中 siteId 条件分支逻辑
 */

// ========= 从 booruService.ts 提取的等价纯逻辑 =========

/**
 * getFavorites 中 groupId 过滤条件构建逻辑
 * - groupId === undefined → 不过滤（全部）
 * - groupId === null → 只取未分组
 * - groupId === number → 只取指定分组
 *
 * 返回 { groupFilter, params }
 */
function buildGroupFilter(
  siteId: number,
  groupId?: number | null
): { groupFilter: string; params: any[] } {
  let groupFilter = '';
  const params: any[] = [siteId];

  if (groupId === null) {
    // null = 未分组
    groupFilter = 'AND f.groupId IS NULL';
  } else if (groupId != null) {
    groupFilter = 'AND f.groupId = ?';
    params.push(groupId);
  }
  // groupId === undefined → 全部，不加额外条件

  return { groupFilter, params };
}

/**
 * updateFavoriteGroup 中 SET 子句动态构建逻辑
 * 只拼接传入了值的字段
 */
function buildUpdateSets(id: number, updates: { name?: string; color?: string }): {
  sets: string[];
  params: any[];
  shouldSkip: boolean;
} {
  const sets: string[] = [];
  const params: any[] = [];
  if (updates.name != null) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.color != null) { sets.push('color = ?'); params.push(updates.color); }
  if (sets.length === 0) return { sets, params, shouldSkip: true };
  params.push(id);
  return { sets, params, shouldSkip: false };
}

/**
 * getFavoriteGroups 中 siteId 条件分支逻辑
 * 提取 SQL 与 params 的选择逻辑
 */
function buildGetGroupsQuery(siteId?: number): { hasSiteFilter: boolean; params: any[] } {
  if (siteId != null) {
    return { hasSiteFilter: true, params: [siteId] };
  }
  return { hasSiteFilter: false, params: [] };
}

/**
 * createFavoriteGroup 的参数预处理逻辑
 * siteId 和 color 为 undefined 时应转为 null（SQLite 存储）
 */
function prepareCreateParams(name: string, siteId?: number, color?: string): any[] {
  return [name, siteId ?? null, color ?? null];
}

// ========= 测试 =========

describe('booruService 收藏夹分组 - groupId 过滤条件构建', () => {
  it('groupId 为 undefined 时，应不添加额外过滤（全部）', () => {
    const { groupFilter, params } = buildGroupFilter(1, undefined);
    expect(groupFilter).toBe('');
    expect(params).toEqual([1]);
  });

  it('groupId 为 null 时，应添加 IS NULL 条件（未分组）', () => {
    const { groupFilter, params } = buildGroupFilter(1, null);
    expect(groupFilter).toBe('AND f.groupId IS NULL');
    expect(params).toEqual([1]);
  });

  it('groupId 为正整数时，应添加等值条件', () => {
    const { groupFilter, params } = buildGroupFilter(1, 5);
    expect(groupFilter).toBe('AND f.groupId = ?');
    expect(params).toEqual([1, 5]);
  });

  it('groupId 为 0 时，应视为有效分组 ID', () => {
    // 0 是 falsy 但在 `groupId != null` 判断中不会被过滤
    const { groupFilter, params } = buildGroupFilter(1, 0);
    expect(groupFilter).toBe('AND f.groupId = ?');
    expect(params).toEqual([1, 0]);
  });

  it('siteId 总是放在 params 的第一个位置', () => {
    const { params: p1 } = buildGroupFilter(42, undefined);
    expect(p1[0]).toBe(42);

    const { params: p2 } = buildGroupFilter(42, null);
    expect(p2[0]).toBe(42);

    const { params: p3 } = buildGroupFilter(42, 7);
    expect(p3[0]).toBe(42);
  });
});

describe('booruService 收藏夹分组 - updateFavoriteGroup SET 子句构建', () => {
  it('只传 name 时，应只生成 name 的 SET', () => {
    const result = buildUpdateSets(1, { name: '新名称' });
    expect(result.shouldSkip).toBe(false);
    expect(result.sets).toEqual(['name = ?']);
    expect(result.params).toEqual(['新名称', 1]);
  });

  it('只传 color 时，应只生成 color 的 SET', () => {
    const result = buildUpdateSets(1, { color: '#ff0000' });
    expect(result.shouldSkip).toBe(false);
    expect(result.sets).toEqual(['color = ?']);
    expect(result.params).toEqual(['#ff0000', 1]);
  });

  it('同时传 name 和 color 时，应生成两个 SET', () => {
    const result = buildUpdateSets(1, { name: '新名称', color: '#ff0000' });
    expect(result.shouldSkip).toBe(false);
    expect(result.sets).toEqual(['name = ?', 'color = ?']);
    expect(result.params).toEqual(['新名称', '#ff0000', 1]);
  });

  it('什么都不传时，应标记为 shouldSkip', () => {
    const result = buildUpdateSets(1, {});
    expect(result.shouldSkip).toBe(true);
    expect(result.sets).toEqual([]);
    expect(result.params).toEqual([]);
  });

  it('传入 undefined 的字段应被忽略（不会拼入 SET）', () => {
    const result = buildUpdateSets(1, { name: undefined, color: undefined });
    expect(result.shouldSkip).toBe(true);
  });

  it('id 始终是 params 的最后一个元素', () => {
    const result = buildUpdateSets(99, { name: 'test', color: '#abc' });
    expect(result.params[result.params.length - 1]).toBe(99);
  });

  it('拼接后的 SET 子句可直接用于 SQL', () => {
    const result = buildUpdateSets(1, { name: '测试', color: '#000' });
    const sql = `UPDATE booru_favorite_groups SET ${result.sets.join(', ')} WHERE id = ?`;
    expect(sql).toBe('UPDATE booru_favorite_groups SET name = ?, color = ? WHERE id = ?');
  });
});

describe('booruService 收藏夹分组 - getFavoriteGroups 条件分支', () => {
  it('传入 siteId 时，应启用站点过滤', () => {
    const result = buildGetGroupsQuery(1);
    expect(result.hasSiteFilter).toBe(true);
    expect(result.params).toEqual([1]);
  });

  it('不传 siteId 时，应不过滤', () => {
    const result = buildGetGroupsQuery(undefined);
    expect(result.hasSiteFilter).toBe(false);
    expect(result.params).toEqual([]);
  });

  it('siteId 为 0 时，应视为有效值并启用过滤', () => {
    // 0 != null → true
    const result = buildGetGroupsQuery(0);
    expect(result.hasSiteFilter).toBe(true);
    expect(result.params).toEqual([0]);
  });
});

describe('booruService 收藏夹分组 - createFavoriteGroup 参数预处理', () => {
  it('name 应原样传递', () => {
    const params = prepareCreateParams('测试分组');
    expect(params[0]).toBe('测试分组');
  });

  it('siteId 为 undefined 时应转为 null', () => {
    const params = prepareCreateParams('test', undefined);
    expect(params[1]).toBeNull();
  });

  it('siteId 有值时应保留', () => {
    const params = prepareCreateParams('test', 3);
    expect(params[1]).toBe(3);
  });

  it('color 为 undefined 时应转为 null', () => {
    const params = prepareCreateParams('test', 1, undefined);
    expect(params[2]).toBeNull();
  });

  it('color 有值时应保留', () => {
    const params = prepareCreateParams('test', 1, '#1677ff');
    expect(params[2]).toBe('#1677ff');
  });

  it('所有可选参数为 undefined 时，siteId 和 color 均为 null', () => {
    const params = prepareCreateParams('name');
    expect(params).toEqual(['name', null, null]);
  });
});

describe('booruService 收藏夹分组 - 参数验证逻辑', () => {
  // 前端 handleSaveGroup 中的空名称校验
  function isValidGroupName(name: string): boolean {
    return name.trim().length > 0;
  }

  it('正常名称应通过校验', () => {
    expect(isValidGroupName('我的收藏')).toBe(true);
  });

  it('空字符串不应通过校验', () => {
    expect(isValidGroupName('')).toBe(false);
  });

  it('纯空格不应通过校验', () => {
    expect(isValidGroupName('   ')).toBe(false);
  });

  it('前后有空格的名称应通过校验（trim 后非空）', () => {
    expect(isValidGroupName('  有效名称  ')).toBe(true);
  });

  it('单字符名称应通过校验', () => {
    expect(isValidGroupName('A')).toBe(true);
  });

  // deleteFavoriteGroup 的 id 验证
  function isValidGroupId(id: any): boolean {
    return typeof id === 'number' && Number.isFinite(id) && id > 0;
  }

  it('正整数 ID 应有效', () => {
    expect(isValidGroupId(1)).toBe(true);
    expect(isValidGroupId(999)).toBe(true);
  });

  it('0 不应作为有效分组 ID', () => {
    expect(isValidGroupId(0)).toBe(false);
  });

  it('负数不应作为有效分组 ID', () => {
    expect(isValidGroupId(-1)).toBe(false);
  });

  it('NaN 不应作为有效分组 ID', () => {
    expect(isValidGroupId(NaN)).toBe(false);
  });

  it('Infinity 不应作为有效分组 ID', () => {
    expect(isValidGroupId(Infinity)).toBe(false);
  });

  it('字符串不应作为有效分组 ID', () => {
    expect(isValidGroupId('1')).toBe(false);
  });

  it('null/undefined 不应作为有效分组 ID', () => {
    expect(isValidGroupId(null)).toBe(false);
    expect(isValidGroupId(undefined)).toBe(false);
  });
});
