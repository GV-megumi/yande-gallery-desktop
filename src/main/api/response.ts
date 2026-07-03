import type { IncomingMessage, ServerResponse } from 'http';
import { gzipSync } from 'zlib';
import { ApiHttpError, type ApiErrorCode } from './types.js';

export interface NormalizedApiError {
  statusCode: number;
  code: ApiErrorCode;
  message: string;
  logMessage?: string | null;
}

export function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  if (!canWriteJson(res)) {
    return;
  }

  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function sendSuccess(res: ServerResponse, data: unknown, statusCode = 200): void {
  sendJson(res, statusCode, { success: true, data });
}

/**
 * sync 大载荷 JSON：按 Accept-Encoding 协商 gzip（安卓相册 spec §5.3）。
 * 自写响应（自行 setHeader + end），故 handler 调用后必须 return undefined，
 * 避免 server 再经 sendSuccess 包一层。
 */
export function sendSuccessMaybeGzip(req: IncomingMessage, res: ServerResponse, data: unknown): void {
  if (!canWriteJson(res)) {
    return;
  }
  const body = JSON.stringify({ success: true, data });
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const acceptEncoding = String(req.headers['accept-encoding'] ?? '');
  if (/\bgzip\b/i.test(acceptEncoding)) {
    const compressed = gzipSync(Buffer.from(body, 'utf8'));
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Content-Length', compressed.length);
    res.end(compressed);
    return;
  }
  res.end(body);
}

export function sendApiError(res: ServerResponse, error: unknown): NormalizedApiError {
  const normalized = normalizeApiError(error);

  sendJson(res, normalized.statusCode, {
    success: false,
    error: {
      code: normalized.code,
      message: normalized.message,
    },
  });

  return normalized;
}

function canWriteJson(res: ServerResponse): boolean {
  return !res.headersSent && !res.writableEnded && !res.destroyed;
}

function normalizeApiError(error: unknown): NormalizedApiError {
  if (error instanceof ApiHttpError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      logMessage: error.message,
    };
  }

  const logMessage = error instanceof Error && error.message
    ? error.message
    : null;

  return {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
    logMessage,
  };
}
