import http from 'http';
import type { ApiServiceConfig, ApiServicePermissionKey } from '../../shared/types.js';
import { pruneApiLogs, recordApiLog, type NewApiLogEntry } from '../services/apiLogService.js';
import { APP_API_PREFIX } from './appNamespace.js';
import { apiEventHub } from './events/eventHub.js';
import { resolvePermissionForRequest } from './permissions.js';
import { sendApiError, sendSuccess, type NormalizedApiError } from './response.js';
import { createRouteMatcher } from './router.js';
import {
  isAllowedApiSourceIp,
  isAuthorizedBearer,
  isLoopbackAddress,
  normalizeRemoteAddress,
} from './security.js';
import { ApiHttpError, type ApiRoute } from './types.js';

export interface CreateApiHttpServerOptions {
  config: ApiServiceConfig;
  routes: ApiRoute[];
}

interface RequestLogState {
  sourceIp: string;
  method: string;
  pathname: string;
  permissionKey: ApiServicePermissionKey | null;
  requestSummary: string | null;
  startedAt: number;
  error: NormalizedApiError | null;
}

const SENSITIVE_QUERY_KEYS = new Set([
  'apikey',
  'api_key',
  'token',
  'access_token',
  'authorization',
  'password',
  'clientsecret',
  'client_secret',
  'secret',
]);
const API_LOG_PRUNE_INTERVAL_MS = 60_000;
let lastApiLogPruneAt = 0;

export function createApiHttpServer(options: CreateApiHttpServerOptions): http.Server {
  const matchRoute = createRouteMatcher(options.routes);

  return http.createServer(async (req, res) => {
    const baseUrl = 'http://127.0.0.1';
    const method = (req.method || 'GET').toUpperCase();
    const sourceIp = normalizeRemoteAddress(req.socket.remoteAddress);
    const logState: RequestLogState = {
      sourceIp,
      method,
      pathname: '/',
      permissionKey: null,
      requestSummary: null,
      startedAt: Date.now(),
      error: null,
    };

    try {
      const url = new URL(req.url || '/', baseUrl);
      logState.pathname = url.pathname;
      logState.requestSummary = createRequestSummary(url.searchParams);

      if (!isAllowedApiSourceIp(req.socket.remoteAddress)) {
        throw new ApiHttpError(403, 'FORBIDDEN_IP', 'API source IP is not allowed');
      }

      if (!isAuthorizedBearer(req.headers.authorization, options.config.apiKey)) {
        throw new ApiHttpError(401, 'UNAUTHORIZED', 'Unauthorized');
      }

      const routeMatch = matchRoute(method, url.pathname);
      if (!routeMatch) {
        throw new ApiHttpError(404, 'NOT_FOUND', 'Not found');
      }

      // 命名空间分流（spec §4）：手机面整面一门制，agent 面走细化权限；
      // 服务器可能因任一面开启而运行，故两面各自查门。
      if (url.pathname.startsWith(`${APP_API_PREFIX}/`)) {
        if (options.config.app.enabled !== true) {
          throw new ApiHttpError(403, 'PERMISSION_DENIED', 'Mobile app access is disabled');
        }
        // logState.permissionKey 保持 null：路径前缀已自解释消费者身份（spec §4）
      } else {
        if (options.config.enabled !== true) {
          throw new ApiHttpError(403, 'PERMISSION_DENIED', 'Agent API is disabled');
        }

        // 仅本机模式的请求级兜底（spec §6）：app.enabled 会把服务器强制绑到 0.0.0.0，
        // 绑定层的 127.0.0.1 隔离随之失效，agent 面「仅本机」承诺改在此逐请求兜住。
        if (options.config.mode === 'localhost' && !isLoopbackAddress(req.socket.remoteAddress)) {
          throw new ApiHttpError(403, 'FORBIDDEN_IP', 'Agent API is localhost-only');
        }

        const permissionKey = resolvePermissionForRequest(method, url.pathname);
        if (permissionKey === undefined) {
          throw new Error('API route permission is not configured');
        }

        logState.permissionKey = permissionKey;

        if (permissionKey && options.config.permissions[permissionKey] !== true) {
          throw new ApiHttpError(403, 'PERMISSION_DENIED', 'Permission denied');
        }
      }

      const data = await routeMatch.route.handler({
        req,
        res,
        method,
        pathname: url.pathname,
        query: url.searchParams,
        params: routeMatch.params,
        sourceIp,
        permissionKey: logState.permissionKey,
      });

      if (data !== undefined && canWriteJson(res)) {
        sendSuccess(res, data);
      }
    } catch (error) {
      if (canWriteJson(res)) {
        logState.error = sendApiError(res, error);
      } else {
        logState.error = normalizeApiErrorForLog(error);
        if (!res.writableEnded && !res.destroyed) {
          res.destroy();
        }
      }
    } finally {
      await recordRequestLog(options.config, logState, res);
    }
  });
}

function canWriteJson(res: http.ServerResponse): boolean {
  return !res.headersSent && !res.writableEnded && !res.destroyed;
}

function createRequestSummary(searchParams: URLSearchParams): string | null {
  const redactedSearchParams = new URLSearchParams();
  searchParams.forEach((value, key) => {
    redactedSearchParams.append(
      key,
      SENSITIVE_QUERY_KEYS.has(key.toLowerCase()) ? 'REDACTED' : value,
    );
  });
  const summary = redactedSearchParams.toString();
  return summary ? summary.slice(0, 1000) : null;
}

function normalizeApiErrorForLog(error: unknown): NormalizedApiError {
  if (error instanceof ApiHttpError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      logMessage: error.message,
    };
  }

  return {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
    logMessage: null,
  };
}

async function recordRequestLog(
  config: ApiServiceConfig,
  state: RequestLogState,
  res: http.ServerResponse,
): Promise<void> {
  if (!config.logs.enabled) {
    return;
  }

  const statusCode = state.error?.statusCode ?? res.statusCode;
  const success = !state.error && statusCode >= 200 && statusCode < 400;
  const entry: NewApiLogEntry = {
    timestamp: new Date().toISOString(),
    sourceIp: state.sourceIp,
    method: state.method,
    path: state.pathname,
    permissionKey: state.permissionKey,
    statusCode,
    success,
    durationMs: Math.max(0, Date.now() - state.startedAt),
    errorCode: state.error?.code ?? null,
    errorMessage: state.error?.message ?? null,
    requestSummary: state.requestSummary,
  };

  try {
    await recordApiLog(entry);
    apiEventHub.publish('api-logs', {
      type: 'api-log.created',
      data: entry,
    });
    const now = Date.now();
    if (now - lastApiLogPruneAt >= API_LOG_PRUNE_INTERVAL_MS) {
      lastApiLogPruneAt = now;
      await pruneApiLogs({
        now: new Date(now),
        retentionDays: config.logs.retentionDays,
        maxEntries: config.logs.maxEntries,
      });
    }
  } catch (error) {
    console.warn('[api-server] Failed to record API log', error);
  }
}
