import { describe, it, expect } from 'vitest';

/**
 * 保存的搜索 IPC handler 纯逻辑测试
 *
 * 参考 tests/main/ipc/handlers.test.ts 的模式，
 * 提取 IPC handler 中的参数处理和响应构建逻辑进行测试。
 * 不涉及 Electron IPC、数据库连接。
 */

// ========= 等价实现：IPC 响应构建 =========

/**
 * 构建成功响应
 * 对应 handler 中 return { success: true, data: ... }
 */
function buildSuccessResponse<T>(data?: T): { success: true; data?: T } {
  return data !== undefined ? { success: true, data } : { success: true } as any;
}

/**
 * 构建错误响应
 * 对应 handler 中 catch 块的错误处理逻辑
 */
function buildErrorResponse(error: unknown): { success: false; error: string } {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

// ========= 等价实现：addSavedSearch 参数处理 =========

/**
 * 验证 addSavedSearch 的参数类型
 * siteId 可以是 number（特定站点）或 null（全局）
 */
function validateAddParams(
  siteId: number | null,
  name: string,
  query: string
): { valid: boolean; error?: string } {
  if (typeof name !== 'string') return { valid: false, error: 'name 必须是字符串' };
  if (typeof query !== 'string') return { valid: false, error: 'query 必须是字符串' };
  if (siteId !== null && typeof siteId !== 'number') {
    return { valid: false, error: 'siteId 必须是 number 或 null' };
  }
  return { valid: true };
}

// ========= 等价实现：updateSavedSearch 的 updates 结构处理 =========

/**
 * 验证 updateSavedSearch 的 updates 对象
 * 至少需要包含 name 或 query 中的一个
 */
function validateUpdateParams(
  id: number,
  updates: { name?: string; query?: string }
): { valid: boolean; error?: string } {
  if (typeof id !== 'number' || id <= 0) {
    return { valid: false, error: 'id 必须是正整数' };
  }
  if (!updates || typeof updates !== 'object') {
    return { valid: false, error: 'updates 必须是对象' };
  }
  if (updates.name === undefined && updates.query === undefined) {
    return { valid: false, error: 'updates 至少需要包含 name 或 query' };
  }
  if (updates.name !== undefined && typeof updates.name !== 'string') {
    return { valid: false, error: 'name 必须是字符串' };
  }
  if (updates.query !== undefined && typeof updates.query !== 'string') {
    return { valid: false, error: 'query 必须是字符串' };
  }
  return { valid: true };
}

// ========= 等价实现：getSavedSearches 参数处理 =========

/**
 * 规范化 getSavedSearches 的 siteId 参数
 * handler 接收 siteId?: number，undefined 表示获取全部
 */
function normalizeSiteIdParam(siteId?: number | null): number | undefined {
  if (siteId == null) return undefined;
  return siteId;
}

// ========= 测试 =========

describe('savedSearchesHandler - 响应构建', () => {
  describe('buildSuccessResponse', () => {
    it('带数据的成功响应应包含 success 和 data', () => {
      const resp = buildSuccessResponse({ id: 1 });
      expect(resp.success).toBe(true);
      expect(resp.data).toEqual({ id: 1 });
    });

    it('getSavedSearches 返回数组数据', () => {
      const data = [
        { id: 1, name: '搜索1', query: 'blue_eyes', siteId: 1 },
        { id: 2, name: '搜索2', query: 'red_hair', siteId: null },
      ];
      const resp = buildSuccessResponse(data);
      expect(resp.success).toBe(true);
      expect(resp.data).toHaveLength(2);
    });

    it('addSavedSearch 返回新插入的 ID', () => {
      const resp = buildSuccessResponse(42);
      expect(resp.success).toBe(true);
      expect(resp.data).toBe(42);
    });

    it('updateSavedSearch 和 deleteSavedSearch 无 data 字段', () => {
      const resp = buildSuccessResponse();
      expect(resp.success).toBe(true);
    });
  });

  describe('buildErrorResponse', () => {
    it('Error 实例应提取 message', () => {
      const resp = buildErrorResponse(new Error('数据库连接失败'));
      expect(resp.success).toBe(false);
      expect(resp.error).toBe('数据库连接失败');
    });

    it('字符串错误应直接使用', () => {
      const resp = buildErrorResponse('操作超时');
      expect(resp.success).toBe(false);
      expect(resp.error).toBe('操作超时');
    });

    it('数字错误应转为字符串', () => {
      const resp = buildErrorResponse(404);
      expect(resp.success).toBe(false);
      expect(resp.error).toBe('404');
    });

    it('null 错误应转为字符串 "null"', () => {
      const resp = buildErrorResponse(null);
      expect(resp.success).toBe(false);
      expect(resp.error).toBe('null');
    });

    it('undefined 错误应转为字符串 "undefined"', () => {
      const resp = buildErrorResponse(undefined);
      expect(resp.success).toBe(false);
      expect(resp.error).toBe('undefined');
    });

    it('对象错误应转为字符串', () => {
      const resp = buildErrorResponse({ code: 'ERR_DB' });
      expect(resp.success).toBe(false);
      expect(resp.error).toBe('[object Object]');
    });
  });
});

describe('savedSearchesHandler - addSavedSearch 参数处理', () => {
  describe('validateAddParams', () => {
    it('siteId 为有效数字时应验证通过', () => {
      const result = validateAddParams(1, '测试搜索', 'blue_eyes');
      expect(result.valid).toBe(true);
    });

    it('siteId 为 null 时应验证通过（全局搜索）', () => {
      const result = validateAddParams(null, '全局搜索', 'solo');
      expect(result.valid).toBe(true);
    });

    it('siteId 为 0 时应验证通过（0 是有效数字）', () => {
      const result = validateAddParams(0, '搜索', 'query');
      expect(result.valid).toBe(true);
    });

    it('name 非字符串时应验证失败', () => {
      const result = validateAddParams(1, 123 as any, 'query');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('name');
    });

    it('query 非字符串时应验证失败', () => {
      const result = validateAddParams(1, 'name', null as any);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('query');
    });

    it('siteId 为字符串时应验证失败', () => {
      const result = validateAddParams('1' as any, 'name', 'query');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('siteId');
    });

    it('siteId 为负数时应验证通过（负数是有效 number 类型）', () => {
      // 类型检查不做值域验证，由数据库层处理
      const result = validateAddParams(-1, 'name', 'query');
      expect(result.valid).toBe(true);
    });
  });
});

describe('savedSearchesHandler - updateSavedSearch 参数处理', () => {
  describe('validateUpdateParams', () => {
    it('只更新 name 时应验证通过', () => {
      const result = validateUpdateParams(1, { name: '新名称' });
      expect(result.valid).toBe(true);
    });

    it('只更新 query 时应验证通过', () => {
      const result = validateUpdateParams(1, { query: 'new_query' });
      expect(result.valid).toBe(true);
    });

    it('同时更新 name 和 query 时应验证通过', () => {
      const result = validateUpdateParams(1, { name: '新名称', query: 'new_query' });
      expect(result.valid).toBe(true);
    });

    it('空 updates 对象应验证失败', () => {
      const result = validateUpdateParams(1, {});
      expect(result.valid).toBe(false);
      expect(result.error).toContain('至少');
    });

    it('id 为 0 时应验证失败', () => {
      const result = validateUpdateParams(0, { name: 'test' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('id');
    });

    it('id 为负数时应验证失败', () => {
      const result = validateUpdateParams(-1, { name: 'test' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('id');
    });

    it('name 为非字符串时应验证失败', () => {
      const result = validateUpdateParams(1, { name: 123 as any });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('name');
    });

    it('query 为非字符串时应验证失败', () => {
      const result = validateUpdateParams(1, { query: true as any });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('query');
    });

    it('updates 为 null 时应验证失败', () => {
      const result = validateUpdateParams(1, null as any);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('updates');
    });

    it('name 为空字符串时类型检查仍通过（内容验证由上层负责）', () => {
      const result = validateUpdateParams(1, { name: '' });
      expect(result.valid).toBe(true);
    });
  });
});

describe('savedSearchesHandler - getSavedSearches 参数规范化', () => {
  describe('normalizeSiteIdParam', () => {
    it('undefined 应规范化为 undefined（获取全部）', () => {
      expect(normalizeSiteIdParam(undefined)).toBeUndefined();
    });

    it('null 应规范化为 undefined（获取全部）', () => {
      expect(normalizeSiteIdParam(null)).toBeUndefined();
    });

    it('有效数字应保持不变', () => {
      expect(normalizeSiteIdParam(1)).toBe(1);
      expect(normalizeSiteIdParam(42)).toBe(42);
    });

    it('0 应保持为 0', () => {
      expect(normalizeSiteIdParam(0)).toBe(0);
    });
  });
});

describe('savedSearchesHandler - 错误场景模拟', () => {
  /**
   * 模拟 handler 的 try-catch 逻辑
   * 成功时返回 success 响应，失败时返回 error 响应
   */
  async function simulateHandler<T>(
    operation: () => Promise<T>,
    wrapData: boolean = true
  ): Promise<{ success: boolean; data?: T; error?: string }> {
    try {
      const result = await operation();
      return wrapData ? { success: true, data: result } : { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  it('操作成功时应返回 success: true 和数据', async () => {
    const resp = await simulateHandler(async () => [{ id: 1, name: 'test' }]);
    expect(resp.success).toBe(true);
    expect(resp.data).toHaveLength(1);
  });

  it('操作抛出 Error 时应返回 success: false 和错误消息', async () => {
    const resp = await simulateHandler(async () => {
      throw new Error('SQLITE_BUSY');
    });
    expect(resp.success).toBe(false);
    expect(resp.error).toBe('SQLITE_BUSY');
  });

  it('操作抛出字符串时应返回 success: false 和字符串', async () => {
    const resp = await simulateHandler(async () => {
      throw 'connection timeout';
    });
    expect(resp.success).toBe(false);
    expect(resp.error).toBe('connection timeout');
  });

  it('不包装数据时应只返回 success: true', async () => {
    const resp = await simulateHandler(async () => undefined, false);
    expect(resp.success).toBe(true);
    expect(resp.data).toBeUndefined();
  });
});
