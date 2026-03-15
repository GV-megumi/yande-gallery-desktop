/**
 * Danbooru API 客户端
 * 参考: Boorusama-master-official/lib/boorus/danbooru/
 *
 * Danbooru API 特点：
 * - 认证：HTTP Basic Auth（login + api_key）
 * - 帖子端点：/posts.json（注意是 posts 不是 post）
 * - 标签端点：/tags.json
 * - 评论端点：/comments.json
 * - Pool 端点：/pools.json
 * - 收藏端点：/favorites.json
 * - 评级使用 g/s/q/e（general/sensitive/questionable/explicit）
 * - 标签类型：0=general, 1=artist, 3=copyright, 4=character, 5=meta
 */

import axios, { AxiosInstance } from 'axios';
import { getProxyConfig } from './config.js';
import {
  IBooruClient,
  BooruClientConfig,
  BooruPostData,
  BooruTagData,
  BooruCommentData,
  BooruPoolData,
  BooruPoolDetailData,
  BooruTagSummaryData,
  BooruArtistData,
  BooruWikiData,
  BooruForumTopicData,
  BooruForumPostData,
  BooruUserProfileData,
  BooruNoteData,
  BooruPostVersionData,
  TAG_TYPE_MAP,
  RateLimiter,
} from './booruClientInterface.js';

// Danbooru API 返回的原始 Post 格式
interface DanbooruRawPost {
  id: number;
  created_at: string;
  uploader_id: number;
  score: number;
  source: string;
  md5?: string;
  rating: 'g' | 's' | 'q' | 'e';
  image_width: number;
  image_height: number;
  tag_string: string;
  file_ext: string;
  file_size: number;
  file_url?: string;
  large_file_url?: string;
  preview_file_url?: string;
  has_children: boolean;
  parent_id?: number;
  tag_string_artist: string;
  tag_string_character: string;
  tag_string_copyright: string;
  tag_string_general: string;
  tag_string_meta: string;
  is_deleted: boolean;
  is_banned: boolean;
  fav_count: number;
  up_score: number;
  down_score: number;
}

// Danbooru 标签原始格式
interface DanbooruRawTag {
  id: number;
  name: string;
  post_count: number;
  category: number;    // 0=general, 1=artist, 3=copyright, 4=character, 5=meta
  is_deprecated: boolean;
}

// Danbooru 评论原始格式
interface DanbooruRawComment {
  id: number;
  post_id: number;
  body: string;
  score: number;
  creator_id: number;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  creator: { name: string } | null;
}

// Danbooru Pool 原始格式
interface DanbooruRawPool {
  id: number;
  name: string;
  description: string;
  post_count: number;
  category: 'series' | 'collection';
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  post_ids: number[];
}

// Danbooru Wiki 原始格式
interface DanbooruRawWiki {
  id: number;
  title: string;
  body: string;
  other_names?: string[] | string;
  is_locked?: boolean;
  is_deleted?: boolean;
  created_at?: string;
  updated_at?: string;
}

interface DanbooruRawForumTopic {
  id: number;
  title: string;
  response_count: number;
  is_sticky?: boolean;
  is_locked?: boolean;
  is_hidden?: boolean;
  category_id?: number;
  creator_id?: number;
  updater_id?: number;
  created_at?: string;
  updated_at?: string;
}

interface DanbooruRawForumPost {
  id: number;
  topic_id: number;
  body: string;
  creator_id?: number;
  updater_id?: number;
  created_at?: string;
  updated_at?: string;
  is_deleted?: boolean;
  is_hidden?: boolean;
}

interface DanbooruRawUser {
  id: number;
  name: string;
  level_string?: string;
  created_at?: string;
  avatar_url?: string;
  post_upload_count?: number;
  post_update_count?: number;
  note_update_count?: number;
  comment_count?: number;
  forum_post_count?: number;
  favorite_count?: number;
  feedback_count?: number;
}

/**
 * Danbooru API 客户端
 */
export class DanbooruClient implements IBooruClient {
  readonly siteType = 'danbooru' as const;
  private client: AxiosInstance;
  private config: BooruClientConfig;
  private rateLimiter = new RateLimiter(2, 1000);

