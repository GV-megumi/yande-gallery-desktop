import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import { gunzipSync } from 'zlib';
import { createApiHttpServer } from '../../../src/main/api/server.js';
import { sendSuccessMaybeGzip } from '../../../src/main/api/response.js';
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
  eventsSubscribe: true, apiLogsRead: true, imageWrite: true, galleryWrite: true,
} satisfies ApiServiceConfig['permissions'];

function config(): ApiServiceConfig {
  return {
    enabled: true, mode: 'localhost', port: 0, apiKey: 'test-api-key', permissions,
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

// 超过 gzip 起效阈值的大载荷；'/api/v1/service/info' 权限为 null（公开），避开权限装配
const PAYLOAD = { hello: 'x'.repeat(2048) };

describe('sendSuccessMaybeGzip over real HTTP', () => {
  let server: http.Server;

  beforeEach(() => {
    server = createApiHttpServer({
      config: config(),
      routes: [{
        method: 'GET',
        pattern: '/api/v1/service/info',
        handler: (ctx) => {
          sendSuccessMaybeGzip(ctx.req, ctx.res, PAYLOAD);
          return undefined;
        },
      }],
    });
  });
  afterEach(async () => {
    await close(server);
  });

  it('带 accept-encoding: gzip → Content-Encoding gzip + Vary，gunzip 还原 envelope', async () => {
    const result = await request(server, { path: '/api/v1/service/info', headers: { 'accept-encoding': 'gzip' } });
    expect(result.statusCode).toBe(200);
    expect(result.headers['content-encoding']).toBe('gzip');
    expect(String(result.headers['vary'])).toMatch(/accept-encoding/i);
    expect(result.headers['content-type']).toBe('application/json; charset=utf-8');
    // 原始 body 是压缩字节（JSON.parse 失败），gunzip 后才是 envelope
    expect(result.json).toBeNull();
    const decoded = JSON.parse(gunzipSync(result.body).toString('utf8'));
    expect(decoded).toEqual({ success: true, data: PAYLOAD });
  });

  it('不带 accept-encoding → 无 Content-Encoding，明文 envelope', async () => {
    const result = await request(server, { path: '/api/v1/service/info' });
    expect(result.statusCode).toBe(200);
    expect(result.headers['content-encoding']).toBeUndefined();
    expect(result.json).toEqual({ success: true, data: PAYLOAD });
  });
});
