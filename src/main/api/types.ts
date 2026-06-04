import type { IncomingMessage, ServerResponse } from 'http';
import type { ApiServicePermissionKey } from '../../shared/types.js';

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN_IP'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class ApiHttpError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;

  constructor(statusCode: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiHttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface ApiRequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  pathname: string;
  query: URLSearchParams;
  params: Record<string, string>;
  sourceIp: string;
  permissionKey: ApiServicePermissionKey | null;
  body?: unknown;
}

export type ApiRouteHandler = (context: ApiRequestContext) => Promise<unknown> | unknown;

export interface ApiRoute {
  method: string;
  pattern: string;
  handler: ApiRouteHandler;
}
