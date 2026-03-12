import { describe, it, expect } from 'vitest';

/**
 * booruService 保存的搜索 (Saved Searches) CRUD 纯逻辑测试
 *
 * 由于 booruService 中的 CRUD 函数直接依赖数据库连接，
 * 这里提取其核心的验证、过滤、SQL 构建等纯逻辑进行测试。
 * 不涉及数据库或 Electron 环境。
 */

// ========= 等价实现：搜索名称和查询词验证 =========

/**
 * 验证保存搜索的表单输入
 * 对应 BooruSavedSearchesPage.handleSave 和 addSavedSearch 中的验证逻辑
 * @param name 搜索名称
 * @param query 搜索查询词
 * @returns 错误信息，null 表示验证通过
 */
function validateSavedSearchInput(name: string, query: string): string | null {
  if (!name.trim()) return '名称不能为空';
  if (!query.trim()) return '查询词不能为空';
  return null;
}

/**
 * 清理保存搜索的输入值（trim 处理）
 * 对应 addSavedSearch 插入前的 trim 逻辑
 */
function sanitizeSavedSearchInput(name: string, query: string): { name: string; query: string } {
  return {
    name: name.trim(),
    query: query.trim(),
  };
}

// ========= 等价实现：siteId 过滤逻辑 =========

/**
 * 判断是否需要按 siteId 过滤
 * 对应 getSavedSearches 中的 siteId != null 检查
 * siteId 为 null/undefined 表示"全局搜索"，不过滤
 */
function shouldFilterBySiteId(siteId?: number | null): boolean {
  return siteId != null;
}

/**
 * 根据 siteId 过滤保存的搜索列表
 * 等价于 getSavedSearches 的 SQL WHERE 逻辑
 */
function filterSearchesBySiteId(
  searches: Array<{ id: number; siteId: number | null; name: string; query: string }>,
  siteId?: number | null
): Array<{ id: number; siteId: number | null; name: string; query: string }> {
  if (!shouldFilterBySiteId(siteId)) {
    return searches;
  }
  return searches.filter(s => s.siteId === siteId);
}

// ========= 等价实现：updateSavedSearch 的 SET 构建逻辑 =========

/**
 * 构建 UPDATE 语句的 SET 子句和参数
 * 对应 updateSavedSearch 中动态构建 SQL 的逻辑
 */
function buildUpdateSets(updates: { name?: string; query?: string }): {
  sets: string[];
  params: any[];
  shouldUpdate: boolean;
} {
  const sets: string[] = [];
  const params: any[] = [];
  if (updates.name != null) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.query != null) { sets.push('query = ?'); params.push(updates.query); }
  return { sets, params, shouldUpdate: sets.length > 0 };
}

// ========= 测试 =========

describe('savedSearches - 输入验证', () => {
  describe('validateSavedSearchInput', () => {
    it('名称和查询词都有效时应返回 null（验证通过）', () => {
      expect(validateSavedSearchInput('蓝色系角色', 'blue_eyes')).toBeNull();
    });

    it('名称为空字符串时应返回错误', () => {
      expect(validateSavedSearchInput('', 'blue_eyes')).toBe('名称不能为空');
    });

    it('名称只有空格时应返回错误（trim 后为空）', () => {
      expect(validateSavedSearchInput('   ', 'blue_eyes')).toBe('名称不能为空');
    });

    it('查询词为空字符串时应返回错误', () => {
      expect(validateSavedSearchInput('测试搜索', '')).toBe('查询词不能为空');
    });

    it('查询词只有空格时应返回错误（trim 后为空）', () => {
      expect(validateSavedSearchInput('测试搜索', '   ')).toBe('查询词不能为空');
    });

    it('名称和查询词都为空时应返回名称的错误（优先校验名称）', () => {
      const result = validateSavedSearchInput('', '');
      expect(result).toBe('名称不能为空');
    });

    it('名称含前后空格但有内容时应验证通过', () => {
      expect(validateSavedSearchInput('  蓝色系  ', 'blue_eyes')).toBeNull();
    });

    it('查询词含前后空格但有内容时应验证通过', () => {
      expect(validateSavedSearchInput('搜索', '  blue_eyes  ')).toBeNull();
    });

    it('支持包含 meta-tag 的复杂查询词', () => {
      expect(validateSavedSearchInput('高分蓝眼', 'blue_eyes rating:s score:>50')).toBeNull();
    });

    it('支持中文名称', () => {
      expect(validateSavedSearchInput('我的收藏搜索', 'girl solo')).toBeNull();
    });
  });
});

