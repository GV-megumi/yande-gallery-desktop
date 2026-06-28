import {
  BooruSite,
  BooruSiteRecord,
  BooruPost,
  BooruTag,
  BooruFavorite,
  DownloadQueueItem,
  SearchHistoryItem,
  FavoriteTag,
  FavoriteTagLabel,
  BlacklistedTag,
  FavoriteTagDownloadBinding,
  FavoriteTagDownloadRuntimeProgress,
  FavoriteTagWithDownloadState,
  UpsertFavoriteTagDownloadBindingInput,
  BulkDownloadRecord,
  BulkDownloadSession,
  BulkDownloadSessionStatus,
  BulkDownloadTask,
  FavoriteTagDownloadDisplayStatus,
  ListQueryParams,
  PaginatedResult,
  StartFavoritesBulkDownloadInput,
  FavoriteTagImportRecord,
  FavoriteTagLabelImportRecord,
  FavoriteTagsImportPickFileResult,
  BlacklistedTagImportRecord,
  ImportPickFileResult,
} from '../../shared/types.js';
import { getDatabase, run, runWithChanges, get, all, runInTransaction } from './database.js';
import { createGallery, getGallery, scanFolderIntoGallery, getGalleryFolderPaths, getGalleryFolders } from './galleryService.js';
import { normalizePath } from '../utils/path.js';
import { getConfig, getDownloadsPath, resolveConfigPath } from './config.js';
import { createBooruClient } from './booruClientFactory.js';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import { dialog } from 'electron';
import { sanitizeFileName } from './filenameGenerator.js';
import { emitBuiltRendererAppEvent } from './rendererEventBus.js';
import {
  emitBooruBlacklistTagsChanged,
  emitBooruFavoriteGroupsChanged,
  emitBooruPostDownloadStateChanged,
  emitBooruPostFavoriteChanged,
  emitBooruPostServerFavoriteChanged,
  emitBooruPostVoteChanged,
  emitBooruSavedSearchesChanged,
  emitBooruSearchHistoryChanged,
  emitBooruSitesChanged,
} from './appEventPublisher.js';

type FavoriteTagDownloadBindingRow = {
  id: number;
  favoriteTagId: number;
  galleryId: number | null;
  downloadPath: string;
  enabled: number;
  autoCreateGallery?: number | null;
  autoSyncGalleryAfterDownload?: number | null;
  quality?: string | null;
  perPage?: number | null;
  concurrency?: number | null;
  skipIfExists?: number | null;
  notifications?: number | null;
  blacklistedTags?: string | null;
  lastTaskId?: string | null;
  lastSessionId?: string | null;
  lastStartedAt?: string | null;
  lastCompletedAt?: string | null;
  lastStatus?: FavoriteTagDownloadDisplayStatus | null;
  createdAt: string;
  updatedAt: string;
  galleryName?: string | null;
};

type BulkDownloadRuntimeStatsRow = {
  status: BulkDownloadSessionStatus;
  completed: number;
  failed: number;
  total: number;
  completedAt?: string | null;
};

type FavoriteRatingFilter = 'safe' | 'questionable' | 'explicit' | 'all';

function emitFavoriteTagsChanged(payload: {
  action:
    | 'created'
    | 'batchCreated'
    | 'updated'
    | 'deleted'
    | 'imported'
    | 'bindingUpserted'
    | 'bindingDeleted'
    | 'labelCreated'
    | 'labelDeleted'
    | 'downloadStateChanged';
  favoriteTagId?: number;
  siteId?: number | null;
  tagName?: string;
  affectedCount?: number;
}): void {
  emitBuiltRendererAppEvent({
    type: 'favorite-tags:changed',
    source: 'booruService',
    payload,
  });
}

function parseFavoriteTagDownloadBinding(row: FavoriteTagDownloadBindingRow | undefined): FavoriteTagDownloadBinding | undefined {
  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    favoriteTagId: row.favoriteTagId,
    galleryId: row.galleryId,
    downloadPath: row.downloadPath,
    enabled: Boolean(row.enabled),
    autoCreateGallery: row.autoCreateGallery === null || row.autoCreateGallery === undefined ? null : Boolean(row.autoCreateGallery),
    autoSyncGalleryAfterDownload: row.autoSyncGalleryAfterDownload === null || row.autoSyncGalleryAfterDownload === undefined ? null : Boolean(row.autoSyncGalleryAfterDownload),
    quality: row.quality ?? null,
    perPage: row.perPage ?? null,
    concurrency: row.concurrency ?? null,
    skipIfExists: row.skipIfExists === null || row.skipIfExists === undefined ? null : Boolean(row.skipIfExists),
    notifications: row.notifications === null || row.notifications === undefined ? null : Boolean(row.notifications),
    blacklistedTags: row.blacklistedTags ? JSON.parse(row.blacklistedTags) : null,
    lastTaskId: row.lastTaskId ?? null,
    lastSessionId: row.lastSessionId ?? null,
    lastStartedAt: row.lastStartedAt ?? null,
    lastCompletedAt: row.lastCompletedAt ?? null,
    lastStatus: isFavoriteTagDownloadDisplayStatus(row.lastStatus) ? row.lastStatus : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isActiveBulkDownloadStatus(status?: string | null): status is BulkDownloadSessionStatus {
  return status === 'pending' || status === 'queued' || status === 'dryRun' || status === 'running' || status === 'paused' || status === 'suspended';
}

function isFavoriteTagDownloadDisplayStatus(status?: string | null): status is FavoriteTagDownloadDisplayStatus {
  return !!status && [
    'pending',
    'queued',
    'dryRun',
    'running',
    'completed',
    'allSkipped',
    'failed',
    'paused',
    'suspended',
    'cancelled',
    'notConfigured',
    'ready',
    'starting',
    'validationError',
    'taskCreateFailed',
    'sessionCreateFailed',
  ].includes(status);
}

async function getFavoriteTagById(id: number): Promise<FavoriteTag | null> {
  const db = await getDatabase();
  const row = await get<any>(db, 'SELECT * FROM booru_favorite_tags WHERE id = ?', [id]);

  if (!row) {
    return null;
  }

  return {
    ...row,
    labels: row.labels ? JSON.parse(row.labels) : undefined,
  };
}

function normalizeFavoriteTagFolderName(tagName: string): string {
  return tagName.replace(/\u0000/g, '').trim().replace(/\s+/g, '_');
}

function getFavoriteTagDefaultDownloadPath(tagName: string): string {
  const config = getConfig();
  const baseDownloadPath = resolveConfigPath(config.downloads.path);
  return path.join(baseDownloadPath, normalizeFavoriteTagFolderName(tagName));
}

// Phase 8A：galleries 已无 folderPath 列；仅取存在性快照（id/name）。
// 导出供契约回归测试直接对真实 contracted schema 验证（无生产其它调用方，仅本模块内部使用）。
export async function getGallerySnapshotById(id: number): Promise<{ id: number; name: string } | null> {
  const db = await getDatabase();
  const row = await get<{ id: number; name: string }>(
    db,
    'SELECT id, name FROM galleries WHERE id = ?',
    [id]
  );

  return row || null;
}

// Phase 8A：folderPath 已从 galleries 移到 gallery_folders（绑定文件夹的 source of truth）。
// 按文件夹反查所属图集 → 查 gallery_folders（folderPath 全局 UNIQUE）；输入先归一化，
// 与 createGallery 去重检查（galleryService.createGallery）一致。调用方只用 id，返回 { id }。
// 导出供契约回归测试直接对真实 contracted schema 验证。
export async function findGalleryByFolderPath(folderPath: string): Promise<{ id: number } | null> {
  const db = await getDatabase();
  const normalized = normalizePath(folderPath);
  const row = await get<{ id: number }>(
    db,
    'SELECT galleryId AS id FROM gallery_folders WHERE folderPath = ?',
    [normalized]
  );

  return row || null;
}

async function ensureGalleryForFavoriteTag(favoriteTag: FavoriteTag, binding: FavoriteTagDownloadBinding): Promise<number | null> {
  if (binding.galleryId) {
    return binding.galleryId;
  }

  if (!binding.autoCreateGallery) {
    return null;
  }

  const existingGallery = await findGalleryByFolderPath(binding.downloadPath);
  if (existingGallery) {
    return existingGallery.id;
  }

  const created = await createGallery({
    folderPath: binding.downloadPath,
    name: favoriteTag.tagName.replace(/_/g, ' '),
    isWatching: true,
    recursive: true,
  });

  if (!created.success || !created.data) {
    throw new Error(created.error || '自动创建图集失败');
  }

  return created.data;
}

/**
 * booru 下载完成后同步对应图集。
 *
 * Phase 8A：galleries 不再存 recursive/extensions（已归 gallery_folders）。本函数改为：
 *   1. getGallery 仅校验图集存在（保留"图集不存在"错误契约）；
 *   2. 从 gallery_folders 取该 downloadPath 对应绑定行的 recursive/extensions；
 *      下载路径未登记为绑定文件夹时回退 recursive=true + 默认扩展名；
 *   3. scanFolderIntoGallery 统一入口（扫描导入 + 写 gallery_images 成员 + 更新统计 + 发事件）。
 *
 * 导出以便单测直接覆盖成员写入逻辑（其余调用方仍在 booruService 内部）。
 */
export async function syncGalleryAfterDownload(galleryId: number, downloadPath: string): Promise<void> {
  const galleryResult = await getGallery(galleryId);
  if (!galleryResult.success || !galleryResult.data) {
    throw new Error(galleryResult.error || '图集不存在');
  }

  // recursive/extensions 现在按文件夹存（gallery_folders）。下载路径与某绑定文件夹对应时
  // 取其配置；否则回退默认（recursive=true + 默认扩展名）。
  const normalizedDownloadPath = normalizePath(downloadPath);
  const foldersResult = await getGalleryFolders(galleryId);
  const matchedFolder = foldersResult.success && foldersResult.data
    ? foldersResult.data.find(f => normalizePath(f.folderPath) === normalizedDownloadPath)
    : undefined;

  const recursive = matchedFolder ? matchedFolder.recursive : true;
  const extensions = matchedFolder && matchedFolder.extensions.length > 0
    ? matchedFolder.extensions
    : ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

  const scanResult = await scanFolderIntoGallery(
    galleryId,
    downloadPath,
    recursive,
    extensions
  );
  if (!scanResult.success) {
    throw new Error(scanResult.error || '图集同步扫描失败');
  }
}

async function updateBulkDownloadSessionOrigin(
  sessionId: string,
  originType: NonNullable<BulkDownloadSession['originType']>,
  originId: number | null
): Promise<void> {
  const db = await getDatabase();
  await run(db, `
    UPDATE bulk_download_sessions
    SET originType = ?, originId = ?
    WHERE id = ?
  `, [originType, originId, sessionId]);
}

async function syncFavoriteTagDownloadTerminalState(favoriteTagId: number, binding: FavoriteTagDownloadBinding): Promise<void> {
  if (!binding.lastSessionId) {
    return;
  }

  const snapshot = await getBulkDownloadSessionSnapshot(binding.lastSessionId);
  if (!snapshot || isActiveBulkDownloadStatus(snapshot.status)) {
    return;
  }

  await updateFavoriteTagDownloadBindingSnapshot(favoriteTagId, {
    lastStatus: snapshot.status,
    lastCompletedAt: snapshot.completedAt ?? null,
  });

  if (snapshot.status === 'completed' && binding.galleryId && binding.autoSyncGalleryAfterDownload) {
    await syncGalleryAfterDownload(binding.galleryId, binding.downloadPath);
  }
}

async function updateFavoriteTagDownloadBindingSnapshot(
  favoriteTagId: number,
  updates: Partial<Pick<FavoriteTagDownloadBinding, 'lastTaskId' | 'lastSessionId' | 'lastStartedAt' | 'lastCompletedAt' | 'lastStatus'>>
): Promise<void> {
  const db = await getDatabase();
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.lastTaskId !== undefined) {
    fields.push('lastTaskId = ?');
    values.push(updates.lastTaskId ?? null);
  }
  if (updates.lastSessionId !== undefined) {
    fields.push('lastSessionId = ?');
    values.push(updates.lastSessionId ?? null);
  }
  if (updates.lastStartedAt !== undefined) {
    fields.push('lastStartedAt = ?');
    values.push(updates.lastStartedAt ?? null);
  }
  if (updates.lastCompletedAt !== undefined) {
    fields.push('lastCompletedAt = ?');
    values.push(updates.lastCompletedAt ?? null);
  }
  if (updates.lastStatus !== undefined) {
    fields.push('lastStatus = ?');
    values.push(updates.lastStatus ?? null);
  }

  if (fields.length === 0) {
    return;
  }

  fields.push('updatedAt = ?');
  values.push(new Date().toISOString());
  values.push(favoriteTagId);

  await run(db, `
    UPDATE booru_favorite_tag_download_bindings
    SET ${fields.join(', ')}
    WHERE favoriteTagId = ?
  `, values);
  const tag = await get<{ siteId: number | null; tagName: string }>(
    db,
    'SELECT siteId, tagName FROM booru_favorite_tags WHERE id = ?',
    [favoriteTagId],
  );
  emitFavoriteTagsChanged({
    action: 'downloadStateChanged',
    favoriteTagId,
    siteId: tag?.siteId ?? null,
    tagName: tag?.tagName,
    affectedCount: 1,
  });
}

async function getRuntimeProgressBySessionId(sessionId: string): Promise<FavoriteTagDownloadRuntimeProgress | null> {
  const db = await getDatabase();
  const stats = await get<BulkDownloadRuntimeStatsRow>(db, `
    SELECT
      s.status as status,
      SUM(CASE WHEN r.status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN r.status = 'failed' THEN 1 ELSE 0 END) as failed,
      COUNT(r.url) as total
    FROM bulk_download_sessions s
    LEFT JOIN bulk_download_records r ON r.sessionId = s.id
    WHERE s.id = ? AND s.deletedAt IS NULL
    GROUP BY s.id, s.status
  `, [sessionId]);

  if (!stats || !isActiveBulkDownloadStatus(stats.status)) {
    return null;
  }

  const total = stats.total || 0;
  const completed = stats.completed || 0;
  const failed = stats.failed || 0;
  const percent = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;

  return {
    sessionId,
    status: stats.status,
    completed,
    total,
    percent,
    failed,
  };
}

async function getBulkDownloadSessionSnapshot(sessionId: string): Promise<{ status: BulkDownloadSessionStatus; completedAt?: string | null } | null> {
  const db = await getDatabase();
  const session = await get<{ status: BulkDownloadSessionStatus; completedAt?: string | null }>(db, `
    SELECT status, completedAt
    FROM bulk_download_sessions
    WHERE id = ? AND deletedAt IS NULL
  `, [sessionId]);

  return session || null;
}

// ========= 站点管理 =========

/**
 * 获取所有Booru站点
 */
export async function getBooruSites(): Promise<BooruSiteRecord[]> {
  console.log('[booruService] 获取所有Booru站点');
  try {
    const db = await getDatabase();
    const sites = await all<BooruSiteRecord>(
      db,
      'SELECT * FROM booru_sites ORDER BY active DESC, name ASC'
    );

    // 转换布尔值
    const result = sites.map(site => ({
      ...site,
      favoriteSupport: Boolean(site.favoriteSupport),
      active: Boolean(site.active)
    }));

    console.log('[booruService] 获取到', result.length, '个站点');
    return result;
  } catch (error) {
    console.error('[booruService] 获取Booru站点失败:', error);
    throw error;
  }
}

/**
 * 根据ID获取Booru站点
 */
export async function getBooruSiteById(id: number): Promise<BooruSiteRecord | null> {
  console.log('[booruService] 获取Booru站点:', id);
  try {
    const db = await getDatabase();
    const site = await get<BooruSiteRecord>(
      db,
      'SELECT * FROM booru_sites WHERE id = ?',
      [id]
    );

    if (!site) {
      console.warn('[booruService] 站点不存在:', id);
      return null;
    }

    // 转换布尔值
    const result = {
      ...site,
      favoriteSupport: Boolean(site.favoriteSupport),
      active: Boolean(site.active)
    };

    console.log('[booruService] 获取站点成功:', result.name);
    return result;
  } catch (error) {
    console.error('[booruService] 获取Booru站点失败:', id, error);
    throw error;
  }
}

/**
 * 获取激活的Booru站点
 */
export async function getActiveBooruSite(): Promise<BooruSiteRecord | null> {
  console.log('[booruService] 获取激活的Booru站点');
  try {
    const db = await getDatabase();
    const site = await get<BooruSiteRecord>(
      db,
      'SELECT * FROM booru_sites WHERE active = 1 LIMIT 1'
    );

    if (!site) {
      console.warn('[booruService] 没有找到激活的站点');
      return null;
    }

    // 转换布尔值
    const result = {
      ...site,
      favoriteSupport: Boolean(site.favoriteSupport),
      active: Boolean(site.active)
    };

    console.log('[booruService] 获取到激活站点:', result.name);
    return result;
  } catch (error) {
    console.error('[booruService] 获取激活Booru站点失败:', error);
    throw error;
  }
}

/**
 * 添加Booru站点
 */
