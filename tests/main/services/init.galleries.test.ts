import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

/** 每个测试里动态 import 登记表，确保与 init.js 同一模块实例 */
async function getSnapshot(): Promise<string[]> {
  const { getGalleryRootsSnapshot } = await import('../../../src/main/services/galleryRootRegistry.js');
  return getGalleryRootsSnapshot();
}

/** 在每个测试里注册所有 init.ts 的重依赖 */
function mockHeavyDeps(): void {
  vi.doMock('../../../src/main/services/database.js', () => ({
    initDatabase: vi.fn(async () => ({ success: true })),
    closeDatabase: vi.fn(async () => {}),
  }));
  vi.doMock('../../../src/main/services/downloadManager.js', () => ({
    downloadManager: {
      resumePendingDownloads: vi.fn(async () => ({ resumed: 0 })),
      pauseAll: vi.fn(async () => true),
    },
  }));
  vi.doMock('../../../src/main/services/bulkDownloadService.js', () => ({
    resumeRunningSessions: vi.fn(async () => ({ success: true, data: { resumed: 0 } })),
    getActiveBulkDownloadSessions: vi.fn(async () => []),
    pauseBulkDownloadSession: vi.fn(async () => ({ success: true })),
  }));
  vi.doMock('../../../src/main/services/booruService.js', () => ({
    cleanExpiredTags: vi.fn(async () => 0),
  }));
  vi.doMock('../../../src/main/api/apiServiceManager.js', () => ({
    stopApiService: vi.fn(async () => {}),
  }));
}

