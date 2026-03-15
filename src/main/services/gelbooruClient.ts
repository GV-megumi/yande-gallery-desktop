/**
 * Gelbooru API 客户端
 * 参考: Boorusama-master-official/lib/boorus/gelbooru/
 *
 * Gelbooru API 特点：
 * - 认证：api_key + user_id 作为查询参数
 * - 帖子端点：/index.php?page=dapi&s=post&q=index&json=1
 * - 标签端点：/index.php?page=dapi&s=tag&q=index&json=1
 * - 评论端点：/index.php?page=dapi&s=comment&q=index
 * - 收藏端点：/index.php?page=dapi&s=favorite&q=index&json=1
 * - 使用 pid（从0开始的页码偏移）而非 page
 * - 响应包裹在 { post: [...], @attributes: { count, offset, limit } } 中
 * - 评级使用 general/sensitive/questionable/explicit
 * - 标签类型：0=general, 1=artist, 3=copyright, 4=character, 5=metadata
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
  RateLimiter,
  BooruPoolDetailData,
  BooruTagSummaryData,
  BooruArtistData,
  BooruWikiData,
  BooruForumTopicData,
  BooruForumPostData,
  BooruUserProfileData,
  BooruNoteData,
  BooruPostVersionData,
} from './booruClientInterface.js';

// Gelbooru API 返回的原始 Post 格式
interface GelbooruRawPost {
  id: number;
  created_at: string;
  score: number;
  width: number;
  height: number;
  md5: string;
  rating: string;         // "general", "sensitive", "questionable", "explicit"
  source: string;
  tags: string;           // 空格分隔的标签
  file_url: string;
  preview_url: string;
  sample_url: string;
  sample_height: number;
  sample_width: number;
  preview_height: number;
  preview_width: number;
  title: string;
  directory: string;      // 用于构建 URL 回退
  image: string;          // 文件名，用于构建 URL 回退
  has_children: string;   // "true" / "false"
  parent_id: number;
  owner: string;
  change: number;
  has_notes: string;
  has_comments: string;
  post_locked: number;
  status: string;
}

// Gelbooru 标签原始格式
interface GelbooruRawTag {
  id: number;
  tag: string;            // Gelbooru 用 "tag" 而不是 "name"
  count: number;
  type: number;           // 0=general, 1=artist, 3=copyright, 4=character, 5=metadata
  ambiguous: number;      // 0 或 1
}

// Gelbooru 评论原始格式
interface GelbooruRawComment {
  id: number;
  post_id: number;
  body: string;
  creator: string;
  creator_id: number;
  created_at: string;
}

/**
 * Gelbooru API 客户端
 */
export class GelbooruClient implements IBooruClient {
  readonly siteType = 'gelbooru' as const;
  private client: AxiosInstance;
  private config: BooruClientConfig;
  private rateLimiter = new RateLimiter(2, 1000);