export async function addBooruSite(site: Omit<BooruSiteRecord, 'id' | 'createdAt' | 'updatedAt' | 'authenticated'>): Promise<number> {
  console.log('[booruService] 添加Booru站点:', site.name);
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();

    await run(db, `
      INSERT INTO booru_sites
      (name, url, type, salt, version, apiKey, username, passwordHash, favoriteSupport, active, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      site.name,
      site.url,
      site.type,
      site.salt || null,
      site.version || null,
      site.apiKey || null,
      site.username || null,
      site.passwordHash || null,
      site.favoriteSupport ? 1 : 0,
      site.active ? 1 : 0,
      now,
      now
    ]);

    const result = await get<{ id: number }>(db, 'SELECT last_insert_rowid() as id');
    const id = result!.id;

    emitBooruSitesChanged({
      action: 'created',
      siteId: id,
      activeSiteId: site.active ? id : undefined,
      affectedCount: 1,
    });
    console.log('[booruService] 添加站点成功:', site.name, 'ID:', id);
    return id;
  } catch (error) {
    console.error('[booruService] 添加Booru站点失败:', site.name, error);
    throw error;
  }
}

/**
 * 更新Booru站点
 */
export async function updateBooruSite(id: number, updates: Partial<BooruSiteRecord>): Promise<void> {
  console.log('[booruService] 更新Booru站点:', id, updates);
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();

    const fields: string[] = [];
    const values: any[] = [];
    const changedFields: string[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
      changedFields.push('name');
    }
    if (updates.url !== undefined) {
      fields.push('url = ?');
      values.push(updates.url);
      changedFields.push('url');
    }
    if (updates.type !== undefined) {
      fields.push('type = ?');
      values.push(updates.type);
      changedFields.push('type');
    }
    if (updates.salt !== undefined) {
      fields.push('salt = ?');
      values.push(updates.salt);
      changedFields.push('salt');
    }
    if (updates.version !== undefined) {
      fields.push('version = ?');
      values.push(updates.version);
      changedFields.push('version');
    }
    if (updates.apiKey !== undefined) {
      fields.push('apiKey = ?');
      values.push(updates.apiKey);
      changedFields.push('apiKey');
    }
    if (updates.username !== undefined) {
      fields.push('username = ?');
      values.push(updates.username);
      changedFields.push('username');
    }
    if (updates.passwordHash !== undefined) {
      fields.push('passwordHash = ?');
      values.push(updates.passwordHash);
      changedFields.push('passwordHash');
    }
    if (updates.favoriteSupport !== undefined) {
      fields.push('favoriteSupport = ?');
      values.push(updates.favoriteSupport ? 1 : 0);
      changedFields.push('favoriteSupport');
    }
    if (updates.active !== undefined) {
      fields.push('active = ?');
      values.push(updates.active ? 1 : 0);
      changedFields.push('active');
    }

    if (fields.length === 0) {
      console.warn('[booruService] 没有需要更新的字段');
      return;
    }

    fields.push('updatedAt = ?');
    values.push(now);
    values.push(id);

    const result = await runWithChanges(db, `UPDATE booru_sites SET ${fields.join(', ')} WHERE id = ?`, values);

    console.log('[booruService] 更新站点成功:', id);
    if (result.changes > 0) {
      const action = updates.active !== undefined
        ? 'activeChanged'
        : changedFields.some(field => field === 'username' || field === 'passwordHash')
          ? 'authChanged'
          : 'updated';
      emitBooruSitesChanged({
        action,
        siteId: id,
        activeSiteId: updates.active ? id : undefined,
        changedFields,
        affectedCount: result.changes,
      });
    }
  } catch (error) {
    console.error('[booruService] 更新Booru站点失败:', id, error);
    throw error;
  }
}

/**
 * 删除Booru站点
 */
export async function deleteBooruSite(id: number): Promise<void> {
  console.log('[booruService] 删除Booru站点:', id);
  try {
    const db = await getDatabase();
    const result = await runWithChanges(db, 'DELETE FROM booru_sites WHERE id = ?', [id]);
    console.log('[booruService] 删除站点成功:', id);
    if (result.changes > 0) {
      emitBooruSitesChanged({
        action: 'deleted',
        siteId: id,
        affectedCount: result.changes,
      });
    }
  } catch (error) {
    console.error('[booruService] 删除Booru站点失败:', id, error);
    throw error;
  }
}

/**
 * 设置激活的站点（将其他站点设为inactive）
 */
export async function setActiveBooruSite(id: number): Promise<void> {
  console.log('[booruService] 设置激活站点:', id);
  try {
    const db = await getDatabase();

    const result = await runInTransaction(db, async () => {
      // 先在事务内校验目标站点存在：若 id 已失效（如在其他窗口被删除），
      // 直接抛错回滚，避免清空所有 active 标志后留下"无激活站点"的状态
      const target = await get<{ id: number }>(db, 'SELECT id FROM booru_sites WHERE id = ?', [id]);
      if (!target) {
        throw new Error(`站点不存在: ${id}`);
      }
      await run(db, 'UPDATE booru_sites SET active = 0');
      return runWithChanges(db, 'UPDATE booru_sites SET active = 1 WHERE id = ?', [id]);
    });

    console.log('[booruService] 设置激活站点成功:', id);
    if (result.changes > 0) {
      emitBooruSitesChanged({
        action: 'activeChanged',
        siteId: id,
        activeSiteId: id,
        affectedCount: result.changes,
      });
    }
  } catch (error) {
    console.error('[booruService] 设置激活站点失败:', id, error);
    throw error;
  }
}

// ========= 图片记录管理 =========

/**
 * 保存Booru图片记录（如果不存在则插入）
 */
export async function saveBooruPost(postData: Omit<BooruPost, 'id' | 'createdAt' | 'updatedAt'>): Promise<number> {
  console.log('[booruService] 保存Booru图片:', postData.postId);
  // 调试：检查 URL 长度
  if (postData.fileUrl) {
    console.log('[booruService] fileUrl 长度:', postData.fileUrl.length, '内容:', postData.fileUrl.substring(0, 150));
  }
  if (postData.previewUrl) {
    console.log('[booruService] previewUrl 长度:', postData.previewUrl.length, '内容:', postData.previewUrl.substring(0, 150));
  }
  if (postData.sampleUrl) {
    console.log('[booruService] sampleUrl 长度:', postData.sampleUrl.length, '内容:', postData.sampleUrl.substring(0, 150));
  }
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();

    // 检查是否已存在
    const existing = await get<{ id: number }>(
      db,
      'SELECT id FROM booru_posts WHERE siteId = ? AND postId = ?',
      [postData.siteId, postData.postId]
    );

    if (existing) {
      console.log('[booruService] 图片已存在，更新记录:', postData.postId);
      // 获取现有的收藏状态，避免覆盖
      const existingPost = await get<{ isFavorited: number; isLiked: number }>(
        db,
        'SELECT isFavorited, isLiked FROM booru_posts WHERE id = ?',
        [existing.id]
      );
      const preserveFavorited = existingPost?.isFavorited || 0;
      const preserveLiked = existingPost?.isLiked || 0;

      await run(db, `
        UPDATE booru_posts SET
          md5 = ?, fileUrl = ?, previewUrl = ?, sampleUrl = ?, width = ?, height = ?,
          fileSize = ?, fileExt = ?, rating = ?, score = ?, source = ?, tags = ?,
          downloaded = ?, localPath = ?, localImageId = ?, isFavorited = ?, isLiked = ?, updatedAt = ?
        WHERE siteId = ? AND postId = ?
      `, [
        postData.md5 || null,
        postData.fileUrl,
        postData.previewUrl || null,
        postData.sampleUrl || null,
        postData.width || null,
        postData.height || null,
        postData.fileSize || null,
        postData.fileExt || null,
        postData.rating || null,
        postData.score || 0,
        postData.source || null,
        postData.tags,
        postData.downloaded ? 1 : 0,
        postData.localPath || null,
        postData.localImageId || null,
        preserveFavorited, // 保留现有的收藏状态
        preserveLiked,     // 保留现有的喜欢状态
        now,
        postData.siteId,
        postData.postId
      ]);
      return existing.id;
    } else {
      await run(db, `
        INSERT INTO booru_posts
        (siteId, postId, md5, fileUrl, previewUrl, sampleUrl, width, height, fileSize, fileExt,
         rating, score, source, tags, downloaded, localPath, localImageId, isFavorited, isLiked, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        postData.siteId,
        postData.postId,
        postData.md5 || null,
        postData.fileUrl,
        postData.previewUrl || null,
        postData.sampleUrl || null,
        postData.width || null,
        postData.height || null,
        postData.fileSize || null,
        postData.fileExt || null,
        postData.rating || null,
        postData.score || 0,
        postData.source || null,
        postData.tags,
        postData.downloaded ? 1 : 0,
        postData.localPath || null,
        postData.localImageId || null,
        postData.isFavorited ? 1 : 0,
        (postData as any).isLiked ? 1 : 0,
        now,
        now
      ]);

      const result = await get<{ id: number }>(db, 'SELECT last_insert_rowid() as id');
      const id = result!.id;

      console.log('[booruService] 保存图片成功:', postData.postId, 'ID:', id);
      return id;
    }
  } catch (error) {
    console.error('[booruService] 保存Booru图片失败:', postData.postId, error);
    throw error;
  }
}

/**
 * 获取Booru图片列表（分页）
 */
export async function getBooruPosts(siteId: number, page: number = 1, limit: number = 20): Promise<BooruPost[]> {
  console.log('[booruService] 获取Booru图片列表:', { siteId, page, limit });
  try {
    const db = await getDatabase();
    const offset = (page - 1) * limit;

    const posts = await all<BooruPost>(
      db,
      `
        SELECT * FROM booru_posts
        WHERE siteId = ?
        ORDER BY updatedAt DESC
        LIMIT ? OFFSET ?
      `,
      [siteId, limit, offset]
    );

    // 转换布尔值
    const result = posts.map(post => ({
      ...post,
      downloaded: Boolean(post.downloaded),
      isFavorited: Boolean(post.isFavorited)
    }));

    // 调试：检查第一个 post 的 URL 长度
    if (result.length > 0 && result[0]) {
      const firstPost = result[0];
      console.log('[booruService] 读取到的第一个 post URL 长度:', {
        postId: firstPost.postId,
        fileUrlLength: firstPost.fileUrl?.length || 0,
        previewUrlLength: firstPost.previewUrl?.length || 0,
        sampleUrlLength: firstPost.sampleUrl?.length || 0,
        fileUrl: firstPost.fileUrl?.substring(0, 150),
        previewUrl: firstPost.previewUrl?.substring(0, 150),
        sampleUrl: firstPost.sampleUrl?.substring(0, 150)
      });
    }

    console.log('[booruService] 获取到', result.length, '张图片');
    return result;
  } catch (error) {
    console.error('[booruService] 获取Booru图片列表失败:', error);
    throw error;
  }
}

/**
 * 根据ID获取Booru图片
 */
export async function getBooruPostById(postId: number): Promise<BooruPost | null> {
  console.log('[booruService] 获取Booru图片:', postId);
  try {
    const db = await getDatabase();
    const post = await get<BooruPost>(
      db,
      'SELECT * FROM booru_posts WHERE id = ?',
      [postId]
    );

    if (!post) {
      console.warn('[booruService] 图片不存在:', postId);
      return null;
    }

    // 转换布尔值
    return post ? {
      ...post,
      downloaded: Boolean(post.downloaded),
      isFavorited: Boolean(post.isFavorited)
    } : null;
  } catch (error) {
    console.error('[booruService] 获取Booru图片失败:', postId, error);
    throw error;
  }
}

/**
 * 批量获取 Booru 帖子（通过数据库 ID 列表）
 * 替代逐个调用 getBooruPostById 的 N+1 查询模式，大幅减少数据库往返次数
 * @param ids 数据库 ID 列表
 * @returns 按传入 ID 顺序返回的帖子列表（不存在的 ID 会被过滤）
 */
export async function getBooruPostsByIds(ids: number[]): Promise<BooruPost[]> {
  if (ids.length === 0) return [];
  console.log('[booruService] 批量获取Booru图片, 数量:', ids.length);
  try {
    const db = await getDatabase();

    // SQLite 单条语句最多支持 999 个绑定参数，超过时分片查询
    const CHUNK_SIZE = 900;
    const postMap = new Map<number, BooruPost>();

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const posts = await all<BooruPost>(
        db,
        `SELECT * FROM booru_posts WHERE id IN (${placeholders})`,
        chunk
      );

      // 转换布尔值并建立映射
      for (const post of posts) {
        postMap.set(post.id, {
          ...post,
          downloaded: Boolean(post.downloaded),
          isFavorited: Boolean(post.isFavorited),
          isLiked: Boolean((post as any).isLiked)
        });
      }
    }

    // 按传入顺序返回，过滤不存在的 ID
    const result = ids.map(id => postMap.get(id)).filter((p): p is BooruPost => p !== undefined);
    console.log('[booruService] 批量获取成功:', result.length, '/', ids.length);
    return result;
  } catch (error) {
    console.error('[booruService] 批量获取Booru图片失败:', error);
    throw error;
  }
}

/**
 * 根据站点ID和PostID获取Booru图片
 */
export async function getBooruPostBySiteAndId(siteId: number, postId: number): Promise<BooruPost | null> {
  // 减少日志输出，避免在批量下载时产生大量日志
  // console.log('[booruService] 根据站点和ID获取Booru图片:', { siteId, postId });
  try {
    const db = await getDatabase();
    const post = await get<BooruPost>(
      db,
      'SELECT * FROM booru_posts WHERE siteId = ? AND postId = ?',
      [siteId, postId]
    );

    if (!post) {
      // 减少日志输出
      // console.warn('[booruService] 图片不存在:', { siteId, postId });
      return null;
    }

    return {
      ...post,
      downloaded: Boolean(post.downloaded),
      isFavorited: Boolean(post.isFavorited)
    };
  } catch (error) {
    console.error('[booruService] 获取Booru图片失败:', { siteId, postId }, error);
    throw error;
  }
}

/**
 * 搜索Booru图片（按标签）
 */
export async function searchBooruPosts(siteId: number, tags: string[], page: number = 1, limit: number = 20): Promise<BooruPost[]> {
  const tagsStr = tags.join(' ');
  console.log('[booruService] 搜索Booru图片:', { siteId, tags: tagsStr, page, limit });
  try {
    const db = await getDatabase();
    const offset = (page - 1) * limit;

    const posts = await all<BooruPost>(
      db,
      `
        -- TODO: 性能优化 — LIKE '%keyword%' 前置通配符导致全表扫描，数据量大时应改为通过 booru_post_tags 表 JOIN 查询或 FTS5 全文搜索
        SELECT * FROM booru_posts
        WHERE siteId = ? AND tags LIKE ?
        ORDER BY updatedAt DESC
        LIMIT ? OFFSET ?
      `,
      [siteId, `%${tagsStr}%`, limit, offset]
    );

    // 转换布尔值
    const result = posts.map(post => ({
      ...post,
      downloaded: Boolean(post.downloaded),
      isFavorited: Boolean(post.isFavorited)
    }));

    console.log('[booruService] 搜索到', result.length, '张图片');
    return result;
  } catch (error) {
    console.error('[booruService] 搜索Booru图片失败:', error);
    throw error;
  }
}

/**
 * 标记图片为已下载
 */
export async function markPostAsDownloaded(
  postId: number,
  localPath: string,
  localImageId?: number
): Promise<void> {
  console.log('[booruService] 标记图片为已下载:', postId, localPath);
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const post = await get<{ siteId: number; postId: number }>(
      db,
      'SELECT siteId, postId FROM booru_posts WHERE id = ?',
      [postId],
    );

    const result = await runWithChanges(db, `
      UPDATE booru_posts
      SET downloaded = 1, localPath = ?, localImageId = ?, updatedAt = ?
      WHERE id = ?
    `, [localPath, localImageId || null, now, postId]);

    console.log('[booruService] 标记下载成功:', postId);
    if (result.changes > 0 && post) {
      emitBooruPostDownloadStateChanged({
        action: 'markedDownloaded',
        siteId: post.siteId,
        postId: post.postId,
        downloaded: true,
        localImageId,
        affectedCount: result.changes,
      });
    }
  } catch (error) {
    console.error('[booruService] 标记图片下载失败:', postId, error);
    throw error;
  }
}

// ========= 收藏管理 =========

/**
 * 添加到收藏
 */
export async function addToFavorites(apiPostId: number, siteId: number, notes?: string): Promise<number> {
  console.log('[booruService] 添加到收藏:', apiPostId);
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();

    // 查找 booru_posts 的数据库主键（FK 约束要求 booru_favorites.postId 存储 booru_posts.id）
    const dbPost = await get<{ id: number }>(
      db,
      'SELECT id FROM booru_posts WHERE postId = ? AND siteId = ?',
      [apiPostId, siteId]
    );
    if (!dbPost) {
      throw new Error(`帖子 ${apiPostId} 不存在于数据库，无法添加收藏`);
    }
    const dbId = dbPost.id;

    // 检查是否已经收藏
    const existing = await get<{ id: number }>(
      db,
      'SELECT id FROM booru_favorites WHERE postId = ?',
      [dbId]
    );

    if (existing) {
      console.log('[booruService] 图片已在收藏中:', apiPostId);
      const repairResult = await runWithChanges(
        db,
        'UPDATE booru_posts SET isFavorited = 1 WHERE id = ? AND (isFavorited IS NULL OR isFavorited != 1)',
        [dbId],
      );
      if (repairResult.changes > 0) {
        emitBooruPostFavoriteChanged({
          action: 'repaired',
          siteId,
          postId: apiPostId,
          dbPostId: dbId,
          favoriteId: existing.id,
          isFavorited: true,
          affectedCount: repairResult.changes,
        });
      }
      return existing.id;
    }

    const favoriteId = await runInTransaction(db, async () => {
      await run(db, `
        INSERT OR IGNORE INTO booru_favorites (postId, siteId, notes, createdAt)
        VALUES (?, ?, ?, ?)
      `, [dbId, siteId, notes || null, now]);

      await run(db, 'UPDATE booru_posts SET isFavorited = 1 WHERE id = ?', [dbId]);
      const favorite = await get<{ id: number }>(
        db,
        'SELECT id FROM booru_favorites WHERE postId = ?',
        [dbId]
      );
      if (!favorite) {
        throw new Error(`收藏记录创建失败: ${apiPostId}`);
      }
      return favorite.id;
    });

    console.log('[booruService] 添加收藏成功:', apiPostId);
    emitBooruPostFavoriteChanged({
      action: 'added',
      siteId,
      postId: apiPostId,
      dbPostId: dbId,
      favoriteId,
      isFavorited: true,
      affectedCount: 1,
    });
    return favoriteId;
  } catch (error) {
    console.error('[booruService] 添加收藏失败:', apiPostId, error);
    throw error;
  }
}

