import { ipcMain, dialog, IpcMainInvokeEvent, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from './channels.js';
import path from 'path';
import fs from 'fs/promises';
import axios from 'axios';
import { lookup } from 'node:dns/promises';
import { getProxyConfig } from '../services/config.js';
import {
  initDatabase,
  getImages,
  addImage,
  searchImages,
  getImageById,
  deleteImage,
  updateImageTags,
  getAllTags,
  searchTags,
  getRecentImages,
  getImagesByFolder,
  getAllFolders,
  scanAndImportFolder
} from '../services/imageService.js';
import {
  getGalleries,
  getGallery,
  createGallery,
  updateGallery,
  deleteGallery,
  setGalleryCover,
  updateGalleryStats,
  syncGalleryFolder,
  scanSubfoldersAndCreateGalleries
} from '../services/galleryService.js';
import { hashPasswordSHA1 } from '../services/moebooruClient.js';
import { createBooruClient } from '../services/booruClientFactory.js';
import { TAG_TYPE_MAP, RATING_MAP } from '../services/booruClientInterface.js';
import type { BooruForumPostData, BooruForumTopicData, BooruUserProfileData, BooruWikiData } from '../services/booruClientInterface.js';
import * as booruService from '../services/booruService.js';
import { BooruForumPost, BooruForumTopic, BooruPost, BooruSite, BooruSiteRecord, BooruUserProfile, BooruWiki, ConfigChangedSummary, ListQueryParams, FavoriteTagImportRecord, FavoriteTagLabelImportRecord, BlacklistedTagImportRecord } from '../../shared/types.js';
import { getConfig, getBooruAppearancePreference, saveConfig, updateGalleryFolders, reloadConfig, toRendererSafeConfig, type AppShellPagePreference, type BlacklistedTagsPagePreference, type ConfigSaveInput, type FavoriteTagsPagePreference, type GalleryPagePreferencesBySubTab } from '../services/config.js';
import { generateThumbnail, getThumbnailIfExists, deleteThumbnail } from '../services/thumbnailService.js';
import { downloadManager } from '../services/downloadManager.js';
import * as bulkDownloadService from '../services/bulkDownloadService.js';
import * as imageCacheService from '../services/imageCacheService.js';
import { runInTransaction, getDatabase, all, run } from '../services/database.js';
import { createAppBackupData, isValidBackupData, restoreAppBackupData, summarizeBackupTables } from '../services/backupService.js';
import { getImageMetadata } from '../services/imageMetadataService.js';
import {
  reportInvalidImage,
  getInvalidImages,
  getInvalidImageCount,
  deleteInvalidImage,
  clearInvalidImages
} from '../services/invalidImageService.js';
import * as updateService from '../services/updateService.js';

let ipcHandlersRegistered = false;

function toRendererSafeBooruSite(site: BooruSiteRecord | null): BooruSite | null {
  if (!site) {
    return null;
  }

  const { salt: _salt, apiKey: _apiKey, passwordHash: _passwordHash, ...safeSite } = site;
  return {
    ...safeSite,
    authenticated: Boolean(site.username && site.passwordHash),
  };
}

function toRendererSafeBooruSites(sites: BooruSiteRecord[]): BooruSite[] {
  return sites.map((site) => toRendererSafeBooruSite(site)!).filter(Boolean);
}

function toRendererSafeBooruWiki(wiki: BooruWikiData | null): BooruWiki | null {
  if (!wiki) {
    return null;
  }

  return {
    id: wiki.id,
    title: wiki.title,
    body: typeof wiki.body === 'string' ? wiki.body : '',
    otherNames: Array.isArray(wiki.other_names) ? wiki.other_names : [],
    createdAt: wiki.created_at,
    updatedAt: wiki.updated_at,
    isLocked: wiki.is_locked,
    isDeleted: wiki.is_deleted,
  };
}

function toRendererSafeBooruForumTopic(topic: BooruForumTopicData): BooruForumTopic {
  return {
    id: topic.id,
    title: topic.title,
    responseCount: topic.response_count,
    isSticky: topic.is_sticky,
    isLocked: topic.is_locked,
    isHidden: topic.is_hidden,
    categoryId: topic.category_id,
    creatorId: topic.creator_id,
    updaterId: topic.updater_id,
    createdAt: topic.created_at,
    updatedAt: topic.updated_at,
  };
}

function toRendererSafeBooruForumPost(post: BooruForumPostData): BooruForumPost {
  return {
    id: post.id,
    topicId: post.topic_id,
    body: post.body,
    creatorId: post.creator_id,
    updaterId: post.updater_id,
    createdAt: post.created_at,
    updatedAt: post.updated_at,
    isDeleted: post.is_deleted,
    isHidden: post.is_hidden,
  };
}

function toRendererSafeBooruUserProfile(profile: BooruUserProfileData | null): BooruUserProfile | null {
  if (!profile) {
    return null;
  }

  return {
    id: profile.id,
    name: profile.name,
    levelString: profile.level_string,
    createdAt: profile.created_at,
    avatarUrl: profile.avatar_url,
    postUploadCount: profile.post_upload_count,
    postUpdateCount: profile.post_update_count,
    noteUpdateCount: profile.note_update_count,
    commentCount: profile.comment_count,
    forumPostCount: profile.forum_post_count,
    favoriteCount: profile.favorite_count,
    feedbackCount: profile.feedback_count,
  };
}

function isIPv4Literal(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) {
    return false;
  }

  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function isDisallowedIPv4Target(hostname: string): boolean {
  if (!isIPv4Literal(hostname)) {
    return false;
  }

  const [first, second] = hostname.split('.').map(Number);

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function extractMappedIPv4FromIPv6(hostname: string): string | null {
  const normalized = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  const dottedMatch = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dottedMatch) {
    return dottedMatch[1];
  }

  const hexMatch = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hexMatch) {
    return null;
  }

  const first = parseInt(hexMatch[1], 16);
  const second = parseInt(hexMatch[2], 16);
  return [first >> 8, first & 0xff, second >> 8, second & 0xff].join('.');
}

function isDisallowedIPv6Target(hostname: string): boolean {
  const normalized = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  const mappedIPv4 = extractMappedIPv4FromIPv6(normalized);

  if (mappedIPv4 && isDisallowedIPv4Target(mappedIPv4)) {
    return true;
  }

  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
}

function isDisallowedExternalHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    return true;
  }

  return isDisallowedIPv4Target(normalized) || isDisallowedIPv6Target(normalized);
}

async function validateExternalUrl(input: unknown): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (typeof input !== 'string') {
    return { ok: false, error: '链接必须是字符串' };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: '链接不能为空' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: '链接格式无效' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: '仅允许打开 https 链接' };
  }

  if (!parsed.hostname) {
    return { ok: false, error: '链接缺少有效主机名' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: '不允许打开包含账号信息的外部链接' };
  }

  if (isDisallowedExternalHostname(parsed.hostname)) {
    return { ok: false, error: '不允许打开指向本地或内网的外部链接' };
  }

  try {
    const resolved = await lookup(parsed.hostname, { all: true, verbatim: true });
    const records = Array.isArray(resolved) ? resolved : [resolved];
    if (records.some((record) => isDisallowedExternalHostname(record.address))) {
      return { ok: false, error: '不允许打开指向本地或内网的外部链接' };
    }
  } catch {
    return { ok: false, error: '链接主机名解析失败' };
  }

  return { ok: true, url: parsed.toString() };
}

/**
 * 安全解析 created_at 字段
 * Moebooru API 在不同接口返回的格式不同：
 * - /post.json 返回 Unix 时间戳（数字）
 * - /pool/show.json 的 posts 返回 ISO 字符串
 */
function parseCreatedAt(value: any): string {
  if (!value) return new Date().toISOString();

  // 如果是数字（Unix 时间戳）
  if (typeof value === 'number') {
    return new Date(value * 1000).toISOString();
  }

  // 如果是字符串，尝试直接解析
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return new Date().toISOString();
}

/**
 * 批量查询帖子中的 artist 标签
 * 先从 booru_tags 表查找已有分类，不足时通过 API 补全
 * @param siteId 站点 ID
 * @param posts 帖子列表
 * @param client 可选的 Booru 客户端，用于从 API 获取缺失的标签分类
 * @returns Map<postId, artistName>
 */
async function resolveArtistTags(
  siteId: number,
  posts: BooruPost[],
  client?: { getTagsByNames(names: string[]): Promise<any[]> }
): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  if (posts.length === 0) return result;

  const excludeTags = new Set(['banned_artist', 'voice_actor']);

  try {
    const db = await getDatabase();

    // 收集所有帖子的所有唯一标签
    const allTags = new Set<string>();
    for (const post of posts) {
      if (post.tags) {
        for (const tag of post.tags.split(/\s+/)) {
          if (tag) allTags.add(tag);
        }
      }
    }

    if (allTags.size === 0) return result;

    const tagArray = Array.from(allTags);

    // 分批查询数据库，避免 SQL IN 子句过大（SQLite 变量上限 999）
    const SQL_BATCH = 200;
    const artistSet = new Set<string>();
    const knownSet = new Set<string>();

    for (let i = 0; i < tagArray.length; i += SQL_BATCH) {
      const batch = tagArray.slice(i, i + SQL_BATCH);
      const placeholders = batch.map(() => '?').join(',');

      // 两个查询互不依赖，并行执行
      const [artistRows, knownRows] = await Promise.all([
        all<{ name: string }>(db,
          `SELECT name FROM booru_tags WHERE siteId = ? AND category = 'artist' AND name IN (${placeholders})`,
          [siteId, ...batch]
        ),
        all<{ name: string }>(db,
          `SELECT DISTINCT name FROM booru_tags WHERE siteId = ? AND name IN (${placeholders})`,
          [siteId, ...batch]
        ),
      ]);
      for (const r of artistRows) artistSet.add(r.name);
      for (const r of knownRows) knownSet.add(r.name);

      // 刷新已访问标签的 updatedAt（标签缓存过期清理用）
      if (knownRows.length > 0) {
        const now = new Date().toISOString();
        const knownPlaceholders = knownRows.map(() => '?').join(',');
        await run(db,
          `UPDATE booru_tags SET updatedAt = ? WHERE siteId = ? AND name IN (${knownPlaceholders})`,
          [now, siteId, ...knownRows.map(r => r.name)]
        );
      }
    }

    const unknownTags = tagArray.filter(t => !knownSet.has(t));

    // 如果有未入库的标签且提供了客户端，通过 API 补全
    if (unknownTags.length > 0 && client) {
      try {
        const batchSize = 50;
        for (let i = 0; i < unknownTags.length; i += batchSize) {
          const batch = unknownTags.slice(i, i + batchSize);
          const tagInfos = await client.getTagsByNames(batch);
          const tagsToSave = tagInfos.map((tag: any) => ({
            name: tag.name,
            category: TAG_TYPE_MAP[tag.type] || 'general',
            postCount: tag.count || 0
          }));
          if (tagsToSave.length > 0) {
            await booruService.saveBooruTags(siteId, tagsToSave);
            // 将新发现的 artist 标签加入集合
            for (const t of tagsToSave) {
              if (t.category === 'artist') artistSet.add(t.name);
            }
          }
        }
      } catch (error) {
        console.warn('[IPC] API 补全标签分类失败:', error);
      }
    }

    // 为每个帖子找到第一个匹配的 artist 标签
    for (const post of posts) {
      if (!post.tags) continue;
      const tags = post.tags.split(/\s+/);
      for (const tag of tags) {
        if (tag && artistSet.has(tag) && !excludeTags.has(tag)) {
          result.set(post.postId, tag);
          break;
        }
      }
    }
  } catch (error) {
    console.error('[IPC] 批量查询 artist 标签失败:', error);
  }

  return result;
}

