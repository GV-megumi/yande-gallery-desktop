import type { ApiLogEntry, ApiLogQuery } from '../../shared/types.js';
import { all, get, getDatabase, run } from './database.js';

export type NewApiLogEntry = Omit<ApiLogEntry, 'id'>;

interface ApiLogRow extends Omit<ApiLogEntry, 'success'> {
  success: number;
}

function normalizeLimit(limit?: number): number {
  if (!Number.isFinite(limit)) {
    return 100;
  }
  return Math.min(500, Math.max(1, Math.floor(limit as number)));
}

function normalizeOffset(offset?: number): number {
  if (!Number.isFinite(offset)) {
    return 0;
  }
  return Math.max(0, Math.floor(offset as number));
}

function mapRow(row: ApiLogRow): ApiLogEntry {
  return {
    ...row,
    success: row.success === 1,
  };
}

function buildWhereClause(query: ApiLogQuery = {}): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (query.success != null) {
    clauses.push('success = ?');
    params.push(query.success ? 1 : 0);
  }

  if (query.method) {
    clauses.push('method = ?');
    params.push(query.method);
  }

  if (query.path) {
    clauses.push('path LIKE ?');
    params.push(`%${query.path}%`);
  }

  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

export async function recordApiLog(entry: NewApiLogEntry): Promise<void> {
  const database = await getDatabase();
  await run(
    database,
    `
      INSERT INTO api_logs (
        timestamp,
        sourceIp,
        method,
        path,
        permissionKey,
        statusCode,
        success,
        durationMs,
        errorCode,
        errorMessage,
        requestSummary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
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
    ]
  );
}

export async function queryApiLogs(query: ApiLogQuery = {}): Promise<{ items: ApiLogEntry[]; total: number }> {
  const database = await getDatabase();
  const limit = normalizeLimit(query.limit);
  const offset = normalizeOffset(query.offset);
  const { where, params } = buildWhereClause(query);

  const totalRow = await get<{ total: number }>(
    database,
    `SELECT COUNT(*) AS total FROM api_logs ${where}`,
    params
  );
  const rows = await all<ApiLogRow>(
    database,
    `
      SELECT
        id,
        timestamp,
        sourceIp,
        method,
        path,
        permissionKey,
        statusCode,
        success,
        durationMs,
        errorCode,
        errorMessage,
        requestSummary
      FROM api_logs
      ${where}
      ORDER BY timestamp DESC, id DESC
      LIMIT ? OFFSET ?
    `,
    [...params, limit, offset]
  );

  return {
    items: rows.map(mapRow),
    total: totalRow?.total ?? 0,
  };
}

export async function pruneApiLogs(options: {
  now: Date;
  retentionDays?: number;
  maxEntries?: number;
}): Promise<void> {
  const database = await getDatabase();

  if (Number.isFinite(options.retentionDays) && (options.retentionDays as number) > 0) {
    const cutoff = new Date(options.now.getTime() - (options.retentionDays as number) * 24 * 60 * 60 * 1000);
    await run(database, 'DELETE FROM api_logs WHERE timestamp < ?', [cutoff.toISOString()]);
  }

  if (Number.isFinite(options.maxEntries) && (options.maxEntries as number) >= 0) {
    await run(
      database,
      `
        DELETE FROM api_logs
        WHERE id NOT IN (
          SELECT id FROM api_logs
          ORDER BY timestamp DESC, id DESC
          LIMIT ?
        )
      `,
      [Math.floor(options.maxEntries as number)]
    );
  }
}