/**
 * 从收藏中移除
 */
export async function removeFromFavorites(apiPostId: number, siteId: number): Promise<void> {
  console.log('[booruService] 从收藏中移除:', apiPostId, 'siteId:', siteId);
  try {
    const db = await getDatabase();

    // 查找 booru_posts 的数据库主键
    const dbPost = await get<{ id: number }>(
      db,
      'SELECT id FROM booru_posts WHERE postId = ? AND siteId = ?',
      [apiPostId, siteId],
    );
    if (dbPost) {
      const deleteResult = await runWithChanges(db, 'DELETE FROM booru_favorites WHERE postId = ?', [dbPost.id]);
      // 值守卫（AND isFavorited != 0）：node-sqlite3 的 this.changes 统计的是匹配行数
      // 而非实际修改行数，无条件 UPDATE 会让"本来就是 0"的行也报告 changes=1。
      // NULL != 0 在 SQL 中为 NULL（不匹配），NULL 语义上即未收藏，无需修改
      const updateResult = await runWithChanges(db, 'UPDATE booru_posts SET isFavorited = 0 WHERE id = ? AND isFavorited != 0', [dbPost.id]);
      const affectedCount = Math.max(deleteResult.changes, updateResult.changes);
      // 仅在确实删除了收藏记录或修正了收藏标志时才广播 removed 事件，
      // 避免对从未收藏的帖子也广播虚假的取消收藏事件
      if (affectedCount > 0) {
        emitBooruPostFavoriteChanged({
          action: 'removed',
          siteId,
          postId: apiPostId,
          dbPostId: dbPost.id,
          isFavorited: false,
          affectedCount,
        });
      }
    }

    console.log('[booruService] 移除收藏成功:', apiPostId);
  } catch (error) {
    console.error('[booruService] 移除收藏失败:', apiPostId, error);
    throw error;
  }
}

/**
 * 获取收藏列表
 */
function mapFavoritePostRow(post: any): BooruPost & { favoriteGroupId?: number | null } {
  return {
    ...post,
    downloaded: Boolean(post.downloaded),
    isFavorited: Boolean(post.isFavorited),
    isLiked: post.isLiked == null ? undefined : Boolean(post.isLiked),
    favoriteGroupId: post.favoriteGroupId ?? null,
  };
}

export async function getFavorites(
  siteId: number,
  page: number = 1,
  limit: number = 20,
  groupId?: number | null,
  rating?: FavoriteRatingFilter,
): Promise<PaginatedResult<BooruPost>> {
  console.log('[booruService] 获取收藏列表:', { siteId, page, limit, groupId, rating });
  try {
    const db = await getDatabase();
    const offset = Math.max(0, (page - 1) * limit);
    const where = ['f.siteId = ?'];
    const params: any[] = [siteId];

    if (groupId === null) {
      where.push('f.groupId IS NULL');
    } else if (groupId != null) {
      where.push('f.groupId = ?');
      params.push(groupId);
    }

    if (rating && rating !== 'all') {
      where.push('p.rating = ?');
      params.push(rating);
    }

    const whereSql = where.join(' AND ');
    const countRow = await get<{ total: number }>(
      db,
      `
        SELECT COUNT(*) as total FROM booru_posts p
        INNER JOIN booru_favorites f ON p.id = f.postId
        WHERE ${whereSql}
      `,
      params
    );

    const posts = await all<any>(
      db,
      `
        SELECT p.*, f.groupId as favoriteGroupId FROM booru_posts p
        INNER JOIN booru_favorites f ON p.id = f.postId
        WHERE ${whereSql}
        ORDER BY f.createdAt DESC
        LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    const items = posts.map(mapFavoritePostRow);
    const total = Number(countRow?.total ?? 0);

    console.log('[booruService] 获取到', items.length, '个收藏，总数:', total);
    return { items, total };
  } catch (error) {
    console.error('[booruService] 获取收藏列表失败:', error);
    throw error;
  }
}

/**
 * 获取收藏中缺失帖子数据的 postId 列表
 * 这些 postId 在 booru_favorites 中存在，但在 booru_posts 中没有对应记录
 */
export async function getMissingFavoritePostIds(siteId: number): Promise<number[]> {
  // FK 约束（booru_favorites.postId → booru_posts.id）保证不会有孤儿行，
  // 因此直接返回空数组，跳过不必要的查询。
  console.log('[booruService] getMissingFavoritePostIds: FK 保证无孤儿行，跳过检查');
  return [];
}

/**
 * 修复收藏数据一致性
 * 1. 确保 booru_favorites 中的帖子在 booru_posts 中 isFavorited = 1
 * 2. 确保不在 booru_favorites 中的帖子 isFavorited = 0
 */
export async function repairFavoritesConsistency(siteId: number): Promise<number> {
  console.log('[booruService] 修复收藏数据一致性, siteId:', siteId);
  try {
    const db = await getDatabase();

    // 把在 booru_favorites 中但 isFavorited != 1 的帖子修复
    // booru_favorites.postId 存储 booru_posts.id（数据库主键）
    const result = await run(db, `
      UPDATE booru_posts SET isFavorited = 1
      WHERE siteId = ? AND id IN (
        SELECT f.postId FROM booru_favorites f WHERE f.siteId = ?
      ) AND (isFavorited IS NULL OR isFavorited != 1)
    `, [siteId, siteId]);

    const fixed = (result as any)?.changes || 0;
    if (fixed > 0) {
      console.log('[booruService] 修复了', fixed, '条 isFavorited 标志');
    }
    return fixed;
  } catch (error) {
    console.error('[booruService] 修复收藏一致性失败:', error);
    return 0;
  }
}

/**
 * 检查是否已收藏
 */
export async function isFavorited(apiPostId: number): Promise<boolean> {
  try {
    const db = await getDatabase();
    // booru_favorites.postId 存储 booru_posts.id，需通过 join 按 API post ID 查询
    const result = await get<{ count: number }>(
      db,
      `SELECT COUNT(*) as count FROM booru_favorites f
       JOIN booru_posts p ON f.postId = p.id
       WHERE p.postId = ?`,
      [apiPostId]
    );

    return result ? result.count > 0 : false;
  } catch (error) {
    console.error('[booruService] 检查收藏状态失败:', apiPostId, error);
    return false;
  }
}

/**
 * 设置帖子的服务端喜欢状态
 * 在 SERVER_FAVORITE / SERVER_UNFAVORITE 及获取喜欢列表后调用
 */
interface SetPostLikedOptions {
  emit?: boolean;
  action?: 'liked' | 'unliked' | 'synced';
}

export async function setPostLiked(
  siteId: number,
  apiPostId: number,
  liked: boolean,
  options: SetPostLikedOptions = {},
): Promise<number> {
  try {
    const db = await getDatabase();
    const likedValue = liked ? 1 : 0;
    // 值守卫（COALESCE(isLiked, 0) != ?）：node-sqlite3 的 this.changes 统计匹配行数
    // 而非实际修改行数，无条件 UPDATE 会让"已是目标值"的行也报告 changes=1，
    // 导致 syncPostLikedStates 把已同步过的帖子误判为有变更并广播 synced 事件
    // （曾引发喜欢页 拉取→事件→拉取 的死循环）。NULL 视为 0（未喜欢）。
    const result = await runWithChanges(
      db,
      'UPDATE booru_posts SET isLiked = ? WHERE siteId = ? AND postId = ? AND COALESCE(isLiked, 0) != ?',
      [likedValue, siteId, apiPostId, likedValue],
    );
    if (options.emit !== false) {
      emitBooruPostServerFavoriteChanged({
        action: options.action ?? (liked ? 'liked' : 'unliked'),
        siteId,
        postId: apiPostId,
        isLiked: liked,
        affectedCount: result.changes,
      });
    }
    return result.changes;
  } catch (error) {
    console.error('[booruService] 设置喜欢状态失败:', apiPostId, error);
    throw error;
  }
}

export async function syncPostLikedStates(siteId: number, postIds: number[]): Promise<number> {
  const uniquePostIds = Array.from(new Set(postIds.filter((postId) => Number.isFinite(postId))));
  let changedCount = 0;
  const changedPostIds: number[] = [];

  for (const postId of uniquePostIds) {
    const changes = await setPostLiked(siteId, postId, true, { emit: false, action: 'synced' });
    if (changes > 0) {
      changedCount += changes;
      changedPostIds.push(postId);
    }
  }

  if (changedCount > 0) {
    emitBooruPostServerFavoriteChanged({
      action: 'synced',
      siteId,
      postIds: changedPostIds,
      isLiked: true,
      affectedCount: changedCount,
    });
  }

  return changedCount;
}

export async function votePost(siteId: number, postId: number, score: 1 | 0 | -1): Promise<void> {
  const site = await getBooruSiteById(siteId);
  if (!site) {
    throw new Error('Site not found');
  }

  if (!site.username || !site.passwordHash) {
    throw new Error('Authentication is required before voting');
  }

  const client = createBooruClient(site);
  await client.votePost(postId, score);
  emitBooruPostVoteChanged({ siteId, postId, vote: score });
}

// ========= 下载队列管理 =========

/**
 * 添加到下载队列
 * 入参 postId 为站点原始帖子 ID；入库时会映射为 booru_posts.id
 */
export async function addToDownloadQueue(postId: number, siteId: number, priority: number = 0, targetPath?: string): Promise<number> {
  console.log('[booruService] 添加到下载队列:', postId);
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();

    const dbPost = await get<{ id: number }>(
      db,
      'SELECT id FROM booru_posts WHERE siteId = ? AND postId = ?',
      [siteId, postId]
    );

    if (!dbPost) {
      throw new Error(`帖子 ${postId} 不存在于数据库，无法加入下载队列`);
    }

    // 检查是否已在队列中（包括失败的任务）
    const existing = await get<{ id: number; status: string }>(
      db,
      'SELECT id, status FROM booru_download_queue WHERE postId = ? AND siteId = ?',
      [dbPost.id, siteId]
    );

    if (existing) {
      if (existing.status === 'failed') {
        console.log('[booruService] 重试失败的下载任务:', existing.id);
        const result = await runWithChanges(db, 'UPDATE booru_download_queue SET status = "pending", priority = ?, targetPath = ?, updatedAt = ?, errorMessage = NULL WHERE id = ?',
          [priority, targetPath || null, now, existing.id]);
        if (result.changes > 0) {
          emitBooruPostDownloadStateChanged({
            action: 'queued',
            queueId: existing.id,
            siteId,
            postId,
            status: 'pending',
            previousStatus: existing.status,
            affectedCount: result.changes,
          });
        }
        return existing.id;
      } else if (existing.status === 'completed') {
         console.log('[booruService] 任务已完成，重新下载:', existing.id);
         const result = await runWithChanges(db, 'UPDATE booru_download_queue SET status = "pending", priority = ?, targetPath = ?, updatedAt = ?, errorMessage = NULL, progress = 0, downloadedBytes = 0 WHERE id = ?',
           [priority, targetPath || null, now, existing.id]);
         if (result.changes > 0) {
           emitBooruPostDownloadStateChanged({
             action: 'queued',
             queueId: existing.id,
             siteId,
             postId,
             status: 'pending',
             previousStatus: existing.status,
             affectedCount: result.changes,
           });
         }
         return existing.id;
      } else {
        console.log('[booruService] 图片已在下载队列中:', postId);
        return existing.id;
      }
    }

    await run(db, `
      INSERT INTO booru_download_queue
      (postId, siteId, status, priority, targetPath, createdAt, updatedAt)
      VALUES (?, ?, 'pending', ?, ?, ?, ?)
    `, [dbPost.id, siteId, priority, targetPath || null, now, now]);

    const result = await get<{ id: number }>(db, 'SELECT last_insert_rowid() as id');
    const queueId = result!.id;

    console.log('[booruService] 添加下载队列成功:', queueId);
    emitBooruPostDownloadStateChanged({
      action: 'queued',
      queueId,
      siteId,
      postId,
      status: 'pending',
      affectedCount: 1,
    });
    return queueId;
  } catch (error) {
    console.error('[booruService] 添加下载队列失败:', postId, error);
    throw error;
  }
}

/**
 * 获取下载队列（内部使用）
 * 返回的 postId 为 booru_posts.id，供下载器内部继续查库使用
 */
export async function getDownloadQueue(status?: string): Promise<DownloadQueueItem[]> {
  console.log('[booruService] 获取下载队列, 状态:', status || '全部');
  try {
    const db = await getDatabase();
    let sql = 'SELECT * FROM booru_download_queue';
    const params: any[] = [];

    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }

    sql += ' ORDER BY priority DESC, createdAt ASC';

    const queue = await all<DownloadQueueItem>(db, sql, params);
    return queue;
  } catch (error) {
    console.error('[booruService] 获取下载队列失败:', error);
    throw error;
  }
}

/**
 * 获取给渲染层展示用的下载队列
 * 将队列中内部存储的 booru_posts.id 映射回 API postId
 */
export async function getDownloadQueueForDisplay(status?: string): Promise<DownloadQueueItem[]> {
  console.log('[booruService] 获取展示下载队列, 状态:', status || '全部');
  try {
    const db = await getDatabase();
    let sql = `
      SELECT
        q.id,
        p.postId AS postId,
        q.siteId,
        q.status,
        q.progress,
        q.downloadedBytes,
        q.totalBytes,
        q.errorMessage,
        q.retryCount,
        q.priority,
        q.targetPath,
        q.createdAt,
        q.updatedAt,
        q.completedAt
      FROM booru_download_queue q
      INNER JOIN booru_posts p ON p.id = q.postId
    `;
    const params: any[] = [];

    if (status) {
      sql += ' WHERE q.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY q.priority DESC, q.createdAt ASC';

    const queue = await all<DownloadQueueItem>(db, sql, params);
    return queue;
  } catch (error) {
    console.error('[booruService] 获取展示下载队列失败:', error);
    throw error;
  }
}

/**
 * 更新下载进度
 */
export async function updateDownloadProgress(id: number, progress: number, downloadedBytes: number, totalBytes: number): Promise<void> {
  // 进度更新太频繁，不打印日志
  try {
    const db = await getDatabase();
    await run(db, `
      UPDATE booru_download_queue
      SET progress = ?, downloadedBytes = ?, totalBytes = ?
      WHERE id = ?
    `, [progress, downloadedBytes, totalBytes, id]);
  } catch (error) {
    console.error('[booruService] 更新下载进度失败:', id, error);
    throw error;
  }
}

/**
 * 更新下载状态
 */
export async function updateDownloadStatus(id: number, status: string, errorMessage?: string): Promise<void> {
  console.log('[booruService] 更新下载状态:', id, status);
  try {
    const db = await getDatabase();
    const existing = await get<{ siteId: number; postId: number; status: string }>(
      db,
      `SELECT q.siteId, p.postId, q.status
       FROM booru_download_queue q
       INNER JOIN booru_posts p ON p.id = q.postId
       WHERE q.id = ?`,
      [id],
    );
    const now = new Date().toISOString();
    const updates: any[] = [status, now];
    let sql = 'UPDATE booru_download_queue SET status = ?, updatedAt = ?';

    if (errorMessage !== undefined) {
      sql += ', errorMessage = ?';
      updates.push(errorMessage);
    }

    if (status === 'completed') {
      sql += ', completedAt = ?';
      updates.push(now);
    }

    sql += ' WHERE id = ?';
    updates.push(id);

    const result = await runWithChanges(db, sql, updates);
    if (result.changes > 0 && existing && (status === 'completed' || status === 'failed')) {
      emitBooruPostDownloadStateChanged({
        action: status,
        queueId: id,
        siteId: existing.siteId,
        postId: existing.postId,
        status,
        previousStatus: existing.status,
        affectedCount: result.changes,
      });
    }
  } catch (error) {
    console.error('[booruService] 更新下载状态失败:', id, error);
    throw error;
  }
}

/**
 * 从下载队列移除
 */
export async function removeFromDownloadQueue(id: number): Promise<void> {
  console.log('[booruService] 从下载队列移除:', id);
  try {
    const db = await getDatabase();
    const existing = await get<{ siteId: number; postId: number; status: string }>(
      db,
      `SELECT q.siteId, p.postId, q.status
       FROM booru_download_queue q
       INNER JOIN booru_posts p ON p.id = q.postId
       WHERE q.id = ?`,
      [id],
    );
    const result = await runWithChanges(db, 'DELETE FROM booru_download_queue WHERE id = ?', [id]);
    if (result.changes > 0) {
      emitBooruPostDownloadStateChanged({
        action: 'removed',
        queueId: id,
        siteId: existing?.siteId,
        postId: existing?.postId,
        status: existing?.status,
        affectedCount: result.changes,
      });
    }
  } catch (error) {
    console.error('[booruService] 移除下载队列失败:', id, error);
    throw error;
  }
}

/**
 * 清空指定状态的下载记录
 * @param status 状态（'completed' | 'failed'）
 * @returns 删除的记录数
 */
export async function clearDownloadRecords(status: 'completed' | 'failed'): Promise<number> {
  console.log('[booruService] 清空下载记录，状态:', status);
  try {
    const db = await getDatabase();
    const result = await runWithChanges(db, 'DELETE FROM booru_download_queue WHERE status = ?', [status]);
    console.log('[booruService] 清空下载记录成功，删除数量:', result.changes);
    if (result.changes > 0) {
      emitBooruPostDownloadStateChanged({
        action: 'cleared',
        status,
        affectedCount: result.changes,
      });
    }
    return result.changes;
  } catch (error) {
    console.error('[booruService] 清空下载记录失败:', status, error);
    throw error;
  }
}

/**
 * 删除单条下载记录
 * 用于失败列表中"单独删除指定失败项"的能力，补齐 clearDownloadRecords
 * 的"一键全清"之外的精细化控制。只对终态记录（completed/failed/cancelled）
 * 使用即可；对活跃下载（downloading/paused/pending）请走 cancelDownload，
 * 以便同步清理 .part 临时文件与进行中请求。
 */
export async function deleteDownloadRecord(queueId: number): Promise<boolean> {
  console.log('[booruService] 删除下载记录:', queueId);
  try {
    const db = await getDatabase();
    const existing = await get<{ siteId: number; postId: number; status: string }>(
      db,
      `SELECT q.siteId, p.postId, q.status
       FROM booru_download_queue q
       INNER JOIN booru_posts p ON p.id = q.postId
       WHERE q.id = ?`,
      [queueId],
    );
    const result = await runWithChanges(
      db,
      'DELETE FROM booru_download_queue WHERE id = ?',
      [queueId],
    );
    if (result.changes > 0) {
      emitBooruPostDownloadStateChanged({
        action: 'removed',
        queueId,
        siteId: existing?.siteId,
        postId: existing?.postId,
        status: existing?.status,
        affectedCount: result.changes,
      });
    }
    return result.changes > 0;
  } catch (error) {
    console.error('[booruService] 删除下载记录失败:', queueId, error);
    throw error;
  }
}

/**
 * 从标签字符串中提取特定类别的标签
 * @param siteId 站点ID
 * @param tagsStr 标签字符串（空格分隔）
 * @param category 标签类别（artist/character/copyright）
 * @returns 该类别的标签字符串
 */
export async function extractTagsByCategory(
  siteId: number,
  tagsStr: string,
  category: 'artist' | 'character' | 'copyright'
): Promise<string> {
  if (!tagsStr || tagsStr.trim() === '') {
    return '';
  }

  try {
    const db = await getDatabase();
    const tags = tagsStr.split(/\s+/).filter(tag => tag.trim() !== '');

    if (tags.length === 0) {
      return '';
    }

    // 从数据库查询这些标签的类别信息
    const placeholders = tags.map(() => '?').join(',');
    const query = `
      SELECT name
      FROM booru_tags
      WHERE siteId = ? AND category = ? AND name IN (${placeholders})
    `;

    const result = await all<{ name: string }>(db, query, [siteId, category, ...tags]);

    // 返回该类别的标签列表（空格分隔）
    return result.map(row => row.name).join(' ');
  } catch (error) {
    console.error(`[booruService] 提取${category}标签失败:`, { siteId, tagsStr }, error);
    // 出错时返回空字符串
    return '';
  }
}

/**
 * 保存Booru标签
 */
export async function saveBooruTags(siteId: number, tags: Array<{ name: string; category?: string; postCount?: number }>): Promise<void> {
  console.log('[booruService] 保存Booru标签:', { siteId, tagCount: tags.length });
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();

    // 使用事务批量插入，避免每个标签单独一次数据库操作
    await runInTransaction(db, async () => {
      for (const tag of tags) {
        await run(db, `
          INSERT OR REPLACE INTO booru_tags (siteId, name, category, postCount, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [siteId, tag.name, tag.category || null, tag.postCount || 0, now, now]);
      }
    });

    console.log('[booruService] 保存标签成功');
  } catch (error) {
    console.error('[booruService] 保存标签失败:', error);
    throw error;
  }
}

