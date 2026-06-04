import http from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiHttpServer } from '../../../src/main/api/server.js';
import type { ApiRoute } from '../../../src/main/api/types.js';
import { recordApiLog, pruneApiLogs } from '../../../src/main/services/apiLogService.js';
import { apiEventHub } from '../../../src/main/api/events/eventHub.js';
import type { ApiServiceConfig } from '../../../src/shared/types.js';

vi.mock('../../../src/main/services/apiLogService.js', () => ({
  recordApiLog: vi.fn(),
  pruneApiLogs: vi.fn(),
}));

vi.mock('../../../src/main/api/events/eventHub.js', () => ({
  apiEventHub: {
    publish: vi.fn(),
  },
}));

const mockRecordApiLog = vi.mocked(recordApiLog);
const mockPruneApiLogs = vi.mocked(pruneApiLogs);
const mockPublish = vi.mocked(apiEventHub.publish);

interface HttpResult {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json: unknown;
}

const defaultPermissions: ApiServiceConfig['permissions'] = {
  galleryRead: true,
  imageRead: true,
  imageBinary: true,
  booruRead: true,
  booruWrite: true,
  favoriteTagsRead: true,
  favoriteTagsWrite: true,
  downloadsRead: true,
  downloadsControl: true,
  eventsSubscribe: true,
  apiLogsRead: true,
};

function config(overrides: Partial<ApiServiceConfig> = {}): ApiServiceConfig {
  return {
    enabled: true,
    mode: 'localhost',
    port: 0,
    apiKey: 'test-api-key',
    permissions: {
      ...defaultPermissions,
      ...overrides.permissions,
    },
    logs: {
      enabled: false,
      visibleInUi: true,
      retentionDays: 7,
      maxEntries: 100,
      ...overrides.logs,
    },
    ...overrides,
  };
}

async function listen(server: http.Server): Promise<number> {
  const currentAddress = server.address();
  if (currentAddress && typeof currentAddress !== 'string') {
    return currentAddress.port;
  }

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Server did not listen on a TCP port');
  }

  return address.port;
}

