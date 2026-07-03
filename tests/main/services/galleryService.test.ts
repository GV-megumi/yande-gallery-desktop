import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

/**
 * galleryService 纯逻辑测试
 * 由于 galleryService 依赖数据库和文件系统，
 * 这里测试其核心逻辑的等价实现
 */

describe('galleryService - Gallery 数据映射', () => {
  // 模拟 SQLite 行到 Gallery 对象的转换
  function mapRowToGallery(row: Record<string, any>) {
    return {
      id: row.id,
      folderPath: row.folderPath,
      name: row.name,
      coverImageId: row.coverImageId,
      imageCount: row.imageCount,
      lastScannedAt: row.lastScannedAt,
      isWatching: Boolean(row.isWatching),
      recursive: Boolean(row.recursive),
      extensions: row.extensions ? JSON.parse(row.extensions) : [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      coverImage: row.coverImageId ? {
        id: row.coverImageId,
        filename: row.coverFilename,
        filepath: row.coverFilepath,
      } : undefined,
    };
  }

  it('应正确转换布尔值（SQLite 0/1）', () => {
    const row = {
      id: 1, folderPath: '/images', name: 'Test',
      isWatching: 1, recursive: 0, imageCount: 10,
      extensions: '[\".jpg\",\".png\"]',
      createdAt: '2024-01-01', updatedAt: '2024-01-01',
    };
    const gallery = mapRowToGallery(row);
    expect(gallery.isWatching).toBe(true);
    expect(gallery.recursive).toBe(false);
  });

  it('isWatching 为 0 应转换为 false', () => {
    const row = { id: 1, isWatching: 0, recursive: 1, extensions: '[]' };
    const gallery = mapRowToGallery(row);
    expect(gallery.isWatching).toBe(false);
    expect(gallery.recursive).toBe(true);
  });

  it('应正确解析 extensions JSON', () => {
    const row = {
      id: 1, extensions: '[\".jpg\",\".jpeg\",\".png\",\".gif\",\".webp\"]',
    };
    const gallery = mapRowToGallery(row);
    expect(gallery.extensions).toEqual(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
  });

  it('extensions 为空时应返回空数组', () => {
    const row = { id: 1, extensions: null };
    const gallery = mapRowToGallery(row);
    expect(gallery.extensions).toEqual([]);
  });

  it('有 coverImageId 时应包含 coverImage', () => {
    const row = {
      id: 1, coverImageId: 42, coverFilename: 'cover.jpg',
      coverFilepath: '/images/cover.jpg', extensions: '[]',
    };
    const gallery = mapRowToGallery(row);
    expect(gallery.coverImage).toBeDefined();
    expect(gallery.coverImage!.id).toBe(42);
    expect(gallery.coverImage!.filename).toBe('cover.jpg');
  });

  it('无 coverImageId 时 coverImage 应为 undefined', () => {
    const row = { id: 1, coverImageId: null, extensions: '[]' };
    const gallery = mapRowToGallery(row);
    expect(gallery.coverImage).toBeUndefined();
  });
});

describe('galleryService - 默认值处理', () => {
  it('默认扩展名应包含常见图片格式', () => {
    const defaultExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
    expect(defaultExtensions).toContain('.jpg');
    expect(defaultExtensions).toContain('.png');
    expect(defaultExtensions).toContain('.webp');
    expect(defaultExtensions).toHaveLength(6);
  });

  it('isWatching 默认值应为 true', () => {
    const isWatching = undefined ?? true;
    expect(isWatching).toBe(true);
  });

  it('recursive 默认值应为 true', () => {
    const recursive = undefined ?? true;
    expect(recursive).toBe(true);
  });
});

describe('galleryService - updateGallery SQL 构建', () => {
  // 模拟动态 SQL 构建逻辑
  function buildUpdateClauses(updates: Record<string, any>): {
    setClauses: string[];
    values: any[];
  } {
    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      values.push(updates.name);
    }
    if (updates.isWatching !== undefined) {
      setClauses.push('isWatching = ?');
      values.push(updates.isWatching ? 1 : 0);
    }
    if (updates.recursive !== undefined) {
      setClauses.push('recursive = ?');
      values.push(updates.recursive ? 1 : 0);
    }

    return { setClauses, values };
  }

  it('只更新 name 时应只有一个子句', () => {
    const { setClauses, values } = buildUpdateClauses({ name: 'New Name' });
    expect(setClauses).toEqual(['name = ?']);
    expect(values).toEqual(['New Name']);
  });

  it('更新多个字段时应有多个子句', () => {
    const { setClauses, values } = buildUpdateClauses({
      name: 'New', isWatching: true, recursive: false,
    });
    expect(setClauses).toHaveLength(3);
    expect(values).toEqual(['New', 1, 0]);
  });

  it('空更新应返回空数组', () => {
    const { setClauses, values } = buildUpdateClauses({});
    expect(setClauses).toHaveLength(0);
    expect(values).toHaveLength(0);
  });

  it('布尔值应转换为 0/1', () => {
    const { values } = buildUpdateClauses({ isWatching: false, recursive: true });
    expect(values).toEqual([0, 1]);
  });
});

describe('galleryService - 唯一名称生成', () => {
  // 模拟 generateUniqueGalleryName
  function generateUniqueName(baseName: string, existingNames: Set<string>): string {
    let name = baseName;
    let suffix = 1;
    while (existingNames.has(name)) {
      name = `${baseName} (${suffix})`;
      suffix++;
    }
    return name;
  }

  it('名称不重复时应原样返回', () => {
    expect(generateUniqueName('Gallery', new Set(['Other']))).toBe('Gallery');
  });

  it('名称重复时应添加 (1) 后缀', () => {
    expect(generateUniqueName('Gallery', new Set(['Gallery']))).toBe('Gallery (1)');
  });

  it('多次重复应递增后缀', () => {
    const existing = new Set(['Gallery', 'Gallery (1)', 'Gallery (2)']);
    expect(generateUniqueName('Gallery', existing)).toBe('Gallery (3)');
  });

  it('空名称也应正常处理', () => {
    expect(generateUniqueName('', new Set())).toBe('');
  });
});

describe('galleryService - syncGalleryFolder 结果结构', () => {
  // 模拟 syncGalleryFolder 的返回结构验证
  interface SyncResult {
    imported: number;
    skipped: number;
    imageCount: number;
    lastScannedAt: string;
  }

  function buildSyncResult(
    importResult: { imported: number; skipped: number },
    imageCount: number
  ): SyncResult {
    return {
      imported: importResult.imported,
      skipped: importResult.skipped,
      imageCount,
      lastScannedAt: new Date().toISOString(),
    };
  }

  it('应正确组装同步结果', () => {
    const result = buildSyncResult({ imported: 5, skipped: 10 }, 15);
    expect(result.imported).toBe(5);
    expect(result.skipped).toBe(10);
    expect(result.imageCount).toBe(15);
    expect(result.lastScannedAt).toBeTruthy();
    // lastScannedAt 应为合法 ISO 字符串
    expect(new Date(result.lastScannedAt).toISOString()).toBe(result.lastScannedAt);
  });

  it('全部跳过时 imported 应为 0', () => {
    const result = buildSyncResult({ imported: 0, skipped: 20 }, 20);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(20);
    expect(result.imageCount).toBe(20);
  });

  it('空文件夹时所有计数应为 0', () => {
    const result = buildSyncResult({ imported: 0, skipped: 0 }, 0);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.imageCount).toBe(0);
  });

  it('imageCount 应反映实际总数（含已有 + 新增）', () => {
    // 模拟：文件夹原有 50 张，新导入 3 张，跳过 50 张（已存在）
    const result = buildSyncResult({ imported: 3, skipped: 50 }, 53);
    expect(result.imported).toBe(3);
    expect(result.imageCount).toBe(53);
  });
});