/**
 * 清理过期标签缓存
 * 删除 updatedAt 超过指定天数的标签记录
 * @param expireDays 过期天数（默认 60）
 * @returns 删除的记录数
 */
export async function cleanExpiredTags(expireDays: number = 60): Promise<number> {
  try {
    const db = await getDatabase();
    const cutoff = new Date(Date.now() - expireDays * 24 * 60 * 60 * 1000).toISOString();

    // 先统计数量
    const countRow = await get<{ cnt: number }>(db,
      `SELECT COUNT(*) as cnt FROM booru_tags WHERE updatedAt < ? AND updatedAt != ''`,
      [cutoff]
    );
    const toDelete = countRow?.cnt || 0;

    if (toDelete === 0) {
      console.log('[booruService] 没有需要清理的过期标签');
      return 0;
    }

    // 执行删除
    const result = await runWithChanges(db,
      `DELETE FROM booru_tags WHERE updatedAt < ? AND updatedAt != ''`,
      [cutoff]
    );

    console.log(`[booruService] 已清理 ${result.changes} 条过期标签（超过 ${expireDays} 天未访问）`);
    return result.changes;
  } catch (error) {
    console.error('[booruService] 清理过期标签失败:', error);
    return 0;
  }
}

/**
 * 获取标签缓存统计信息
 */
export async function getTagCacheStats(): Promise<{ totalCount: number; expiredCount: number; oldestDate: string | null }> {
  try {
    const db = await getDatabase();
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

    const total = await get<{ cnt: number }>(db, 'SELECT COUNT(*) as cnt FROM booru_tags');
    const expired = await get<{ cnt: number }>(db,
      `SELECT COUNT(*) as cnt FROM booru_tags WHERE updatedAt < ? AND updatedAt != ''`,
      [cutoff]
    );
    const oldest = await get<{ oldest: string | null }>(db,
      `SELECT MIN(updatedAt) as oldest FROM booru_tags WHERE updatedAt != ''`
    );

    return {
      totalCount: total?.cnt || 0,
      expiredCount: expired?.cnt || 0,
      oldestDate: oldest?.oldest || null,
    };
  } catch (error) {
    console.error('[booruService] 获取标签缓存统计失败:', error);
    return { totalCount: 0, expiredCount: 0, oldestDate: null };
  }
}

/**
 * 搜索Booru标签
 */
export async function searchBooruTags(siteId: number, query: string, limit: number = 10): Promise<Array<{ name: string; category?: string; postCount: number }>> {
  console.log('[booruService] 搜索Booru标签:', { siteId, query, limit });
  try {
    const db = await getDatabase();

    const tags = await all<{
      name: string;
      category: string;
      postCount: number;
    }>(
      db,
      `
        SELECT name, category, postCount
        FROM booru_tags
        WHERE siteId = ? AND name LIKE ?
        ORDER BY postCount DESC
        LIMIT ?
      `,
      [siteId, `%${query}%`, limit]
    );

    return tags.map(tag => ({
      name: tag.name,
      category: tag.category || undefined,
      postCount: tag.postCount || 0
    }));
  } catch (error) {
    console.error('[booruService] 搜索标签失败:', { siteId, query }, error);
    throw error;
  }
}

/**
 * 批量获取标签分类信息
 * 返回标签名到分类的映射
 */
export async function getTagsCategories(siteId: number, tagNames: string[]): Promise<Map<string, string>> {
  if (!tagNames || tagNames.length === 0) {
    return new Map();
  }

  try {
    const db = await getDatabase();
    const placeholders = tagNames.map(() => '?').join(',');
    const query = `
      SELECT name, category
      FROM booru_tags
      WHERE siteId = ? AND name IN (${placeholders})
    `;

    const tags = await all<{ name: string; category: string | null }>(
      db,
      query,
      [siteId, ...tagNames]
    );

    const categoryMap = new Map<string, string>();
    tags.forEach(tag => {
      if (tag.category) {
        categoryMap.set(tag.name, tag.category);
      } else {
        // 如果没有分类信息，默认为 general
        categoryMap.set(tag.name, 'general');
      }
    });

    // 对于数据库中没有的标签，默认为 general
    tagNames.forEach(name => {
      if (!categoryMap.has(name)) {
        categoryMap.set(name, 'general');
      }
    });

    console.log('[booruService] 获取标签分类:', { siteId, tagCount: tagNames.length, foundCount: tags.length });
    return categoryMap;
  } catch (error) {
    console.error('[booruService] 获取标签分类失败:', { siteId, tagCount: tagNames.length }, error);
    // 出错时返回默认分类（全部为 general）
    const defaultMap = new Map<string, string>();
    tagNames.forEach(name => defaultMap.set(name, 'general'));
    return defaultMap;
  }
}

// ========= 收藏标签管理 =========

/**
 * 添加收藏标签
 * @param siteId 站点ID（null=全局）
 * @param tagName 标签名
 * @param options 可选参数（分组、查询类型、备注）
 */
