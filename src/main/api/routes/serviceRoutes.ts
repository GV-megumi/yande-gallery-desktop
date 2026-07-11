import { app } from 'electron';
import type { ApiServiceStatus } from '../../../shared/types.js';
import { getApiServiceConfig } from '../../services/config.js';
import { APP_API_PREFIX } from '../appNamespace.js';
import { fingerprintApiKey } from '../security.js';
import type { ApiRoute } from '../types.js';

function sanitizeStatus(status: ApiServiceStatus): ApiServiceStatus {
  return {
    running: status.running,
    enabled: status.enabled,
    appEnabled: status.appEnabled,
    mode: status.mode,
    port: status.port,
    bindAddress: status.bindAddress,
    baseUrl: status.baseUrl,
    startedAt: status.startedAt,
    lastError: status.lastError,
  };
}

/** 两面共用的 info 基础载荷：不含 agent 专属的 mode/permissions。 */
function buildServiceInfoBase(statusProvider: { getStatus: () => ApiServiceStatus }) {
  return {
    appName: 'Yande Gallery Desktop',
    appVersion: app.getVersion(),
    apiVersion: 'v1',
    status: sanitizeStatus(statusProvider.getStatus()),
    apiKeyFingerprint: fingerprintApiKey(getApiServiceConfig().apiKey),
  };
}

const healthHandler = () => ({
  ok: true,
  timestamp: new Date().toISOString(),
});

export function createServiceRoutes(statusProvider: { getStatus: () => ApiServiceStatus }): ApiRoute[] {
  return [
    {
      method: 'GET',
      pattern: '/api/v1/service/info',
      handler: () => {
        const config = getApiServiceConfig();

        return {
          ...buildServiceInfoBase(statusProvider),
          // agent 面专属：监听模式与 11 键细化权限
          mode: config.mode,
          permissions: config.permissions,
        };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/service/health',
      handler: healthHandler,
    },
  ];
}

/**
 * 手机面 service 路由（spec §3.1）：info 不透出 agent 专属的 mode/permissions——
 * 手机面一门制，这两个字段对 /api/app/v1 消费者毫无意义，透出只会诱发客户端
 * 误据 permissions.imageBinary 之类做门控（本次拆分修掉的安卓误报即此类回归）。
 */
export function createAppServiceRoutes(statusProvider: { getStatus: () => ApiServiceStatus }): ApiRoute[] {
  return [
    {
      method: 'GET',
      pattern: `${APP_API_PREFIX}/service/info`,
      handler: () => buildServiceInfoBase(statusProvider),
    },
    {
      method: 'GET',
      pattern: `${APP_API_PREFIX}/service/health`,
      handler: healthHandler,
    },
  ];
}
