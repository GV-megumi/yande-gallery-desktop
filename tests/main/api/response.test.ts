import type { ServerResponse } from 'http';
import { describe, expect, it, vi } from 'vitest';
import { sendApiError, sendSuccess } from '../../../src/main/api/response.js';
import { ApiHttpError } from '../../../src/main/api/types.js';

function createMockResponse(): ServerResponse & {
  body?: string;
  headers: Record<string, string | number | readonly string[]>;
  destroyed: boolean;
  headersSent: boolean;
  end: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  writableEnded: boolean;
} {
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string | number | readonly string[]>,
    destroyed: false,
    headersSent: false,
    setHeader: vi.fn((name: string, value: string | number | readonly string[]) => {
      response.headers[name] = value;
      return response;
    }),
    end: vi.fn((body?: string) => {
      response.body = body;
      response.writableEnded = true;
      return response;
    }),
    writableEnded: false,
  };

  return response as unknown as ServerResponse & typeof response;
}

describe('api response helpers', () => {
  it('sends success envelopes with status and JSON content type', () => {
    const res = createMockResponse();

    sendSuccess(res, { id: 1 }, 201);

    expect(res.statusCode).toBe(201);
    expect(res.headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(JSON.parse(res.body!)).toEqual({
      success: true,
      data: { id: 1 },
    });
  });

  it('sends ApiHttpError envelopes without changing the public message', () => {
    const res = createMockResponse();
    const error = new ApiHttpError(401, 'UNAUTHORIZED', 'Missing bearer token');

    const normalized = sendApiError(res, error);

    expect(normalized).toEqual({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Missing bearer token',
      logMessage: 'Missing bearer token',
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body!)).toEqual({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing bearer token',
      },
    });
  });

  it('hides unexpected error messages from the response body but keeps them for logs', () => {
    const res = createMockResponse();
    const error = new Error('SQL failed at C:/secret/db.sqlite with token abc');

    const normalized = sendApiError(res, error);

    expect(normalized).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      logMessage: 'SQL failed at C:/secret/db.sqlite with token abc',
    });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body!)).toEqual({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
    });
    expect(res.body).not.toContain('SQL failed');
    expect(res.body).not.toContain('secret');
    expect(res.body).not.toContain('token abc');
  });

  it('does not write success envelopes when the response is destroyed', () => {
    const res = createMockResponse();
    res.destroyed = true;

    sendSuccess(res, { id: 1 });

    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
    expect(res.body).toBeUndefined();
  });

  it('returns normalized errors without writing when the response is destroyed', () => {
    const res = createMockResponse();
    res.destroyed = true;
    const error = new ApiHttpError(403, 'PERMISSION_DENIED', 'Permission denied');

    const normalized = sendApiError(res, error);

    expect(normalized).toEqual({
      statusCode: 403,
      code: 'PERMISSION_DENIED',
      message: 'Permission denied',
      logMessage: 'Permission denied',
    });
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
    expect(res.body).toBeUndefined();
  });
});
