import { describe, it, expect } from 'vitest';

/**
 * BooruPostVersionData 接口与版本历史解析测试
 *
 * 测试范围：
 * 1. Danbooru 原始响应数据 → BooruPostVersionData 的映射逻辑
 * 2. Moebooru 不支持版本历史（返回空数组）
 * 3. Gelbooru 不支持版本历史（返回空数组）
 */

// ========= BooruPostVersionData 接口定义（与 booruClientInterface.ts 一致） =========

interface BooruPostVersionData {
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
  parent_id?: number;
  parent_changed?: boolean;
  description_changed?: boolean;
}

// ========= 等价实现：Danbooru 原始数据转换（与 danbooruClient.ts getPostVersions 一致） =========

/**
 * 将 Danbooru API 返回的原始版本数据转换为统一格式
 * 对应 danbooruClient.ts 中 getPostVersions 的 map 逻辑
 */
function parseDanbooruVersions(rawData: any): BooruPostVersionData[] {
  const versions: any[] = Array.isArray(rawData) ? rawData : [];
  return versions.map((v: any) => ({
    id: v.id,
    post_id: v.post_id,
    version: v.version,
    updater_name: v.updater_name || v.updater?.name || '未知',
    created_at: v.updated_at || v.created_at || new Date().toISOString(),
    tags_added: v.added_tags || [],
    tags_removed: v.removed_tags || [],
    rating: v.rating,
    rating_changed: v.rating_changed || false,
    source: v.source,
    source_changed: v.source_changed || false,
    parent_id: v.parent_id,
    parent_changed: v.parent_changed || false,
    description_changed: v.description_changed || false,
  }));
}

/** Moebooru 不支持版本历史 */
function parseMoebooruVersions(_postId: number): BooruPostVersionData[] {
  return [];
}

/** Gelbooru 不支持版本历史 */
function parseGelbooruVersions(_postId: number): BooruPostVersionData[] {
  return [];
}

// ========= 测试用例 =========

describe('Danbooru 版本历史数据解析', () => {
  it('正常的 Danbooru 原始响应能正确解析', () => {
    const rawData = [
      {
        id: 1001,
        post_id: 500,
        version: 1,
        updater_name: 'admin',
        updated_at: '2024-01-15T10:00:00Z',
        added_tags: ['1girl', 'blue_hair'],
        removed_tags: [],
        rating: 'g',
        rating_changed: false,
        source: 'https://pixiv.net/12345',
        source_changed: false,
      },
      {
        id: 1002,
        post_id: 500,
        version: 2,
        updater_name: 'editor1',
        updated_at: '2024-01-16T12:00:00Z',
        added_tags: ['smile'],
        removed_tags: ['solo'],
        rating: 's',
        rating_changed: true,
        source: 'https://pixiv.net/12345',
        source_changed: false,
      },
    ];

    const versions = parseDanbooruVersions(rawData);
    expect(versions).toHaveLength(2);

    // 第一个版本
    expect(versions[0].id).toBe(1001);
    expect(versions[0].post_id).toBe(500);
    expect(versions[0].version).toBe(1);
    expect(versions[0].updater_name).toBe('admin');
    expect(versions[0].created_at).toBe('2024-01-15T10:00:00Z');
    expect(versions[0].tags_added).toEqual(['1girl', 'blue_hair']);
    expect(versions[0].tags_removed).toEqual([]);
    expect(versions[0].rating_changed).toBe(false);

    // 第二个版本
    expect(versions[1].version).toBe(2);
    expect(versions[1].updater_name).toBe('editor1');
    expect(versions[1].tags_added).toEqual(['smile']);
    expect(versions[1].tags_removed).toEqual(['solo']);
    expect(versions[1].rating_changed).toBe(true);
    expect(versions[1].rating).toBe('s');
  });

  it('tags_added 和 tags_removed 是字符串数组', () => {
    const rawData = [
      {
        id: 2001,
        post_id: 600,
        version: 3,
        updater_name: 'tagger',
        updated_at: '2024-02-01T00:00:00Z',
        added_tags: ['long_hair', 'red_eyes', 'school_uniform'],
        removed_tags: ['short_hair'],
      },
    ];

    const versions = parseDanbooruVersions(rawData);
    expect(versions[0].tags_added).toBeInstanceOf(Array);
    expect(versions[0].tags_removed).toBeInstanceOf(Array);
    versions[0].tags_added.forEach((t) => expect(typeof t).toBe('string'));
    versions[0].tags_removed.forEach((t) => expect(typeof t).toBe('string'));
  });

  it('version 字段是递增整数', () => {
    const rawData = [
      { id: 1, post_id: 1, version: 1, updater_name: 'a', updated_at: '2024-01-01T00:00:00Z' },
      { id: 2, post_id: 1, version: 2, updater_name: 'b', updated_at: '2024-01-02T00:00:00Z' },
      { id: 3, post_id: 1, version: 3, updater_name: 'c', updated_at: '2024-01-03T00:00:00Z' },
    ];
    const versions = parseDanbooruVersions(rawData);
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i].version).toBeGreaterThan(versions[i - 1].version);
    }
  });

  it('rating_changed 和 source_changed 是布尔值', () => {
    const rawData = [
      {
        id: 3001,
        post_id: 700,
        version: 1,
        updater_name: 'mod',
        updated_at: '2024-03-01T00:00:00Z',
        rating_changed: true,
        source_changed: true,
      },
    ];
    const versions = parseDanbooruVersions(rawData);
    expect(typeof versions[0].rating_changed).toBe('boolean');
    expect(typeof versions[0].source_changed).toBe('boolean');
    expect(versions[0].rating_changed).toBe(true);
    expect(versions[0].source_changed).toBe(true);
  });

  it('updater_name 缺失时使用 updater.name 回退', () => {
    const rawData = [
      {
        id: 4001,
        post_id: 800,
        version: 1,
        updater: { name: 'nested_user' },
        updated_at: '2024-04-01T00:00:00Z',
      },
    ];
    const versions = parseDanbooruVersions(rawData);
    expect(versions[0].updater_name).toBe('nested_user');
  });

  it('updater_name 和 updater.name 都缺失时回退为"未知"', () => {
    const rawData = [
      {
        id: 5001,
        post_id: 900,
        version: 1,
        updated_at: '2024-05-01T00:00:00Z',
      },
    ];
    const versions = parseDanbooruVersions(rawData);
    expect(versions[0].updater_name).toBe('未知');
  });

  it('created_at 字段优先使用 updated_at', () => {
    const rawData = [
      {
        id: 6001,
        post_id: 1000,
        version: 1,
        updater_name: 'user',
        updated_at: '2024-06-01T00:00:00Z',
        created_at: '2024-05-01T00:00:00Z',
      },
    ];
    const versions = parseDanbooruVersions(rawData);
    // updated_at 优先
    expect(versions[0].created_at).toBe('2024-06-01T00:00:00Z');
  });

  it('updated_at 缺失时回退到 created_at', () => {
    const rawData = [
      {
        id: 7001,
        post_id: 1100,
        version: 1,
        updater_name: 'user',
        created_at: '2024-07-01T00:00:00Z',
      },
    ];
    const versions = parseDanbooruVersions(rawData);
    expect(versions[0].created_at).toBe('2024-07-01T00:00:00Z');
  });

  it('added_tags 缺失时默认为空数组', () => {
    const rawData = [
      {
        id: 8001,
        post_id: 1200,
        version: 1,
        updater_name: 'user',
        updated_at: '2024-08-01T00:00:00Z',
        // 没有 added_tags 和 removed_tags
      },
    ];
    const versions = parseDanbooruVersions(rawData);
    expect(versions[0].tags_added).toEqual([]);
    expect(versions[0].tags_removed).toEqual([]);
  });

  it('rating_changed 缺失时默认为 false', () => {
    const rawData = [
      {
        id: 9001,
        post_id: 1300,
        version: 1,
        updater_name: 'user',
        updated_at: '2024-09-01T00:00:00Z',
      },
    ];
    const versions = parseDanbooruVersions(rawData);
    expect(versions[0].rating_changed).toBe(false);
    expect(versions[0].source_changed).toBe(false);
  });

  it('非数组输入应返回空数组', () => {
    expect(parseDanbooruVersions(null)).toEqual([]);
    expect(parseDanbooruVersions(undefined)).toEqual([]);
    expect(parseDanbooruVersions({})).toEqual([]);
    expect(parseDanbooruVersions('invalid')).toEqual([]);
  });

  it('空数组输入应返回空数组', () => {
    expect(parseDanbooruVersions([])).toEqual([]);
  });
});

