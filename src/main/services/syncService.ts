/**
 * 移动端元数据同步服务（安卓相册 M1，spec §5.3；M4-T16 起 changeSeq 单调游标）。
 *
 * 契约要点：
 *  - 游标 = base64url(JSON {s}) 不透明字符串，changeSeq ASC 单调键集分页
 *    （根治 M1 Issue 1：墙钟 updatedAt 同毫秒边界可跳行）；旧 {u,i} 形状容忍解码，
 *    由 listSyncImages 按保守水位一次性换轨（defense-in-depth，正常升级路径
 *    dataVersion 已 bump、客户端全量重建不会发出旧游标）；
 *  - listSyncImages 载荷**不含 filepath**（本地路径绝不经同步接口外泄），
 *    也不含 changeSeq（游标内部实现，android 端对游标不透明、载荷契约不变）；
 *  - listSyncGalleries 下发「有效封面」（显式 ?? 最近加入）与 createdAt（v0.6 安卓排序用）；
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

// 判别联合：{s} = changeSeq 游标（M4-T16 起唯一发出的形状）；{u,i} = 升级前旧游标（仅容忍解码）
type SyncCursorPayload = { s: number } | { u: string; i: number };

// SQLite 变量上限保守分块（沿用 ORPHAN_GC_BATCH 量级习惯）
const IN_CHUNK = 900;

export function encodeSyncCursor(changeSeq: number): string {
  return Buffer.from(JSON.stringify({ s: changeSeq }), 'utf8').toString('base64url');
}

// 项目内 ISO 时间戳格式（strftime('%Y-%m-%dT%H:%M:%fZ') 落库形态）：毫秒 3 位、UTC。
const SYNC_CURSOR_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function decodeSyncCursor(cursor: string): SyncCursorPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      s?: unknown; u?: unknown; i?: unknown;
    };
    // 新形状 {s}：changeSeq 非负整数（0 = 从头全量）。
    if (typeof parsed?.s === 'number' && Number.isInteger(parsed.s) && parsed.s >= 0) {
      return { s: parsed.s };
    }
    // 旧 {u,i} 形状（升级前客户端）：容忍——listSyncImages 按 updatedAt 定位一次换轨到 changeSeq。
    // 正常升级路径 dataVersion 已 bump（客户端全量重建、发空游标），此分支是 defense-in-depth。
    // 校验沿用旧协议：i 正整数、u 匹配项目 ISO 时间戳格式，否则畸形游标 → null（路由层回 422）。
    if (
      typeof parsed?.u === 'string' &&
      SYNC_CURSOR_ISO.test(parsed.u) &&
      Number.isInteger(parsed?.i) &&
      (parsed.i as number) > 0
    ) {
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
  const latest = await get<{ seq: number | null }>(db, 'SELECT MAX(changeSeq) as seq FROM images');
  return {
    serverId,
    dataVersion,
    imageCount: countRow?.cnt ?? 0,
    latestCursor: latest?.seq != null ? encodeSyncCursor(latest.seq) : null,
  };
}

export async function listSyncImages(
  cursor: SyncCursorPayload | null,
  limit: number,
): Promise<{ items: SyncImageItem[]; nextCursor: string | null; hasMore: boolean }> {
  const db = await getDatabase();
  let sinceSeq = 0;
  let hasCursor = false;
  if (cursor) {
    hasCursor = true;
    if ('s' in cursor) {
      sinceSeq = cursor.s;
    } else {
      // 旧游标换轨（一次性，之后 nextCursor 只发 {s}）——保守水位 =「未读集最小 changeSeq - 1」：
      // 未读集 = 旧 (updatedAt,id) 序在游标之后的行；回填 ROW_NUMBER 与旧序同构，故该集合的
      // changeSeq 下确界之前的行客户端必已读过。宁可重发若干已读行（android upsert 幂等吸收），
      // 绝不跳过任何未读行；未读集为空（客户端已读尽）回落 MAX(changeSeq) → 返回空页不重放。
      const row = await get<{ seq: number }>(
        db,
        `SELECT COALESCE(
            MIN(changeSeq) - 1,
            (SELECT COALESCE(MAX(changeSeq), 0) FROM images)
          ) as seq
           FROM images
          WHERE updatedAt > ? OR (updatedAt = ? AND id > ?)`,
        [cursor.u, cursor.u, cursor.i],
      );
      sinceSeq = row?.seq ?? 0;
    }
  }
  const where = hasCursor ? 'WHERE changeSeq > ?' : '';
  const params: Array<string | number> = hasCursor ? [sinceSeq] : [];
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
    changeSeq: number;
  }
  const rows = await all<Row>(
    db,
    `SELECT id, filename, width, height, fileSize, format, createdAt, updatedAt, changeSeq
       FROM images
       ${where}
      ORDER BY changeSeq ASC
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

  const items: SyncImageItem[] = page.map((row) => {
    // changeSeq 只服务游标，剔出载荷（契约不变：既不含 filepath 也不含 changeSeq）
    const { changeSeq: _seq, ...rest } = row;
    return {
      ...rest,
      tagIds: tagMap.get(row.id) ?? [],
      galleryIds: galleryMap.get(row.id) ?? [],
    };
  });
  const last = page[page.length - 1];
  return {
    items,
    nextCursor: last ? encodeSyncCursor(last.changeSeq) : null,
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
  createdAt: string;
}>> {
  const db = await getDatabase();
  // 有效封面（v0.6 spec §6.2）：显式封面 ?? 最近加入的一张（gallery_images.addedAt 倒序）；
  // 只发生在读侧，不回写。createdAt 供安卓相册「创建时间」排序（spec §6.3）。
  // 显式封面须仍是成员（与 galleryService.getGalleries 同款成员化守卫）：封面图被移出
  // 相册后残留的非成员 coverImageId 不得下发，否则安卓端持续显示跨相册封面且无法自愈。
  return all(db, `
    SELECT g.id, g.name,
           COALESCE(
             (SELECT gi.imageId FROM gallery_images gi
              WHERE gi.galleryId = g.id AND gi.imageId = g.coverImageId),
             (SELECT gi.imageId FROM gallery_images gi
               JOIN images im ON im.id = gi.imageId
              WHERE gi.galleryId = g.id
              ORDER BY gi.addedAt DESC, gi.imageId DESC LIMIT 1)
           ) AS coverImageId,
           g.imageCount, g.createdAt
      FROM galleries g ORDER BY g.id`);
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
