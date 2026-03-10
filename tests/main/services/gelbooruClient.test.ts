import { describe, it, expect, vi } from 'vitest';

// Mock 依赖模块
vi.mock('../../../src/main/services/config', () => ({
  getProxyConfig: vi.fn(() => undefined),
}));

import { GelbooruClient } from '../../../src/main/services/gelbooruClient';

describe('GelbooruClient', () => {
  function createClient(config?: Partial<{ baseUrl: string; login: string; apiKey: string }>) {
    return new GelbooruClient({
      baseUrl: config?.baseUrl || 'https://gelbooru.com',
      login: config?.login,
      apiKey: config?.apiKey,
    });
  }

  describe('siteType', () => {
    it('应为 gelbooru', () => {
      const client = createClient();
      expect(client.siteType).toBe('gelbooru');
    });
  });

  // ========= normalizeRating =========

  describe('normalizeRating (私有方法)', () => {
    const normalizeRating = (GelbooruClient.prototype as any).normalizeRating;

    it('应将 general 映射为 s', () => {
      expect(normalizeRating('general')).toBe('s');
    });

    it('应将 safe 映射为 s', () => {
      expect(normalizeRating('safe')).toBe('s');
    });

    it('应将 s 映射为 s', () => {
      expect(normalizeRating('s')).toBe('s');
    });

    it('应将 sensitive 映射为 q', () => {
      expect(normalizeRating('sensitive')).toBe('q');
    });

    it('应将 questionable 映射为 q', () => {
      expect(normalizeRating('questionable')).toBe('q');
    });

    it('应将 q 映射为 q', () => {
      expect(normalizeRating('q')).toBe('q');
    });

    it('应将 explicit 映射为 e', () => {
      expect(normalizeRating('explicit')).toBe('e');
    });

    it('应将 e 映射为 e', () => {
      expect(normalizeRating('e')).toBe('e');
    });

    it('应忽略大小写', () => {
      expect(normalizeRating('General')).toBe('s');
      expect(normalizeRating('EXPLICIT')).toBe('e');
      expect(normalizeRating('Questionable')).toBe('q');
    });

    it('未知评级应默认为 s', () => {
      expect(normalizeRating('unknown')).toBe('s');
      expect(normalizeRating('')).toBe('s');
    });

    it('null/undefined 应默认为 s', () => {
      expect(normalizeRating(null)).toBe('s');
      expect(normalizeRating(undefined)).toBe('s');
    });
  });

  // ========= decodeHtmlEntities =========

  describe('decodeHtmlEntities (私有方法)', () => {
    const decodeHtmlEntities = (GelbooruClient.prototype as any).decodeHtmlEntities;

    it('应解码单引号实体', () => {
      expect(decodeHtmlEntities("tag&#039;s_name")).toBe("tag's_name");
    });

    it('应解码双引号实体', () => {
      expect(decodeHtmlEntities('tag&quot;name')).toBe('tag"name');
    });

    it('应解码 & 实体', () => {
      expect(decodeHtmlEntities('a&amp;b')).toBe('a&b');
    });

    it('应解码 < 和 > 实体', () => {
      expect(decodeHtmlEntities('&lt;tag&gt;')).toBe('<tag>');
    });

    it('应同时解码多种实体', () => {
      expect(decodeHtmlEntities('a&amp;b&#039;c&quot;d&lt;e&gt;f')).toBe("a&b'c\"d<e>f");
    });

    it('无实体时应原样返回', () => {
      expect(decodeHtmlEntities('normal_tag blue_eyes')).toBe('normal_tag blue_eyes');
    });

    it('应处理空字符串', () => {
      expect(decodeHtmlEntities('')).toBe('');
    });

    it('应处理多个连续实体', () => {
      expect(decodeHtmlEntities('&#039;&#039;&#039;')).toBe("'''");
    });
  });

  // ========= buildUrl =========

  describe('buildUrl (私有方法)', () => {
    const client = createClient({ baseUrl: 'https://gelbooru.com' });
    const buildUrl = (GelbooruClient.prototype as any).buildUrl.bind(client);

    const rawPost = {
      directory: 'ab/cd',
      image: 'abc123.jpg',
    };

    it('有完整 URL 时直接返回', () => {
      const result = buildUrl(rawPost, 'images', 'https://cdn.gelbooru.com/full.jpg');
      expect(result).toBe('https://cdn.gelbooru.com/full.jpg');
    });

    it('无完整 URL 时构建 images URL', () => {
      const result = buildUrl(rawPost, 'images');
      expect(result).toBe('https://gelbooru.com/images/ab/cd/abc123.jpg');
    });

    it('无完整 URL 时构建 thumbnails URL', () => {
      const result = buildUrl(rawPost, 'thumbnails');
      expect(result).toBe('https://gelbooru.com/thumbnails/ab/cd/thumbnail_abc123.jpg');
    });

    it('无完整 URL 时构建 samples URL', () => {
      const result = buildUrl(rawPost, 'samples');
      expect(result).toBe('https://gelbooru.com/samples/ab/cd/sample_abc123.jpg');
    });

    it('baseUrl 末尾有斜杠时应去除', () => {
      const client2 = createClient({ baseUrl: 'https://gelbooru.com/' });
      const buildUrl2 = (GelbooruClient.prototype as any).buildUrl.bind(client2);
      const result = buildUrl2(rawPost, 'images');
      expect(result).toBe('https://gelbooru.com/images/ab/cd/abc123.jpg');
    });

    it('无 directory 和 image 时应返回空字符串', () => {
      const emptyPost = { directory: '', image: '' };
      expect(buildUrl(emptyPost, 'images')).toBe('');
    });

    it('仅缺少 directory 时应返回空字符串', () => {
      const noDir = { directory: '', image: 'file.jpg' };
      expect(buildUrl(noDir, 'images')).toBe('');
    });
  });

  // ========= convertPost =========

  describe('convertPost (私有方法)', () => {
    const client = createClient();
    const convertPost = (GelbooruClient.prototype as any).convertPost.bind(client);

    const rawPost = {
      id: 99999,
      created_at: 'Mon Jan 15 10:30:00 2024',
      score: 15,
      width: 1920,
      height: 1080,
      md5: 'deadbeef12345678',
      rating: 'general',
      source: 'https://pixiv.net/456',
      tags: 'girl blue_eyes school_uniform',
      file_url: 'https://cdn.gelbooru.com/images/abc.jpg',
      preview_url: 'https://cdn.gelbooru.com/thumbnails/abc.jpg',
      sample_url: 'https://cdn.gelbooru.com/samples/abc.jpg',
      sample_height: 800,
      sample_width: 600,
      preview_height: 150,
      preview_width: 150,
      title: '',
      directory: 'ab/cd',
      image: 'abc.jpg',
      has_children: 'false',
      parent_id: 0,
      owner: 'uploader',
      change: 12345,
      has_notes: 'false',
      has_comments: 'true',
      post_locked: 0,
      status: 'active',
    };

    it('应正确转换基本字段', () => {
      const result = convertPost(rawPost);

      expect(result.id).toBe(99999);
      expect(result.score).toBe(15);
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.md5).toBe('deadbeef12345678');
      expect(result.source).toBe('https://pixiv.net/456');
      expect(result.author).toBe('uploader');
      expect(result.status).toBe('active');
    });

    it('应解码 HTML 实体的标签', () => {
      const postWithEntities = { ...rawPost, tags: 'tag&#039;s blue&amp;eyes' };
      const result = convertPost(postWithEntities);
      expect(result.tags).toBe("tag's blue&eyes");
    });

    it('应正确转换评级', () => {
      expect(convertPost({ ...rawPost, rating: 'general' }).rating).toBe('s');
      expect(convertPost({ ...rawPost, rating: 'sensitive' }).rating).toBe('q');
      expect(convertPost({ ...rawPost, rating: 'questionable' }).rating).toBe('q');
      expect(convertPost({ ...rawPost, rating: 'explicit' }).rating).toBe('e');
    });

    it('should convert has_children string to boolean', () => {
      expect(convertPost({ ...rawPost, has_children: 'true' }).has_children).toBe(true);
      expect(convertPost({ ...rawPost, has_children: 'false' }).has_children).toBe(false);
    });

    it('file_size 应固定为 0（Gelbooru 不返回此信息）', () => {
      const result = convertPost(rawPost);
      expect(result.file_size).toBe(0);
    });

    it('应保留 sample 尺寸', () => {
      const result = convertPost(rawPost);
      expect(result.sample_width).toBe(600);
      expect(result.sample_height).toBe(800);
      expect(result.preview_width).toBe(150);
      expect(result.preview_height).toBe(150);
    });

    it('应处理缺失的可选字段', () => {
      const minimal = {
        ...rawPost,
        tags: '',
        source: '',
        md5: '',
        owner: '',
        parent_id: 0,
      };
      const result = convertPost(minimal);
      expect(result.tags).toBe('');
      expect(result.source).toBe('');
      expect(result.md5).toBe('');
      expect(result.author).toBe('');
    });
  });

  // ========= extractPosts =========

  describe('extractPosts (私有方法)', () => {
    const extractPosts = (GelbooruClient.prototype as any).extractPosts;

    it('应从 { post: [...] } 格式中提取', () => {
      const data = { post: [{ id: 1 }, { id: 2 }], '@attributes': { count: 2 } };
      expect(extractPosts(data)).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('应处理直接数组格式', () => {
      const data = [{ id: 1 }, { id: 2 }];
      expect(extractPosts(data)).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('空响应应返回空数组', () => {
      expect(extractPosts(null)).toEqual([]);
      expect(extractPosts(undefined)).toEqual([]);
      expect(extractPosts({})).toEqual([]);
    });

    it('post 不是数组时返回空', () => {
      expect(extractPosts({ post: 'not_array' })).toEqual([]);
    });
  });

  // ========= extractTags =========

  describe('extractTags (私有方法)', () => {
    const extractTags = (GelbooruClient.prototype as any).extractTags;

    it('应从 { tag: [...] } 格式中提取', () => {
      const data = { tag: [{ id: 1, tag: 'blue_eyes' }] };
      expect(extractTags(data)).toEqual([{ id: 1, tag: 'blue_eyes' }]);
    });

    it('应处理直接数组格式', () => {
      const data = [{ id: 1, tag: 'blue_eyes' }];
      expect(extractTags(data)).toEqual([{ id: 1, tag: 'blue_eyes' }]);
    });

    it('空响应应返回空数组', () => {
      expect(extractTags(null)).toEqual([]);
      expect(extractTags(undefined)).toEqual([]);
      expect(extractTags({})).toEqual([]);
    });
  });

  // ========= getAuthParams =========

  describe('getAuthParams (私有方法)', () => {
    it('有 apiKey 和 login 时应返回参数', () => {
      const client = createClient({ apiKey: 'mykey', login: '12345' });
      const getAuthParams = (GelbooruClient.prototype as any).getAuthParams.bind(client);
      const params = getAuthParams();

      expect(params.api_key).toBe('mykey');
      expect(params.user_id).toBe('12345');
    });

    it('无认证信息时应返回空对象', () => {
      const client = createClient();
      const getAuthParams = (GelbooruClient.prototype as any).getAuthParams.bind(client);
      const params = getAuthParams();

      expect(params).toEqual({});
    });

    it('仅有 apiKey 时应只返回 api_key', () => {
      const client = createClient({ apiKey: 'mykey' });
      const getAuthParams = (GelbooruClient.prototype as any).getAuthParams.bind(client);
      const params = getAuthParams();

      expect(params.api_key).toBe('mykey');
      expect(params.user_id).toBeUndefined();
    });
  });

  // ========= 不支持的功能 =========

  describe('不支持的功能', () => {
    it('votePost 应静默返回', async () => {
      const client = createClient();
      await expect(client.votePost(1, 1)).resolves.toBeUndefined();
    });

    it('getFavoriteUsers 应返回空数组', async () => {
      const client = createClient();
      const result = await client.getFavoriteUsers(123);
      expect(result).toEqual([]);
    });

    it('getTagSummary 应返回空数据', async () => {
      const client = createClient();
      const result = await client.getTagSummary();
      expect(result).toEqual({ version: 0, data: '' });
    });

    it('parseTagSummary 应返回空 Map', () => {
      const client = createClient();
      const result = client.parseTagSummary('data');
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('createComment 应抛出错误', async () => {
      const client = createClient();
      await expect(client.createComment(1, 'test')).rejects.toThrow('不支持');
    });
  });

  // ========= 认证相关 =========

  describe('testAuth', () => {
    it('缺少 API Key 应返回 invalid', async () => {
      const client = createClient({ login: '12345' });
      const result = await client.testAuth();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('API Key');
    });

    it('缺少 User ID 应返回 invalid', async () => {
      const client = createClient({ apiKey: 'key' });
      const result = await client.testAuth();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('User ID');
    });
  });

  // ========= getTagsByNames =========

  describe('getTagsByNames', () => {
    it('空数组应直接返回空', async () => {
      const client = createClient();
      const result = await client.getTagsByNames([]);
      expect(result).toEqual([]);
    });
  });

  // ========= getServerFavorites =========

  describe('getServerFavorites', () => {
    it('未登录应抛出错误', async () => {
      const client = createClient();
      await expect(client.getServerFavorites()).rejects.toThrow('Authentication required');
    });
  });
});
