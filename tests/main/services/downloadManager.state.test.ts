import fsPromises from 'fs/promises';
import { Readable } from 'stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('downloadManager 状态语义', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  async function loadModule(options?: {
    booruPost?: { postId: number; fileExt?: string; md5?: string; id?: number; fileUrl?: string };
    site?: { name: string };
    getBooruPostById?: { id: number; fileUrl: string } | null;
    axiosResponse?: { headers?: Record<string, string>; data?: NodeJS.ReadableStream };
    replaceFileWithTemp?: ReturnType<typeof vi.fn>;
  }) {
    const updateDownloadStatus = vi.fn().mockResolvedValue(undefined);
    const getDownloadQueue = vi.fn().mockResolvedValue([]);
    const updateDownloadProgress = vi.fn().mockResolvedValue(undefined);
    const markPostAsDownloaded = vi.fn().mockResolvedValue(undefined);
    const getBooruPostById = vi.fn().mockResolvedValue(options?.getBooruPostById ?? null);
    const getBooruPostBySiteAndId = vi.fn().mockResolvedValue(options?.booruPost ?? null);
    const getBooruSiteById = vi.fn().mockResolvedValue(options?.site ?? { name: 'test-site' });
    const addToDownloadQueue = vi.fn().mockResolvedValue(undefined);

    vi.doMock('electron', () => ({
      BrowserWindow: {
        getAllWindows: () => [],
      },
    }));

    vi.doMock('../../../src/main/services/booruService.js', () => ({
      updateDownloadStatus,
      getDownloadQueue,
      updateDownloadProgress,
      markPostAsDownloaded,
      getBooruPostById,
      getBooruPostBySiteAndId,
      getBooruSiteById,
      addToDownloadQueue,
    }));

    vi.doMock('../../../src/main/services/config.js', () => ({
      getConfig: () => ({
        yande: { maxConcurrentDownloads: 3 },
        booru: {
          download: {
            filenameTemplate: '{site}_{id}.{extension}',
            tokenDefaults: {},
          },
        },
      }),
      getDownloadsPath: () => '/downloads',
      getProxyConfig: () => undefined,
    }));

    vi.doMock('../../../src/main/services/networkScheduler.js', () => ({
      networkScheduler: {
        onChange: vi.fn(),
        isBrowsingActive: vi.fn(() => false),
      },
    }));

    vi.doMock('../../../src/main/services/downloadFileProtocol.js', async () => {
      const actual = await vi.importActual<typeof import('../../../src/main/services/downloadFileProtocol.js')>('../../../src/main/services/downloadFileProtocol.js');
      return {
        ...actual,
        replaceFileWithTemp: options?.replaceFileWithTemp ?? actual.replaceFileWithTemp,
      };
    });

    vi.doMock('axios', () => ({
      default: vi.fn().mockResolvedValue({
        headers: options?.axiosResponse?.headers ?? { 'content-length': '4' },
        data: options?.axiosResponse?.data ?? Readable.from([Buffer.from('done')]),
      }),
    }));

    const mod = await import('../../../src/main/services/downloadManager.js');
    return {
      downloadManager: mod.downloadManager as any,
      updateDownloadStatus,
      updateDownloadProgress,
      markPostAsDownloaded,
      addToDownloadQueue,
      getBooruPostBySiteAndId,
    };
  }

  it('pauseAll 应把活跃任务标记为 paused 而不是 pending', async () => {
    const { downloadManager, updateDownloadStatus } = await loadModule();
    const controller1 = new AbortController();
    const controller2 = new AbortController();
    const abort1 = vi.spyOn(controller1, 'abort');
    const abort2 = vi.spyOn(controller2, 'abort');

    downloadManager.activeDownloads.clear();
    downloadManager.activeDownloads.set(1, { id: 1, cancelToken: controller1 });
    downloadManager.activeDownloads.set(2, { id: 2, cancelToken: controller2 });

    await downloadManager.pauseAll();

    expect(abort1).toHaveBeenCalledOnce();
    expect(abort2).toHaveBeenCalledOnce();
    expect(updateDownloadStatus).toHaveBeenCalledWith(1, 'paused');
    expect(updateDownloadStatus).toHaveBeenCalledWith(2, 'paused');
    expect(downloadManager.activeDownloads.size).toBe(0);
  });

  it('用户主动暂停后，后续 abort 错误不应把任务覆盖成 failed', async () => {
    const { downloadManager, updateDownloadStatus } = await loadModule();
    const controller = new AbortController();

    downloadManager.activeDownloads.clear();
    downloadManager.activeDownloads.set(7, { id: 7, cancelToken: controller });

    await downloadManager.pauseDownload(7);
    await downloadManager.handleDownloadError(7, 'This operation was aborted');

    expect(updateDownloadStatus).toHaveBeenCalledWith(7, 'paused');
    expect(updateDownloadStatus).not.toHaveBeenCalledWith(7, 'failed', 'This operation was aborted');
  });

  it('恢复已暂停任务后，新的非中断错误应正常写入 failed', async () => {
    const { downloadManager, updateDownloadStatus } = await loadModule();
    const controller = new AbortController();

    downloadManager.activeDownloads.clear();
    downloadManager.activeDownloads.set(9, { id: 9, cancelToken: controller });

    await downloadManager.pauseDownload(9);
    await downloadManager.resumeDownload(9);
    await downloadManager.handleDownloadError(9, 'network timeout');

    expect(updateDownloadStatus).toHaveBeenCalledWith(9, 'paused');
    expect(updateDownloadStatus).toHaveBeenCalledWith(9, 'pending');
    expect(updateDownloadStatus).toHaveBeenCalledWith(9, 'failed', 'network timeout');
  });

  it('retryDownload 重试前只应清理 .part 临时文件而不删除最终目标文件', async () => {
    const unlinkSpy = vi.spyOn(fsPromises, 'unlink').mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    const accessSpy = vi.spyOn(fsPromises, 'access').mockResolvedValue(undefined);

    const { downloadManager, addToDownloadQueue } = await loadModule({
      booruPost: {
        postId: 123,
        fileExt: 'jpg',
        md5: 'abc123',
      },
    });

    const result = await downloadManager.retryDownload(123, 5);

    expect(result).toBe(true);
    expect(String(accessSpy.mock.calls[0]?.[0])).toMatch(/[\\/]downloads[\\/]test-site_123\.jpg\.part$/);
    expect(String(unlinkSpy.mock.calls[0]?.[0])).toMatch(/[\\/]downloads[\\/]test-site_123\.jpg\.part$/);
    expect(String(unlinkSpy.mock.calls[0]?.[0])).not.toMatch(/[\\/]downloads[\\/]test-site_123\.jpg$/);
    expect(addToDownloadQueue).toHaveBeenCalledWith(123, 5, 0, expect.stringMatching(/[\\/]downloads[\\/]test-site_123\.jpg$/));
  });

  it('已有最终文件时完成下载应走统一 replace 语义而不是直接 rename', async () => {
    const renameSpy = vi.spyOn(fsPromises, 'rename').mockRejectedValue(Object.assign(new Error('rename should not be called'), { code: 'EEXIST' }));
    const replaceSpy = vi.fn();
    const { downloadManager, updateDownloadStatus, updateDownloadProgress, markPostAsDownloaded } = await loadModule({
      getBooruPostById: {
        id: 99,
        fileUrl: 'https://example.com/image.jpg',
      },
      replaceFileWithTemp: replaceSpy,
    });

    await downloadManager.startDownload({
      id: 1,
      postId: 99,
      targetPath: '/downloads/existing.jpg',
    });

    expect(replaceSpy).toHaveBeenCalledWith('/downloads/existing.jpg.part', '/downloads/existing.jpg');
    expect(renameSpy).not.toHaveBeenCalled();
    expect(updateDownloadStatus).toHaveBeenCalledWith(1, 'completed');
    expect(updateDownloadProgress).toHaveBeenCalledWith(1, 100, 4, 4);
    expect(markPostAsDownloaded).toHaveBeenCalledWith(99, '/downloads/existing.jpg');
  });
});