export function setupIPC() {
  if (ipcHandlersRegistered) {
    console.warn('[IPC] setupIPC() 重复调用，已跳过重复注册');
    return;
  }

  ipcHandlersRegistered = true;
  // 数据库初始化
  ipcMain.handle(IPC_CHANNELS.DB_INIT, async (_event: IpcMainInvokeEvent) => {
    try {
      return await initDatabase();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 获取图片列表
  ipcMain.handle(IPC_CHANNELS.DB_GET_IMAGES, async (_event: IpcMainInvokeEvent, page: number = 1, pageSize: number = 50) => {
    try {
      return await getImages(page, pageSize);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 添加图片
  ipcMain.handle(IPC_CHANNELS.DB_ADD_IMAGE, async (_event: IpcMainInvokeEvent, image: any) => {
    try {
      return await addImage(image);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 搜索图片（支持分页）
  ipcMain.handle(IPC_CHANNELS.DB_SEARCH_IMAGES, async (_event: IpcMainInvokeEvent, query: string, page?: number, pageSize?: number) => {
    try {
      return await searchImages(query, page, pageSize);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 扫描文件夹（简化版，不处理图片内容）
  ipcMain.handle(IPC_CHANNELS.IMAGE_SCAN_FOLDER, async (_event: IpcMainInvokeEvent, folderPath: string) => {
    try {
      const images = [];
      const files = await scanDirectory(folderPath);

      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) {
          try {
            const imageInfo = await getImageInfo(file);
            if (imageInfo) {
              const result = await addImage(imageInfo);
              if (result.success && result.data) {
                images.push({ ...imageInfo, id: result.data });
              }
            }
          } catch (error) {
            console.error(`Failed to process image ${file}:`, error);
          }
        }
      }

      return { success: true, data: images };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 生成缩略图
  ipcMain.handle(IPC_CHANNELS.IMAGE_GENERATE_THUMBNAIL, async (_event: IpcMainInvokeEvent, imagePath: string, force?: boolean) => {
    try {
      return await generateThumbnail(imagePath, force || false);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 获取缩略图路径（如果不存在则自动生成）
  ipcMain.handle(IPC_CHANNELS.IMAGE_GET_THUMBNAIL, async (_event: IpcMainInvokeEvent, imagePath: string) => {
    try {
      console.log(`[IPC] 获取缩略图: ${imagePath}`);
      // 先检查缩略图是否存在
      let thumbnailPath = await getThumbnailIfExists(imagePath);
      
      // 如果不存在，自动生成
      if (!thumbnailPath) {
        console.log(`[IPC] 缩略图不存在，开始自动生成: ${imagePath}`);
        const generateResult = await generateThumbnail(imagePath, false);
        if (generateResult.success && generateResult.data) {
          thumbnailPath = generateResult.data;
          console.log(`[IPC] 缩略图生成成功: ${thumbnailPath}`);
        } else {
          console.error(`[IPC] 缩略图生成失败: ${generateResult.error}`);
          // 如果错误信息包含"原图不存在"，标记为 missing 以便渲染进程上报
          const isMissing = generateResult.error?.includes('原图不存在') ?? false;
          return { success: false, error: generateResult.error || '生成缩略图失败', missing: isMissing };
        }
      } else {
        console.log(`[IPC] 使用已存在的缩略图: ${thumbnailPath}`);
      }
      
      return { success: true, data: thumbnailPath };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[IPC] 获取缩略图失败: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  });

  // 删除图片（包括数据库记录、磁盘文件和缩略图）
  ipcMain.handle(IPC_CHANNELS.IMAGE_DELETE, async (_event: IpcMainInvokeEvent, imageId: number) => {
    try {
      return await deleteImage(imageId);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 删除缩略图
  ipcMain.handle(IPC_CHANNELS.IMAGE_DELETE_THUMBNAIL, async (_event: IpcMainInvokeEvent, imagePath: string) => {
    try {
      return await deleteThumbnail(imagePath);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 选择文件夹
  ipcMain.handle(IPC_CHANNELS.SYSTEM_SELECT_FOLDER, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择图片文件夹'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, data: result.filePaths[0] };
    }

    return { success: false, error: 'No folder selected' };
  });

  // 打开外部链接
  ipcMain.handle(IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL, async (_, url: string) => {
    const validated = await validateExternalUrl(url);
    if (!validated.ok) {
      return { success: false, error: validated.error };
    }

    const { shell } = await import('electron');
    await shell.openExternal(validated.url);
    return { success: true };
  });

  // 在文件管理器中显示项目
  ipcMain.handle(IPC_CHANNELS.SYSTEM_SHOW_ITEM, async (_event: IpcMainInvokeEvent, filePath: string) => {
    try {
      const { shell } = await import('electron');
      shell.showItemInFolder(filePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 检查更新
  ipcMain.handle(IPC_CHANNELS.SYSTEM_CHECK_FOR_UPDATE, async () => {
    console.log('[IPC] 检查更新');
    try {
      const result = await updateService.checkForUpdate();
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] 检查更新失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 最近图片 =====
  ipcMain.handle(IPC_CHANNELS.GALLERY_GET_RECENT_IMAGES, async (_event: IpcMainInvokeEvent, count: number = 100) => {
    try {
      return await getRecentImages(count);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 文件夹相关 =====
  ipcMain.handle(IPC_CHANNELS.GALLERY_GET_IMAGES_BY_FOLDER, async (_event: IpcMainInvokeEvent, folderPath: string, page: number = 1, pageSize: number = 50) => {
    try {
      return await getImagesByFolder(folderPath, page, pageSize);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_GET_ALL_FOLDERS, async (_event: IpcMainInvokeEvent) => {
    try {
      return await getAllFolders();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_SCAN_AND_IMPORT_FOLDER, async (_event: IpcMainInvokeEvent, folderPath: string, extensions: string[], recursive: boolean) => {
    try {
      return await scanAndImportFolder(folderPath, extensions, recursive);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 图库（Gallery）管理 =====
  ipcMain.handle(IPC_CHANNELS.GALLERY_GET_GALLERIES, async (_event: IpcMainInvokeEvent) => {
    try {
      return await getGalleries();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_GET_GALLERY, async (_event: IpcMainInvokeEvent, id: number) => {
    try {
      return await getGallery(id);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_CREATE_GALLERY, async (_event: IpcMainInvokeEvent, galleryData: any) => {
    try {
      return await createGallery(galleryData);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_UPDATE_GALLERY, async (_event: IpcMainInvokeEvent, id: number, updates: any) => {
    try {
      return await updateGallery(id, updates);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_DELETE_GALLERY, async (_event: IpcMainInvokeEvent, id: number) => {
    try {
      return await deleteGallery(id);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_SET_GALLERY_COVER, async (_event: IpcMainInvokeEvent, id: number, coverImageId: number) => {
    try {
      return await setGalleryCover(id, coverImageId);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_UPDATE_GALLERY_STATS, async (_event: IpcMainInvokeEvent, id: number, imageCount: number, lastScannedAt: string) => {
    try {
      return await updateGalleryStats(id, imageCount, lastScannedAt);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_SYNC_GALLERY_FOLDER, async (_event: IpcMainInvokeEvent, id: number) => {
    try {
      return await syncGalleryFolder(id);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 无效图片管理 =====
  ipcMain.handle(IPC_CHANNELS.GALLERY_REPORT_INVALID_IMAGE, async (_event: IpcMainInvokeEvent, imageId: number) => {
    try {
      return await reportInvalidImage(imageId);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_GET_INVALID_IMAGES, async (_event: IpcMainInvokeEvent, page: number = 1, pageSize: number = 200) => {
    try {
      return await getInvalidImages(page, pageSize);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_GET_INVALID_IMAGE_COUNT, async (_event: IpcMainInvokeEvent) => {
    try {
      return await getInvalidImageCount();
    } catch (error) {
      return { success: false, data: 0, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_DELETE_INVALID_IMAGE, async (_event: IpcMainInvokeEvent, id: number) => {
    try {
      return await deleteInvalidImage(id);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GALLERY_CLEAR_INVALID_IMAGES, async (_event: IpcMainInvokeEvent) => {
    try {
      return await clearInvalidImages();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 配置管理 =====
  ipcMain.handle(IPC_CHANNELS.CONFIG_GET, async (_event: IpcMainInvokeEvent) => {
    try {
      const config = getConfig();
      return { success: true, data: toRendererSafeConfig(config) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_PREFERENCES_GET_APPEARANCE, async (_event: IpcMainInvokeEvent) => {
    try {
      return { success: true, data: getBooruAppearancePreference(getConfig()) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 仅广播“哪些配置区块发生了变化”的摘要，避免事件负载携带完整的（包含敏感字段的）
  // 配置对象。渲染端收到摘要后应通过 CONFIG_GET / BOORU_PREFERENCES_GET_APPEARANCE 等
  // 只读通道自行拉取去敏后的最新数据。
  const broadcastConfigChanged = (sections: string[]): void => {
    const windows = BrowserWindow.getAllWindows();
    const summary: ConfigChangedSummary = {
      version: Date.now(),
      sections: Array.from(new Set(sections.filter(section => section.length > 0))),
    };
    for (const win of windows) {
      win.webContents.send(IPC_CHANNELS.CONFIG_CHANGED, summary);
    }
    console.log('[IPC] 配置变更摘要已广播到', windows.length, '个窗口:', summary.sections);
  };

  // 根据 ConfigSaveInput 负载推导受影响的“配置区块路径”集合。
  // - 普通顶层字段(如 `network`/`google`)统一记录为顶层段。
  // - `ui.pagePreferences.<key>` 需要额外下钻到具体偏好名，便于订阅端按页判断。
  // - 数组被视作终值、不再下钻，避免按索引生成无意义的段路径。
  // - 循环引用在当前路径不会出现：payload 来自 ipcRenderer.invoke 的结构化克隆副本，
  //   renderer 端 ConfigSaveInput 类型本身不允许循环；如未来来源扩大，需要补 visited guard。
  const collectConfigSaveSections = (
    payload: unknown,
    prefix = '',
  ): string[] => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return prefix ? [prefix] : [];
    }
    const entries = Object.entries(payload as Record<string, unknown>);
    if (entries.length === 0) {
      return prefix ? [prefix] : [];
    }
    const sections: string[] = [];
    for (const [key, value] of entries) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      if (nextPrefix === 'ui' || nextPrefix === 'ui.pagePreferences') {
        sections.push(...collectConfigSaveSections(value, nextPrefix));
      } else {
        sections.push(nextPrefix);
      }
    }
    return sections;
  };

  ipcMain.handle(IPC_CHANNELS.CONFIG_SAVE, async (_event: IpcMainInvokeEvent, newConfig: ConfigSaveInput) => {
    try {
      const result = await saveConfig(newConfig);
      if (result.success) {
        broadcastConfigChanged(collectConfigSaveSections(newConfig));
      }
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PAGE_PREFERENCES_GET_FAVORITE_TAGS, async (_event: IpcMainInvokeEvent) => {
    try {
      const config = getConfig();
      return {
        success: true,
        data: config.ui?.pagePreferences?.favoriteTags,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PAGE_PREFERENCES_SAVE_FAVORITE_TAGS, async (_event: IpcMainInvokeEvent, preferences: FavoriteTagsPagePreference) => {
    try {
      const result = await saveConfig({
        ui: {
          pagePreferences: {
            favoriteTags: preferences,
          },
        },
      });
      if (result.success) {
        broadcastConfigChanged(['ui.pagePreferences.favoriteTags']);
      }
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PAGE_PREFERENCES_GET_BLACKLISTED_TAGS, async (_event: IpcMainInvokeEvent) => {
    try {
      const config = getConfig();
      return {
        success: true,
        data: config.ui?.pagePreferences?.blacklistedTags,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PAGE_PREFERENCES_SAVE_BLACKLISTED_TAGS, async (_event: IpcMainInvokeEvent, preferences: BlacklistedTagsPagePreference) => {
    try {
      const result = await saveConfig({
        ui: {
          pagePreferences: {
            blacklistedTags: preferences,
          },
        },
      });
      if (result.success) {
        broadcastConfigChanged(['ui.pagePreferences.blacklistedTags']);
      }
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PAGE_PREFERENCES_GET_GALLERY, async (_event: IpcMainInvokeEvent) => {
    try {
      const config = getConfig();
      return {
        success: true,
        data: config.ui?.pagePreferences?.galleryBySubTab,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PAGE_PREFERENCES_SAVE_GALLERY, async (_event: IpcMainInvokeEvent, preferences: GalleryPagePreferencesBySubTab) => {
    try {
      const result = await saveConfig({
        ui: {
          pagePreferences: {
            galleryBySubTab: preferences,
          },
        },
      });
      if (result.success) {
        broadcastConfigChanged(['ui.pagePreferences.galleryBySubTab']);
      }
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PAGE_PREFERENCES_GET_APP_SHELL, async (_event: IpcMainInvokeEvent) => {
    try {
      const config = getConfig();
      const pagePreference = config.ui?.pagePreferences?.appShell;
      return {
        success: true,
        data: {
          menuOrder: {
            main: pagePreference?.menuOrder?.main ?? config.ui?.menuOrder?.main,
            gallery: pagePreference?.menuOrder?.gallery ?? config.ui?.menuOrder?.gallery,
            booru: pagePreference?.menuOrder?.booru ?? config.ui?.menuOrder?.booru,
            google: pagePreference?.menuOrder?.google ?? config.ui?.menuOrder?.google,
          },
          pinnedItems: pagePreference?.pinnedItems ?? config.ui?.pinnedItems,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PAGE_PREFERENCES_SAVE_APP_SHELL, async (_event: IpcMainInvokeEvent, preferences: AppShellPagePreference) => {
    try {
      const result = await saveConfig({
        ui: {
          pagePreferences: {
            appShell: preferences,
          },
        },
      });
      if (result.success) {
        broadcastConfigChanged(['ui.pagePreferences.appShell']);
      }
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG_UPDATE_GALLERY_FOLDERS, async (_event: IpcMainInvokeEvent, folders: any[]) => {
    try {
      return await updateGalleryFolders(folders);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG_RELOAD, async (_event: IpcMainInvokeEvent) => {
    try {
      const config = await reloadConfig();
      return { success: true, data: toRendererSafeConfig(config) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SYSTEM_EXPORT_BACKUP, async () => {
    try {
      console.log('[IPC] 导出应用备份');
      const backupData = await createAppBackupData();
      const summary = summarizeBackupTables(backupData);
      const result = await dialog.showSaveDialog({
        title: '导出应用备份',
        defaultPath: `yande-gallery-backup-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON Backup', extensions: ['json'] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: '已取消导出' };
      }

      await fs.writeFile(result.filePath, JSON.stringify(backupData, null, 2), 'utf-8');
      return { success: true, data: { path: result.filePath, summary } };
    } catch (error) {
      console.error('[IPC] 导出应用备份失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SYSTEM_IMPORT_BACKUP, async (_event: IpcMainInvokeEvent, mode: 'merge' | 'replace' = 'merge') => {
    try {
      console.log('[IPC] 导入应用备份, mode:', mode);
      const result = await dialog.showOpenDialog({
        title: '导入应用备份',
        properties: ['openFile'],
        filters: [{ name: 'JSON Backup', extensions: ['json'] }],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '已取消导入' };
      }

      const filePath = result.filePaths[0];
      const content = await fs.readFile(filePath, 'utf-8');
      const backupData = JSON.parse(content);

      if (!isValidBackupData(backupData)) {
        throw new Error('备份文件格式无效');
      }

      const restoreResult = await restoreAppBackupData(backupData, { mode });
      return { success: true, data: { path: filePath, ...restoreResult } };
    } catch (error) {
      console.error('[IPC] 导入应用备份失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 扫描子文件夹并创建图集 =====
  ipcMain.handle(IPC_CHANNELS.GALLERY_SCAN_SUBFOLDERS, async (_event: IpcMainInvokeEvent, rootPath: string, extensions?: string[]) => {
    try {
      return await scanSubfoldersAndCreateGalleries(rootPath, extensions);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== Booru 站点管理 =====
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_SITES, async () => {
    console.log('[IPC] 获取Booru站点列表');
    try {
      const sites = await booruService.getBooruSites();
      return { success: true, data: toRendererSafeBooruSites(sites) };
    } catch (error) {
      console.error('[IPC] 获取Booru站点列表失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_GET_ACTIVE_SITE, async () => {
    console.log('[IPC] 获取激活的Booru站点');
    try {
      const site = await booruService.getActiveBooruSite();
      return { success: true, data: toRendererSafeBooruSite(site) };
    } catch (error) {
      console.error('[IPC] 获取激活Booru站点失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_ADD_SITE, async (_event: IpcMainInvokeEvent, siteData: any) => {
    console.log('[IPC] 添加Booru站点:', siteData.name);
    try {
      const id = await booruService.addBooruSite(siteData);
      return { success: true, data: id };
    } catch (error) {
      console.error('[IPC] 添加Booru站点失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_UPDATE_SITE, async (_event: IpcMainInvokeEvent, id: number, updates: any) => {
    console.log('[IPC] 更新Booru站点:', id);
    try {
      await booruService.updateBooruSite(id, updates);
      return { success: true };
    } catch (error) {
      console.error('[IPC] 更新Booru站点失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_DELETE_SITE, async (_event: IpcMainInvokeEvent, id: number) => {
    console.log('[IPC] 删除Booru站点:', id);
    try {
      await booruService.deleteBooruSite(id);
      return { success: true };
    } catch (error) {
      console.error('[IPC] 删除Booru站点失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== Booru 图片获取 =====
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_POSTS, async (_event: IpcMainInvokeEvent, siteId: number, page: number = 1, tags?: string[], limit?: number) => {
    console.log('[IPC] 获取Booru图片列表，站点:', siteId, ', 页码:', page, ', 每页数量:', limit || 20);
    try {
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        throw new Error('站点不存在');
      }

      // 创建Moebooru客户端
      const client = createBooruClient(site);

      // 从API获取数据
      const posts = await client.getPosts({ page, tags, limit: limit || 20 });

      // 调试：打印第一个 post 的原始数据
      if (posts.length > 0) {
        console.log('[IPC] 第一个 post 的原始数据:', JSON.stringify(posts[0], null, 2));
        console.log('[IPC] file_url:', posts[0].file_url);
        console.log('[IPC] preview_url:', posts[0].preview_url);
        console.log('[IPC] sample_url:', posts[0].sample_url);
      }

      // 保存到数据库（事务批量插入，避免逐个提交的性能开销）
      const savedPostIds: number[] = [];
      const allTagNames = new Set<string>(); // 收集所有标签名
      const db = await getDatabase();

      await runInTransaction(db, async () => {
        for (const post of posts) {
          // 确保 URL 是字符串且有效
          const fileUrl = post.file_url ? String(post.file_url).trim() : '';
          const previewUrl = post.preview_url ? String(post.preview_url).trim() : '';
          const sampleUrl = post.sample_url ? String(post.sample_url).trim() : '';

          // 收集标签名
          if (post.tags) {
            const tags = post.tags.split(/\s+/).filter(t => t.trim());
            tags.forEach(tag => allTagNames.add(tag.trim()));
          }

          // 调试：检查第一个 post 的 URL 长度
          if (post.id === posts[0]?.id) {
            console.log('[IPC] 保存前的 URL 长度:', {
              postId: post.id,
              fileUrlLength: fileUrl.length,
              previewUrlLength: previewUrl.length,
              sampleUrlLength: sampleUrl.length,
              fileUrl: fileUrl.substring(0, 150),
              previewUrl: previewUrl.substring(0, 150),
              sampleUrl: sampleUrl.substring(0, 150)
            });
          }

          // 验证 URL 格式
          if (fileUrl && !fileUrl.startsWith('http://') && !fileUrl.startsWith('https://') && !fileUrl.startsWith('//')) {
            console.warn('[IPC] file_url 格式异常:', fileUrl);
          }

          const dbId = await booruService.saveBooruPost({
            siteId,
            postId: post.id,
            md5: post.md5,
            fileUrl: fileUrl,
            previewUrl: previewUrl,
            sampleUrl: sampleUrl,
            width: post.width,
            height: post.height,
            fileSize: post.file_size,
            fileExt: post.file_url.split('.').pop(),
            rating: RATING_MAP[post.rating] || 'safe',
            score: post.score,
            source: post.source,
            tags: post.tags,
            downloaded: false,
            isFavorited: false
          });
          savedPostIds.push(dbId);
        }
      });

      // 异步获取并保存标签分类信息（不阻塞返回）
      if (allTagNames.size > 0) {
        (async () => {
          try {
            console.log('[IPC] 开始获取标签分类信息，标签数量:', allTagNames.size);
            const tagNamesArray = Array.from(allTagNames);
            
            // 分批获取（每次最多50个标签）
            const batchSize = 50;
            for (let i = 0; i < tagNamesArray.length; i += batchSize) {
              const batch = tagNamesArray.slice(i, i + batchSize);
              try {
                const tagInfos = await client.getTagsByNames(batch);
                const tagsToSave = tagInfos.map(tag => ({
                  name: tag.name,
                  category: TAG_TYPE_MAP[tag.type] || 'general',
                  postCount: tag.count || 0
                }));
                
                if (tagsToSave.length > 0) {
                  await booruService.saveBooruTags(siteId, tagsToSave);
                  console.log('[IPC] 保存标签分类成功，批次:', Math.floor(i / batchSize) + 1, ', 标签数:', tagsToSave.length);
                }
              } catch (error) {
                console.warn('[IPC] 获取标签分类失败（批次）:', error);
                // 继续处理下一批
              }
            }
          } catch (error) {
            console.error('[IPC] 获取标签分类信息失败:', error);
            // 不影响主流程，只记录错误
          }
        })();
      }

      console.log('[IPC] 获取Booru图片成功，数量:', posts.length);

      // 从数据库重新查询，获取包含 id 和正确 isFavorited 的数据
      // 批量查询替代 N+1 单条查询，减少数据库往返
      const dbPosts = await booruService.getBooruPostsByIds(savedPostIds);

      // 批量查询所有帖子中的 artist 标签
      const artistMap = await resolveArtistTags(siteId, dbPosts, client);

      // 过滤掉 null 值并转换格式
      const formattedPosts = dbPosts
        .filter((post): post is BooruPost => post !== null)
        .map(post => {
          const fileUrl = post.fileUrl ? String(post.fileUrl).trim() : '';
          const previewUrl = post.previewUrl ? String(post.previewUrl).trim() : '';
          const sampleUrl = post.sampleUrl ? String(post.sampleUrl).trim() : '';

          // 调试：打印第一个 post 的 URL
          if (post.postId === dbPosts[0]?.postId) {
            console.log('[IPC] 从数据库读取的 URL:', {
              postId: post.postId,
              fileUrlLength: fileUrl.length,
              previewUrlLength: previewUrl.length,
              sampleUrlLength: sampleUrl.length,
              fileUrl: fileUrl.substring(0, 150),
              previewUrl: previewUrl.substring(0, 150),
              sampleUrl: sampleUrl.substring(0, 150),
              fileUrlFull: fileUrl,
              previewUrlFull: previewUrl,
              sampleUrlFull: sampleUrl
            });
          }

          return {
            id: post.id,
            siteId: post.siteId,
            postId: post.postId,
            md5: post.md5,
            fileUrl: fileUrl,
            previewUrl: previewUrl,
            sampleUrl: sampleUrl,
            width: post.width,
            height: post.height,
            fileSize: post.fileSize,
            fileExt: post.fileExt,
            rating: post.rating,
            score: post.score,
            source: post.source,
            tags: post.tags,
            downloaded: post.downloaded,
            isFavorited: post.isFavorited,
            isLiked: !!(post as any).isLiked,
            localPath: post.localPath,
            localImageId: post.localImageId,
            author: artistMap.get(post.postId) || undefined,
            createdAt: post.createdAt,
            updatedAt: post.updatedAt
          };
        });

      // 调试：打印第一个格式化后的 post
      if (formattedPosts.length > 0) {
        const firstPost = formattedPosts[0];
        console.log('[IPC] 格式化后的第一个 post URL:', {
          postId: firstPost.postId,
          fileUrlLength: firstPost.fileUrl?.length || 0,
          previewUrlLength: firstPost.previewUrl?.length || 0,
          sampleUrlLength: firstPost.sampleUrl?.length || 0,
          fileUrl: firstPost.fileUrl?.substring(0, 150),
          previewUrl: firstPost.previewUrl?.substring(0, 150),
          sampleUrl: firstPost.sampleUrl?.substring(0, 150),
          // 检查 URL 是否完整（以 .png, .jpg, .jpeg 等结尾）
          fileUrlEndsWith: firstPost.fileUrl?.slice(-20) || '',
          previewUrlEndsWith: firstPost.previewUrl?.slice(-20) || '',
          sampleUrlEndsWith: firstPost.sampleUrl?.slice(-20) || ''
        });
      }

      return { success: true, data: formattedPosts };
    } catch (error) {
      console.error('[IPC] 获取Booru图片失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_GET_POST, async (_event: IpcMainInvokeEvent, siteId: number, postId: number) => {
    console.log('[IPC] 获取Booru图片详情，站点:', siteId, ', 图片ID:', postId);
    try {
      const post = await booruService.getBooruPostBySiteAndId(siteId, postId);
      return { success: true, data: post };
    } catch (error) {
      console.error('[IPC] 获取Booru图片详情失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_SEARCH_POSTS, async (_event: IpcMainInvokeEvent, siteId: number, tags: string[], page: number = 1, limit?: number, fetchTagCategories: boolean = true) => {
    console.log('[IPC] 搜索Booru图片，站点:', siteId, ', 标签:', tags.join(' '), ', 每页数量:', limit || 20, ', 查询标签分类:', fetchTagCategories);
    try {
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        throw new Error('站点不存在');
      }

      // 创建Moebooru客户端
      const client = createBooruClient(site);

      // 从API搜索
      const posts = await client.getPosts({ page, tags, limit: limit || 20 });

      // 调试：打印第一个 post 的原始数据
      if (posts.length > 0) {
        console.log('[IPC] 搜索 - 第一个 post 的原始数据:', JSON.stringify(posts[0], null, 2));
      }

      // 保存到数据库（注意：API返回的是snake_case格式，需要转换为camelCase）
      const savedPostIds: number[] = [];
      const allTagNames = new Set<string>(); // 收集所有标签名
      
      for (const post of posts) {
        // 确保 URL 是字符串且有效
        const fileUrl = post.file_url ? String(post.file_url).trim() : '';
        const previewUrl = post.preview_url ? String(post.preview_url).trim() : '';
        const sampleUrl = post.sample_url ? String(post.sample_url).trim() : '';
        
        // 收集标签名
        if (post.tags) {
          const tags = post.tags.split(/\s+/).filter(t => t.trim());
          tags.forEach(tag => allTagNames.add(tag.trim()));
        }
        
        const dbId = await booruService.saveBooruPost({
          siteId,
          postId: post.id,
          md5: post.md5,
          fileUrl: fileUrl,
          previewUrl: previewUrl,
          sampleUrl: sampleUrl,
          width: post.width,
          height: post.height,
          fileSize: post.file_size,
          fileExt: post.file_url.split('.').pop(),
          rating: RATING_MAP[post.rating] || 'safe',
          score: post.score,
          source: post.source,
          tags: post.tags,
          downloaded: false,
          isFavorited: false
        });
        savedPostIds.push(dbId);
      }

      // 异步获取并保存标签分类信息（不阻塞返回）
      // 只有在 fetchTagCategories 为 true 时才查询（图片浏览时需要，批量下载时不需要）
      if (fetchTagCategories && allTagNames.size > 0) {
        (async () => {
          try {
            const tagNamesArray = Array.from(allTagNames);
            
            // 先检查数据库中已存在的标签，只查询不存在的标签
            const { getDatabase, all } = await import('../services/database.js');
            const db = await getDatabase();
            const placeholders = tagNamesArray.map(() => '?').join(',');
            const existingTagsQuery = `
              SELECT DISTINCT name
              FROM booru_tags
              WHERE siteId = ? AND name IN (${placeholders})
            `;
            const existingTagsRows = await all<{ name: string }>(db, existingTagsQuery, [siteId, ...tagNamesArray]);
            const existingTagSet = new Set(existingTagsRows.map(row => row.name));
            const tagsToFetch = tagNamesArray.filter(tag => !existingTagSet.has(tag));
            
            if (tagsToFetch.length === 0) {
              // 所有标签已存在，静默跳过（不输出日志，减少干扰）
              return;
            }
            
            // 只在需要查询的标签数量较多时才输出日志
            if (tagsToFetch.length > 10) {
              console.log('[IPC] 开始获取标签分类信息，需要查询:', tagsToFetch.length, '个标签 (总标签:', allTagNames.size, ', 已存在:', tagNamesArray.length - tagsToFetch.length, ')');
            }
            
            // 分批获取（每次最多50个标签）
            const batchSize = 50;
            for (let i = 0; i < tagsToFetch.length; i += batchSize) {
              const batch = tagsToFetch.slice(i, i + batchSize);
              try {
                const tagInfos = await client.getTagsByNames(batch);
                const tagsToSave = tagInfos.map(tag => ({
                  name: tag.name,
                  category: TAG_TYPE_MAP[tag.type] || 'general',
                  postCount: tag.count || 0
                }));
                
                if (tagsToSave.length > 0) {
                  await booruService.saveBooruTags(siteId, tagsToSave);
                  // 只在批次较多时才输出详细日志
                  if (tagsToFetch.length > 50) {
                    console.log('[IPC] 保存标签分类成功，批次:', Math.floor(i / batchSize) + 1, ', 标签数:', tagsToSave.length);
                  }
                }
              } catch (error) {
                // 只在错误严重时才输出警告（网络错误等）
                const errorMessage = error instanceof Error ? error.message : String(error);
                if (!errorMessage.includes('aborted') && !errorMessage.includes('ECONNRESET')) {
                  console.warn('[IPC] 获取标签分类失败（批次）:', error);
                }
                // 继续处理下一批
              }
              
              // 在批次之间添加小延迟，避免请求过于频繁
              if (i + batchSize < tagsToFetch.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
              }
            }
            
            // 只在查询了大量标签时才输出完成日志
            if (tagsToFetch.length > 10) {
              console.log('[IPC] 标签分类信息获取完成，共查询:', tagsToFetch.length, '个标签');
            }
          } catch (error) {
            console.error('[IPC] 获取标签分类信息失败:', error);
            // 不影响主流程，只记录错误
          }
        })();
      }

      // 从数据库重新查询，获取包含 id 和正确 isFavorited 的数据
      // 批量查询替代 N+1 单条查询，减少数据库往返
      const dbPosts = await booruService.getBooruPostsByIds(savedPostIds);

      // 批量查询所有帖子中的 artist 标签
      const searchArtistMap = await resolveArtistTags(siteId, dbPosts, client);

      // 过滤掉 null 值并转换格式
      const formattedPosts = dbPosts
        .filter((post): post is BooruPost => post !== null)
        .map(post => {
          const fileUrl = post.fileUrl ? String(post.fileUrl).trim() : '';
          const previewUrl = post.previewUrl ? String(post.previewUrl).trim() : '';
          const sampleUrl = post.sampleUrl ? String(post.sampleUrl).trim() : '';

          return {
            id: post.id,
            siteId: post.siteId,
            postId: post.postId,
            md5: post.md5,
            fileUrl: fileUrl,
            previewUrl: previewUrl,
            sampleUrl: sampleUrl,
            width: post.width,
            height: post.height,
            fileSize: post.fileSize,
            fileExt: post.fileExt,
            rating: post.rating,
            score: post.score,
            source: post.source,
            tags: post.tags,
            author: searchArtistMap.get(post.postId) || undefined,
            downloaded: post.downloaded,
            isFavorited: post.isFavorited,
            isLiked: !!(post as any).isLiked,
            localPath: post.localPath,
            localImageId: post.localImageId,
            createdAt: post.createdAt,
            updatedAt: post.updatedAt
          };
        });

      return { success: true, data: formattedPosts };
    } catch (error) {
      console.error('[IPC] 搜索Booru图片失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_GET_FAVORITES, async (_event: IpcMainInvokeEvent, siteId: number, page: number = 1, limit: number = 20, groupId?: number | null) => {
    console.log('[IPC] 获取Booru收藏列表，站点:', siteId, 'groupId:', groupId);
    try {
      // 快速修复 isFavorited 标志不一致（纯 SQL，很快）
      await booruService.repairFavoritesConsistency(siteId);

      // 先返回已有数据
      const favorites = await booruService.getFavorites(siteId, page, limit, groupId);

      // 异步补全缺失帖子数据（不阻塞返回）
      const missingIds = await booruService.getMissingFavoritePostIds(siteId);
      if (missingIds.length > 0) {
        console.log('[IPC] 发现', missingIds.length, '个收藏缺失帖子数据，后台从 API 获取');
        // fire-and-forget：后台获取，不阻塞响应
        (async () => {
          try {
            const site = await booruService.getBooruSiteById(siteId);
            if (!site) return;
            const client = createBooruClient(site);
            let repairedCount = 0;
            const deletedIds: number[] = [];
            for (const postId of missingIds) {
              try {
                const posts = await client.getPosts({ tags: [`id:${postId}`], limit: 1 });
                if (posts.length > 0 && posts[0].file_url) {
                  const p = posts[0];
                  await booruService.saveBooruPost({
                    siteId,
                    postId: p.id,
                    md5: p.md5,
                    fileUrl: p.file_url,
                    previewUrl: p.preview_url,
                    sampleUrl: p.sample_url,
                    width: p.width,
                    height: p.height,
                    fileSize: p.file_size,
                    fileExt: p.file_url?.split('.').pop() || 'jpg',
                    rating: p.rating === 's' ? 'safe' : p.rating === 'q' ? 'questionable' : 'explicit',
                    score: p.score,
                    source: p.source,
                    tags: p.tags,
                    downloaded: false,
                    isFavorited: true,
                  });
                  repairedCount++;
                  console.log('[IPC] 后台补全收藏帖子成功:', postId);
                } else {
                  // 帖子已被删除（API 返回空或无 file_url），从收藏中清理
                  console.warn('[IPC] 帖子已被删除，从收藏中移除:', postId);
                  await booruService.removeFromFavorites(postId);
                  deletedIds.push(postId);
                }
              } catch (fetchErr) {
                console.warn('[IPC] 后台获取帖子失败:', postId, fetchErr);
              }
            }
            console.log('[IPC] 后台补全完成: 修复', repairedCount, '个, 删除', deletedIds.length, '个已失效收藏');
            // 通知前端补全结果
            const windows = BrowserWindow.getAllWindows();
            for (const win of windows) {
              win.webContents.send(IPC_CHANNELS.BOORU_FAVORITES_REPAIR_DONE, {
                siteId,
                repairedCount,
                deletedCount: deletedIds.length,
                deletedIds,
              });
            }
          } catch (err) {
            console.warn('[IPC] 后台补全收藏帖子异常:', err);
          }
        })();
      }

      return { success: true, data: favorites, missingCount: missingIds.length };
    } catch (error) {
      console.error('[IPC] 获取Booru收藏列表失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_ADD_FAVORITE, async (_event: IpcMainInvokeEvent, postId: number, siteId: number, syncToServer: boolean = false) => {
    console.log('[IPC] 添加Booru收藏，图片:', postId, ', 同步到服务器:', syncToServer);
    try {
      const favoriteId = await booruService.addToFavorites(postId, siteId);
      return { success: true, data: favoriteId };
    } catch (error) {
      console.error('[IPC] 添加Booru收藏失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_REMOVE_FAVORITE, async (_event: IpcMainInvokeEvent, postId: number, syncToServer: boolean = false) => {
    console.log('[IPC] 移除Booru收藏，图片:', postId, ', 同步到服务器:', syncToServer);
    try {
      await booruService.removeFromFavorites(postId);
      return { success: true };
    } catch (error) {
      console.error('[IPC] 移除Booru收藏失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_ADD_TO_DOWNLOAD, async (_event: IpcMainInvokeEvent, postId: number, siteId: number) => {
    console.log('[IPC] 添加到下载队列，图片:', postId, ', 站点:', siteId);
    try {
      // 获取图片信息
      const post = await booruService.getBooruPostBySiteAndId(siteId, postId);
      if (!post) {
        throw new Error('未找到图片信息');
      }
      
      const success = await downloadManager.addToQueue(post, siteId);
      return { success };
    } catch (error) {
      console.error('[IPC] 添加到下载队列失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_GET_DOWNLOAD_QUEUE, async (_event: IpcMainInvokeEvent, status?: string) => {
    console.log('[IPC] 获取下载队列，状态:', status);
    try {
      const queue = await booruService.getDownloadQueueForDisplay(status);
      return { success: true, data: queue };
    } catch (error) {
      console.error('[IPC] 获取下载队列失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_RETRY_DOWNLOAD, async (_event: IpcMainInvokeEvent, postId: number, siteId: number) => {
    console.log('[IPC] 重试下载，图片:', postId, ', 站点:', siteId);
    try {
      // 使用 downloadManager.retryDownload 来真正触发下载
      const success = await downloadManager.retryDownload(postId, siteId);
      return { success };
    } catch (error) {
      console.error('[IPC] 重试下载失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_CLEAR_DOWNLOAD_RECORDS, async (_event: IpcMainInvokeEvent, status: 'completed' | 'failed') => {
    console.log('[IPC] 清空下载记录，状态:', status);
    try {
      const deletedCount = await booruService.clearDownloadRecords(status);
      return { success: true, data: deletedCount };
    } catch (error) {
      console.error('[IPC] 清空下载记录失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 暂停所有下载
  ipcMain.handle(IPC_CHANNELS.BOORU_PAUSE_ALL_DOWNLOADS, async () => {
    console.log('[IPC] 暂停所有下载');
    try {
      const success = await downloadManager.pauseAll();
      return { success };
    } catch (error) {
      console.error('[IPC] 暂停所有下载失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 恢复所有下载
  ipcMain.handle(IPC_CHANNELS.BOORU_RESUME_ALL_DOWNLOADS, async () => {
    console.log('[IPC] 恢复所有下载');
    try {
      const success = await downloadManager.resumeAll();
      return { success };
    } catch (error) {
      console.error('[IPC] 恢复所有下载失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 恢复未完成的下载（程序启动后首次进入下载管理界面时调用）
  ipcMain.handle(IPC_CHANNELS.BOORU_RESUME_PENDING_DOWNLOADS, async () => {
    console.log('[IPC] 恢复未完成的下载任务');
    try {
      const result = await downloadManager.resumePendingDownloads();
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] 恢复未完成下载失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 获取队列状态
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_QUEUE_STATUS, async () => {
    try {
      const status = downloadManager.getQueueStatus();
      return { success: true, data: status };
    } catch (error) {
      console.error('[IPC] 获取队列状态失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 暂停单个下载
  ipcMain.handle(IPC_CHANNELS.BOORU_PAUSE_DOWNLOAD, async (_event: IpcMainInvokeEvent, queueId: number) => {
    console.log('[IPC] 暂停单个下载:', queueId);
    try {
      const success = await downloadManager.pauseDownload(queueId);
      return { success };
    } catch (error) {
      console.error('[IPC] 暂停下载失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 恢复单个下载
  ipcMain.handle(IPC_CHANNELS.BOORU_RESUME_DOWNLOAD, async (_event: IpcMainInvokeEvent, queueId: number) => {
    console.log('[IPC] 恢复单个下载:', queueId);
    try {
      const success = await downloadManager.resumeDownload(queueId);
      return { success };
    } catch (error) {
      console.error('[IPC] 恢复下载失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });


  // ===== 网络连接测试（从主进程发起，绕过CORS） =====
  ipcMain.handle(IPC_CHANNELS.NETWORK_TEST_BAIDU, async () => {
    console.log('[IPC] 测试百度连接（主进程）');
    const proxyConfig = getProxyConfig();
    console.log('[IPC] 当前代理配置:', proxyConfig ? `${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}` : '无');

    try {
      // 使用 axios 发起请求，支持代理
      const response = await axios.get('https://www.baidu.com', {
        proxy: proxyConfig,
        timeout: 10000,
        headers: {
          'User-Agent': 'YandeGalleryDesktop/1.0.0'
        }
      });

      console.log('[IPC] 百度连接成功，状态:', response.status);
      return { success: true, status: response.status };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 百度连接失败:', errorMessage);
      if (axios.isAxiosError(error)) {
        console.error('[IPC] Axios错误详情:', error.code, error.message);
      }
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle(IPC_CHANNELS.NETWORK_TEST_GOOGLE, async () => {
    console.log('[IPC] 测试Google连接（主进程）');
    const proxyConfig = getProxyConfig();
    console.log('[IPC] 当前代理配置:', proxyConfig ? `${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}` : '无');

    try {
      // 使用 axios 发起请求，支持代理
      const response = await axios.get('https://www.google.com', {
        proxy: proxyConfig,
        timeout: 10000,
        headers: {
          'User-Agent': 'YandeGalleryDesktop/1.0.0'
        }
      });

      console.log('[IPC] Google连接成功，状态:', response.status);
      return { success: true, status: response.status };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] Google连接失败:', errorMessage);
      if (axios.isAxiosError(error)) {
        console.error('[IPC] Axios错误详情:', error.code, error.message);
      }
      return { success: false, error: errorMessage };
    }
  });

  // === 批量下载相关处理器 ===

  // 创建批量下载任务
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_CREATE_TASK, async (_event: IpcMainInvokeEvent, options: any) => {
    try {
      console.log('[IPC] 创建批量下载任务:', options);
      return await bulkDownloadService.createBulkDownloadTask(options);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 创建批量下载任务失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 获取所有批量下载任务
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_GET_TASKS, async (_event: IpcMainInvokeEvent) => {
    try {
      console.log('[IPC] 获取所有批量下载任务');
      const tasks = await bulkDownloadService.getBulkDownloadTasks();
      return { success: true, data: tasks };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 获取批量下载任务失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 根据ID获取批量下载任务
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_GET_TASK, async (_event: IpcMainInvokeEvent, taskId: string) => {
    try {
      console.log('[IPC] 获取批量下载任务:', taskId);
      const task = await bulkDownloadService.getBulkDownloadTaskById(taskId);
      if (!task) {
        return { success: false, error: '任务不存在' };
      }
      return { success: true, data: task };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 获取批量下载任务失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 更新批量下载任务
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_UPDATE_TASK, async (_event: IpcMainInvokeEvent, taskId: string, updates: any) => {
    try {
      console.log('[IPC] 更新批量下载任务:', taskId, updates);
      return await bulkDownloadService.updateBulkDownloadTask(taskId, updates);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 更新批量下载任务失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 删除批量下载任务
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_DELETE_TASK, async (_event: IpcMainInvokeEvent, taskId: string) => {
    try {
      console.log('[IPC] 删除批量下载任务:', taskId);
      return await bulkDownloadService.deleteBulkDownloadTask(taskId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 删除批量下载任务失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 创建批量下载会话
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_CREATE_SESSION, async (_event: IpcMainInvokeEvent, taskId: string) => {
    try {
      console.log('[IPC] 创建批量下载会话:', taskId);
      return await bulkDownloadService.createBulkDownloadSession(taskId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 创建批量下载会话失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 获取活跃的批量下载会话
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_GET_ACTIVE_SESSIONS, async (_event: IpcMainInvokeEvent) => {
    try {
      // 减少日志输出频率，避免控制台刷屏
      // console.log('[IPC] 获取活跃的批量下载会话');
      const sessions = await bulkDownloadService.getActiveBulkDownloadSessions();
      return { success: true, data: sessions };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 获取批量下载会话失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 启动批量下载会话
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_START_SESSION, async (_event: IpcMainInvokeEvent, sessionId: string) => {
    try {
      console.log('[IPC] 启动批量下载会话:', sessionId);
      return await bulkDownloadService.startBulkDownloadSession(sessionId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 启动批量下载会话失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 暂停批量下载会话
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_PAUSE_SESSION, async (_event: IpcMainInvokeEvent, sessionId: string) => {
    try {
      console.log('[IPC] 暂停批量下载会话:', sessionId);
      return await bulkDownloadService.pauseBulkDownloadSession(sessionId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 暂停批量下载会话失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 取消批量下载会话
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_CANCEL_SESSION, async (_event: IpcMainInvokeEvent, sessionId: string) => {
    try {
      console.log('[IPC] 取消批量下载会话:', sessionId);
      return await bulkDownloadService.cancelBulkDownloadSession(sessionId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 取消批量下载会话失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 删除批量下载会话
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_DELETE_SESSION, async (_event: IpcMainInvokeEvent, sessionId: string) => {
    try {
      console.log('[IPC] 删除批量下载会话:', sessionId);
      return await bulkDownloadService.deleteBulkDownloadSession(sessionId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 删除批量下载会话失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 获取批量下载会话统计
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_GET_SESSION_STATS, async (_event: IpcMainInvokeEvent, sessionId: string) => {
    try {
      // 减少日志输出，避免阻塞（只在调试时输出）
      // console.log('[IPC] 获取批量下载会话统计:', sessionId);
      const stats = await bulkDownloadService.getBulkDownloadSessionStats(sessionId);
      return { success: true, data: stats };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 获取批量下载会话统计失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 获取批量下载记录
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_GET_RECORDS, async (_event: IpcMainInvokeEvent, sessionId: string, status?: string, page?: number, autoFix?: boolean) => {
    try {
      // 减少日志输出，避免阻塞（只在调试时输出）
      // console.log('[IPC] 获取批量下载记录:', sessionId, status, page);
      // 默认禁用自动修复，避免每次打开详情页都触发大量 HEAD 请求
      // 只在明确需要时才启用（比如手动点击修复按钮）
      const records = await bulkDownloadService.getBulkDownloadRecordsBySession(sessionId, status as any, page, autoFix === true);
      return { success: true, data: records };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 获取批量下载记录失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 重试所有失败的记录
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_RETRY_ALL_FAILED, async (_event: IpcMainInvokeEvent, sessionId: string) => {
    try {
      console.log('[IPC] 重试所有失败的记录:', sessionId);
      return await bulkDownloadService.retryAllFailedRecords(sessionId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 重试所有失败记录失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 重试单个失败的记录
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_RETRY_FAILED_RECORD, async (_event: IpcMainInvokeEvent, sessionId: string, recordUrl: string) => {
    try {
      console.log('[IPC] 重试失败的记录:', sessionId, recordUrl);
      return await bulkDownloadService.retryFailedRecord(sessionId, recordUrl);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 重试失败记录失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 恢复运行中的批量下载会话（程序启动后调用）
  ipcMain.handle(IPC_CHANNELS.BULK_DOWNLOAD_RESUME_RUNNING_SESSIONS, async () => {
    try {
      console.log('[IPC] 恢复运行中的批量下载会话');
      return await bulkDownloadService.resumeRunningSessions();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 恢复批量下载会话失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // ===== Booru 图片缓存 =====
  // 获取缓存的图片 URL
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_CACHED_IMAGE_URL, async (_event: IpcMainInvokeEvent, md5: string, extension: string) => {
    try {
      console.log('[IPC] 获取缓存图片URL:', md5, extension);
      const cachedUrl = await imageCacheService.getCachedImageUrl(md5, extension);
      if (cachedUrl) {
        console.log('[IPC] 缓存图片URL:', cachedUrl);
        return { success: true, data: cachedUrl };
      } else {
        console.log('[IPC] 缓存图片不存在');
        return { success: false, error: '缓存不存在' };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 获取缓存图片URL失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 缓存图片
  ipcMain.handle(IPC_CHANNELS.BOORU_CACHE_IMAGE, async (_event: IpcMainInvokeEvent, url: string, md5: string, extension: string) => {
    try {
      console.log('[IPC] 开始缓存图片:', url.substring(0, 100), md5, extension);
      const cachePath = await imageCacheService.cacheImage(url, md5, extension);
      const cachedUrl = await imageCacheService.getCachedImageUrl(md5, extension);
      console.log('[IPC] 图片缓存成功:', cachedUrl);
      return { success: true, data: cachedUrl };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 图片缓存失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 获取缓存统计信息
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_CACHE_STATS, async (_event: IpcMainInvokeEvent) => {
    try {
      const stats = await imageCacheService.getCacheStats();
      return { success: true, data: stats };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 获取缓存统计失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 清除所有缓存
  ipcMain.handle(IPC_CHANNELS.BOORU_CLEAR_CACHE, async (_event: IpcMainInvokeEvent) => {
    try {
      const result = await imageCacheService.clearAllCache();
      console.log('[IPC] 清除缓存完成:', result);
      return { success: true, data: result };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 清除缓存失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // === 标签缓存管理 ===

  // 获取标签缓存统计
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_TAG_CACHE_STATS, async (_event: IpcMainInvokeEvent) => {
    try {
      const stats = await booruService.getTagCacheStats();
      return { success: true, data: stats };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 获取标签缓存统计失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 手动清理过期标签缓存
  ipcMain.handle(IPC_CHANNELS.BOORU_CLEAN_EXPIRED_TAGS, async (_event: IpcMainInvokeEvent, expireDays?: number) => {
    try {
      const cleaned = await booruService.cleanExpiredTags(expireDays || 60);
      console.log(`[IPC] 手动清理过期标签完成，删除 ${cleaned} 条`);
      return { success: true, data: { cleaned } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 清理过期标签失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // === 收藏标签管理 ===

  // 添加收藏标签
  ipcMain.handle(IPC_CHANNELS.BOORU_ADD_FAVORITE_TAG, async (_event: IpcMainInvokeEvent, siteId: number | null, tagName: string, options?: any) => {
    console.log('[IPC] 添加收藏标签:', { siteId, tagName });
    try {
      const tag = await booruService.addFavoriteTag(siteId, tagName, options);
      return { success: true, data: tag };
    } catch (error) {
      console.error('[IPC] 添加收藏标签失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 批量添加收藏标签
  ipcMain.handle(IPC_CHANNELS.BOORU_ADD_FAVORITE_TAGS_BATCH, async (_event, tagString: string, siteId: number | null, labels?: string) => {
    console.log('[IPC] 批量添加收藏标签');
    try {
      const result = await booruService.addFavoriteTagsBatch(tagString, siteId, labels);
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] 批量添加收藏标签失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 获取收藏标签列表
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_FAVORITE_TAGS, async (_event, params: ListQueryParams = {}) => {
    console.log('[IPC] 获取收藏标签列表:', params);
    try {
      const result = await booruService.getFavoriteTags(params);
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] 获取收藏标签列表失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_GET_FAVORITE_TAGS_WITH_DOWNLOAD_STATE, async (_event, params: ListQueryParams = {}) => {
    console.log('[IPC] 获取收藏标签及下载状态:', params);
    try {
      const result = await booruService.getFavoriteTagsWithDownloadState(params);
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] 获取收藏标签及下载状态失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_GET_FAVORITE_TAG_DOWNLOAD_BINDING, async (_event: IpcMainInvokeEvent, favoriteTagId: number) => {
    console.log('[IPC] 获取收藏标签下载绑定:', favoriteTagId);
    try {
      const binding = await booruService.getFavoriteTagDownloadBinding(favoriteTagId);
      return { success: true, data: binding };
    } catch (error) {
      console.error('[IPC] 获取收藏标签下载绑定失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_GET_FAVORITE_TAG_DOWNLOAD_HISTORY, async (_event: IpcMainInvokeEvent, favoriteTagId: number) => {
    console.log('[IPC] 获取收藏标签下载历史:', favoriteTagId);
    try {
      const history = await booruService.getFavoriteTagDownloadHistory(favoriteTagId);
      return { success: true, data: history };
    } catch (error) {
      console.error('[IPC] 获取收藏标签下载历史失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_GET_GALLERY_SOURCE_FAVORITE_TAGS, async (_event: IpcMainInvokeEvent, galleryId: number) => {
    console.log('[IPC] 获取图集来源收藏标签:', galleryId);
    try {
      const tags = await booruService.getGallerySourceFavoriteTags(galleryId);
      return { success: true, data: tags };
    } catch (error) {
      console.error('[IPC] 获取图集来源收藏标签失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_UPSERT_FAVORITE_TAG_DOWNLOAD_BINDING, async (_event: IpcMainInvokeEvent, input: any) => {
    console.log('[IPC] 保存收藏标签下载绑定:', input?.favoriteTagId);
    try {
      const binding = await booruService.upsertFavoriteTagDownloadBinding(input);
      return { success: true, data: binding };
    } catch (error) {
      console.error('[IPC] 保存收藏标签下载绑定失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_REMOVE_FAVORITE_TAG_DOWNLOAD_BINDING, async (_event: IpcMainInvokeEvent, favoriteTagId: number) => {
    console.log('[IPC] 删除收藏标签下载绑定:', favoriteTagId);
    try {
      await booruService.deleteFavoriteTagDownloadBinding(favoriteTagId);
      return { success: true };
    } catch (error) {
      console.error('[IPC] 删除收藏标签下载绑定失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_START_FAVORITE_TAG_BULK_DOWNLOAD, async (_event: IpcMainInvokeEvent, favoriteTagId: number) => {
    console.log('[IPC] 启动收藏标签批量下载:', favoriteTagId);
    try {
      const result = await booruService.startFavoriteTagBulkDownload(favoriteTagId);
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] 启动收藏标签批量下载失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 更新收藏标签
  ipcMain.handle(IPC_CHANNELS.BOORU_UPDATE_FAVORITE_TAG, async (_event: IpcMainInvokeEvent, id: number, updates: any) => {
    console.log('[IPC] 更新收藏标签:', id);
    try {
      await booruService.updateFavoriteTag(id, updates);
      return { success: true };
    } catch (error) {
      console.error('[IPC] 更新收藏标签失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 删除收藏标签
  ipcMain.handle(IPC_CHANNELS.BOORU_REMOVE_FAVORITE_TAG, async (_event: IpcMainInvokeEvent, id: number) => {
    console.log('[IPC] 删除收藏标签:', id);
    try {
      await booruService.removeFavoriteTag(id);
      return { success: true };
    } catch (error) {
      console.error('[IPC] 删除收藏标签失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 根据名称删除收藏标签
  ipcMain.handle(IPC_CHANNELS.BOORU_REMOVE_FAVORITE_TAG_BY_NAME, async (_event: IpcMainInvokeEvent, siteId: number | null, tagName: string) => {
    console.log('[IPC] 根据名称删除收藏标签:', { siteId, tagName });
    try {
      await booruService.removeFavoriteTagByName(siteId, tagName);
      return { success: true };
    } catch (error) {
      console.error('[IPC] 根据名称删除收藏标签失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 检查标签是否已收藏
  ipcMain.handle(IPC_CHANNELS.BOORU_IS_FAVORITE_TAG, async (_event: IpcMainInvokeEvent, siteId: number | null, tagName: string) => {
    try {
      const isFav = await booruService.isFavoriteTag(siteId, tagName);
      return { success: true, data: isFav };
    } catch (error) {
      console.error('[IPC] 检查标签收藏状态失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 获取标签分组列表
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_FAVORITE_TAG_LABELS, async () => {
    try {
      const labels = await booruService.getFavoriteTagLabels();
      return { success: true, data: labels };
    } catch (error) {
      console.error('[IPC] 获取标签分组列表失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 添加标签分组
  ipcMain.handle(IPC_CHANNELS.BOORU_ADD_FAVORITE_TAG_LABEL, async (_event: IpcMainInvokeEvent, name: string, color?: string) => {
    console.log('[IPC] 添加标签分组:', name);
    try {
      const label = await booruService.addFavoriteTagLabel(name, color);
      return { success: true, data: label };
    } catch (error) {
      console.error('[IPC] 添加标签分组失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 删除标签分组
  ipcMain.handle(IPC_CHANNELS.BOORU_REMOVE_FAVORITE_TAG_LABEL, async (_event: IpcMainInvokeEvent, id: number) => {
    console.log('[IPC] 删除标签分组:', id);
    try {
      await booruService.removeFavoriteTagLabel(id);
      return { success: true };
    } catch (error) {
      console.error('[IPC] 删除标签分组失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 获取标签分类信息
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_TAGS_CATEGORIES, async (_event: IpcMainInvokeEvent, siteId: number, tagNames: string[]) => {
    try {
      console.log('[IPC] 获取标签分类:', { siteId, tagCount: tagNames.length });
      const categoryMap = await booruService.getTagsCategories(siteId, tagNames);
      // 将 Map 转换为普通对象
      const result: Record<string, string> = {};
      categoryMap.forEach((category, name) => {
        result[name] = category;
      });
      return { success: true, data: result };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 获取标签分类失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // ========= 标签自动补全 =========

  // 根据输入前缀从 Booru 站点 API 搜索匹配的标签
  ipcMain.handle(IPC_CHANNELS.BOORU_AUTOCOMPLETE_TAGS, async (_event: IpcMainInvokeEvent, siteId: number, query: string, limit: number = 10) => {
    try {
      if (!query || query.trim().length === 0) {
        return { success: true, data: [] };
      }
      console.log('[IPC] 标签自动补全:', { siteId, query, limit });
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        return { success: false, error: '站点不存在' };
      }
      const client = createBooruClient(site);
      const tags = await client.getTags({ query: query.trim(), limit });
      // 返回简化的标签数据
      const result = tags.map(tag => ({
        name: tag.name,
        count: tag.count,
        type: tag.type,
      }));
      console.log('[IPC] 标签自动补全成功:', result.length, '个匹配');
      return { success: true, data: result };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 标签自动补全失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // ========= 艺术家 =========

  // 获取艺术家信息
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_ARTIST, async (_event: IpcMainInvokeEvent, siteId: number, name: string) => {
    try {
      console.log('[IPC] 获取艺术家信息:', { siteId, name });
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        return { success: false, error: '站点不存在' };
      }
      const client = createBooruClient(site);
      const artist = await client.getArtist(name);
      console.log('[IPC] 艺术家信息获取结果:', artist ? artist.name : 'null');
      return { success: true, data: artist };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 获取艺术家失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_GET_TAG_RELATIONSHIPS, async (_event: IpcMainInvokeEvent, siteId: number, name: string) => {
    try {
      console.log('[IPC] 获取标签别名与关联:', { siteId, name });
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        return { success: false, error: '站点不存在' };
      }
      const client = createBooruClient(site);
      const relationships = await client.getTagRelationships(name);
      return { success: true, data: relationships };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 获取标签别名与关联失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_REPORT_POST, async (_event: IpcMainInvokeEvent, siteId: number, postId: number, reason: string) => {
    try {
      console.log('[IPC] 举报帖子:', { siteId, postId });
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        return { success: false, error: '站点不存在' };
      }
      const client = createBooruClient(site);
      await client.reportPost(postId, reason);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 举报帖子失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_GET_IMAGE_METADATA, async (_event: IpcMainInvokeEvent, request: { localPath?: string; fileUrl?: string; md5?: string; fileExt?: string }) => {
    try {
      console.log('[IPC] 获取图片元数据');
      const metadata = await getImageMetadata(request);
      return { success: true, data: metadata };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 获取图片元数据失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 获取 Wiki 页面
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_WIKI, async (_event: IpcMainInvokeEvent, siteId: number, title: string) => {
    try {
      console.log('[IPC] 获取 Wiki:', { siteId, title });
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        return { success: false, error: '站点不存在' };
      }
      const client = createBooruClient(site);
      const wiki = await client.getWiki(title);
      console.log('[IPC] Wiki 获取结果:', wiki ? wiki.title : 'null');
      return { success: true, data: toRendererSafeBooruWiki(wiki) };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 获取 Wiki 失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 获取论坛主题列表
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_FORUM_TOPICS, async (_event: IpcMainInvokeEvent, siteId: number, page: number = 1, limit: number = 20) => {
    try {
      console.log('[IPC] 获取论坛主题:', { siteId, page, limit });
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        return { success: false, error: '站点不存在' };
      }
      const client = createBooruClient(site);
      const topics = await client.getForumTopics({ page, limit });
      return { success: true, data: topics.map(toRendererSafeBooruForumTopic) };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 获取论坛主题失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 获取论坛帖子列表
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_FORUM_POSTS, async (_event: IpcMainInvokeEvent, siteId: number, topicId: number, page: number = 1, limit: number = 20) => {
    try {
      console.log('[IPC] 获取论坛帖子:', { siteId, topicId, page, limit });
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        return { success: false, error: '站点不存在' };
      }
      const client = createBooruClient(site);
      const posts = await client.getForumPosts(topicId, { page, limit });
      return { success: true, data: posts.map(toRendererSafeBooruForumPost) };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 获取论坛帖子失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 获取当前登录用户主页
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_PROFILE, async (_event: IpcMainInvokeEvent, siteId: number) => {
    try {
      console.log('[IPC] 获取当前用户主页:', { siteId });
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        return { success: false, error: '站点不存在' };
      }
      const client = createBooruClient(site);
      const profile = await client.getProfile();
      return { success: true, data: toRendererSafeBooruUserProfile(profile) };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 获取当前用户主页失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 获取指定用户主页
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_USER_PROFILE, async (_event: IpcMainInvokeEvent, siteId: number, params: { userId?: number; username?: string }) => {
    try {
      console.log('[IPC] 获取指定用户主页:', { siteId, params });
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        return { success: false, error: '站点不存在' };
      }
      const client = createBooruClient(site);
      const profile = await client.getUserProfile(params || {});
      return { success: true, data: toRendererSafeBooruUserProfile(profile) };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 获取指定用户主页失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // ========= 搜索历史 =========

  // 添加搜索历史
  ipcMain.handle(IPC_CHANNELS.BOORU_ADD_SEARCH_HISTORY, async (_event: IpcMainInvokeEvent, siteId: number, query: string, resultCount: number = 0) => {
    try {
      console.log('[IPC] 添加搜索历史:', { siteId, query, resultCount });
      await booruService.addSearchHistory(siteId, query, resultCount);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 添加搜索历史失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 获取搜索历史
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_SEARCH_HISTORY, async (_event: IpcMainInvokeEvent, siteId?: number, limit: number = 20) => {
    try {
      console.log('[IPC] 获取搜索历史:', { siteId, limit });
      const history = await booruService.getSearchHistory(siteId, limit);
      return { success: true, data: history };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 获取搜索历史失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // 清除搜索历史
  ipcMain.handle(IPC_CHANNELS.BOORU_CLEAR_SEARCH_HISTORY, async (_event: IpcMainInvokeEvent, siteId?: number) => {
    try {
      console.log('[IPC] 清除搜索历史:', { siteId });
      await booruService.clearSearchHistory(siteId);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 清除搜索历史失败:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // ========= 黑名单标签管理 =========

  // 添加黑名单标签
  ipcMain.handle(IPC_CHANNELS.BOORU_ADD_BLACKLISTED_TAG, async (_event: IpcMainInvokeEvent, tagName: string, siteId?: number | null, reason?: string) => {
    console.log('[IPC] 添加黑名单标签:', { tagName, siteId, reason });
    try {
      const tag = await booruService.addBlacklistedTag(tagName, siteId, reason);
      return { success: true, data: tag };
    } catch (error) {
      console.error('[IPC] 添加黑名单标签失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 批量添加黑名单标签
  ipcMain.handle(IPC_CHANNELS.BOORU_ADD_BLACKLISTED_TAGS, async (_event: IpcMainInvokeEvent, tagString: string, siteId?: number | null, reason?: string) => {
    console.log('[IPC] 批量添加黑名单标签');
    try {
      const result = await booruService.addBlacklistedTags(tagString, siteId, reason);
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] 批量添加黑名单标签失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 获取黑名单标签列表
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_BLACKLISTED_TAGS, async (_event, params: ListQueryParams = {}) => {
    console.log('[IPC] 获取黑名单标签列表:', params);
    try {
      const result = await booruService.getBlacklistedTags(params);
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] 获取黑名单标签列表失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 获取激活的黑名单标签名列表
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_ACTIVE_BLACKLIST_TAG_NAMES, async (_event: IpcMainInvokeEvent, siteId?: number | null) => {
    try {
      const tagNames = await booruService.getActiveBlacklistTagNames(siteId);
      return { success: true, data: tagNames };
    } catch (error) {
      console.error('[IPC] 获取激活黑名单标签失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 切换黑名单标签激活状态
  ipcMain.handle(IPC_CHANNELS.BOORU_TOGGLE_BLACKLISTED_TAG, async (_event: IpcMainInvokeEvent, id: number) => {
    console.log('[IPC] 切换黑名单标签激活状态:', id);
    try {
      const tag = await booruService.toggleBlacklistedTag(id);
      return { success: true, data: tag };
    } catch (error) {
      console.error('[IPC] 切换黑名单标签状态失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 更新黑名单标签
  ipcMain.handle(IPC_CHANNELS.BOORU_UPDATE_BLACKLISTED_TAG, async (_event: IpcMainInvokeEvent, id: number, updates: any) => {
    console.log('[IPC] 更新黑名单标签:', id);
    try {
      await booruService.updateBlacklistedTag(id, updates);
      return { success: true };
    } catch (error) {
      console.error('[IPC] 更新黑名单标签失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 删除黑名单标签
  ipcMain.handle(IPC_CHANNELS.BOORU_REMOVE_BLACKLISTED_TAG, async (_event: IpcMainInvokeEvent, id: number) => {
    console.log('[IPC] 删除黑名单标签:', id);
    try {
      await booruService.removeBlacklistedTag(id);
      return { success: true };
    } catch (error) {
      console.error('[IPC] 删除黑名单标签失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 认证相关 =====

  // 登录（计算密码哈希并保存到站点配置）
  ipcMain.handle(IPC_CHANNELS.BOORU_LOGIN, async (_event: IpcMainInvokeEvent, siteId: number, username: string, password: string) => {
    console.log('[IPC] 登录 Booru 站点:', siteId, '用户:', username);
    try {
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        throw new Error('站点不存在');
      }

      // 使用站点的 salt 计算密码哈希
      const salt = site.salt || 'choujin-steiner--{0}--';
      const passwordHash = hashPasswordSHA1(salt, password);

      // 更新站点配置
      await booruService.updateBooruSite(siteId, {
        username,
        passwordHash
      });

      // 测试认证是否有效（使用临时凭证创建客户端）
      const client = createBooruClient({ ...site, username, passwordHash });

      const authResult = await client.testAuth();

      if (!authResult.valid) {
        // 认证失败，清除凭证
        await booruService.updateBooruSite(siteId, {
          username: '',
          passwordHash: ''
        });
        console.error('[IPC] 登录失败:', authResult.error);
        return { success: false, error: authResult.error || '认证失败，请检查用户名和密码' };
      }

      console.log('[IPC] 登录成功:', username);
      return { success: true, data: { username, authenticated: true } };
    } catch (error) {
      // 认证失败时也清除凭证
      try {
        await booruService.updateBooruSite(siteId, {
          username: '',
          passwordHash: ''
        });
      } catch (_) { /* ignore cleanup error */ }
      console.error('[IPC] 登录失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 登出（清除认证信息）
  ipcMain.handle(IPC_CHANNELS.BOORU_LOGOUT, async (_event: IpcMainInvokeEvent, siteId: number) => {
    console.log('[IPC] 登出 Booru 站点:', siteId);
    try {
      await booruService.updateBooruSite(siteId, {
        username: '',
        passwordHash: ''
      });
      return { success: true };
    } catch (error) {
      console.error('[IPC] 登出失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 测试认证
  ipcMain.handle(IPC_CHANNELS.BOORU_TEST_AUTH, async (_event: IpcMainInvokeEvent, siteId: number) => {
    console.log('[IPC] 测试认证:', siteId);
    try {
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        throw new Error('站点不存在');
      }

      if (!site.username || !site.passwordHash) {
        return { success: true, data: { authenticated: false, reason: '未配置认证信息' } };
      }

      const client = createBooruClient(site);

      const authResult = await client.testAuth();
      return { success: true, data: { authenticated: authResult.valid, username: site.username, error: authResult.error } };
    } catch (error) {
      console.error('[IPC] 测试认证失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 投票/服务端收藏 =====

  // 为图片投票
  ipcMain.handle(IPC_CHANNELS.BOORU_VOTE_POST, async (_event: IpcMainInvokeEvent, siteId: number, postId: number, score: 1 | 0 | -1) => {
    console.log('[IPC] 为图片投票:', siteId, postId, score);
    try {
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        throw new Error('站点不存在');
      }

      if (!site.username || !site.passwordHash) {
        throw new Error('需要登录才能投票');
      }

      const client = createBooruClient(site);

      await client.votePost(postId, score);
      return { success: true };
    } catch (error) {
      console.error('[IPC] 投票失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 服务端收藏
  ipcMain.handle(IPC_CHANNELS.BOORU_SERVER_FAVORITE, async (_event: IpcMainInvokeEvent, siteId: number, postId: number) => {
    console.log('[IPC] 服务端收藏:', siteId, postId);
    try {
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        throw new Error('站点不存在');
      }

      if (!site.username || !site.passwordHash) {
        throw new Error('需要登录才能收藏');
      }

      const client = createBooruClient(site);

      await client.favoritePost(postId);
      // 持久化喜欢状态到数据库
      await booruService.setPostLiked(siteId, postId, true);
      return { success: true };
    } catch (error) {
      console.error('[IPC] 服务端收藏失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 取消服务端收藏
  ipcMain.handle(IPC_CHANNELS.BOORU_SERVER_UNFAVORITE, async (_event: IpcMainInvokeEvent, siteId: number, postId: number) => {
    console.log('[IPC] 取消服务端收藏:', siteId, postId);
    try {
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        throw new Error('站点不存在');
      }

      if (!site.username || !site.passwordHash) {
        throw new Error('需要登录才能操作');
      }

      const client = createBooruClient(site);

      await client.unfavoritePost(postId);
      // 清除喜欢状态
      await booruService.setPostLiked(siteId, postId, false);
      return { success: true };
    } catch (error) {
      console.error('[IPC] 取消服务端收藏失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 服务端喜欢列表 =====

  // 获取用户的服务端喜欢列表
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_SERVER_FAVORITES, async (_event: IpcMainInvokeEvent, siteId: number, page: number = 1, limit: number = 20) => {
    console.log('[IPC] 获取服务端喜欢列表:', siteId, '页码:', page);
    try {
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        throw new Error('站点不存在');
      }

      if (!site.username || !site.passwordHash) {
        throw new Error('需要登录才能查看喜欢列表');
      }

      const client = createBooruClient(site);

      const posts = await client.getServerFavorites(page, limit);
      console.log('[IPC] 获取服务端喜欢列表成功:', posts.length, '张');

      // 保存到数据库并查询正确的 isFavorited 状态
      const savedPostIds: number[] = [];
      for (const post of posts) {
        const dbId = await booruService.saveBooruPost({
          siteId,
          postId: post.id,
          md5: post.md5,
          fileUrl: post.file_url,
          previewUrl: post.preview_url,
          sampleUrl: post.sample_url,
          width: post.width,
          height: post.height,
          fileSize: post.file_size,
          fileExt: post.file_url ? path.extname(post.file_url).replace('.', '') : 'jpg',
          rating: RATING_MAP[post.rating] || 'questionable',
          score: post.score,
          source: post.source,
          tags: post.tags,
          downloaded: false,
          isFavorited: false
        });
        savedPostIds.push(dbId);
      }

      // 批量查询替代 N+1 单条查询，减少数据库往返
      const dbPosts = await booruService.getBooruPostsByIds(savedPostIds);

      // 批量设置 isLiked = 1（这些帖子均为服务端喜欢列表中的帖子）
      for (const post of dbPosts) {
        await booruService.setPostLiked(siteId, post.postId, true);
      }

      // 批量查询所有帖子中的 artist 标签
      const favArtistMap = await resolveArtistTags(siteId, dbPosts, client);

      const mappedPosts = dbPosts
        .filter((post): post is BooruPost => post !== null)
        .map(post => ({
          ...post,
          isLiked: true,
          author: favArtistMap.get(post.postId) || undefined,
          createdAt: post.createdAt || new Date().toISOString()
        }));

      return { success: true, data: mappedPosts };
    } catch (error) {
      console.error('[IPC] 获取服务端喜欢列表失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 获取收藏某图片的用户列表
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_FAVORITE_USERS, async (_event: IpcMainInvokeEvent, siteId: number, postId: number) => {
    console.log('[IPC] 获取收藏用户列表:', siteId, postId);
    try {
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        throw new Error('站点不存在');
      }

      const client = createBooruClient(site);

      const users: any = await client.getFavoriteUsers(postId);
      console.log('[IPC] 获取收藏用户成功:', users);

      // API 返回 { favorited_users: "user1,user2,..." } 或字符串数组
      let userList: string[] = [];
      if (users && typeof users === 'object' && !Array.isArray(users) && users.favorited_users) {
        userList = String(users.favorited_users).split(',').map((u: string) => u.trim()).filter(Boolean);
      } else if (Array.isArray(users)) {
        userList = users.map(String);
      }

      return { success: true, data: userList };
    } catch (error) {
      console.error('[IPC] 获取收藏用户列表失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 热门图片 =====

  // 获取近期热门图片
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_POPULAR_RECENT, async (_event: IpcMainInvokeEvent, siteId: number, period: '1day' | '1week' | '1month' = '1day') => {
    console.log('[IPC] 获取近期热门图片:', siteId, period);
    try {
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        throw new Error('站点不存在');
      }

      const client = createBooruClient(site);

      const posts = await client.getPopularRecent(period);
      console.log('[IPC] 获取热门图片成功:', posts.length, '张');

      // 保存到数据库并查询正确的 isFavorited 状态
      const savedPostIds: number[] = [];
      for (const post of posts) {
        const dbId = await booruService.saveBooruPost({
          siteId,
          postId: post.id,
          md5: post.md5,
          fileUrl: post.file_url,
          previewUrl: post.preview_url,
          sampleUrl: post.sample_url,
          width: post.width,
          height: post.height,
          fileSize: post.file_size,
          fileExt: post.file_url ? path.extname(post.file_url).replace('.', '') : 'jpg',
          rating: RATING_MAP[post.rating] || 'questionable',
          score: post.score,
          source: post.source,
          tags: post.tags,
          downloaded: false,
          isFavorited: false
        });
        savedPostIds.push(dbId);
      }

      // 从数据库重新查询，获取正确的 isFavorited 状态
      // 批量查询替代 N+1 单条查询，减少数据库往返
      const dbPosts = await booruService.getBooruPostsByIds(savedPostIds);

      // 批量查询所有帖子中的 artist 标签
      const popularArtistMap = await resolveArtistTags(siteId, dbPosts, client);

      const mappedPosts = dbPosts
        .filter((post): post is BooruPost => post !== null)
        .map(post => ({
          ...post,
          author: popularArtistMap.get(post.postId) || undefined,
          createdAt: post.createdAt || new Date().toISOString()
        }));

      return { success: true, data: mappedPosts };
    } catch (error) {
      console.error('[IPC] 获取热门图片失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 获取指定日期的热门图片
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_POPULAR_BY_DAY, async (_event: IpcMainInvokeEvent, siteId: number, date: string) => {
    console.log('[IPC] 获取指定日期热门图片:', siteId, date);
    try {
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        throw new Error('站点不存在');
      }

      const client = createBooruClient(site);

      const posts = await client.getPopularByDay(date);

      // 保存到数据库并查询正确的 isFavorited 状态
      const savedPostIds: number[] = [];
      for (const post of posts) {
        const dbId = await booruService.saveBooruPost({
          siteId,
          postId: post.id,
          md5: post.md5,
          fileUrl: post.file_url,
          previewUrl: post.preview_url,
          sampleUrl: post.sample_url,
          width: post.width,
          height: post.height,
          fileSize: post.file_size,
          fileExt: post.file_url ? path.extname(post.file_url).replace('.', '') : 'jpg',
          rating: RATING_MAP[post.rating] || 'questionable',
          score: post.score,
          source: post.source,
          tags: post.tags,
          downloaded: false,
          isFavorited: false
        });
        savedPostIds.push(dbId);
      }

      // 批量查询替代 N+1 单条查询，减少数据库往返
      const dbPosts = await booruService.getBooruPostsByIds(savedPostIds);

      // 批量查询所有帖子中的 artist 标签
      const dayArtistMap = await resolveArtistTags(siteId, dbPosts, client);

      const mappedPosts = dbPosts
        .filter((post): post is BooruPost => post !== null)
        .map(post => ({
          ...post,
          author: dayArtistMap.get(post.postId) || undefined,
          createdAt: post.createdAt || new Date().toISOString()
        }));

      return { success: true, data: mappedPosts };
    } catch (error) {
      console.error('[IPC] 获取指定日期热门图片失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 获取指定周的热门图片
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_POPULAR_BY_WEEK, async (_event: IpcMainInvokeEvent, siteId: number, date: string) => {
    console.log('[IPC] 获取指定周热门图片:', siteId, date);
    try {
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        throw new Error('站点不存在');
      }

      const client = createBooruClient(site);

      const posts = await client.getPopularByWeek(date);

      // 保存到数据库并查询正确的 isFavorited 状态
      const savedPostIds: number[] = [];
      for (const post of posts) {
        const dbId = await booruService.saveBooruPost({
          siteId,
          postId: post.id,
          md5: post.md5,
          fileUrl: post.file_url,
          previewUrl: post.preview_url,
          sampleUrl: post.sample_url,
          width: post.width,
          height: post.height,
          fileSize: post.file_size,
          fileExt: post.file_url ? path.extname(post.file_url).replace('.', '') : 'jpg',
          rating: RATING_MAP[post.rating] || 'questionable',
          score: post.score,
          source: post.source,
          tags: post.tags,
          downloaded: false,
          isFavorited: false
        });
        savedPostIds.push(dbId);
      }

      // 批量查询替代 N+1 单条查询，减少数据库往返
      const dbPosts = await booruService.getBooruPostsByIds(savedPostIds);

      // 批量查询所有帖子中的 artist 标签
      const weekArtistMap = await resolveArtistTags(siteId, dbPosts, client);

      const mappedPosts = dbPosts
        .filter((post): post is BooruPost => post !== null)
        .map(post => ({
          ...post,
          author: weekArtistMap.get(post.postId) || undefined,
          createdAt: post.createdAt || new Date().toISOString()
        }));

      return { success: true, data: mappedPosts };
    } catch (error) {
      console.error('[IPC] 获取指定周热门图片失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 获取指定月的热门图片
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_POPULAR_BY_MONTH, async (_event: IpcMainInvokeEvent, siteId: number, date: string) => {
    console.log('[IPC] 获取指定月热门图片:', siteId, date);
    try {
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        throw new Error('站点不存在');
      }

      const client = createBooruClient(site);

      const posts = await client.getPopularByMonth(date);

      // 保存到数据库并查询正确的 isFavorited 状态
      const savedPostIds: number[] = [];
      for (const post of posts) {
        const dbId = await booruService.saveBooruPost({
          siteId,
          postId: post.id,
          md5: post.md5,
          fileUrl: post.file_url,
          previewUrl: post.preview_url,
          sampleUrl: post.sample_url,
          width: post.width,
          height: post.height,
          fileSize: post.file_size,
          fileExt: post.file_url ? path.extname(post.file_url).replace('.', '') : 'jpg',
          rating: RATING_MAP[post.rating] || 'questionable',
          score: post.score,
          source: post.source,
          tags: post.tags,
          downloaded: false,
          isFavorited: false
        });
        savedPostIds.push(dbId);
      }

      // 批量查询替代 N+1 单条查询，减少数据库往返
      const dbPosts = await booruService.getBooruPostsByIds(savedPostIds);

      // 批量查询所有帖子中的 artist 标签
      const monthArtistMap = await resolveArtistTags(siteId, dbPosts, client);

      const mappedPosts = dbPosts
        .filter((post): post is BooruPost => post !== null)
        .map(post => ({
          ...post,
          author: monthArtistMap.get(post.postId) || undefined,
          createdAt: post.createdAt || new Date().toISOString()
        }));

      return { success: true, data: mappedPosts };
    } catch (error) {
      console.error('[IPC] 获取指定月热门图片失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 评论 =====

  // 获取评论
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_COMMENTS, async (_event: IpcMainInvokeEvent, siteId: number, postId: number) => {
    console.log('[IPC] 获取评论:', siteId, postId);
    try {
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        throw new Error('站点不存在');
      }

      const client = createBooruClient(site);

      const comments = await client.getComments(postId);

      // 转换为统一格式
      const mappedComments = (comments || []).map((c: any) => ({
        id: c.id,
        postId: c.post_id,
        body: c.body,
        creator: c.creator || 'Anonymous',
        creatorId: c.creator_id,
        createdAt: c.created_at,
        updatedAt: c.updated_at
      }));

      return { success: true, data: mappedComments };
    } catch (error) {
      console.error('[IPC] 获取评论失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 创建评论
  ipcMain.handle(IPC_CHANNELS.BOORU_CREATE_COMMENT, async (_event: IpcMainInvokeEvent, siteId: number, postId: number, body: string) => {
    console.log('[IPC] 创建评论:', siteId, postId);
    try {
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        throw new Error('站点不存在');
      }

      if (!site.username || !site.passwordHash) {
        throw new Error('需要登录才能评论');
      }

      const client = createBooruClient(site);

      const result = await client.createComment(postId, body);
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] 创建评论失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== Pool（图集） =====

  // 获取 Pool 列表
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_POOLS, async (_event: IpcMainInvokeEvent, siteId: number, page: number = 1) => {
    console.log('[IPC] 获取 Pool 列表:', siteId, page);
    try {
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        throw new Error('站点不存在');
      }

      const client = createBooruClient(site);

      const pools = await client.getPools({ page });

      const mappedPools = (pools || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        postCount: p.post_count,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        isPublic: p.is_public !== false,
        userId: p.user_id
      }));

      return { success: true, data: mappedPools };
    } catch (error) {
      console.error('[IPC] 获取 Pool 列表失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 获取 Pool 详情
  ipcMain.handle(IPC_CHANNELS.BOORU_GET_POOL, async (_event: IpcMainInvokeEvent, siteId: number, poolId: number, page: number = 1) => {
    console.log('[IPC] 获取 Pool 详情:', siteId, poolId, page);
    try {
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        throw new Error('站点不存在');
      }

      const client = createBooruClient(site);

      const poolData = await client.getPool(poolId, page);

      // 保存 posts 到数据库并查询正确的 isFavorited 状态
      const savedPostIds: number[] = [];
      for (const post of (poolData.posts || [])) {
        const dbId = await booruService.saveBooruPost({
          siteId,
          postId: post.id,
          md5: post.md5,
          fileUrl: post.file_url,
          previewUrl: post.preview_url,
          sampleUrl: post.sample_url,
          width: post.width,
          height: post.height,
          fileSize: post.file_size,
          fileExt: post.file_url ? path.extname(post.file_url).replace('.', '') : 'jpg',
          rating: RATING_MAP[post.rating] || 'questionable',
          score: post.score,
          source: post.source,
          tags: post.tags,
          downloaded: false,
          isFavorited: false
        });
        savedPostIds.push(dbId);
      }

      // 批量查询替代 N+1 单条查询，减少数据库往返
      const dbPosts = await booruService.getBooruPostsByIds(savedPostIds);
      const posts = dbPosts
        .filter((post): post is BooruPost => post !== null)
        .map(post => ({
          ...post,
          createdAt: post.createdAt || new Date().toISOString()
        }));

      return {
        success: true,
        data: {
          id: poolData.id,
          name: poolData.name,
          description: poolData.description,
          postCount: poolData.post_count,
          createdAt: poolData.created_at,
          updatedAt: poolData.updated_at,
          isPublic: poolData.is_public !== false,
          userId: poolData.user_id,
          posts
        }
      };
    } catch (error) {
      console.error('[IPC] 获取 Pool 详情失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 搜索 Pool
  ipcMain.handle(IPC_CHANNELS.BOORU_SEARCH_POOLS, async (_event: IpcMainInvokeEvent, siteId: number, query: string, page: number = 1) => {
    console.log('[IPC] 搜索 Pool:', siteId, query, page);
    try {
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) {
        throw new Error('站点不存在');
      }

      const client = createBooruClient(site);

      const pools = await client.getPools({ query, page });

      const mappedPools = (pools || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        postCount: p.post_count,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        isPublic: p.is_public !== false,
        userId: p.user_id
      }));

      return { success: true, data: mappedPools };
    } catch (error) {
      console.error('[IPC] 搜索 Pool 失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 标签导入/导出 =====

  // 导出收藏标签（支持 JSON/TXT）
  ipcMain.handle(IPC_CHANNELS.BOORU_EXPORT_FAVORITE_TAGS, async (_event: IpcMainInvokeEvent, siteId?: number | null) => {
    console.log('[IPC] 导出收藏标签:', siteId);
    try {
      const { items: tags } = await booruService.getFavoriteTags({ siteId, limit: 0 });
      const labels = await booruService.getFavoriteTagLabels();

      // 弹出保存对话框（支持 JSON 和 TXT）
      const result = await dialog.showSaveDialog({
        title: '导出收藏标签',
        defaultPath: `favorite-tags-${new Date().toISOString().split('T')[0]}.json`,
        filters: [
          { name: 'JSON 文件', extensions: ['json'] },
          { name: '文本文件（仅标签名）', extensions: ['txt'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: '取消导出' };
      }

      const isTxt = result.filePath.endsWith('.txt');
      if (isTxt) {
        // TXT 格式：每行一个标签名
        const content = tags.map(t => t.tagName).join('\n');
        await fs.writeFile(result.filePath, content, 'utf-8');
      } else {
        // JSON 格式：完整数据
        const exportData = {
          version: 1,
          type: 'favorite_tags',
          exportedAt: new Date().toISOString(),
          tags: tags.map(t => ({
            tagName: t.tagName,
            siteId: t.siteId,
            labels: t.labels,
            queryType: t.queryType,
            notes: t.notes,
            sortOrder: t.sortOrder,
          })),
          labels: labels.map(l => ({
            name: l.name,
            color: l.color,
            sortOrder: l.sortOrder,
          })),
        };
        await fs.writeFile(result.filePath, JSON.stringify(exportData, null, 2), 'utf-8');
      }

      console.log('[IPC] 导出收藏标签成功:', result.filePath, '标签数:', tags.length);
      return { success: true, data: { count: tags.length, path: result.filePath } };
    } catch (error) {
      console.error('[IPC] 导出收藏标签失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 选择收藏标签导入文件（pickFile 阶段：弹对话框 + 读取 + 解析，返回记录列表）
  ipcMain.handle(IPC_CHANNELS.BOORU_IMPORT_FAVORITE_TAGS_PICK_FILE, async () => {
    console.log('[IPC] 选择收藏标签导入文件');
    try {
      const result = await booruService.importFavoriteTagsPickFile();
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] 选择导入文件失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 提交收藏标签导入（commit 阶段：把用户确认过的记录写入数据库）
  // payload.labelGroups 承载文件里顶层 labels 数组，由 pickFile 阶段解析得到，
  // commit 阶段会逐条调用 addFavoriteTagLabel 写回数据库（已存在的分组计入 labelsSkipped）。
  ipcMain.handle(IPC_CHANNELS.BOORU_IMPORT_FAVORITE_TAGS_COMMIT, async (_event: IpcMainInvokeEvent, payload: { records: FavoriteTagImportRecord[]; labelGroups?: FavoriteTagLabelImportRecord[]; fallbackSiteId: number | null }) => {
    console.log('[IPC] 提交收藏标签导入:', payload.records.length);
    try {
      const result = await booruService.importFavoriteTagsCommit(payload);
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] 导入收藏标签失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 导出黑名单标签（支持 JSON/TXT）
  ipcMain.handle(IPC_CHANNELS.BOORU_EXPORT_BLACKLISTED_TAGS, async (_event: IpcMainInvokeEvent, siteId?: number | null) => {
    console.log('[IPC] 导出黑名单标签:', siteId);
    try {
      const { items: tags } = await booruService.getBlacklistedTags({ siteId, limit: 0 });

      const result = await dialog.showSaveDialog({
        title: '导出黑名单标签',
        defaultPath: `blacklisted-tags-${new Date().toISOString().split('T')[0]}.json`,
        filters: [
          { name: 'JSON 文件', extensions: ['json'] },
          { name: '文本文件（仅标签名）', extensions: ['txt'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: '取消导出' };
      }

      const isTxt = result.filePath.endsWith('.txt');
      if (isTxt) {
        const content = tags.map(t => t.tagName).join('\n');
        await fs.writeFile(result.filePath, content, 'utf-8');
      } else {
        const exportData = {
          version: 1,
          type: 'blacklisted_tags',
          exportedAt: new Date().toISOString(),
          tags: tags.map(t => ({
            tagName: t.tagName,
            siteId: t.siteId,
            isActive: t.isActive,
            reason: t.reason,
          })),
        };
        await fs.writeFile(result.filePath, JSON.stringify(exportData, null, 2), 'utf-8');
      }

      console.log('[IPC] 导出黑名单标签成功:', result.filePath, '标签数:', tags.length);
      return { success: true, data: { count: tags.length, path: result.filePath } };
    } catch (error) {
      console.error('[IPC] 导出黑名单标签失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 选择黑名单导入文件（pickFile 阶段：弹对话框 + 读取 + 解析，返回记录列表）
  ipcMain.handle(IPC_CHANNELS.BOORU_IMPORT_BLACKLISTED_TAGS_PICK_FILE, async () => {
    console.log('[IPC] 选择黑名单导入文件');
    try {
      const result = await booruService.importBlacklistedTagsPickFile();
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] 选择黑名单导入文件失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 提交黑名单导入（commit 阶段：把用户确认过的记录写入数据库）
  ipcMain.handle(IPC_CHANNELS.BOORU_IMPORT_BLACKLISTED_TAGS_COMMIT, async (_event: IpcMainInvokeEvent, payload: { records: BlacklistedTagImportRecord[]; fallbackSiteId: number | null }) => {
    console.log('[IPC] 提交黑名单导入:', payload.records.length);
    try {
      const result = await booruService.importBlacklistedTagsCommit(payload);
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] 导入黑名单失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // === 帖子注释 ===

  ipcMain.handle(IPC_CHANNELS.BOORU_GET_NOTES, async (_event: IpcMainInvokeEvent, siteId: number, postId: number) => {
    try {
      console.log('[IPC] 获取帖子注释, siteId:', siteId, 'postId:', postId);
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) return { success: false, error: '站点不存在' };
      const client = createBooruClient(site);
      const notes = await client.getNotes(postId);
      return { success: true, data: notes };
    } catch (error) {
      console.error('[IPC] 获取帖子注释失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // === 帖子版本历史 ===

  ipcMain.handle(IPC_CHANNELS.BOORU_GET_POST_VERSIONS, async (_event: IpcMainInvokeEvent, siteId: number, postId: number) => {
    try {
      console.log('[IPC] 获取帖子版本历史, siteId:', siteId, 'postId:', postId);
      const site = await booruService.getBooruSiteById(siteId);
      if (!site) return { success: false, error: '站点不存在' };
      const client = createBooruClient(site);
      const versions = await client.getPostVersions(postId);
      return { success: true, data: versions };
    } catch (error) {
      console.error('[IPC] 获取帖子版本历史失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // === 收藏夹分组 ===

  ipcMain.handle(IPC_CHANNELS.BOORU_GET_FAVORITE_GROUPS, async (_event: IpcMainInvokeEvent, siteId?: number) => {
    try {
      const groups = await booruService.getFavoriteGroups(siteId);
      return { success: true, data: groups };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_CREATE_FAVORITE_GROUP, async (_event: IpcMainInvokeEvent, name: string, siteId?: number, color?: string) => {
    try {
      const group = await booruService.createFavoriteGroup(name, siteId, color);
      return { success: true, data: group };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_UPDATE_FAVORITE_GROUP, async (_event: IpcMainInvokeEvent, id: number, updates: { name?: string; color?: string }) => {
    try {
      await booruService.updateFavoriteGroup(id, updates);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_DELETE_FAVORITE_GROUP, async (_event: IpcMainInvokeEvent, id: number) => {
    try {
      await booruService.deleteFavoriteGroup(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_MOVE_FAVORITE_TO_GROUP, async (_event: IpcMainInvokeEvent, postId: number, groupId: number | null) => {
    try {
      await booruService.moveFavoriteToGroup(postId, groupId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // === 保存的搜索 ===

  ipcMain.handle(IPC_CHANNELS.BOORU_GET_SAVED_SEARCHES, async (_event: IpcMainInvokeEvent, siteId?: number) => {
    try {
      const searches = await booruService.getSavedSearches(siteId);
      return { success: true, data: searches };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_ADD_SAVED_SEARCH, async (_event: IpcMainInvokeEvent, siteId: number | null, name: string, query: string) => {
    try {
      const id = await booruService.addSavedSearch(siteId, name, query);
      return { success: true, data: id };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_UPDATE_SAVED_SEARCH, async (_event: IpcMainInvokeEvent, id: number, updates: { name?: string; query?: string; siteId?: number | null }) => {
    try {
      await booruService.updateSavedSearch(id, updates);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_DELETE_SAVED_SEARCH, async (_event: IpcMainInvokeEvent, id: number) => {
    try {
      await booruService.deleteSavedSearch(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}


// 辅助函数：递归扫描目录
async function scanDirectory(dirPath: string): Promise<string[]> {
  const files: string[] = [];
  const items = await fs.readdir(dirPath, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);
    if (item.isDirectory()) {
      const subFiles = await scanDirectory(fullPath);
      files.push(...subFiles);
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

// 辅助函数：获取图片信息（简化版，不处理图片内容）
async function getImageInfo(filePath: string): Promise<any | null> {
  try {
    const stats = await fs.stat(filePath);

    // 简化版本，不实际读取图片内容
    const ext = path.extname(filePath).toLowerCase();
    const format = ext.replace('.', '');

    // 模拟图片尺寸（实际项目中应该使用sharp获取真实尺寸）
    const mockDimensions = {
      'jpg': { width: 1920, height: 1080 },
      'jpeg': { width: 1920, height: 1080 },
      'png': { width: 1920, height: 1080 },
      'gif': { width: 400, height: 300 },
      'webp': { width: 1920, height: 1080 },
      'bmp': { width: 1920, height: 1080 }
    };

    const dimensions = mockDimensions[format as keyof typeof mockDimensions] || { width: 800, height: 600 };

    return {
      filename: path.basename(filePath),
      filepath: filePath,
      fileSize: stats.size,
      width: dimensions.width,
      height: dimensions.height,
      format: format,
      createdAt: stats.birthtime.toISOString(),
      updatedAt: stats.mtime.toISOString()
    };
  } catch (error) {
    console.error(`Failed to get image info for ${filePath}:`, error);
    return null;
  }
}
