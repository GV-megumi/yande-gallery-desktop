import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import crypto from 'crypto';
import { getProxyConfig } from './config.js';

// Moebooru API配置
export interface MoebooruConfig {
  baseUrl: string;
  login?: string;
  passwordHash?: string;
  apiKey?: string;
  timeout?: number;
}

// Moebooru认证参数
export interface MoebooruAuth {
  login?: string;
  password_hash?: string;
  api_key?: string;
}

// API响应中的Post数据
export interface MoebooruPostResponse {
  id: number;
  tags: string;
  created_at: number;
  creator_id: number;
  author: string;
  change: number;
  source: string;
  score: number;
  md5: string;
  file_size: number;
  file_url: string;
  is_shown_in_index: boolean;
  preview_url: string;
  preview_width: number;
  preview_height: number;
  actual_preview_width: number;
  actual_preview_height: number;
  sample_url: string;
  sample_width: number;
  sample_height: number;
  sample_file_size: number;
  jpeg_url: string;
  jpeg_width: number;
  jpeg_height: number;
  jpeg_file_size: number;
  rating: 's' | 'q' | 'e';
  has_children: boolean;
  parent_id?: number;
  status: string;
  width: number;
  height: number;
  is_held: boolean;
  frames_pending_string: string;
  frames_pending: any[];
  frames_string: string;
  frames: any[];
}

// 标签响应数据
export interface MoebooruTagResponse {
  id: number;
  name: string;
  count: number;
  type: number;
  ambiguous: boolean;
}

// 标签类型映射
export const TAG_TYPE_MAP: Record<number, 'general' | 'artist' | 'copyright' | 'character' | 'meta'> = {
  0: 'general',
  1: 'artist',
  3: 'copyright',
  4: 'character',
  5: 'meta'
};

// 评级的字符到文字映射
export const RATING_MAP: Record<string, 'safe' | 'questionable' | 'explicit'> = {
  's': 'safe',
  'q': 'questionable',
  'e': 'explicit'
};

/**
 * 密码哈希算法（Moebooru标准）
 * @param salt - 盐值，格式如 "choujin-steiner--{0}--"
 * @param password - 密码
 * @returns SHA1哈希值
 */
export function hashPasswordSHA1(salt: string, password: string): string {
  const saltedPassword = salt.replace('{0}', password);
  return crypto.createHash('sha1').update(saltedPassword).digest('hex');
}

/**
 * 简单令牌桶限流器
 * 控制单位时间内的最大请求数，防止触发服务端 429
 */
class RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillIntervalMs: number;
  private lastRefill: number;

  /**
   * @param maxRequests 最大突发请求数
   * @param perMs 令牌补充周期（毫秒）
   */
  constructor(maxRequests: number = 5, perMs: number = 1000) {
    this.maxTokens = maxRequests;
    this.tokens = maxRequests;
    this.refillIntervalMs = perMs;
    this.lastRefill = Date.now();
  }

  /** 等待一个可用令牌 */
  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return;
    }
    // 等待下一个令牌补充
    const waitMs = this.refillIntervalMs - (Date.now() - this.lastRefill);
    if (waitMs > 0) {
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    this.refill();
    this.tokens = Math.max(0, this.tokens - 1);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed >= this.refillIntervalMs) {
      const periods = Math.floor(elapsed / this.refillIntervalMs);
      this.tokens = Math.min(this.maxTokens, this.tokens + periods);
      this.lastRefill += periods * this.refillIntervalMs;
    }
  }
}

/**
 * Moebooru API客户端
 * 参考: example/Boorusama-master/packages/booru_clients/lib/src/moebooru/moebooru_client.dart
 */
export class MoebooruClient {
  private client: AxiosInstance;
  private config: MoebooruConfig;
  // 请求限流器：最多 2 请求/秒（Yande.re 限制 2 req/s，Konachan 限制 1 req/s）
  private rateLimiter = new RateLimiter(2, 1000);

