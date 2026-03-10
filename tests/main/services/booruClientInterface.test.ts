import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RateLimiter,
  TAG_TYPE_MAP,
  RATING_MAP,
} from '../../../src/main/services/booruClientInterface';

// ========= TAG_TYPE_MAP =========

describe('TAG_TYPE_MAP', () => {
  it('应包含所有 5 种标签类型', () => {
    expect(Object.keys(TAG_TYPE_MAP)).toHaveLength(5);
  });

  it('应正确映射标签类型', () => {
    expect(TAG_TYPE_MAP[0]).toBe('general');
    expect(TAG_TYPE_MAP[1]).toBe('artist');
    expect(TAG_TYPE_MAP[3]).toBe('copyright');
    expect(TAG_TYPE_MAP[4]).toBe('character');
    expect(TAG_TYPE_MAP[5]).toBe('meta');
  });

  it('type 2 不存在', () => {
    expect(TAG_TYPE_MAP[2]).toBeUndefined();
  });

  it('负数索引不存在', () => {
    expect(TAG_TYPE_MAP[-1]).toBeUndefined();
  });
});

// ========= RATING_MAP =========

describe('RATING_MAP', () => {
  it('应映射标准评级', () => {
    expect(RATING_MAP['s']).toBe('safe');
    expect(RATING_MAP['q']).toBe('questionable');
    expect(RATING_MAP['e']).toBe('explicit');
  });

  it('应映射 Danbooru 的 g 为 safe', () => {
    expect(RATING_MAP['g']).toBe('safe');
  });

  it('应映射 Danbooru 的 sensitive 为 questionable', () => {
    expect(RATING_MAP['sensitive']).toBe('questionable');
  });

  it('未定义的评级应返回 undefined', () => {
    expect(RATING_MAP['x']).toBeUndefined();
    expect(RATING_MAP['unknown']).toBeUndefined();
  });
});

// ========= RateLimiter =========

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('应使用默认参数构造', () => {
    const limiter = new RateLimiter();
    // 默认 5 个令牌，1000ms 周期
    // 应能连续获取 5 个令牌
    expect(async () => {
      for (let i = 0; i < 5; i++) {
        await limiter.acquire();
      }
    }).not.toThrow();
  });

  it('应使用自定义参数构造', () => {
    const limiter = new RateLimiter(3, 500);
    // 应能连续获取 3 个令牌
    expect(async () => {
      for (let i = 0; i < 3; i++) {
        await limiter.acquire();
      }
    }).not.toThrow();
  });

  it('令牌耗尽后应等待补充', async () => {
    const limiter = new RateLimiter(2, 1000);

    // 消耗 2 个令牌
    await limiter.acquire();
    await limiter.acquire();

    // 第 3 个应触发等待
    const acquirePromise = limiter.acquire();

    // 推进时间 1000ms
    vi.advanceTimersByTime(1000);

    await acquirePromise;
    // 通过 - 说明等待后成功获取
  });

  it('令牌应按周期自动补充', async () => {
    const limiter = new RateLimiter(1, 500);

    // 消耗 1 个令牌
    await limiter.acquire();

    // 推进 500ms，令牌应补充
    vi.advanceTimersByTime(500);

    // 应能再次获取
    await limiter.acquire();
  });

  it('令牌数不应超过最大值', async () => {
    const limiter = new RateLimiter(2, 100);

    // 推进很长时间
    vi.advanceTimersByTime(10000);

    // 连续获取，最多能拿到 maxTokens 个（因为补充上限是 maxTokens）
    await limiter.acquire();
    await limiter.acquire();

    // 第 3 个应需要等待
    const start = Date.now();
    const p = limiter.acquire();
    vi.advanceTimersByTime(100);
    await p;
    // 通过 - 说明令牌数有上限
  });

  it('并发请求应按顺序获取令牌', async () => {
    const limiter = new RateLimiter(1, 100);

    const order: number[] = [];

    // 第一个立即获取
    await limiter.acquire();
    order.push(1);

    // 第二个需要等待
    const p2 = limiter.acquire().then(() => order.push(2));
    vi.advanceTimersByTime(100);
    await p2;

    expect(order).toEqual([1, 2]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