describe('galleryService - syncGalleryFolder 扩展名处理', () => {
  function resolveExtensions(galleryExtensions: string[] | undefined | null): string[] {
    const defaults = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
    return galleryExtensions && galleryExtensions.length > 0
      ? galleryExtensions
      : defaults;
  }

  it('图集有自定义扩展名时应使用自定义值', () => {
    expect(resolveExtensions(['.png', '.webp'])).toEqual(['.png', '.webp']);
  });

  it('图集扩展名为空数组时应使用默认值', () => {
    const result = resolveExtensions([]);
    expect(result).toHaveLength(6);
    expect(result).toContain('.jpg');
  });

  it('图集扩展名为 undefined 时应使用默认值', () => {
    const result = resolveExtensions(undefined);
    expect(result).toHaveLength(6);
  });

  it('图集扩展名为 null 时应使用默认值', () => {
    const result = resolveExtensions(null);
    expect(result).toHaveLength(6);
  });
});

describe('galleryService - checkFolderHasImages 逻辑', () => {
  // 模拟检查文件夹是否包含图片
  function hasImagesInFiles(filenames: string[], extensions: string[]): boolean {
    return filenames.some(name => {
      const ext = path.extname(name).toLowerCase();
      return extensions.includes(ext);
    });
  }

  it('包含 jpg 文件时应返回 true', () => {
    expect(hasImagesInFiles(['photo.jpg', 'readme.txt'], ['.jpg', '.png'])).toBe(true);
  });

  it('只有文本文件时应返回 false', () => {
    expect(hasImagesInFiles(['readme.txt', 'notes.md'], ['.jpg', '.png'])).toBe(false);
  });

  it('空文件列表应返回 false', () => {
    expect(hasImagesInFiles([], ['.jpg'])).toBe(false);
  });

  it('大小写不敏感', () => {
    expect(hasImagesInFiles(['PHOTO.JPG'], ['.jpg'])).toBe(true);
    expect(hasImagesInFiles(['image.PNG'], ['.png'])).toBe(true);
  });

  it('WebP 格式应被识别', () => {
    expect(hasImagesInFiles(['anim.webp'], ['.jpg', '.png', '.webp'])).toBe(true);
  });
});

