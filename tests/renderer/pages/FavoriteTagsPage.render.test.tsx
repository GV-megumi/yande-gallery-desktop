/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { message } from 'antd';
import { FavoriteTagsPage } from '../../../src/renderer/pages/FavoriteTagsPage';

const getFavoriteTagsWithDownloadState = vi.fn();
const getSites = vi.fn();
const getGalleries = vi.fn();
const selectFolder = vi.fn();
const upsertFavoriteTagDownloadBinding = vi.fn();
const getConfig = vi.fn();
const saveConfig = vi.fn();
const getFavoriteTagsPagePreferences = vi.fn();
const saveFavoriteTagsPagePreferences = vi.fn();
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

vi.mock('../../../src/renderer/locales', () => ({
  useLocale: () => ({
    locale: 'zh-CN',
    setLocale: vi.fn(),
    t: (key: string, params?: Record<string, any>) => {
      if (params?.name) return `${key}:${params.name}`;
      if (params?.count !== undefined) return `${key}:${params.count}`;
      if (key === 'favoriteTags.selectFolder') return '选择文件夹';
      return key;
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  const originalGetComputedStyle = window.getComputedStyle.bind(window);
  Object.defineProperty(window, 'getComputedStyle', {
    writable: true,
    value: (element: Element) => originalGetComputedStyle(element),
  });

  (window as any).electronAPI = {
    booru: {
      getFavoriteTagsWithDownloadState,
      getSites,
      addFavoriteTag: vi.fn(),
      updateFavoriteTag: vi.fn(),
      removeFavoriteTag: vi.fn(),
      exportFavoriteTags: vi.fn(),
      importFavoriteTags: vi.fn(),
      startFavoriteTagBulkDownload: vi.fn(),
      upsertFavoriteTagDownloadBinding,
      removeFavoriteTagDownloadBinding: vi.fn(),
      getFavoriteTagDownloadHistory: vi.fn(),
      getGallerySourceFavoriteTags: vi.fn(),
    },
    gallery: {
      getGalleries,
    },
    config: {
      get: getConfig,
      save: saveConfig,
    },
    pagePreferences: {
      favoriteTags: {
        get: getFavoriteTagsPagePreferences,
        save: saveFavoriteTagsPagePreferences,
      },
    },
    system: {
      onBulkDownloadRecordProgress: vi.fn(() => () => {}),
      onBulkDownloadRecordStatus: vi.fn(() => () => {}),
      selectFolder,
    },
  };

  selectFolder.mockResolvedValue({ success: true, data: 'E:/favorite-tags/custom' });
  getConfig.mockResolvedValue({ success: true, data: {} });
  saveConfig.mockResolvedValue({ success: true });
  getFavoriteTagsPagePreferences.mockResolvedValue({ success: true, data: undefined });
  saveFavoriteTagsPagePreferences.mockResolvedValue({ success: true });
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  cleanup();
});

describe('FavoriteTagsPage render behavior', () => {
  const baseTag = {
    id: 1,
    siteId: 1,
    tagName: 'tag_a',
    labels: ['group1'],
    queryType: 'tag',
    notes: 'note',
    sortOrder: 1,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    galleryName: 'Gallery A',
    galleryBindingConsistent: true,
    runtimeProgress: null,
  };

  function mockPageData(items: any[]) {
    getSites.mockResolvedValue({ success: true, data: [{ id: 1, name: 'Yande' }] });
    getGalleries.mockResolvedValue({ success: true, data: [{ id: 1, name: 'Gallery A', folderPath: 'D:/gallery/a' }] });
    getFavoriteTagsWithDownloadState.mockResolvedValue({
      success: true,
      data: {
        items,
        total: items.length,
      },
    });
  }

  it('应渲染下载相关列和收藏标签数据', async () => {
    mockPageData([
      {
        ...baseTag,
        downloadBinding: {
          id: 1,
          favoriteTagId: 1,
          galleryId: 1,
          downloadPath: 'D:/gallery/a',
          enabled: true,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
          lastStatus: 'completed',
        },
      },
    ]);

    render(<FavoriteTagsPage />);

    await waitFor(() => {
      expect(getFavoriteTagsWithDownloadState).toHaveBeenCalled();
    });

    expect(screen.getByText('favoriteTags.count:1')).toBeTruthy();
    expect(screen.getByText('tag a')).toBeTruthy();
    expect(screen.getByText('favoriteTags.completed')).toBeTruthy();
    expect(screen.getByText('common.export')).toBeTruthy();
    expect(screen.getByText('common.import')).toBeTruthy();
  });

  it('图集绑定不一致时应显示 warning 提示', async () => {
    mockPageData([
      {
        ...baseTag,
        tagName: 'tag_b',
        labels: [],
        notes: null,
        galleryName: 'Gallery B',
        galleryBindingConsistent: false,
        galleryBindingMismatchReason: 'pathMismatch',
        downloadBinding: {
          id: 2,
          favoriteTagId: 1,
          galleryId: 2,
          downloadPath: 'D:/wrong',
          enabled: true,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
          lastStatus: 'ready',
        },
      },
    ]);

    render(<FavoriteTagsPage />);

    expect(await screen.findByText('favoriteTags.galleryBindingMismatchAlert')).toBeTruthy();
  });

  it('新建收藏标签弹窗应保留系统关闭按钮', async () => {
    mockPageData([]);

    render(<FavoriteTagsPage />);

    fireEvent.click(await screen.findByText('favoriteTags.add'));

    const dialog = await screen.findByRole('dialog');
    const modal = dialog.closest('.ant-modal');
    expect(modal?.querySelector('.ant-modal-close')).toBeTruthy();
  });

  it('下载配置弹窗应展示手动选择文件夹入口', async () => {
    mockPageData([
      {
        ...baseTag,
        downloadBinding: {
          id: 3,
          favoriteTagId: 1,
          galleryId: null,
          downloadPath: 'D:/downloads/default',
          enabled: true,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
          lastStatus: 'ready',
        },
        resolvedDownloadPath: 'D:/downloads/default',
      },
    ]);

    render(<FavoriteTagsPage />);

    const row = (await screen.findByText('tag a')).closest('tr');
    expect(row).not.toBeNull();

    const configureButton = within(row!).getByRole('button', { name: 'favoriteTags.configureDownload' });
    fireEvent.click(configureButton);

    expect(await screen.findByText('favoriteTags.configTitle:tag_a')).toBeTruthy();
    expect(screen.getByRole('button', { name: '选择文件夹' })).toBeTruthy();

    // 反模式回归守卫：直接读 <input> 的 DOM value，确保绑定路径真的渲染到输入框里
    // 仅依赖 form 内部状态（getFieldsValue）的断言即便 bug 存在也会 PASS
    const dialog = await screen.findByRole('dialog');
    const pathInput = within(dialog).getByLabelText('favoriteTags.downloadPath') as HTMLInputElement;
    await waitFor(() => {
      expect(pathInput.value).toBe('D:/downloads/default');
    });
  });

  it('选择文件夹成功后保存配置应提交用户选择的下载路径', async () => {
    const successSpy = vi.spyOn(message, 'success').mockImplementation(() => undefined as any);
    let resolveSelectFolder!: (value: { success: boolean; data?: string; error?: string }) => void;
    const selectFolderPromise = new Promise<{ success: boolean; data?: string; error?: string }>(resolve => {
      resolveSelectFolder = resolve;
    });
    selectFolder.mockReturnValueOnce(selectFolderPromise);
    upsertFavoriteTagDownloadBinding.mockResolvedValueOnce({ success: true });

    mockPageData([
      {
        ...baseTag,
        downloadBinding: {
          id: 4,
          favoriteTagId: 1,
          galleryId: null,
          downloadPath: 'D:/downloads/default',
          enabled: true,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
          lastStatus: 'ready',
        },
        resolvedDownloadPath: 'D:/downloads/default',
      },
    ]);

    render(<FavoriteTagsPage />);

    const row = (await screen.findByText('tag a')).closest('tr');
    expect(row).not.toBeNull();

    fireEvent.click(within(row!).getByRole('button', { name: 'favoriteTags.configureDownload' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('favoriteTags.configTitle:tag_a')).toBeTruthy();

    // 反模式回归守卫：弹窗打开时，已绑定路径必须显示在实际 <input> 上
    const pathInput = within(dialog).getByLabelText('favoriteTags.downloadPath') as HTMLInputElement;
    await waitFor(() => {
      expect(pathInput.value).toBe('D:/downloads/default');
    });

    fireEvent.click(within(dialog).getByRole('button', { name: '选择文件夹' }));

    await waitFor(() => {
      expect(selectFolder).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      resolveSelectFolder({ success: true, data: 'E:/favorite-tags/custom' });
      await selectFolderPromise;
      await Promise.resolve();
    });

    // 反模式回归守卫：选择文件夹成功后，用户选中的新路径必须写回 <input> value
    // 若只断言 submit payload，setFieldsValue 走 form 内部 store，即便 Input 没接 value 也会 PASS
    await waitFor(() => {
      expect(pathInput.value).toBe('E:/favorite-tags/custom');
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(upsertFavoriteTagDownloadBinding).toHaveBeenCalledWith(expect.objectContaining({
        favoriteTagId: 1,
        galleryId: null,
        downloadPath: 'E:/favorite-tags/custom',
      }));
      expect(successSpy).toHaveBeenCalledWith('favoriteTags.saveConfigSuccess');
    });
  });

  it('选择文件夹失败时应提示错误而不是静默无反馈', async () => {
    const errorSpy = vi.spyOn(message, 'error').mockImplementation(() => undefined as any);
    selectFolder.mockResolvedValueOnce({ success: false, error: 'cancelled' });

    mockPageData([
      {
        ...baseTag,
        downloadBinding: {
          id: 5,
          favoriteTagId: 1,
          galleryId: null,
          downloadPath: 'D:/downloads/default',
          enabled: true,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
          lastStatus: 'ready',
        },
        resolvedDownloadPath: 'D:/downloads/default',
      },
    ]);

    render(<FavoriteTagsPage />);

    const row = (await screen.findByText('tag a')).closest('tr');
    expect(row).not.toBeNull();

    fireEvent.click(within(row!).getByRole('button', { name: 'favoriteTags.configureDownload' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('favoriteTags.configTitle:tag_a')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: '选择文件夹' }));

    await waitFor(() => {
      expect(selectFolder).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith('common.failed: cancelled');
    });
  });

  it('新建下载配置时应展示并提交审查报告要求的默认策略', async () => {
    const successSpy = vi.spyOn(message, 'success').mockImplementation(() => undefined as any);
    upsertFavoriteTagDownloadBinding.mockResolvedValueOnce({ success: true });

    mockPageData([
      {
        ...baseTag,
        downloadBinding: null,
        resolvedDownloadPath: 'D:/downloads/default',
      },
    ]);

    render(<FavoriteTagsPage />);

    const row = (await screen.findByText('tag a')).closest('tr');
    expect(row).not.toBeNull();

    fireEvent.click(within(row!).getByRole('button', { name: 'favoriteTags.configureDownload' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('favoriteTags.configTitle:tag_a')).toBeTruthy();
    expect(within(dialog).getByRole('switch', { name: 'favoriteTags.autoSyncGalleryAfterDownload' }).getAttribute('aria-checked')).toBe('true');
    expect((within(dialog).getByRole('spinbutton', { name: 'favoriteTags.concurrency' }) as HTMLInputElement).value).toBe('6');

    fireEvent.click(within(dialog).getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(upsertFavoriteTagDownloadBinding).toHaveBeenCalledWith(expect.objectContaining({
        favoriteTagId: 1,
        downloadPath: 'D:/downloads/default',
        autoSyncGalleryAfterDownload: true,
        concurrency: 6,
      }));
      expect(successSpy).toHaveBeenCalledWith('favoriteTags.saveConfigSuccess');
    });
  });

  it('已有已保存下载配置值时应优先提交已保存值而不是默认值', async () => {
    const successSpy = vi.spyOn(message, 'success').mockImplementation(() => undefined as any);
    upsertFavoriteTagDownloadBinding.mockResolvedValueOnce({ success: true });

    mockPageData([
      {
        ...baseTag,
        downloadBinding: {
          id: 6,
          favoriteTagId: 1,
          galleryId: null,
          downloadPath: 'D:/downloads/custom',
          enabled: true,
          autoCreateGallery: true,
          autoSyncGalleryAfterDownload: false,
          quality: 'sample',
          perPage: 150,
          concurrency: 2,
          skipIfExists: false,
          notifications: false,
          blacklistedTags: ['tag_x'],
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
          lastStatus: 'ready',
        },
        resolvedDownloadPath: 'D:/downloads/custom',
      },
    ]);

    render(<FavoriteTagsPage />);

    const row = (await screen.findByText('tag a')).closest('tr');
    expect(row).not.toBeNull();

    fireEvent.click(within(row!).getByRole('button', { name: 'favoriteTags.configureDownload' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('favoriteTags.configTitle:tag_a')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(upsertFavoriteTagDownloadBinding).toHaveBeenCalledWith(expect.objectContaining({
        favoriteTagId: 1,
        downloadPath: 'D:/downloads/custom',
        autoCreateGallery: true,
        autoSyncGalleryAfterDownload: false,
        quality: 'sample',
        perPage: 150,
        concurrency: 2,
        skipIfExists: false,
        notifications: false,
        blacklistedTags: ['tag_x'],
      }));
      expect(successSpy).toHaveBeenCalledWith('favoriteTags.saveConfigSuccess');
    });
  });

  it('激活时应通过专用 favoriteTags 页面偏好接口恢复筛选和分页状态，并写回变更', async () => {
    getFavoriteTagsPagePreferences.mockResolvedValueOnce({
      success: true,
      data: {
        filterSiteId: 1,
        sortKey: 'galleryName',
        sortOrder: 'desc',
        keyword: 'persisted keyword',
        page: 3,
        pageSize: 50,
      },
    });

    mockPageData([
      {
        ...baseTag,
        downloadBinding: null,
        resolvedDownloadPath: 'D:/downloads/default',
      },
    ]);

    render(<FavoriteTagsPage active />);

    await waitFor(() => {
      expect(getFavoriteTagsPagePreferences).toHaveBeenCalled();
      expect(getConfig).not.toHaveBeenCalled();
      expect(getFavoriteTagsWithDownloadState).toHaveBeenCalledWith(expect.objectContaining({
        siteId: 1,
        keyword: 'persisted keyword',
        offset: 100,
        limit: 50,
        sortKey: 'galleryName',
        sortOrder: 'desc',
      }));
    });

    await waitFor(() => {
      expect(saveFavoriteTagsPagePreferences).toHaveBeenCalledWith({
        filterSiteId: 1,
        sortKey: 'galleryName',
        sortOrder: 'desc',
        keyword: 'persisted keyword',
        page: 3,
        pageSize: 50,
      });
      expect(saveConfig).not.toHaveBeenCalled();
    });

    fireEvent.change(screen.getByPlaceholderText('favoriteTags.searchInputPlaceholder'), {
      target: { value: 'updated keyword' },
    });

    await waitFor(() => {
      expect(saveFavoriteTagsPagePreferences).toHaveBeenCalledWith(expect.objectContaining({
        keyword: 'updated keyword',
        page: 1,
      }));
      expect(saveConfig).not.toHaveBeenCalled();
    });
  });

  it('非激活状态时不应加载或保存收藏标签页面偏好', async () => {
    mockPageData([]);

    render(<FavoriteTagsPage active={false} />);

    await waitFor(() => {
      expect(getFavoriteTagsPagePreferences).not.toHaveBeenCalled();
      expect(getConfig).not.toHaveBeenCalled();
      expect(getFavoriteTagsWithDownloadState).not.toHaveBeenCalled();
      expect(saveFavoriteTagsPagePreferences).not.toHaveBeenCalled();
      expect(saveConfig).not.toHaveBeenCalled();
    });
  });

  it('重新激活时应先重新 hydrate，再保存新的收藏标签页面偏好', async () => {
    const firstPreferences = {
      filterSiteId: 1,
      sortKey: 'galleryName',
      sortOrder: 'desc',
      keyword: 'first keyword',
      page: 3,
      pageSize: 50,
    };
    const reactivatedPreferences = {
      filterSiteId: 1,
      sortKey: 'lastDownloadedAt',
      sortOrder: 'asc',
      keyword: 'reactivated keyword',
      page: 4,
      pageSize: 100,
    };

    getFavoriteTagsPagePreferences
      .mockResolvedValueOnce({ success: true, data: firstPreferences })
      .mockResolvedValueOnce({ success: true, data: reactivatedPreferences })
      .mockResolvedValue({ success: true, data: undefined });

    mockPageData([{ ...baseTag, downloadBinding: null, resolvedDownloadPath: 'D:/downloads/default' }]);

    const view = render(<FavoriteTagsPage active />);

    await waitFor(() => {
      expect(getFavoriteTagsPagePreferences).toHaveBeenCalledTimes(1);
      expect(getFavoriteTagsWithDownloadState).toHaveBeenCalledWith(expect.objectContaining({
        keyword: 'first keyword',
        offset: 100,
        limit: 50,
        sortKey: 'galleryName',
        sortOrder: 'desc',
      }));
    });

    saveFavoriteTagsPagePreferences.mockClear();
    getFavoriteTagsWithDownloadState.mockClear();

    view.rerender(<FavoriteTagsPage active={false} />);
    view.rerender(<FavoriteTagsPage active />);

    await waitFor(() => {
      expect(getFavoriteTagsPagePreferences).toHaveBeenCalledTimes(2);
      expect(getFavoriteTagsWithDownloadState).toHaveBeenCalledWith(expect.objectContaining({
        keyword: 'reactivated keyword',
        offset: 300,
        limit: 100,
        sortKey: 'lastDownloadedAt',
        sortOrder: 'asc',
      }));
    });

    await waitFor(() => {
      expect(saveFavoriteTagsPagePreferences).toHaveBeenCalledWith(reactivatedPreferences);
      expect(saveConfig).not.toHaveBeenCalled();
    });
  });

});
