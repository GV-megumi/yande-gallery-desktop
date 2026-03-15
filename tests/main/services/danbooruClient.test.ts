import { describe, it, expect, vi } from 'vitest';

// Mock 依赖模块
vi.mock('../../../src/main/services/config', () => ({
  getProxyConfig: vi.fn(() => undefined),
}));

import { DanbooruClient } from '../../../src/main/services/danbooruClient';

describe('DanbooruClient', () => {
  // 用反射方式测试私有方法
  function createClient(config?: Partial<{ baseUrl: string; login: string; apiKey: string }>) {
    return new DanbooruClient({
      baseUrl: config?.baseUrl || 'https://danbooru.donmai.us',
      login: config?.login,
      apiKey: config?.apiKey,
    });
  }

  describe('siteType', () => {
    it('应为 danbooru', () => {
      const client = createClient();
      expect(client.siteType).toBe('danbooru');
    });
  });

  describe('normalizeRating (私有方法通过 convertPost 间接测试)', () => {
    // 通过 prototype 直接访问私有方法
    const normalizeRating = (DanbooruClient.prototype as any).normalizeRating;

    it('应将 g (general) 映射为 s (safe)', () => {
      expect(normalizeRating('g')).toBe('s');
    });

    it('应将 s (sensitive) 映射为 q (questionable)', () => {
      expect(normalizeRating('s')).toBe('q');
    });

    it('应将 q 映射为 q', () => {
      expect(normalizeRating('q')).toBe('q');
    });

    it('应将 e 映射为 e', () => {
      expect(normalizeRating('e')).toBe('e');
    });

    it('未知评级应默认为 s', () => {
      expect(normalizeRating('unknown')).toBe('s');
      expect(normalizeRating('')).toBe('s');
    });
  });

  describe('convertPost (私有方法)', () => {
    const client = createClient();
    const convertPost = (client as any).convertPost.bind(client);

    const rawPost = {
      id: 12345,
      created_at: '2024-01-15T10:30:00.000Z',
      uploader_id: 100,
      score: 42,
      source: 'https://pixiv.net/123',
      md5: 'abc123def456',
      rating: 'g' as const,
      image_width: 1920,
      image_height: 1080,
      tag_string: 'girl blue_eyes long_hair',
      file_ext: 'png',
      file_size: 2048000,
      file_url: 'https://cdn.danbooru.donmai.us/original/abc.png',
      large_file_url: 'https://cdn.danbooru.donmai.us/sample/abc.jpg',
      preview_file_url: 'https://cdn.danbooru.donmai.us/preview/abc.jpg',
      has_children: false,
      parent_id: null,
      tag_string_artist: 'artist_name second_artist',
      tag_string_character: 'reimu_hakurei',
      tag_string_copyright: 'touhou',
      tag_string_general: 'girl blue_eyes',
      tag_string_meta: 'highres',
      is_deleted: false,
      is_banned: false,
      fav_count: 10,
      up_score: 50,
      down_score: -8,
    };

    it('应正确转换基本字段', () => {
      const result = convertPost(rawPost);

      expect(result.id).toBe(12345);
      expect(result.tags).toBe('girl blue_eyes long_hair');
      expect(result.created_at).toBe('2024-01-15T10:30:00.000Z');
      expect(result.score).toBe(42);
      expect(result.md5).toBe('abc123def456');
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.file_size).toBe(2048000);
    });

    it('应取第一个 artist 标签作为 author', () => {
      const result = convertPost(rawPost);
      expect(result.author).toBe('artist_name');
    });

    it('应正确转换 URL', () => {
      const result = convertPost(rawPost);
      expect(result.file_url).toBe('https://cdn.danbooru.donmai.us/original/abc.png');
      expect(result.preview_url).toBe('https://cdn.danbooru.donmai.us/preview/abc.jpg');
      expect(result.sample_url).toBe('https://cdn.danbooru.donmai.us/sample/abc.jpg');
    });

    it('sample_url 应回退到 file_url', () => {
      const postWithoutSample = { ...rawPost, large_file_url: undefined };
      const result = convertPost(postWithoutSample);
      expect(result.sample_url).toBe(rawPost.file_url);
    });

    it('应正确转换评级 g → s', () => {
      const result = convertPost(rawPost);
      expect(result.rating).toBe('s');
    });

    it('应正确判断状态', () => {
      expect(convertPost(rawPost).status).toBe('active');
      expect(convertPost({ ...rawPost, is_deleted: true }).status).toBe('deleted');
      expect(convertPost({ ...rawPost, is_banned: true }).status).toBe('banned');
    });

    it('应处理缺失的可选字段', () => {
      const minimal = {
        ...rawPost,
        md5: undefined,
        source: '',
        file_url: undefined,
        large_file_url: undefined,
        preview_file_url: undefined,
        tag_string_artist: '',
        parent_id: undefined,
      };
      const result = convertPost(minimal);
      expect(result.md5).toBe('');
      expect(result.source).toBe('');
      expect(result.file_url).toBe('');
      expect(result.preview_url).toBe('');
      expect(result.sample_url).toBe('');
      expect(result.author).toBe('');
      expect(result.parent_id).toBeUndefined();
    });
  });

  describe('convertTag (私有方法)', () => {
    const convertTag = (DanbooruClient.prototype as any).convertTag;

    it('应正确转换标签', () => {
      const raw = {
        id: 100,
        name: 'blue_eyes',
        post_count: 50000,
        category: 0,
        is_deprecated: false,
      };
      const result = convertTag(raw);

      expect(result.id).toBe(100);
      expect(result.name).toBe('blue_eyes');
      expect(result.count).toBe(50000);
      expect(result.type).toBe(0);
      expect(result.ambiguous).toBe(false);
    });

    it('应将 is_deprecated 映射为 ambiguous', () => {
      const raw = {
        id: 200,
        name: 'old_tag',
        post_count: 10,
        category: 1,
        is_deprecated: true,
      };
      const result = convertTag(raw);
      expect(result.ambiguous).toBe(true);
    });
  });

  describe('getTagsByNames', () => {
    it('空数组应直接返回空', async () => {
      const client = createClient();
      const result = await client.getTagsByNames([]);
      expect(result).toEqual([]);
    });
  });

  describe('getServerFavorites', () => {
    it('未登录应抛出错误', async () => {
      const client = createClient({ login: undefined });
      await expect(client.getServerFavorites()).rejects.toThrow('Authentication required');
    });
  });

  describe('getFavoriteUsers', () => {
    it('应返回空数组（Danbooru 不支持）', async () => {
      const client = createClient();
      const result = await client.getFavoriteUsers(123);
      expect(result).toEqual([]);
    });
  });

  describe('getTagSummary', () => {
    it('应返回空数据（Danbooru 不支持）', async () => {
      const client = createClient();
      const result = await client.getTagSummary();
      expect(result).toEqual({ version: 0, data: '' });
    });
  });

  describe('forum support', () => {
    it('getForumTopics 应在请求失败时抛出错误', async () => {
      const client = createClient();
      const mockGet = vi.fn().mockRejectedValue(new Error('network error'));
      (client as any).client = { get: mockGet };

      await expect(client.getForumTopics()).rejects.toThrow('network error');
    });

    it('getForumPosts 应在请求失败时抛出错误', async () => {
      const client = createClient();
      const mockGet = vi.fn().mockRejectedValue(new Error('network error'));
      (client as any).client = { get: mockGet };

      await expect(client.getForumPosts(123)).rejects.toThrow('network error');
    });
  });

  describe('user profile support', () => {
    it('getProfile 未登录时应返回 null', async () => {
      const client = createClient({ login: undefined, apiKey: undefined });
      const result = await client.getProfile();
      expect(result).toBeNull();
    });

    it('getUserProfile 请求失败时应抛出错误', async () => {
      const client = createClient();
      const mockGet = vi.fn().mockRejectedValue(new Error('network error'));
      (client as any).client = { get: mockGet };

      await expect(client.getUserProfile({ username: 'test_user' })).rejects.toThrow('network error');
    });

    it('getUserProfile 用户名查询只应接受精确匹配', async () => {
      const client = createClient();
      const mockGet = vi.fn().mockResolvedValue({
        data: [
          { id: 1, name: 'test_user_alt' },
          { id: 2, name: 'another_user' },
        ],
      });
      (client as any).client = { get: mockGet };

      const result = await client.getUserProfile({ username: 'test_user' });
      expect(result).toBeNull();
    });

    it('getUserProfile 用户名查询命中精确匹配时应返回对应用户', async () => {
      const client = createClient();
      const mockGet = vi.fn().mockResolvedValue({
        data: [
          { id: 1, name: 'test_user_alt' },
          { id: 2, name: 'test_user', level_string: 'Member' },
        ],
      });
      (client as any).client = { get: mockGet };

      const result = await client.getUserProfile({ username: 'test_user' });
      expect(result).toMatchObject({ id: 2, name: 'test_user', level_string: 'Member' });
    });
  });

  describe('wiki support', () => {
    it('getWiki 请求失败时应抛出错误', async () => {
      const client = createClient();
      const mockGet = vi.fn().mockRejectedValue(new Error('network error'));
      (client as any).client = { get: mockGet };

      await expect(client.getWiki('test_wiki')).rejects.toThrow('network error');
    });
  });

  describe('parseTagSummary', () => {
    it('应返回空 Map（Danbooru 不支持）', () => {
      const client = createClient();
      const result = client.parseTagSummary('any data');
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });
  });

  describe('testAuth', () => {
    it('缺少登录信息应返回 invalid', async () => {
      const client = createClient({ login: undefined, apiKey: undefined });
      const result = await client.testAuth();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('缺少');
    });

    it('缺少 apiKey 应返回 invalid', async () => {
      const client = createClient({ login: 'user', apiKey: undefined });
      const result = await client.testAuth();
      expect(result.valid).toBe(false);
    });
  });
});
