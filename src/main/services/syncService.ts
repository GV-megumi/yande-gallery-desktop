/**
 * 移动端元数据同步服务（安卓相册 M1，spec §5.3）。
 *
 * 契约要点：
 *  - 游标 = base64url(JSON {u,i}) 不透明字符串，(updatedAt ASC, id ASC) 键集分页；
 *  - listSyncImages 载荷**不含 filepath**——本地路径绝不经同步接口外泄；
 *  - IN 查询按 900 保守分块（SQLite 变量上限），避免超大页触碰 SQLITE_MAX_VARIABLE_NUMBER。
 */

import { getDatabase, all, get } from './database.js';
import { getConfig, ensureSyncServerId } from './config.js';

export interface SyncImageItem {
  id: number;
  filename: string;
  width: number;
  height: number;
  fileSize: number;
  format: string;
  createdAt: string;
  updatedAt: string;
  tagIds: number[];
  galleryIds: number[];
}

interface SyncCursorPayload {
  u: string;
  i: number;
}

// SQLite 变量上限保守分块（沿用 ORPHAN_GC_BATCH 量级习惯）
const IN_CHUNK = 900;

export function encodeSyncCursor(updatedAt: string, id: number): string {
  return Buffer.from(JSON.stringify({ u: updatedAt, i: id }), 'utf8').toString('base64url');
}

export function decodeSyncCursor(cursor: string): SyncCursorPayload | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Partial<SyncCursorPayload>;
    if (typeof parsed?.u === 'string' && Number.isInteger(parsed?.i)) {
      return { u: parsed.u, i: parsed.i as number };
    }
    return null;
  } catch {
    return null;
  }
}

export async function getSyncMeta(): Promise<{
  serverId: string;
  dataVersion: number;
  imageCount: number;
  latestCursor: string | null;
}> {
  const db = await getDatabase();
  const serverId = await ensureSyncServerId();
  const dataVersion = getConfig().sync.dataVersion;
  const countRow = await get<{ cnt: number }>(db, 'SELECT COUNT(*) as cnt FROM images');
  const latest = await get<{ updatedAt: string; id: number }>(
    db,
    'SELECT updatedAt, id FROM images ORDER BY updatedAt DESC, id DESC LIMIT 1',
  );
  return {
    serverId,
    dataVersion,
    imageCount: countRow?.cnt ?? 0,
    latestCursor: latest ? encodeSyncCursor(latest.updatedAt, latest.id) : null,
  };
}

export async function listSyncImages(
  cursor: SyncCursorPayload | null,
  limit: number,
): Promise<{ items: SyncImageItem[]; nextCursor: string | null; hasMore: boolean }> {
  const db = await getDatabase();
  const where = cursor ? 'WHERE (updatedAt > ? OR (updatedAt = ? AND id > ?))' : '';
  const params: Array<string | number> = cursor ? [cursor.u, cursor.u, cursor.i] : [];
  params.push(limit + 1); // 多取 1 行探测 hasMore

  interface Row {
    id: number;
    filename: string;
    width: number;
    height: number;
    fileSize: number;
    format: string;
    createdAt: string;
    updatedAt: string;
  }
  const rows = await all<Row>(
    db,
    `SELECT id, filename, width, height, fileSize, format, createdAt, updatedAt
       FROM images
       ${where}
      ORDER BY updatedAt ASC, id ASC
      LIMIT ?`,
    params,
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const ids = page.map((row) => row.id);

  const tagMap = new Map<number, number[]>();
  const galleryMap = new Map<number, number[]>();
  for (let offset = 0; offset < ids.length; offset += IN_CHUNK) {
    const chunk = ids.slice(offset, offset + IN_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    for (const row of await all<{ imageId: number; tagId: number }>(
      db,
      `SELECT imageId, tagId FROM image_tags WHERE imageId IN (${placeholders}) ORDER BY tagId`,
      chunk,
    )) {
      appendToMap(tagMap, row.imageId, row.tagId);
    }
    for (const row of await all<{ imageId: number; galleryId: number }>(
      db,
      `SELECT imageId, galleryId FROM gallery_images WHERE imageId IN (${placeholders}) ORDER BY galleryId`,
      chunk,
    )) {
      appendToMap(galleryMap, row.imageId, row.galleryId);
    }
  }

  const items: SyncImageItem[] = page.map((row) => ({
    ...row,
    tagIds: tagMap.get(row.id) ?? [],
    galleryIds: galleryMap.get(row.id) ?? [],
  }));
  const last = page[page.length - 1];
  return {
    items,
    nextCursor: last ? encodeSyncCursor(last.updatedAt, last.id) : null,
    hasMore,
  };
}

function appendToMap(map: Map<number, number[]>, key: number, value: number): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
  } else {
    map.set(key, [value]);
  }
}

export async function listSyncGalleries(): Promise<Array<{
  id: number;
  name: string;
  coverImageId: number | null;
  imageCount: number;
}>> {
  const db = await getDatabase();
  return all(db, 'SELECT id, name, coverImageId, imageCount FROM galleries ORDER BY id');
}

export async function listSyncTags(): Promise<Array<{ id: number; name: string; category: string | null }>> {
  const db = await getDatabase();
  return all(db, 'SELECT id, name, category FROM tags ORDER BY id');
}

export async function listSyncImageIds(): Promise<number[]> {
  const db = await getDatabase();
  const rows = await all<{ id: number }>(db, 'SELECT id FROM images ORDER BY id');
  return rows.map((row) => row.id);
}
