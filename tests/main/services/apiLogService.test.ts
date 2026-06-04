import sqlite3 from 'sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiLogEntry } from '../../../src/shared/types.js';

let db: sqlite3.Database;

vi.mock('../../../src/main/services/database.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/main/services/database.js')>(
    '../../../src/main/services/database.js'
  );
  return {
    ...actual,
    getDatabase: vi.fn(async () => db),
  };
});

async function openMemoryDatabase(): Promise<sqlite3.Database> {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(database);
      }
    });
  });
}

async function closeDatabase(database: sqlite3.Database): Promise<void> {
  return new Promise((resolve, reject) => {
    database.close((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

async function runSql(sql: string, params: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

async function allSql<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows as T[]);
      }
    });
  });
}

async function createApiLogsTable(): Promise<void> {
  await runSql(`
    CREATE TABLE api_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      sourceIp TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      permissionKey TEXT,
      statusCode INTEGER NOT NULL,
      success INTEGER NOT NULL,
      durationMs INTEGER NOT NULL,
      errorCode TEXT,
      errorMessage TEXT,
      requestSummary TEXT
    )
  `);
}

function makeLog(overrides: Partial<Omit<ApiLogEntry, 'id'>> = {}): Omit<ApiLogEntry, 'id'> {
  return {
    timestamp: '2026-05-23T01:00:00.000Z',
    sourceIp: '127.0.0.1',
    method: 'GET',
    path: '/api/gallery',
    permissionKey: 'galleryRead',
    statusCode: 200,
    success: true,
    durationMs: 12,
    errorCode: null,
    errorMessage: null,
    requestSummary: 'GET /api/gallery',
    ...overrides,
  };
}

describe('apiLogService', () => {
  beforeEach(async () => {
    vi.resetModules();
    db = await openMemoryDatabase();
    await createApiLogsTable();
  });

  afterEach(async () => {
    await closeDatabase(db);
  });

  it('recordApiLog inserts log rows', async () => {
    const { recordApiLog } = await import('../../../src/main/services/apiLogService.js');

    await recordApiLog(makeLog({
      timestamp: '2026-05-23T01:02:03.000Z',
      sourceIp: '192.168.1.10',
      method: 'POST',
      path: '/api/booru/search',
      permissionKey: 'booruRead',
      statusCode: 503,
      success: false,
      durationMs: 145,
      errorCode: 'UPSTREAM_ERROR',
      errorMessage: 'Booru unavailable',
      requestSummary: 'tags=landscape',
    }));

    const rows = await allSql('SELECT * FROM api_logs');
    expect(rows).toEqual([
      {
        id: 1,
        timestamp: '2026-05-23T01:02:03.000Z',
        sourceIp: '192.168.1.10',
        method: 'POST',
        path: '/api/booru/search',
        permissionKey: 'booruRead',
        statusCode: 503,
        success: 0,
        durationMs: 145,
        errorCode: 'UPSTREAM_ERROR',
        errorMessage: 'Booru unavailable',
        requestSummary: 'tags=landscape',
      },
    ]);
  });

  it('queryApiLogs returns items and total in descending timestamp/id order and maps success to boolean', async () => {
    const { recordApiLog, queryApiLogs } = await import('../../../src/main/services/apiLogService.js');

    await recordApiLog(makeLog({ timestamp: '2026-05-23T01:00:00.000Z', path: '/api/old', success: true }));
    await recordApiLog(makeLog({ timestamp: '2026-05-23T02:00:00.000Z', path: '/api/new-a', success: false }));
    await recordApiLog(makeLog({ timestamp: '2026-05-23T02:00:00.000Z', path: '/api/new-b', success: true }));
    await recordApiLog(makeLog({ timestamp: '2026-05-23T03:00:00.000Z', method: 'POST', path: '/api/other', success: true }));

    const result = await queryApiLogs({ success: true, method: 'GET', path: '/api/', limit: 2, offset: 0 });

    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.path)).toEqual(['/api/new-b', '/api/old']);
    expect(result.items.map((item) => item.success)).toEqual([true, true]);
  });

  it('queryApiLogs orders same-timestamp rows by id descending', async () => {
    const { recordApiLog, queryApiLogs } = await import('../../../src/main/services/apiLogService.js');

    await recordApiLog(makeLog({ timestamp: '2026-05-23T02:00:00.000Z', path: '/api/tie-first' }));
    await recordApiLog(makeLog({ timestamp: '2026-05-23T02:00:00.000Z', path: '/api/tie-second' }));

    const result = await queryApiLogs({ path: '/api/tie', limit: 10 });

    expect(result.items.map((item) => item.path)).toEqual(['/api/tie-second', '/api/tie-first']);
  });

  it('queryApiLogs normalizes pagination limit and offset', async () => {
    const { recordApiLog, queryApiLogs } = await import('../../../src/main/services/apiLogService.js');

    await recordApiLog(makeLog({ path: '/api/a' }));
    await recordApiLog(makeLog({ path: '/api/b' }));

    const result = await queryApiLogs({ limit: 0, offset: -50 });

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].path).toBe('/api/b');
  });

  it('pruneApiLogs deletes rows older than retentionDays and enforces maxEntries', async () => {
    const { recordApiLog, pruneApiLogs, queryApiLogs } = await import('../../../src/main/services/apiLogService.js');

    await recordApiLog(makeLog({ timestamp: '2026-05-01T00:00:00.000Z', path: '/api/expired' }));
    await recordApiLog(makeLog({ timestamp: '2026-05-20T00:00:00.000Z', path: '/api/keep-oldest' }));
    await recordApiLog(makeLog({ timestamp: '2026-05-21T00:00:00.000Z', path: '/api/keep-middle' }));
    await recordApiLog(makeLog({ timestamp: '2026-05-22T00:00:00.000Z', path: '/api/keep-newest' }));

    await pruneApiLogs({
      now: new Date('2026-05-23T00:00:00.000Z'),
      retentionDays: 14,
      maxEntries: 2,
    });

    const result = await queryApiLogs({ limit: 10 });
    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.path)).toEqual(['/api/keep-newest', '/api/keep-middle']);
  });
});