describe('savedSearches - 输入清理（trim）', () => {
  describe('sanitizeSavedSearchInput', () => {
    it('应去除名称和查询词的前后空格', () => {
      const result = sanitizeSavedSearchInput('  蓝色系  ', '  blue_eyes  ');
      expect(result.name).toBe('蓝色系');
      expect(result.query).toBe('blue_eyes');
    });

    it('无空格时应保持不变', () => {
      const result = sanitizeSavedSearchInput('测试', 'tag1 tag2');
      expect(result.name).toBe('测试');
      expect(result.query).toBe('tag1 tag2');
    });

    it('查询词中间的空格应保留（多标签用空格分隔）', () => {
      const result = sanitizeSavedSearchInput('搜索', '  blue_eyes   long_hair  ');
      // trim 只去除前后空格，中间保留
      expect(result.query).toBe('blue_eyes   long_hair');
    });

    it('应保留查询词中的 meta-tag 格式', () => {
      const result = sanitizeSavedSearchInput('高分搜索', ' rating:s score:>50 ');
      expect(result.query).toBe('rating:s score:>50');
    });
  });
});

describe('savedSearches - siteId 过滤逻辑', () => {
  describe('shouldFilterBySiteId', () => {
    it('siteId 为 null 时不应过滤（全局搜索）', () => {
      expect(shouldFilterBySiteId(null)).toBe(false);
    });

    it('siteId 为 undefined 时不应过滤（全局搜索）', () => {
      expect(shouldFilterBySiteId(undefined)).toBe(false);
    });

    it('siteId 为有效数字时应过滤', () => {
      expect(shouldFilterBySiteId(1)).toBe(true);
    });

    it('siteId 为 0 时应过滤（0 是有效 ID）', () => {
      // 注意：0 != null 为 true，所以 siteId=0 会触发过滤
      expect(shouldFilterBySiteId(0)).toBe(true);
    });

    it('siteId 为负数时应过滤（由调用方保证合法性）', () => {
      expect(shouldFilterBySiteId(-1)).toBe(true);
    });
  });

  describe('filterSearchesBySiteId', () => {
    const mockSearches = [
      { id: 1, siteId: 1, name: '搜索1', query: 'blue_eyes' },
      { id: 2, siteId: 2, name: '搜索2', query: 'red_hair' },
      { id: 3, siteId: 1, name: '搜索3', query: 'long_hair' },
      { id: 4, siteId: null, name: '全局搜索', query: 'solo' },
    ];

    it('siteId 为 null 时应返回所有搜索', () => {
      const result = filterSearchesBySiteId(mockSearches, null);
      expect(result).toHaveLength(4);
    });

    it('siteId 为 undefined 时应返回所有搜索', () => {
      const result = filterSearchesBySiteId(mockSearches, undefined);
      expect(result).toHaveLength(4);
    });

    it('siteId 为 1 时应只返回 siteId=1 的搜索', () => {
      const result = filterSearchesBySiteId(mockSearches, 1);
      expect(result).toHaveLength(2);
      expect(result.every(s => s.siteId === 1)).toBe(true);
    });

    it('siteId 为 2 时应只返回 siteId=2 的搜索', () => {
      const result = filterSearchesBySiteId(mockSearches, 2);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('搜索2');
    });

    it('siteId 不匹配任何搜索时应返回空数组', () => {
      const result = filterSearchesBySiteId(mockSearches, 999);
      expect(result).toHaveLength(0);
    });

    it('空搜索列表应返回空数组', () => {
      const result = filterSearchesBySiteId([], 1);
      expect(result).toHaveLength(0);
    });

    it('按 siteId 过滤不应返回 siteId 为 null 的全局搜索', () => {
      // 当指定 siteId=1 时，siteId=null 的全局搜索不包含在内
      const result = filterSearchesBySiteId(mockSearches, 1);
      expect(result.some(s => s.siteId === null)).toBe(false);
    });
  });
});

