import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 依赖模块（避免真实的 axios 和 config 调用）
vi.mock('../../../src/main/services/config', () => ({
  getProxyConfig: vi.fn(() => undefined),
}));

import { createBooruClient, BooruSiteRecord } from '../../../src/main/services/booruClientFactory';
import { MoebooruClient } from '../../../src/main/services/moebooruClient';
import { DanbooruClient } from '../../../src/main/services/danbooruClient';
import { GelbooruClient } from '../../../src/main/services/gelbooruClient';

describe('createBooruClient', () => {
  const baseSite: Omit<BooruSiteRecord, 'type'> = {
    id: 1,
    name: 'TestSite',
    url: 'https://example.com',
    username: 'user',
    passwordHash: 'hash123',
    apiKey: 'key456',
  };

  it('应为 moebooru 类型创建 MoebooruClient', () => {
    const site: BooruSiteRecord = { ...baseSite, type: 'moebooru' };
    const client = createBooruClient(site);

    expect(client).toBeInstanceOf(MoebooruClient);
    expect(client.siteType).toBe('moebooru');
  });

  it('应为 danbooru 类型创建 DanbooruClient', () => {
    const site: BooruSiteRecord = { ...baseSite, type: 'danbooru' };
    const client = createBooruClient(site);

    expect(client).toBeInstanceOf(DanbooruClient);
    expect(client.siteType).toBe('danbooru');
  });

  it('应为 gelbooru 类型创建 GelbooruClient', () => {
    const site: BooruSiteRecord = { ...baseSite, type: 'gelbooru' };
    const client = createBooruClient(site);

    expect(client).toBeInstanceOf(GelbooruClient);
    expect(client.siteType).toBe('gelbooru');
  });

  it('未知类型应回退到 MoebooruClient', () => {
    const site = { ...baseSite, type: 'unknown' as any };
    const client = createBooruClient(site);

    expect(client).toBeInstanceOf(MoebooruClient);
    expect(client.siteType).toBe('moebooru');
  });

  it('无认证信息时也能创建客户端', () => {
    const site: BooruSiteRecord = {
      id: 2,
      name: 'NoAuth',
      url: 'https://example.com',
      type: 'danbooru',
    };
    const client = createBooruClient(site);

    expect(client).toBeInstanceOf(DanbooruClient);
    expect(client.siteType).toBe('danbooru');
  });

  it('所有客户端都实现 IBooruClient 接口的关键方法', () => {
    const types = ['moebooru', 'danbooru', 'gelbooru'] as const;
    for (const type of types) {
      const site: BooruSiteRecord = { ...baseSite, type };
      const client = createBooruClient(site);

      // 验证关键方法存在
      expect(typeof client.getPosts).toBe('function');
      expect(typeof client.getPopularRecent).toBe('function');
      expect(typeof client.favoritePost).toBe('function');
      expect(typeof client.unfavoritePost).toBe('function');
      expect(typeof client.votePost).toBe('function');
      expect(typeof client.getTags).toBe('function');
      expect(typeof client.getTagsByNames).toBe('function');
      expect(typeof client.getComments).toBe('function');
      expect(typeof client.getPools).toBe('function');
      expect(typeof client.getPool).toBe('function');
      expect(typeof client.testAuth).toBe('function');
      expect(typeof client.testConnection).toBe('function');
      expect(typeof client.getTagSummary).toBe('function');
      expect(typeof client.parseTagSummary).toBe('function');
      expect(typeof client.getServerFavorites).toBe('function');
      expect(typeof client.getFavoriteUsers).toBe('function');
      expect(typeof client.createComment).toBe('function');
    }
  });
});