  constructor(config: BooruClientConfig) {
    this.config = config;

    const proxyConfig = getProxyConfig();
    console.log('[GelbooruClient] 代理配置:', proxyConfig ? `${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}` : '无');

    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout || 30000,
      headers: {
        'User-Agent': 'YandeGalleryDesktop/1.0.0'
      },
      maxRedirects: 5,
      proxy: proxyConfig,
    });

    // 请求拦截器
    this.client.interceptors.request.use(
      (reqConfig) => {
        console.log('[GelbooruClient] 请求:', reqConfig.method?.toUpperCase(), reqConfig.url, reqConfig.params);
        return reqConfig;
      },
      (error) => {
        console.error('[GelbooruClient] 请求错误:', error);
        return Promise.reject(error);
      }
    );

    // 响应拦截器
    this.client.interceptors.response.use(
      (response) => {
        console.log('[GelbooruClient] 响应:', response.status, response.config.url);
        return response;
      },
      (error) => {
        console.error('[GelbooruClient] 响应错误:', error.message);
        if (error.response) {
          console.error('[GelbooruClient] 错误详情:', error.response.status, error.response.data);
        }
        return Promise.reject(error);
      }
    );
  }

  /** 获取认证参数（Gelbooru 通过查询参数传递） */
  private getAuthParams(): Record<string, string> {
    const params: Record<string, string> = {};
    if (this.config.apiKey) {
      params.api_key = this.config.apiKey;
    }
    if (this.config.login) {
      params.user_id = this.config.login;
    }
    return params;
  }

  /** 将 Gelbooru 评级转为统一格式 */
  private normalizeRating(rating: string): 's' | 'q' | 'e' {
    switch (rating?.toLowerCase()) {
      case 'general':
      case 'safe':
      case 's':
        return 's';
      case 'sensitive':
      case 'questionable':
      case 'q':
        return 'q';
      case 'explicit':
      case 'e':
        return 'e';
      default:
        return 's';
    }
  }

  /** HTML 实体解码（Gelbooru 标签中可能包含 HTML 实体） */
  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&#039;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  /**
   * URL 构建回退：当 API 不返回完整 URL 时，从 directory + image 构建
   * Gelbooru 图片 URL 格式：{baseUrl}/{type}/{directory}/{filename}
   */
  private buildUrl(raw: GelbooruRawPost, type: 'images' | 'thumbnails' | 'samples', fullUrl?: string): string {
    if (fullUrl) return fullUrl;
    if (!raw.directory || !raw.image) return '';
    const base = this.config.baseUrl.replace(/\/$/, '');
    switch (type) {
      case 'thumbnails':
        return `${base}/thumbnails/${raw.directory}/thumbnail_${raw.image}`;
      case 'samples':
        return `${base}/samples/${raw.directory}/sample_${raw.image}`;
      default:
        return `${base}/images/${raw.directory}/${raw.image}`;
    }
  }

  /** 将 Gelbooru 帖子转为统一格式 */
  private convertPost(raw: GelbooruRawPost): BooruPostData {
    return {
      id: raw.id,
      tags: this.decodeHtmlEntities(raw.tags || ''),
      created_at: raw.created_at,
      author: raw.owner || '',
      source: raw.source || '',
      score: raw.score,
      md5: raw.md5 || '',
      file_size: 0,       // Gelbooru 不返回文件大小
      file_url: this.buildUrl(raw, 'images', raw.file_url),
      preview_url: this.buildUrl(raw, 'thumbnails', raw.preview_url),
      sample_url: this.buildUrl(raw, 'samples', raw.sample_url) || this.buildUrl(raw, 'images', raw.file_url),
      width: raw.width,
      height: raw.height,
      preview_width: raw.preview_width,
      preview_height: raw.preview_height,
      sample_width: raw.sample_width,
      sample_height: raw.sample_height,
      rating: this.normalizeRating(raw.rating),
      has_children: raw.has_children === 'true',
      parent_id: raw.parent_id || undefined,
      status: raw.status || 'active',
    };
  }

  /** 从 Gelbooru 响应中提取帖子数组 */
  private extractPosts(data: any): GelbooruRawPost[] {
    // Gelbooru 响应格式: { post: [...], @attributes: {...} }
    if (data && data.post && Array.isArray(data.post)) {
      return data.post;
    }
    // 有时直接返回数组
    if (Array.isArray(data)) {
      return data;
    }
    return [];
  }

  /** 从 Gelbooru 响应中提取标签数组 */
  private extractTags(data: any): GelbooruRawTag[] {
    if (data && data.tag && Array.isArray(data.tag)) {
      return data.tag;
    }
    if (Array.isArray(data)) {
      return data;
    }
    return [];
  }

  // ========= 帖子相关 =========

  async getPosts(params: {
    page?: number;
    limit?: number;
    tags?: string[];
  }): Promise<BooruPostData[]> {
    try {
      // Gelbooru 使用 pid（从 0 开始的页码）
      const page = params.page || 1;
      const queryParams: any = {
        page: 'dapi',
        s: 'post',
        q: 'index',
        json: 1,
        pid: page - 1,    // 转换为 0-based
        limit: params.limit || 20,
        ...this.getAuthParams(),
      };
      if (params.tags && params.tags.length > 0) {
        queryParams.tags = params.tags.join(' ');
      }

      console.log('[GelbooruClient] 获取帖子:', queryParams);

      await this.rateLimiter.acquire();
      const response = await this.client.get('/index.php', { params: queryParams });

      const posts = this.extractPosts(response.data);
      console.log('[GelbooruClient] 获取帖子成功，数量:', posts.length);
      return posts.map(p => this.convertPost(p));
    } catch (error: any) {
      console.error('[GelbooruClient] 获取帖子失败:', error.message);
      throw error;
    }
  }

  async getPopularRecent(_period: '1day' | '1week' | '1month' = '1day'): Promise<BooruPostData[]> {
    // Gelbooru 没有独立的热门端点，通过 sort:score 搜索模拟
    console.log('[GelbooruClient] 获取热门帖子（通过 sort:score 模拟）');
    return this.getPosts({ page: 1, limit: 20, tags: ['sort:score'] });
  }

  async getPopularByDay(date: string): Promise<BooruPostData[]> {
    // Gelbooru 不支持按日期热门，用日期范围+评分排序模拟
    console.log('[GelbooruClient] 获取指定日期热门（模拟）:', date);
    return this.getPosts({ page: 1, limit: 20, tags: ['sort:score', `date:${date}`] });
  }

  async getPopularByWeek(date: string): Promise<BooruPostData[]> {
    console.log('[GelbooruClient] 获取指定周热门（模拟）:', date);
    return this.getPosts({ page: 1, limit: 20, tags: ['sort:score'] });
  }

  async getPopularByMonth(date: string): Promise<BooruPostData[]> {
    console.log('[GelbooruClient] 获取指定月热门（模拟）:', date);
    return this.getPosts({ page: 1, limit: 20, tags: ['sort:score'] });
  }

  // ========= 收藏/投票 =========

  async favoritePost(id: number): Promise<void> {
    try {
      const auth = this.getAuthParams();
      if (!auth.api_key || !auth.user_id) {
        throw new Error('Authentication required');
      }

      console.log('[GelbooruClient] 收藏帖子:', id);

      await this.rateLimiter.acquire();
      await this.client.get('/index.php', {
        params: {
          page: 'dapi',
          s: 'favorite',
          q: 'index',
          json: 1,
          id,
          ...auth,
        }
      });
    } catch (error: any) {
      console.error('[GelbooruClient] 收藏帖子失败:', error.message);
      throw error;
    }
  }

  async unfavoritePost(id: number): Promise<void> {
    try {
      const auth = this.getAuthParams();
      if (!auth.api_key || !auth.user_id) {
        throw new Error('Authentication required');
      }

      console.log('[GelbooruClient] 取消收藏帖子:', id);

      await this.rateLimiter.acquire();
      // Gelbooru 取消收藏需要通过 page=favorites&s=delete
      await this.client.get('/index.php', {
        params: {
          page: 'favorites',
          s: 'delete',
          id,
          ...auth,
        }
      });
    } catch (error: any) {
      console.error('[GelbooruClient] 取消收藏帖子失败:', error.message);
      throw error;
    }
  }

  async votePost(_id: number, _score: 1 | 0 | -1): Promise<void> {
    // Gelbooru 不支持公开的投票 API
    console.warn('[GelbooruClient] votePost 不支持');
  }

  async getServerFavorites(page: number = 1, limit: number = 20): Promise<BooruPostData[]> {
    try {
      const auth = this.getAuthParams();
      if (!auth.user_id) {
        throw new Error('Authentication required');
      }

      console.log('[GelbooruClient] 获取服务端收藏:', auth.user_id, '页码:', page);

      await this.rateLimiter.acquire();
      // Gelbooru 通过 fav:{user_id} 标签搜索收藏
      const response = await this.client.get('/index.php', {
        params: {
          page: 'dapi',
          s: 'post',
          q: 'index',
          json: 1,
          pid: page - 1,
          limit,
          tags: `fav:${auth.user_id}`,
          ...auth,
        }
      });

      const posts = this.extractPosts(response.data);
      console.log('[GelbooruClient] 获取服务端收藏成功:', posts.length, '张');
      return posts.map(p => this.convertPost(p));
    } catch (error: any) {
      console.error('[GelbooruClient] 获取服务端收藏失败:', error.message);
      throw error;
    }
  }

  async getFavoriteUsers(_postId: number): Promise<any[]> {
    // Gelbooru 不支持获取收藏用户列表
    console.log('[GelbooruClient] getFavoriteUsers 不支持，返回空数组');
    return [];
  }

  // ========= 标签相关 =========

  async getTags(params: { query?: string; limit?: number }): Promise<BooruTagData[]> {
    try {
      const queryParams: any = {
        page: 'dapi',
        s: 'tag',
        q: 'index',
        json: 1,
        limit: params.limit || 10,
        orderby: 'count',
        ...this.getAuthParams(),
      };
      if (params.query) {
        queryParams.name_pattern = `%${params.query}%`;
      }

      console.log('[GelbooruClient] 搜索标签:', queryParams);

      await this.rateLimiter.acquire();
      const response = await this.client.get('/index.php', { params: queryParams });

      const tags = this.extractTags(response.data);
      return tags.map(t => ({
        id: t.id,
        name: t.tag,        // Gelbooru 用 "tag" 字段
        count: t.count,
        type: t.type,
        ambiguous: t.ambiguous === 1,
      }));
    } catch (error: any) {
      console.error('[GelbooruClient] 搜索标签失败:', error.message);
      throw error;
    }
  }

  async getTagsByNames(names: string[]): Promise<BooruTagData[]> {
    try {
      if (names.length === 0) return [];

      if (names.length <= 10) {
        console.log('[GelbooruClient] 获取标签详情:', names);
      } else {
        console.log(`[GelbooruClient] 获取标签详情: ${names.length} 个标签`);
      }

      const results: BooruTagData[] = [];

      // Gelbooru 不支持批量查询，逐个查询
      for (const tagName of names) {
        try {
          await this.rateLimiter.acquire();
          const response = await this.client.get('/index.php', {
            params: {
              page: 'dapi',
              s: 'tag',
              q: 'index',
              json: 1,
              name: tagName,
              limit: 1,
              ...this.getAuthParams(),
            }
          });

          const tags = this.extractTags(response.data);
          const exactMatch = tags.find(t => t.tag === tagName);
          if (exactMatch) {
            results.push({
              id: exactMatch.id,
              name: exactMatch.tag,
              count: exactMatch.count,
              type: exactMatch.type,
              ambiguous: exactMatch.ambiguous === 1,
            });
          }
        } catch (error) {
          console.warn(`[GelbooruClient] 获取标签 "${tagName}" 失败:`, error);
        }
      }

      if (names.length > 10) {
        console.log(`[GelbooruClient] 成功获取 ${results.length}/${names.length} 个标签信息`);
      }
      return results;
    } catch (error: any) {
      console.error('[GelbooruClient] 获取标签详情失败:', error.message);
      throw error;
    }
  }

  async getTagSummary(): Promise<BooruTagSummaryData> {
    // Gelbooru 不支持标签摘要
    console.log('[GelbooruClient] getTagSummary 不支持，返回空数据');
    return { version: 0, data: '' };
  }

  parseTagSummary(_data: string): Map<string, number> {
    return new Map();
  }

  // ========= 评论相关 =========

  async getComments(postId?: number): Promise<BooruCommentData[]> {
    try {
      const queryParams: any = {
        page: 'dapi',
        s: 'comment',
        q: 'index',
        json: 1,
        ...this.getAuthParams(),
      };
      if (postId) {
        queryParams.post_id = postId;
      }

      console.log('[GelbooruClient] 获取评论:', postId ? `帖子 ${postId}` : '全部');

      await this.rateLimiter.acquire();
      const response = await this.client.get('/index.php', { params: queryParams });

      let comments: GelbooruRawComment[] = [];
      if (response.data && Array.isArray(response.data)) {
        comments = response.data;
      } else if (response.data && response.data.comment && Array.isArray(response.data.comment)) {
        comments = response.data.comment;
      }

      return comments.map(c => ({
        id: c.id,
        post_id: c.post_id,
        body: c.body,
        creator: c.creator || `User#${c.creator_id}`,
        creator_id: c.creator_id,
        created_at: c.created_at,
      }));
    } catch (error: any) {
      console.error('[GelbooruClient] 获取评论失败:', error.message);
      throw error;
    }
  }

  async createComment(_postId: number, _body: string): Promise<any> {
    // Gelbooru 的评论创建不通过 dapi，需要网页表单提交
    console.warn('[GelbooruClient] createComment 不支持（需要网页端操作）');
    throw new Error('Gelbooru 不支持通过 API 创建评论');
  }

  // ========= Pool 相关 =========

  async getPools(_params?: { query?: string; page?: number }): Promise<BooruPoolData[]> {
    // Gelbooru 的 Pool 支持有限
    console.warn('[GelbooruClient] getPools 支持有限');

    try {
      const queryParams: any = {
        page: 'dapi',
        s: 'pool',
        q: 'index',
        json: 1,
        ...this.getAuthParams(),
      };

      await this.rateLimiter.acquire();
      const response = await this.client.get('/index.php', { params: queryParams });

      let pools: any[] = [];
      if (Array.isArray(response.data)) {
        pools = response.data;
      } else if (response.data && Array.isArray(response.data.pool)) {
        pools = response.data.pool;
      }

      return pools.map((p: any) => ({
        id: p.id,
        name: p.title || p.name || '',
        description: p.description || '',
        post_count: p.post_count || 0,
        created_at: p.created_at || '',
        updated_at: p.updated_at,
        is_public: true,
      }));
    } catch (error: any) {
      console.error('[GelbooruClient] 获取 Pool 列表失败:', error.message);
      return [];
    }
  }

  async getPool(id: number, page?: number): Promise<BooruPoolDetailData> {
    try {
      console.log('[GelbooruClient] 获取 Pool 详情:', id);

      await this.rateLimiter.acquire();
      const response = await this.client.get('/index.php', {
        params: {
          page: 'dapi',
          s: 'pool',
          q: 'index',
          json: 1,
          id,
          ...this.getAuthParams(),
        }
      });

      let poolData: any = {};
      if (Array.isArray(response.data) && response.data.length > 0) {
        poolData = response.data[0];
      } else if (response.data && !Array.isArray(response.data)) {
        poolData = response.data;
      }

      // 获取 Pool 中的帖子
      let posts: BooruPostData[] = [];
      if (poolData.post_ids || poolData.posts) {
        const postIds = poolData.post_ids || poolData.posts || [];
        if (Array.isArray(postIds) && postIds.length > 0) {
          const pageSize = 20;
          const pageNum = page || 1;
          const startIdx = (pageNum - 1) * pageSize;
          const batch = postIds.slice(startIdx, startIdx + pageSize);

          if (batch.length > 0) {
            posts = await this.getPosts({
              page: 1,
              limit: batch.length,
              tags: [`id:${batch.join(',')}`],
            });
          }
        }
      }

      return {
        id: poolData.id || id,
        name: poolData.title || poolData.name || '',
        description: poolData.description || '',
        post_count: poolData.post_count || 0,
        created_at: poolData.created_at || '',
        updated_at: poolData.updated_at,
        is_public: true,
        posts,
      };
    } catch (error: any) {
      console.error('[GelbooruClient] 获取 Pool 详情失败:', error.message);
      throw error;
    }
  }

  // ========= 艺术家 =========

  /**
   * 获取艺术家信息
   * Gelbooru 不支持独立的艺术家 API，返回 null
   */
  async getArtist(_name: string): Promise<BooruArtistData | null> {
    console.log('[GelbooruClient] Gelbooru 不支持艺术家 API');
    return null;
  }

  async getWiki(_title: string): Promise<BooruWikiData | null> {
    console.log('[GelbooruClient] Gelbooru 不支持 Wiki API');
    return null;
  }

  async getForumTopics(_params?: { page?: number; limit?: number }): Promise<BooruForumTopicData[]> {
    console.log('[GelbooruClient] Gelbooru 不支持论坛 API');
    return [];
  }

  async getForumPosts(_topicId: number, _params?: { page?: number; limit?: number }): Promise<BooruForumPostData[]> {
    console.log('[GelbooruClient] Gelbooru 不支持论坛 API');
    return [];
  }

  async getProfile(): Promise<BooruUserProfileData | null> {
    console.log('[GelbooruClient] Gelbooru 不支持用户主页 API');
    return null;
  }

  async getUserProfile(_params: { userId?: number; username?: string }): Promise<BooruUserProfileData | null> {
    console.log('[GelbooruClient] Gelbooru 不支持用户主页 API');
    return null;
  }

  async getNotes(_postId: number): Promise<BooruNoteData[]> {
    return [];
  }

  async getPostVersions(_postId: number): Promise<BooruPostVersionData[]> {
    return [];
  }

  // ========= 认证/测试 =========

  async testAuth(): Promise<{ valid: boolean; error?: string }> {
    try {
      const auth = this.getAuthParams();
      if (!auth.api_key || !auth.user_id) {
        return { valid: false, error: '缺少 API Key 或 User ID' };
      }

      console.log('[GelbooruClient] 测试认证:', auth.user_id);

      // Gelbooru 没有专门的认证测试端点，尝试获取收藏列表验证
      await this.rateLimiter.acquire();
      const response = await this.client.get('/index.php', {
        params: {
          page: 'dapi',
          s: 'post',
          q: 'index',
          json: 1,
          limit: 1,
          ...auth,
        }
      });

      // 如果请求成功，认为认证有效
      if (response.status === 200) {
        console.log('[GelbooruClient] 认证测试成功');
        return { valid: true };
      }

      return { valid: false, error: '认证响应异常' };
    } catch (error: any) {
      const status = error.response?.status;
      if (status === 401 || status === 403) {
        return { valid: false, error: 'API Key 或 User ID 错误' };
      }
      return { valid: false, error: '网络错误: ' + error.message };
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.getPosts({ page: 1, limit: 1 });
      console.log('[GelbooruClient] 连接测试成功');
      return true;
    } catch (error) {
      console.error('[GelbooruClient] 连接测试失败:', error);
      return false;
    }
  }
}

export default GelbooruClient;