async function close(server: http.Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function request(server: http.Server, options: {
  method?: string;
  path: string;
  authorization?: string;
}): Promise<HttpResult> {
  const port = await listen(server);

  return await new Promise<HttpResult>((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method: options.method ?? 'GET',
      path: options.path,
      headers: options.authorization === undefined
        ? {}
        : { authorization: options.authorization },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let json: unknown = null;
        if (body) {
          try {
            json = JSON.parse(body);
          } catch {
            json = null;
          }
        }
        resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
          body,
          json,
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function requestAndCaptureError(server: http.Server, options: {
  method?: string;
  path: string;
  authorization?: string;
}): Promise<Error | null> {
  const port = await listen(server);

  return await new Promise<Error | null>((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method: options.method ?? 'GET',
      path: options.path,
      headers: options.authorization === undefined
        ? {}
        : { authorization: options.authorization },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(null));
    });

    req.on('error', resolve);
    req.end();
  });
}

describe('createApiHttpServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordApiLog.mockResolvedValue(undefined);
    mockPruneApiLogs.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 401 error envelope when bearer auth is missing', async () => {
    const handler = vi.fn();
    const server = createApiHttpServer({
      config: config(),
      routes: [{ method: 'GET', pattern: '/api/v1/service/info', handler }],
    });

    try {
      const result = await request(server, { path: '/api/v1/service/info' });

      expect(result.statusCode).toBe(401);
      expect(result.json).toEqual({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Unauthorized',
        },
      });
      expect(handler).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('returns 401 error envelope when bearer auth is wrong', async () => {
    const handler = vi.fn();
    const server = createApiHttpServer({
      config: config(),
      routes: [{ method: 'GET', pattern: '/api/v1/service/info', handler }],
    });

    try {
      const result = await request(server, {
        path: '/api/v1/service/info',
        authorization: 'Bearer wrong-key',
      });

      expect(result.statusCode).toBe(401);
      expect(result.json).toEqual({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Unauthorized',
        },
      });
      expect(handler).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('wraps authorized route data in a success envelope', async () => {
    const server = createApiHttpServer({
      config: config(),
      routes: [{
        method: 'GET',
        pattern: '/api/v1/service/info',
        handler: () => ({ ok: true }),
      }],
    });

    try {
      const result = await request(server, {
        path: '/api/v1/service/info',
        authorization: 'Bearer test-api-key',
      });

      expect(result.statusCode).toBe(200);
      expect(result.json).toEqual({
        success: true,
        data: { ok: true },
      });
    } finally {
      await close(server);
    }
  });

  it('returns 403 and skips the handler when the resolved permission is disabled', async () => {
    const handler = vi.fn();
    const server = createApiHttpServer({
      config: config({ permissions: { ...defaultPermissions, galleryRead: false } }),
      routes: [{ method: 'GET', pattern: '/api/v1/galleries', handler }],
    });

    try {
      const result = await request(server, {
        path: '/api/v1/galleries',
        authorization: 'Bearer test-api-key',
      });

      expect(result.statusCode).toBe(403);
      expect(result.json).toEqual({
        success: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'Permission denied',
        },
      });
      expect(handler).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('returns 403 and skips the handler when the resolved permission key is missing from config', async () => {
    const handler = vi.fn();
    const malformedConfig = {
      ...config(),
      permissions: {},
    } as ApiServiceConfig;
    const server = createApiHttpServer({
      config: malformedConfig,
      routes: [{ method: 'GET', pattern: '/api/v1/galleries', handler }],
    });

    try {
      const result = await request(server, {
        path: '/api/v1/galleries',
        authorization: 'Bearer test-api-key',
      });

      expect(result.statusCode).toBe(403);
      expect(result.json).toEqual({
        success: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'Permission denied',
        },
      });
      expect(handler).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('returns 404 for unknown routes', async () => {
    const server = createApiHttpServer({
      config: config(),
      routes: [],
    });

    try {
      const result = await request(server, {
        path: '/api/v1/missing',
        authorization: 'Bearer test-api-key',
      });

      expect(result.statusCode).toBe(404);
      expect(result.json).toEqual({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Not found',
        },
      });
    } finally {
      await close(server);
    }
  });

  it('fails closed when a matched route has no permission rule', async () => {
    const handler = vi.fn(() => ({ ok: true }));
    const server = createApiHttpServer({
      config: config(),
      routes: [{ method: 'GET', pattern: '/api/v1/unruled', handler }],
    });

    try {
      const result = await request(server, {
        path: '/api/v1/unruled',
        authorization: 'Bearer test-api-key',
      });

      expect(result.statusCode).toBe(500);
      expect(result.json).toEqual({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
        },
      });
      expect(handler).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('hides ordinary Error messages from clients', async () => {
    const server = createApiHttpServer({
      config: config(),
      routes: [{
        method: 'GET',
        pattern: '/api/v1/service/info',
        handler: () => {
          throw new Error('secret path');
        },
      }],
    });

    try {
      const result = await request(server, {
        path: '/api/v1/service/info',
        authorization: 'Bearer test-api-key',
      });

      expect(result.statusCode).toBe(500);
      expect(result.json).toEqual({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
        },
      });
      expect(result.body).not.toContain('secret path');
    } finally {
      await close(server);
    }
  });

  it('does not attempt to write a JSON error when the response is already destroyed', async () => {
    const endSpy = vi.spyOn(http.ServerResponse.prototype, 'end');
    const server = createApiHttpServer({
      config: config(),
      routes: [{
        method: 'GET',
        pattern: '/api/v1/service/info',
        handler: ({ res }) => {
          res.destroy();
          throw new Error('secret path');
        },
      }],
    });

    try {
      const error = await requestAndCaptureError(server, {
        path: '/api/v1/service/info',
        authorization: 'Bearer test-api-key',
      });

      expect(error).toBeInstanceOf(Error);
      expect(endSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('"code":"INTERNAL_ERROR"'),
      );
    } finally {
      endSpy.mockRestore();
      await close(server);
    }
  });

  it('does not send a JSON success envelope when a streaming handler returns undefined', async () => {
    const server = createApiHttpServer({
      config: config(),
      routes: [{
        method: 'GET',
        pattern: '/api/v1/events/downloads',
        handler: ({ res }) => {
          res.setHeader('content-type', 'text/event-stream; charset=utf-8');
          res.write('event: ready\n');
          res.end('data: {}\n\n');
          return undefined;
        },
      }],
    });

    try {
      const result = await request(server, {
        path: '/api/v1/events/downloads',
        authorization: 'Bearer test-api-key',
      });

      expect(result.statusCode).toBe(200);
      expect(result.headers['content-type']).toBe('text/event-stream; charset=utf-8');
      expect(result.body).toBe('event: ready\ndata: {}\n\n');
    } finally {
      await close(server);
    }
  });

  it('passes normalized request context to route handlers', async () => {
    const handler = vi.fn(() => ({ ok: true }));
    const server = createApiHttpServer({
      config: config(),
      routes: [{ method: 'GET', pattern: '/api/v1/galleries/:galleryId/images', handler }],
    });

    try {
      await request(server, {
        path: '/api/v1/galleries/gal%201/images?tag=a&tag=b',
        authorization: 'Bearer test-api-key',
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        method: 'GET',
        pathname: '/api/v1/galleries/gal%201/images',
        params: { galleryId: 'gal 1' },
        sourceIp: '127.0.0.1',
        permissionKey: 'galleryRead',
      }));
      const context = handler.mock.calls[0][0];
      expect(context.query.getAll('tag')).toEqual(['a', 'b']);
      expect(context.req).toBeDefined();
      expect(context.res).toBeDefined();
    } finally {
      await close(server);
    }
  });

  it('records success and error logs, publishes creation events, and throttles log pruning', async () => {
    const server = createApiHttpServer({
      config: config({
        logs: {
          enabled: true,
          visibleInUi: true,
          retentionDays: 3,
          maxEntries: 10,
        },
      }),
      routes: [
        { method: 'GET', pattern: '/api/v1/service/info', handler: () => ({ ok: true }) },
        {
          method: 'GET',
          pattern: '/api/v1/galleries',
          handler: () => {
            throw new Error('secret path');
          },
        },
      ],
    });

    try {
      await request(server, {
        path: '/api/v1/service/info?ok=1',
        authorization: 'Bearer test-api-key',
      });
      await request(server, {
        path: '/api/v1/galleries?fail=1',
        authorization: 'Bearer test-api-key',
      });

      expect(mockRecordApiLog).toHaveBeenCalledTimes(2);
      expect(mockRecordApiLog).toHaveBeenNthCalledWith(1, expect.objectContaining({
        sourceIp: '127.0.0.1',
        method: 'GET',
        path: '/api/v1/service/info',
        permissionKey: null,
        statusCode: 200,
        success: true,
        errorCode: null,
        errorMessage: null,
        requestSummary: 'ok=1',
      }));
      expect(mockRecordApiLog).toHaveBeenNthCalledWith(2, expect.objectContaining({
        sourceIp: '127.0.0.1',
        method: 'GET',
        path: '/api/v1/galleries',
        permissionKey: 'galleryRead',
        statusCode: 500,
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'Internal server error',
        requestSummary: 'fail=1',
      }));
      expect(mockRecordApiLog.mock.calls[0][0].timestamp).toEqual(expect.any(String));
      expect(mockRecordApiLog.mock.calls[0][0].durationMs).toEqual(expect.any(Number));
      expect(mockPublish).toHaveBeenCalledTimes(2);
      expect(mockPublish).toHaveBeenCalledWith('api-logs', expect.objectContaining({
        type: 'api-log.created',
        data: expect.objectContaining({ path: '/api/v1/service/info' }),
      }));
      expect(mockPruneApiLogs).toHaveBeenCalledTimes(1);
      expect(mockPruneApiLogs).toHaveBeenCalledWith(expect.objectContaining({
        now: expect.any(Date),
        retentionDays: 3,
        maxEntries: 10,
      }));
    } finally {
      await close(server);
    }
  });

  it('does not fail the HTTP response when logging fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockRecordApiLog.mockRejectedValueOnce(new Error('database down'));
    const server = createApiHttpServer({
      config: config({ logs: { enabled: true, visibleInUi: true } }),
      routes: [{
        method: 'GET',
        pattern: '/api/v1/service/info',
        handler: () => ({ ok: true }),
      }],
    });

    try {
      const result = await request(server, {
        path: '/api/v1/service/info',
        authorization: 'Bearer test-api-key',
      });

      expect(result.statusCode).toBe(200);
      expect(result.json).toEqual({ success: true, data: { ok: true } });
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('truncates long query request summaries to 1000 characters', async () => {
    const longValue = 'a'.repeat(1200);
    const server = createApiHttpServer({
      config: config({ logs: { enabled: true, visibleInUi: true } }),
      routes: [{
        method: 'GET',
        pattern: '/api/v1/service/info',
        handler: () => ({ ok: true }),
      }],
    });

    try {
      await request(server, {
        path: `/api/v1/service/info?q=${longValue}`,
        authorization: 'Bearer test-api-key',
      });

      expect(mockRecordApiLog).toHaveBeenCalledWith(expect.objectContaining({
        requestSummary: expect.any(String),
      }));
      expect(mockRecordApiLog.mock.calls[0][0].requestSummary).toHaveLength(1000);
    } finally {
      await close(server);
    }
  });

  it('redacts sensitive query values before recording request logs', async () => {
    const server = createApiHttpServer({
      config: config({ logs: { enabled: true, visibleInUi: true } }),
      routes: [{
        method: 'GET',
        pattern: '/api/v1/service/info',
        handler: () => ({ ok: true }),
      }],
    });

    try {
      await request(server, {
        path: '/api/v1/service/info?ok=1&apiKey=raw-api-key&Token=raw-token&authorization=raw-auth&password=raw-password&clientSecret=raw-client-secret&note=visible',
        authorization: 'Bearer test-api-key',
      });

      expect(mockRecordApiLog).toHaveBeenCalledWith(expect.objectContaining({
        requestSummary: expect.stringContaining('ok=1'),
      }));
      const summary = mockRecordApiLog.mock.calls[0][0].requestSummary;
      expect(summary).toContain('apiKey=REDACTED');
      expect(summary).toContain('Token=REDACTED');
      expect(summary).toContain('authorization=REDACTED');
      expect(summary).toContain('password=REDACTED');
      expect(summary).toContain('clientSecret=REDACTED');
      expect(summary).toContain('note=visible');
      expect(summary).not.toContain('raw-api-key');
      expect(summary).not.toContain('raw-token');
      expect(summary).not.toContain('raw-auth');
      expect(summary).not.toContain('raw-password');
      expect(summary).not.toContain('raw-client-secret');
    } finally {
      await close(server);
    }
  });
});
