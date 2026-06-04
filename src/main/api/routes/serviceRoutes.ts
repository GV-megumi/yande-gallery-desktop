import { app } from 'electron';
import type { ApiServiceStatus } from '../../../shared/types.js';
import { getApiServiceConfig } from '../../services/config.js';
import { fingerprintApiKey } from '../security.js';
import type { ApiRoute } from '../types.js';

function sanitizeStatus(status: ApiServiceStatus): ApiServiceStatus {
  return {
    running: status.running,
    enabled: status.enabled,
    mode: status.mode,
    port: status.port,
    bindAddress: status.bindAddress,
    baseUrl: status.baseUrl,
    startedAt: status.startedAt,
    lastError: status.lastError,
  };
}

export function createServiceRoutes(statusProvider: { getStatus: () => ApiServiceStatus }): ApiRoute[] {
  return [
    {
      method: 'GET',
      pattern: '/api/v1/service/info',
      handler: () => {
        const config = getApiServiceConfig();

        return {
          appName: 'Yande Gallery Desktop',
          appVersion: app.getVersion(),
          apiVersion: 'v1',
          status: sanitizeStatus(statusProvider.getStatus()),
          mode: config.mode,
          permissions: config.permissions,
          apiKeyFingerprint: fingerprintApiKey(config.apiKey),
        };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/service/health',
      handler: () => ({
        ok: true,
        timestamp: new Date().toISOString(),
      }),
    },
  ];
}
