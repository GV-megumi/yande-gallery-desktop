import type { IncomingMessage } from 'http';
import { ApiHttpError, type ApiRoute } from './types.js';

export interface ApiRouteMatch {
  route: ApiRoute;
  params: Record<string, string>;
}

type CompiledRoute = {
  method: string;
  route: ApiRoute;
  regexp: RegExp;
  paramNames: string[];
};

const PARAM_NAME_RE = /^[A-Za-z0-9_]+/;
const REGEXP_SPECIAL_RE = /[\\^$.*+?()[\]{}|]/g;

function escapeRegexp(value: string): string {
  return value.replace(REGEXP_SPECIAL_RE, '\\$&');
}

function compilePattern(pattern: string): { regexp: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  let source = '^';

  for (let index = 0; index < pattern.length;) {
    if (pattern[index] !== ':') {
      source += escapeRegexp(pattern[index]);
      index += 1;
      continue;
    }

    const paramNameMatch = pattern.slice(index + 1).match(PARAM_NAME_RE);
    if (!paramNameMatch) {
      source += ':';
      index += 1;
      continue;
    }

    paramNames.push(paramNameMatch[0]);
    source += '([^/]+)';
    index += 1 + paramNameMatch[0].length;
  }

  source += '$';

  return {
    regexp: new RegExp(source),
    paramNames,
  };
}

export function createRouteMatcher(routes: ApiRoute[]) {
  const compiledRoutes: CompiledRoute[] = routes.map((route) => {
    const compiledPattern = compilePattern(route.pattern);

    return {
      method: route.method.toUpperCase(),
      route,
      ...compiledPattern,
    };
  });

  return (method: string, pathname: string): ApiRouteMatch | null => {
    const normalizedMethod = method.toUpperCase();

    for (const compiledRoute of compiledRoutes) {
      if (compiledRoute.method !== normalizedMethod) {
        continue;
      }

      const match = compiledRoute.regexp.exec(pathname);
      if (!match) {
        continue;
      }

      const params: Record<string, string> = {};

      try {
        compiledRoute.paramNames.forEach((paramName, index) => {
          params[paramName] = decodeURIComponent(match[index + 1]);
        });
      } catch {
        return null;
      }

      return {
        route: compiledRoute.route,
        params,
      };
    }

    return null;
  };
}

export async function readJsonBody(
  req: IncomingMessage,
  maxBytes = 1024 * 1024,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;

    if (totalBytes > maxBytes) {
      throw new ApiHttpError(422, 'VALIDATION_ERROR', 'Request body too large');
    }

    chunks.push(buffer);
  }

  if (totalBytes === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks, totalBytes).toString('utf8'));
  } catch {
    throw new ApiHttpError(422, 'VALIDATION_ERROR', 'Invalid JSON body');
  }
}

export function numberParam(value: string | null | undefined, name: string): number {
  if (value == null || value === '') {
    throw new ApiHttpError(422, 'VALIDATION_ERROR', `Missing numeric parameter: ${name}`);
  }

  if (!/^[1-9]\d*$/.test(value)) {
    throw new ApiHttpError(422, 'VALIDATION_ERROR', `Invalid numeric parameter: ${name}`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ApiHttpError(422, 'VALIDATION_ERROR', `Invalid numeric parameter: ${name}`);
  }

  return parsed;
}

export function optionalNumberQuery(
  query: URLSearchParams,
  name: string,
  defaultValue: number,
): number {
  const value = query.get(name);
  if (value == null || value === '') {
    return defaultValue;
  }

  return numberParam(value, name);
}