export async function addFavoriteTag(
  siteId: number | null,
  tagName: string,
  options?: { labels?: string[]; queryType?: 'tag' | 'raw' | 'list'; notes?: string }
): Promise<FavoriteTag> {
  console.log('[booruService] 添加收藏标签:', { siteId, tagName });
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();

    // 获取当前最大 sortOrder
    const maxSort = await get<{ maxSort: number }>(
      db,
      'SELECT COALESCE(MAX(sortOrder), 0) as maxSort FROM booru_favorite_tags WHERE siteId IS ?',
      [siteId]
    );
    const sortOrder = (maxSort?.maxSort || 0) + 1;

    const labelsJson = options?.labels ? JSON.stringify(options.labels) : null;

    await run(db, `
      INSERT INTO booru_favorite_tags (siteId, tagName, labels, queryType, notes, sortOrder, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      siteId,
      tagName,
      labelsJson,
      options?.queryType || 'tag',
      options?.notes || null,
      sortOrder,
      now,
      now
    ]);

    const result = await get<{ id: number }>(db, 'SELECT last_insert_rowid() as id');
    const id = result!.id;

    console.log('[booruService] 添加收藏标签成功:', tagName, 'ID:', id);
    emitFavoriteTagsChanged({ action: 'created', favoriteTagId: id, siteId, tagName });
    return {
      id,
      siteId,
      tagName,
      labels: options?.labels,
      queryType: options?.queryType || 'tag',
      notes: options?.notes,
      sortOrder,
      createdAt: now,
      updatedAt: now
    };
  } catch (error) {
    console.error('[booruService] 添加收藏标签失败:', tagName, error);
    throw error;
  }
}

/**
 * 批量添加收藏标签
 * - tagString 支持 \n 或 , 作为分隔符
 * - 会去掉空白项并在输入内部去重
 * - 已存在的标签会被跳过（通过 isFavoriteTag 判定）
 * - labelsString 为 CSV 形式，按 , 拆分后传给每一条新记录
 * @param tagString 原始标签字符串（换行或逗号分隔）
 * @param siteId 站点 ID，null 表示全局
 * @param labelsString 可选，分组标签（CSV）
 * @returns { added, skipped } 统计信息
 */
export async function addFavoriteTagsBatch(
  tagString: string,
  siteId: number | null,
  labelsString?: string,
): Promise<{ added: number; skipped: number }> {
  console.log('[booruService] 批量添加收藏标签:', { siteId });
  const rawTags = tagString.split(/[\n,]/).map(s => s.trim()).filter(s => s.length > 0);
  const tags = Array.from(new Set(rawTags));
  const labels = labelsString
    ? labelsString.split(',').map(l => l.trim()).filter(Boolean)
    : undefined;

  let added = 0;
  let skipped = 0;

  for (const tagName of tags) {
    try {
      const exists = await isFavoriteTag(siteId, tagName);
      if (exists) {
        skipped += 1;
        continue;
      }
      await addFavoriteTag(siteId, tagName, { labels });
      added += 1;
    } catch (error) {
      console.error('[booruService] 批量添加收藏标签单条失败:', tagName, error);
      skipped += 1;
    }
  }

  console.log('[booruService] 批量添加完成:', { added, skipped });
  if (added > 0) {
    emitFavoriteTagsChanged({ action: 'batchCreated', siteId, affectedCount: added });
  }
  return { added, skipped };
}

/**
 * 获取收藏标签列表（支持分页与关键字搜索）
 * @param params ListQueryParams（siteId / keyword / offset / limit）
 *   - siteId === undefined 表示不过滤站点
 *   - siteId === null 仅返回全局标签（siteId IS NULL）
 *   - siteId 为数字时返回该站点标签及全局标签
 *   - limit <= 0 或未传时表示“取全部”，不分页也不做兜底（例如导出场景必须返回全部行）
 */
export async function getFavoriteTags(params: ListQueryParams = {}): Promise<PaginatedResult<FavoriteTag>> {
  const { siteId, keyword, offset = 0, limit = 50, sortKey, sortOrder = 'asc' } = params;
  const unbounded = !limit || limit <= 0;
  const limitClause = unbounded ? '' : ' LIMIT ? OFFSET ?';
  const paginationParams: number[] = unbounded ? [] : [limit, Math.max(0, offset)];
  console.log('[booruService] 获取收藏标签列表:', { siteId, keyword, offset, limit: unbounded ? 'unbounded' : limit, sortKey, sortOrder });
  try {
    const db = await getDatabase();
    const where: string[] = [];
    const sqlParams: any[] = [];

    if (siteId !== undefined) {
      if (siteId === null) {
        where.push('siteId IS NULL');
      } else {
        where.push('(siteId = ? OR siteId IS NULL)');
        sqlParams.push(siteId);
      }
    }

    if (keyword && keyword.trim().length > 0) {
      where.push('tagName LIKE ? COLLATE NOCASE');
      sqlParams.push(`%${keyword.trim()}%`);
    }

    const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';

    const countRow = await get<{ cnt: number }>(
      db,
      `SELECT COUNT(*) as cnt FROM booru_favorite_tags${whereSql}`,
      sqlParams
    );
    const total = countRow?.cnt ?? 0;

    // 排序：sortKey=tagName 时按 tagName 排序，否则保持默认（sortOrder + createdAt）
    const dir = sortOrder === 'desc' ? 'DESC' : 'ASC';
    const orderSql = sortKey === 'tagName'
      ? ` ORDER BY tagName COLLATE NOCASE ${dir}`
      : ' ORDER BY sortOrder ASC, createdAt DESC';

    const rows = await all<any>(
      db,
      `SELECT * FROM booru_favorite_tags${whereSql}${orderSql}${limitClause}`,
      [...sqlParams, ...paginationParams]
    );

    const items: FavoriteTag[] = rows.map(row => ({
      ...row,
      labels: row.labels ? JSON.parse(row.labels) : undefined,
    }));

    console.log('[booruService] 获取到', items.length, '/', total, '个收藏标签');
    return { items, total };
  } catch (error) {
    console.error('[booruService] 获取收藏标签列表失败:', error);
    throw error;
  }
}

/**
 * 按绑定图集名称或上次下载时间排序查询收藏标签（需要 LEFT JOIN 绑定表和图集表）
 */
async function getFavoriteTagsSortedByJoin(params: ListQueryParams): Promise<PaginatedResult<FavoriteTag>> {
  const { siteId, keyword, offset = 0, limit = 50, sortKey, sortOrder = 'asc' } = params;
  const unbounded = !limit || limit <= 0;
  const limitClause = unbounded ? '' : ' LIMIT ? OFFSET ?';
  const paginationParams: number[] = unbounded ? [] : [limit, Math.max(0, offset)];
  const dir = sortOrder === 'desc' ? 'DESC' : 'ASC';
  const reverseDir = sortOrder === 'desc' ? 'ASC' : 'DESC';

  const db = await getDatabase();
  const where: string[] = [];
  const sqlParams: any[] = [];

  if (siteId !== undefined) {
    if (siteId === null) {
      where.push('t.siteId IS NULL');
    } else {
      where.push('(t.siteId = ? OR t.siteId IS NULL)');
      sqlParams.push(siteId);
    }
  }
  if (keyword && keyword.trim().length > 0) {
    where.push('t.tagName LIKE ? COLLATE NOCASE');
    sqlParams.push(`%${keyword.trim()}%`);
  }

  const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';

  const countRow = await get<{ cnt: number }>(
    db,
    `SELECT COUNT(*) as cnt FROM booru_favorite_tags t${whereSql}`,
    sqlParams
  );
  const total = countRow?.cnt ?? 0;

  // 排序 SQL：未绑定/无记录排后面，次级按标签名
  let orderSql: string;
  if (sortKey === 'galleryName') {
    orderSql = ` ORDER BY CASE WHEN g.name IS NULL THEN 1 ELSE 0 END, g.name COLLATE NOCASE ${dir}, t.tagName COLLATE NOCASE ASC`;
  } else {
    // lastDownloadedAt
    orderSql = ` ORDER BY CASE WHEN COALESCE(b.lastCompletedAt, b.lastStartedAt) IS NULL THEN 1 ELSE 0 END, COALESCE(b.lastCompletedAt, b.lastStartedAt) ${dir}, t.tagName COLLATE NOCASE ASC`;
  }

  const rows = await all<any>(
    db,
    `SELECT t.*
     FROM booru_favorite_tags t
     LEFT JOIN booru_favorite_tag_download_bindings b ON b.favoriteTagId = t.id
     LEFT JOIN galleries g ON g.id = b.galleryId
     ${whereSql}${orderSql}${limitClause}`,
    [...sqlParams, ...paginationParams]
  );

  const items: FavoriteTag[] = rows.map((row: any) => ({
    ...row,
    labels: row.labels ? JSON.parse(row.labels) : undefined,
  }));

  return { items, total };
}

export async function getFavoriteTagDownloadBinding(favoriteTagId: number): Promise<FavoriteTagDownloadBinding | null> {
  console.log('[booruService] 获取收藏标签下载绑定:', favoriteTagId);
  try {
    const db = await getDatabase();
    const row = await get<FavoriteTagDownloadBindingRow>(db, `
      SELECT b.*, g.name as galleryName
      FROM booru_favorite_tag_download_bindings b
      LEFT JOIN galleries g ON g.id = b.galleryId
      WHERE b.favoriteTagId = ?
    `, [favoriteTagId]);

    return parseFavoriteTagDownloadBinding(row) || null;
  } catch (error) {
    console.error('[booruService] 获取收藏标签下载绑定失败:', favoriteTagId, error);
    throw error;
  }
}

export async function exportFavoriteTags(siteId?: number | null): Promise<{
  favoriteTags: FavoriteTag[];
  favoriteTagLabels: FavoriteTagLabel[];
}> {
  const { items: favoriteTags } = await getFavoriteTags({ siteId, limit: 0 });
  const favoriteTagLabels = await getFavoriteTagLabels();
  return { favoriteTags, favoriteTagLabels };
}

/**
 * 收藏标签导入 —— 第二步：把已解析的 records 写入数据库。
 *
 * 与旧的单步 importFavoriteTags 不同，本函数只负责入库部分：
 * - records 来自 pickFile / 渲染层传入
 * - record.siteId 显式存在时优先（即便是 null，代表文件要求“全局”）
 * - record.siteId 为 undefined 时回退到调用方传入的 fallbackSiteId
 *   （通常是导入对话框里用户选的“默认站点”）
 * - 已存在的 (siteId, tagName) 计入 skipped，单条失败也计入 skipped 以免整批中断
 */
export async function importFavoriteTagsCommit(params: {
  records: FavoriteTagImportRecord[];
  labelGroups?: FavoriteTagLabelImportRecord[];
  fallbackSiteId: number | null;
}): Promise<{ imported: number; skipped: number; labelsImported: number; labelsSkipped: number }> {
  const { records, labelGroups, fallbackSiteId } = params;
  console.log('[booruService] importFavoriteTagsCommit 开始:', records.length, 'records,', labelGroups?.length ?? 0, 'label groups, fallback:', fallbackSiteId);

  let imported = 0;
  let skipped = 0;

  for (const record of records) {
    try {
      const siteId = record.siteId !== undefined ? record.siteId : fallbackSiteId;
      const exists = await isFavoriteTag(siteId, record.tagName);
      if (exists) {
        skipped += 1;
        continue;
      }
      await addFavoriteTag(siteId, record.tagName, {
        labels: record.labels,
        queryType: record.queryType,
        notes: record.notes,
      });
      imported += 1;
    } catch (error) {
      console.error('[booruService] 导入单条失败:', record.tagName, error);
      skipped += 1;
    }
  }

  // 标签分组导入（best-effort，失败 / 已存在都计入 skipped）
  let labelsImported = 0;
  let labelsSkipped = 0;
  if (labelGroups && labelGroups.length > 0) {
    for (const group of labelGroups) {
      try {
        await addFavoriteTagLabel(group.name, group.color);
        labelsImported += 1;
      } catch (error) {
        // UNIQUE constraint on name 说明分组已存在 —— 当 skipped 处理
        console.warn('[booruService] 导入标签分组失败或已存在:', group.name, error);
        labelsSkipped += 1;
      }
    }
  }

  console.log('[booruService] importFavoriteTagsCommit 完成:', { imported, skipped, labelsImported, labelsSkipped });
  if (imported > 0 || labelsImported > 0) {
    emitFavoriteTagsChanged({
      action: 'imported',
      siteId: fallbackSiteId,
      affectedCount: imported + labelsImported,
    });
  }
  return { imported, skipped, labelsImported, labelsSkipped };
}

/**
 * 收藏标签导入 —— 第一步：弹文件对话框、读取内容并解析成 records + labelGroups。
 * 不入库。取消时返回 { cancelled: true }，其余字段无效。
 */
export async function importFavoriteTagsPickFile(): Promise<FavoriteTagsImportPickFileResult> {
  console.log('[booruService] importFavoriteTagsPickFile 打开文件对话框');
  const result = await dialog.showOpenDialog({
    title: '选择收藏标签导入文件',
    filters: [
      { name: '支持的文件', extensions: ['json', 'txt'] },
      { name: 'JSON 文件', extensions: ['json'] },
      { name: '文本文件', extensions: ['txt'] },
    ],
    properties: ['openFile'],
  });

  if (result.canceled || !result.filePaths.length) {
    return { cancelled: true };
  }

  const filePath = result.filePaths[0];
  const fileName = filePath.split(/[\\/]/).pop() || filePath;
  const stat = await fs.stat(filePath);
  const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
  if (stat.size > MAX_BYTES) {
    throw new Error(`文件过大（${(stat.size / 1024 / 1024).toFixed(1)} MB），最大支持 10 MB`);
  }
  const content = await fs.readFile(filePath, 'utf-8');

  const { records, labelGroups } = parseFavoriteTagImportContent(content, filePath.toLowerCase().endsWith('.txt'));
  console.log('[booruService] 解析到', records.length, '条收藏标签记录,', labelGroups?.length ?? 0, '个标签分组');
  return { cancelled: false, fileName, records, labelGroups };
}

/**
 * 解析收藏标签导入文件内容为 records + labelGroups。
 *
 * 支持的格式：
 * - TXT：每行一个 tagName；空行、以 # 或 // 开头的行被跳过；labelGroups 恒为 undefined
 * - JSON 顶层数组：[{ tagName, siteId?, labels?, notes?, queryType? }, ...]
 *   或者 [ "tagName1", "tagName2", ... ]；此时 labelGroups 恒为 undefined
 * - JSON 包装对象：{ favoriteTags: [...] } / { tags: [...] } / { data: { favoriteTags: [...] } }
 *   此时顶层 `labels` 或 `data.favoriteTagLabels` 数组会被解析为 labelGroups，
 *   每一项要求形如 { name: string, color?: string }（其它字段，如 sortOrder，被丢弃）
 *
 * 导出为纯函数供单元测试使用（test-only export）。
 */
export function parseFavoriteTagImportContent(
  content: string,
  isTxt: boolean
): { records: FavoriteTagImportRecord[]; labelGroups?: FavoriteTagLabelImportRecord[] } {
  if (isTxt) {
    const records = content
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#') && !l.startsWith('//'))
      .map(tagName => ({ tagName }));
    return { records, labelGroups: undefined };
  }

  const json = JSON.parse(content);
  // 注意：不要给解析失败加 `?? []` 兜底，否则未知顶层结构会被静默当成空导入，
  // 而 parse 契约要求"非法顶层结构必须抛错"，便于上层提示用户换文件。
  const rawTags = Array.isArray(json)
    ? json
    : (json?.data?.favoriteTags ?? json?.favoriteTags ?? json?.tags);

  if (!Array.isArray(rawTags)) {
    throw new Error('JSON 文件格式不支持，需要顶层数组或 { favoriteTags: [...] } / { tags: [...] }');
  }

  const records = rawTags
    .map((raw: any): FavoriteTagImportRecord | null => {
      const tagName = typeof raw === 'string' ? raw : raw?.tagName ?? raw?.name;
      if (!tagName || typeof tagName !== 'string') return null;
      const record: FavoriteTagImportRecord = { tagName };
      if (raw && typeof raw === 'object') {
        if (raw.siteId !== undefined) {
          record.siteId = typeof raw.siteId === 'number' ? raw.siteId : null;
        }
        if (Array.isArray(raw.labels)) {
          record.labels = raw.labels.filter((l: unknown): l is string => typeof l === 'string');
        }
        if (typeof raw.notes === 'string') record.notes = raw.notes;
        if (raw.queryType === 'tag' || raw.queryType === 'raw' || raw.queryType === 'list') {
          record.queryType = raw.queryType;
        }
      }
      return record;
    })
    .filter((r): r is FavoriteTagImportRecord => r !== null);

  // 解析顶层 labels / data.favoriteTagLabels 为 labelGroups（仅对象包装形态下存在）
  let labelGroups: FavoriteTagLabelImportRecord[] | undefined;
  if (!Array.isArray(json)) {
    const rawLabels = json?.labels ?? json?.data?.favoriteTagLabels;
    if (Array.isArray(rawLabels)) {
      labelGroups = rawLabels
        .map((raw: any): FavoriteTagLabelImportRecord | null => {
          if (!raw || typeof raw !== 'object') return null;
          const name = raw.name;
          if (typeof name !== 'string' || name.length === 0) return null;
          const group: FavoriteTagLabelImportRecord = { name };
          if (typeof raw.color === 'string') {
            group.color = raw.color;
          }
          return group;
        })
        .filter((g: FavoriteTagLabelImportRecord | null): g is FavoriteTagLabelImportRecord => g !== null);
    }
  }

  return { records, labelGroups };
}

export async function upsertFavoriteTagDownloadBinding(
  input: UpsertFavoriteTagDownloadBindingInput
): Promise<FavoriteTagDownloadBinding> {
  console.log('[booruService] 保存收藏标签下载绑定:', input.favoriteTagId);
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const favoriteTag = await getFavoriteTagById(input.favoriteTagId);

    if (!favoriteTag) {
      throw new Error('收藏标签不存在');
    }

    const resolvedDownloadPath = input.downloadPath?.trim() || getFavoriteTagDefaultDownloadPath(favoriteTag.tagName);

    if (input.galleryId !== undefined && input.galleryId !== null) {
      const gallery = await getGallerySnapshotById(input.galleryId);
      if (!gallery) {
        throw new Error('绑定的图集不存在');
      }
      // Phase 4：下载目录需落在图集的某个绑定文件夹内（gallery_folders），而非仅等于 galleries 旧列 folderPath。
      // 否则 bindFolder 追加 / changeFolderPath 重定位后的合法目录会被误判为不一致。两侧均归一化后比较。
      const galleryFolders = (await getGalleryFolderPaths(input.galleryId)).map(p => normalizePath(p));
      if (!galleryFolders.includes(normalizePath(resolvedDownloadPath))) {
        throw new Error('下载目录必须与绑定图集的文件夹路径一致');
      }
    }

    const existing = await get<FavoriteTagDownloadBindingRow>(
      db,
      'SELECT * FROM booru_favorite_tag_download_bindings WHERE favoriteTagId = ?',
      [input.favoriteTagId]
    );

    const blacklistedTagsJson = input.blacklistedTags ? JSON.stringify(input.blacklistedTags) : null;

    if (existing) {
      await run(db, `
        UPDATE booru_favorite_tag_download_bindings
        SET galleryId = ?, downloadPath = ?, enabled = ?, autoCreateGallery = ?, autoSyncGalleryAfterDownload = ?, quality = ?, perPage = ?, concurrency = ?,
            skipIfExists = ?, notifications = ?, blacklistedTags = ?, updatedAt = ?
        WHERE favoriteTagId = ?
      `, [
        input.galleryId ?? null,
        resolvedDownloadPath,
        input.enabled === undefined ? 1 : (input.enabled ? 1 : 0),
        input.autoCreateGallery === undefined ? null : (input.autoCreateGallery ? 1 : 0),
        input.autoSyncGalleryAfterDownload === undefined ? null : (input.autoSyncGalleryAfterDownload ? 1 : 0),
        input.quality ?? null,
        input.perPage ?? null,
        input.concurrency ?? null,
        input.skipIfExists === undefined ? null : (input.skipIfExists ? 1 : 0),
        input.notifications === undefined ? null : (input.notifications ? 1 : 0),
        blacklistedTagsJson,
        now,
        input.favoriteTagId,
      ]);
    } else {
      await run(db, `
        INSERT INTO booru_favorite_tag_download_bindings (
          favoriteTagId, galleryId, downloadPath, enabled, autoCreateGallery, autoSyncGalleryAfterDownload, quality, perPage, concurrency,
          skipIfExists, notifications, blacklistedTags, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        input.favoriteTagId,
        input.galleryId ?? null,
        resolvedDownloadPath,
        input.enabled === undefined ? 1 : (input.enabled ? 1 : 0),
        input.autoCreateGallery === undefined ? null : (input.autoCreateGallery ? 1 : 0),
        input.autoSyncGalleryAfterDownload === undefined ? null : (input.autoSyncGalleryAfterDownload ? 1 : 0),
        input.quality ?? null,
        input.perPage ?? null,
        input.concurrency ?? null,
        input.skipIfExists === undefined ? null : (input.skipIfExists ? 1 : 0),
        input.notifications === undefined ? null : (input.notifications ? 1 : 0),
        blacklistedTagsJson,
        now,
        now,
      ]);
    }

    const binding = await getFavoriteTagDownloadBinding(input.favoriteTagId);
    if (!binding) {
      throw new Error('保存下载绑定失败');
    }

    emitFavoriteTagsChanged({
      action: 'bindingUpserted',
      favoriteTagId: input.favoriteTagId,
      siteId: favoriteTag.siteId,
      tagName: favoriteTag.tagName,
    });
    return binding;
  } catch (error) {
    console.error('[booruService] 保存收藏标签下载绑定失败:', input.favoriteTagId, error);
    throw error;
  }
}

export async function deleteFavoriteTagDownloadBinding(favoriteTagId: number): Promise<void> {
  console.log('[booruService] 删除收藏标签下载绑定:', favoriteTagId);
  try {
    const db = await getDatabase();
    const favoriteTag = await getFavoriteTagById(favoriteTagId);
    await run(db, 'DELETE FROM booru_favorite_tag_download_bindings WHERE favoriteTagId = ?', [favoriteTagId]);
    emitFavoriteTagsChanged({
      action: 'bindingDeleted',
      favoriteTagId,
      siteId: favoriteTag?.siteId ?? null,
      tagName: favoriteTag?.tagName,
    });
  } catch (error) {
    console.error('[booruService] 删除收藏标签下载绑定失败:', favoriteTagId, error);
    throw error;
  }
}

export async function getFavoriteTagsWithDownloadState(params: ListQueryParams = {}): Promise<PaginatedResult<FavoriteTagWithDownloadState>> {
  console.log('[booruService] 获取收藏标签及下载状态:', params);
  try {
    const { sortKey, sortOrder = 'asc' } = params;
    // galleryName / lastDownloadedAt 排序需要 JOIN 绑定表和图集表，在 SQL 层完成排序和分页
    const needsJoinSort = sortKey === 'galleryName' || sortKey === 'lastDownloadedAt';
    const paginated = needsJoinSort
      ? await getFavoriteTagsSortedByJoin(params)
      : await getFavoriteTags({ ...params, sortKey, sortOrder });
    const { items: tags, total } = paginated;
    if (tags.length === 0) {
      return { items: [], total };
    }

    const db = await getDatabase();
    const placeholders = tags.map(() => '?').join(',');
    const bindingRows = await all<FavoriteTagDownloadBindingRow>(db, `
      SELECT b.*, g.name as galleryName
      FROM booru_favorite_tag_download_bindings b
      LEFT JOIN galleries g ON g.id = b.galleryId
      WHERE b.favoriteTagId IN (${placeholders})
    `, tags.map(tag => tag.id));

    const bindingMap = new Map<number, FavoriteTagDownloadBindingRow>();
    for (const row of bindingRows) {
      bindingMap.set(row.favoriteTagId, row);
    }

    const galleryIds = Array.from(new Set(bindingRows.map(row => row.galleryId).filter((id): id is number => id !== null)));
    // Phase 8A：galleries 已无 folderPath 列；一致性判定改用下方 gallery_folders 绑定路径，
    // 此处仅取 id/name（folderPath 在此已是死字段）。
    const galleriesById = new Map<number, { id: number; name: string }>();
    if (galleryIds.length > 0) {
      const galleryPlaceholders = galleryIds.map(() => '?').join(',');
      const galleries = await all<{ id: number; name: string }>(db, `
        SELECT id, name
        FROM galleries
        WHERE id IN (${galleryPlaceholders})
      `, galleryIds);

      for (const gallery of galleries) {
        galleriesById.set(gallery.id, gallery);
      }
    }

    // Phase 4：一致性判定改用"下载目录 ∈ 图集 gallery_folders"，而非仅等于 galleries 旧列 folderPath。
    // 预取这些图集的全部绑定文件夹（归一化），按 galleryId 归组成 Set，供下方同步映射 O(1) 命中判断。
    const galleryFolderPathsById = new Map<number, Set<string>>();
    if (galleryIds.length > 0) {
      const folderPlaceholders = galleryIds.map(() => '?').join(',');
      const folderRows = await all<{ galleryId: number; folderPath: string }>(db, `
        SELECT galleryId, folderPath
        FROM gallery_folders
        WHERE galleryId IN (${folderPlaceholders})
      `, galleryIds);
      for (const row of folderRows) {
        let set = galleryFolderPathsById.get(row.galleryId);
        if (!set) {
          set = new Set<string>();
          galleryFolderPathsById.set(row.galleryId, set);
        }
        set.add(normalizePath(row.folderPath));
      }
    }

    const runtimeMap = new Map<string, FavoriteTagDownloadRuntimeProgress>();
    const sessionSnapshotMap = new Map<string, { status: BulkDownloadSessionStatus; completedAt?: string | null }>();
    const activeSessionIds = Array.from(new Set(
      bindingRows
        .filter(row => Boolean(row.lastSessionId) && isActiveBulkDownloadStatus(row.lastStatus))
        .map(row => row.lastSessionId as string)
    ));

    for (const sessionId of activeSessionIds) {
      const runtime = await getRuntimeProgressBySessionId(sessionId);
      if (runtime) {
        runtimeMap.set(sessionId, runtime);
      }
    }

    // 批量获取所有有 lastSessionId 的 session 快照，避免 N+1 查询
    const sessionIdsToCheck = Array.from(new Set(
      bindingRows
        .filter(row => Boolean(row.lastSessionId))
        .map(row => row.lastSessionId as string)
    ));

    if (sessionIdsToCheck.length > 0) {
      const snapshotPlaceholders = sessionIdsToCheck.map(() => '?').join(',');
      const snapshots = await all<{ id: string; status: BulkDownloadSessionStatus; completedAt?: string | null }>(db, `
        SELECT id, status, completedAt
        FROM bulk_download_sessions
        WHERE id IN (${snapshotPlaceholders}) AND deletedAt IS NULL
      `, sessionIdsToCheck);

      for (const snap of snapshots) {
        sessionSnapshotMap.set(snap.id, { status: snap.status, completedAt: snap.completedAt });
      }
    }

    // 批量同步终态：找出需要更新 snapshot 的 binding，一次性处理
    const bindingsToSync: Array<{ favoriteTagId: number; lastStatus: string; lastCompletedAt: string | null }> = [];
    for (const row of bindingRows) {
      if (!row.lastSessionId) continue;
      const snapshot = sessionSnapshotMap.get(row.lastSessionId);
      if (!snapshot) continue;

      if (!isActiveBulkDownloadStatus(snapshot.status) && (row.lastStatus !== snapshot.status || row.lastCompletedAt !== (snapshot.completedAt ?? null))) {
        row.lastStatus = snapshot.status;
        row.lastCompletedAt = snapshot.completedAt ?? null;
        bindingsToSync.push({
          favoriteTagId: row.favoriteTagId,
          lastStatus: snapshot.status,
          lastCompletedAt: snapshot.completedAt ?? null,
        });

        // 如果完成且需要自动同步图集，异步触发
        if (snapshot.status === 'completed' && row.galleryId && row.autoSyncGalleryAfterDownload) {
          syncGalleryAfterDownload(row.galleryId, row.downloadPath).catch(err => {
            console.error('[booruService] 自动同步图集失败:', err);
          });
        }
      }
    }

    // 批量更新 binding snapshots
    for (const sync of bindingsToSync) {
      await updateFavoriteTagDownloadBindingSnapshot(sync.favoriteTagId, {
        lastStatus: sync.lastStatus as any,
        lastCompletedAt: sync.lastCompletedAt,
      });
    }

    const enriched: FavoriteTagWithDownloadState[] = tags.map(tag => {
      const bindingRow = bindingMap.get(tag.id);
      const binding = parseFavoriteTagDownloadBinding(bindingRow);
      const runtime = binding?.lastSessionId ? runtimeMap.get(binding.lastSessionId) ?? null : null;
      let galleryBindingConsistent: boolean | null = null;
      let galleryBindingMismatchReason: string | null = null;

      if (binding?.galleryId) {
        const gallery = galleriesById.get(binding.galleryId);
        if (!gallery) {
          galleryBindingConsistent = false;
          galleryBindingMismatchReason = 'galleryNotFound';
        } else {
          // Phase 4：下载目录需落在图集的某个绑定文件夹内（gallery_folders），两侧归一化后判断。
          const folderSet = galleryFolderPathsById.get(binding.galleryId);
          if (folderSet && folderSet.has(normalizePath(binding.downloadPath))) {
            galleryBindingConsistent = true;
          } else {
            galleryBindingConsistent = false;
            galleryBindingMismatchReason = 'pathMismatch';
          }
        }
      }

      return {
        ...tag,
        downloadBinding: binding,
        resolvedDownloadPath: binding?.downloadPath || getFavoriteTagDefaultDownloadPath(tag.tagName),
        runtimeProgress: runtime,
        galleryName: bindingRow?.galleryName ?? null,
        galleryBindingConsistent,
        galleryBindingMismatchReason,
      };
    });

    return { items: enriched, total };
  } catch (error) {
    console.error('[booruService] 获取收藏标签及下载状态失败:', error);
    throw error;
  }
}

