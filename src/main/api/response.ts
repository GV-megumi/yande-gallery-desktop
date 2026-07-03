import type { IncomingMessage, ServerResponse } from 'http';
import { gzip } from 'zlib';
import { promisify } from 'util';
import { ApiHttpError, type ApiErrorCode } from './types.js';

const gzipAsync = promisify(gzip);

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
 * 自写响应（自行 setHeader + end），故 handler 调用后必须 await 并 return undefined，
 * 避免 server 再经 sendSuccess 包一层。
 *
 * 压缩用异步 zlib.gzip（非 gzipSync）：/sync/images 单页上限 5000、/sync/tags|galleries|image-ids
 * 全量，大库同步若在主进程同步 CPU 压缩会卡住 Electron 事件循环（UI/IPC/其它请求短时无响应）。
 */
export async function sendSuccessMaybeGzip(req: IncomingMessage, res: ServerResponse, data: unknown): Promise<void> {
  if (!canWriteJson(res)) {
    return;
  }
  const body = JSON.stringify({ success: true, data });
  const acceptEncoding = String(req.headers['accept-encoding'] ?? '');
  if (/\bgzip\b/i.test(acceptEncoding)) {
    const compressed = await gzipAsync(Buffer.from(body, 'utf8'));
    // 压缩期间响应可能已被销毁（客户端断开），二次校验避免向已终止的响应写头/体
    if (!canWriteJson(res)) {
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Content-Length', compressed.length);
    res.end(compressed);
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
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