describe('savedSearches - UPDATE 语句构建逻辑', () => {
  describe('buildUpdateSets', () => {
    it('只更新 name 时应生成单个 SET 子句', () => {
      const result = buildUpdateSets({ name: '新名称' });
      expect(result.sets).toEqual(['name = ?']);
      expect(result.params).toEqual(['新名称']);
      expect(result.shouldUpdate).toBe(true);
    });

    it('只更新 query 时应生成单个 SET 子句', () => {
      const result = buildUpdateSets({ query: 'new_query' });
      expect(result.sets).toEqual(['query = ?']);
      expect(result.params).toEqual(['new_query']);
      expect(result.shouldUpdate).toBe(true);
    });

    it('同时更新 name 和 query 时应生成两个 SET 子句', () => {
      const result = buildUpdateSets({ name: '新名称', query: 'new_query' });
      expect(result.sets).toEqual(['name = ?', 'query = ?']);
      expect(result.params).toEqual(['新名称', 'new_query']);
      expect(result.shouldUpdate).toBe(true);
    });

    it('空 updates 对象应不生成 SET 子句', () => {
      const result = buildUpdateSets({});
      expect(result.sets).toEqual([]);
      expect(result.params).toEqual([]);
      expect(result.shouldUpdate).toBe(false);
    });

    it('name 为 undefined 时应不更新 name', () => {
      const result = buildUpdateSets({ name: undefined, query: 'test' });
      expect(result.sets).toEqual(['query = ?']);
      expect(result.params).toEqual(['test']);
    });

    it('query 为 undefined 时应不更新 query', () => {
      const result = buildUpdateSets({ name: 'test', query: undefined });
      expect(result.sets).toEqual(['name = ?']);
      expect(result.params).toEqual(['test']);
    });

    it('name 为空字符串时仍应生成 SET 子句（由调用方验证）', () => {
      // updateSavedSearch 只检查 != null，不检查空字符串
      const result = buildUpdateSets({ name: '' });
      expect(result.sets).toEqual(['name = ?']);
      expect(result.params).toEqual(['']);
      expect(result.shouldUpdate).toBe(true);
    });

    it('params 中 name 应在 query 之前（与 SQL SET 顺序一致）', () => {
      const result = buildUpdateSets({ name: 'a', query: 'b' });
      expect(result.params[0]).toBe('a');
      expect(result.params[1]).toBe('b');
    });
  });
});

describe('savedSearches - 查询词格式', () => {
  /**
   * 解析保存的搜索查询词，提取标签和 meta-tag
   * 用于在 UI 中高亮显示不同类型的搜索条件
   */
  function parseSearchQuery(query: string): {
    tags: string[];
    metaTags: string[];
  } {
    const parts = query.trim().split(/\s+/).filter(Boolean);
    const tags: string[] = [];
    const metaTags: string[] = [];
    for (const part of parts) {
      if (part.includes(':')) {
        metaTags.push(part);
      } else {
        tags.push(part);
      }
    }
    return { tags, metaTags };
  }

  it('应正确分离普通标签和 meta-tag', () => {
    const result = parseSearchQuery('blue_eyes rating:s score:>50');
    expect(result.tags).toEqual(['blue_eyes']);
    expect(result.metaTags).toEqual(['rating:s', 'score:>50']);
  });

  it('只有普通标签时 metaTags 应为空', () => {
    const result = parseSearchQuery('girl solo long_hair');
    expect(result.tags).toEqual(['girl', 'solo', 'long_hair']);
    expect(result.metaTags).toEqual([]);
  });

  it('只有 meta-tag 时 tags 应为空', () => {
    const result = parseSearchQuery('rating:s order:score');
    expect(result.tags).toEqual([]);
    expect(result.metaTags).toEqual(['rating:s', 'order:score']);
  });

  it('空查询词应返回空数组', () => {
    const result = parseSearchQuery('');
    expect(result.tags).toEqual([]);
    expect(result.metaTags).toEqual([]);
  });

  it('复杂组合查询应正确解析', () => {
    const result = parseSearchQuery('blue_eyes blonde_hair rating:s score:>100 order:id_desc');
    expect(result.tags).toEqual(['blue_eyes', 'blonde_hair']);
    expect(result.metaTags).toEqual(['rating:s', 'score:>100', 'order:id_desc']);
  });

  it('多余空格应被正确处理', () => {
    const result = parseSearchQuery('  blue_eyes   rating:s  ');
    expect(result.tags).toEqual(['blue_eyes']);
    expect(result.metaTags).toEqual(['rating:s']);
  });
});
