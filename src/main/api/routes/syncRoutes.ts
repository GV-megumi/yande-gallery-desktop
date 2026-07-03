import type { ApiRoute } from '../types.js';
import { ApiHttpError } from '../types.js';
import { sendSuccessMaybeGzip } from '../response.js';
import { optionalNumberQuery } from '../router.js';
import {
  decodeSyncCursor,
  getSyncMeta,
  listSyncGalleries,
  listSyncImageIds,
  listSyncImages,
  listSyncTags,
} from '../../services/syncService.js';

const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 5000;

/**
 * 移动端元数据同步的五路由（安卓相册 spec §5.3），权限均 galleryRead。
 * 全部经 sendSuccessMaybeGzip 自写响应（按 Accept-Encoding 异步协商 gzip），handler await
 * 后返回 undefined，避免 server 再包一层 sendSuccess。
 */
export function createSyncRoutes(): ApiRoute[] {
  return [
    {
      method: 'GET',
      pattern: '/api/v1/sync/meta',
      handler: async (context) => {
        await sendSuccessMaybeGzip(context.req, context.res, await getSyncMeta());
        return undefined;
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/sync/images',
      handler: async (context) => {
        const rawCursor = context.query.get('cursor');
        let cursor = null;
        if (rawCursor) {
          cursor = decodeSyncCursor(rawCursor);
          if (!cursor) {
            throw new ApiHttpError(422, 'VALIDATION_ERROR', 'Invalid cursor');
          }
        }
        // optionalNumberQuery（numberParam 的 /^[1-9]\d*$/）已对 0/负数/非数字抛 422；
        // Math.max(1, ...) 下界为本地不变量兜底——保证 LIMIT limit+1 绝不为非正数
        // （SQLite 负 LIMIT 视为无界），不依赖 router.ts 内部实现。
        const limit = Math.min(Math.max(1, optionalNumberQuery(context.query, 'limit', DEFAULT_LIMIT)), MAX_LIMIT);
        await sendSuccessMaybeGzip(context.req, context.res, await listSyncImages(cursor, limit));
        return undefined;
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/sync/galleries',
      handler: async (context) => {
        await sendSuccessMaybeGzip(context.req, context.res, { items: await listSyncGalleries() });
        return undefined;
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/sync/tags',
      handler: async (context) => {
        await sendSuccessMaybeGzip(context.req, context.res, { items: await listSyncTags() });
        return undefined;
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/sync/image-ids',
      handler: async (context) => {
        await sendSuccessMaybeGzip(context.req, context.res, { ids: await listSyncImageIds() });
        return undefined;
      },
    },
  ];
}