export async function getFavoriteTagDownloadHistory(favoriteTagId: number): Promise<Array<{
  sessionId: string;
  taskId: string;
  status: BulkDownloadSessionStatus;
  startedAt: string;
  completedAt?: string | null;
  error?: string | null;
}>> {
  const db = await getDatabase();
  return all(db, `
    SELECT id as sessionId, taskId, status, startedAt, completedAt, error
    FROM bulk_download_sessions
    WHERE originType = 'favoriteTag' AND originId = ? AND deletedAt IS NULL
    ORDER BY startedAt DESC
  `, [favoriteTagId]);
}

export async function getGallerySourceFavoriteTags(galleryId: number): Promise<FavoriteTagWithDownloadState[]> {
  const { items: sourceTags } = await getFavoriteTagsWithDownloadState({ limit: 0 });
  return sourceTags.filter(tag => tag.downloadBinding?.galleryId === galleryId);
}

function normalizeFavoritesBulkRating(rating?: StartFavoritesBulkDownloadInput['rating']): FavoriteRatingFilter {
  if (!rating || rating === 'all') {
    return 'all';
  }
  if (rating === 'safe' || rating === 'questionable' || rating === 'explicit') {
    return rating;
  }
  throw new Error('无效的收藏分级筛选');
}

function buildFavoritesBulkDownloadFolderName(siteName: string): string {
  const safeName = sanitizeFileName(`${siteName}_favorites`);
  return safeName || 'favorites';
}

function buildFavoritesGalleryName(siteName: string): string {
  const trimmed = siteName.trim();
  return trimmed ? `${trimmed} 收藏图集` : '收藏图集';
}

async function ensureFavoritesGallery(downloadPath: string, siteName: string): Promise<number | null> {
  const existingGallery = await findGalleryByFolderPath(downloadPath);
  if (existingGallery) {
    return existingGallery.id;
  }

  const created = await createGallery({
    folderPath: downloadPath,
    name: buildFavoritesGalleryName(siteName),
    isWatching: true,
    recursive: true,
  });

  if (!created.success || !created.data) {
    throw new Error(created.error || '创建收藏图集失败');
  }

  return created.data;
}

function getFileExtensionFromUrl(fileUrl: string, fallback?: string | null): string {
  try {
    const parsed = new URL(fileUrl);
    const ext = path.extname(parsed.pathname).slice(1);
    return ext || fallback || 'jpg';
  } catch {
    const ext = path.extname(fileUrl).slice(1);
    return ext || fallback || 'jpg';
  }
}

function toBulkDownloadPost(post: BooruPost): any {
  const ratingCode: Record<string, string> = {
    safe: 's',
    questionable: 'q',
    explicit: 'e',
  };

  return {
    id: post.postId,
    md5: post.md5,
    file_url: post.fileUrl,
    sample_url: post.sampleUrl,
    preview_url: post.previewUrl,
    width: post.width,
    height: post.height,
    rating: post.rating ? ratingCode[post.rating] : undefined,
    score: post.score,
    tags: post.tags,
    source: post.source,
  };
}

async function getFavoritePostsForBulkDownload(input: {
  siteId: number;
  groupId?: number | null;
  rating: FavoriteRatingFilter;
}): Promise<Array<BooruPost & { favoriteGroupId?: number | null }>> {
  const db = await getDatabase();
  const where = ['f.siteId = ?'];
  const params: any[] = [input.siteId];

  if (input.groupId === null) {
    where.push('f.groupId IS NULL');
  } else if (input.groupId !== undefined) {
    where.push('f.groupId = ?');
    params.push(input.groupId);
  }

  if (input.rating !== 'all') {
    where.push('p.rating = ?');
    params.push(input.rating);
  }

  const rows = await all<any>(
    db,
    `
      SELECT p.*, f.groupId as favoriteGroupId FROM booru_posts p
      INNER JOIN booru_favorites f ON p.id = f.postId
      WHERE ${where.join(' AND ')}
      ORDER BY f.createdAt DESC
    `,
    params
  );

  return rows.map(mapFavoritePostRow);
}

export async function startFavoritesBulkDownload(
  input: StartFavoritesBulkDownloadInput
): Promise<{ taskId: string; sessionId: string; deduplicated?: boolean }> {
  console.log('[booruService] 启动收藏一键下载:', input);
  if (!Number.isInteger(input.siteId) || input.siteId <= 0) {
    throw new Error('站点 ID 无效');
  }

  const rating = normalizeFavoritesBulkRating(input.rating);
  const site = await getBooruSiteById(input.siteId);
  if (!site) {
    throw new Error('站点不存在');
  }

  const downloadRoot = getDownloadsPath();
  const downloadPath = path.join(downloadRoot, buildFavoritesBulkDownloadFolderName(site.name));
  await fs.mkdir(downloadPath, { recursive: true });
  await ensureFavoritesGallery(downloadPath, site.name);

  const bulkDownloadService = await import('./bulkDownloadService.js');
  const taskResult = await bulkDownloadService.createBulkDownloadTask({
    siteId: input.siteId,
    path: downloadPath,
    tags: [],
    notifications: true,
    skipIfExists: true,
  });

  if (!taskResult.success || !taskResult.data) {
    throw new Error(taskResult.error || '创建收藏批量下载任务失败');
  }

  const task = taskResult.data as BulkDownloadTask;
  const sessionResult = await bulkDownloadService.createBulkDownloadSession(task.id);
  if (!sessionResult.success || !sessionResult.data) {
    throw new Error(sessionResult.error || '创建收藏批量下载会话失败');
  }

  const sessionId = sessionResult.data.id;
  await updateBulkDownloadSessionOrigin(sessionId, 'favorites', input.siteId);

  const favoritePosts = await getFavoritePostsForBulkDownload({
    siteId: input.siteId,
    groupId: input.groupId,
    rating,
  });

  const records: Omit<BulkDownloadRecord, 'createdAt'>[] = [];
  for (let i = 0; i < favoritePosts.length; i++) {
    const post = favoritePosts[i];
    if (post.downloaded || post.localPath) {
      continue;
    }

    const fileUrl = post.fileUrl || post.sampleUrl || post.previewUrl;
    if (!fileUrl) {
      continue;
    }

    const bulkPost = toBulkDownloadPost(post);
    const fileName = await bulkDownloadService.generateBulkDownloadFileName(bulkPost, task, site.name);
    if (fsSync.existsSync(path.join(downloadPath, fileName))) {
      continue;
    }

    records.push({
      url: fileUrl,
      sessionId,
      status: 'pending',
      page: 1,
      pageIndex: i,
      fileName,
      extension: getFileExtensionFromUrl(fileUrl, post.fileExt),
      thumbnailUrl: post.previewUrl || post.sampleUrl,
      sourceUrl: post.source,
    });
  }

  if (records.length > 0) {
    await bulkDownloadService.createBulkDownloadRecords(records);
  }

  const startResult = await bulkDownloadService.startBulkDownloadSession(sessionId);
  if (!startResult.success) {
    throw new Error(startResult.error || '启动收藏批量下载会话失败');
  }

  const result: { taskId: string; sessionId: string; deduplicated?: boolean } = {
    taskId: task.id,
    sessionId,
  };
  if (sessionResult.deduplicated) {
    result.deduplicated = true;
  }
  return result;
}

