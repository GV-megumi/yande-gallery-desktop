import { describe, it, expect } from 'vitest';

/**
 * 收藏夹分组 IPC handler 纯逻辑测试
 *
 * 参考 tests/main/ipc/handlers.test.ts 的模式，
 * 提取 handler 中可独立验证的纯逻辑进行测试。
 *
 * IPC handler 本身只做薄薄的 try/catch 包装，核心逻辑来自 booruService。
 * 这里测试：
 *   1. handler 的统一错误响应格式
 *   2. getFavorites handler 中 groupId 参数的传递逻辑
 *   3. 参数默认值处理
 */

// ========= 从 handlers.ts 提取的等价逻辑 =========

/**
 * IPC handler 统一错误包装逻辑
 * 所有收藏分组相关 handler 都使用同样的 try/catch 格式
 */
function wrapError(error: unknown): { success: false; error: string } {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

/**
 * IPC handler 统一成功包装逻辑（带数据）
 */
function wrapSuccess<T>(data: T): { success: true; data: T } {
  return { success: true, data };
}

/**
 * IPC handler 统一成功包装逻辑（无数据）
 */
function wrapSuccessNoData(): { success: true } {
  return { success: true };
}

/**
 * getFavorites handler 的参数默认值逻辑
 * 对应 handlers.ts 中 BOORU_GET_FAVORITES handler 的签名：
 *   (siteId: number, page: number = 1, limit: number = 20, groupId?: number | null)
 */
function resolveGetFavoritesParams(
  siteId: number,
  page?: number,
  limit?: number,
  groupId?: number | null
): { siteId: number; page: number; limit: number; groupId?: number | null } {
  return {
    siteId,
    page: page ?? 1,
    limit: limit ?? 20,
    groupId,
  };
}

// ========= 测试 =========

describe('收藏夹分组 handler - 统一错误响应格式', () => {
  it('Error 对象应提取 message', () => {
    const result = wrapError(new Error('数据库连接失败'));
    expect(result.success).toBe(false);
    expect(result.error).toBe('数据库连接失败');
  });

  it('字符串错误应直接使用', () => {
    const result = wrapError('未知错误');
    expect(result.success).toBe(false);
    expect(result.error).toBe('未知错误');
  });

  it('数字错误应转为字符串', () => {
    const result = wrapError(404);
    expect(result.success).toBe(false);
    expect(result.error).toBe('404');
  });

  it('null 应转为 "null"', () => {
    const result = wrapError(null);
    expect(result.success).toBe(false);
    expect(result.error).toBe('null');
  });

  it('undefined 应转为 "undefined"', () => {
    const result = wrapError(undefined);
    expect(result.success).toBe(false);
    expect(result.error).toBe('undefined');
  });

  it('对象应转为字符串表示', () => {
    const result = wrapError({ code: 'ENOENT' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('[object Object]');
  });

  it('TypeError 等内置错误应正确提取 message', () => {
    const result = wrapError(new TypeError('Cannot read properties of null'));
    expect(result.success).toBe(false);
    expect(result.error).toBe('Cannot read properties of null');
  });
});

describe('收藏夹分组 handler - 成功响应格式', () => {
  it('带数据的成功响应应包含 success 和 data', () => {
    const groups = [{ id: 1, name: '分组1' }, { id: 2, name: '分组2' }];
    const result = wrapSuccess(groups);
    expect(result.success).toBe(true);
    expect(result.data).toBe(groups);
  });

  it('空数组也是有效数据', () => {
    const result = wrapSuccess([]);
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('无数据的成功响应只包含 success', () => {
    const result = wrapSuccessNoData();
    expect(result.success).toBe(true);
    expect(result).not.toHaveProperty('data');
  });
});

describe('收藏夹分组 handler - getFavorites 参数默认值', () => {
  it('所有参数都传时应原样使用', () => {
    const params = resolveGetFavoritesParams(1, 3, 50, 5);
    expect(params).toEqual({ siteId: 1, page: 3, limit: 50, groupId: 5 });
  });

  it('page 不传时默认为 1', () => {
    const params = resolveGetFavoritesParams(1, undefined, 20);
    expect(params.page).toBe(1);
  });

  it('limit 不传时默认为 20', () => {
    const params = resolveGetFavoritesParams(1, 1, undefined);
    expect(params.limit).toBe(20);
  });

  it('groupId 不传时应为 undefined（全部）', () => {
    const params = resolveGetFavoritesParams(1);
    expect(params.groupId).toBeUndefined();
  });

  it('groupId 传 null 时应为 null（未分组）', () => {
    const params = resolveGetFavoritesParams(1, 1, 20, null);
    expect(params.groupId).toBeNull();
  });

  it('groupId 传数字时应原样保留', () => {
    const params = resolveGetFavoritesParams(1, 1, 20, 7);
    expect(params.groupId).toBe(7);
  });

  it('page 和 limit 同时不传时应使用默认值', () => {
    const params = resolveGetFavoritesParams(42);
    expect(params.page).toBe(1);
    expect(params.limit).toBe(20);
    expect(params.siteId).toBe(42);
  });
});

describe('收藏夹分组 handler - 各 handler 的参数类型验证逻辑', () => {
  /**
   * 模拟 handler 对 createFavoriteGroup 参数的处理
   * name 必传，siteId 和 color 可选
   */
  function validateCreateParams(name: any, siteId?: any, color?: any): {
    valid: boolean;
    reason?: string;
  } {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return { valid: false, reason: '分组名称不能为空' };
    }
    if (siteId !== undefined && typeof siteId !== 'number') {
      return { valid: false, reason: 'siteId 必须是数字' };
    }
    if (color !== undefined && typeof color !== 'string') {
      return { valid: false, reason: 'color 必须是字符串' };
    }
    return { valid: true };
  }

  it('有效参数应通过验证', () => {
    expect(validateCreateParams('测试', 1, '#fff').valid).toBe(true);
  });

  it('只有 name 时应通过', () => {
    expect(validateCreateParams('测试').valid).toBe(true);
  });

  it('name 为空字符串时应失败', () => {
    const result = validateCreateParams('');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('名称');
  });

  it('name 为纯空格时应失败', () => {
    expect(validateCreateParams('  ').valid).toBe(false);
  });

  it('name 不是字符串时应失败', () => {
    expect(validateCreateParams(123).valid).toBe(false);
    expect(validateCreateParams(null).valid).toBe(false);
  });

  it('siteId 为非数字类型时应失败', () => {
    expect(validateCreateParams('test', '1').valid).toBe(false);
  });

  it('color 为非字符串类型时应失败', () => {
    expect(validateCreateParams('test', 1, 123).valid).toBe(false);
  });

  /**
   * 模拟 handler 对 updateFavoriteGroup 参数的处理
   */
  function validateUpdateParams(id: any, updates: any): {
    valid: boolean;
    reason?: string;
  } {
    if (typeof id !== 'number' || !Number.isFinite(id) || id <= 0) {
      return { valid: false, reason: 'id 必须是正整数' };
    }
    if (!updates || typeof updates !== 'object') {
      return { valid: false, reason: 'updates 必须是对象' };
    }
    return { valid: true };
  }

  it('有效的更新参数应通过', () => {
    expect(validateUpdateParams(1, { name: '新名称' }).valid).toBe(true);
  });

  it('id 为 0 应失败', () => {
    expect(validateUpdateParams(0, { name: 'test' }).valid).toBe(false);
  });

  it('id 为负数应失败', () => {
    expect(validateUpdateParams(-1, { name: 'test' }).valid).toBe(false);
  });

  it('updates 为 null 应失败', () => {
    expect(validateUpdateParams(1, null).valid).toBe(false);
  });

  it('updates 为字符串应失败', () => {
    expect(validateUpdateParams(1, 'name').valid).toBe(false);
  });

  /**
   * 模拟 handler 对 moveFavoriteToGroup 参数的处理
   */
  function validateMoveParams(postId: any, groupId: any): {
    valid: boolean;
    reason?: string;
  } {
    if (typeof postId !== 'number' || !Number.isFinite(postId)) {
      return { valid: false, reason: 'postId 必须是数字' };
    }
    // groupId 可以是 number 或 null（移出分组）
    if (groupId !== null && typeof groupId !== 'number') {
      return { valid: false, reason: 'groupId 必须是数字或 null' };
    }
    return { valid: true };
  }

  it('移入分组应通过（postId + groupId）', () => {
    expect(validateMoveParams(100, 5).valid).toBe(true);
  });

  it('移出分组应通过（postId + null）', () => {
    expect(validateMoveParams(100, null).valid).toBe(true);
  });

  it('postId 非数字应失败', () => {
    expect(validateMoveParams('100', 5).valid).toBe(false);
  });

  it('groupId 为字符串应失败', () => {
    expect(validateMoveParams(100, '5').valid).toBe(false);
  });

  it('groupId 为 undefined 应失败（必须显式传 null）', () => {
    expect(validateMoveParams(100, undefined).valid).toBe(false);
  });
});
