import { initPaths, loadConfig, getConfig, getDatabasePath, ensureDataDirectories, getConfigDir, getDataDir } from './config.js';
import { initDatabase, closeDatabase } from './database.js';
import { createGallery, getGalleries } from './galleryService.js';
import { loadGalleryRoots } from './galleryRootRegistry.js';
import { normalizePath } from '../utils/path.js';
import { downloadManager } from './downloadManager.js';
import * as bulkDownloadService from './bulkDownloadService.js';
import { cleanExpiredTags } from './booruService.js';
import { stopApiService } from '../api/apiServiceManager.js';

/**
 * 初始化应用（加载配置 + 初始化数据库 + 初始化图库）
 */
export async function initializeApp(): Promise<{ success: boolean; error?: string }> {
  hasShutdownAppResources = false;

  try {
    console.log('[init] 正在初始化应用...');

    // 0. 初始化路径系统（读 .env → 确定 configDir）
    console.log('[init] 初始化路径系统...');
    await initPaths();
    console.log('[init] 配置目录:', getConfigDir());

    // 1. 加载配置文件（从 configDir/config.yaml）
    console.log('[init] 加载配置文件...');
    await loadConfig();
    const config = getConfig();
    console.log('[init] 数据目录:', getDataDir());

    // 1.5. 确保所有数据子目录存在
    await ensureDataDirectories();

    // 2. 初始化数据库
    console.log('[init] 初始化数据库...');
    const dbResult = await initDatabase();
    if (!dbResult.success) {
      throw new Error(dbResult.error || 'Database initialization failed');
    }
    console.log('[init] 数据库初始化成功');

    // 3. 从配置初始化图库
    console.log('[init] 初始化图库...');
    await initGalleriesFromConfig();
    console.log('[init] 图库初始化完成');

    // 4. 后台自动恢复未完成的下载任务（不阻塞启动）
    resumeDownloadsInBackground();

    console.log('[init] 应用初始化完成');

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[init] 应用初始化失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 后台恢复未完成的下载任务（普通下载 + 批量下载）
 * 在应用启动时自动调用，不阻塞主流程
 */
let resumeDownloadsTimer: ReturnType<typeof setTimeout> | null = null;
let hasShutdownAppResources = false;

function clearResumeDownloadsTimer(): void {
  if (resumeDownloadsTimer) {
    clearTimeout(resumeDownloadsTimer);
    resumeDownloadsTimer = null;
  }
}

async function freezeActiveTasksForShutdown(): Promise<void> {
  const pausedDownloads = await downloadManager.pauseAll();
  if (!pausedDownloads) {
    throw new Error('pause all failed');
  }

  const sessions = await bulkDownloadService.getActiveBulkDownloadSessions();
  for (const session of sessions) {
    if (session.status !== 'running' && session.status !== 'dryRun') {
      continue;
    }

    const pauseResult = await bulkDownloadService.pauseBulkDownloadSession(session.id);
    if (!pauseResult.success) {
      throw new Error(pauseResult.error || `pause bulk session failed: ${session.id}`);
    }
  }
}

export async function shutdownAppResources(): Promise<void> {
  if (hasShutdownAppResources) {
    return;
  }

  clearResumeDownloadsTimer();
  await freezeActiveTasksForShutdown();
  await stopApiService();
  await closeDatabase();
  hasShutdownAppResources = true;
}

function resumeDownloadsInBackground(): void {
  clearResumeDownloadsTimer();

  // 延迟 2 秒执行，让窗口和 IPC 先初始化完成
  resumeDownloadsTimer = setTimeout(async () => {
    resumeDownloadsTimer = null;
    console.log('[init] 开始后台恢复未完成的下载任务...');

    // 恢复普通下载队列
    try {
      const result = await downloadManager.resumePendingDownloads();
      if (result.resumed > 0) {
        console.log(`[init] 已恢复 ${result.resumed} 个普通下载任务`);
      } else {
        console.log('[init] 没有需要恢复的普通下载任务');
      }
    } catch (error) {
      console.error('[init] 恢复普通下载任务失败:', error);
    }

    // 恢复批量下载会话
    try {
      const result = await bulkDownloadService.resumeRunningSessions();
      if (result.success && result.data && result.data.resumed > 0) {
        console.log(`[init] 已恢复 ${result.data.resumed} 个批量下载会话`);
      } else {
        console.log('[init] 没有需要恢复的批量下载会话');
      }
    } catch (error) {
      console.error('[init] 恢复批量下载会话失败:', error);
    }

    // 清理过期标签缓存（超过 60 天未访问的标签）
    try {
      const cleaned = await cleanExpiredTags(60);
      if (cleaned > 0) {
        console.log(`[init] 已清理 ${cleaned} 条过期标签缓存`);
      }
    } catch (error) {
      console.error('[init] 清理过期标签缓存失败:', error);
    }
  }, 2000);
}

/**
 * 启动时一次性迁移 + 装载图库根登记表（懒加载模式）
 * - 历史遗留：旧版把图库根写在 config.galleries.folders；现已归一到 DB galleries 表。
 *   这里仅在 DB 为空时把旧字段迁移进 DB，并从内存配置剥离该 key，避免后续回写再持久化。
 * - 不论是否迁移，最后都从 DB 装载 galleryRootRegistry，供 app:// 白名单同步读取。
 */
export async function initGalleriesFromConfig(): Promise<void> {
  try {
    // 旧字段已从 AppConfig 类型移除；老 yaml 可能仍残留该 key，故防御式读取
    const config = getConfig() as unknown as {
      galleries?: { folders?: Array<{ path: string; name: string; autoScan?: boolean; recursive?: boolean; extensions?: string[] }> };
    };

    const existingResult = await getGalleries();
    const dbEmpty = !(existingResult.success && existingResult.data && existingResult.data.length > 0);

    const legacyFolders = config.galleries?.folders ?? [];
    if (dbEmpty && legacyFolders.length > 0) {
      console.log('📂 检测到旧 config.galleries.folders，一次性迁移进数据库...');
      let createdCount = 0;
      for (const folderConfig of legacyFolders) {
        try {
          const folderPath = normalizePath(folderConfig.path);
          const result = await createGallery({
            folderPath,
            name: folderConfig.name,
            isWatching: folderConfig.autoScan,
            recursive: folderConfig.recursive,
            extensions: folderConfig.extensions,
          });
          if (result.success) {
            createdCount++;
            console.log(`✅ 迁移图库: ${folderConfig.name} (${folderPath})`);
          }
        } catch (error) {
          console.error(`❌ 迁移图库失败: ${folderConfig.name}`, error);
        }
      }
      console.log(`📝 共迁移 ${createdCount} 个图库`);
    }

    // 迁移完成后剥离旧 key，避免 config 回写时再次持久化
    if (config.galleries !== undefined) {
      delete config.galleries;
    }

    // 从 DB 装载图库根登记表（app:// 白名单的同步来源）
    const galleriesResult = await getGalleries();
    const roots = galleriesResult.success && galleriesResult.data
      ? galleriesResult.data.map(g => g.folderPath).filter(Boolean)
      : [];
    loadGalleryRoots(roots);
    console.log(`[init] 图库根登记表已装载，共 ${roots.length} 个根`);
  } catch (error) {
    console.error('❌ 初始化图库失败:', error);
  }
}

/**
 * 获取应用信息
 */
export async function getAppInfo(): Promise<{
  success: boolean;
  data?: {
    databasePath: string;
    config: import('./config.js').AppConfig;
    galleryCount: number;
  };
  error?: string;
}> {
  try {
    const config = getConfig();

    // 获取图库数量
    const galleriesResult = await getGalleries();
    const galleryCount = galleriesResult.success && galleriesResult.data
      ? galleriesResult.data.length
      : 0;

    return {
      success: true,
      data: {
        databasePath: getDatabasePath(),
        config,
        galleryCount
      }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error getting app info:', errorMessage);
    return { success: false, error: errorMessage };
  }
}
