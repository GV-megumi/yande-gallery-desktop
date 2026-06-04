import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiLogRoutes } from '../../../src/main/api/routes/apiLogRoutes.js';
import { createEventRoutes } from '../../../src/main/api/routes/eventRoutes.js';
import type { ApiRequestContext, ApiRoute } from '../../../src/main/api/types.js';
import { ApiHttpError } from '../../../src/main/api/types.js';
import { queryApiLogs } from '../../../src/main/services/apiLogService.js';
import type { ApiEventChannel } from '../../../src/main/api/events/eventHub.js';

vi.mock('../../../src/main/services/apiLogService.js', () => ({
  queryApiLogs: vi.fn(),
}));

const mockQueryApiLogs = vi.mocked(queryApiLogs);

function findRoute(routes: ApiRoute[], pattern: string, method = 'GET'): ApiRoute {
  const route = routes.find((candidate) => candidate.method === method && candidate.pattern === pattern);
  if (!route) {
    throw new Error(`Missing route: ${method} ${pattern}`);
  }

  return route;
}

function context(options: {
  params?: Record<string, string>;
  query?: URLSearchParams;
  req?: ApiRequestContext['req'];
  res?: ApiRequestContext['res'];
} = {}): ApiRequestContext {
  return {
    req: options.req ?? ({} as ApiRequestContext['req']),
    res: options.res ?? ({ setHeader: vi.fn() } as unknown as ApiRequestContext['res']),
    method: 'GET',
    pathname: '/',
    query: options.query ?? new URLSearchParams(),
    params: options.params ?? {},
    sourceIp: '127.0.0.1',
    permissionKey: null,
  };
}