export async function startFavoriteTagBulkDownload(favoriteTagId: number): Promise<{ taskId: string; sessionId: string; deduplicated?: boolean }> {
  console.log('[booruService] 启动收藏标签批量下载:', favoriteTagId);
  const favoriteTag = await getFavoriteTagById(favoriteTagId);
  if (!favoriteTag) {
    throw new Error('收藏标签不存在');
  }

  const binding = await getFavoriteTagDownloadBinding(favoriteTagId);
  if (!binding || !binding.enabled) {
    throw new Error('当前收藏标签尚未配置下载');
  }

  // 所有 queryType（tag / raw / list）均支持下载

  if (favoriteTag.siteId == null) {
    await updateFavoriteTagDownloadBindingSnapshot(favoriteTagId, { lastStatus: 'validationError' });
    throw new Error('未指定站点的收藏标签无法直接启动下载');
  }

  let resolvedGalleryId = binding.galleryId ?? null;
  if (resolvedGalleryId) {
    const gallery = await getGallerySnapshotById(resolvedGalleryId);
    if (!gallery) {
      await updateFavoriteTagDownloadBindingSnapshot(favoriteTagId, { lastStatus: 'validationError' });
      throw new Error('绑定的图集不存在');
    }
    // Phase 4：下载目录需落在图集的某个绑定文件夹内（gallery_folders），两侧归一化后比较。
    const galleryFolders = (await getGalleryFolderPaths(resolvedGalleryId)).map(p => normalizePath(p));
    if (!galleryFolders.includes(normalizePath(binding.downloadPath))) {
      await updateFavoriteTagDownloadBindingSnapshot(favoriteTagId, { lastStatus: 'validationError' });
      throw new Error('下载目录必须与绑定图集的文件夹路径一致');
    }
  }

  await fs.mkdir(binding.downloadPath, { recursive: true });

  if (!resolvedGalleryId && binding.autoCreateGallery) {
    resolvedGalleryId = await ensureGalleryForFavoriteTag(favoriteTag, binding);
    if (resolvedGalleryId) {
      await upsertFavoriteTagDownloadBinding({
        favoriteTagId,
        galleryId: resolvedGalleryId,
        downloadPath: binding.downloadPath,
        enabled: binding.enabled,
        autoCreateGallery: binding.autoCreateGallery,
        autoSyncGalleryAfterDownload: binding.autoSyncGalleryAfterDownload,
        quality: binding.quality ?? undefined,
        perPage: binding.perPage ?? undefined,
        concurrency: binding.concurrency ?? undefined,
        skipIfExists: binding.skipIfExists ?? undefined,
        notifications: binding.notifications ?? undefined,
        blacklistedTags: binding.blacklistedTags ?? undefined,
      });
    }
  }

  // 根据 queryType 解析 tags 参数
  // tag: 单个标签名  raw: 原始查询字符串  list: 空格分隔的多标签
  const resolvedTags = favoriteTag.queryType === 'list'
    ? favoriteTag.tagName.split(/\s+/).filter(Boolean)
    : [favoriteTag.tagName];

  const bulkDownloadService = await import('./bulkDownloadService.js');
  const taskResult = await bulkDownloadService.createBulkDownloadTask({
    siteId: favoriteTag.siteId,
    path: binding.downloadPath,
    tags: resolvedTags,
    blacklistedTags: binding.blacklistedTags ?? undefined,
    notifications: binding.notifications ?? undefined,
    skipIfExists: binding.skipIfExists ?? undefined,
    quality: binding.quality ?? undefined,
    perPage: binding.perPage ?? undefined,
    concurrency: binding.concurrency ?? undefined,
  });

  if (!taskResult.success || !taskResult.data) {
    await updateFavoriteTagDownloadBindingSnapshot(favoriteTagId, { lastStatus: 'taskCreateFailed' });
    throw new Error(taskResult.error || '创建批量下载任务失败');
  }

  const taskId = taskResult.data.id;

  // 任务已存在（任务模板去重）：只有仍存在活跃会话时才短路返回，
  // 否则 fallthrough 到下面 createBulkDownloadSession + startBulkDownloadSession，
  // 复用任务模板启动一次新的下载会话。
  if (taskResult.data.deduplicated) {
    const hasActive = await bulkDownloadService.hasActiveSessionForTask(taskId);
    if (hasActive) {
      console.log('[booruService] 任务存在活跃会话，跳过重启:', taskId);
      emitBuiltRendererAppEvent({
        type: 'favorite-tag-download:created',
        source: 'booruService',
        payload: {
          favoriteTagId,
          tagName: favoriteTag.tagName,
          siteId: favoriteTag.siteId,
          taskId,
          sessionId: '',
          deduplicated: true,
          status: 'starting',
        },
      });
      return { taskId, sessionId: '', deduplicated: true };
    }
    console.log('[booruService] 任务已存在但无活跃会话，复用任务模板启动新会话:', taskId);
    // 继续走下面的 createBulkDownloadSession / startBulkDownloadSession
  }

  const sessionResult = await bulkDownloadService.createBulkDownloadSession(taskId);
  if (!sessionResult.success || !sessionResult.data) {
    await updateFavoriteTagDownloadBindingSnapshot(favoriteTagId, {
      lastTaskId: taskId,
      lastStatus: 'sessionCreateFailed',
    });
    throw new Error(sessionResult.error || '创建批量下载会话失败');
  }

  const sessionId = sessionResult.data.id;
  await updateBulkDownloadSessionOrigin(sessionId, 'favoriteTag', favoriteTagId);
  await updateFavoriteTagDownloadBindingSnapshot(favoriteTagId, {
    lastTaskId: taskId,
    lastSessionId: sessionId,
    lastStartedAt: new Date().toISOString(),
    lastCompletedAt: null,
    lastStatus: 'starting',
  });

  emitBuiltRendererAppEvent({
    type: 'favorite-tag-download:created',
    source: 'booruService',
    payload: {
      favoriteTagId,
      tagName: favoriteTag.tagName,
      siteId: favoriteTag.siteId,
      taskId,
      sessionId,
      deduplicated: sessionResult.deduplicated,
      status:
        sessionResult.data.status === 'pending' ||
        sessionResult.data.status === 'queued' ||
        sessionResult.data.status === 'dryRun' ||
        sessionResult.data.status === 'running'
          ? sessionResult.data.status
          : 'starting',
    },
  });

  (async () => {
    try {
      if (sessionResult.deduplicated) {
        return;
      }

      const startResult = await bulkDownloadService.startBulkDownloadSession(sessionId);
      if (!startResult.success) {
        await updateFavoriteTagDownloadBindingSnapshot(favoriteTagId, {
          lastTaskId: taskId,
          lastSessionId: sessionId,
          lastStatus: 'failed',
        });
        return;
      }

      const runtime = await getRuntimeProgressBySessionId(sessionId);
      await updateFavoriteTagDownloadBindingSnapshot(favoriteTagId, {
        lastTaskId: taskId,
        lastSessionId: sessionId,
        lastStatus: runtime?.status || (startResult.queued ? 'queued' : 'running'),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[booruService] 后台启动收藏标签批量下载失败:', errorMessage);
      await updateFavoriteTagDownloadBindingSnapshot(favoriteTagId, {
        lastTaskId: taskId,
        lastSessionId: sessionId,
        lastStatus: 'failed',
      });
    }
  })();

  return { taskId, sessionId };
}

/**
 * 更新收藏标签
 *
 * siteId 修改规则：
 * - 允许 `null -> number`：全局标签升级为具体站点专属
 * - 允许 `null -> null` / `X -> X` 这种 no-op
 * - 禁止 `number -> other number`、`number -> null`：已绑定具体站点的收藏标签不允许
 *   再改回全局或换站，以免破坏既有站点维度的收藏含义
 */
export async function updateFavoriteTag(
  id: number,
  updates: Partial<Pick<FavoriteTag, 'tagName' | 'labels' | 'queryType' | 'notes' | 'sortOrder' | 'siteId'>>
): Promise<void> {
  console.log('[booruService] 更新收藏标签:', id, updates);
  try {
    const db = await getDatabase();

    // ========== siteId 修改规则校验 ==========
    if (updates.siteId !== undefined) {
      const current = await get<{ siteId: number | null }>(
        db,
        'SELECT siteId FROM booru_favorite_tags WHERE id = ?',
        [id]
      );
      if (!current) {
        throw new Error('收藏标签不存在');
      }
      // 已绑定站点的标签不允许改站点（包括改回 null）
      if (current.siteId !== null && current.siteId !== updates.siteId) {
        throw new Error('已指派到具体站点的收藏标签不允许修改站点');
      }
      // global -> global 是 no-op，删掉这个字段避免 UPDATE 语句空转
      if (current.siteId === null && updates.siteId === null) {
        delete (updates as Partial<Pick<FavoriteTag, 'siteId'>>).siteId;
      }
    }

    const now = new Date().toISOString();
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.tagName !== undefined) {
      fields.push('tagName = ?');
      values.push(updates.tagName);
    }
    if (updates.labels !== undefined) {
      fields.push('labels = ?');
      values.push(JSON.stringify(updates.labels));
    }
    if (updates.queryType !== undefined) {
      fields.push('queryType = ?');
      values.push(updates.queryType);
    }
    if (updates.notes !== undefined) {
      fields.push('notes = ?');
      values.push(updates.notes);
    }
    if (updates.sortOrder !== undefined) {
      fields.push('sortOrder = ?');
      values.push(updates.sortOrder);
    }
    if (updates.siteId !== undefined) {
      fields.push('siteId = ?');
      values.push(updates.siteId);
    }

    if (fields.length === 0) {
      console.warn('[booruService] 没有需要更新的字段');
      return;
    }

    fields.push('updatedAt = ?');
    values.push(now);
    values.push(id);

    await run(db, `UPDATE booru_favorite_tags SET ${fields.join(', ')} WHERE id = ?`, values);
    console.log('[booruService] 更新收藏标签成功:', id);
    emitFavoriteTagsChanged({ action: 'updated', favoriteTagId: id, siteId: updates.siteId, tagName: updates.tagName });
  } catch (error) {
    console.error('[booruService] 更新收藏标签失败:', id, error);
    throw error;
  }
}

/**
 * 删除收藏标签
 */
export async function removeFavoriteTag(id: number): Promise<void> {
  console.log('[booruService] 删除收藏标签:', id);
  try {
    const db = await getDatabase();
    const tag = await getFavoriteTagById(id);
    await run(db, 'DELETE FROM booru_favorite_tags WHERE id = ?', [id]);
    console.log('[booruService] 删除收藏标签成功:', id);
    emitFavoriteTagsChanged({ action: 'deleted', favoriteTagId: id, siteId: tag?.siteId ?? null, tagName: tag?.tagName });
  } catch (error) {
    console.error('[booruService] 删除收藏标签失败:', id, error);
    throw error;
  }
}

/**
 * 检查标签是否已收藏
 */
export async function isFavoriteTag(siteId: number | null, tagName: string): Promise<boolean> {
  try {
    const db = await getDatabase();
    const result = await get<{ count: number }>(
      db,
      'SELECT COUNT(*) as count FROM booru_favorite_tags WHERE siteId IS ? AND tagName = ?',
      [siteId, tagName]
    );
    return result ? result.count > 0 : false;
  } catch (error) {
    console.error('[booruService] 检查标签收藏状态失败:', tagName, error);
    return false;
  }
}

/**
 * 根据标签名删除收藏标签（用于从 UI 上快速取消收藏）
 */
export async function removeFavoriteTagByName(siteId: number | null, tagName: string): Promise<void> {
  console.log('[booruService] 根据名称删除收藏标签:', { siteId, tagName });
  try {
    const db = await getDatabase();
    await run(db, 'DELETE FROM booru_favorite_tags WHERE siteId IS ? AND tagName = ?', [siteId, tagName]);
    console.log('[booruService] 删除收藏标签成功:', tagName);
    emitFavoriteTagsChanged({ action: 'deleted', siteId, tagName });
  } catch (error) {
    console.error('[booruService] 删除收藏标签失败:', tagName, error);
    throw error;
  }
}

// ========= 收藏标签分组管理 =========

/**
 * 获取所有标签分组
 */
export async function getFavoriteTagLabels(): Promise<FavoriteTagLabel[]> {
  console.log('[booruService] 获取标签分组列表');
  try {
    const db = await getDatabase();
    const labels = await all<FavoriteTagLabel>(
      db,
      'SELECT * FROM booru_favorite_tag_labels ORDER BY sortOrder ASC, createdAt DESC'
    );
    console.log('[booruService] 获取到', labels.length, '个标签分组');
    return labels;
  } catch (error) {
    console.error('[booruService] 获取标签分组列表失败:', error);
    throw error;
  }
}

/**
 * 添加标签分组
 */
export async function addFavoriteTagLabel(name: string, color?: string): Promise<FavoriteTagLabel> {
  console.log('[booruService] 添加标签分组:', name);
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();

    const maxSort = await get<{ maxSort: number }>(
      db,
      'SELECT COALESCE(MAX(sortOrder), 0) as maxSort FROM booru_favorite_tag_labels'
    );
    const sortOrder = (maxSort?.maxSort || 0) + 1;

    await run(db, `
      INSERT INTO booru_favorite_tag_labels (name, color, sortOrder, createdAt)
      VALUES (?, ?, ?, ?)
    `, [name, color || null, sortOrder, now]);

    const result = await get<{ id: number }>(db, 'SELECT last_insert_rowid() as id');
    const id = result!.id;

    console.log('[booruService] 添加标签分组成功:', name, 'ID:', id);
    emitFavoriteTagsChanged({ action: 'labelCreated', affectedCount: 1 });
    return { id, name, color, sortOrder, createdAt: now };
  } catch (error) {
    console.error('[booruService] 添加标签分组失败:', name, error);
    throw error;
  }
}

/**
 * 删除标签分组
 */
export async function removeFavoriteTagLabel(id: number): Promise<void> {
  console.log('[booruService] 删除标签分组:', id);
  try {
    const db = await getDatabase();
    await run(db, 'DELETE FROM booru_favorite_tag_labels WHERE id = ?', [id]);
    console.log('[booruService] 删除标签分组成功:', id);
    emitFavoriteTagsChanged({ action: 'labelDeleted', affectedCount: 1 });
  } catch (error) {
    console.error('[booruService] 删除标签分组失败:', id, error);
    throw error;
  }
}

// ========= 搜索历史 =========

/**
 * 添加搜索历史记录
 * 如果相同站点+查询已存在，更新时间和结果数
 */
export async function addSearchHistory(siteId: number, query: string, resultCount: number = 0): Promise<void> {
  console.log('[booruService] 添加搜索历史:', { siteId, query, resultCount });
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();

    // 如果已存在相同查询，更新时间和结果数
    const existing = await get<any>(db,
      'SELECT id FROM booru_search_history WHERE siteId = ? AND query = ?',
      [siteId, query]
    );

    if (existing) {
      await run(db,
        'UPDATE booru_search_history SET resultCount = ?, createdAt = ? WHERE id = ?',
        [resultCount, now, existing.id]
      );
    } else {
      await run(db,
        'INSERT INTO booru_search_history (siteId, query, resultCount, createdAt) VALUES (?, ?, ?, ?)',
        [siteId, query, resultCount, now]
      );
    }
    console.log('[booruService] 搜索历史已保存');
    emitBooruSearchHistoryChanged({
      action: 'created',
      siteId,
      affectedCount: 1,
    });
  } catch (error) {
    console.error('[booruService] 添加搜索历史失败:', error);
    throw error;
  }
}

/**
 * 获取搜索历史记录
 * @param siteId 站点 ID（可选，不传则获取全部）
 * @param limit 最大返回数量，默认 20
 */
export async function getSearchHistory(siteId?: number, limit: number = 20): Promise<SearchHistoryItem[]> {
  console.log('[booruService] 获取搜索历史:', { siteId, limit });
  try {
    const db = await getDatabase();
    let sql = 'SELECT * FROM booru_search_history';
    const params: any[] = [];

    if (siteId) {
      sql += ' WHERE siteId = ?';
      params.push(siteId);
    }

    sql += ' ORDER BY createdAt DESC LIMIT ?';
    params.push(limit);

    const history = await all<SearchHistoryItem>(db, sql, params);
    console.log('[booruService] 获取到', history.length, '条搜索历史');
    return history;
  } catch (error) {
    console.error('[booruService] 获取搜索历史失败:', error);
    throw error;
  }
}

/**
 * 清除搜索历史记录
 * @param siteId 站点 ID（可选，不传则清除全部）
 */
export async function clearSearchHistory(siteId?: number): Promise<void> {
  console.log('[booruService] 清除搜索历史:', { siteId });
  try {
    const db = await getDatabase();
    let result: { changes: number };
    if (siteId) {
      result = await runWithChanges(db, 'DELETE FROM booru_search_history WHERE siteId = ?', [siteId]);
    } else {
      result = await runWithChanges(db, 'DELETE FROM booru_search_history');
    }
    console.log('[booruService] 搜索历史已清除');
    if (result.changes > 0) {
      emitBooruSearchHistoryChanged({
        action: 'cleared',
        siteId: siteId ?? null,
        affectedCount: result.changes,
      });
    }
  } catch (error) {
    console.error('[booruService] 清除搜索历史失败:', error);
    throw error;
  }
}

// ========= 黑名单标签管理 =========

async function addBlacklistedTagInternal(
  tagName: string,
  siteId?: number | null,
  reason?: string,
  options: { emit?: boolean } = { emit: true },
): Promise<BlacklistedTag> {
  console.log('[booruService] 添加黑名单标签:', { tagName, siteId, reason });
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const resolvedSiteId = siteId ?? null;

    await run(db,
      'INSERT INTO booru_blacklisted_tags (siteId, tagName, isActive, reason, createdAt, updatedAt) VALUES (?, ?, 1, ?, ?, ?)',
      [resolvedSiteId, tagName, reason || null, now, now]
    );

    const inserted = await get<any>(db,
      'SELECT * FROM booru_blacklisted_tags WHERE siteId IS ? AND tagName = ?',
      [resolvedSiteId, tagName]
    );

    console.log('[booruService] 黑名单标签已添加:', inserted?.id);
    const tag = {
      ...inserted,
      isActive: Boolean(inserted.isActive)
    };
    if (options.emit !== false) {
      emitBooruBlacklistTagsChanged({
        action: 'created',
        siteId: tag.siteId ?? null,
        blacklistTagId: tag.id,
        tagName: tag.tagName,
        isActive: tag.isActive,
        affectedCount: 1,
      });
    }
    return tag;
  } catch (error) {
    console.error('[booruService] 添加黑名单标签失败:', error);
    throw error;
  }
}

/**
 * 添加黑名单标签
 */
export async function addBlacklistedTag(tagName: string, siteId?: number | null, reason?: string): Promise<BlacklistedTag> {
  return addBlacklistedTagInternal(tagName, siteId, reason, { emit: true });
}

/**
 * 批量添加黑名单标签（支持换行分隔的字符串）
 */
export async function addBlacklistedTags(tagString: string, siteId?: number | null, reason?: string): Promise<{ added: number; skipped: number }> {
  console.log('[booruService] 批量添加黑名单标签');
  // 支持换行或英文逗号分隔，顺带去重（与 BatchTagAddModal 的输入语义对齐）
  const tags = Array.from(new Set(
    tagString.split(/[\n,]/).map(t => t.trim()).filter(t => t.length > 0)
  ));
  let added = 0;
  let skipped = 0;

  for (const tag of tags) {
    try {
      await addBlacklistedTagInternal(tag, siteId, reason, { emit: false });
      added++;
    } catch (error: any) {
      if (error.message?.includes('UNIQUE constraint')) {
        skipped++;
      } else {
        console.error('[booruService] 添加黑名单标签失败:', tag, error);
        skipped++;
      }
    }
  }

  if (added > 0) {
    emitBooruBlacklistTagsChanged({
      action: 'batchCreated',
      siteId: siteId ?? null,
      affectedCount: added,
    });
  }
  console.log('[booruService] 批量添加完成:', { added, skipped });
  return { added, skipped };
}

/**
 * 黑名单标签导入 —— 第二步：把已解析的 records 写入数据库。
 *
 * 与旧的单步 importBlacklistedTags 不同，本函数只负责入库部分：
 * - records 来自 pickFile / 渲染层传入
 * - record.siteId 显式存在时优先（即便是 null，代表文件要求"全局"）
 * - record.siteId 为 undefined 时回退到调用方传入的 fallbackSiteId
 *   （通常是导入对话框里用户选的"默认站点"）
 * - 已存在的 (siteId, tagName) 由底层 UNIQUE 约束抛错，捕获后计入 skipped；
 *   任何其它异常也计入 skipped 以免整批中断
 */
export async function importBlacklistedTagsCommit(params: {
  records: BlacklistedTagImportRecord[];
  fallbackSiteId: number | null;
}): Promise<{ imported: number; skipped: number }> {
  const { records, fallbackSiteId } = params;
  console.log('[booruService] importBlacklistedTagsCommit 开始:', records.length, 'records, fallback:', fallbackSiteId);

  let imported = 0;
  let skipped = 0;
  const importedScopes = new Set<number | null>();

  for (const record of records) {
    try {
      const siteId = record.siteId !== undefined ? record.siteId : fallbackSiteId;
      await addBlacklistedTagInternal(record.tagName, siteId, record.reason, { emit: false });
      imported += 1;
      importedScopes.add(siteId ?? null);
    } catch (error: any) {
      if (error?.message?.includes('UNIQUE constraint')) {
        skipped += 1;
      } else {
        console.error('[booruService] 导入黑名单单条失败:', record.tagName, error);
        skipped += 1;
      }
    }
  }

  if (imported > 0) {
    const scopes = Array.from(importedScopes);
    const eventSiteId = scopes.length === 1 ? scopes[0] : undefined;
    emitBooruBlacklistTagsChanged({
      action: 'imported',
      ...(eventSiteId !== undefined ? { siteId: eventSiteId } : {}),
      affectedCount: imported,
    });
  }
  console.log('[booruService] importBlacklistedTagsCommit 完成:', { imported, skipped });
  return { imported, skipped };
}

/**
 * 黑名单标签导入 —— 第一步：弹文件对话框、读取内容并解析成 records。
 * 不入库。取消时返回 { cancelled: true }，其余字段无效。
 */
export async function importBlacklistedTagsPickFile(): Promise<ImportPickFileResult<BlacklistedTagImportRecord>> {
  console.log('[booruService] importBlacklistedTagsPickFile 打开文件对话框');
  const result = await dialog.showOpenDialog({
    title: '选择黑名单导入文件',
    filters: [
      { name: '支持的文件', extensions: ['json', 'txt'] },
      { name: 'JSON 文件', extensions: ['json'] },
      { name: '文本文件', extensions: ['txt'] },
    ],
    properties: ['openFile'],
  });

  if (result.canceled || !result.filePaths.length) {
    return { cancelled: true };
  }

  const filePath = result.filePaths[0];
  const fileName = filePath.split(/[\\/]/).pop() || filePath;
  const stat = await fs.stat(filePath);
  const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
  if (stat.size > MAX_BYTES) {
    throw new Error(`文件过大（${(stat.size / 1024 / 1024).toFixed(1)} MB），最大支持 10 MB`);
  }
  const content = await fs.readFile(filePath, 'utf-8');

  const records = parseBlacklistedTagImportContent(content, filePath.toLowerCase().endsWith('.txt'));
  console.log('[booruService] 解析到', records.length, '条黑名单记录');
  return { cancelled: false, fileName, records };
}

/**
 * 解析黑名单导入文件内容为 records。
 *
 * 支持的格式：
 * - TXT：每行一个 tagName；空行、以 # 或 // 开头的行被跳过
 * - JSON 顶层数组：[{ tagName, siteId?, reason? }, ...]
 *   或者 [ "tagName1", "tagName2", ... ]
 * - JSON 包装对象：{ blacklistedTags: [...] } / { tags: [...] } / { data: { blacklistedTags: [...] } }
 *
 * 导出为纯函数供单元测试使用（test-only export）。
 */
