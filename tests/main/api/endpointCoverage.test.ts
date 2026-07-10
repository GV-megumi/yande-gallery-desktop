import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.0.0-test'),
  },
}));

const agentEndpoints = [
  ['GET', '/api/v1/service/info'],
  ['GET', '/api/v1/service/health'],
  ['GET', '/api/v1/galleries'],
  ['GET', '/api/v1/galleries/:galleryId'],
  ['GET', '/api/v1/galleries/:galleryId/images'],
  ['GET', '/api/v1/images'],
  ['GET', '/api/v1/images/:imageId'],
  ['GET', '/api/v1/images/:imageId/thumbnail'],
  ['GET', '/api/v1/images/:imageId/preview'],
  ['GET', '/api/v1/images/:imageId/file'],
  ['GET', '/api/v1/booru-sites'],
  ['GET', '/api/v1/booru-sites/active'],
  ['GET', '/api/v1/booru-posts/search'],
  ['GET', '/api/v1/booru-posts/:siteId/:postId'],
  ['GET', '/api/v1/booru-posts/:siteId/:postId/tags'],
  ['GET', '/api/v1/booru-posts/:siteId/:postId/favorite-info'],
  ['GET', '/api/v1/favorites'],
  ['POST', '/api/v1/favorites/:siteId/:postId'],
  ['DELETE', '/api/v1/favorites/:siteId/:postId'],
  ['POST', '/api/v1/favorites/:siteId/:postId/like'],
  ['DELETE', '/api/v1/favorites/:siteId/:postId/like'],
  ['GET', '/api/v1/favorite-tags'],
  ['POST', '/api/v1/favorite-tags'],
  ['PATCH', '/api/v1/favorite-tags/:id'],
  ['DELETE', '/api/v1/favorite-tags/:id'],
  ['GET', '/api/v1/favorite-tags/:id/binding'],
  ['PUT', '/api/v1/favorite-tags/:id/binding'],
  ['DELETE', '/api/v1/favorite-tags/:id/binding'],
  ['POST', '/api/v1/favorite-tags/:id/bulk-download'],
  ['GET', '/api/v1/downloads/queue'],
  ['GET', '/api/v1/downloads/tasks'],
  ['GET', '/api/v1/downloads/tasks/:taskId'],
  ['GET', '/api/v1/downloads/sessions'],
  ['GET', '/api/v1/downloads/sessions/:sessionId'],
  ['POST', '/api/v1/downloads/sessions/:sessionId/pause'],
  ['POST', '/api/v1/downloads/sessions/:sessionId/resume'],
  ['POST', '/api/v1/downloads/sessions/:sessionId/cancel'],
  ['GET', '/api/v1/api-logs'],
  ['GET', '/api/v1/events/:channel'],
];

const appEndpoints = [
  ['GET', '/api/app/v1/service/info'],
  ['GET', '/api/app/v1/service/health'],
  ['GET', '/api/app/v1/sync/meta'],
  ['GET', '/api/app/v1/sync/images'],
  ['GET', '/api/app/v1/sync/galleries'],
  ['GET', '/api/app/v1/sync/tags'],
  ['GET', '/api/app/v1/sync/image-ids'],
  ['DELETE', '/api/app/v1/images/:imageId'],
  ['POST', '/api/app/v1/images/batch-delete'],
  ['POST', '/api/app/v1/images/:imageId/tags'],
  ['DELETE', '/api/app/v1/images/:imageId/tags'],
  ['POST', '/api/app/v1/galleries'],
  ['PATCH', '/api/app/v1/galleries/:galleryId'],
  ['DELETE', '/api/app/v1/galleries/:galleryId'],
  ['POST', '/api/app/v1/galleries/:galleryId/images'],
  ['DELETE', '/api/app/v1/galleries/:galleryId/images'],
  ['GET', '/api/app/v1/images/:imageId/thumbnail'],
  ['GET', '/api/app/v1/images/:imageId/preview'],
  ['GET', '/api/app/v1/images/:imageId/file'],
  ['GET', '/api/app/v1/events/system'],
];

describe('API endpoint coverage', () => {
  it('双面路由装配完整覆盖文档端点（spec §3）', async () => {
    // 消费 apiServiceManager 导出的真实装配函数（而非在测试里手工复刻装配清单），
    // createRoutes 接线一旦漂移（如漏挂某个 remap 组）此测试立刻变红。
    const { assembleApiRoutes } = await import('../../../src/main/api/apiServiceManager.js');

    const routes = assembleApiRoutes(
      { getStatus: () => ({}) as any },
      { subscribe: () => undefined } as any,
    );
    const actual = routes.map((route) => [route.method, route.pattern]);

    expect(actual).toEqual(expect.arrayContaining(agentEndpoints));
    expect(actual).toEqual(expect.arrayContaining(appEndpoints));

    // agent 面不得残留 sync 与写路由（spec §3.2）
    const agentPatterns = actual.filter(([, pattern]) => (pattern as string).startsWith('/api/v1/'));
    expect(agentPatterns.some(([, pattern]) => (pattern as string).startsWith('/api/v1/sync/'))).toBe(false);
    expect(agentPatterns.some(([method, pattern]) => (
      (pattern as string).startsWith('/api/v1/galleries') && method !== 'GET'
    ))).toBe(false);
    expect(agentPatterns.some(([method, pattern]) => (
      (pattern as string).startsWith('/api/v1/images') && method !== 'GET'
    ))).toBe(false);
  });
});