describe('API log routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryApiLogs.mockResolvedValue({ items: [], total: 0 });
  });

  it('parses api log filters and delegates to the log service', async () => {
    const route = findRoute(createApiLogRoutes(), '/api/v1/api-logs');
    const result = await route.handler(context({
      query: new URLSearchParams([
        ['limit', '5'],
        ['offset', '10'],
        ['success', 'false'],
        ['method', 'get'],
        ['path', 'health'],
      ]),
    }));

    expect(result).toEqual({ items: [], total: 0 });
    expect(mockQueryApiLogs).toHaveBeenCalledWith({
      limit: 5,
      offset: 10,
      success: false,
      method: 'GET',
      path: 'health',
    });
  });

  it('accepts lowercase method and plain path filters', async () => {
    const route = findRoute(createApiLogRoutes(), '/api/v1/api-logs');

    await route.handler(context({
      query: new URLSearchParams([
        ['method', 'get'],
        ['path', 'health'],
      ]),
    }));

    expect(mockQueryApiLogs).toHaveBeenCalledWith({
      limit: 100,
      offset: 0,
      success: undefined,
      method: 'GET',
      path: 'health',
    });
  });

  it('uses defaults and omits missing optional filters', async () => {
    const route = findRoute(createApiLogRoutes(), '/api/v1/api-logs');

    await route.handler(context());

    expect(mockQueryApiLogs).toHaveBeenCalledWith({
      limit: 100,
      offset: 0,
      success: undefined,
      method: undefined,
      path: undefined,
    });
  });

  it('accepts zero offset', async () => {
    const route = findRoute(createApiLogRoutes(), '/api/v1/api-logs');

    await route.handler(context({ query: new URLSearchParams([['offset', '0']]) }));

    expect(mockQueryApiLogs).toHaveBeenCalledWith({
      limit: 100,
      offset: 0,
      success: undefined,
      method: undefined,
      path: undefined,
    });
  });

  it('rejects invalid success values with validation errors', () => {
    const route = findRoute(createApiLogRoutes(), '/api/v1/api-logs');

    expect(() => route.handler(context({ query: new URLSearchParams([['success', 'yes']]) }))).toThrow(
      ApiHttpError,
    );
    expect(() => route.handler(context({ query: new URLSearchParams([['success', 'yes']]) }))).toThrow(
      expect.objectContaining({
        name: 'ApiHttpError',
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      }),
    );
    expect(mockQueryApiLogs).not.toHaveBeenCalled();
  });

  it('rejects limits above the route limit', () => {
    const route = findRoute(createApiLogRoutes(), '/api/v1/api-logs');

    expect(() => route.handler(context({ query: new URLSearchParams([['limit', '501']]) }))).toThrow(
      expect.objectContaining({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      }),
    );
    expect(mockQueryApiLogs).not.toHaveBeenCalled();
  });

  it('rejects duplicate log query parameters', () => {
    const route = findRoute(createApiLogRoutes(), '/api/v1/api-logs');

    for (const query of [
      new URLSearchParams([['limit', '10'], ['limit', '-1']]),
      new URLSearchParams([['success', 'false'], ['success', 'yes']]),
      new URLSearchParams([['foo', '1'], ['foo', '2']]),
    ]) {
      expect(() => route.handler(context({ query }))).toThrow(
        expect.objectContaining({
          statusCode: 422,
          code: 'VALIDATION_ERROR',
        }),
      );
    }
    expect(mockQueryApiLogs).not.toHaveBeenCalled();
  });

  it('rejects invalid limit forms with validation errors', () => {
    const route = findRoute(createApiLogRoutes(), '/api/v1/api-logs');

    for (const limit of ['', '0', '-1', '1.5']) {
      expect(() => route.handler(context({ query: new URLSearchParams([['limit', limit]]) }))).toThrow(
        expect.objectContaining({
          statusCode: 422,
          code: 'VALIDATION_ERROR',
        }),
      );
    }
    expect(mockQueryApiLogs).not.toHaveBeenCalled();
  });

  it('rejects negative and non-integer offsets with validation errors', () => {
    const route = findRoute(createApiLogRoutes(), '/api/v1/api-logs');

    for (const offset of ['', '-1', '1.5']) {
      expect(() => route.handler(context({ query: new URLSearchParams([['offset', offset]]) }))).toThrow(
        expect.objectContaining({
          statusCode: 422,
          code: 'VALIDATION_ERROR',
        }),
      );
    }
    expect(mockQueryApiLogs).not.toHaveBeenCalled();
  });

  it('rejects empty success values with validation errors', () => {
    const route = findRoute(createApiLogRoutes(), '/api/v1/api-logs');

    expect(() => route.handler(context({ query: new URLSearchParams([['success', '']]) }))).toThrow(
      expect.objectContaining({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      }),
    );
    expect(mockQueryApiLogs).not.toHaveBeenCalled();
  });

  it('rejects invalid methods with validation errors', () => {
    const route = findRoute(createApiLogRoutes(), '/api/v1/api-logs');

    for (const method of ['', '   ', '\nGET', 'GET ', 'GE T', 'GET1', 'FOO']) {
      expect(() => route.handler(context({ query: new URLSearchParams([['method', method]]) }))).toThrow(
        expect.objectContaining({
          statusCode: 422,
          code: 'VALIDATION_ERROR',
        }),
      );
    }
    expect(mockQueryApiLogs).not.toHaveBeenCalled();
  });

  it('rejects path filters with wildcards, control characters, or excessive length', () => {
    const route = findRoute(createApiLogRoutes(), '/api/v1/api-logs');

    for (const path of ['%', 'abc_def', 'line\nfeed', '\nhealth', 'health ', 'a'.repeat(201)]) {
      expect(() => route.handler(context({ query: new URLSearchParams([['path', path]]) }))).toThrow(
        expect.objectContaining({
          statusCode: 422,
          code: 'VALIDATION_ERROR',
        }),
      );
    }
    expect(mockQueryApiLogs).not.toHaveBeenCalled();
  });
});

describe('API event routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('subscribes each allowed event channel and returns undefined', () => {
    const subscribe = vi.fn();
    const route = findRoute(createEventRoutes({ subscribe }), '/api/v1/events/:channel');
    const channels: ApiEventChannel[] = ['downloads', 'favorite-tags', 'booru', 'api-logs', 'system'];

    for (const channel of channels) {
      expect(route.handler(context({ params: { channel } }))).toBeUndefined();
      expect(subscribe).toHaveBeenLastCalledWith(channel, expect.anything(), expect.anything());
    }

    expect(subscribe).toHaveBeenCalledTimes(channels.length);
  });

  it('rejects invalid event channels and does not subscribe', () => {
    const subscribe = vi.fn();
    const route = findRoute(createEventRoutes({ subscribe }), '/api/v1/events/:channel');

    expect(() => route.handler(context({ params: { channel: 'invalid' } }))).toThrow(
      expect.objectContaining({
        name: 'ApiHttpError',
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Event channel not found',
      }),
    );
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('passes exact request and response objects to the event hub', () => {
    const subscribe = vi.fn();
    const route = findRoute(createEventRoutes({ subscribe }), '/api/v1/events/:channel');
    const req = { id: 'req-1' } as unknown as ApiRequestContext['req'];
    const res = { id: 'res-1' } as unknown as ApiRequestContext['res'];

    expect(route.handler(context({ params: { channel: 'downloads' }, req, res }))).toBeUndefined();

    expect(subscribe).toHaveBeenCalledWith('downloads', req, res);
  });
});