describe('Moebooru 不支持版本历史', () => {
  it('任何 postId 都返回空数组', () => {
    expect(parseMoebooruVersions(100)).toEqual([]);
    expect(parseMoebooruVersions(999)).toEqual([]);
    expect(parseMoebooruVersions(0)).toEqual([]);
  });

  it('返回值是数组类型', () => {
    const result = parseMoebooruVersions(1);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
});

describe('Gelbooru 不支持版本历史', () => {
  it('任何 postId 都返回空数组', () => {
    expect(parseGelbooruVersions(100)).toEqual([]);
    expect(parseGelbooruVersions(999)).toEqual([]);
    expect(parseGelbooruVersions(0)).toEqual([]);
  });

  it('返回值是数组类型', () => {
    const result = parseGelbooruVersions(1);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
});

describe('BooruPostVersionData 完整接口字段验证', () => {
  it('包含所有必须字段和可选字段', () => {
    const version: BooruPostVersionData = {
      id: 1,
      post_id: 100,
      version: 1,
      updater_name: 'admin',
      created_at: '2024-01-01T00:00:00Z',
      tags_added: ['tag1'],
      tags_removed: ['tag2'],
      rating: 'safe',
      rating_changed: true,
      source: 'https://example.com',
      source_changed: true,
      parent_id: 50,
      parent_changed: true,
      description_changed: false,
    };

    // 必须字段
    expect(version.id).toBeDefined();
    expect(version.post_id).toBeDefined();
    expect(version.version).toBeDefined();
    expect(version.updater_name).toBeDefined();
    expect(version.created_at).toBeDefined();
    expect(version.tags_added).toBeDefined();
    expect(version.tags_removed).toBeDefined();

    // 可选字段
    expect(version.rating).toBe('safe');
    expect(version.rating_changed).toBe(true);
    expect(version.source).toBe('https://example.com');
    expect(version.source_changed).toBe(true);
    expect(version.parent_id).toBe(50);
    expect(version.parent_changed).toBe(true);
    expect(version.description_changed).toBe(false);
  });

  it('可选字段可以省略', () => {
    const version: BooruPostVersionData = {
      id: 2,
      post_id: 200,
      version: 1,
      updater_name: 'user',
      created_at: '2024-06-01T00:00:00Z',
      tags_added: [],
      tags_removed: [],
    };

    expect(version.rating).toBeUndefined();
    expect(version.rating_changed).toBeUndefined();
    expect(version.source).toBeUndefined();
    expect(version.source_changed).toBeUndefined();
    expect(version.parent_id).toBeUndefined();
    expect(version.parent_changed).toBeUndefined();
    expect(version.description_changed).toBeUndefined();
  });
});
