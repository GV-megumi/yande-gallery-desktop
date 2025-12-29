import { ipcMain, dialog, IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from './channels.js';
import path from 'path';
import fs from 'fs/promises';
import axios from 'axios';
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
  scanSubfoldersAndCreateGalleries
} from '../services/galleryService.js';
import { MoebooruClient, hashPasswordSHA1, RATING_MAP, TAG_TYPE_MAP } from '../services/moebooruClient.js';
import * as booruService from '../services/booruService.js';
import { BooruPost } from '../../shared/types.js';
import { getConfig, saveConfig, updateGalleryFolders, reloadConfig } from '../services/config.js';
import { generateThumbnail, getThumbnailIfExists, deleteThumbnail } from '../services/thumbnailService.js';
import { downloadManager } from '../services/downloadManager.js';
import * as bulkDownloadService from '../services/bulkDownloadService.js';
import * as imageCacheService from '../services/imageCacheService.js';


export function setupIPC() {
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
  ipcMain.handle('image:get-thumbnail', async (_event: IpcMainInvokeEvent, imagePath: string) => {
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
          return { success: false, error: generateResult.error || '生成缩略图失败' };
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

  // 删除缩略图
  ipcMain.handle('image:delete-thumbnail', async (_event: IpcMainInvokeEvent, imagePath: string) => {
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
    const { shell } = await import('electron');
    await shell.openExternal(url);
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

  // ===== 最近图片 =====
  ipcMain.handle('gallery:get-recent-images', async (_event: IpcMainInvokeEvent, count: number = 100) => {
    try {
      return await getRecentImages(count);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 文件夹相关 =====
  ipcMain.handle('gallery:get-images-by-folder', async (_event: IpcMainInvokeEvent, folderPath: string, page: number = 1, pageSize: number = 50) => {
    try {
      return await getImagesByFolder(folderPath, page, pageSize);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('gallery:get-all-folders', async (_event: IpcMainInvokeEvent) => {
    try {
      return await getAllFolders();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('gallery:scan-and-import-folder', async (_event: IpcMainInvokeEvent, folderPath: string, extensions: string[], recursive: boolean) => {
    try {
      return await scanAndImportFolder(folderPath, extensions, recursive);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 图库（Gallery）管理 =====
  ipcMain.handle('gallery:get-galleries', async (_event: IpcMainInvokeEvent) => {
    try {
      return await getGalleries();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('gallery:get-gallery', async (_event: IpcMainInvokeEvent, id: number) => {
    try {
      return await getGallery(id);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('gallery:create-gallery', async (_event: IpcMainInvokeEvent, galleryData: any) => {
    try {
      return await createGallery(galleryData);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('gallery:update-gallery', async (_event: IpcMainInvokeEvent, id: number, updates: any) => {
    try {
      return await updateGallery(id, updates);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('gallery:delete-gallery', async (_event: IpcMainInvokeEvent, id: number) => {
    try {
      return await deleteGallery(id);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('gallery:set-gallery-cover', async (_event: IpcMainInvokeEvent, id: number, coverImageId: number) => {
    try {
      return await setGalleryCover(id, coverImageId);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('gallery:update-gallery-stats', async (_event: IpcMainInvokeEvent, id: number, imageCount: number, lastScannedAt: string) => {
    try {
      return await updateGalleryStats(id, imageCount, lastScannedAt);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 配置管理 =====
  ipcMain.handle('config:get', async (_event: IpcMainInvokeEvent) => {
    try {
      const config = getConfig();
      return { success: true, data: config };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('config:save', async (_event: IpcMainInvokeEvent, newConfig: any) => {
    try {
      return await saveConfig(newConfig);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('config:update-gallery-folders', async (_event: IpcMainInvokeEvent, folders: any[]) => {
    try {
      return await updateGalleryFolders(folders);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('config:reload', async (_event: IpcMainInvokeEvent) => {
    try {
      const config = await reloadConfig();
      return { success: true, data: config };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 扫描子文件夹并创建图集 =====
  ipcMain.handle('gallery:scan-subfolders', async (_event: IpcMainInvokeEvent, rootPath: string, extensions?: string[]) => {
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
      return { success: true, data: sites };
    } catch (error) {
      console.error('[IPC] 获取Booru站点列表失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOORU_GET_ACTIVE_SITE, async () => {
    console.log('[IPC] 获取激活的Booru站点');
    try {
      const site = await booruService.getActiveBooruSite();
      return { success: true, data: site };
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
      const client = new MoebooruClient({
        baseUrl: site.url,
        login: site.username,
        passwordHash: site.passwordHash
      });

      // 从API获取数据
      const posts = await client.getPosts({ page, tags, limit: limit || 20 });

      // 调试：打印第一个 post 的原始数据
      if (posts.length > 0) {
        console.log('[IPC] 第一个 post 的原始数据:', JSON.stringify(posts[0], null, 2));
        console.log('[IPC] file_url:', posts[0].file_url);
        console.log('[IPC] preview_url:', posts[0].preview_url);
        console.log('[IPC] sample_url:', posts[0].sample_url);
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
      const dbPosts = await Promise.all(
        savedPostIds.map(id => booruService.getBooruPostById(id))
      );
      
      // 过滤掉 null 值并转换格式
      const formattedPosts = dbPosts
        .filter((post): post is BooruPost => post !== null)
        .map(post => {
          // 确保 URL 是字符串且有效
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
              fileUrlFull: fileUrl, // 完整 URL（用于调试）
              previewUrlFull: previewUrl, // 完整 URL（用于调试）
              sampleUrlFull: sampleUrl // 完整 URL（用于调试）
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
            localPath: post.localPath,
            localImageId: post.localImageId,
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
      const client = new MoebooruClient({
        baseUrl: site.url,
        login: site.username,
        passwordHash: site.passwordHash
      });

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
      const dbPosts = await Promise.all(
        savedPostIds.map(id => booruService.getBooruPostById(id))
      );
      
      // 过滤掉 null 值并转换格式
      const formattedPosts = dbPosts
        .filter((post): post is BooruPost => post !== null)
        .map(post => {
          // 确保 URL 是字符串且有效
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
            downloaded: post.downloaded,
            isFavorited: post.isFavorited,
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

  ipcMain.handle(IPC_CHANNELS.BOORU_GET_FAVORITES, async (_event: IpcMainInvokeEvent, siteId: number, page: number = 1, limit: number = 20) => {
    console.log('[IPC] 获取Booru收藏列表，站点:', siteId);
    try {
      const favorites = await booruService.getFavorites(siteId, page, limit);
      return { success: true, data: favorites };
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
      const queue = await booruService.getDownloadQueue(status);
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
  ipcMain.handle('network:test-baidu', async () => {
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

  ipcMain.handle('network:test-google', async () => {
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