describe('initGalleriesFromConfig 增量迁移 + 剥离旧配置 + 装载登记表', () => {
  it('增量迁移：DB 已有的图库跳过，仅迁入缺失的图库（DB 非空也迁移）', async () => {
    const cfg: any = {
      galleries: {
        folders: [
          { path: 'M:/existing', name: 'e', autoScan: true, recursive: true, extensions: ['.jpg'] },
          { path: 'M:/new', name: 'n', autoScan: false, recursive: true, extensions: ['.png'] },
        ],
      },
    };
    const saveConfig = vi.fn(async () => ({ success: true }));
    vi.doMock('../../../src/main/services/config.js', () => ({ getConfig: vi.fn(() => cfg), saveConfig }));
    const createGallery = vi.fn(async () => ({ success: true, data: 10 }));
    const getGalleries = vi
      .fn()
      // 第 1 次：取现有图库用于"存在则跳过"
      .mockResolvedValueOnce({ success: true, data: [{ id: 9, folderPath: 'M:/existing' }] })
      // 第 2 次：迁移后按 DB 最新状态装载登记表
      .mockResolvedValueOnce({
        success: true,
        data: [{ id: 9, folderPath: 'M:/existing' }, { id: 10, folderPath: 'M:/new' }],
      });
    vi.doMock('../../../src/main/services/galleryService.js', () => ({ createGallery, getGalleries }));
    vi.doMock('../../../src/main/utils/path.js', () => ({ normalizePath: (p: string) => p }));
    mockHeavyDeps();

    const { initGalleriesFromConfig } = await import('../../../src/main/services/init.js');
    await initGalleriesFromConfig();

    // 只为缺失的 M:/new 建库，M:/existing 跳过
    expect(createGallery).toHaveBeenCalledTimes(1);
    expect(createGallery).toHaveBeenCalledWith(expect.objectContaining({ folderPath: 'M:/new', name: 'n' }));
    expect(await getSnapshot()).toEqual(['M:/existing', 'M:/new']);
  });

  it('DB 为空时全量迁移旧 config.folders 并装载登记表', async () => {
    const cfg: any = { galleries: { folders: [{ path: 'M:/seed', name: 's', autoScan: true, recursive: true, extensions: ['.jpg'] }] } };
    const saveConfig = vi.fn(async () => ({ success: true }));
    vi.doMock('../../../src/main/services/config.js', () => ({ getConfig: vi.fn(() => cfg), saveConfig }));
    const createGallery = vi.fn(async () => ({ success: true, data: 1 }));
    const getGalleries = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockResolvedValueOnce({ success: true, data: [{ id: 1, folderPath: 'M:/seed' }] });
    vi.doMock('../../../src/main/services/galleryService.js', () => ({ createGallery, getGalleries }));
    vi.doMock('../../../src/main/utils/path.js', () => ({ normalizePath: (p: string) => p }));
    mockHeavyDeps();

    const { initGalleriesFromConfig } = await import('../../../src/main/services/init.js');
    await initGalleriesFromConfig();

    expect(createGallery).toHaveBeenCalledTimes(1);
    expect(await getSnapshot()).toEqual(['M:/seed']);
  });

  it('迁移后从内存删除并落盘剥离 config.galleries（saveConfig 持久化）', async () => {
    const cfg: any = { galleries: { folders: [{ path: 'M:/seed', name: 's' }] } };
    const saveConfig = vi.fn(async () => ({ success: true }));
    vi.doMock('../../../src/main/services/config.js', () => ({ getConfig: vi.fn(() => cfg), saveConfig }));
    const createGallery = vi.fn(async () => ({ success: true, data: 1 }));
    const getGalleries = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockResolvedValueOnce({ success: true, data: [{ id: 1, folderPath: 'M:/seed' }] });
    vi.doMock('../../../src/main/services/galleryService.js', () => ({ createGallery, getGalleries }));
    vi.doMock('../../../src/main/utils/path.js', () => ({ normalizePath: (p: string) => p }));
    mockHeavyDeps();

    const { initGalleriesFromConfig } = await import('../../../src/main/services/init.js');
    await initGalleriesFromConfig();

    expect(saveConfig).toHaveBeenCalledTimes(1);
    expect(cfg.galleries).toBeUndefined();
  });

  it('galleries 残留但 folders 为空：不建库但仍落盘剥离旧字段', async () => {
    const cfg: any = { galleries: {} };
    const saveConfig = vi.fn(async () => ({ success: true }));
    vi.doMock('../../../src/main/services/config.js', () => ({ getConfig: vi.fn(() => cfg), saveConfig }));
    const createGallery = vi.fn(async () => ({ success: true, data: 1 }));
    const getGalleries = vi.fn(async () => ({ success: true, data: [{ id: 7, folderPath: 'M:/db' }] }));
    vi.doMock('../../../src/main/services/galleryService.js', () => ({ createGallery, getGalleries }));
    vi.doMock('../../../src/main/utils/path.js', () => ({ normalizePath: (p: string) => p }));
    mockHeavyDeps();

    const { initGalleriesFromConfig } = await import('../../../src/main/services/init.js');
    await initGalleriesFromConfig();

    expect(createGallery).not.toHaveBeenCalled();
    expect(saveConfig).toHaveBeenCalledTimes(1);
    expect(cfg.galleries).toBeUndefined();
    expect(await getSnapshot()).toEqual(['M:/db']);
  });

  it('无 galleries 残留：不迁移、不落盘，仅按 DB 装载登记表', async () => {
    const cfg: any = {};
    const saveConfig = vi.fn(async () => ({ success: true }));
    vi.doMock('../../../src/main/services/config.js', () => ({ getConfig: vi.fn(() => cfg), saveConfig }));
    const createGallery = vi.fn(async () => ({ success: true, data: 1 }));
    const getGalleries = vi.fn(async () => ({ success: true, data: [{ id: 5, folderPath: 'M:/db-only' }] }));
    vi.doMock('../../../src/main/services/galleryService.js', () => ({ createGallery, getGalleries }));
    vi.doMock('../../../src/main/utils/path.js', () => ({ normalizePath: (p: string) => p }));
    mockHeavyDeps();

    const { initGalleriesFromConfig } = await import('../../../src/main/services/init.js');
    await initGalleriesFromConfig();

    expect(createGallery).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
    expect(await getSnapshot()).toEqual(['M:/db-only']);
  });

  it('saveConfig 失败时迁移仍完成并装载登记表，二次启动按路径去重不重复建库', async () => {
    // 模拟"磁盘仍残留旧字段"：saveConfig 失败 → 没能从磁盘剥离 → 下次启动又读到。
    // 每次 getConfig 都返回带 galleries.folders 的新对象，模拟重新读盘。
    const makeCfg = (): any => ({
      galleries: { folders: [{ path: 'M:/seed', name: 's', autoScan: true, recursive: true, extensions: ['.jpg'] }] },
    });
    const saveConfig = vi.fn(async () => ({ success: false, error: 'EACCES' }));
    vi.doMock('../../../src/main/services/config.js', () => ({ getConfig: vi.fn(makeCfg), saveConfig }));

    // 用内存数组模拟 DB galleries 表：createGallery 写入、getGalleries 读出当前状态
    const dbGalleries: Array<{ id: number; folderPath: string }> = [];
    const createGallery = vi.fn(async (dto: { folderPath: string }) => {
      dbGalleries.push({ id: dbGalleries.length + 1, folderPath: dto.folderPath });
      return { success: true, data: dbGalleries.length };
    });
    const getGalleries = vi.fn(async () => ({ success: true, data: dbGalleries.map(g => ({ ...g })) }));
    vi.doMock('../../../src/main/services/galleryService.js', () => ({ createGallery, getGalleries }));
    vi.doMock('../../../src/main/utils/path.js', () => ({ normalizePath: (p: string) => p }));
    mockHeavyDeps();

    const { initGalleriesFromConfig } = await import('../../../src/main/services/init.js');

    // 第一次启动：建库 + saveConfig 失败（仅告警，不抛）+ 仍装载登记表
    await initGalleriesFromConfig();
    expect(createGallery).toHaveBeenCalledTimes(1);
    expect(saveConfig).toHaveBeenCalledTimes(1);
    expect(await getSnapshot()).toEqual(['M:/seed']);

    // 第二次启动：磁盘仍有旧字段（saveConfig 上次失败），但 DB 已含该路径 →
    // 按路径去重，不重复建库；登记表也不出现重复
    await initGalleriesFromConfig();
    expect(createGallery).toHaveBeenCalledTimes(1);
    expect(await getSnapshot()).toEqual(['M:/seed']);
  });

  it('增量迁移用真实 normalizePath 去重：分隔符/末尾斜杠差异视为同一路径', async () => {
    // 本用例特意使用真实 normalizePath（用 importActual 显式注入，避免被其他用例的恒等 mock 影响），
    // 以验证“按归一化路径跳过”的去重分支在真实归一化下成立。
    const { normalizePath: realNormalize } =
      await vi.importActual<typeof import('../../../src/main/utils/path.js')>('../../../src/main/utils/path.js');
    // DB 中已归一化存储的形式
    const canonical = realNormalize('M:/dedup-real');
    // config 给出“脏”变体：末尾多斜杠 + 冗余 . 段，真实 normalizePath 会折叠回 canonical
    const cfg: any = {
      galleries: { folders: [{ path: 'M:/dedup-real/./', name: 'd', autoScan: true, recursive: true, extensions: ['.jpg'] }] },
    };
    const saveConfig = vi.fn(async () => ({ success: true }));
    vi.doMock('../../../src/main/services/config.js', () => ({ getConfig: vi.fn(() => cfg), saveConfig }));
    const createGallery = vi.fn(async () => ({ success: true, data: 1 }));
    const getGalleries = vi.fn(async () => ({ success: true, data: [{ id: 1, folderPath: canonical }] }));
    vi.doMock('../../../src/main/services/galleryService.js', () => ({ createGallery, getGalleries }));
    vi.doMock('../../../src/main/utils/path.js', () => ({ normalizePath: realNormalize }));
    mockHeavyDeps();

    const { initGalleriesFromConfig } = await import('../../../src/main/services/init.js');
    await initGalleriesFromConfig();

    // 脏变体经真实 normalizePath 归一后与 DB 已存路径一致 → 跳过，不重复建库
    expect(createGallery).not.toHaveBeenCalled();
    expect(await getSnapshot()).toEqual([canonical]);
  });
});
