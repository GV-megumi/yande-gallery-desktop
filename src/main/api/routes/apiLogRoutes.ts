import type { ApiLogQuery } from '../../../shared/types.js';
import { queryApiLogs } from '../../services/apiLogService.js';
import { ApiHttpError, type ApiRequestContext, type ApiRoute } from '../types.js';

const MAX_LIMIT = 500;
const MAX_PATH_LENGTH = 200;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function validationError(message: string): never {
  throw new ApiHttpError(422, 'VALIDATION_ERROR', message);
}

function singleQueryParam(query: URLSearchParams, name: string): string | undefined {
  const values = query.getAll(name);
  if (values.length > 1) {
    validationError(`Duplicate query parameter: ${name}`);
  }

  return values[0];
}

function assertNoDuplicateQueryParams(query: URLSearchParams): void {
  const seen = new Set<string>();

  for (const name of query.keys()) {
    if (seen.has(name)) {
      validationError(`Duplicate query parameter: ${name}`);
    }

    seen.add(name);
  }
}

function positiveIntegerQuery(context: ApiRequestContext, name: string, defaultValue: number): number {
  const value = singleQueryParam(context.query, name);
  if (value == null) {
    return defaultValue;
  }

  if (!/^[1-9]\d*$/.test(value)) {
    validationError(`Invalid numeric query: ${name}`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    validationError(`Invalid numeric query: ${name}`);
  }

  return parsed;
}

function nonNegativeIntegerQuery(context: ApiRequestContext, name: string, defaultValue: number): number {
  const value = singleQueryParam(context.query, name);
  if (value == null) {
    return defaultValue;
  }

  if (!/^(0|[1-9]\d*)$/.test(value)) {
    validationError(`Invalid numeric query: ${name}`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    validationError(`Invalid numeric query: ${name}`);
  }

  return parsed;
}

function limitQuery(context: ApiRequestContext): number {
  const limit = positiveIntegerQuery(context, 'limit', 100);
  if (limit > MAX_LIMIT) {
    validationError(`limit must be <= ${MAX_LIMIT}`);
  }

  return limit;
}

function successQuery(context: ApiRequestContext): boolean | undefined {
  const value = singleQueryParam(context.query, 'success');
  if (value == null) {
    return undefined;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }

  validationError('Invalid success query');
}

function methodQuery(context: ApiRequestContext): string | undefined {
  const rawValue = singleQueryParam(context.query, 'method');
  if (rawValue == null) {
    return undefined;
  }

  if (rawValue !== rawValue.trim() || CONTROL_CHARACTER_PATTERN.test(rawValue)) {
    validationError('Invalid method query');
  }

  const value = rawValue.toUpperCase();
  if (!ALLOWED_METHODS.has(value)) {
    validationError('Invalid method query');
  }

  return value;
}

function pathQuery(context: ApiRequestContext): string | undefined {
  const rawValue = singleQueryParam(context.query, 'path');
  if (rawValue == null || rawValue === '') {
    return undefined;
  }

  if (rawValue !== rawValue.trim()) {
    validationError('Invalid path query');
  }
  if (CONTROL_CHARACTER_PATTERN.test(rawValue)) {
    validationError('path must not contain control characters');
  }
  if (rawValue.length > MAX_PATH_LENGTH) {
    validationError(`path must be <= ${MAX_PATH_LENGTH} characters`);
  }
  if (rawValue.includes('%') || rawValue.includes('_')) {
    validationError('path must not contain wildcard characters');
  }

  return rawValue;
}

function apiLogQuery(context: ApiRequestContext): ApiLogQuery {
  assertNoDuplicateQueryParams(context.query);

  return {
    limit: limitQuery(context),
    offset: nonNegativeIntegerQuery(context, 'offset', 0),
    success: successQuery(context),
    method: methodQuery(context),
    path: pathQuery(context),
  };
}

export function createApiLogRoutes(): ApiRoute[] {
  return [
    {
      method: 'GET',
      pattern: '/api/v1/api-logs',
      handler: (context) => queryApiLogs(apiLogQuery(context)),
    },
  ];
}