  constructor(config: MoebooruConfig) {
    this.config = config;

    // 获取代理配置
    const proxyConfig = getProxyConfig();
    console.log('[MoebooruClient] 代理配置:', proxyConfig ? `${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}` : '无');

    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout || 30000,
      headers: {
        'User-Agent': 'YandeGalleryDesktop/1.0.0'
      },
      // 禁用自动重定向（防止https被重定向到http）
      maxRedirects: 5,
      // 添加代理配置
      proxy: proxyConfig
    });

    // 请求拦截器，用于调试
    this.client.interceptors.request.use(
      (config) => {
        console.log('[MoebooruClient] 请求:', config.method?.toUpperCase(), config.url, config.params);
        return config;
      },
      (error) => {
        console.error('[MoebooruClient] 请求错误:', error);
        return Promise.reject(error);
      }
    );

    // 响应拦截器
    this.client.interceptors.response.use(
      (response) => {
        console.log('[MoebooruClient] 响应:', response.status, response.config.url);
        return response;
      },
      (error) => {
        console.error('[MoebooruClient] 响应错误:', error.message);
        if (error.response) {
          console.error('[MoebooruClient] 错误详情:', error.response.status, error.response.data);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * 获取认证参数
   */
  private getAuthParams(): MoebooruAuth {
    const auth: MoebooruAuth = {};

    if (this.config.login && this.config.passwordHash) {
      auth.login = this.config.login;
      auth.password_hash = this.config.passwordHash;
    }

    if (this.config.apiKey) {
      auth.api_key = this.config.apiKey;
    }

    return auth;
  }

  /**
   * 获取图片列表
   * @param params - 查询参数
   * @returns 图片列表
   */
  async getPosts(params: {
    page?: number;
    limit?: number;
    tags?: string[];
  }): Promise<MoebooruPostResponse[]> {
    try {
      const queryParams = {
        page: params.page || 1,
        limit: params.limit || 20,
        tags: params.tags?.join(' ') || '',
        ...this.getAuthParams()
      };

      // 详细的调试信息
      console.log('[MoebooruClient] ===== 请求调试信息 =====');
      console.log('[MoebooruClient] 配置的baseURL:', this.config.baseUrl);
      console.log('[MoebooruClient] 请求路径:', '/post.json');
      console.log('[MoebooruClient] 完整URL应该是:', `${this.config.baseUrl}/post.json`);
      console.log('[MoebooruClient] 请求参数:', queryParams);
      console.log('[MoebooruClient] =================================');

      await this.rateLimiter.acquire();
      const response = await this.client.get('/post.json', {
        params: queryParams
      });

      console.log('[MoebooruClient] 请求成功！');
      console.log('[MoebooruClient] 返回数据数量:', Array.isArray(response.data) ? response.data.length : '非数组');
      
      // 调试：打印第一个 post 的 URL 信息
      if (Array.isArray(response.data) && response.data.length > 0) {
        const firstPost = response.data[0];
        console.log('[MoebooruClient] 第一个 post 的 URL 信息:', {
          id: firstPost.id,
          file_url: firstPost.file_url,
          preview_url: firstPost.preview_url,
          sample_url: firstPost.sample_url,
          file_url_type: typeof firstPost.file_url,
          preview_url_type: typeof firstPost.preview_url
        });
      }
      
      return response.data;
    } catch (error: any) {
      console.error('[MoebooruClient] 请求失败！');
      console.error('[MoebooruClient] 错误信息:', error.message);
      if (error.config) {
        console.error('[MoebooruClient] axios配置:', {
          baseURL: error.config.baseURL,
          url: error.config.url,
          method: error.config.method
        });
      }
      throw error;
    }
  }

  /**
   * 获取单个图片详情
   * @param id - 图片ID
   * @returns 图片详情
   */
  async getPost(id: number): Promise<MoebooruPostResponse> {
    try {
      const params = {
        ...this.getAuthParams()
      };

      console.log('[MoebooruClient] 获取图片详情:', id);

      await this.rateLimiter.acquire();
      const response = await this.client.get(`/post.json`, {
        params: { tags: `id:${id}`, ...params }
      });

      if (!response.data || response.data.length === 0) {
        throw new Error('Post not found');
      }

      return response.data[0];
    } catch (error) {
      console.error(`[MoebooruClient] 获取图片 ${id} 详情失败:`, error);
      throw error;
    }
  }

  /**
   * 搜索标签
   * @param query - 搜索关键词（标签名）
   * @param limit - 返回数量限制
   * @returns 标签列表
   */
  async getTags(params: {
    query?: string;
    limit?: number;
  }): Promise<MoebooruTagResponse[]> {
    try {
      const queryParams = {
        name: params.query || '',
        limit: params.limit || 10,
        order: 'count',
        ...this.getAuthParams()
      };

      console.log('[MoebooruClient] 搜索标签:', queryParams);

      await this.rateLimiter.acquire();
      const response = await this.client.get('/tag.json', {
        params: queryParams
      });

      return response.data;
    } catch (error) {
      console.error('[MoebooruClient] 搜索标签失败:', error);
      throw error;
    }
  }

  /**
   * 从标签摘要中获取指定标签的分类信息
   * 优先使用 tag/summary.json，如果失败则回退到逐个查询
   * @param names - 标签名称列表
   * @returns 标签列表
   */
  async getTagsByNames(names: string[]): Promise<MoebooruTagResponse[]> {
    try {
      // 只在标签数量较少时输出日志，避免批量查询时日志过多
      if (names.length <= 10) {
        console.log('[MoebooruClient] 获取标签详情:', names);
      } else {
        console.log(`[MoebooruClient] 获取标签详情: ${names.length} 个标签`);
      }

      const results: MoebooruTagResponse[] = [];
      
      // 方法1: 优先使用 tag/summary.json 获取所有标签分类（一次性获取所有标签）
      try {
        const tagSummary = await this.getTagSummary();
        const tagCategoryMap = this.parseTagSummary(tagSummary.data);
        
        // 从摘要中查找标签分类
        for (const tagName of names) {
          const category = tagCategoryMap.get(tagName);
          if (category !== undefined) {
            results.push({
              id: 0, // 摘要中没有 ID
              name: tagName,
              count: 0, // 摘要中没有 count
              type: category,
              ambiguous: false
            });
          }
        }
        
        if (results.length === names.length) {
          console.log(`[MoebooruClient] 从标签摘要中成功获取所有 ${results.length} 个标签信息`);
          return results;
        } else {
          console.log(`[MoebooruClient] 从标签摘要中获取了 ${results.length}/${names.length} 个标签，继续查询剩余的`);
        }
      } catch (error) {
        console.warn('[MoebooruClient] 从标签摘要获取标签失败，使用逐个查询:', error);
      }
      
      // 方法2: 对于未找到的标签，使用 tag.json 逐个查询
      const notFound = names.filter(name => !results.find(r => r.name === name));
      if (notFound.length > 0) {
        // 只在需要查询的标签数量较多时才输出日志
        if (notFound.length > 10) {
          console.log(`[MoebooruClient] 需要查询 ${notFound.length} 个标签`);
        }
        
        for (const tagName of notFound) {
          try {
          // 限流：防止批量查询时触发 429
          await this.rateLimiter.acquire();
          // 尝试使用 name 参数（精确匹配）
          let response;
          try {
            response = await this.client.get('/tag.json', {
              params: {
                name: tagName, // 先尝试 name 参数
                limit: 1,
                ...this.getAuthParams()
              }
            });
          } catch (error) {
            await this.rateLimiter.acquire();
            // 如果 name 参数失败，尝试 name_pattern
            response = await this.client.get('/tag.json', {
              params: {
                name_pattern: tagName,
                limit: 100, // 增加限制
                ...this.getAuthParams()
              }
            });
          }

          if (Array.isArray(response.data)) {
            // 在返回的结果中查找精确匹配的标签
            const exactMatch = response.data.find((tag: MoebooruTagResponse) => tag.name === tagName);
            if (exactMatch) {
              results.push(exactMatch);
              // 只在标签数量较少时输出详细日志（避免批量查询时日志过多）
              if (notFound.length <= 5) {
                console.log(`[MoebooruClient] 找到标签 "${tagName}": type=${exactMatch.type} (${TAG_TYPE_MAP[exactMatch.type] || 'unknown'})`);
              }
            } else if (response.data.length > 0) {
              // 如果没有精确匹配，但返回了结果，静默处理（不输出日志，减少干扰）
              // 尝试查找部分匹配（标签名包含在结果中）
              const partialMatch = response.data.find((tag: MoebooruTagResponse) => 
                tag.name.toLowerCase().includes(tagName.toLowerCase()) || 
                tagName.toLowerCase().includes(tag.name.toLowerCase())
              );
              // 部分匹配也不输出日志，减少日志噪音
            }
            // 空数组也不输出警告，减少日志噪音
          }
          } catch (error) {
            console.warn(`[MoebooruClient] 获取标签 "${tagName}" 失败:`, error);
            // 继续处理下一个标签
          }
        }
      }

      // 只在查询了大量标签时才输出完成日志
      if (names.length > 10) {
        console.log(`[MoebooruClient] 成功获取 ${results.length}/${names.length} 个标签信息`);
      }
      return results;
    } catch (error) {
      console.error('[MoebooruClient] 获取标签详情失败:', error);
      throw error;
    }
  }

  /**
   * 获取标签摘要（所有标签的分类信息）
   * 返回格式：{ version: number, data: string }
   * data 格式：每个标签用空格分隔，每个标签的格式是 category`name`otherName1`otherName2...
   */
  async getTagSummary(): Promise<{
    version: number;
    data: string;
  }> {
    try {
      const queryParams = {
        ...this.getAuthParams()
      };

      console.log('[MoebooruClient] 获取标签摘要');

      await this.rateLimiter.acquire();
      const response = await this.client.get('/tag/summary.json', {
        params: queryParams
      });

      return {
        version: response.data.version || 0,
        data: response.data.data || ''
      };
    } catch (error) {
      console.error('[MoebooruClient] 获取标签摘要失败:', error);
      throw error;
    }
  }

  /**
   * 从标签摘要中解析标签分类信息
   * @param tagSummaryData - tag/summary.json 返回的 data 字符串
   * @returns 标签名到分类的映射
   */
  parseTagSummary(tagSummaryData: string): Map<string, number> {
    const tagMap = new Map<string, number>();
    
    if (!tagSummaryData || tagSummaryData.trim() === '') {
      return tagMap;
    }

    // 数据格式：每个标签用空格分隔，每个标签的格式是 category`name`otherName1`otherName2...
    const tagDataList = tagSummaryData.split(' ');

    for (const tagData of tagDataList) {
      if (!tagData || tagData.trim() === '') {
        continue;
      }

      // 用反引号分隔字段
      const tagFields = tagData.split('`');
      
      if (tagFields.length < 2) {
        continue;
      }

      const category = parseInt(tagFields[0], 10);
      const name = tagFields[1];

      if (!isNaN(category) && name) {
        // 主标签名
        tagMap.set(name, category);
        
        // 其他名称（别名）
        for (let i = 2; i < tagFields.length; i++) {
          const otherName = tagFields[i];
          if (otherName && otherName.trim() !== '') {
            tagMap.set(otherName, category);
          }
        }
      }
    }

    console.log(`[MoebooruClient] 从标签摘要中解析出 ${tagMap.size} 个标签分类信息`);
    return tagMap;
  }

  /**
   * 收藏图片
   * @param id - 图片ID
   */
  async favoritePost(id: number): Promise<void> {
    try {
      const auth = this.getAuthParams();

      if (!auth.login || !auth.password_hash) {
        throw new Error('Authentication required');
      }

      const params = {
        id,
        ...auth
      };

      console.log('[MoebooruClient] 收藏图片:', id);

      await this.client.post('/post/vote.json', null, {
        params: {
          ...params,
          score: 3 // 3 表示收藏
        }
      });
    } catch (error) {
      console.error(`[MoebooruClient] 收藏图片 ${id} 失败:`, error);
      throw error;
    }
  }

  /**
   * 取消收藏图片
   * @param id - 图片ID
   */
  async unfavoritePost(id: number): Promise<void> {
    try {
      const auth = this.getAuthParams();

      if (!auth.login || !auth.password_hash) {
        throw new Error('Authentication required');
      }

      console.log('[MoebooruClient] 取消收藏图片:', id);

      // 取消收藏通常是通过删除投票实现的
      // 注意：不同的Moebooru站点可能有不同的实现
      await this.client.post('/post/vote.json', null, {
        params: {
          id,
          ...auth,
          score: 0
        }
      });
    } catch (error) {
      console.error(`[MoebooruClient] 取消收藏图片 ${id} 失败:`, error);
      throw error;
    }
  }

  /**
   * 为图片投票
   * @param id - 图片ID
   * @param score - 分数（1=up, 0=neutral, -1=down）
   */
  async votePost(id: number, score: 1 | 0 | -1): Promise<void> {
    try {
      const auth = this.getAuthParams();

      if (!auth.login || !auth.password_hash) {
        throw new Error('Authentication required');
      }

      // 将分数转换为Moebooru格式
      // Moebooru使用 3=up, 2=neutral, 1=down
      const moebooruScore = score === 1 ? 3 : score === 0 ? 2 : 1;

      console.log('[MoebooruClient] 为图片投票:', id, '分数:', score);

      await this.client.post('/post/vote.json', null, {
        params: {
          id,
          ...auth,
          score: moebooruScore
        }
      });
    } catch (error) {
      console.error(`[MoebooruClient] 为图片 ${id} 投票失败:`, error);
      throw error;
    }
  }

  /**
   * 获取近期热门图片
   * @param period - 时间周期（1day, 1week, 1month）
   */
  async getPopularRecent(period: '1day' | '1week' | '1month' = '1day'): Promise<MoebooruPostResponse[]> {
    try {
      const queryParams = {
        ...this.getAuthParams()
      };

      console.log('[MoebooruClient] 获取近期热门图片:', period);

      const response = await this.client.get(`/post/popular_recent.json`, {
        params: {
          period,
          ...queryParams
        }
      });

      return response.data;
    } catch (error) {
      console.error('[MoebooruClient] 获取近期热门图片失败:', error);
      throw error;
    }
  }

  /**
   * 获取指定日期的热门图片
   * @param date - 日期（YYYY-MM-DD格式）
   */
  async getPopularByDay(date: string): Promise<MoebooruPostResponse[]> {
    try {
      const queryParams = {
        ...this.getAuthParams()
      };

      console.log('[MoebooruClient] 获取指定日期热门图片:', date);

      const response = await this.client.get(`/post/popular_by_day.json`, {
        params: {
          day: date,
          ...queryParams
        }
      });

      return response.data;
    } catch (error) {
      console.error(`[MoebooruClient] 获取 ${date} 热门图片失败:`, error);
      throw error;
    }
  }

  /**
   * 获取评论
   * @param postId - 图片ID（可选，如果提供则只返回该图片的评论）
   */
  async getComments(postId?: number): Promise<any[]> {
    try {
      const queryParams: any = {
        ...this.getAuthParams()
      };

      if (postId) {
        queryParams['post_id'] = postId;
      }

      console.log('[MoebooruClient] 获取评论:', postId ? `图片 ${postId}` : '全部');

      const response = await this.client.get('/comment.json', {
        params: queryParams
      });

      return response.data;
    } catch (error) {
      console.error('[MoebooruClient] 获取评论失败:', error);
      throw error;
    }
  }

  /**
   * 获取收藏该图片的用户列表
   * @param postId - 图片ID
   */
  async getFavoriteUsers(postId: number): Promise<any[]> {
    try {
      const queryParams = {
        id: postId,
        ...this.getAuthParams()
      };

      console.log('[MoebooruClient] 获取收藏用户列表:', postId);

      const response = await this.client.get('/post/favorite_users.json', {
        params: queryParams
      });

      return response.data;
    } catch (error) {
      console.error(`[MoebooruClient] 获取图片 ${postId} 的收藏用户列表失败:`, error);
      throw error;
    }
  }

  /**
   * 获取指定周的热门图片
   * @param date - 日期（YYYY-MM-DD格式，该周内任意一天）
   */
  async getPopularByWeek(date: string): Promise<MoebooruPostResponse[]> {
    try {
      console.log('[MoebooruClient] 获取指定周热门图片:', date);

      await this.rateLimiter.acquire();
      const response = await this.client.get('/post/popular_by_week.json', {
        params: {
          day: date,
          ...this.getAuthParams()
        }
      });

      return response.data;
    } catch (error) {
      console.error(`[MoebooruClient] 获取 ${date} 周热门图片失败:`, error);
      throw error;
    }
  }

  /**
   * 获取指定月的热门图片
   * @param date - 日期（YYYY-MM-DD格式，该月内任意一天）
   */
  async getPopularByMonth(date: string): Promise<MoebooruPostResponse[]> {
    try {
      console.log('[MoebooruClient] 获取指定月热门图片:', date);

      await this.rateLimiter.acquire();
      const response = await this.client.get('/post/popular_by_month.json', {
        params: {
          month: date.substring(0, 7).replace('-', ''), // YYYYMM format
          ...this.getAuthParams()
        }
      });

      return response.data;
    } catch (error) {
      console.error(`[MoebooruClient] 获取 ${date} 月热门图片失败:`, error);
      throw error;
    }
  }

  /**
   * 创建评论
   * @param postId - 图片ID
   * @param body - 评论内容
   */
  async createComment(postId: number, body: string): Promise<any> {
    try {
      const auth = this.getAuthParams();
      if (!auth.login || !auth.password_hash) {
        throw new Error('Authentication required');
      }

      console.log('[MoebooruClient] 创建评论:', postId);

      await this.rateLimiter.acquire();
      const response = await this.client.post('/comment/create.json', null, {
        params: {
          'comment[post_id]': postId,
          'comment[body]': body,
          ...auth
        }
      });

      return response.data;
    } catch (error) {
      console.error(`[MoebooruClient] 创建评论失败:`, error);
      throw error;
    }
  }

  /**
   * 获取 Pool 列表
   * @param params - 查询参数
   */
  async getPools(params?: {
    query?: string;
    page?: number;
  }): Promise<any[]> {
    try {
      console.log('[MoebooruClient] 获取 Pool 列表:', params);

      await this.rateLimiter.acquire();
      const response = await this.client.get('/pool.json', {
        params: {
          query: params?.query || '',
          page: params?.page || 1,
          ...this.getAuthParams()
        }
      });

      return response.data;
    } catch (error) {
      console.error('[MoebooruClient] 获取 Pool 列表失败:', error);
      throw error;
    }
  }

  /**
   * 获取 Pool 详情（包含图片列表）
   * @param id - Pool ID
   * @param page - 页码
   */
  async getPool(id: number, page?: number): Promise<any> {
    try {
      console.log('[MoebooruClient] 获取 Pool 详情:', id);

      await this.rateLimiter.acquire();
      const response = await this.client.get('/pool/show.json', {
        params: {
          id,
          page: page || 1,
          ...this.getAuthParams()
        }
      });

      return response.data;
    } catch (error) {
      console.error(`[MoebooruClient] 获取 Pool ${id} 详情失败:`, error);
      throw error;
    }
  }

  /**
   * 测试认证是否有效
   * 通过尝试投票来验证（不实际投票）
   */
  async testAuth(): Promise<boolean> {
    try {
      const auth = this.getAuthParams();
      if (!auth.login || !auth.password_hash) {
        return false;
      }

      // 尝试获取用户的收藏来验证认证
      await this.rateLimiter.acquire();
      const response = await this.client.get('/post.json', {
        params: {
          tags: `vote:3:${auth.login} order:id_desc`,
          limit: 1,
          ...auth
        }
      });

      console.log('[MoebooruClient] 认证测试成功');
      return true;
    } catch (error: any) {
      if (error.response?.status === 403 || error.response?.status === 401) {
        console.error('[MoebooruClient] 认证测试失败: 无效的凭证');
        return false;
      }
      // 网络错误不代表认证失败
      console.error('[MoebooruClient] 认证测试异常:', error.message);
      throw error;
    }
  }

  /**
   * 测试连接
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getPosts({ page: 1, limit: 1 });
      console.log('[MoebooruClient] 连接测试成功');
      return true;
    } catch (error) {
      console.error('[MoebooruClient] 连接测试失败:', error);
      return false;
    }
  }
}

export default MoebooruClient;
