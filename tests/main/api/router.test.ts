import type { IncomingMessage } from 'http';
import { Readable } from 'stream';
import { describe, expect, it } from 'vitest';
import {
  createRouteMatcher,
  numberParam,
  optionalNumberQuery,
  readJsonBody,
} from '../../../src/main/api/router.js';
import { ApiHttpError, type ApiRoute } from '../../../src/main/api/types.js';

function createRoutes(): ApiRoute[] {
  return [
    { method: 'GET', pattern: '/api/v1/images/:imageId', handler: () => ({}) },
    { method: 'POST', pattern: '/api/v1/images/:imageId/tags/:tagId', handler: () => ({}) },
    { method: 'GET', pattern: '/api/v1/files/:fileName.json', handler: () => ({}) },
  ];
}

function requestFromChunks(chunks: Array<string | Buffer>): IncomingMessage {
  return Readable.from(chunks) as IncomingMessage;
}

describe('api route matcher', () => {
  it('matches a route and extracts params', () => {
    const matchRoute = createRouteMatcher(createRoutes());

    const match = matchRoute('GET', '/api/v1/images/42');

    expect(match).not.toBeNull();
    expect(match?.route.pattern).toBe('/api/v1/images/:imageId');
    expect(match?.params).toEqual({ imageId: '42' });
  });

  it('does not match different methods or partial paths', () => {
    const matchRoute = createRouteMatcher(createRoutes());

    expect(matchRoute('DELETE', '/api/v1/images/42')).toBeNull();
    expect(matchRoute('GET', '/api/v1/images/42/extra')).toBeNull();
    expect(matchRoute('GET', '/api/v1/images')).toBeNull();
  });

  it('matches methods case-insensitively', () => {
    const matchRoute = createRouteMatcher(createRoutes());

    const match = matchRoute('get', '/api/v1/images/42');

    expect(match?.route.pattern).toBe('/api/v1/images/:imageId');
    expect(match?.params).toEqual({ imageId: '42' });
  });

  it('escapes literal special regex characters in patterns', () => {
    const matchRoute = createRouteMatcher(createRoutes());

    expect(matchRoute('GET', '/api/v1/files/name.json')?.params).toEqual({ fileName: 'name' });
    expect(matchRoute('GET', '/api/v1/files/nameXjson')).toBeNull();
  });

  it('decodes encoded params', () => {
    const matchRoute = createRouteMatcher(createRoutes());

    const match = matchRoute('POST', '/api/v1/images/image%201/tags/tag%2Bone');

    expect(match?.params).toEqual({ imageId: 'image 1', tagId: 'tag+one' });
  });
});

describe('readJsonBody', () => {
  it('parses bounded JSON from request chunks', async () => {
    const body = await readJsonBody(requestFromChunks(['{"name":', '"test"}']), 64);

    expect(body).toEqual({ name: 'test' });
  });

  it('returns an empty object for an empty body', async () => {
    await expect(readJsonBody(requestFromChunks([]))).resolves.toEqual({});
  });

  it('rejects oversized bodies with a validation error', async () => {
    await expect(readJsonBody(requestFromChunks(['{"name":"toolong"}']), 8)).rejects.toMatchObject({
      name: 'ApiHttpError',
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects invalid JSON with a validation error', async () => {
    await expect(readJsonBody(requestFromChunks(['{"name":']))).rejects.toMatchObject({
      name: 'ApiHttpError',
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
  });
});

describe('numberParam', () => {
  it('accepts positive integers', () => {
    expect(numberParam('1', 'imageId')).toBe(1);
    expect(numberParam('9007199254740991', 'imageId')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([
    undefined,
    '',
    '0',
    '-1',
    '1.5',
    'abc',
    '9007199254740992',
  ])('rejects invalid value %s', (value) => {
    expect(() => numberParam(value, 'imageId')).toThrow(ApiHttpError);
    expect(() => numberParam(value, 'imageId')).toThrow(/imageId/);
  });
});

describe('optionalNumberQuery', () => {
  it('returns the default value when the query param is missing or empty', () => {
    expect(optionalNumberQuery(new URLSearchParams(), 'page', 20)).toBe(20);
    expect(optionalNumberQuery(new URLSearchParams([['page', '']]), 'page', 20)).toBe(20);
  });

  it('parses present valid values', () => {
    expect(optionalNumberQuery(new URLSearchParams([['page', '3']]), 'page', 20)).toBe(3);
  });
});
