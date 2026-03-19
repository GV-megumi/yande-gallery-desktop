import {
  BooruSite,
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
  BulkDownloadSessionStatus,
  FavoriteTagDownloadDisplayStatus,
} from '../../shared/types.js';
import { getDatabase, run, runWithChanges, get, all, runInTransaction } from './database.js';
import { createGallery, getGallery, updateGalleryStats } from './galleryService.js';
import { scanAndImportFolder } from './imageService.js';

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
  return status === 'pending' || status === 'dryRun' || status === 'running' || status === 'paused' || status === 'suspended';
}

function isFavoriteTagDownloadDisplayStatus(status?: string | null): status is FavoriteTagDownloadDisplayStatus {
  return !!status && [
    'pending',
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

async function getGallerySnapshotById(id: number): Promise<{ id: number; name: string; folderPath: string } | null> {
  const db = await getDatabase();
  const row = await get<{ id: number; name: string; folderPath: string }>(
    db,
    'SELECT id, name, folderPath FROM galleries WHERE id = ?',
    [id]
  );

  return row || null;
}

async function findGalleryByFolderPath(folderPath: string): Promise<{ id: number; name: string; folderPath: string } | null> {
  const db = await getDatabase();
  const row = await get<{ id: number; name: string; folderPath: string }>(
    db,
    'SELECT id, name, folderPath FROM galleries WHERE folderPath = ?',
    [folderPath]
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

async function syncGalleryAfterDownload(galleryId: number, downloadPath: string): Promise<void> {
  const scanResult = await scanAndImportFolder(downloadPath);
  if (!scanResult.success) {
    throw new Error(scanResult.error || '图集同步扫描失败');
  }

  const galleryResult = await getGallery(galleryId);
  if (!galleryResult.success || !galleryResult.data) {
    throw new Error(galleryResult.error || '图集不存在');
  }

  const imageCount = scanResult.data ? scanResult.data.imported + scanResult.data.skipped : galleryResult.data.imageCount;
  const updateResult = await updateGalleryStats(galleryId, imageCount, new Date().toISOString());
  if (!updateResult.success) {
    throw new Error(updateResult.error || '更新图集统计失败');
  }
}

async function updateBulkDownloadSessionOrigin(sessionId: string, originType: 'favoriteTag', originId: number): Promise<void> {
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
export async function getBooruSites(): Promise<BooruSite[]> {
  console.log('[booruService] 获取所有Booru站点');
  try {
    const db = await getDatabase();
    const sites = await all<BooruSite>(
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
export async function getBooruSiteById(id: number): Promise<BooruSite | null> {
  console.log('[booruService] 获取Booru站点:', id);
  try {
    const db = await getDatabase();
    const site = await get<BooruSite>(
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
export async function getActiveBooruSite(): Promise<BooruSite | null> {
  console.log('[booruService] 获取激活的Booru站点');
  try {
    const db = await getDatabase();
    const site = await get<BooruSite>(
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
export async function addBooruSite(site: Omit<BooruSite, 'id' | 'createdAt' | 'updatedAt'>): Promise<number> {
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
export async function updateBooruSite(id: number, updates: Partial<BooruSite>): Promise<void> {
  console.log('[booruService] 更新Booru站点:', id, updates);
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();

    const fields = [];
    const values = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.url !== undefined) {
      fields.push('url = ?');
      values.push(updates.url);
    }
    if (updates.type !== undefined) {
      fields.push('type = ?');
      values.push(updates.type);
    }
    if (updates.salt !== undefined) {
      fields.push('salt = ?');
      values.push(updates.salt);
    }
    if (updates.version !== undefined) {
      fields.push('version = ?');
      values.push(updates.version);
    }
    if (updates.apiKey !== undefined) {
      fields.push('apiKey = ?');
      values.push(updates.apiKey);
    }
    if (updates.username !== undefined) {
      fields.push('username = ?');
      values.push(updates.username);
    }
    if (updates.passwordHash !== undefined) {
      fields.push('passwordHash = ?');
      values.push(updates.passwordHash);
    }
    if (updates.favoriteSupport !== undefined) {
      fields.push('favoriteSupport = ?');
      values.push(updates.favoriteSupport ? 1 : 0);
    }
    if (updates.active !== undefined) {
      fields.push('active = ?');
      values.push(updates.active ? 1 : 0);
    }

    if (fields.length === 0) {
      console.warn('[booruService] 没有需要更新的字段');
      return;
    }

    fields.push('updatedAt = ?');
    values.push(now);
    values.push(id);

    await run(db, `UPDATE booru_sites SET ${fields.join(', ')} WHERE id = ?`, values);

    console.log('[booruService] 更新站点成功:', id);
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
    await run(db, 'DELETE FROM booru_sites WHERE id = ?', [id]);
    console.log('[booruService] 删除站点成功:', id);
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

    // 使用事务确保两步操作的原子性
    await run(db, 'BEGIN TRANSACTION');
    try {
      await run(db, 'UPDATE booru_sites SET active = 0');
      await run(db, 'UPDATE booru_sites SET active = 1 WHERE id = ?', [id]);
      await run(db, 'COMMIT');
    } catch (txError) {
      await run(db, 'ROLLBACK');
      throw txError;
    }

    console.log('[booruService] 设置激活站点成功:', id);
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

    await run(db, `
      UPDATE booru_posts
      SET downloaded = 1, localPath = ?, localImageId = ?, updatedAt = ?
      WHERE id = ?
    `, [localPath, localImageId || null, now, postId]);

    console.log('[booruService] 标记下载成功:', postId);
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
      return existing.id;
    }

    // 使用事务确保 INSERT + UPDATE 的原子性
    await run(db, 'BEGIN TRANSACTION');
    try {
      await run(db, `
        INSERT OR IGNORE INTO booru_favorites (postId, siteId, notes, createdAt)
        VALUES (?, ?, ?, ?)
      `, [dbId, siteId, notes || null, now]);

      await run(db, 'UPDATE booru_posts SET isFavorited = 1 WHERE id = ?', [dbId]);

      await run(db, 'COMMIT');
    } catch (txError) {
      await run(db, 'ROLLBACK');
      throw txError;
    }

    const result = await get<{ id: number }>(db, 'SELECT last_insert_rowid() as id');
    const favoriteId = result!.id;

    console.log('[booruService] 添加收藏成功:', apiPostId);
    return favoriteId;
  } catch (error) {
    console.error('[booruService] 添加收藏失败:', apiPostId, error);
    throw error;
  }
}

/**
 * 从收藏中移除
 */
export async function removeFromFavorites(apiPostId: number): Promise<void> {
  console.log('[booruService] 从收藏中移除:', apiPostId);
  try {
    const db = await getDatabase();

    // 查找 booru_posts 的数据库主键
    const dbPost = await get<{ id: number }>(
      db,
      'SELECT id FROM booru_posts WHERE postId = ?',
      [apiPostId]
    );
    if (dbPost) {
      await run(db, 'DELETE FROM booru_favorites WHERE postId = ?', [dbPost.id]);
      await run(db, 'UPDATE booru_posts SET isFavorited = 0 WHERE id = ?', [dbPost.id]);
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
export async function getFavorites(siteId: number, page: number = 1, limit: number = 20, groupId?: number | null): Promise<any[]> {
  console.log('[booruService] 获取收藏列表:', { siteId, page, limit, groupId });
  try {
    const db = await getDatabase();
    const offset = (page - 1) * limit;

    // 构建 groupId 过滤条件
    let groupFilter = '';
    const params: any[] = [siteId];
    if (groupId === null) {
      // null = 未分组
      groupFilter = 'AND f.groupId IS NULL';
    } else if (groupId != null) {
      groupFilter = 'AND f.groupId = ?';
      params.push(groupId);
    }
    params.push(limit, offset);

    const posts = await all<any>(
      db,
      `
        SELECT p.*, f.groupId as favoriteGroupId FROM booru_posts p
        INNER JOIN booru_favorites f ON p.id = f.postId
        WHERE f.siteId = ? ${groupFilter}
        ORDER BY f.createdAt DESC
        LIMIT ? OFFSET ?
      `,
      params
    );

    // 转换布尔值
    const result = posts.map(post => ({
      ...post,
      downloaded: Boolean(post.downloaded),
      isFavorited: Boolean(post.isFavorited)
    }));

    console.log('[booruService] 获取到', result.length, '个收藏');
    return result;
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
export async function setPostLiked(siteId: number, apiPostId: number, liked: boolean): Promise<void> {
  try {
    const db = await getDatabase();
    await run(db, 'UPDATE booru_posts SET isLiked = ? WHERE siteId = ? AND postId = ?', [liked ? 1 : 0, siteId, apiPostId]);
  } catch (error) {
    console.error('[booruService] 设置喜欢状态失败:', apiPostId, error);
  }
}

// ========= 下载队列管理 =========

/**
 * 添加到下载队列
 */
export async function addToDownloadQueue(postId: number, siteId: number, priority: number = 0, targetPath?: string): Promise<number> {
  console.log('[booruService] 添加到下载队列:', postId);
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();

    // 检查是否已在队列中（包括失败的任务）
    const existing = await get<{ id: number; status: string }>(
      db,
      'SELECT id, status FROM booru_download_queue WHERE postId = ? AND siteId = ?',
      [postId, siteId]
    );

    if (existing) {
      if (existing.status === 'failed') {
        console.log('[booruService] 重试失败的下载任务:', existing.id);
        await run(db, 'UPDATE booru_download_queue SET status = "pending", priority = ?, targetPath = ?, updatedAt = ?, errorMessage = NULL WHERE id = ?', 
          [priority, targetPath || null, now, existing.id]);
        return existing.id;
      } else if (existing.status === 'completed') {
         console.log('[booruService] 任务已完成，重新下载:', existing.id);
         await run(db, 'UPDATE booru_download_queue SET status = "pending", priority = ?, targetPath = ?, updatedAt = ?, errorMessage = NULL, progress = 0, downloadedBytes = 0 WHERE id = ?',
           [priority, targetPath || null, now, existing.id]);
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
    `, [postId, siteId, priority, targetPath || null, now, now]);

    const result = await get<{ id: number }>(db, 'SELECT last_insert_rowid() as id');
    const queueId = result!.id;

    console.log('[booruService] 添加下载队列成功:', queueId);
    return queueId;
  } catch (error) {
    console.error('[booruService] 添加下载队列失败:', postId, error);
    throw error;
  }
}

/**
 * 获取下载队列
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

    await run(db, sql, updates);
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
    await run(db, 'DELETE FROM booru_download_queue WHERE id = ?', [id]);
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
    return result.changes;
  } catch (error) {
    console.error('[booruService] 清空下载记录失败:', status, error);
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
 * 获取收藏标签列表
 * @param siteId 站点ID（不传则获取全部）
 */
export async function getFavoriteTags(siteId?: number | null): Promise<FavoriteTag[]> {
  console.log('[booruService] 获取收藏标签列表, siteId:', siteId);
  try {
    const db = await getDatabase();
    let sql = 'SELECT * FROM booru_favorite_tags';
    const params: any[] = [];

    if (siteId !== undefined) {
      if (siteId === null) {
        sql += ' WHERE siteId IS NULL';
      } else {
        sql += ' WHERE siteId = ? OR siteId IS NULL';
        params.push(siteId);
      }
    }

    sql += ' ORDER BY sortOrder ASC, createdAt DESC';

    const rows = await all<any>(db, sql, params);

    // 解析 labels JSON
    const tags: FavoriteTag[] = rows.map(row => ({
      ...row,
      labels: row.labels ? JSON.parse(row.labels) : undefined
    }));

    console.log('[booruService] 获取到', tags.length, '个收藏标签');
    return tags;
  } catch (error) {
    console.error('[booruService] 获取收藏标签列表失败:', error);
    throw error;
  }
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
  const favoriteTags = await getFavoriteTags(siteId);
  const favoriteTagLabels = await getFavoriteTagLabels();
  return { favoriteTags, favoriteTagLabels };
}

export async function importFavoriteTags(payload: {
  favoriteTags?: Array<{
    siteId?: number | null;
    tagName: string;
    labels?: string[];
    queryType?: 'tag' | 'raw' | 'list';
    notes?: string;
  }>;
  favoriteTagLabels?: Array<{ name: string; color?: string }>;
}): Promise<{ importedTags: number; importedLabels: number; skippedTags: number }> {
  const labels = payload.favoriteTagLabels || [];
  const tags = payload.favoriteTags || [];

  let importedLabels = 0;
  let importedTags = 0;
  let skippedTags = 0;

  const existingLabels = await getFavoriteTagLabels();
  const existingLabelNames = new Set(existingLabels.map(label => label.name));

  for (const label of labels) {
    if (!label.name || existingLabelNames.has(label.name)) {
      continue;
    }
    await addFavoriteTagLabel(label.name, label.color);
    existingLabelNames.add(label.name);
    importedLabels += 1;
  }

  for (const tag of tags) {
    try {
      const exists = await isFavoriteTag(tag.siteId ?? null, tag.tagName);
      if (exists) {
        skippedTags += 1;
        continue;
      }

      await addFavoriteTag(tag.siteId ?? null, tag.tagName, {
        labels: tag.labels,
        queryType: tag.queryType,
        notes: tag.notes,
      });
      importedTags += 1;
    } catch {
      skippedTags += 1;
    }
  }

  return { importedTags, importedLabels, skippedTags };
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

    if (!input.downloadPath?.trim()) {
      throw new Error('下载目录不能为空');
    }

    if (favoriteTag.queryType !== 'tag') {
      throw new Error('当前仅支持 queryType=tag 的收藏标签进行一键下载');
    }

    if (input.galleryId !== undefined && input.galleryId !== null) {
      const gallery = await getGallerySnapshotById(input.galleryId);
      if (!gallery) {
        throw new Error('绑定的图集不存在');
      }
      if (gallery.folderPath !== input.downloadPath) {
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
        input.downloadPath,
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
        input.downloadPath,
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
    await run(db, 'DELETE FROM booru_favorite_tag_download_bindings WHERE favoriteTagId = ?', [favoriteTagId]);
  } catch (error) {
    console.error('[booruService] 删除收藏标签下载绑定失败:', favoriteTagId, error);
    throw error;
  }
}

export async function getFavoriteTagsWithDownloadState(siteId?: number | null): Promise<FavoriteTagWithDownloadState[]> {
  console.log('[booruService] 获取收藏标签及下载状态, siteId:', siteId);
  try {
    const tags = await getFavoriteTags(siteId);
    if (tags.length === 0) {
      return [];
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
    const galleriesById = new Map<number, { id: number; folderPath: string; name: string }>();
    if (galleryIds.length > 0) {
      const galleryPlaceholders = galleryIds.map(() => '?').join(',');
      const galleries = await all<{ id: number; folderPath: string; name: string }>(db, `
        SELECT id, folderPath, name
        FROM galleries
        WHERE id IN (${galleryPlaceholders})
      `, galleryIds);

      for (const gallery of galleries) {
        galleriesById.set(gallery.id, gallery);
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

    for (const row of bindingRows) {
      if (!row.lastSessionId) {
        continue;
      }

      let snapshot = sessionSnapshotMap.get(row.lastSessionId) ?? undefined;
      if (!snapshot) {
        const loadedSnapshot = await getBulkDownloadSessionSnapshot(row.lastSessionId);
        snapshot = loadedSnapshot ?? undefined;
        if (snapshot) {
          sessionSnapshotMap.set(row.lastSessionId, snapshot);
        }
      }

      if (!snapshot) {
        continue;
      }

      if (!isActiveBulkDownloadStatus(snapshot.status) && (row.lastStatus !== snapshot.status || row.lastCompletedAt !== (snapshot.completedAt ?? null))) {
        await updateFavoriteTagDownloadBindingSnapshot(row.favoriteTagId, {
          lastStatus: snapshot.status,
          lastCompletedAt: snapshot.completedAt ?? null,
        });
        row.lastStatus = snapshot.status;
        row.lastCompletedAt = snapshot.completedAt ?? null;
      }
    }

    for (const tag of tags) {
      const bindingRow = bindingMap.get(tag.id);
      const binding = parseFavoriteTagDownloadBinding(bindingRow);
      if (!binding) {
        continue;
      }

      await syncFavoriteTagDownloadTerminalState(tag.id, binding);

      const refreshedRow = await get<FavoriteTagDownloadBindingRow>(db, `
        SELECT b.*, g.name as galleryName
        FROM booru_favorite_tag_download_bindings b
        LEFT JOIN galleries g ON g.id = b.galleryId
        WHERE b.favoriteTagId = ?
      `, [tag.id]);

      if (refreshedRow) {
        bindingMap.set(tag.id, refreshedRow);
      }
    }

    return tags.map(tag => {
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
        } else if (gallery.folderPath !== binding.downloadPath) {
          galleryBindingConsistent = false;
          galleryBindingMismatchReason = 'pathMismatch';
        } else {
          galleryBindingConsistent = true;
        }
      }

      return {
        ...tag,
        downloadBinding: binding,
        runtimeProgress: runtime,
        galleryName: bindingRow?.galleryName ?? null,
        galleryBindingConsistent,
        galleryBindingMismatchReason,
      };
    });
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
  const sourceTags = await getFavoriteTagsWithDownloadState(undefined);
  return sourceTags.filter(tag => tag.downloadBinding?.galleryId === galleryId);
}

export async function startFavoriteTagBulkDownload(favoriteTagId: number): Promise<{ taskId: string; sessionId: string }> {
  console.log('[booruService] 启动收藏标签批量下载:', favoriteTagId);
  const favoriteTag = await getFavoriteTagById(favoriteTagId);
  if (!favoriteTag) {
    throw new Error('收藏标签不存在');
  }

  const binding = await getFavoriteTagDownloadBinding(favoriteTagId);
  if (!binding || !binding.enabled) {
    throw new Error('当前收藏标签尚未配置下载');
  }

  if (favoriteTag.queryType !== 'tag') {
    await updateFavoriteTagDownloadBindingSnapshot(favoriteTagId, { lastStatus: 'validationError' });
    throw new Error('当前仅支持 queryType=tag 的收藏标签进行一键下载');
  }

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
    if (gallery.folderPath !== binding.downloadPath) {
      await updateFavoriteTagDownloadBindingSnapshot(favoriteTagId, { lastStatus: 'validationError' });
      throw new Error('下载目录必须与绑定图集的文件夹路径一致');
    }
  }

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

  const bulkDownloadService = await import('./bulkDownloadService.js');
  const taskResult = await bulkDownloadService.createBulkDownloadTask({
    siteId: favoriteTag.siteId,
    path: binding.downloadPath,
    tags: [favoriteTag.tagName],
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

  const startResult = await bulkDownloadService.startBulkDownloadSession(sessionId);
  if (!startResult.success) {
    await updateFavoriteTagDownloadBindingSnapshot(favoriteTagId, {
      lastTaskId: taskId,
      lastSessionId: sessionId,
      lastStatus: 'failed',
    });
    throw new Error(startResult.error || '启动批量下载会话失败');
  }

  const runtime = await getRuntimeProgressBySessionId(sessionId);
  await updateFavoriteTagDownloadBindingSnapshot(favoriteTagId, {
    lastTaskId: taskId,
    lastSessionId: sessionId,
    lastStartedAt: new Date().toISOString(),
    lastStatus: runtime?.status || 'running',
  });

  return { taskId, sessionId };
}

/**
 * 更新收藏标签
 */
export async function updateFavoriteTag(id: number, updates: Partial<Pick<FavoriteTag, 'tagName' | 'labels' | 'queryType' | 'notes' | 'sortOrder'>>): Promise<void> {
  console.log('[booruService] 更新收藏标签:', id, updates);
  try {
    const db = await getDatabase();
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

    if (fields.length === 0) {
      console.warn('[booruService] 没有需要更新的字段');
      return;
    }

    fields.push('updatedAt = ?');
    values.push(now);
    values.push(id);

    await run(db, `UPDATE booru_favorite_tags SET ${fields.join(', ')} WHERE id = ?`, values);
    console.log('[booruService] 更新收藏标签成功:', id);
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
    await run(db, 'DELETE FROM booru_favorite_tags WHERE id = ?', [id]);
    console.log('[booruService] 删除收藏标签成功:', id);
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
    if (siteId) {
      await run(db, 'DELETE FROM booru_search_history WHERE siteId = ?', [siteId]);
    } else {
      await run(db, 'DELETE FROM booru_search_history');
    }
    console.log('[booruService] 搜索历史已清除');
  } catch (error) {
    console.error('[booruService] 清除搜索历史失败:', error);
    throw error;
  }
}

// ========= 黑名单标签管理 =========

/**
 * 添加黑名单标签
 */
export async function addBlacklistedTag(tagName: string, siteId?: number | null, reason?: string): Promise<BlacklistedTag> {
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
    return {
      ...inserted,
      isActive: Boolean(inserted.isActive)
    };
  } catch (error) {
    console.error('[booruService] 添加黑名单标签失败:', error);
    throw error;
  }
}

/**
 * 批量添加黑名单标签（支持换行分隔的字符串）
 */
export async function addBlacklistedTags(tagString: string, siteId?: number | null, reason?: string): Promise<{ added: number; skipped: number }> {
  console.log('[booruService] 批量添加黑名单标签');
  const tags = tagString.split('\n').map(t => t.trim()).filter(t => t.length > 0);
  let added = 0;
  let skipped = 0;

  for (const tag of tags) {
    try {
      await addBlacklistedTag(tag, siteId, reason);
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

  console.log('[booruService] 批量添加完成:', { added, skipped });
  return { added, skipped };
}

/**
 * 获取黑名单标签列表
 * @param siteId 站点 ID（可选，不传则获取全部）
 */
export async function getBlacklistedTags(siteId?: number | null): Promise<BlacklistedTag[]> {
  console.log('[booruService] 获取黑名单标签列表, siteId:', siteId);
  try {
    const db = await getDatabase();
    let sql = 'SELECT * FROM booru_blacklisted_tags';
    const params: any[] = [];

    if (siteId !== undefined && siteId !== null) {
      sql += ' WHERE siteId = ? OR siteId IS NULL';
      params.push(siteId);
    }

    sql += ' ORDER BY createdAt DESC';
    const tags = await all<any>(db, sql, params);

    const result = tags.map((tag: any) => ({
      ...tag,
      isActive: Boolean(tag.isActive)
    }));

    console.log('[booruService] 获取到', result.length, '个黑名单标签');
    return result;
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
    await run(db,
      'UPDATE booru_blacklisted_tags SET isActive = ?, updatedAt = ? WHERE id = ?',
      [newIsActive, now, id]
    );

    console.log('[booruService] 黑名单标签状态已切换:', id, '->', newIsActive);
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
    await run(db, `UPDATE booru_blacklisted_tags SET ${setClauses.join(', ')} WHERE id = ?`, params);
    console.log('[booruService] 黑名单标签已更新:', id);
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
    await run(db, 'DELETE FROM booru_blacklisted_tags WHERE id = ?', [id]);
    console.log('[booruService] 黑名单标签已删除:', id);
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
  return get(db, 'SELECT * FROM booru_favorite_groups WHERE name = ? ORDER BY createdAt DESC LIMIT 1', [name]);
}

/**
 * 更新收藏夹分组
 */
export async function updateFavoriteGroup(id: number, updates: { name?: string; color?: string }): Promise<void> {
  const db = await getDatabase();
  const sets: string[] = [];
  const params: any[] = [];
  if (updates.name != null) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.color != null) { sets.push('color = ?'); params.push(updates.color); }
  if (sets.length === 0) return;
  params.push(id);
  await run(db, `UPDATE booru_favorite_groups SET ${sets.join(', ')} WHERE id = ?`, params);
}

/**
 * 删除收藏夹分组（不删除收藏，将收藏移到未分组）
 */
export async function deleteFavoriteGroup(id: number): Promise<void> {
  const db = await getDatabase();
  await run(db, 'UPDATE booru_favorites SET groupId = NULL WHERE groupId = ?', [id]);
  await run(db, 'DELETE FROM booru_favorite_groups WHERE id = ?', [id]);
}

/**
 * 将收藏移入分组（groupId 为 null 表示移出分组）
 */
export async function moveFavoriteToGroup(apiPostId: number, groupId: number | null): Promise<void> {
  const db = await getDatabase();
  // booru_favorites.postId 存储 booru_posts.id，需先查找数据库主键
  const dbPost = await get<{ id: number }>(db, 'SELECT id FROM booru_posts WHERE postId = ?', [apiPostId]);
  if (dbPost) {
    await run(db, 'UPDATE booru_favorites SET groupId = ? WHERE postId = ?', [groupId, dbPost.id]);
  }
}

// ========= 保存的搜索 =========

/**
 * 获取保存的搜索列表
 */
export async function getSavedSearches(siteId?: number): Promise<any[]> {
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
  return row?.id ?? 0;
}

/**
 * 更新保存的搜索
 */
export async function updateSavedSearch(id: number, updates: { name?: string; query?: string }): Promise<void> {
  const db = await getDatabase();
  const sets: string[] = [];
  const params: any[] = [];
  if (updates.name != null) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.query != null) { sets.push('query = ?'); params.push(updates.query); }
  if (sets.length === 0) return;
  params.push(id);
  await run(db, `UPDATE booru_saved_searches SET ${sets.join(', ')} WHERE id = ?`, params);
}

/**
 * 删除保存的搜索
 */
export async function deleteSavedSearch(id: number): Promise<void> {
  const db = await getDatabase();
  await run(db, 'DELETE FROM booru_saved_searches WHERE id = ?', [id]);
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
  isFavorited,
  setPostLiked,

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

