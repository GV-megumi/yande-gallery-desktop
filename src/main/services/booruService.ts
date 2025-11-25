import { BooruSite, BooruPost, BooruTag, BooruFavorite, DownloadQueueItem, SearchHistoryItem } from '../../shared/types.js';
import { getDatabase, run, get, all } from './database.js';

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

    await run(db, 'UPDATE booru_sites SET active = 0');
    await run(db, 'UPDATE booru_sites SET active = 1 WHERE id = ?', [id]);

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
  console.log('[booruService] 根据站点和ID获取Booru图片:', { siteId, postId });
  try {
    const db = await getDatabase();
    const post = await get<BooruPost>(
      db,
      'SELECT * FROM booru_posts WHERE siteId = ? AND postId = ?',
      [siteId, postId]
    );

    if (!post) {
      console.warn('[booruService] 图片不存在:', { siteId, postId });
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

    await run(db, `
      INSERT OR IGNORE INTO booru_favorites (postId, siteId, notes, createdAt)
      VALUES (?, ?, ?, ?)
    `, [postId, siteId, notes || null, now]);

    // 更新图片的收藏状态
    await run(db, 'UPDATE booru_posts SET isFavorited = 1 WHERE id = ?', [postId]);

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
    await run(db, 'UPDATE booru_posts SET isFavorited = 0 WHERE id = ?', [postId]);

    console.log('[booruService] 移除收藏成功:', postId);
  } catch (error) {
    console.error('[booruService] 移除收藏失败:', postId, error);
    throw error;
  }
}

/**
 * 获取收藏列表
 */
export async function getFavorites(siteId: number, page: number = 1, limit: number = 20): Promise<BooruPost[]> {
  console.log('[booruService] 获取收藏列表:', { siteId, page, limit });
  try {
    const db = await getDatabase();
    const offset = (page - 1) * limit;

    const posts = await all<BooruPost>(
      db,
      `
        SELECT p.* FROM booru_posts p
        INNER JOIN booru_favorites f ON p.id = f.postId
        WHERE p.siteId = ? AND p.isFavorited = 1
        ORDER BY f.createdAt DESC
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

    console.log('[booruService] 获取到', result.length, '个收藏');
    return result;
  } catch (error) {
    console.error('[booruService] 获取收藏列表失败:', error);
    throw error;
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

    for (const tag of tags) {
      await run(db, `
        INSERT OR REPLACE INTO booru_tags (siteId, name, category, postCount, createdAt)
        VALUES (?, ?, ?, ?, ?)
      `, [siteId, tag.name, tag.category || null, tag.postCount || 0, now]);
    }

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
  searchBooruTags
};

