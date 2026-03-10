/**
 * Booru 客户端工厂
 * 根据站点类型创建对应的 API 客户端实例
 * 使用策略模式：Moebooru / Danbooru / Gelbooru 各有独立客户端
 */

import { IBooruClient, BooruClientConfig } from './booruClientInterface.js';
import { MoebooruClient } from './moebooruClient.js';
import { DanbooruClient } from './danbooruClient.js';
import { GelbooruClient } from './gelbooruClient.js';

/** 站点类型 */
export type BooruSiteType = 'moebooru' | 'danbooru' | 'gelbooru';

/** 站点数据库记录（与 booruService 中的结构对应） */
export interface BooruSiteRecord {
  id: number;
  name: string;
  url: string;
  type: BooruSiteType;
  username?: string;
  passwordHash?: string;
  apiKey?: string;
  salt?: string;
}

/**
 * 根据站点类型创建 Booru 客户端
 * @param site - 站点数据库记录
 * @returns 对应类型的客户端实例
 */
export function createBooruClient(site: BooruSiteRecord): IBooruClient {
  const config: BooruClientConfig = {
    baseUrl: site.url,
    login: site.username,
    passwordHash: site.passwordHash,
    apiKey: site.apiKey,
  };

  switch (site.type) {
    case 'moebooru':
      console.log(`[BooruClientFactory] 创建 MoebooruClient: ${site.name} (${site.url})`);
      return new MoebooruClient({
        baseUrl: site.url,
        login: site.username,
        passwordHash: site.passwordHash,
        apiKey: site.apiKey,
      });

    case 'danbooru':
      console.log(`[BooruClientFactory] 创建 DanbooruClient: ${site.name} (${site.url})`);
      return new DanbooruClient(config);

    case 'gelbooru':
      console.log(`[BooruClientFactory] 创建 GelbooruClient: ${site.name} (${site.url})`);
      return new GelbooruClient(config);

    default:
      console.warn(`[BooruClientFactory] 未知站点类型 "${site.type}"，回退到 MoebooruClient`);
      return new MoebooruClient({
        baseUrl: site.url,
        login: site.username,
        passwordHash: site.passwordHash,
        apiKey: site.apiKey,
      });
  }
}
