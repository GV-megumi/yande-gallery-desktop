# API Service Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. User explicitly disabled creating a new git worktree, so execute in the current workspace only.

**Goal:** Build the desktop-side API service described in `doc/skill需求文档/API服务与CLI及Skill整体方案设计.md`, including config, settings UI, HTTP REST, SSE, permissions, API logs, and application lifecycle integration.

**Architecture:** Add a focused `src/main/api/` subsystem inside the Electron main process. The API layer owns HTTP routing, auth, LAN guards, permission checks, envelopes, logs, SSE, and DTO mapping; existing main-process services remain the source of business behavior. Settings and preload expose only controlled API service management operations.

**Tech Stack:** Electron main process, Node `http`, TypeScript, SQLite, Vitest, React + Ant Design settings page.

---

## Scope Check

This plan covers **Phase 1 only: desktop API service**.

The source requirement also contains CLI and Skill work. Those are separate subsystems with their own packaging, command UX, and verification needs, so they should receive separate plans after Phase 1 is verified.

Phase 1 endpoint coverage:

- `GET /api/v1/service/info`
- `GET /api/v1/service/health`
- `GET /api/v1/galleries`
- `GET /api/v1/galleries/:galleryId`
- `GET /api/v1/galleries/:galleryId/images`
- `GET /api/v1/images`
- `GET /api/v1/images/:imageId`
- `GET /api/v1/images/:imageId/thumbnail`
- `GET /api/v1/images/:imageId/file`
- `GET /api/v1/booru-sites`
- `GET /api/v1/booru-sites/active`
- `GET /api/v1/booru-posts/search`
- `GET /api/v1/booru-posts/:siteId/:postId`
- `GET /api/v1/booru-posts/:siteId/:postId/tags`
- `GET /api/v1/booru-posts/:siteId/:postId/favorite-info`
- `GET /api/v1/favorites`
- `POST /api/v1/favorites/:siteId/:postId`
- `DELETE /api/v1/favorites/:siteId/:postId`
- `POST /api/v1/favorites/:siteId/:postId/like`
- `DELETE /api/v1/favorites/:siteId/:postId/like`
- `GET /api/v1/favorite-tags`
- `POST /api/v1/favorite-tags`
- `PATCH /api/v1/favorite-tags/:id`
- `DELETE /api/v1/favorite-tags/:id`
- `GET /api/v1/favorite-tags/:id/binding`
- `PUT /api/v1/favorite-tags/:id/binding`
- `DELETE /api/v1/favorite-tags/:id/binding`
- `POST /api/v1/favorite-tags/:id/bulk-download`
- `GET /api/v1/downloads/queue`
- `GET /api/v1/downloads/tasks`
- `GET /api/v1/downloads/tasks/:taskId`
- `GET /api/v1/downloads/sessions`
- `GET /api/v1/downloads/sessions/:sessionId`
- `POST /api/v1/downloads/sessions/:sessionId/pause`
- `POST /api/v1/downloads/sessions/:sessionId/resume`
- `POST /api/v1/downloads/sessions/:sessionId/cancel`
- `GET /api/v1/api-logs`
- `GET /api/v1/events/downloads`
- `GET /api/v1/events/favorite-tags`
- `GET /api/v1/events/booru`
- `GET /api/v1/events/api-logs`
- `GET /api/v1/events/system`

## File Structure

- Modify: `src/shared/types.ts`
  - Add API service config/status/log/event/shared response types.
- Modify: `src/main/services/config.ts`
  - Add `apiService` config, defaults, normalization, safe renderer output, helper getters.
- Modify: `src/main/services/database.ts`
  - Add `api_logs` table and indexes.
- Create: `src/main/services/apiLogService.ts`
  - Persist, query, and prune API logs through SQLite.
- Create: `src/main/api/types.ts`
  - Internal HTTP context, route, error, permission, status types.
- Create: `src/main/api/response.ts`
  - JSON response helpers and structured API errors.
- Create: `src/main/api/security.ts`
  - Bearer auth, API key generation/fingerprint, client IP normalization, private IP guard.
- Create: `src/main/api/permissions.ts`
  - Central endpoint-to-permission mapping and matcher.
- Create: `src/main/api/router.ts`
  - Minimal Node HTTP router with path params and method matching.
- Create: `src/main/api/events/eventHub.ts`
  - SSE client registry, channel permissions, event broadcast.
- Create: `src/main/api/routes/serviceRoutes.ts`
  - Service info and health.
- Create: `src/main/api/routes/galleryRoutes.ts`
  - Galleries and local image read routes.
- Create: `src/main/api/routes/booruRoutes.ts`
  - Booru sites/posts/favorites/favorite-tags/downloads routes.
- Create: `src/main/api/routes/apiLogRoutes.ts`
  - API log query route.
- Create: `src/main/api/routes/eventRoutes.ts`
  - SSE route adapters.
- Create: `src/main/api/server.ts`
  - HTTP server lifecycle, middleware pipeline, request logging.
- Create: `src/main/api/apiServiceManager.ts`
  - Start/stop/restart/status/generate-key operations driven by config.
- Modify: `src/main/ipc/channels.ts`
  - Add `API_SERVICE_*` channels.
- Modify: `src/main/ipc/handlers/configHandlers.ts`
  - Add API service IPC handlers and trigger API server resync after config changes.
- Modify: `src/preload/index.ts`
  - Expose `window.electronAPI.apiService`.
- Modify: `src/main/index.ts`
  - Start API service after `initializeApp()` and stop during shutdown.
- Modify: `src/main/services/init.ts`
  - Stop API service before database close.
- Modify: `src/renderer/pages/SettingsPage.tsx`
  - Add API service settings tab/group and log viewer entry.
- Modify: `tests/*`
  - Add focused Vitest coverage per task below.

## Task 1: Shared API Service Types and Config Defaults

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/services/config.ts`
- Test: `tests/main/services/config.apiService.test.ts`

- [ ] **Step 1: Write failing config tests**

Create `tests/main/services/config.apiService.test.ts`:

```ts
import path from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn(),
  },
}));

vi.mock('js-yaml', () => ({
  load: vi.fn(),
  dump: vi.fn(() => 'mocked yaml'),
}));

const dotenvMocks = vi.hoisted(() => ({ config: vi.fn() }));

vi.mock('dotenv', () => ({
  default: { config: dotenvMocks.config },
  config: dotenvMocks.config,
}));

describe('apiService config', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.CONFIG_DIR = 'M:/test-config-root';
    dotenvMocks.config.mockReturnValue({ parsed: {} });
  });

  afterEach(() => {
    delete process.env.CONFIG_DIR;
  });

  it('loads conservative apiService defaults into config and renderer-safe config', async () => {
    const configModule = await import('../../../src/main/services/config.js');

    await configModule.initPaths();
    await configModule.loadConfig(path.join('M:/test-config-root', 'config.yaml'));

    const config = configModule.getConfig();
    expect(config.apiService).toEqual({
      enabled: false,
      mode: 'localhost',
      port: 38947,
      apiKey: '',
      permissions: {
        galleryRead: true,
        imageRead: true,
        imageBinary: false,
        booruRead: true,
        booruWrite: false,
        favoriteTagsRead: true,
        favoriteTagsWrite: false,
        downloadsRead: true,
        downloadsControl: false,
        eventsSubscribe: false,
        apiLogsRead: false,
      },
      logs: {
        enabled: false,
        visibleInUi: false,
        retentionDays: 14,
        maxEntries: 1000,
      },
    });

    expect(configModule.toRendererSafeConfig(config).apiService).toEqual(config.apiService);
  });

  it('merges partial apiService saves without losing nested permission and log defaults', async () => {
    const configModule = await import('../../../src/main/services/config.js');

    await configModule.initPaths();
    await configModule.loadConfig(path.join('M:/test-config-root', 'config.yaml'));

    const result = await configModule.saveConfig({
      apiService: {
        enabled: true,
        mode: 'lan',
        port: 49152,
        permissions: {
          downloadsControl: true,
        },
        logs: {
          enabled: true,
          visibleInUi: true,
        },
      },
    });

    expect(result).toEqual({ success: true });
    expect(configModule.getConfig().apiService).toEqual({
      enabled: true,
      mode: 'lan',
      port: 49152,
      apiKey: '',
      permissions: {
        galleryRead: true,
        imageRead: true,
        imageBinary: false,
        booruRead: true,
        booruWrite: false,
        favoriteTagsRead: true,
        favoriteTagsWrite: false,
        downloadsRead: true,
        downloadsControl: true,
        eventsSubscribe: false,
        apiLogsRead: false,
      },
      logs: {
        enabled: true,
        visibleInUi: true,
        retentionDays: 14,
        maxEntries: 1000,
      },
    });
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm run test -- tests/main/services/config.apiService.test.ts`

Expected: FAIL because `apiService` types/defaults/normalization do not exist.

- [ ] **Step 3: Add shared types**

Modify `src/shared/types.ts` by adding these exports near the general shared response types:

```ts
export type ApiServiceMode = 'localhost' | 'lan';

export type ApiServicePermissionKey =
  | 'galleryRead'
  | 'imageRead'
  | 'imageBinary'
  | 'booruRead'
  | 'booruWrite'
  | 'favoriteTagsRead'
  | 'favoriteTagsWrite'
  | 'downloadsRead'
  | 'downloadsControl'
  | 'eventsSubscribe'
  | 'apiLogsRead';

export type ApiServicePermissions = Record<ApiServicePermissionKey, boolean>;

export interface ApiServiceLogsConfig {
  enabled: boolean;
  visibleInUi: boolean;
  retentionDays?: number;
  maxEntries?: number;
}

export interface ApiServiceConfig {
  enabled: boolean;
  mode: ApiServiceMode;
  port: number;
  apiKey: string;
  permissions: ApiServicePermissions;
  logs: ApiServiceLogsConfig;
}

export interface ApiServiceStatus {
  running: boolean;
  enabled: boolean;
  mode: ApiServiceMode;
  port: number;
  bindAddress: string | null;
  baseUrl: string | null;
  startedAt: string | null;
  lastError: string | null;
}

export interface ApiLogEntry {
  id: number;
  timestamp: string;
  sourceIp: string;
  method: string;
  path: string;
  permissionKey?: ApiServicePermissionKey | null;
  statusCode: number;
  success: boolean;
  durationMs: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  requestSummary?: string | null;
}

export interface ApiLogQuery {
  limit?: number;
  offset?: number;
  success?: boolean;
  method?: string;
  path?: string;
}
```

- [ ] **Step 4: Add config interface/defaults/normalization**

Modify `src/main/services/config.ts`:

```ts
import type { ApiServiceConfig } from '../../shared/types.js';
```

Add to `AppConfig`:

```ts
  apiService?: ApiServiceConfig;
```

Add this default block inside `DEFAULT_CONFIG`:

```ts
  apiService: {
    enabled: false,
    mode: 'localhost',
    port: 38947,
    apiKey: '',
    permissions: {
      galleryRead: true,
      imageRead: true,
      imageBinary: false,
      booruRead: true,
      booruWrite: false,
      favoriteTagsRead: true,
      favoriteTagsWrite: false,
      downloadsRead: true,
      downloadsControl: false,
      eventsSubscribe: false,
      apiLogsRead: false,
    },
    logs: {
      enabled: false,
      visibleInUi: false,
      retentionDays: 14,
      maxEntries: 1000,
    },
  },
```

Add helper:

```ts
function normalizeApiServiceConfig(
  currentConfig: Pick<AppConfig, 'apiService'> | undefined,
  input: ConfigSaveInput['apiService'] | undefined,
): ApiServiceConfig {
  const current = currentConfig?.apiService ?? DEFAULT_CONFIG.apiService!;
  return {
    enabled: input?.enabled ?? current.enabled ?? DEFAULT_CONFIG.apiService!.enabled,
    mode: input?.mode ?? current.mode ?? DEFAULT_CONFIG.apiService!.mode,
    port: input?.port ?? current.port ?? DEFAULT_CONFIG.apiService!.port,
    apiKey: input?.apiKey ?? current.apiKey ?? DEFAULT_CONFIG.apiService!.apiKey,
    permissions: {
      ...DEFAULT_CONFIG.apiService!.permissions,
      ...current.permissions,
      ...input?.permissions,
    },
    logs: {
      ...DEFAULT_CONFIG.apiService!.logs,
      ...current.logs,
      ...input?.logs,
    },
  };
}

export function getApiServiceConfig(): ApiServiceConfig {
  return normalizeApiServiceConfig({ apiService: getConfig().apiService }, undefined);
}
```

In `normalizeConfigSaveInput`, add:

```ts
    apiService: normalizeApiServiceConfig(currentConfig, input.apiService),
```

Ensure `toRendererSafeConfig()` keeps `apiService` unchanged.

- [ ] **Step 5: Run GREEN**

Run: `npm run test -- tests/main/services/config.apiService.test.ts`

Expected: PASS.

## Task 2: API Logs SQLite Table and Service

**Files:**
- Modify: `src/main/services/database.ts`
- Create: `src/main/services/apiLogService.ts`
- Test: `tests/main/services/apiLogService.test.ts`

- [ ] **Step 1: Write failing API log service tests**

Create `tests/main/services/apiLogService.test.ts`:

```ts
import sqlite3 from 'sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run, all } from '../../../src/main/services/database';

let db: sqlite3.Database;

vi.mock('../../../src/main/services/database.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/main/services/database')>('../../../src/main/services/database');
  return {
    ...actual,
    getDatabase: vi.fn(async () => db),
  };
});