  constructor(config: BooruClientConfig) {
    this.config = config;

    const proxyConfig = getProxyConfig();
    console.log('[DanbooruClient] 代理配置:', proxyConfig ? `${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}` : '无');

    // Danbooru 使用 HTTP Basic Auth
    const authConfig: any = {};
    if (config.login && config.apiKey) {
      authConfig.auth = {
        username: config.login,
        password: config.apiKey
      };
    }

    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout || 30000,
      headers: {
        'User-Agent': 'YandeGalleryDesktop/1.0.0'
      },
      maxRedirects: 5,
      proxy: proxyConfig,
      ...authConfig
    });

    // 请求拦截器
    this.client.interceptors.request.use(
      (reqConfig) => {
        console.log('[DanbooruClient] 请求:', reqConfig.method?.toUpperCase(), reqConfig.url, reqConfig.params);
        return reqConfig;
      },
      (error) => {
        console.error('[DanbooruClient] 请求错误:', error);
        return Promise.reject(error);
      }
    );

    // 响应拦截器
    this.client.interceptors.response.use(
      (response) => {
        console.log('[DanbooruClient] 响应:', response.status, response.config.url);
        return response;
      },
      (error) => {
        console.error('[DanbooruClient] 响应错误:', error.message);
        if (error.response) {
          console.error('[DanbooruClient] 错误详情:', error.response.status, error.response.data);
        }
        return Promise.reject(error);
      }
    );
  }

  // ========= 数据转换 =========

  /** 将 Danbooru 评级转为统一格式 */
  private normalizeRating(rating: string): 's' | 'q' | 'e' {
    switch (rating) {
      case 'g': return 's';   // general → safe
      case 's': return 'q';   // sensitive → questionable
      case 'q': return 'q';
      case 'e': return 'e';
      default: return 's';
    }
  }

  /** 将 Danbooru 原始帖子转为统一格式 */
  private convertPost(raw: DanbooruRawPost): BooruPostData {
    return {
      id: raw.id,
      tags: raw.tag_string || '',
      created_at: raw.created_at,
      author: raw.tag_string_artist?.split(' ')[0] || '',
      source: raw.source || '',
      score: raw.score,
      md5: raw.md5 || '',
      file_size: raw.file_size,
      file_url: raw.file_url || '',
      preview_url: raw.preview_file_url || '',
      sample_url: raw.large_file_url || raw.file_url || '',
      width: raw.image_width,
      height: raw.image_height,
      rating: this.normalizeRating(raw.rating),
      has_children: raw.has_children,
      parent_id: raw.parent_id || undefined,
      status: raw.is_deleted ? 'deleted' : (raw.is_banned ? 'banned' : 'active'),
    };
  }

  /** 将 Danbooru 标签转为统一格式 */
  private convertTag(raw: DanbooruRawTag): BooruTagData {
    return {
      id: raw.id,
      name: raw.name,
      count: raw.post_count,
      type: raw.category,   // Danbooru 的 category 数值与 Moebooru 一致
      ambiguous: raw.is_deprecated,
    };
  }

  // ========= 帖子相关 =========

  async getPosts(params: {
    page?: number;
    limit?: number;
    tags?: string[];
  }): Promise<BooruPostData[]> {
    try {
      const queryParams: any = {
        page: params.page || 1,
        limit: params.limit || 20,
      };
      if (params.tags && params.tags.length > 0) {
        queryParams.tags = params.tags.join(' ');
      }

      console.log('[DanbooruClient] 获取帖子:', queryParams);

      await this.rateLimiter.acquire();
      const response = await this.client.get('/posts.json', { params: queryParams });

      const posts: DanbooruRawPost[] = Array.isArray(response.data) ? response.data : [];
      console.log('[DanbooruClient] 获取帖子成功，数量:', posts.length);
      return posts.map(p => this.convertPost(p));
    } catch (error: any) {
      console.error('[DanbooruClient] 获取帖子失败:', error.message);
      throw error;
    }
  }

  async getPopularRecent(period: '1day' | '1week' | '1month' = '1day'): Promise<BooruPostData[]> {
    try {
      // Danbooru 的热门帖子通过 /explore/posts/popular.json 获取
      const scaleMap = { '1day': 'day', '1week': 'week', '1month': 'month' };
      const queryParams = { scale: scaleMap[period] || 'day' };

      console.log('[DanbooruClient] 获取热门帖子:', period);

      await this.rateLimiter.acquire();
      const response = await this.client.get('/explore/posts/popular.json', { params: queryParams });

      const posts: DanbooruRawPost[] = Array.isArray(response.data) ? response.data : [];
      return posts.map(p => this.convertPost(p));
    } catch (error: any) {
      console.error('[DanbooruClient] 获取热门帖子失败:', error.message);
      throw error;
    }
  }

  async getPopularByDay(date: string): Promise<BooruPostData[]> {
    try {
      console.log('[DanbooruClient] 获取指定日期热门:', date);

      await this.rateLimiter.acquire();
      const response = await this.client.get('/explore/posts/popular.json', {
        params: { date, scale: 'day' }
      });

      const posts: DanbooruRawPost[] = Array.isArray(response.data) ? response.data : [];
      return posts.map(p => this.convertPost(p));
    } catch (error: any) {
      console.error('[DanbooruClient] 获取指定日期热门失败:', error.message);
      throw error;
    }
  }

  async getPopularByWeek(date: string): Promise<BooruPostData[]> {
    try {
      console.log('[DanbooruClient] 获取指定周热门:', date);

      await this.rateLimiter.acquire();
      const response = await this.client.get('/explore/posts/popular.json', {
        params: { date, scale: 'week' }
      });

      const posts: DanbooruRawPost[] = Array.isArray(response.data) ? response.data : [];
      return posts.map(p => this.convertPost(p));
    } catch (error: any) {
      console.error('[DanbooruClient] 获取指定周热门失败:', error.message);
      throw error;
    }
  }

  async getPopularByMonth(date: string): Promise<BooruPostData[]> {
    try {
      console.log('[DanbooruClient] 获取指定月热门:', date);

      await this.rateLimiter.acquire();
      const response = await this.client.get('/explore/posts/popular.json', {
        params: { date, scale: 'month' }
      });

      const posts: DanbooruRawPost[] = Array.isArray(response.data) ? response.data : [];
      return posts.map(p => this.convertPost(p));
    } catch (error: any) {
      console.error('[DanbooruClient] 获取指定月热门失败:', error.message);
      throw error;
    }
  }

  // ========= 收藏/投票 =========

  async favoritePost(id: number): Promise<void> {
    try {
      console.log('[DanbooruClient] 收藏帖子:', id);

      await this.rateLimiter.acquire();
      // Danbooru 收藏通过 POST /favorites.json
      await this.client.post('/favorites.json', null, {
        params: { post_id: id }
      });
    } catch (error: any) {
      // 如果已经收藏过，Danbooru 返回 422
      if (error.response?.status === 422) {
        console.log('[DanbooruClient] 帖子已收藏:', id);
        return;
      }
      console.error('[DanbooruClient] 收藏帖子失败:', error.message);
      throw error;
    }
  }

  async unfavoritePost(id: number): Promise<void> {
    try {
      console.log('[DanbooruClient] 取消收藏帖子:', id);

      await this.rateLimiter.acquire();
      // Danbooru 取消收藏通过 DELETE /favorites/{id}.json
      await this.client.delete(`/favorites/${id}.json`);
    } catch (error: any) {
      console.error('[DanbooruClient] 取消收藏帖子失败:', error.message);
      throw error;
    }
  }

  async votePost(id: number, score: 1 | 0 | -1): Promise<void> {
    try {
      console.log('[DanbooruClient] 投票:', id, '分数:', score);

      await this.rateLimiter.acquire();
      if (score === 0) {
        // Danbooru 取消投票通过 DELETE
        await this.client.delete(`/posts/${id}/votes.json`);
      } else {
        // Danbooru 投票通过 POST /posts/{id}/votes.json
        await this.client.post(`/posts/${id}/votes.json`, null, {
          params: { score, no_unvote: false }
        });
      }
    } catch (error: any) {
      console.error('[DanbooruClient] 投票失败:', error.message);
      throw error;
    }
  }

  async getServerFavorites(page: number = 1, limit: number = 20): Promise<BooruPostData[]> {
    try {
      if (!this.config.login) {
        throw new Error('Authentication required');
      }

      console.log('[DanbooruClient] 获取服务端收藏:', this.config.login, '页码:', page);

      await this.rateLimiter.acquire();
      // Danbooru 通过搜索 ordfav:{username} 获取收藏
      const response = await this.client.get('/posts.json', {
        params: {
          tags: `ordfav:${this.config.login}`,
          page,
          limit,
        }
      });

      const posts: DanbooruRawPost[] = Array.isArray(response.data) ? response.data : [];
      console.log('[DanbooruClient] 获取服务端收藏成功:', posts.length, '张');
      return posts.map(p => this.convertPost(p));
    } catch (error: any) {
      console.error('[DanbooruClient] 获取服务端收藏失败:', error.message);
      throw error;
    }
  }

  async getFavoriteUsers(postId: number): Promise<any[]> {
    // Danbooru 不直接支持获取收藏用户列表，返回空数组
    console.log('[DanbooruClient] getFavoriteUsers 不支持，返回空数组');
    return [];
  }

  // ========= 标签相关 =========

  async getTags(params: { query?: string; limit?: number }): Promise<BooruTagData[]> {
    try {
      const queryParams: any = {
        limit: params.limit || 10,
        'search[order]': 'count',
      };
      if (params.query) {
        queryParams['search[name_matches]'] = `*${params.query}*`;
      }

      console.log('[DanbooruClient] 搜索标签:', queryParams);

      await this.rateLimiter.acquire();
      const response = await this.client.get('/tags.json', { params: queryParams });

      const tags: DanbooruRawTag[] = Array.isArray(response.data) ? response.data : [];
      return tags.map(t => this.convertTag(t));
    } catch (error: any) {
      console.error('[DanbooruClient] 搜索标签失败:', error.message);
      throw error;
    }
  }

  async getTagsByNames(names: string[]): Promise<BooruTagData[]> {
    try {
      if (names.length === 0) return [];

      if (names.length <= 10) {
        console.log('[DanbooruClient] 获取标签详情:', names);
      } else {
        console.log(`[DanbooruClient] 获取标签详情: ${names.length} 个标签`);
      }

      // Danbooru 支持用逗号分隔的 search[name] 参数批量查询
      const results: BooruTagData[] = [];
      const batchSize = 100; // Danbooru 支持较大批量

      for (let i = 0; i < names.length; i += batchSize) {
        const batch = names.slice(i, i + batchSize);
        await this.rateLimiter.acquire();
        const response = await this.client.get('/tags.json', {
          params: {
            'search[name_comma]': batch.join(','),
            limit: batch.length,
          }
        });

        if (Array.isArray(response.data)) {
          results.push(...response.data.map((t: DanbooruRawTag) => this.convertTag(t)));
        }
      }

      if (names.length > 10) {
        console.log(`[DanbooruClient] 成功获取 ${results.length}/${names.length} 个标签信息`);
      }
      return results;
    } catch (error: any) {
      console.error('[DanbooruClient] 获取标签详情失败:', error.message);
      throw error;
    }
  }

  async getTagSummary(): Promise<BooruTagSummaryData> {
    // Danbooru 不支持标签摘要
    console.log('[DanbooruClient] getTagSummary 不支持，返回空数据');
    return { version: 0, data: '' };
  }

  parseTagSummary(_data: string): Map<string, number> {
    // Danbooru 不支持标签摘要
    return new Map();
  }

  // ========= 评论相关 =========

  async getComments(postId?: number): Promise<BooruCommentData[]> {
    try {
      const queryParams: any = {};
      if (postId) {
        queryParams['search[post_id]'] = postId;
      }

      console.log('[DanbooruClient] 获取评论:', postId ? `帖子 ${postId}` : '全部');

      await this.rateLimiter.acquire();
      const response = await this.client.get('/comments.json', { params: queryParams });

      const comments: DanbooruRawComment[] = Array.isArray(response.data) ? response.data : [];
      return comments
        .filter(c => !c.is_deleted)
        .map(c => ({
          id: c.id,
          post_id: c.post_id,
          body: c.body,
          creator: c.creator?.name || `User#${c.creator_id}`,
          creator_id: c.creator_id,
          created_at: c.created_at,
        }));
    } catch (error: any) {
      console.error('[DanbooruClient] 获取评论失败:', error.message);
      throw error;
    }
  }

  async createComment(postId: number, body: string): Promise<any> {
    try {
      console.log('[DanbooruClient] 创建评论:', postId);

      await this.rateLimiter.acquire();
      const response = await this.client.post('/comments.json', {
        'comment[post_id]': postId,
        'comment[body]': body,
        'comment[do_not_bump_post]': true,
      }, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      return response.data;
    } catch (error: any) {
      console.error('[DanbooruClient] 创建评论失败:', error.message);
      throw error;
    }
  }

  // ========= Pool 相关 =========

  async getPools(params?: { query?: string; page?: number }): Promise<BooruPoolData[]> {
    try {
      const queryParams: any = {
        page: params?.page || 1,
      };
      if (params?.query) {
        queryParams['search[name_matches]'] = params.query;
      }

      console.log('[DanbooruClient] 获取 Pool 列表:', queryParams);

      await this.rateLimiter.acquire();
      const response = await this.client.get('/pools.json', { params: queryParams });

      const pools: DanbooruRawPool[] = Array.isArray(response.data) ? response.data : [];
      return pools
        .filter(p => !p.is_deleted)
        .map(p => ({
          id: p.id,
          name: p.name.replace(/_/g, ' '),
          description: p.description,
          post_count: p.post_count,
          created_at: p.created_at,
          updated_at: p.updated_at,
          is_public: true,
        }));
    } catch (error: any) {
      console.error('[DanbooruClient] 获取 Pool 列表失败:', error.message);
      throw error;
    }
  }

  async getPool(id: number, page?: number): Promise<BooruPoolDetailData> {
    try {
      console.log('[DanbooruClient] 获取 Pool 详情:', id);

      await this.rateLimiter.acquire();
      // 先获取 Pool 元信息
      const poolResponse = await this.client.get(`/pools/${id}.json`);
      const rawPool: DanbooruRawPool = poolResponse.data;

      // 获取 Pool 中的帖子（通过 post_ids）
      const postIds = rawPool.post_ids || [];
      const pageSize = 20;
      const pageNum = page || 1;
      const startIdx = (pageNum - 1) * pageSize;
      const pagePostIds = postIds.slice(startIdx, startIdx + pageSize);

      let posts: BooruPostData[] = [];
      if (pagePostIds.length > 0) {
        await this.rateLimiter.acquire();
        const postsResponse = await this.client.get('/posts.json', {
          params: {
            tags: `id:${pagePostIds.join(',')}`,
            limit: pagePostIds.length,
          }
        });

        const rawPosts: DanbooruRawPost[] = Array.isArray(postsResponse.data) ? postsResponse.data : [];
        posts = rawPosts.map(p => this.convertPost(p));
      }

      return {
        id: rawPool.id,
        name: rawPool.name.replace(/_/g, ' '),
        description: rawPool.description,
        post_count: rawPool.post_count,
        created_at: rawPool.created_at,
        updated_at: rawPool.updated_at,
        is_public: true,
        posts,
      };
    } catch (error: any) {
      console.error('[DanbooruClient] 获取 Pool 详情失败:', error.message);
      throw error;
    }
  }

  // ========= 艺术家 =========

  /**
   * 获取艺术家信息
   * Danbooru API: GET /artists.json?search[name]=xxx
   */
  async getArtist(name: string): Promise<BooruArtistData | null> {
    try {
      console.log('[DanbooruClient] 获取艺术家信息:', name);
      await this.rateLimiter.acquire();

      const response = await this.client.get('/artists.json', {
        params: { 'search[name]': name }
      });

      const artists = Array.isArray(response.data) ? response.data : [];
      const artist = artists.find((a: any) => a.name === name) || artists[0];

      if (!artist) {
        console.log('[DanbooruClient] 未找到艺术家:', name);
        return null;
      }

      // Danbooru artist 有 urls 子资源，需额外请求
      let urls: string[] = [];
      try {
        await this.rateLimiter.acquire();
        const urlsResponse = await this.client.get(`/artists/${artist.id}.json`);
        if (urlsResponse.data?.urls) {
          urls = urlsResponse.data.urls
            .filter((u: any) => u.is_active !== false)
            .map((u: any) => u.url || u.normalized_url)
            .filter((u: string) => u);
        }
      } catch {
        // 忽略 URL 获取失败
      }

      // 获取别名
      const aliases: string[] = [];
      if (artist.other_names && Array.isArray(artist.other_names)) {
        aliases.push(...artist.other_names);
      }

      console.log('[DanbooruClient] 艺术家信息获取成功:', artist.name, 'urls:', urls.length);
      return {
        id: artist.id,
        name: artist.name,
        aliases,
        urls,
        group_name: artist.group_name || undefined,
        is_banned: artist.is_banned || false,
      };
    } catch (error: any) {
      console.error('[DanbooruClient] 获取艺术家失败:', error.message);
      return null;
    }
  }

  /**
   * 获取 Wiki 页面
   * Danbooru API: GET /wiki_pages/{title}.json
   */
  async getWiki(title: string): Promise<BooruWikiData | null> {
    try {
      console.log('[DanbooruClient] 获取 Wiki:', title);
      await this.rateLimiter.acquire();

      const response = await this.client.get(`/wiki_pages/${encodeURIComponent(title)}.json`);
      const wiki: DanbooruRawWiki | null = response.data || null;

      if (!wiki?.id) {
        console.log('[DanbooruClient] 未找到 Wiki:', title);
        return null;
      }

      const otherNames = Array.isArray(wiki.other_names)
        ? wiki.other_names
        : typeof wiki.other_names === 'string'
          ? wiki.other_names.split(/\n|,/).map(name => name.trim()).filter(Boolean)
          : [];

      console.log('[DanbooruClient] Wiki 获取成功:', wiki.title);
      return {
        id: wiki.id,
        title: wiki.title,
        body: wiki.body || '',
        other_names: otherNames,
        created_at: wiki.created_at,
        updated_at: wiki.updated_at,
        is_locked: wiki.is_locked,
        is_deleted: wiki.is_deleted,
      };
    } catch (error: any) {
      if (error.response?.status === 404) {
        console.log('[DanbooruClient] Wiki 不存在:', title);
        return null;
      }
      console.error('[DanbooruClient] 获取 Wiki 失败:', error.message);
      throw error;
    }
  }

  /**
   * 获取论坛主题列表
   * Danbooru API: GET /forum_topics.json
   */
  async getForumTopics(params?: { page?: number; limit?: number }): Promise<BooruForumTopicData[]> {
    try {
      const queryParams = {
        page: params?.page || 1,
        limit: params?.limit || 20,
        'search[order]': 'sticky',
      };
      console.log('[DanbooruClient] 获取论坛主题:', queryParams);
      await this.rateLimiter.acquire();
      const response = await this.client.get('/forum_topics.json', { params: queryParams });
      const topics: DanbooruRawForumTopic[] = Array.isArray(response.data) ? response.data : [];
      return topics.map(topic => ({
        id: topic.id,
        title: topic.title,
        response_count: topic.response_count || 0,
        is_sticky: topic.is_sticky || false,
        is_locked: topic.is_locked || false,
        is_hidden: topic.is_hidden || false,
        category_id: topic.category_id,
        creator_id: topic.creator_id,
        updater_id: topic.updater_id,
        created_at: topic.created_at,
        updated_at: topic.updated_at,
      }));
    } catch (error: any) {
      console.error('[DanbooruClient] 获取论坛主题失败:', error.message);
      throw error;
    }
  }

  /**
   * 获取论坛主题帖子列表
   * Danbooru API: GET /forum_posts.json?search[topic_id]=xxx
   */
  async getForumPosts(topicId: number, params?: { page?: number; limit?: number }): Promise<BooruForumPostData[]> {
    try {
      const queryParams = {
        page: params?.page || 1,
        limit: params?.limit || 20,
        'search[topic_id]': topicId,
      };
      console.log('[DanbooruClient] 获取论坛帖子:', queryParams);
      await this.rateLimiter.acquire();
      const response = await this.client.get('/forum_posts.json', { params: queryParams });
      const posts: DanbooruRawForumPost[] = Array.isArray(response.data) ? response.data : [];
      return posts.map(post => ({
        id: post.id,
        topic_id: post.topic_id,
        body: post.body || '',
        creator_id: post.creator_id,
        updater_id: post.updater_id,
        created_at: post.created_at,
        updated_at: post.updated_at,
        is_deleted: post.is_deleted || false,
        is_hidden: post.is_hidden || false,
      }));
    } catch (error: any) {
      console.error('[DanbooruClient] 获取论坛帖子失败:', error.message);
      throw error;
    }
  }

  private convertUserProfile(user: DanbooruRawUser): BooruUserProfileData {
    return {
      id: user.id,
      name: user.name,
      level_string: user.level_string,
      created_at: user.created_at,
      avatar_url: user.avatar_url,
      post_upload_count: user.post_upload_count || 0,
      post_update_count: user.post_update_count || 0,
      note_update_count: user.note_update_count || 0,
      comment_count: user.comment_count || 0,
      forum_post_count: user.forum_post_count || 0,
      favorite_count: user.favorite_count || 0,
      feedback_count: user.feedback_count || 0,
    };
  }

  async getProfile(): Promise<BooruUserProfileData | null> {
    try {
      if (!this.config.login || !this.config.apiKey) {
        console.log('[DanbooruClient] 未登录，无法获取当前用户主页');
        return null;
      }

      console.log('[DanbooruClient] 获取当前用户主页');
      await this.rateLimiter.acquire();
      const response = await this.client.get('/profile.json');
      if (!response.data?.id) {
        return null;
      }
      return this.convertUserProfile(response.data as DanbooruRawUser);
    } catch (error: any) {
      console.error('[DanbooruClient] 获取当前用户主页失败:', error.message);
      throw error;
    }
  }

  async getUserProfile(params: { userId?: number; username?: string }): Promise<BooruUserProfileData | null> {
    try {
      if (params.userId) {
        console.log('[DanbooruClient] 按 ID 获取用户主页:', params.userId);
        await this.rateLimiter.acquire();
        const response = await this.client.get(`/users/${params.userId}.json`);
        if (!response.data?.id) {
          return null;
        }
        return this.convertUserProfile(response.data as DanbooruRawUser);
      }

      if (params.username) {
        console.log('[DanbooruClient] 按用户名获取用户主页:', params.username);
        await this.rateLimiter.acquire();
        const response = await this.client.get('/users.json', {
          params: { 'search[name_matches]': params.username, limit: 1 }
        });
        const users: DanbooruRawUser[] = Array.isArray(response.data) ? response.data : [];
        const user = users.find(item => item.name === params.username);
        return user ? this.convertUserProfile(user) : null;
      }

      return null;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      console.error('[DanbooruClient] 获取用户主页失败:', error.message);
      throw error;
    }
  }

  // ========= 认证/测试 =========

  async testAuth(): Promise<{ valid: boolean; error?: string }> {
    try {
      if (!this.config.login || !this.config.apiKey) {
        return { valid: false, error: '缺少用户名或 API Key' };
      }

      console.log('[DanbooruClient] 测试认证:', this.config.login);

      await this.rateLimiter.acquire();
      // Danbooru 通过获取当前用户信息测试认证
      const response = await this.client.get('/profile.json');

      if (response.data && response.data.name) {
        console.log('[DanbooruClient] 认证成功:', response.data.name);
        return { valid: true };
      }

      return { valid: false, error: '认证响应异常' };
    } catch (error: any) {
      const status = error.response?.status;
      if (status === 401 || status === 403) {
        console.error('[DanbooruClient] 认证失败:', status);
        return { valid: false, error: '用户名或 API Key 错误' };
      }
      return { valid: false, error: '网络错误: ' + error.message };
    }
  }

  /**
   * 获取帖子注释（Danbooru: /notes.json?search[post_id]=xxx）
   */
  async getNotes(postId: number): Promise<BooruNoteData[]> {
    try {
      console.log('[DanbooruClient] 获取注释, postId:', postId);
      await this.rateLimiter.acquire();
      const response = await this.client.get('/notes.json', {
        params: { 'search[post_id]': postId }
      });
      const notes: any[] = Array.isArray(response.data) ? response.data : [];
      return notes
        .filter((n: any) => n.is_active !== false)
        .map((n: any) => ({
          id: n.id,
          post_id: n.post_id,
          x: n.x,
          y: n.y,
          width: n.width,
          height: n.height,
          body: n.body || '',
          creator: n.creator_name || '',
          created_at: n.created_at || new Date().toISOString(),
          updated_at: n.updated_at || undefined,
          is_active: n.is_active !== false,
        }));
    } catch (error: any) {
      console.error('[DanbooruClient] 获取注释失败:', error.message);
      return [];
    }
  }

  /**
   * 获取帖子版本历史（Danbooru: /post_versions.json?search[post_id]=xxx）
   */
  async getPostVersions(postId: number): Promise<BooruPostVersionData[]> {
    try {
      console.log('[DanbooruClient] 获取版本历史, postId:', postId);
      await this.rateLimiter.acquire();
      const response = await this.client.get('/post_versions.json', {
        params: { 'search[post_id]': postId, limit: 50 }
      });
      const versions: any[] = Array.isArray(response.data) ? response.data : [];
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
    } catch (error: any) {
      console.error('[DanbooruClient] 获取版本历史失败:', error.message);
      return [];
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.getPosts({ page: 1, limit: 1 });
      console.log('[DanbooruClient] 连接测试成功');
      return true;
    } catch (error) {
      console.error('[DanbooruClient] 连接测试失败:', error);
      return false;
    }
  }
}

export default DanbooruClient;
