import { BooruSite, BooruPost, BooruTag, BooruFavorite, DownloadQueueItem, SearchHistoryItem, FavoriteTag, FavoriteTagLabel, BlacklistedTag } from '../../shared/types.js';
import { getDatabase, run, runWithChanges, get, all, runInTransaction } from './database.js';

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
      const existingPost = await get<{ isFavorited: number }>(
        db,
        'SELECT isFavorited FROM booru_posts WHERE id = ?',
        [existing.id]
      );
      const preserveFavorited = existingPost?.isFavorited || 0;
      
      await run(db, `
        UPDATE booru_posts SET
          md5 = ?, fileUrl = ?, previewUrl = ?, sampleUrl = ?, width = ?, height = ?,
          fileSize = ?, fileExt = ?, rating = ?, score = ?, source = ?, tags = ?,
          downloaded = ?, localPath = ?, localImageId = ?, isFavorited = ?, updatedAt = ?
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
        now,
        postData.siteId,
        postData.postId
      ]);
      return existing.id;
    } else {
      await run(db, `
        INSERT INTO booru_posts
        (siteId, postId, md5, fileUrl, previewUrl, sampleUrl, width, height, fileSize, fileExt,
         rating, score, source, tags, downloaded, localPath, localImageId, isFavorited, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
export async function addToFavorites(postId: number, siteId: number, notes?: string): Promise<number> {
  console.log('[booruService] 添加到收藏:', postId);
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();

    // 检查是否已经收藏
    const existing = await get<{ id: number }>(
      db,
      'SELECT id FROM booru_favorites WHERE postId = ?',
      [postId]
    );

    if (existing) {
      console.log('[booruService] 图片已在收藏中:', postId);
      return existing.id;
    }

    // 使用事务确保 INSERT + UPDATE 的原子性
    await run(db, 'BEGIN TRANSACTION');
    try {
      await run(db, `
        INSERT OR IGNORE INTO booru_favorites (postId, siteId, notes, createdAt)
        VALUES (?, ?, ?, ?)
      `, [postId, siteId, notes || null, now]);

      // 更新图片的收藏状态（postId 是 Moebooru 的 post ID，需要用 postId 列匹配）
      await run(db, 'UPDATE booru_posts SET isFavorited = 1 WHERE postId = ? AND siteId = ?', [postId, siteId]);

      await run(db, 'COMMIT');
    } catch (txError) {
      await run(db, 'ROLLBACK');
      throw txError;
    }

    const result = await get<{ id: number }>(db, 'SELECT last_insert_rowid() as id');
    const favoriteId = result!.id;

    console.log('[booruService] 添加收藏成功:', postId);
    return favoriteId;
  } catch (error) {
    console.error('[booruService] 添加收藏失败:', postId, error);
    throw error;
  }
}

/**
 * 从收藏中移除
 */
export async function removeFromFavorites(postId: number): Promise<void> {
  console.log('[booruService] 从收藏中移除:', postId);
  try {
    const db = await getDatabase();

    await run(db, 'DELETE FROM booru_favorites WHERE postId = ?', [postId]);
    await run(db, 'UPDATE booru_posts SET isFavorited = 0 WHERE postId = ?', [postId]);

    console.log('[booruService] 移除收藏成功:', postId);
  } catch (error) {
    console.error('[booruService] 移除收藏失败:', postId, error);
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
        INNER JOIN booru_favorites f ON p.postId = f.postId AND p.siteId = f.siteId
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
  console.log('[booruService] 检查缺失的收藏帖子数据, siteId:', siteId);
  try {
    const db = await getDatabase();
    const rows = await all<{ postId: number }>(
      db,
      `
        SELECT f.postId FROM booru_favorites f
        LEFT JOIN booru_posts p ON f.postId = p.postId AND f.siteId = p.siteId
        WHERE f.siteId = ? AND p.postId IS NULL
      `,
      [siteId]
    );
    const ids = rows.map(r => r.postId);
    console.log('[booruService] 缺失帖子数据的收藏数量:', ids.length);
    return ids;
  } catch (error) {
    console.error('[booruService] 获取缺失收藏帖子失败:', error);
    return [];
  }
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
    const result = await run(db, `
      UPDATE booru_posts SET isFavorited = 1
      WHERE siteId = ? AND postId IN (
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
export async function isFavorited(postId: number): Promise<boolean> {
  try {
    const db = await getDatabase();
    const result = await get<{ count: number }>(
      db,
      'SELECT COUNT(*) as count FROM booru_favorites WHERE postId = ?',
      [postId]
    );

    return result ? result.count > 0 : false;
  } catch (error) {
    console.error('[booruService] 检查收藏状态失败:', postId, error);
    return false;
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
          INSERT OR REPLACE INTO booru_tags (siteId, name, category, postCount, createdAt)
          VALUES (?, ?, ?, ?, ?)
        `, [siteId, tag.name, tag.category || null, tag.postCount || 0, now]);
      }
    });

    console.log('[booruService] 保存标签成功');
  } catch (error) {
    console.error('[booruService] 保存标签失败:', error);
    throw error;
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
export async function moveFavoriteToGroup(postId: number, groupId: number | null): Promise<void> {
  const db = await getDatabase();
  await run(db, 'UPDATE booru_favorites SET groupId = ? WHERE postId = ?', [groupId, postId]);
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

