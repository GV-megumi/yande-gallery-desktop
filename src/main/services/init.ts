import { loadConfig, getConfig, getDatabasePath } from './config.js';
import { initDatabase } from './database.js';
import { createGallery, getGalleries } from './galleryService.js';
import { normalizePath } from '../utils/path.js';

/**
 * 初始化应用（加载配置 + 初始化数据库 + 初始化图库）
 */
export async function initializeApp(): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('🚀 正在初始化应用...');

    // 1. 加载配置
    console.log('📋 加载配置文件...');
    await loadConfig();
    const config = getConfig();
    console.log('✅ 配置加载成功');

    // 2. 初始化数据库
    console.log('🗄️ 初始化数据库...');
    const dbResult = await initDatabase();
    if (!dbResult.success) {
      throw new Error(dbResult.error || 'Database initialization failed');
    }
    console.log('✅ 数据库初始化成功');

    // 3. 从配置初始化图库
    console.log('🖼️ 初始化图库...');
    await initGalleriesFromConfig();
    console.log('✅ 图库初始化完成');

    console.log('🎉 应用初始化完成！');

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ 应用初始化失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 从配置文件读取初始图库（懒加载模式）
 * - 只创建图库记录，不扫描文件夹
 * - 点击图库后才触发扫描
 */
async function initGalleriesFromConfig(): Promise<void> {
  try {
    const config = getConfig();

    // 检查是否已有图库
    const existingResult = await getGalleries();

    if (existingResult.success && existingResult.data && existingResult.data.length > 0) {
      console.log(`📊 已有 ${existingResult.data.length} 个图库，跳过初始化`);
      return;
    }

    console.log('📂 从配置创建初始图库...');

    let createdCount = 0;

    for (const folderConfig of config.galleries.folders) {
      try {
        // 规范化路径（支持相对路径和绝对路径）
        const folderPath = normalizePath(folderConfig.path);

        // 创建图库（不触发扫描）
        const result = await createGallery({
          folderPath,
          name: folderConfig.name,
          isWatching: folderConfig.autoScan,
          recursive: folderConfig.recursive,
          extensions: folderConfig.extensions
        });

        if (result.success) {
          createdCount++;
          console.log(`✅ 创建图库: ${folderConfig.name} (${folderPath})`);
        }
      } catch (error) {
        console.error(`❌ 创建图库失败: ${folderConfig.name}`, error);
      }
    }

    console.log(`📝 共创建 ${createdCount} 个图库`);
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
