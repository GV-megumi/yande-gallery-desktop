import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createApiHttpServer } from '../../../src/main/api/server.js';
import { serveBinaryFile } from '../../../src/main/api/binaryResponse.js';
import type { ApiServiceConfig } from '../../../src/shared/types.js';

vi.mock('../../../src/main/services/apiLogService.js', () => ({
  recordApiLog: vi.fn(async () => undefined),
  pruneApiLogs: vi.fn(async () => undefined),
}));
vi.mock('../../../src/main/api/events/eventHub.js', () => ({
  apiEventHub: { publish: vi.fn(), subscribe: vi.fn(), closeAll: vi.fn() },
}));

const permissions = {
  galleryRead: true, imageRead: true, imageBinary: true, booruRead: true, booruWrite: true,
  favoriteTagsRead: true, favoriteTagsWrite: true, downloadsRead: true, downloadsControl: true,
  eventsSubscribe: true, apiLogsRead: true,
} satisfies ApiServiceConfig['permissions'];

function config(): ApiServiceConfig {
  return {
    enabled: true, mode: 'localhost', port: 0, apiKey: 'test-api-key', app: { enabled: false }, permissions,
    logs: { enabled: false, visibleInUi: false, retentionDays: 7, maxEntries: 100 },
  };
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server.listening) {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
      return;
    }
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
    server.once('error', reject);
  });
}

interface HttpResult { statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer; json: unknown }

async function request(server: http.Server, options: { path: string; headers?: Record<string, string> }): Promise<HttpResult> {
  const port = await listen(server);
  return await new Promise<HttpResult>((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, method: 'GET', path: options.path,
      headers: { authorization: 'Bearer test-api-key', ...options.headers },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        let json: unknown = null;
        try { json = JSON.parse(body.toString('utf8')); } catch { json = null; }
        resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body, json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('binary routes over real HTTP', () => {
  let tmpDir = '';
  let filePath = '';
  const CONTENT = Buffer.from('0123456789abcdef');
  let server: http.Server;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'server-binary-'));
    filePath = path.join(tmpDir, 'img.webp');
    await fs.writeFile(filePath, CONTENT);
    server = createApiHttpServer({
      config: config(),
      routes: [{
        method: 'GET', pattern: '/api/v1/service/info',
        handler: (ctx) => serveBinaryFile(ctx, filePath, 'fail'),
      }],
    });
  });
  afterEach(async () => {
    await close(server);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('200：完整字节 + 头齐全', async () => {
    const result = await request(server, { path: '/api/v1/service/info' });
    expect(result.statusCode).toBe(200);
    expect(result.body.equals(CONTENT)).toBe(true);
    expect(result.headers['content-type']).toBe('image/webp');
    expect(result.headers['content-length']).toBe(String(CONTENT.length));
    expect(result.headers['cache-control']).toBe('private, max-age=604800');
    expect(result.headers.etag).toMatch(/^W\//);
    expect(result.headers['accept-ranges']).toBe('bytes');
  });

  it('206：单段 Range', async () => {
    const result = await request(server, { path: '/api/v1/service/info', headers: { range: 'bytes=4-7' } });
    expect(result.statusCode).toBe(206);
    expect(result.body.toString()).toBe('4567');
    expect(result.headers['content-range']).toBe(`bytes 4-7/${CONTENT.length}`);
  });

  it('416：越界 Range 返回 JSON 错误 envelope', async () => {
    const result = await request(server, { path: '/api/v1/service/info', headers: { range: 'bytes=999-' } });
    expect(result.statusCode).toBe(416);
    expect(result.json).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('304：If-None-Match 命中', async () => {
    const first = await request(server, { path: '/api/v1/service/info' });
    const result = await request(server, {
      path: '/api/v1/service/info',
      headers: { 'if-none-match': String(first.headers.etag) },
    });
    expect(result.statusCode).toBe(304);
    expect(result.body.length).toBe(0);
  });
});
