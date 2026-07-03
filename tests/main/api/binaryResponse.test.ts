import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'stream';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  buildWeakEtag, contentTypeForFile, etagMatches, parseRangeHeader, serveBinaryFile,
} from '../../../src/main/api/binaryResponse.js';
import type { ApiRequestContext } from '../../../src/main/api/types.js';

class FakeRes extends PassThrough {
  statusCode = 200;
  headers: Record<string, string | number> = {};
  setHeader(name: string, value: string | number) { this.headers[name.toLowerCase()] = value; }
  removeHeader(name: string) { delete this.headers[name.toLowerCase()]; }
  get headersSent() { return false; }
}

function makeContext(reqHeaders: Record<string, string>, res: FakeRes): ApiRequestContext {
  return {
    req: { headers: reqHeaders } as unknown as ApiRequestContext['req'],
    res: res as unknown as ApiRequestContext['res'],
    method: 'GET', pathname: '/', query: new URLSearchParams(), params: {},
    sourceIp: '127.0.0.1', permissionKey: null,
  };
}

async function collect(res: FakeRes): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of res) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe('parseRangeHeader', () => {
  it('无 Range 头返回 null', () => expect(parseRangeHeader(undefined, 100)).toBeNull());
  it('bytes=0-9', () => expect(parseRangeHeader('bytes=0-9', 100)).toEqual({ start: 0, end: 9 }));
  it('开区间 bytes=90-', () => expect(parseRangeHeader('bytes=90-', 100)).toEqual({ start: 90, end: 99 }));
  it('后缀 bytes=-10', () => expect(parseRangeHeader('bytes=-10', 100)).toEqual({ start: 90, end: 99 }));
  it('end 超界截断到 size-1', () => expect(parseRangeHeader('bytes=0-999', 100)).toEqual({ start: 0, end: 99 }));
  it('start 越界 invalid', () => expect(parseRangeHeader('bytes=100-', 100)).toBe('invalid'));
  it('start>end invalid', () => expect(parseRangeHeader('bytes=9-1', 100)).toBe('invalid'));
  it('多段 invalid', () => expect(parseRangeHeader('bytes=0-1,3-4', 100)).toBe('invalid'));
  it('非 bytes 单位 invalid', () => expect(parseRangeHeader('items=0-1', 100)).toBe('invalid'));
});

describe('etag helpers', () => {
  it('weak etag 格式', () => expect(buildWeakEtag(10, 123.5)).toBe('W/"10-123.5"'));
  it('If-None-Match 命中（含多值与 *）', () => {
    expect(etagMatches('W/"10-1"', 'W/"10-1"')).toBe(true);
    expect(etagMatches('"a", W/"10-1"', 'W/"10-1"')).toBe(true);
    expect(etagMatches('*', 'W/"10-1"')).toBe(true);
    expect(etagMatches('W/"x"', 'W/"10-1"')).toBe(false);
    expect(etagMatches(undefined, 'W/"10-1"')).toBe(false);
  });
});

describe('contentTypeForFile', () => {
  it('已知扩展名', () => {
    expect(contentTypeForFile('/a/b.webp')).toBe('image/webp');
    expect(contentTypeForFile('/a/B.JPG')).toBe('image/jpeg');
    expect(contentTypeForFile('/a/b.png')).toBe('image/png');
    expect(contentTypeForFile('/a/b.gif')).toBe('image/gif');
  });
  it('未知扩展名兜底', () => expect(contentTypeForFile('/a/b.xyz')).toBe('application/octet-stream'));
});

describe('serveBinaryFile', () => {
  let tmpDir = '';
  let filePath = '';
  const CONTENT = Buffer.from('0123456789abcdef');

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'binary-response-'));
    filePath = path.join(tmpDir, 'img.png');
    await fs.writeFile(filePath, CONTENT);
  });
  afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

  it('200 全量：Content-Length/Type/ETag/Cache-Control/Accept-Ranges 齐全', async () => {
    const res = new FakeRes();
    await serveBinaryFile(makeContext({}, res), filePath, 'fail');
    const body = await collect(res);
    expect(res.statusCode).toBe(200);
    expect(body.equals(CONTENT)).toBe(true);
    expect(res.headers['content-length']).toBe(CONTENT.length);
    expect(res.headers['content-type']).toBe('image/png');
    expect(String(res.headers['etag'])).toMatch(/^W\/"\d+-[\d.]+"$/);
    expect(res.headers['cache-control']).toBe('private, max-age=604800');
    expect(res.headers['accept-ranges']).toBe('bytes');
  });

  it('206 单段 Range', async () => {
    const res = new FakeRes();
    await serveBinaryFile(makeContext({ range: 'bytes=4-7' }, res), filePath, 'fail');
    const body = await collect(res);
    expect(res.statusCode).toBe(206);
    expect(body.toString()).toBe('4567');
    expect(res.headers['content-range']).toBe(`bytes 4-7/${CONTENT.length}`);
    expect(res.headers['content-length']).toBe(4);
  });

  it('非法 Range 抛 416，带 Content-Range: bytes */size', async () => {
    const res = new FakeRes();
    await expect(serveBinaryFile(makeContext({ range: 'bytes=99-' }, res), filePath, 'fail'))
      .rejects.toMatchObject({ name: 'ApiHttpError', statusCode: 416 });
    expect(res.headers['content-range']).toBe(`bytes */${CONTENT.length}`);
  });

  it('If-None-Match 命中返回 304 空体', async () => {
    const stat = await fs.stat(filePath);
    const etag = buildWeakEtag(stat.size, stat.mtimeMs);
    const res = new FakeRes();
    await serveBinaryFile(makeContext({ 'if-none-match': etag }, res), filePath, 'fail');
    const body = await collect(res);
    expect(res.statusCode).toBe(304);
    expect(body.length).toBe(0);
  });

  it('If-None-Match 优先于 Range（同时给出时返回 304）', async () => {
    const stat = await fs.stat(filePath);
    const etag = buildWeakEtag(stat.size, stat.mtimeMs);
    const res = new FakeRes();
    await serveBinaryFile(makeContext({ 'if-none-match': etag, range: 'bytes=0-3' }, res), filePath, 'fail');
    expect(res.statusCode).toBe(304);
  });

  it('文件不存在抛 404', async () => {
    const res = new FakeRes();
    await expect(serveBinaryFile(makeContext({}, res), path.join(tmpDir, 'nope.png'), 'fail'))
      .rejects.toMatchObject({ name: 'ApiHttpError', statusCode: 404, code: 'NOT_FOUND' });
  });
});