export function parseBlacklistedTagImportContent(content: string, isTxt: boolean): BlacklistedTagImportRecord[] {
  if (isTxt) {
    return content
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#') && !l.startsWith('//'))
      .map(tagName => ({ tagName }));
  }

  const json = JSON.parse(content);
  // 注意：不要给解析失败加 `?? []` 兜底，否则未知顶层结构会被静默当成空导入，
  // 而 parse 契约要求"非法顶层结构必须抛错"，便于上层提示用户换文件。
  const rawTags = Array.isArray(json)
    ? json
    : (json?.data?.blacklistedTags ?? json?.blacklistedTags ?? json?.tags);

  if (!Array.isArray(rawTags)) {
    throw new Error('JSON 文件格式不支持，需要顶层数组或 { blacklistedTags: [...] } / { tags: [...] }');
  }

  return rawTags
    .map((raw: any): BlacklistedTagImportRecord | null => {
      const tagName = typeof raw === 'string' ? raw : raw?.tagName ?? raw?.name;
      if (!tagName || typeof tagName !== 'string') return null;
      const record: BlacklistedTagImportRecord = { tagName };
      if (raw && typeof raw === 'object') {
        if (raw.siteId !== undefined) {
          record.siteId = typeof raw.siteId === 'number' ? raw.siteId : null;
        }
        if (typeof raw.reason === 'string') record.reason = raw.reason;
      }
      return record;
    })
    .filter((r): r is BlacklistedTagImportRecord => r !== null);
}

/**
 * 获取黑名单标签列表（支持分页与关键词模糊搜索）
 *
 * 参数语义：
 * - siteId: undefined = 不过滤；null = 只查全局；number = 该站点 + 全局
 * - keyword: 空串或 undefined 不搜索；非空走 COLLATE NOCASE LIKE 模糊匹配
 * - offset: 默认 0
 * - limit: 默认 50；传 0 或负数 = 不分页，真正返回全部（例如导出场景），不做兜底
 */
export async function getBlacklistedTags(
  params: ListQueryParams = {}
): Promise<PaginatedResult<BlacklistedTag>> {
  const { siteId, keyword, offset = 0, limit = 50 } = params;
  const unbounded = !limit || limit <= 0;
  const limitClause = unbounded ? '' : ' LIMIT ? OFFSET ?';
  const paginationParams: number[] = unbounded ? [] : [limit, Math.max(0, offset)];
  console.log('[booruService] 获取黑名单标签列表:', { siteId, keyword, offset, limit: unbounded ? 'unbounded' : limit });
  try {
    const db = await getDatabase();
    const where: string[] = [];
    const sqlParams: any[] = [];

    if (siteId !== undefined) {
      if (siteId === null) {
        where.push('siteId IS NULL');
      } else {
        where.push('(siteId = ? OR siteId IS NULL)');
        sqlParams.push(siteId);
      }
    }

    if (keyword && keyword.trim().length > 0) {
      where.push('tagName LIKE ? COLLATE NOCASE');
      sqlParams.push(`%${keyword.trim()}%`);
    }

    const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';

    const countRow = await get<{ cnt: number }>(
      db,
      `SELECT COUNT(*) as cnt FROM booru_blacklisted_tags${whereSql}`,
      sqlParams
    );
    const total = countRow?.cnt ?? 0;

    const rows = await all<any>(
      db,
      `SELECT * FROM booru_blacklisted_tags${whereSql} ORDER BY createdAt DESC${limitClause}`,
      [...sqlParams, ...paginationParams]
    );

    const items = rows.map((tag: any) => ({
      ...tag,
      isActive: Boolean(tag.isActive),
    }));

    console.log('[booruService] 获取到', items.length, '/', total, '个黑名单标签');
    return { items, total };
  } catch (error) {
    console.error('[booruService] 获取黑名单标签列表失败:', error);
    throw error;
  }
}

/**
 * 获取激活的黑名单标签名列表（用于过滤）
 * @param siteId 站点 ID（可选）
 */
export async function getActiveBlacklistTagNames(siteId?: number | null): Promise<string[]> {
  console.log('[booruService] 获取激活的黑名单标签名列表, siteId:', siteId);
  try {
    const db = await getDatabase();
    let sql = 'SELECT tagName FROM booru_blacklisted_tags WHERE isActive = 1';
    const params: any[] = [];

    if (siteId !== undefined && siteId !== null) {
      sql += ' AND (siteId = ? OR siteId IS NULL)';
      params.push(siteId);
    }

    const tags = await all<{ tagName: string }>(db, sql, params);
    const result = tags.map(t => t.tagName);
    console.log('[booruService] 获取到', result.length, '个激活的黑名单标签');
    return result;
  } catch (error) {
    console.error('[booruService] 获取激活黑名单标签失败:', error);
    throw error;
  }
}

/**
 * 切换黑名单标签激活状态
 */
export async function toggleBlacklistedTag(id: number): Promise<BlacklistedTag> {
  console.log('[booruService] 切换黑名单标签激活状态:', id);
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();

    // 先获取当前状态
    const tag = await get<any>(db, 'SELECT * FROM booru_blacklisted_tags WHERE id = ?', [id]);
    if (!tag) {
      throw new Error('黑名单标签不存在');
    }

    const newIsActive = tag.isActive ? 0 : 1;
    const result = await runWithChanges(db,
      'UPDATE booru_blacklisted_tags SET isActive = ?, updatedAt = ? WHERE id = ?',
      [newIsActive, now, id]
    );

    console.log('[booruService] 黑名单标签状态已切换:', id, '->', newIsActive);
    emitBooruBlacklistTagsChanged({
      action: 'toggled',
      siteId: tag.siteId ?? null,
      blacklistTagId: id,
      tagName: tag.tagName,
      isActive: Boolean(newIsActive),
      affectedCount: result.changes,
    });
    return {
      ...tag,
      isActive: Boolean(newIsActive),
      updatedAt: now
    };
  } catch (error) {
    console.error('[booruService] 切换黑名单标签状态失败:', error);
    throw error;
  }
}

/**
 * 更新黑名单标签
 */
export async function updateBlacklistedTag(id: number, updates: Partial<Pick<BlacklistedTag, 'tagName' | 'reason' | 'isActive'>>): Promise<void> {
  console.log('[booruService] 更新黑名单标签:', id, updates);
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const existing = await get<any>(db, 'SELECT * FROM booru_blacklisted_tags WHERE id = ?', [id]);
    if (!existing) {
      throw new Error('黑名单标签不存在');
    }
    const setClauses: string[] = ['updatedAt = ?'];
    const params: any[] = [now];

    if (updates.tagName !== undefined) {
      setClauses.push('tagName = ?');
      params.push(updates.tagName);
    }
    if (updates.reason !== undefined) {
      setClauses.push('reason = ?');
      params.push(updates.reason);
    }
    if (updates.isActive !== undefined) {
      setClauses.push('isActive = ?');
      params.push(updates.isActive ? 1 : 0);
    }

    params.push(id);
    const result = await runWithChanges(db, `UPDATE booru_blacklisted_tags SET ${setClauses.join(', ')} WHERE id = ?`, params);
    console.log('[booruService] 黑名单标签已更新:', id);
    emitBooruBlacklistTagsChanged({
      action: 'updated',
      siteId: existing.siteId ?? null,
      blacklistTagId: id,
      tagName: updates.tagName ?? existing.tagName,
      isActive: updates.isActive !== undefined ? updates.isActive : Boolean(existing.isActive),
      affectedCount: result.changes,
    });
  } catch (error) {
    console.error('[booruService] 更新黑名单标签失败:', error);
    throw error;
  }
}

/**
 * 删除黑名单标签
 */
export async function removeBlacklistedTag(id: number): Promise<void> {
  console.log('[booruService] 删除黑名单标签:', id);
  try {
    const db = await getDatabase();
    const existing = await get<any>(db, 'SELECT * FROM booru_blacklisted_tags WHERE id = ?', [id]);
    const result = await runWithChanges(db, 'DELETE FROM booru_blacklisted_tags WHERE id = ?', [id]);
    console.log('[booruService] 黑名单标签已删除:', id);
    if (existing) {
      emitBooruBlacklistTagsChanged({
        action: 'deleted',
        siteId: existing.siteId ?? null,
        blacklistTagId: id,
        tagName: existing.tagName,
        affectedCount: result.changes,
      });
    }
  } catch (error) {
    console.error('[booruService] 删除黑名单标签失败:', error);
    throw error;
  }
}

// ========= 收藏夹分组 =========

/**
 * 获取收藏夹分组列表
 */
export async function getFavoriteGroups(siteId?: number): Promise<any[]> {
  const db = await getDatabase();
  const sql = siteId != null
    ? 'SELECT * FROM booru_favorite_groups WHERE siteId = ? OR siteId IS NULL ORDER BY sortOrder ASC, name ASC'
    : 'SELECT * FROM booru_favorite_groups ORDER BY sortOrder ASC, name ASC';
  const params = siteId != null ? [siteId] : [];
  return all(db, sql, params);
}

/**
 * 创建收藏夹分组
 */
export async function createFavoriteGroup(name: string, siteId?: number, color?: string): Promise<any> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  await run(db,
    'INSERT INTO booru_favorite_groups (name, siteId, color, sortOrder, createdAt) VALUES (?, ?, ?, 0, ?)',
    [name, siteId ?? null, color ?? null, now]
  );
  const group = await get<any>(db, 'SELECT * FROM booru_favorite_groups WHERE name = ? ORDER BY createdAt DESC LIMIT 1', [name]);
  if (group) {
    emitBooruFavoriteGroupsChanged({
      action: 'created',
      siteId: group.siteId ?? null,
      groupId: group.id,
      affectedCount: 1,
    });
  }
  return group;
}

/**
 * 更新收藏夹分组
 */
export async function updateFavoriteGroup(id: number, updates: { name?: string; color?: string }): Promise<void> {
  const db = await getDatabase();
  const existing = await get<any>(db, 'SELECT id, siteId FROM booru_favorite_groups WHERE id = ?', [id]);
  const sets: string[] = [];
  const params: any[] = [];
  if (updates.name != null) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.color != null) { sets.push('color = ?'); params.push(updates.color); }
  if (sets.length === 0) return;
  params.push(id);
  const result = await runWithChanges(db, `UPDATE booru_favorite_groups SET ${sets.join(', ')} WHERE id = ?`, params);
  if (result.changes > 0 && existing) {
    emitBooruFavoriteGroupsChanged({
      action: 'updated',
      siteId: existing.siteId ?? null,
      groupId: id,
      affectedCount: result.changes,
    });
  }
}

/**
 * 删除收藏夹分组（不删除收藏，将收藏移到未分组）
 */
export async function deleteFavoriteGroup(id: number): Promise<void> {
  const db = await getDatabase();
  const existing = await get<any>(db, 'SELECT id, siteId FROM booru_favorite_groups WHERE id = ?', [id]);
  await run(db, 'UPDATE booru_favorites SET groupId = NULL WHERE groupId = ?', [id]);
  const result = await runWithChanges(db, 'DELETE FROM booru_favorite_groups WHERE id = ?', [id]);
  if (result.changes > 0 && existing) {
    emitBooruFavoriteGroupsChanged({
      action: 'deleted',
      siteId: existing.siteId ?? null,
      groupId: id,
      affectedCount: result.changes,
    });
  }
}

/**
 * 将收藏移入分组（groupId 为 null 表示移出分组）
 */
export async function moveFavoriteToGroup(siteId: number, apiPostId: number, groupId: number | null): Promise<void> {
  const db = await getDatabase();
  if (groupId != null) {
    const group = await get<{ id: number; siteId: number | null }>(
      db,
      'SELECT id, siteId FROM booru_favorite_groups WHERE id = ?',
      [groupId],
    );
    if (!group) {
      throw new Error('收藏分组不存在');
    }
    if (group.siteId != null && group.siteId !== siteId) {
      throw new Error('收藏分组不属于当前站点');
    }
  }
  // booru_favorites.postId 存储 booru_posts.id，需先查找数据库主键
  const dbPost = await get<{ id: number; siteId: number }>(
    db,
    'SELECT id, siteId FROM booru_posts WHERE postId = ? AND siteId = ?',
    [apiPostId, siteId],
  );
  if (dbPost) {
    const favorite = await get<{ id: number }>(db, 'SELECT id FROM booru_favorites WHERE postId = ?', [dbPost.id]);
    const result = await runWithChanges(db, 'UPDATE booru_favorites SET groupId = ? WHERE postId = ?', [groupId, dbPost.id]);
    if (result.changes > 0) {
      emitBooruFavoriteGroupsChanged({
        action: 'favoriteMoved',
        siteId: dbPost.siteId,
        groupId,
        postId: apiPostId,
        favoriteId: favorite?.id,
        affectedCount: result.changes,
      });
      emitBooruPostFavoriteChanged({
        action: 'moved',
        siteId: dbPost.siteId,
        postId: apiPostId,
        dbPostId: dbPost.id,
        groupId,
        favoriteId: favorite?.id,
        isFavorited: true,
        affectedCount: result.changes,
      });
    }
  }
}

// ========= 保存的搜索 =========

/**
 * 获取保存的搜索列表
 */
export async function getSavedSearches(siteId?: number | null): Promise<any[]> {
  const db = await getDatabase();
  const sql = siteId != null
    ? 'SELECT * FROM booru_saved_searches WHERE siteId = ? ORDER BY createdAt DESC'
    : 'SELECT * FROM booru_saved_searches ORDER BY createdAt DESC';
  const params = siteId != null ? [siteId] : [];
  return all(db, sql, params);
}

/**
 * 添加保存的搜索
 */
export async function addSavedSearch(siteId: number | null, name: string, query: string): Promise<number> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  await run(db,
    'INSERT INTO booru_saved_searches (siteId, name, query, createdAt) VALUES (?, ?, ?, ?)',
    [siteId, name, query, now]
  );
  const row = await get<{ id: number }>(db, 'SELECT last_insert_rowid() as id');
  const id = row?.id ?? 0;
  emitBooruSavedSearchesChanged({
    action: 'created',
    siteId,
    searchId: id,
    affectedCount: 1,
  });
  return id;
}

/**
 * 更新保存的搜索
 */
export async function updateSavedSearch(id: number, updates: { name?: string; query?: string; siteId?: number | null }): Promise<void> {
  const db = await getDatabase();
  const existing = await get<any>(db, 'SELECT id, siteId FROM booru_saved_searches WHERE id = ?', [id]);
  const sets: string[] = [];
  const params: any[] = [];
  if (updates.name != null) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.query != null) { sets.push('query = ?'); params.push(updates.query); }
  if (updates.siteId !== undefined) { sets.push('siteId = ?'); params.push(updates.siteId); }
  if (sets.length === 0) return;
  params.push(id);
  const result = await runWithChanges(db, `UPDATE booru_saved_searches SET ${sets.join(', ')} WHERE id = ?`, params);
  if (result.changes > 0 && existing) {
    const previousSiteId = existing.siteId ?? null;
    const nextSiteId = updates.siteId !== undefined ? updates.siteId : previousSiteId;
    emitBooruSavedSearchesChanged({
      action: 'updated',
      siteId: nextSiteId,
      searchId: id,
      affectedCount: result.changes,
      // 跨站点移动时附带原站点 id，让仅订阅原站点的页面也能感知该搜索已被移走并刷新
      ...(previousSiteId !== nextSiteId ? { previousSiteId } : {}),
    });
  }
}

/**
 * 删除保存的搜索
 */
export async function deleteSavedSearch(id: number): Promise<void> {
  const db = await getDatabase();
  const existing = await get<any>(db, 'SELECT id, siteId FROM booru_saved_searches WHERE id = ?', [id]);
  const result = await runWithChanges(db, 'DELETE FROM booru_saved_searches WHERE id = ?', [id]);
  if (result.changes > 0 && existing) {
    emitBooruSavedSearchesChanged({
      action: 'deleted',
      siteId: existing.siteId ?? null,
      searchId: id,
      affectedCount: result.changes,
    });
  }
}

// ========= 批量导出 =========

export default {
  // 站点管理
  getBooruSites,
  getBooruSiteById,
  getActiveBooruSite,
  addBooruSite,
  updateBooruSite,
  deleteBooruSite,
  setActiveBooruSite,

  // 图片记录管理
  saveBooruPost,
  getBooruPosts,
  getBooruPostById,
  searchBooruPosts,
  markPostAsDownloaded,

  // 收藏管理
  addToFavorites,
  removeFromFavorites,
  getFavorites,
  startFavoritesBulkDownload,
  isFavorited,
  setPostLiked,
  syncPostLikedStates,
  votePost,

  // 下载队列管理
  addToDownloadQueue,
  getDownloadQueue,
  updateDownloadProgress,
  updateDownloadStatus,
  removeFromDownloadQueue,

  // 标签管理
  extractTagsByCategory,
  saveBooruTags,
  searchBooruTags,

  // 收藏标签管理
  addFavoriteTag,
  addFavoriteTagsBatch,
  getFavoriteTags,
  updateFavoriteTag,
  removeFavoriteTag,
  isFavoriteTag,
  removeFavoriteTagByName,

  // 收藏标签分组
  getFavoriteTagLabels,
  addFavoriteTagLabel,
  removeFavoriteTagLabel,

  // 搜索历史
  addSearchHistory,
  getSearchHistory,
  clearSearchHistory,

  // 黑名单标签管理
  addBlacklistedTag,
  addBlacklistedTags,
  getBlacklistedTags,
  getActiveBlacklistTagNames,
  toggleBlacklistedTag,
  updateBlacklistedTag,
  removeBlacklistedTag,

  // 站点快捷查询（alias）
  getSite: getBooruSiteById,

  // 收藏夹分组
  getFavoriteGroups,
  createFavoriteGroup,
  updateFavoriteGroup,
  deleteFavoriteGroup,
  moveFavoriteToGroup,

  // 保存的搜索
  getSavedSearches,
  addSavedSearch,
  updateSavedSearch,
  deleteSavedSearch
};