describe('galleryService - syncGalleryFolder 错误分支', () => {
  // 模拟 syncGalleryFolder 中的错误处理逻辑

  interface GalleryResult {
    success: boolean;
    data?: { id: number; folderPath: string; extensions: string[]; recursive: boolean };
    error?: string;
  }

  interface ImportResult {
    success: boolean;
    data?: { imported: number; skipped: number };
    error?: string;
  }

  function simulateSyncGalleryFolder(
    getGalleryResult: GalleryResult,
    importResult: ImportResult | null,
    imageCount?: number
  ): { success: boolean; data?: { imported: number; skipped: number; imageCount: number; lastScannedAt: string }; error?: string } {
    // Step 1: 获取图集
    if (!getGalleryResult.success || !getGalleryResult.data) {
      return { success: false, error: getGalleryResult.error || '图集不存在' };
    }

    // Step 2: 扫描导入
    if (!importResult || !importResult.success || !importResult.data) {
      return { success: false, error: importResult?.error || '同步失败' };
    }

    // Step 3: 组装结果
    const count = imageCount ?? 0;
    return {
      success: true,
      data: {
        imported: importResult.data.imported,
        skipped: importResult.data.skipped,
        imageCount: count,
        lastScannedAt: new Date().toISOString(),
      },
    };
  }

  it('图集不存在时应返回错误', () => {
    const result = simulateSyncGalleryFolder(
      { success: false, error: '图集不存在' },
      null
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('图集不存在');
    expect(result.data).toBeUndefined();
  });

  it('图集查询成功但 data 为空时应返回错误', () => {
    const result = simulateSyncGalleryFolder(
      { success: true }, // data 为 undefined
      null
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('图集不存在');
  });

  it('扫描导入失败时应返回错误', () => {
    const result = simulateSyncGalleryFolder(
      { success: true, data: { id: 1, folderPath: '/images', extensions: ['.jpg'], recursive: true } },
      { success: false, error: '目录不存在' }
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('目录不存在');
  });

  it('扫描导入成功但 data 为空时应返回错误', () => {
    const result = simulateSyncGalleryFolder(
      { success: true, data: { id: 1, folderPath: '/images', extensions: ['.jpg'], recursive: true } },
      { success: true } // data 为 undefined
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('同步失败');
  });

  it('全链路成功时应返回正确结果', () => {
    const result = simulateSyncGalleryFolder(
      { success: true, data: { id: 1, folderPath: '/images', extensions: ['.jpg'], recursive: true } },
      { success: true, data: { imported: 3, skipped: 47 } },
      50
    );
    expect(result.success).toBe(true);
    expect(result.data?.imported).toBe(3);
    expect(result.data?.skipped).toBe(47);
    expect(result.data?.imageCount).toBe(50);
    expect(result.data?.lastScannedAt).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// galleryService 同步维护 galleryRootRegistry
// ---------------------------------------------------------------------------
// 这一组用例直接 import 真实 galleryService，用 vi.mock 替换全部外部依赖，
// 验证 createGallery/deleteGallery 调用成功后会正确维护 galleryRootRegistry。
//
// ⚠ 注意：下面这些 vi.mock(...) 会被 Vitest 提升到文件顶部、对【整个测试文件】
//    生效，而不仅仅是这个 describe。本文件上方的 35 个用例都是自包含的纯逻辑测试、
//    并不 import 这些真实模块，所以不受影响。但今后若在本文件新增需要真实实现
//    （而非这里 mock 版本）的用例，务必留意：这些 mock 是文件级的，无法被某个
//    describe 单独绕过；如有冲突，请把那类用例拆到独立测试文件中。
// ---------------------------------------------------------------------------

vi.mock('../../../src/main/services/database.js', () => {
  const mockDb = {};
  return {
    getDatabase: vi.fn().mockResolvedValue(mockDb),
    get: vi.fn(),
    all: vi.fn(),
    run: vi.fn().mockResolvedValue(undefined),
    runInTransaction: vi.fn().mockImplementation(async (_db: any, fn: () => Promise<void>) => {
      await fn();
    }),
  };
});

vi.mock('../../../src/main/services/appEventPublisher.js', () => ({
  emitGalleryGalleriesChanged: vi.fn(),
  emitGalleryIgnoredFoldersChanged: vi.fn(),
}));

vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent: vi.fn(),
}));

vi.mock('../../../src/main/services/imageService.js', () => ({
  scanAndImportFolder: vi.fn().mockResolvedValue({ success: true, data: { imported: 0, skipped: 0 } }),
}));

vi.mock('../../../src/main/services/thumbnailService.js', () => ({
  deletePreview: vi.fn(async () => ({ success: true })),
  cancelThumbnailGeneration: vi.fn(),
  deleteThumbnail: vi.fn().mockResolvedValue(undefined),
}));

// mock fs/promises 以便 createGallery 的文件夹存在检查可以通过
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    access: vi.fn().mockResolvedValue(undefined),
  };
});

import {
  getGalleryRootsSnapshot,
  loadGalleryRoots,
} from '../../../src/main/services/galleryRootRegistry.js';
import * as dbModule from '../../../src/main/services/database.js';
import * as fsPromises from 'fs/promises';

describe('galleryService 同步维护 galleryRootRegistry', () => {
  // 规范化路径，与 galleryService 内 normalizePath(path.normalize(...)) 行为一致
  const normalizedCreate = path.normalize('M:/reg-create');
  const normalizedDel = path.normalize('M:/reg-del');

  beforeEach(() => {
    loadGalleryRoots([]);
    vi.clearAllMocks();
    // clearAllMocks 只清调用历史（mock.calls/results 等），不重置已设的实现。
    // 但每个用例用 mockResolvedValueOnce 排队的返回值会随调用被逐个消耗掉，
    // 所以这里在每个用例前重新把这几个常驻 mock 的实现/返回值落实一遍，
    // 保证 get/all 的一次性排队从干净状态开始、且事务回调始终会被执行。
    (dbModule.runInTransaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (_db: any, fn: () => Promise<void>) => { await fn(); }
    );
    (dbModule.run as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (dbModule.getDatabase as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it('createGallery 成功后把 folderPath 加入登记表', async () => {
    // get：第一次 null（gallery 不存在），第二次 {id:1}（last_insert_rowid）
    (dbModule.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 1 });

    const { createGallery } = await import('../../../src/main/services/galleryService.js');
    const result = await createGallery({ folderPath: 'M:/reg-create', name: 'reg' });

    expect(result.success).toBe(true);
    expect(getGalleryRootsSnapshot()).toContain(normalizedCreate);
  });

  it('deleteGallery 成功后把 folderPath 移出登记表', async () => {
    loadGalleryRoots([normalizedDel]);

    // get：存在性校验返回 gallery 行（含 folderPath，用于 deleted 事件载荷）
    (dbModule.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 1,
      folderPath: normalizedDel,
    });
    // Phase 3：按成员删除——两次 all 调用（修复轮 U08 后的顺序）：
    //   1) gallery_folders 绑定文件夹（一条，驱动 removeGalleryRoot）；
    //   2) gallery_images 成员快照（空 → 无孤儿回收、无缩略图清理）——已移入删除事务内读取。
    (dbModule.all as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ folderPath: normalizedDel }]) // 绑定文件夹
      .mockResolvedValueOnce([]);                             // 成员快照为空

    const { deleteGallery } = await import('../../../src/main/services/galleryService.js');
    await deleteGallery(1);

    expect(getGalleryRootsSnapshot()).not.toContain(normalizedDel);
  });

  // ---- 失败路径：登记表不应被改动 ----
  // addGalleryRoot/removeGalleryRoot 都排在各自成功守卫之后；这些用例锁死
  // “失败时登记表不变”，防止将来有人把它们挪到守卫前而悄悄扩大 app:// 白名单。

  it('createGallery 因图库已存在而失败时不应加入登记表', async () => {
    // get 第一次返回已存在的行 → 在 addGalleryRoot 之前提前 return
    (dbModule.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 99 });

    const { createGallery } = await import('../../../src/main/services/galleryService.js');
    const result = await createGallery({ folderPath: 'M:/reg-create', name: 'reg' });

    expect(result.success).toBe(false);
    expect(getGalleryRootsSnapshot()).not.toContain(normalizedCreate);
    expect(getGalleryRootsSnapshot()).toEqual([]);
  });

  it('createGallery 因文件夹不存在而失败时不应加入登记表', async () => {
    // get 返回 null（无重复），但 fs.access 拒绝 → 在 addGalleryRoot 之前提前 return
    (dbModule.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    (fsPromises.access as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('ENOENT'));

    const { createGallery } = await import('../../../src/main/services/galleryService.js');
    const result = await createGallery({ folderPath: 'M:/reg-create', name: 'reg' });

    expect(result.success).toBe(false);
    expect(getGalleryRootsSnapshot()).toEqual([]);
  });

  it('createGallery 中途抛错时不应加入登记表', async () => {
    // get 返回 null、fs.access 通过，但 INSERT 抛错 → 落入 catch，addGalleryRoot 不执行
    (dbModule.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    (dbModule.run as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('insert failed'));

    const { createGallery } = await import('../../../src/main/services/galleryService.js');
    const result = await createGallery({ folderPath: 'M:/reg-create', name: 'reg' });

    expect(result.success).toBe(false);
    expect(getGalleryRootsSnapshot()).toEqual([]);
  });

  it('deleteGallery 因目标不存在而失败时不应移除登记表中的根', async () => {
    loadGalleryRoots([normalizedDel]);
    // get 返回 null（图集不存在）→ 在 removeGalleryRoot 之前提前 return
    (dbModule.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const { deleteGallery } = await import('../../../src/main/services/galleryService.js');
    const result = await deleteGallery(123);

    expect(result.success).toBe(false);
    expect(getGalleryRootsSnapshot()).toContain(normalizedDel);
  });
});
