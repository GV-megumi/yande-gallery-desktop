import type { ServerResponse } from 'http';
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
