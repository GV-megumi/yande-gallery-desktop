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
 * Moebooru API客户端
 * 参考: example/Boorusama-master/packages/booru_clients/lib/src/moebooru/moebooru_client.dart
 */
export class MoebooruClient {
  private client: AxiosInstance;
  private config: MoebooruConfig;

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
      console.log('[MoebooruClient] 获取标签详情:', names);

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
        console.log(`[MoebooruClient] 需要查询 ${notFound.length} 个标签`);
        
        for (const tagName of notFound) {
          try {
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
              console.log(`[MoebooruClient] 找到标签 "${tagName}": type=${exactMatch.type} (${TAG_TYPE_MAP[exactMatch.type] || 'unknown'})`);
            } else if (response.data.length > 0) {
              // 如果没有精确匹配，但返回了结果，打印前几个结果用于调试
              console.warn(`[MoebooruClient] 标签 "${tagName}" 未找到精确匹配，返回了 ${response.data.length} 个结果`);
              const firstThree = response.data.slice(0, 3).map((t: MoebooruTagResponse) => `${t.name} (type=${t.type})`);
              console.warn(`[MoebooruClient] 前3个结果:`, firstThree);
              
              // 尝试查找部分匹配（标签名包含在结果中）
              const partialMatch = response.data.find((tag: MoebooruTagResponse) => 
                tag.name.toLowerCase().includes(tagName.toLowerCase()) || 
                tagName.toLowerCase().includes(tag.name.toLowerCase())
              );
              if (partialMatch) {
                console.warn(`[MoebooruClient] 找到部分匹配: "${partialMatch.name}"，但跳过（需要精确匹配）`);
              }
            } else {
              console.warn(`[MoebooruClient] 标签 "${tagName}" 查询返回空数组`);
            }
          }
          } catch (error) {
            console.warn(`[MoebooruClient] 获取标签 "${tagName}" 失败:`, error);
            // 继续处理下一个标签
          }
        }
      }

      console.log(`[MoebooruClient] 成功获取 ${results.length}/${names.length} 个标签信息`);
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
