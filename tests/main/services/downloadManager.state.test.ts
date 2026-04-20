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

  // ====== Bug8: handleDownloadError 不应再用字符串匹配识别中止 ======
  // 反模式：旧实现 isAbortError 只认 'aborted'/'AbortError'，
  // 但 abort 实际可能抛出 ECONNRESET / socket hang up 等错误串。
  // 结果是用户主动暂停的任务被 updateDownloadStatus 覆盖成 'failed'，
  // 出现在"失败"Tab 里。修复后只看 userInterruptedStatuses 即可。
  it('handleDownloadError: 用户暂停后，即使错误串不含 aborted 也不应覆盖为 failed', async () => {
    const { downloadManager, updateDownloadStatus } = await loadModule();
    const controller = new AbortController();

    downloadManager.activeDownloads.clear();
    downloadManager.activeDownloads.set(21, { id: 21, cancelToken: controller });

    await downloadManager.pauseDownload(21);
    // pauseDownload 已写过 paused，清掉调用记录以便检查 failed 是否被写入
    updateDownloadStatus.mockClear();

    // 模拟 abort 抛出的是网络层错误串（不含 aborted / AbortError）
    await downloadManager.handleDownloadError(21, 'ECONNRESET: socket hang up');

    // 关键断言：不应把 paused 覆盖为 failed
    expect(updateDownloadStatus).not.toHaveBeenCalledWith(21, 'failed', expect.anything());
  });

  it('handleDownloadError: 无用户中止标记时，任何错误串都应写入 failed', async () => {
    const { downloadManager, updateDownloadStatus } = await loadModule();

    downloadManager.activeDownloads.clear();
    downloadManager.activeDownloads.set(22, { id: 22, cancelToken: new AbortController() });

    // 没有调用 pauseDownload / cancelDownload，userInterruptedStatuses 为空
    await downloadManager.handleDownloadError(22, 'ECONNRESET: socket hang up');

    expect(updateDownloadStatus).toHaveBeenCalledWith(22, 'failed', 'ECONNRESET: socket hang up');
  });

  // ====== Bug8: cancelDownload 新增行为 ======
  describe('cancelDownload', () => {
    it('对活跃下载应标记 cancelled、abort、清 activeDownloads、写 DB、继续队列', async () => {
      const { downloadManager, updateDownloadStatus } = await loadModule();
      const controller = new AbortController();
      const abortSpy = vi.spyOn(controller, 'abort');

      downloadManager.activeDownloads.clear();
      downloadManager.activeDownloads.set(31, {
        id: 31,
        cancelToken: controller,
        targetPath: '/downloads/sample.jpg',
      });

      // 模拟临时文件不存在（ENOENT），避免真实 fs 操作
      const unlinkSpy = vi.spyOn(fsPromises, 'unlink').mockRejectedValue(
        Object.assign(new Error('missing'), { code: 'ENOENT' })
      );

      const processQueueSpy = vi.spyOn(downloadManager, 'processQueue');

      const result = await downloadManager.cancelDownload(31);

      expect(result).toBe(true);
      expect(abortSpy).toHaveBeenCalledOnce();
      expect(downloadManager.activeDownloads.has(31)).toBe(false);
      expect(downloadManager.userInterruptedStatuses.get(31)).toBe('cancelled');
      expect(updateDownloadStatus).toHaveBeenCalledWith(31, 'cancelled');
      expect(processQueueSpy).toHaveBeenCalled();
      // 清理临时文件路径应带 .part 后缀
      expect(unlinkSpy).toHaveBeenCalled();
      expect(String(unlinkSpy.mock.calls[0]?.[0])).toMatch(/sample\.jpg\.part$/);
    });

    it('对非活跃任务（paused/pending）也可取消，直接写 DB 为 cancelled', async () => {
      const { downloadManager, updateDownloadStatus } = await loadModule();

      downloadManager.activeDownloads.clear();

      const result = await downloadManager.cancelDownload(33);

      expect(result).toBe(true);
      expect(updateDownloadStatus).toHaveBeenCalledWith(33, 'cancelled');
    });

    it('cancelDownload 后 handleDownloadError 收到的 abort 错误不应再覆盖 DB', async () => {
      const { downloadManager, updateDownloadStatus } = await loadModule();
      const controller = new AbortController();

      downloadManager.activeDownloads.clear();
      downloadManager.activeDownloads.set(41, {
        id: 41,
        cancelToken: controller,
        targetPath: '/downloads/cancel.jpg',
      });

      vi.spyOn(fsPromises, 'unlink').mockRejectedValue(
        Object.assign(new Error('missing'), { code: 'ENOENT' })
      );

      await downloadManager.cancelDownload(41);
      updateDownloadStatus.mockClear();

      // 模拟 abort 触发后 startDownload catch 到错误并调到 handleDownloadError
      await downloadManager.handleDownloadError(41, 'aborted');

      // 不应再有 failed / cancelled 覆盖
      expect(updateDownloadStatus).not.toHaveBeenCalledWith(41, 'failed', expect.anything());
    });
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