beforeEach(async () => {
  db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', err => err ? reject(err) : resolve(database));
  });
  await run(db, `
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
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => db.close(err => err ? reject(err) : resolve()));
});

describe('apiLogService', () => {
  it('records and queries API logs in descending time order', async () => {
    const service = await import('../../../src/main/services/apiLogService.js');

    await service.recordApiLog({
      timestamp: '2026-05-23T10:00:00.000Z',
      sourceIp: '127.0.0.1',
      method: 'GET',
      path: '/api/v1/service/health',
      permissionKey: null,
      statusCode: 200,
      success: true,
      durationMs: 5,
      errorCode: null,
      errorMessage: null,
      requestSummary: null,
    });
    await service.recordApiLog({
      timestamp: '2026-05-23T10:01:00.000Z',
      sourceIp: '127.0.0.1',
      method: 'GET',
      path: '/api/v1/images',
      permissionKey: 'imageRead',
      statusCode: 403,
      success: false,
      durationMs: 8,
      errorCode: 'PERMISSION_DENIED',
      errorMessage: 'API 权限未开放：imageRead',
      requestSummary: 'limit=50',
    });

    const result = await service.queryApiLogs({ limit: 10, offset: 0 });

    expect(result.total).toBe(2);
    expect(result.items.map(item => item.path)).toEqual(['/api/v1/images', '/api/v1/service/health']);
    expect(result.items[0]).toMatchObject({
      success: false,
      permissionKey: 'imageRead',
      errorCode: 'PERMISSION_DENIED',
    });
  });

  it('prunes old logs and max-entry overflow', async () => {
    const service = await import('../../../src/main/services/apiLogService.js');
    const base = {
      sourceIp: '127.0.0.1',
      method: 'GET',
      path: '/api/v1/service/health',
      permissionKey: null,
      statusCode: 200,
      success: true,
      durationMs: 1,
      errorCode: null,
      errorMessage: null,
      requestSummary: null,
    };

    await service.recordApiLog({ ...base, timestamp: '2026-05-20T00:00:00.000Z' });
    await service.recordApiLog({ ...base, timestamp: '2026-05-21T00:00:00.000Z' });
    await service.recordApiLog({ ...base, timestamp: '2026-05-22T00:00:00.000Z' });

    await service.pruneApiLogs({
      now: new Date('2026-05-23T00:00:00.000Z'),
      retentionDays: 2,
      maxEntries: 1,
    });

    const rows = await all<{ timestamp: string }>(db, 'SELECT timestamp FROM api_logs ORDER BY timestamp ASC');
    expect(rows.map(row => row.timestamp)).toEqual(['2026-05-22T00:00:00.000Z']);
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm run test -- tests/main/services/apiLogService.test.ts`

Expected: FAIL because `apiLogService.ts` does not exist.

- [ ] **Step 3: Add `api_logs` table**

Modify `src/main/services/database.ts` near other table creation sections:

```ts
    await run(database, `
      CREATE TABLE IF NOT EXISTS api_logs (
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

    await new Promise<void>((resolve, reject) => {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_api_logs_timestamp ON api_logs(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_api_logs_success ON api_logs(success);
        CREATE INDEX IF NOT EXISTS idx_api_logs_path ON api_logs(path);
      `, err => err ? reject(err) : resolve());
    });
```

- [ ] **Step 4: Create API log service**

Create `src/main/services/apiLogService.ts`:

```ts
import { getDatabase, run, all, get } from './database.js';
import type { ApiLogEntry, ApiLogQuery } from '../../shared/types.js';

export type NewApiLogEntry = Omit<ApiLogEntry, 'id'>;

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) return 100;
  return Math.min(Math.max(Math.trunc(value), 1), 500);
}

function normalizeOffset(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) return 0;
  return Math.max(Math.trunc(value), 0);
}

function rowToApiLogEntry(row: any): ApiLogEntry {
  return {
    id: row.id,
    timestamp: row.timestamp,
    sourceIp: row.sourceIp,
    method: row.method,
    path: row.path,
    permissionKey: row.permissionKey,
    statusCode: row.statusCode,
    success: Boolean(row.success),
    durationMs: row.durationMs,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    requestSummary: row.requestSummary,
  };
}

export async function recordApiLog(entry: NewApiLogEntry): Promise<void> {
  const db = await getDatabase();
  await run(db, `
    INSERT INTO api_logs (
      timestamp, sourceIp, method, path, permissionKey, statusCode, success,
      durationMs, errorCode, errorMessage, requestSummary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    entry.timestamp,
    entry.sourceIp,
    entry.method,
    entry.path,
    entry.permissionKey ?? null,
    entry.statusCode,
    entry.success ? 1 : 0,
    entry.durationMs,
    entry.errorCode ?? null,
    entry.errorMessage ?? null,
    entry.requestSummary ?? null,
  ]);
}

export async function queryApiLogs(query: ApiLogQuery = {}): Promise<{ items: ApiLogEntry[]; total: number }> {
  const db = await getDatabase();
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.success !== undefined) {
    where.push('success = ?');
    params.push(query.success ? 1 : 0);
  }
  if (query.method) {
    where.push('method = ?');
    params.push(query.method.toUpperCase());
  }
  if (query.path) {
    where.push('path LIKE ?');
    params.push(`%${query.path}%`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const count = await get<{ total: number }>(db, `SELECT COUNT(*) AS total FROM api_logs ${whereSql}`, params as any[]);
  const rows = await all(db, `
    SELECT * FROM api_logs
    ${whereSql}
    ORDER BY timestamp DESC, id DESC
    LIMIT ? OFFSET ?
  `, [...params, normalizeLimit(query.limit), normalizeOffset(query.offset)] as any[]);

  return {
    total: count?.total ?? 0,
    items: rows.map(rowToApiLogEntry),
  };
}

export async function pruneApiLogs(options: { now: Date; retentionDays?: number; maxEntries?: number }): Promise<void> {
  const db = await getDatabase();
  if (options.retentionDays && options.retentionDays > 0) {
    const cutoff = new Date(options.now.getTime() - options.retentionDays * 24 * 60 * 60 * 1000).toISOString();
    await run(db, 'DELETE FROM api_logs WHERE timestamp < ?', [cutoff]);
  }

  if (options.maxEntries && options.maxEntries > 0) {
    await run(db, `
      DELETE FROM api_logs
      WHERE id NOT IN (
        SELECT id FROM api_logs ORDER BY timestamp DESC, id DESC LIMIT ?
      )
    `, [Math.trunc(options.maxEntries)]);
  }
}
```

- [ ] **Step 5: Run GREEN**

Run: `npm run test -- tests/main/services/apiLogService.test.ts`

Expected: PASS.

## Task 3: API Security, Response, and Permission Mapping

**Files:**
- Create: `src/main/api/types.ts`
- Create: `src/main/api/response.ts`
- Create: `src/main/api/security.ts`
- Create: `src/main/api/permissions.ts`
- Test: `tests/main/api/security.test.ts`
- Test: `tests/main/api/permissions.test.ts`

- [ ] **Step 1: Write failing security tests**

Create `tests/main/api/security.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('API security helpers', () => {
  it('accepts localhost and RFC1918 private IPv4 addresses', async () => {
    const { isAllowedApiSourceIp } = await import('../../../src/main/api/security.js');

    expect(isAllowedApiSourceIp('127.0.0.1')).toBe(true);
    expect(isAllowedApiSourceIp('::1')).toBe(true);
    expect(isAllowedApiSourceIp('::ffff:127.0.0.1')).toBe(true);
    expect(isAllowedApiSourceIp('192.168.1.10')).toBe(true);
    expect(isAllowedApiSourceIp('10.2.3.4')).toBe(true);
    expect(isAllowedApiSourceIp('172.16.0.1')).toBe(true);
    expect(isAllowedApiSourceIp('172.31.255.255')).toBe(true);
  });

  it('rejects public and non-private addresses', async () => {
    const { isAllowedApiSourceIp } = await import('../../../src/main/api/security.js');

    expect(isAllowedApiSourceIp('8.8.8.8')).toBe(false);
    expect(isAllowedApiSourceIp('172.32.0.1')).toBe(false);
    expect(isAllowedApiSourceIp('100.64.0.1')).toBe(false);
  });

  it('authenticates exact Bearer tokens only', async () => {
    const { parseBearerToken, isAuthorizedBearer } = await import('../../../src/main/api/security.js');

    expect(parseBearerToken('Bearer abc')).toBe('abc');
    expect(parseBearerToken('bearer abc')).toBe(null);
    expect(parseBearerToken('Token abc')).toBe(null);
    expect(isAuthorizedBearer('Bearer abc', 'abc')).toBe(true);
    expect(isAuthorizedBearer('Bearer abc', 'ABC')).toBe(false);
    expect(isAuthorizedBearer(undefined, 'abc')).toBe(false);
  });

  it('generates non-empty random API keys and redacted fingerprints', async () => {
    const { generateApiKey, fingerprintApiKey } = await import('../../../src/main/api/security.js');

    const key = generateApiKey();
    expect(key.length).toBeGreaterThanOrEqual(32);
    expect(fingerprintApiKey(key)).toMatch(/^api_[a-f0-9]{12}$/);
    expect(fingerprintApiKey('')).toBe('api_empty');
  });
});
```

- [ ] **Step 2: Write failing permission mapping tests**

Create `tests/main/api/permissions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('API endpoint permission mapping', () => {
  it('maps documented endpoints to module permissions', async () => {
    const { resolvePermissionForRequest } = await import('../../../src/main/api/permissions.js');

    expect(resolvePermissionForRequest('GET', '/api/v1/galleries')).toBe('galleryRead');
    expect(resolvePermissionForRequest('GET', '/api/v1/images/5/file')).toBe('imageBinary');
    expect(resolvePermissionForRequest('GET', '/api/v1/booru-posts/search')).toBe('booruRead');
    expect(resolvePermissionForRequest('POST', '/api/v1/favorites/1/2')).toBe('booruWrite');
    expect(resolvePermissionForRequest('PATCH', '/api/v1/favorite-tags/9')).toBe('favoriteTagsWrite');
    expect(resolvePermissionForRequest('POST', '/api/v1/favorite-tags/9/bulk-download')).toBe('downloadsControl');
    expect(resolvePermissionForRequest('GET', '/api/v1/downloads/sessions')).toBe('downloadsRead');
    expect(resolvePermissionForRequest('POST', '/api/v1/downloads/sessions/session-1/pause')).toBe('downloadsControl');
    expect(resolvePermissionForRequest('GET', '/api/v1/events/downloads')).toBe('eventsSubscribe');
    expect(resolvePermissionForRequest('GET', '/api/v1/api-logs')).toBe('apiLogsRead');
  });

  it('requires no module permission for service info and health', async () => {
    const { resolvePermissionForRequest } = await import('../../../src/main/api/permissions.js');

    expect(resolvePermissionForRequest('GET', '/api/v1/service/info')).toBe(null);
    expect(resolvePermissionForRequest('GET', '/api/v1/service/health')).toBe(null);
  });
});
```

- [ ] **Step 3: Run tests to verify RED**

Run: `npm run test -- tests/main/api/security.test.ts tests/main/api/permissions.test.ts`

Expected: FAIL because API helper files do not exist.

- [ ] **Step 4: Add internal types and response helpers**

Create `src/main/api/types.ts`:

```ts
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
  constructor(
    public readonly statusCode: number,
    public readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
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
}

export type ApiRouteHandler = (ctx: ApiRequestContext) => Promise<unknown>;

export interface ApiRoute {
  method: string;
  pattern: string;
  handler: ApiRouteHandler;
}
```

Create `src/main/api/response.ts`:

```ts
import type { ServerResponse } from 'http';
import { ApiHttpError } from './types.js';

export function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  if (res.headersSent) return;
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function sendSuccess(res: ServerResponse, data: unknown, statusCode = 200): void {
  sendJson(res, statusCode, { success: true, data });
}

export function sendApiError(res: ServerResponse, error: unknown): { statusCode: number; code: string; message: string } {
  const normalized = error instanceof ApiHttpError
    ? { statusCode: error.statusCode, code: error.code, message: error.message }
    : { statusCode: 500, code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) };

  sendJson(res, normalized.statusCode, {
    success: false,
    error: {
      code: normalized.code,
      message: normalized.message,
    },
  });
  return normalized;
}
```

- [ ] **Step 5: Add security helpers**

Create `src/main/api/security.ts`:

```ts
import crypto from 'crypto';

export function generateApiKey(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function fingerprintApiKey(apiKey: string): string {
  if (!apiKey) return 'api_empty';
  return `api_${crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 12)}`;
}

export function parseBearerToken(headerValue: string | string[] | undefined): string | null {
  if (typeof headerValue !== 'string') return null;
  const prefix = 'Bearer ';
  return headerValue.startsWith(prefix) ? headerValue.slice(prefix.length) : null;
}

export function isAuthorizedBearer(headerValue: string | string[] | undefined, apiKey: string): boolean {
  const token = parseBearerToken(headerValue);
  return Boolean(apiKey) && token === apiKey;
}

export function normalizeRemoteAddress(address: string | undefined): string {
  if (!address) return '';
  if (address.startsWith('::ffff:')) return address.slice('::ffff:'.length);
  return address;
}

export function isAllowedApiSourceIp(address: string | undefined): boolean {
  const ip = normalizeRemoteAddress(address);
  if (ip === '127.0.0.1' || ip === '::1') return true;

  const parts = ip.split('.').map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  return a === 10
    || (a === 192 && b === 168)
    || (a === 172 && b >= 16 && b <= 31);
}
```

- [ ] **Step 6: Add central permission mapping**

Create `src/main/api/permissions.ts`:

```ts
import type { ApiServicePermissionKey } from '../../shared/types.js';

type PermissionRule = {
  method: string;
  pattern: RegExp;
  permission: ApiServicePermissionKey | null;
};

const rules: PermissionRule[] = [
  { method: 'GET', pattern: /^\/api\/v1\/service\/(?:info|health)$/, permission: null },
  { method: 'GET', pattern: /^\/api\/v1\/galleries(?:\/\d+(?:\/images)?)?$/, permission: 'galleryRead' },
  { method: 'GET', pattern: /^\/api\/v1\/images(?:\/\d+)?$/, permission: 'imageRead' },
  { method: 'GET', pattern: /^\/api\/v1\/images\/\d+\/thumbnail$/, permission: 'imageBinary' },
  { method: 'GET', pattern: /^\/api\/v1\/images\/\d+\/file$/, permission: 'imageBinary' },
  { method: 'GET', pattern: /^\/api\/v1\/booru-sites(?:\/active)?$/, permission: 'booruRead' },
  { method: 'GET', pattern: /^\/api\/v1\/booru-posts(?:\/search|\/\d+\/\d+(?:\/tags|\/favorite-info)?)$/, permission: 'booruRead' },
  { method: 'GET', pattern: /^\/api\/v1\/favorites$/, permission: 'booruRead' },
  { method: 'POST', pattern: /^\/api\/v1\/favorites\/\d+\/\d+(?:\/like)?$/, permission: 'booruWrite' },
  { method: 'DELETE', pattern: /^\/api\/v1\/favorites\/\d+\/\d+(?:\/like)?$/, permission: 'booruWrite' },
  { method: 'GET', pattern: /^\/api\/v1\/favorite-tags(?:\/\d+\/binding)?$/, permission: 'favoriteTagsRead' },
  { method: 'POST', pattern: /^\/api\/v1\/favorite-tags$/, permission: 'favoriteTagsWrite' },
  { method: 'PATCH', pattern: /^\/api\/v1\/favorite-tags\/\d+$/, permission: 'favoriteTagsWrite' },
  { method: 'DELETE', pattern: /^\/api\/v1\/favorite-tags\/\d+$/, permission: 'favoriteTagsWrite' },
  { method: 'PUT', pattern: /^\/api\/v1\/favorite-tags\/\d+\/binding$/, permission: 'favoriteTagsWrite' },
  { method: 'DELETE', pattern: /^\/api\/v1\/favorite-tags\/\d+\/binding$/, permission: 'favoriteTagsWrite' },
  { method: 'POST', pattern: /^\/api\/v1\/favorite-tags\/\d+\/bulk-download$/, permission: 'downloadsControl' },
  { method: 'GET', pattern: /^\/api\/v1\/downloads\/(?:queue|tasks(?:\/[^/]+)?|sessions(?:\/[^/]+)?)$/, permission: 'downloadsRead' },
  { method: 'POST', pattern: /^\/api\/v1\/downloads\/sessions\/[^/]+\/(?:pause|resume|cancel)$/, permission: 'downloadsControl' },
  { method: 'GET', pattern: /^\/api\/v1\/api-logs$/, permission: 'apiLogsRead' },
  { method: 'GET', pattern: /^\/api\/v1\/events\/(?:downloads|favorite-tags|booru|api-logs|system)$/, permission: 'eventsSubscribe' },
];

export function resolvePermissionForRequest(method: string, pathname: string): ApiServicePermissionKey | null | undefined {
  return rules.find(rule => rule.method === method.toUpperCase() && rule.pattern.test(pathname))?.permission;
}
```

- [ ] **Step 7: Run GREEN**

Run: `npm run test -- tests/main/api/security.test.ts tests/main/api/permissions.test.ts`

Expected: PASS.

## Task 4: Router and Request Body Utilities

**Files:**
- Create: `src/main/api/router.ts`
- Test: `tests/main/api/router.test.ts`

- [ ] **Step 1: Write failing router tests**

Create `tests/main/api/router.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('API router', () => {
  it('matches routes and extracts path params', async () => {
    const { createRouteMatcher } = await import('../../../src/main/api/router.js');

    const match = createRouteMatcher([
      { method: 'GET', pattern: '/api/v1/images/:imageId', handler: async () => null },
    ]);

    const result = match('GET', '/api/v1/images/42');

    expect(result?.params).toEqual({ imageId: '42' });
  });

  it('does not match different methods or partial paths', async () => {
    const { createRouteMatcher } = await import('../../../src/main/api/router.js');

    const match = createRouteMatcher([
      { method: 'GET', pattern: '/api/v1/images/:imageId', handler: async () => null },
    ]);

    expect(match('POST', '/api/v1/images/42')).toBeNull();
    expect(match('GET', '/api/v1/images/42/file')).toBeNull();
  });

  it('parses bounded JSON request bodies', async () => {
    const { readJsonBody } = await import('../../../src/main/api/router.js');
    const { Readable } = await import('stream');

    const req = Readable.from([Buffer.from(JSON.stringify({ tagName: 'cat' }))]) as any;
    req.headers = { 'content-type': 'application/json' };

    await expect(readJsonBody(req, 1024)).resolves.toEqual({ tagName: 'cat' });
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm run test -- tests/main/api/router.test.ts`

Expected: FAIL because router does not exist.

- [ ] **Step 3: Implement router helpers**

Create `src/main/api/router.ts`:

```ts
import type { IncomingMessage } from 'http';
import { ApiHttpError, type ApiRoute } from './types.js';

type CompiledRoute = ApiRoute & {
  regex: RegExp;
  paramNames: string[];
};

function compilePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const source = pattern
    .split('/')
    .map(segment => {
      if (segment.startsWith(':')) {
        paramNames.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${source}$`), paramNames };
}

export function createRouteMatcher(routes: ApiRoute[]) {
  const compiled: CompiledRoute[] = routes.map(route => ({
    ...route,
    ...compilePattern(route.pattern),
    method: route.method.toUpperCase(),
  }));

  return (method: string, pathname: string): { route: ApiRoute; params: Record<string, string> } | null => {
    for (const route of compiled) {
      if (route.method !== method.toUpperCase()) continue;
      const match = route.regex.exec(pathname);
      if (!match) continue;
      const params = Object.fromEntries(route.paramNames.map((name, index) => [name, decodeURIComponent(match[index + 1])]));
      return { route, params };
    }
    return null;
  };
}

export async function readJsonBody(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new ApiHttpError(422, 'VALIDATION_ERROR', '请求体过大');
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch {
    throw new ApiHttpError(422, 'VALIDATION_ERROR', '请求体不是合法 JSON');
  }
}

export function numberParam(value: string | null | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ApiHttpError(422, 'VALIDATION_ERROR', `${name} 必须是正整数`);
  }
  return parsed;
}

export function optionalNumberQuery(query: URLSearchParams, name: string, defaultValue: number): number {
  const raw = query.get(name);
  if (raw === null || raw === '') return defaultValue;
  return numberParam(raw, name);
}
```

- [ ] **Step 4: Run GREEN**

Run: `npm run test -- tests/main/api/router.test.ts`

Expected: PASS.

## Task 5: API Event Hub and SSE Formatting

**Files:**
- Create: `src/main/api/events/eventHub.ts`
- Test: `tests/main/api/eventHub.test.ts`

- [ ] **Step 1: Write failing event hub tests**

Create `tests/main/api/eventHub.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

describe('API event hub', () => {
  it('writes SSE frames to subscribed channel clients', async () => {
    const { ApiEventHub } = await import('../../../src/main/api/events/eventHub.js');
    const write = vi.fn();
    const end = vi.fn();
    const res = { write, end, setHeader: vi.fn(), flushHeaders: vi.fn() } as any;
    const req = { on: vi.fn() } as any;
    const hub = new ApiEventHub();

    hub.subscribe('downloads', req, res);
    hub.publish('downloads', {
      type: 'downloads.session.updated',
      data: { sessionId: 's1' },
    });

    expect(write).toHaveBeenCalledWith(expect.stringContaining('event: downloads.session.updated'));
    expect(write).toHaveBeenCalledWith(expect.stringContaining('"sessionId":"s1"'));
  });

  it('does not publish events across channels', async () => {
    const { ApiEventHub } = await import('../../../src/main/api/events/eventHub.js');
    const write = vi.fn();
    const res = { write, end: vi.fn(), setHeader: vi.fn(), flushHeaders: vi.fn() } as any;
    const req = { on: vi.fn() } as any;
    const hub = new ApiEventHub();

    hub.subscribe('downloads', req, res);
    hub.publish('api-logs', {
      type: 'api-log.created',
      data: { id: 1 },
    });

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toContain('event: ready');
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm run test -- tests/main/api/eventHub.test.ts`

Expected: FAIL because event hub does not exist.

- [ ] **Step 3: Implement event hub**

Create `src/main/api/events/eventHub.ts`:

```ts
import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';

export type ApiEventChannel = 'downloads' | 'favorite-tags' | 'booru' | 'api-logs' | 'system';

export interface ApiEventPayload {
  eventId?: string;
  type: string;
  timestamp?: string;
  data: unknown;
}

export class ApiEventHub {
  private clients = new Map<ApiEventChannel, Set<ServerResponse>>();

  subscribe(channel: ApiEventChannel, req: IncomingMessage, res: ServerResponse): void {
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');
    res.flushHeaders?.();

    const set = this.clients.get(channel) ?? new Set<ServerResponse>();
    set.add(res);
    this.clients.set(channel, set);

    res.write(this.format({ type: 'ready', data: { channel } }));
    req.on('close', () => {
      set.delete(res);
    });
  }

  publish(channel: ApiEventChannel, payload: ApiEventPayload): void {
    const set = this.clients.get(channel);
    if (!set || set.size === 0) return;
    const frame = this.format(payload);
    for (const client of Array.from(set)) {
      try {
        client.write(frame);
      } catch {
        set.delete(client);
      }
    }
  }

  private format(payload: ApiEventPayload): string {
    const event = {
      eventId: payload.eventId ?? `evt_${randomUUID()}`,
      type: payload.type,
      timestamp: payload.timestamp ?? new Date().toISOString(),
      data: payload.data,
    };
    return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  }
}

export const apiEventHub = new ApiEventHub();
```

- [ ] **Step 4: Run GREEN**

Run: `npm run test -- tests/main/api/eventHub.test.ts`

Expected: PASS.

## Task 6: Service, Gallery, and Image Routes

**Files:**
- Create: `src/main/api/routes/serviceRoutes.ts`
- Create: `src/main/api/routes/galleryRoutes.ts`
- Test: `tests/main/api/routes.serviceGallery.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `tests/main/api/routes.serviceGallery.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

const getConfig = vi.fn(() => ({
  apiService: {
    enabled: true,
    mode: 'localhost',
    port: 38947,
    apiKey: 'secret',
    permissions: { galleryRead: true, imageRead: true, imageBinary: true },
    logs: { enabled: false, visibleInUi: false },
  },
}));

vi.mock('../../../src/main/services/config.js', () => ({
  getConfig,
  getApiServiceConfig: getConfig,
}));

vi.mock('../../../src/main/services/galleryService.js', () => ({
  getGalleries: vi.fn(async () => ({ success: true, data: [{ id: 1, name: 'Gallery' }] })),
  getGallery: vi.fn(async (id: number) => ({ success: true, data: { id, name: 'Gallery' } })),
}));

vi.mock('../../../src/main/services/imageService.js', () => ({
  getImages: vi.fn(async (page: number, pageSize: number) => ({ success: true, data: [{ id: 2, filename: 'a.jpg' }], page, pageSize })),
  getImageById: vi.fn(async (id: number) => ({ success: true, data: { id, filepath: 'M:/a.jpg', filename: 'a.jpg' } })),
  getImagesByFolder: vi.fn(async () => ({ success: true, data: [{ id: 3, filename: 'b.jpg' }] })),
}));

vi.mock('../../../src/main/services/thumbnailService.js', () => ({
  generateThumbnail: vi.fn(async () => ({ success: true, data: 'M:/thumb.webp' })),
}));

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.1.2',
  },
}));

describe('service/gallery/image routes', () => {
  it('returns service info without leaking full API key', async () => {
    const { createServiceRoutes } = await import('../../../src/main/api/routes/serviceRoutes.js');
    const route = createServiceRoutes({ getStatus: () => ({ running: true, enabled: true, mode: 'localhost', port: 38947, bindAddress: '127.0.0.1', baseUrl: 'http://127.0.0.1:38947', startedAt: 'now', lastError: null }) })
      .find(item => item.pattern === '/api/v1/service/info')!;

    const data = await route.handler({ query: new URLSearchParams(), params: {}, permissionKey: null } as any);

    expect(data).toMatchObject({ appName: 'Yande Gallery Desktop', apiVersion: 'v1' });
    expect(JSON.stringify(data)).not.toContain('secret');
    expect(JSON.stringify(data)).toContain('api_');
  });

  it('adapts galleries and image metadata routes to existing services', async () => {
    const { createGalleryRoutes } = await import('../../../src/main/api/routes/galleryRoutes.js');
    const routes = createGalleryRoutes();

    const galleries = await routes.find(item => item.pattern === '/api/v1/galleries')!.handler({ query: new URLSearchParams(), params: {} } as any);
    const image = await routes.find(item => item.pattern === '/api/v1/images/:imageId')!.handler({ query: new URLSearchParams(), params: { imageId: '2' } } as any);

    expect(galleries).toEqual([{ id: 1, name: 'Gallery' }]);
    expect(image).toMatchObject({ id: 2, filename: 'a.jpg' });
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm run test -- tests/main/api/routes.serviceGallery.test.ts`

Expected: FAIL because route files do not exist.

- [ ] **Step 3: Implement service routes**

Create `src/main/api/routes/serviceRoutes.ts`:

```ts
import { app } from 'electron';
import { getApiServiceConfig } from '../../services/config.js';
import { fingerprintApiKey } from '../security.js';
import type { ApiRoute } from '../types.js';

type StatusProvider = {
  getStatus: () => unknown;
};

export function createServiceRoutes(statusProvider: StatusProvider): ApiRoute[] {
  return [
    {
      method: 'GET',
      pattern: '/api/v1/service/info',
      handler: async () => {
        const config = getApiServiceConfig();
        return {
          appName: 'Yande Gallery Desktop',
          appVersion: app.getVersion(),
          apiVersion: 'v1',
          status: statusProvider.getStatus(),
          mode: config.mode,
          permissions: config.permissions,
          apiKeyFingerprint: fingerprintApiKey(config.apiKey),
        };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/service/health',
      handler: async () => ({
        ok: true,
        timestamp: new Date().toISOString(),
      }),
    },
  ];
}
```

- [ ] **Step 4: Implement gallery/image routes**

Create `src/main/api/routes/galleryRoutes.ts`:

```ts
import fs from 'fs';
import type { ApiRoute } from '../types.js';
import { ApiHttpError } from '../types.js';
import { numberParam, optionalNumberQuery } from '../router.js';
import { getGalleries, getGallery } from '../../services/galleryService.js';
import { getImages, getImageById, getImagesByFolder } from '../../services/imageService.js';
import { generateThumbnail } from '../../services/thumbnailService.js';

function unwrap<T>(result: { success: boolean; data?: T; error?: string }): T {
  if (!result.success) {
    throw new ApiHttpError(result.error === 'Image not found' ? 404 : 500, result.error === 'Image not found' ? 'NOT_FOUND' : 'INTERNAL_ERROR', result.error || '服务调用失败');
  }
  return result.data as T;
}

export function createGalleryRoutes(): ApiRoute[] {
  return [
    {
      method: 'GET',
      pattern: '/api/v1/galleries',
      handler: async () => unwrap(await getGalleries()),
    },
    {
      method: 'GET',
      pattern: '/api/v1/galleries/:galleryId',
      handler: async ({ params }) => unwrap(await getGallery(numberParam(params.galleryId, 'galleryId'))),
    },
    {
      method: 'GET',
      pattern: '/api/v1/galleries/:galleryId/images',
      handler: async ({ params, query }) => {
        const gallery = unwrap(await getGallery(numberParam(params.galleryId, 'galleryId')));
        return unwrap(await getImagesByFolder((gallery as any).folderPath, optionalNumberQuery(query, 'page', 1), optionalNumberQuery(query, 'pageSize', 50)));
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/images',
      handler: async ({ query }) => unwrap(await getImages(optionalNumberQuery(query, 'page', 1), optionalNumberQuery(query, 'pageSize', 50))),
    },
    {
      method: 'GET',
      pattern: '/api/v1/images/:imageId',
      handler: async ({ params }) => unwrap(await getImageById(numberParam(params.imageId, 'imageId'))),
    },
    {
      method: 'GET',
      pattern: '/api/v1/images/:imageId/thumbnail',
      handler: async ({ params, res }) => {
        const image = unwrap(await getImageById(numberParam(params.imageId, 'imageId'))) as any;
        const thumbnail = unwrap(await generateThumbnail(image.filepath));
        res.setHeader('content-type', 'image/webp');
        fs.createReadStream(thumbnail).pipe(res);
        return undefined;
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/images/:imageId/file',
      handler: async ({ params, res }) => {
        const image = unwrap(await getImageById(numberParam(params.imageId, 'imageId'))) as any;
        res.setHeader('content-type', 'application/octet-stream');
        fs.createReadStream(image.filepath).pipe(res);
        return undefined;
      },
    },
  ];
}
```

- [ ] **Step 5: Run GREEN**

Run: `npm run test -- tests/main/api/routes.serviceGallery.test.ts`

Expected: PASS.

## Task 7: Booru, Favorites, Favorite Tag, and Download Routes

**Files:**
- Create: `src/main/api/routes/booruRoutes.ts`
- Test: `tests/main/api/routes.booru.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `tests/main/api/routes.booru.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

const booruService = {
  getBooruSites: vi.fn(async () => [{ id: 1, name: 'Yande' }]),
  getActiveBooruSite: vi.fn(async () => ({ id: 1, name: 'Yande' })),
  searchBooruPosts: vi.fn(async () => [{ id: 10, postId: 100 }]),
  getBooruPostBySiteAndId: vi.fn(async (_siteId: number, postId: number) => ({ postId, tags: 'cat dog', isFavorited: false, isLiked: false })),
  getFavorites: vi.fn(async () => [{ postId: 100 }]),
  addToFavorites: vi.fn(async () => 1),
  removeFromFavorites: vi.fn(async () => undefined),
  setPostLiked: vi.fn(async () => undefined),
  getFavoriteTagsWithDownloadState: vi.fn(async () => ({ items: [{ id: 2, tagName: 'cat' }], total: 1, limit: 50, offset: 0 })),
  addFavoriteTag: vi.fn(async () => ({ id: 2, tagName: 'cat' })),
  updateFavoriteTag: vi.fn(async () => ({ id: 2, tagName: 'dog' })),
  removeFavoriteTag: vi.fn(async () => undefined),
  getFavoriteTagDownloadBinding: vi.fn(async () => ({ favoriteTagId: 2, downloadPath: 'D:/downloads' })),
  upsertFavoriteTagDownloadBinding: vi.fn(async input => input),
  removeFavoriteTagDownloadBinding: vi.fn(async () => undefined),
  startFavoriteTagBulkDownload: vi.fn(async () => ({ taskId: 'task-1', sessionId: 'session-1' })),
};

const bulkDownloadService = {
  getBulkDownloadTasks: vi.fn(async () => [{ id: 'task-1' }]),
  getBulkDownloadTaskById: vi.fn(async (id: string) => ({ id })),
  getActiveBulkDownloadSessions: vi.fn(async () => [{ id: 'session-1' }]),
  pauseBulkDownloadSession: vi.fn(async () => ({ success: true })),
  startBulkDownloadSession: vi.fn(async () => ({ success: true })),
  cancelBulkDownloadSession: vi.fn(async () => ({ success: true })),
};

vi.mock('../../../src/main/services/booruService.js', () => booruService);
vi.mock('../../../src/main/services/bulkDownloadService.js', () => bulkDownloadService);
vi.mock('../../../src/main/services/downloadManager.js', () => ({
  downloadManager: {
    pauseDownload: vi.fn(),
  },
}));

describe('booru API routes', () => {
  it('searches booru posts using query params', async () => {
    const { createBooruRoutes } = await import('../../../src/main/api/routes/booruRoutes.js');
    const route = createBooruRoutes().find(item => item.pattern === '/api/v1/booru-posts/search')!;

    const data = await route.handler({
      query: new URLSearchParams('siteId=1&tags=cat dog&page=2&limit=20'),
      params: {},
    } as any);

    expect(data).toEqual([{ id: 10, postId: 100 }]);
    expect(booruService.searchBooruPosts).toHaveBeenCalledWith(1, ['cat', 'dog'], 2, 20);
  });

  it('starts favorite tag bulk download through existing service', async () => {
    const { createBooruRoutes } = await import('../../../src/main/api/routes/booruRoutes.js');
    const route = createBooruRoutes().find(item => item.pattern === '/api/v1/favorite-tags/:id/bulk-download')!;

    await expect(route.handler({ query: new URLSearchParams(), params: { id: '2' } } as any))
      .resolves.toEqual({ taskId: 'task-1', sessionId: 'session-1' });
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm run test -- tests/main/api/routes.booru.test.ts`

Expected: FAIL because `booruRoutes.ts` does not exist.

- [ ] **Step 3: Implement Booru route adapter**

Create `src/main/api/routes/booruRoutes.ts` with these route groups:

```ts
import type { ApiRoute } from '../types.js';
import { ApiHttpError } from '../types.js';
import { numberParam, optionalNumberQuery, readJsonBody } from '../router.js';
import * as booruService from '../../services/booruService.js';
import * as bulkDownloadService from '../../services/bulkDownloadService.js';

function tagsFromQuery(value: string | null): string[] {
  return (value ?? '').split(/\s+/).map(tag => tag.trim()).filter(Boolean);
}

function unwrap<T>(value: T | { success: boolean; data?: T; error?: string }): T {
  if (value && typeof value === 'object' && 'success' in value) {
    const result = value as { success: boolean; data?: T; error?: string };
    if (!result.success) throw new ApiHttpError(500, 'INTERNAL_ERROR', result.error || '服务调用失败');
    return result.data as T;
  }
  return value as T;
}

export function createBooruRoutes(): ApiRoute[] {
  return [
    { method: 'GET', pattern: '/api/v1/booru-sites', handler: async () => booruService.getBooruSites() },
    { method: 'GET', pattern: '/api/v1/booru-sites/active', handler: async () => booruService.getActiveBooruSite() },
    {
      method: 'GET',
      pattern: '/api/v1/booru-posts/search',
      handler: async ({ query }) => booruService.searchBooruPosts(
        numberParam(query.get('siteId'), 'siteId'),
        tagsFromQuery(query.get('tags')),
        optionalNumberQuery(query, 'page', 1),
        optionalNumberQuery(query, 'limit', 20),
      ),
    },
    {
      method: 'GET',
      pattern: '/api/v1/booru-posts/:siteId/:postId',
      handler: async ({ params }) => booruService.getBooruPostBySiteAndId(numberParam(params.siteId, 'siteId'), numberParam(params.postId, 'postId')),
    },
    {
      method: 'GET',
      pattern: '/api/v1/booru-posts/:siteId/:postId/tags',
      handler: async ({ params }) => {
        const post: any = await booruService.getBooruPostBySiteAndId(numberParam(params.siteId, 'siteId'), numberParam(params.postId, 'postId'));
        return { tags: String(post?.tags ?? '').split(/\s+/).filter(Boolean) };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/booru-posts/:siteId/:postId/favorite-info',
      handler: async ({ params }) => {
        const post: any = await booruService.getBooruPostBySiteAndId(numberParam(params.siteId, 'siteId'), numberParam(params.postId, 'postId'));
        return { isFavorited: Boolean(post?.isFavorited), isLiked: Boolean(post?.isLiked) };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/favorites',
      handler: async ({ query }) => booruService.getFavorites(numberParam(query.get('siteId'), 'siteId'), optionalNumberQuery(query, 'page', 1), optionalNumberQuery(query, 'limit', 20)),
    },
    {
      method: 'POST',
      pattern: '/api/v1/favorites/:siteId/:postId',
      handler: async ({ params }) => ({ id: await booruService.addToFavorites(numberParam(params.postId, 'postId'), numberParam(params.siteId, 'siteId')) }),
    },
    {
      method: 'DELETE',
      pattern: '/api/v1/favorites/:siteId/:postId',
      handler: async ({ params }) => {
        await booruService.removeFromFavorites(numberParam(params.postId, 'postId'));
        return { removed: true };
      },
    },
    {
      method: 'POST',
      pattern: '/api/v1/favorites/:siteId/:postId/like',
      handler: async ({ params }) => {
        await booruService.setPostLiked(numberParam(params.siteId, 'siteId'), numberParam(params.postId, 'postId'), true);
        return { liked: true };
      },
    },
    {
      method: 'DELETE',
      pattern: '/api/v1/favorites/:siteId/:postId/like',
      handler: async ({ params }) => {
        await booruService.setPostLiked(numberParam(params.siteId, 'siteId'), numberParam(params.postId, 'postId'), false);
        return { liked: false };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/favorite-tags',
      handler: async ({ query }) => booruService.getFavoriteTagsWithDownloadState({
        siteId: query.get('siteId') ? numberParam(query.get('siteId'), 'siteId') : undefined,
        keyword: query.get('keyword') ?? undefined,
        limit: optionalNumberQuery(query, 'limit', 50),
        offset: Number(query.get('offset') ?? 0),
      }),
    },
    {
      method: 'POST',
      pattern: '/api/v1/favorite-tags',
      handler: async ({ req }) => {
        const body = await readJsonBody(req) as any;
        return booruService.addFavoriteTag(body.siteId ?? null, String(body.tagName ?? ''), body.options);
      },
    },
    {
      method: 'PATCH',
      pattern: '/api/v1/favorite-tags/:id',
      handler: async ({ params, req }) => booruService.updateFavoriteTag(numberParam(params.id, 'id'), await readJsonBody(req) as any),
    },
    {
      method: 'DELETE',
      pattern: '/api/v1/favorite-tags/:id',
      handler: async ({ params }) => {
        await booruService.removeFavoriteTag(numberParam(params.id, 'id'));
        return { removed: true };
      },
    },
    {
      method: 'GET',
      pattern: '/api/v1/favorite-tags/:id/binding',
      handler: async ({ params }) => booruService.getFavoriteTagDownloadBinding(numberParam(params.id, 'id')),
    },
    {
      method: 'PUT',
      pattern: '/api/v1/favorite-tags/:id/binding',
      handler: async ({ params, req }) => booruService.upsertFavoriteTagDownloadBinding({
        ...(await readJsonBody(req) as object),
        favoriteTagId: numberParam(params.id, 'id'),
      }),
    },
    {
      method: 'DELETE',
      pattern: '/api/v1/favorite-tags/:id/binding',
      handler: async ({ params }) => {
        await booruService.removeFavoriteTagDownloadBinding(numberParam(params.id, 'id'));
        return { removed: true };
      },
    },
    {
      method: 'POST',
      pattern: '/api/v1/favorite-tags/:id/bulk-download',
      handler: async ({ params }) => booruService.startFavoriteTagBulkDownload(numberParam(params.id, 'id')),
    },
    { method: 'GET', pattern: '/api/v1/downloads/queue', handler: async ({ query }) => booruService.getDownloadQueue(query.get('status') ?? undefined) },
    { method: 'GET', pattern: '/api/v1/downloads/tasks', handler: async () => bulkDownloadService.getBulkDownloadTasks() },
    { method: 'GET', pattern: '/api/v1/downloads/tasks/:taskId', handler: async ({ params }) => bulkDownloadService.getBulkDownloadTaskById(params.taskId) },
    { method: 'GET', pattern: '/api/v1/downloads/sessions', handler: async () => bulkDownloadService.getActiveBulkDownloadSessions() },
    {
      method: 'GET',
      pattern: '/api/v1/downloads/sessions/:sessionId',
      handler: async ({ params }) => {
        const sessions = await bulkDownloadService.getActiveBulkDownloadSessions();
        const session = sessions.find(item => item.id === params.sessionId);
        if (!session) throw new ApiHttpError(404, 'NOT_FOUND', '批量下载会话不存在');
        return session;
      },
    },
    { method: 'POST', pattern: '/api/v1/downloads/sessions/:sessionId/pause', handler: async ({ params }) => unwrap(await bulkDownloadService.pauseBulkDownloadSession(params.sessionId)) },
    { method: 'POST', pattern: '/api/v1/downloads/sessions/:sessionId/resume', handler: async ({ params }) => unwrap(await bulkDownloadService.startBulkDownloadSession(params.sessionId)) },
    { method: 'POST', pattern: '/api/v1/downloads/sessions/:sessionId/cancel', handler: async ({ params }) => unwrap(await bulkDownloadService.cancelBulkDownloadSession(params.sessionId)) },
  ];
}
```

- [ ] **Step 4: Run GREEN**

Run: `npm run test -- tests/main/api/routes.booru.test.ts`

Expected: PASS.

## Task 8: API Log and Event Routes

**Files:**
- Create: `src/main/api/routes/apiLogRoutes.ts`
- Create: `src/main/api/routes/eventRoutes.ts`
- Test: `tests/main/api/routes.logsEvents.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/main/api/routes.logsEvents.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/main/services/apiLogService.js', () => ({
  queryApiLogs: vi.fn(async () => ({ items: [{ id: 1, path: '/api/v1/service/health' }], total: 1 })),
}));

describe('api log and event routes', () => {
  it('queries logs with parsed filters', async () => {
    const { createApiLogRoutes } = await import('../../../src/main/api/routes/apiLogRoutes.js');
    const { queryApiLogs } = await import('../../../src/main/services/apiLogService.js');
    const route = createApiLogRoutes().find(item => item.pattern === '/api/v1/api-logs')!;

    const result = await route.handler({ query: new URLSearchParams('limit=5&offset=10&success=false&method=get&path=health') } as any);

    expect(result).toEqual({ items: [{ id: 1, path: '/api/v1/service/health' }], total: 1 });
    expect(queryApiLogs).toHaveBeenCalledWith({
      limit: 5,
      offset: 10,
      success: false,
      method: 'GET',
      path: 'health',
    });
  });

  it('subscribes to named SSE event channels', async () => {
    const subscribe = vi.fn();
    const { createEventRoutes } = await import('../../../src/main/api/routes/eventRoutes.js');
    const route = createEventRoutes({ subscribe } as any).find(item => item.pattern === '/api/v1/events/:channel')!;

    const result = await route.handler({ params: { channel: 'downloads' }, req: {}, res: {} } as any);

    expect(result).toBeUndefined();
    expect(subscribe).toHaveBeenCalledWith('downloads', {}, {});
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm run test -- tests/main/api/routes.logsEvents.test.ts`

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement log and event routes**

Create `src/main/api/routes/apiLogRoutes.ts`:

```ts
import type { ApiRoute } from '../types.js';
import { optionalNumberQuery } from '../router.js';
import { queryApiLogs } from '../../services/apiLogService.js';

export function createApiLogRoutes(): ApiRoute[] {
  return [
    {
      method: 'GET',
      pattern: '/api/v1/api-logs',
      handler: async ({ query }) => queryApiLogs({
        limit: optionalNumberQuery(query, 'limit', 100),
        offset: Number(query.get('offset') ?? 0),
        success: query.get('success') === null ? undefined : query.get('success') === 'true',
        method: query.get('method')?.toUpperCase(),
        path: query.get('path') ?? undefined,
      }),
    },
  ];
}
```

Create `src/main/api/routes/eventRoutes.ts`:

```ts
import { ApiHttpError, type ApiRoute } from '../types.js';
import type { ApiEventChannel, ApiEventHub } from '../events/eventHub.js';

const channels = new Set<ApiEventChannel>(['downloads', 'favorite-tags', 'booru', 'api-logs', 'system']);

export function createEventRoutes(eventHub: ApiEventHub): ApiRoute[] {
  return [
    {
      method: 'GET',
      pattern: '/api/v1/events/:channel',
      handler: async ({ params, req, res }) => {
        const channel = params.channel as ApiEventChannel;
        if (!channels.has(channel)) {
          throw new ApiHttpError(404, 'NOT_FOUND', '事件频道不存在');
        }
        eventHub.subscribe(channel, req, res);
        return undefined;
      },
    },
  ];
}
```

- [ ] **Step 4: Run GREEN**

Run: `npm run test -- tests/main/api/routes.logsEvents.test.ts`

Expected: PASS.

## Task 9: HTTP Server Lifecycle and Middleware Pipeline

**Files:**
- Create: `src/main/api/server.ts`
- Test: `tests/main/api/server.test.ts`

- [ ] **Step 1: Write failing server tests**

Create `tests/main/api/server.test.ts`:

```ts
import http from 'http';
import { afterEach, describe, expect, it } from 'vitest';

let server: http.Server | null = null;

afterEach(async () => {
  if (server) {
    await new Promise<void>(resolve => server!.close(() => resolve()));
    server = null;
  }
});

function request(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ statusCode: number; body: any }>((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        resolve({ statusCode: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf-8')) });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('createApiHttpServer', () => {
  it('requires bearer auth for business requests', async () => {
    const { createApiHttpServer } = await import('../../../src/main/api/server.js');
    server = createApiHttpServer({
      config: {
        enabled: true,
        mode: 'localhost',
        port: 0,
        apiKey: 'secret',
        permissions: { galleryRead: true } as any,
        logs: { enabled: false, visibleInUi: false },
      },
      routes: [{ method: 'GET', pattern: '/api/v1/galleries', handler: async () => [] }],
    });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as any).port;

    const result = await request(port, '/api/v1/galleries');

    expect(result.statusCode).toBe(401);
    expect(result.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns successful envelopes for authorized requests', async () => {
    const { createApiHttpServer } = await import('../../../src/main/api/server.js');
    server = createApiHttpServer({
      config: {
        enabled: true,
        mode: 'localhost',
        port: 0,
        apiKey: 'secret',
        permissions: { galleryRead: true } as any,
        logs: { enabled: false, visibleInUi: false },
      },
      routes: [{ method: 'GET', pattern: '/api/v1/galleries', handler: async () => [{ id: 1 }] }],
    });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as any).port;

    const result = await request(port, '/api/v1/galleries', { authorization: 'Bearer secret' });

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ success: true, data: [{ id: 1 }] });
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm run test -- tests/main/api/server.test.ts`

Expected: FAIL because `server.ts` does not exist.

- [ ] **Step 3: Implement HTTP server**

Create `src/main/api/server.ts`:

```ts
import http from 'http';
import { performance } from 'perf_hooks';
import type { ApiServiceConfig } from '../../shared/types.js';
import { createRouteMatcher } from './router.js';
import { sendApiError, sendSuccess } from './response.js';
import { ApiHttpError, type ApiRoute } from './types.js';
import { isAllowedApiSourceIp, isAuthorizedBearer, normalizeRemoteAddress } from './security.js';
import { resolvePermissionForRequest } from './permissions.js';
import { recordApiLog, pruneApiLogs } from '../services/apiLogService.js';
import { apiEventHub } from './events/eventHub.js';

export interface CreateApiHttpServerOptions {
  config: ApiServiceConfig;
  routes: ApiRoute[];
}

function buildRequestSummary(url: URL): string | null {
  const text = url.searchParams.toString();
  return text ? text.slice(0, 1000) : null;
}

export function createApiHttpServer(options: CreateApiHttpServerOptions): http.Server {
  const matchRoute = createRouteMatcher(options.routes);

  return http.createServer(async (req, res) => {
    const started = performance.now();
    const method = (req.method || 'GET').toUpperCase();
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const sourceIp = normalizeRemoteAddress(req.socket.remoteAddress);
    let permissionKey = resolvePermissionForRequest(method, url.pathname) ?? null;
    let statusCode = 200;
    let success = true;
    let errorCode: string | null = null;
    let errorMessage: string | null = null;

    try {
      if (!isAllowedApiSourceIp(sourceIp)) {
        throw new ApiHttpError(403, 'FORBIDDEN_IP', '仅允许本机或局域网来源访问 API');
      }

      if (!isAuthorizedBearer(req.headers.authorization, options.config.apiKey)) {
        throw new ApiHttpError(401, 'UNAUTHORIZED', '缺少或错误的 Bearer API Key');
      }

      if (permissionKey && !options.config.permissions[permissionKey]) {
        throw new ApiHttpError(403, 'PERMISSION_DENIED', `API 权限未开放：${permissionKey}`);
      }

      const matched = matchRoute(method, url.pathname);
      if (!matched) {
        throw new ApiHttpError(404, 'NOT_FOUND', 'API endpoint 不存在');
      }

      const data = await matched.route.handler({
        req,
        res,
        method,
        pathname: url.pathname,
        query: url.searchParams,
        params: matched.params,
        sourceIp,
        permissionKey,
      });

      if (!res.writableEnded && data !== undefined) {
        sendSuccess(res, data);
      }
    } catch (error) {
      success = false;
      const normalized = sendApiError(res, error);
      statusCode = normalized.statusCode;
      errorCode = normalized.code;
      errorMessage = normalized.message;
    } finally {
      statusCode = res.statusCode || statusCode;
      if (options.config.logs.enabled) {
        const entry = {
          timestamp: new Date().toISOString(),
          sourceIp,
          method,
          path: url.pathname,
          permissionKey,
          statusCode,
          success,
          durationMs: Math.round(performance.now() - started),
          errorCode,
          errorMessage,
          requestSummary: buildRequestSummary(url),
        };
        void recordApiLog(entry).then(() => {
          apiEventHub.publish('api-logs', { type: 'api-log.created', data: entry });
          return pruneApiLogs({
            now: new Date(),
            retentionDays: options.config.logs.retentionDays,
            maxEntries: options.config.logs.maxEntries,
          });
        }).catch(error => {
          console.warn('[api] API 日志写入失败:', error);
        });
      }
    }
  });
}
```

- [ ] **Step 4: Run GREEN**

Run: `npm run test -- tests/main/api/server.test.ts`

Expected: PASS.

## Task 10: API Service Manager and Route Assembly

**Files:**
- Create: `src/main/api/apiServiceManager.ts`
- Test: `tests/main/api/apiServiceManager.test.ts`

- [ ] **Step 1: Write failing manager tests**

Create `tests/main/api/apiServiceManager.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

const saveConfig = vi.fn(async () => ({ success: true }));
const getApiServiceConfig = vi.fn(() => ({
  enabled: false,
  mode: 'localhost',
  port: 38947,
  apiKey: '',
  permissions: {},
  logs: { enabled: false, visibleInUi: false },
}));

vi.mock('../../../src/main/services/config.js', () => ({
  getApiServiceConfig,
  saveConfig,
}));

describe('apiServiceManager', () => {
  it('generates and persists API key when current key is empty', async () => {
    const { generateAndSaveApiKey } = await import('../../../src/main/api/apiServiceManager.js');

    const result = await generateAndSaveApiKey();

    expect(result.success).toBe(true);
    expect(result.data?.apiKey.length).toBeGreaterThanOrEqual(32);
    expect(saveConfig).toHaveBeenCalledWith({ apiService: { apiKey: result.data?.apiKey } });
  });

  it('reports stopped status when disabled', async () => {
    const { getApiServiceStatus } = await import('../../../src/main/api/apiServiceManager.js');

    expect(getApiServiceStatus()).toMatchObject({
      running: false,
      enabled: false,
      mode: 'localhost',
      port: 38947,
      bindAddress: null,
    });
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm run test -- tests/main/api/apiServiceManager.test.ts`

Expected: FAIL because manager does not exist.

- [ ] **Step 3: Implement manager and route assembly**

Create `src/main/api/apiServiceManager.ts`:

```ts
import type { Server } from 'http';
import type { ApiServiceStatus } from '../../shared/types.js';
import { getApiServiceConfig, saveConfig } from '../services/config.js';
import { generateApiKey } from './security.js';
import { createApiHttpServer } from './server.js';
import { apiEventHub } from './events/eventHub.js';
import { createApiLogRoutes } from './routes/apiLogRoutes.js';
import { createBooruRoutes } from './routes/booruRoutes.js';
import { createEventRoutes } from './routes/eventRoutes.js';
import { createGalleryRoutes } from './routes/galleryRoutes.js';
import { createServiceRoutes } from './routes/serviceRoutes.js';

let server: Server | null = null;
let status: ApiServiceStatus = {
  running: false,
  enabled: false,
  mode: 'localhost',
  port: 38947,
  bindAddress: null,
  baseUrl: null,
  startedAt: null,
  lastError: null,
};

function getBindAddress(mode: 'localhost' | 'lan'): string {
  return mode === 'localhost' ? '127.0.0.1' : '0.0.0.0';
}

function createRoutes() {
  return [
    ...createServiceRoutes({ getStatus: getApiServiceStatus }),
    ...createGalleryRoutes(),
    ...createBooruRoutes(),
    ...createApiLogRoutes(),
    ...createEventRoutes(apiEventHub),
  ];
}

export function getApiServiceStatus(): ApiServiceStatus {
  const config = getApiServiceConfig();
  return {
    ...status,
    enabled: config.enabled,
    mode: config.mode,
    port: config.port,
  };
}

export async function stopApiService(): Promise<void> {
  if (!server) {
    status = { ...getApiServiceStatus(), running: false, bindAddress: null, baseUrl: null, startedAt: null };
    return;
  }
  const closing = server;
  server = null;
  await new Promise<void>((resolve, reject) => closing.close(error => error ? reject(error) : resolve()));
  status = { ...getApiServiceStatus(), running: false, bindAddress: null, baseUrl: null, startedAt: null };
}

export async function syncApiServiceFromConfig(): Promise<ApiServiceStatus> {
  const config = getApiServiceConfig();
  if (!config.enabled) {
    await stopApiService();
    return getApiServiceStatus();
  }

  await stopApiService();
  const bindAddress = getBindAddress(config.mode);
  server = createApiHttpServer({ config, routes: createRoutes() });

  try {
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(config.port, bindAddress, resolve);
    });
    status = {
      running: true,
      enabled: true,
      mode: config.mode,
      port: config.port,
      bindAddress,
      baseUrl: `http://${bindAddress === '0.0.0.0' ? '127.0.0.1' : bindAddress}:${config.port}`,
      startedAt: new Date().toISOString(),
      lastError: null,
    };
  } catch (error) {
    status = {
      running: false,
      enabled: true,
      mode: config.mode,
      port: config.port,
      bindAddress,
      baseUrl: null,
      startedAt: null,
      lastError: error instanceof Error ? error.message : String(error),
    };
  }
  return status;
}

export async function generateAndSaveApiKey(): Promise<{ success: boolean; data?: { apiKey: string }; error?: string }> {
  try {
    const apiKey = generateApiKey();
    const result = await saveConfig({ apiService: { apiKey } });
    if (!result.success) return result;
    return { success: true, data: { apiKey } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
```

- [ ] **Step 4: Run GREEN**

Run: `npm run test -- tests/main/api/apiServiceManager.test.ts`

Expected: PASS.

## Task 11: IPC Channels, Preload API, and Config Resync

**Files:**
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/main/ipc/handlers/configHandlers.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/main/ipc/apiServiceHandlers.test.ts`
- Test: `tests/preload/main-exposure.test.ts`

- [ ] **Step 1: Write failing IPC/preload tests**

Add to `tests/preload/main-exposure.test.ts`:

```ts
  it('主窗口 apiService 域暴露配置、状态、key 和日志能力', async () => {
    await import('../../src/preload/index');
    const api = exposed.electronAPI as any;

    expect(typeof api.apiService.getConfig).toBe('function');
    expect(typeof api.apiService.saveConfig).toBe('function');
    expect(typeof api.apiService.getStatus).toBe('function');
    expect(typeof api.apiService.generateKey).toBe('function');
    expect(typeof api.apiService.getLogs).toBe('function');

    await api.apiService.getStatus();
    expect(ipcRendererMock.invoke).toHaveBeenCalledWith('api-service:get-status');
  });
```

Create `tests/main/ipc/apiServiceHandlers.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handleMock = vi.fn();

vi.mock('electron', () => ({
  app: { setLoginItemSettings: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: { handle: handleMock },
}));

vi.mock('../../../src/main/api/apiServiceManager.js', () => ({
  getApiServiceStatus: vi.fn(() => ({ running: false })),
  syncApiServiceFromConfig: vi.fn(async () => ({ running: true })),
  generateAndSaveApiKey: vi.fn(async () => ({ success: true, data: { apiKey: 'new-key' } })),
}));

vi.mock('../../../src/main/services/apiLogService.js', () => ({
  queryApiLogs: vi.fn(async () => ({ items: [], total: 0 })),
}));

vi.mock('../../../src/main/services/config.js', async () => {
  const actual = await vi.importActual<any>('../../../src/main/services/config');
  return {
    ...actual,
    getConfig: vi.fn(() => ({
      apiService: {
        enabled: false,
        mode: 'localhost',
        port: 38947,
        apiKey: '',
        permissions: {},
        logs: { enabled: false, visibleInUi: false },
      },
    })),
    getApiServiceConfig: vi.fn(() => ({
      enabled: false,
      mode: 'localhost',
      port: 38947,
      apiKey: '',
      permissions: {},
      logs: { enabled: false, visibleInUi: false },
    })),
    saveConfig: vi.fn(async () => ({ success: true })),
    toRendererSafeConfig: vi.fn((value) => value),
  };
});

describe('api service IPC handlers', () => {
  beforeEach(() => {
    vi.resetModules();
    handleMock.mockClear();
  });

  it('registers API service handlers', async () => {
    const { setupConfigHandlers } = await import('../../../src/main/ipc/handlers/configHandlers.js');
    const { IPC_CHANNELS } = await import('../../../src/main/ipc/channels.js');

    setupConfigHandlers();

    expect(handleMock.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining([
      IPC_CHANNELS.API_SERVICE_GET_CONFIG,
      IPC_CHANNELS.API_SERVICE_SAVE_CONFIG,
      IPC_CHANNELS.API_SERVICE_GET_STATUS,
      IPC_CHANNELS.API_SERVICE_GENERATE_KEY,
      IPC_CHANNELS.API_SERVICE_GET_LOGS,
    ]));
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npm run test -- tests/main/ipc/apiServiceHandlers.test.ts tests/preload/main-exposure.test.ts`

Expected: FAIL because channels and preload domain do not exist.

- [ ] **Step 3: Add channels**

Modify `src/main/ipc/channels.ts`:

```ts
  API_SERVICE_GET_CONFIG: 'api-service:get-config',
  API_SERVICE_SAVE_CONFIG: 'api-service:save-config',
  API_SERVICE_GET_STATUS: 'api-service:get-status',
  API_SERVICE_GENERATE_KEY: 'api-service:generate-key',
  API_SERVICE_GET_LOGS: 'api-service:get-logs',
  API_SERVICE_STATUS_CHANGED: 'api-service:status-changed',
  API_SERVICE_LOG_RECEIVED: 'api-service:log-received',
```

- [ ] **Step 4: Add IPC handlers**

Modify `src/main/ipc/handlers/configHandlers.ts` imports:

```ts
import {
  getApiServiceStatus,
  syncApiServiceFromConfig,
  generateAndSaveApiKey,
} from '../../api/apiServiceManager.js';
import { queryApiLogs } from '../../services/apiLogService.js';
import type { ApiLogQuery, ApiServiceConfig } from '../../../shared/types.js';
```

Inside `setupConfigHandlers`, add handlers:

```ts
  ipcMain.handle(IPC_CHANNELS.API_SERVICE_GET_CONFIG, async () => {
    try {
      return { success: true, data: getConfig().apiService };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.API_SERVICE_SAVE_CONFIG, async (_event: IpcMainInvokeEvent, patch: Partial<ApiServiceConfig>) => {
    try {
      const result = await saveConfig({ apiService: patch });
      if (result.success) {
        await syncApiServiceFromConfig();
        broadcastConfigChanged(['apiService']);
      }
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.API_SERVICE_GET_STATUS, async () => {
    try {
      return { success: true, data: getApiServiceStatus() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.API_SERVICE_GENERATE_KEY, async () => generateAndSaveApiKey());

  ipcMain.handle(IPC_CHANNELS.API_SERVICE_GET_LOGS, async (_event: IpcMainInvokeEvent, query: ApiLogQuery = {}) => {
    try {
      return { success: true, data: await queryApiLogs(query) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
```

After existing generic `CONFIG_SAVE` success path, call `await syncApiServiceFromConfig()` when `collectConfigSaveSections(newConfig)` contains `apiService`.

- [ ] **Step 5: Add preload domain**

Modify `src/preload/index.ts` by adding this `apiService` property to the root object passed to `contextBridge.exposeInMainWorld`:

```ts
  apiService: {
    getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.API_SERVICE_GET_CONFIG),
    saveConfig: (patch: Partial<import('../shared/types').ApiServiceConfig>) =>
      ipcRenderer.invoke(IPC_CHANNELS.API_SERVICE_SAVE_CONFIG, patch),
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.API_SERVICE_GET_STATUS),
    generateKey: () => ipcRenderer.invoke(IPC_CHANNELS.API_SERVICE_GENERATE_KEY),
    getLogs: (query?: import('../shared/types').ApiLogQuery) =>
      ipcRenderer.invoke(IPC_CHANNELS.API_SERVICE_GET_LOGS, query),
  },
```

Extend the global `Window.electronAPI` type with the same methods.

- [ ] **Step 6: Run GREEN**

Run: `npm run test -- tests/main/ipc/apiServiceHandlers.test.ts tests/preload/main-exposure.test.ts`

Expected: PASS.

## Task 12: App Lifecycle Start and Shutdown Integration

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/services/init.ts`
- Test: `tests/main/index.startup.test.ts`
- Test: `tests/main/services/init.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Modify `tests/main/index.startup.test.ts` mocks to include `syncApiServiceFromConfig`, then add:

```ts
it('应用初始化成功后同步 API 服务状态', async () => {
  const apiService = await import('../../../src/main/api/apiServiceManager.js');
  await import('../../../src/main/index.js');
  await flushReady();

  expect(apiService.syncApiServiceFromConfig).toHaveBeenCalledTimes(1);
});
```

Modify `tests/main/services/init.test.ts` mocks to include `stopApiService`, then add:

```ts
it('shutdownAppResources 应在关闭数据库前停止 API 服务', async () => {
  const apiService = await import('../../../src/main/api/apiServiceManager.js');
  const database = await import('../../../src/main/services/database.js');
  const init = await import('../../../src/main/services/init.js');

  await init.shutdownAppResources();

  expect(apiService.stopApiService).toHaveBeenCalledTimes(1);
  expect(database.closeDatabase).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npm run test -- tests/main/index.startup.test.ts tests/main/services/init.test.ts`

Expected: FAIL because lifecycle does not call API manager.

- [ ] **Step 3: Start API service after app init**

Modify `src/main/index.ts` imports:

```ts
import { syncApiServiceFromConfig } from './api/apiServiceManager.js';
```

After successful `initializeApp()` block, call:

```ts
      await syncApiServiceFromConfig();
```

If initialization fails, do not start API service because config/database may be incomplete.

- [ ] **Step 4: Stop API service during shutdown**

Modify `src/main/services/init.ts` imports:

```ts
import { stopApiService } from '../api/apiServiceManager.js';
```

Modify `shutdownAppResources()` before `closeDatabase()`:

```ts
  await stopApiService();
  await closeDatabase();
```

- [ ] **Step 5: Run GREEN**

Run: `npm run test -- tests/main/index.startup.test.ts tests/main/services/init.test.ts`

Expected: PASS.

## Task 13: Settings Page API Service Controls

**Files:**
- Modify: `src/renderer/pages/SettingsPage.tsx`
- Test: `tests/renderer/pages/SettingsPage.test.tsx`

- [ ] **Step 1: Write failing settings UI test**

Modify `tests/renderer/pages/SettingsPage.test.tsx`:

Add mocks:

```ts
const getApiServiceConfig = vi.fn();
const saveApiServiceConfig = vi.fn();
const getApiServiceStatus = vi.fn();
const generateApiServiceKey = vi.fn();
const getApiServiceLogs = vi.fn();
```

In `beforeEach`, set:

```ts
  getApiServiceConfig.mockResolvedValue({
    success: true,
    data: {
      enabled: false,
      mode: 'localhost',
      port: 38947,
      apiKey: 'secret-key',
      permissions: {
        galleryRead: true,
        imageRead: true,
        imageBinary: false,
        booruRead: true,
        booruWrite: false,
        favoriteTagsRead: true,
        favoriteTagsWrite: false,
        downloadsRead: true,
        downloadsControl: false,
        eventsSubscribe: false,
        apiLogsRead: false,
      },
      logs: { enabled: false, visibleInUi: false, retentionDays: 14, maxEntries: 1000 },
    },
  });
  saveApiServiceConfig.mockResolvedValue({ success: true });
  getApiServiceStatus.mockResolvedValue({
    success: true,
    data: {
      running: false,
      enabled: false,
      mode: 'localhost',
      port: 38947,
      bindAddress: null,
      baseUrl: null,
      startedAt: null,
      lastError: null,
    },
  });
  generateApiServiceKey.mockResolvedValue({ success: true, data: { apiKey: 'new-key' } });
  getApiServiceLogs.mockResolvedValue({ success: true, data: { items: [], total: 0 } });
```

Add to `window.electronAPI`:

```ts
    apiService: {
      getConfig: getApiServiceConfig,
      saveConfig: saveApiServiceConfig,
      getStatus: getApiServiceStatus,
      generateKey: generateApiServiceKey,
      getLogs: getApiServiceLogs,
    },
```

Add test:

```ts
it('API 服务页应加载配置并保存启用状态和权限开关', async () => {
  render(<SettingsPage />);

  const apiTab = await screen.findByText('API 服务');
  await userEvent.click(apiTab);

  await screen.findByText('监听模式');
  await screen.findByText('相册读取');

  const enableLabel = screen.getByText('启用 API 服务');
  const enableRow = enableLabel.closest('div[style*="display: flex"]') as HTMLElement;
  const enableSwitch = enableRow.querySelector('.ant-switch') as HTMLButtonElement;
  await userEvent.click(enableSwitch);

  await waitFor(() => {
    expect(saveApiServiceConfig).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm run test -- tests/renderer/pages/SettingsPage.test.tsx`

Expected: FAIL because API service tab is missing.

- [ ] **Step 3: Add API service state and loaders**

Modify `src/renderer/pages/SettingsPage.tsx`:

```ts
import type { ApiLogEntry, ApiServiceConfig, ApiServiceStatus } from '../../shared/types';
```

Add state:

```ts
  const [activeTab, setActiveTab] = useState<'general' | 'proxy' | 'api' | 'about'>('general');
  const [apiConfig, setApiConfig] = useState<ApiServiceConfig | null>(null);
  const [apiStatus, setApiStatus] = useState<ApiServiceStatus | null>(null);
  const [apiLogs, setApiLogs] = useState<ApiLogEntry[]>([]);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
```

Add loader and setter:

```ts
  const loadApiService = async () => {
    if (!window.electronAPI?.apiService) return;
    const [configRes, statusRes] = await Promise.all([
      window.electronAPI.apiService.getConfig(),
      window.electronAPI.apiService.getStatus(),
    ]);
    if (configRes?.success && configRes.data) setApiConfig(configRes.data);
    if (statusRes?.success && statusRes.data) setApiStatus(statusRes.data);
  };

  const saveApiServicePatch = async (patch: Partial<ApiServiceConfig>) => {
    const previous = apiConfig;
    setApiConfig(prev => prev ? { ...prev, ...patch } as ApiServiceConfig : prev);
    const result = await window.electronAPI?.apiService?.saveConfig(patch);
    if (!result?.success) {
      message.error(result?.error || '保存 API 服务配置失败');
      if (previous) setApiConfig(previous);
    }
    await loadApiService();
  };
```

Call `void loadApiService()` on mount.

- [ ] **Step 4: Add API tab UI**

Modify segmented options:

```tsx
{ label: 'API 服务', value: 'api' },
```

Add `activeTab === 'api'` content:

```tsx
      {activeTab === 'api' && apiConfig && (
        <>
          <SettingsGroup title="API 服务" footer="默认仅本机访问；局域网模式仍会拒绝公网来源。">
            <SettingsRow
              label="启用 API 服务"
              description={apiStatus?.running ? `运行中：${apiStatus.baseUrl}` : (apiStatus?.lastError || '未运行')}
              extra={<Switch checked={apiConfig.enabled} onChange={enabled => void saveApiServicePatch({ enabled })} />}
            />
            <SettingsRow
              label="监听模式"
              extra={
                <Segmented
                  value={apiConfig.mode}
                  onChange={mode => void saveApiServicePatch({ mode: mode as ApiServiceConfig['mode'] })}
                  options={[
                    { label: '仅本机', value: 'localhost' },
                    { label: '局域网', value: 'lan' },
                  ]}
                />
              }
            />
            <SettingsRow
              label="端口"
              extra={<Input type="number" value={apiConfig.port} style={{ width: 120 }} onChange={event => void saveApiServicePatch({ port: Number(event.target.value) })} />}
            />
            <SettingsRow
              label="当前绑定地址"
              description={apiStatus?.bindAddress || '-'}
              isLast
            />
          </SettingsGroup>

          <SettingsGroup title="鉴权">
            <SettingsRow
              label="API Key"
              description={apiKeyVisible ? apiConfig.apiKey || '未生成' : apiConfig.apiKey ? '已生成，默认隐藏' : '未生成'}
              extra={
                <Space>
                  <Button size="small" onClick={() => setApiKeyVisible(v => !v)}>{apiKeyVisible ? '隐藏' : '显示'}</Button>
                  <Button size="small" onClick={async () => {
                    const result = await window.electronAPI?.apiService?.generateKey();
                    if (result?.success) await loadApiService();
                  }}>随机生成</Button>
                </Space>
              }
              isLast
            />
          </SettingsGroup>

          <SettingsGroup title="权限">
            {Object.entries(apiConfig.permissions).map(([key, value], index, entries) => (
              <SettingsRow
                key={key}
                label={{
                  galleryRead: '相册读取',
                  imageRead: '图片元数据读取',
                  imageBinary: '图片内容访问',
                  booruRead: 'Booru 只读',
                  booruWrite: 'Booru 业务写操作',
                  favoriteTagsRead: '收藏标签只读',
                  favoriteTagsWrite: '收藏标签写操作',
                  downloadsRead: '下载只读',
                  downloadsControl: '下载控制',
                  eventsSubscribe: '事件订阅',
                  apiLogsRead: 'API 日志查看',
                }[key] || key}
                extra={<Switch checked={Boolean(value)} onChange={checked => void saveApiServicePatch({ permissions: { ...apiConfig.permissions, [key]: checked } })} />}
                isLast={index === entries.length - 1}
              />
            ))}
          </SettingsGroup>

          <SettingsGroup title="日志">
            <SettingsRow
              label="启用 API 日志"
              extra={<Switch checked={apiConfig.logs.enabled} onChange={enabled => void saveApiServicePatch({ logs: { ...apiConfig.logs, enabled } })} />}
            />
            <SettingsRow
              label="在界面显示 API 日志"
              extra={<Switch checked={apiConfig.logs.visibleInUi} onChange={visibleInUi => void saveApiServicePatch({ logs: { ...apiConfig.logs, visibleInUi } })} />}
              isLast
            />
          </SettingsGroup>
        </>
      )}
```

Ensure `activeTab !== 'about'` save button still appears only for `general` and `proxy`, because API service rows save immediately.

- [ ] **Step 5: Run GREEN**

Run: `npm run test -- tests/renderer/pages/SettingsPage.test.tsx`

Expected: PASS.

## Task 14: API Events from Existing Renderer Event Bus

**Files:**
- Modify: `src/main/services/rendererEventBus.ts`
- Test: `tests/main/services/rendererEventBus.apiEvents.test.ts`

- [ ] **Step 1: Write failing event bridge test**

Create `tests/main/services/rendererEventBus.apiEvents.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

const publish = vi.fn();

vi.mock('../../../src/main/api/events/eventHub.js', () => ({
  apiEventHub: { publish },
}));

describe('rendererEventBus API event bridge', () => {
  it('bridges favorite tag and bulk download events to API SSE channels', async () => {
    const { emitBuiltRendererAppEvent } = await import('../../../src/main/services/rendererEventBus.js');

    emitBuiltRendererAppEvent({
      type: 'favorite-tags:changed',
      source: 'test',
      payload: { action: 'updated', favoriteTagId: 1 },
    } as any);
    emitBuiltRendererAppEvent({
      type: 'bulk-download:sessions-changed',
      source: 'test',
      payload: { sessionId: 's1' },
    } as any);

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(publish).toHaveBeenCalledWith('favorite-tags', expect.objectContaining({ type: 'favorite-tags:changed' }));
    expect(publish).toHaveBeenCalledWith('downloads', expect.objectContaining({ type: 'bulk-download:sessions-changed' }));
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm run test -- tests/main/services/rendererEventBus.apiEvents.test.ts`

Expected: FAIL because API event bridge is not wired.

- [ ] **Step 3: Bridge renderer app events to API SSE**

Modify `src/main/services/rendererEventBus.ts`:

```ts
import { apiEventHub, type ApiEventChannel } from '../api/events/eventHub.js';

function resolveApiEventChannel(type: RendererAppEvent['type']): ApiEventChannel {
  if (type.startsWith('bulk-download:') || type.startsWith('download:')) return 'downloads';
  if (type.startsWith('favorite-tag')) return 'favorite-tags';
  if (type.startsWith('booru:')) return 'booru';
  return 'system';
}
```

Inside `emitRendererAppEvent(event)` before async browser window broadcast:

```ts
  apiEventHub.publish(resolveApiEventChannel(event.type), {
    type: event.type,
    timestamp: event.occurredAt,
    data: event,
  });
```

- [ ] **Step 4: Run GREEN**

Run: `npm run test -- tests/main/services/rendererEventBus.apiEvents.test.ts`

Expected: PASS.

## Task 15: Contract Tests for Endpoint Coverage and Build

**Files:**
- Create: `tests/main/api/endpointCoverage.test.ts`

- [ ] **Step 1: Write endpoint coverage test**

Create `tests/main/api/endpointCoverage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const documentedEndpoints = [
  ['GET', '/api/v1/service/info'],
  ['GET', '/api/v1/service/health'],
  ['GET', '/api/v1/galleries'],
  ['GET', '/api/v1/galleries/:galleryId'],
  ['GET', '/api/v1/galleries/:galleryId/images'],
  ['GET', '/api/v1/images'],
  ['GET', '/api/v1/images/:imageId'],
  ['GET', '/api/v1/images/:imageId/thumbnail'],
  ['GET', '/api/v1/images/:imageId/file'],
  ['GET', '/api/v1/booru-sites'],
  ['GET', '/api/v1/booru-sites/active'],
  ['GET', '/api/v1/booru-posts/search'],
  ['GET', '/api/v1/booru-posts/:siteId/:postId'],
  ['GET', '/api/v1/booru-posts/:siteId/:postId/tags'],
  ['GET', '/api/v1/booru-posts/:siteId/:postId/favorite-info'],
  ['GET', '/api/v1/favorites'],
  ['POST', '/api/v1/favorites/:siteId/:postId'],
  ['DELETE', '/api/v1/favorites/:siteId/:postId'],
  ['POST', '/api/v1/favorites/:siteId/:postId/like'],
  ['DELETE', '/api/v1/favorites/:siteId/:postId/like'],
  ['GET', '/api/v1/favorite-tags'],
  ['POST', '/api/v1/favorite-tags'],
  ['PATCH', '/api/v1/favorite-tags/:id'],
  ['DELETE', '/api/v1/favorite-tags/:id'],
  ['GET', '/api/v1/favorite-tags/:id/binding'],
  ['PUT', '/api/v1/favorite-tags/:id/binding'],
  ['DELETE', '/api/v1/favorite-tags/:id/binding'],
  ['POST', '/api/v1/favorite-tags/:id/bulk-download'],
  ['GET', '/api/v1/downloads/queue'],
  ['GET', '/api/v1/downloads/tasks'],
  ['GET', '/api/v1/downloads/tasks/:taskId'],
  ['GET', '/api/v1/downloads/sessions'],
  ['GET', '/api/v1/downloads/sessions/:sessionId'],
  ['POST', '/api/v1/downloads/sessions/:sessionId/pause'],
  ['POST', '/api/v1/downloads/sessions/:sessionId/resume'],
  ['POST', '/api/v1/downloads/sessions/:sessionId/cancel'],
  ['GET', '/api/v1/api-logs'],
  ['GET', '/api/v1/events/:channel'],
];

describe('API endpoint coverage', () => {
  it('assembles all documented Phase 1 routes', async () => {
    const { createServiceRoutes } = await import('../../../src/main/api/routes/serviceRoutes.js');
    const { createGalleryRoutes } = await import('../../../src/main/api/routes/galleryRoutes.js');
    const { createBooruRoutes } = await import('../../../src/main/api/routes/booruRoutes.js');
    const { createApiLogRoutes } = await import('../../../src/main/api/routes/apiLogRoutes.js');
    const { createEventRoutes } = await import('../../../src/main/api/routes/eventRoutes.js');

    const routes = [
      ...createServiceRoutes({ getStatus: () => ({}) }),
      ...createGalleryRoutes(),
      ...createBooruRoutes(),
      ...createApiLogRoutes(),
      ...createEventRoutes({ subscribe: () => undefined } as any),
    ];
    const actual = routes.map(route => [route.method, route.pattern]);

    expect(actual).toEqual(expect.arrayContaining(documentedEndpoints));
  });
});
```

- [ ] **Step 2: Run endpoint coverage test**

Run: `npm run test -- tests/main/api/endpointCoverage.test.ts`

Expected: PASS.

- [ ] **Step 3: Run focused API test suite**

Run:

```bash
npm run test -- tests/main/api tests/main/services/config.apiService.test.ts tests/main/services/apiLogService.test.ts tests/main/services/rendererEventBus.apiEvents.test.ts tests/main/ipc/apiServiceHandlers.test.ts tests/preload/main-exposure.test.ts tests/renderer/pages/SettingsPage.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Run full test suite**

Run: `npm run test`

Expected: PASS. If existing unrelated tests fail, record the exact failing tests and rerun the focused suite to preserve evidence for this change.

## Task 16: Code Review Checkpoint

**Files:**
- Review all changed files.

- [ ] **Step 1: Get diff base**

Run:

```bash
git rev-parse HEAD
git status --short
```

Expected: command succeeds; note current base SHA and changed files.

- [ ] **Step 2: Request code review**

Use `superpowers:requesting-code-review` with:

```text
DESCRIPTION: Implemented Phase 1 desktop API service for Yande Gallery Desktop.
PLAN_OR_REQUIREMENTS: docs/superpowers/plans/2026-05-23-api-service-phase1.md and doc/skill需求文档/API服务与CLI及Skill整体方案设计.md
BASE_SHA: <SHA recorded before implementation>
HEAD_SHA: <current HEAD or working tree diff if not committed>
```

If subagents are unavailable or not permitted for this review, perform a manual review pass against this checklist:

- API service remains disabled by default.
- LAN mode still rejects non-private source IPs.
- Every documented endpoint has a permission mapping.
- No route exposes Booru site credentials, API keys, salt, proxy credentials, or Google secret.
- API logs never persist full API key values.
- Image binary endpoints require `imageBinary`.
- Write endpoints require write/control permissions.
- API service shuts down before SQLite closes.
- Settings page does not include API service state in the generic "保存所有设置" payload.
- Tests demonstrate RED before GREEN for each implemented behavior.

- [ ] **Step 3: Apply review feedback**

For every Critical or Important finding:

1. Verify the finding against code.
2. Write or adjust a failing test.
3. Run the failing test and confirm RED.
4. Fix the code.
5. Run the test and confirm GREEN.
6. Rerun the focused API suite.

## Final Verification

Before reporting completion, use `superpowers:verification-before-completion` and run:

```bash
npm run test -- tests/main/api tests/main/services/config.apiService.test.ts tests/main/services/apiLogService.test.ts tests/main/services/rendererEventBus.apiEvents.test.ts tests/main/ipc/apiServiceHandlers.test.ts tests/preload/main-exposure.test.ts tests/renderer/pages/SettingsPage.test.tsx
npm run build
npm run test
```

Report exact command results, including any unrelated failures if present.

## Follow-Up Plans

After Phase 1 passes review and verification, write separate plans for:

- Phase 2 CLI: TypeScript/Node CLI, config persistence, text/json output, REST calls, SSE watch, packaging for Windows/Linux.
- Phase 3 Skill: CLI-backed skill workflows for gallery query, image search, favorite tags, bulk download start, download status, and API log/event inspection.
