import type { ApiRoute } from './types.js';

/** 手机面命名空间前缀（spec §3.1）：身份由前缀决定，整面一门制、无细化权限。 */
export const APP_API_PREFIX = '/api/app/v1';

const AGENT_PREFIX_RE = /^\/api\/v1\//;

/**
 * 克隆共享路由到手机面前缀。service/二进制等两面同 handler 的路由用此复用，
 * 避免各写一份；handler 引用原样共享（无状态，仅 pattern 不同）。
 */
export function remapToAppNamespace(routes: ApiRoute[]): ApiRoute[] {
  return routes.map((route) => ({
    ...route,
    pattern: route.pattern.replace(AGENT_PREFIX_RE, `${APP_API_PREFIX}/`),
  }));
}
