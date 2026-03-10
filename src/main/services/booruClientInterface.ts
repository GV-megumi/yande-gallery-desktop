/**
 * Booru 客户端统一接口
 * 所有 Booru 类型（Moebooru、Danbooru、Gelbooru）的客户端都实现此接口
 * 使用策略模式，通过 createBooruClient() 工厂函数按站点类型创建对应客户端
 */

// ========= 统一数据类型 =========

/** 统一的 Post 响应格式（各客户端内部转换为此格式） */
export interface BooruPostData {
  id: number;
  tags: string;             // 空格分隔的标签字符串
  created_at: number | string;
  author: string;
  source: string;
  score: number;
  md5: string;
  file_size: number;
  file_url: string;
  preview_url: string;
  sample_url: string;
  width: number;
  height: number;
  rating: 's' | 'q' | 'e';
  has_children: boolean;
  parent_id?: number;
  status: string;
  // sample/jpeg 变体尺寸
  preview_width?: number;
  preview_height?: number;
  sample_width?: number;
  sample_height?: number;
  jpeg_url?: string;
  jpeg_width?: number;
  jpeg_height?: number;
}

/** 统一的 Tag 响应格式 */
export interface BooruTagData {
  id: number;
  name: string;
  count: number;
  type: number;           // 0=general, 1=artist, 3=copyright, 4=character, 5=meta
  ambiguous: boolean;
}

/** 统一的评论格式 */
export interface BooruCommentData {
  id: number;
  post_id: number;
  body: string;
  creator: string;
  creator_id: number;
  created_at: string;
}

/** 统一的 Pool 格式 */
export interface BooruPoolData {
  id: number;
  name: string;
  description?: string;
  post_count: number;
  created_at: string;
  updated_at?: string;
  is_public: boolean;
  user_id?: number;
}

/** Pool 详情（含图片列表） */
export interface BooruPoolDetailData extends BooruPoolData {
  posts: BooruPostData[];
}

/** 标签摘要（仅 Moebooru 支持，其他类型返回空） */
export interface BooruTagSummaryData {
  version: number;
  data: string;
}

/** 客户端配置 */
export interface BooruClientConfig {
  baseUrl: string;
  login?: string;
  passwordHash?: string;
  apiKey?: string;
  timeout?: number;
}

// ========= 标签类型映射 =========

/** 标签类型数字到文字的映射（通用） */
export const TAG_TYPE_MAP: Record<number, 'general' | 'artist' | 'copyright' | 'character' | 'meta'> = {
  0: 'general',
  1: 'artist',
  3: 'copyright',
  4: 'character',
  5: 'meta'
};

/** 评级字符到文字的映射 */
export const RATING_MAP: Record<string, 'safe' | 'questionable' | 'explicit'> = {
  's': 'safe',
  'q': 'questionable',
  'e': 'explicit',
  'g': 'safe',         // Danbooru 使用 'g' (general) 代替 's'
  'sensitive': 'questionable' // Danbooru 的 sensitive 评级
};

// ========= 统一接口定义 =========

/**
 * Booru 客户端统一接口
 * 各站点客户端必须实现的方法
 */
export interface IBooruClient {
  /** 站点类型标识 */
  readonly siteType: 'moebooru' | 'danbooru' | 'gelbooru';

  // --- 帖子相关 ---

  /** 获取帖子列表 */
  getPosts(params: {
    page?: number;
    limit?: number;
    tags?: string[];
  }): Promise<BooruPostData[]>;

  /** 获取近期热门帖子 */
  getPopularRecent(period?: '1day' | '1week' | '1month'): Promise<BooruPostData[]>;

  /** 获取指定日期热门帖子 */
  getPopularByDay(date: string): Promise<BooruPostData[]>;

  /** 获取指定周热门帖子 */
  getPopularByWeek(date: string): Promise<BooruPostData[]>;

  /** 获取指定月热门帖子 */
  getPopularByMonth(date: string): Promise<BooruPostData[]>;

  // --- 收藏/投票 ---

  /** 收藏帖子 */
  favoritePost(id: number): Promise<void>;

  /** 取消收藏帖子 */
  unfavoritePost(id: number): Promise<void>;

  /** 投票（1=up, 0=neutral, -1=down） */
  votePost(id: number, score: 1 | 0 | -1): Promise<void>;

  /** 获取服务端收藏列表 */
  getServerFavorites(page?: number, limit?: number): Promise<BooruPostData[]>;

  /** 获取收藏该帖子的用户列表 */
  getFavoriteUsers(postId: number): Promise<any[]>;

  // --- 标签相关 ---

  /** 搜索标签 */
  getTags(params: { query?: string; limit?: number }): Promise<BooruTagData[]>;

  /** 按名称批量获取标签信息 */
  getTagsByNames(names: string[]): Promise<BooruTagData[]>;

  /** 获取标签摘要（仅 Moebooru 支持，其他返回空数据） */
  getTagSummary(): Promise<BooruTagSummaryData>;

  /** 解析标签摘要（仅 Moebooru 使用） */
  parseTagSummary(data: string): Map<string, number>;

  // --- 评论相关 ---

  /** 获取评论 */
  getComments(postId?: number): Promise<BooruCommentData[]>;

  /** 创建评论 */
  createComment(postId: number, body: string): Promise<any>;

  // --- Pool 相关 ---

  /** 获取 Pool 列表 */
  getPools(params?: { query?: string; page?: number }): Promise<BooruPoolData[]>;

  /** 获取 Pool 详情 */
  getPool(id: number, page?: number): Promise<BooruPoolDetailData>;

  // --- 认证/测试 ---

  /** 测试认证是否有效 */
  testAuth(): Promise<{ valid: boolean; error?: string }>;

  /** 测试连接 */
  testConnection(): Promise<boolean>;
}

// ========= 共享工具类 =========

/**
 * 简单令牌桶限流器
 * 控制单位时间内的最大请求数，防止触发服务端 429
 * 由各 Booru 客户端共享使用
 */
export class RateLimiter {
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
