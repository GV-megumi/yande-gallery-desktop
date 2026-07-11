/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dropdown, Modal, message } from 'antd';
import { GalleryPage } from '../../../src/renderer/pages/GalleryPage';

const getGalleries = vi.fn();
const getGallery = vi.fn();
const getImagesByGallery = vi.fn();
const getThumbnail = vi.fn();
const deleteGallery = vi.fn();
const getGallerySourceFavoriteTags = vi.fn();
// Phase 7B：GalleryFolderManagerDialog 与进入相册自动扫描、卡片缺失标记所需的新 mock
const getGalleryFolders = vi.fn();
const getMissingGalleryFolders = vi.fn();
// 丢失文件夹横幅「全部迁入无效项」的批量迁移接口
const migrateMissingFolderImages = vi.fn();
const bindFolder = vi.fn();
const unbindFolder = vi.fn();
const changeFolderPath = vi.fn();
const updateGallery = vi.fn();
const syncGalleryFolder = vi.fn();
const getImages = vi.fn();
const searchImages = vi.fn();
const getRecentImages = vi.fn();
const getRecentImagesAfter = vi.fn();
const getConfig = vi.fn();
const saveConfig = vi.fn();
const getGalleryPagePreferences = vi.fn();
const saveGalleryPagePreferences = vi.fn();

vi.mock('../../../src/renderer/components/ImageGrid', () => ({
  ImageGrid: () => <div data-testid="image-grid" />,
}));

vi.mock('../../../src/renderer/components/ImageListWrapper', () => ({
  ImageListWrapper: ({
    children,
    images,
    loading,
    sortBy,
    sortOrder,
  }: {
    children?: React.ReactNode;
    images?: Array<{ id?: number; name?: string }>;
    loading?: boolean;
    sortBy?: string;
    sortOrder?: string;
  }) => (
    <div>
      <div
        data-testid="image-list-wrapper"
        data-loading={loading ? 'true' : 'false'}
        data-image-count={(images || []).length}
        data-sort-by={sortBy ?? ''}
        data-sort-order={sortOrder ?? ''}
      >
        {(images || []).map((image, index) => (
          <div key={image.id ?? index}>{image.name ?? `image-${image.id ?? index}`}</div>
        ))}
      </div>
      {children}
    </div>
  ),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

vi.mock('../../../src/renderer/components/ImageSearchBar', () => ({
  ImageSearchBar: ({ value, onChange, onSearch }: { value?: string; onChange?: (value: string) => void; onSearch?: (value: string) => void }) => (
    <div>
      <input
        aria-label="mock-image-search-bar"
        value={value ?? ''}
        onChange={(event) => onChange?.(event.target.value)}
      />
      <button type="button" onClick={() => onSearch?.(value ?? '')}>搜索</button>
    </div>
  ),
}));

vi.mock('../../../src/renderer/components/LazyLoadFooter', () => ({
  LazyLoadFooter: ({
    current,
    total,
    onLoadMore,
  }: {
    current?: number;
    total?: number;
    onLoadMore?: () => void;
  }) => (
    <button
      type="button"
      data-testid="lazy-load-footer"
      data-current={current}
      data-total={total}
      onClick={onLoadMore}
    >
      加载更多
    </button>
  ),
}));

vi.mock('../../../src/renderer/components/GalleryCoverImage', () => ({
  GalleryCoverImage: ({ thumbnailPath, onInfoClick }: { thumbnailPath?: string | null; onInfoClick?: () => void }) => (
    <div data-testid="gallery-cover-image" data-thumbnail-path={thumbnailPath ?? ''}>
      <button
        type="button"
      onClick={(event) => {
        event.stopPropagation();
        onInfoClick?.();
      }}
    >
      封面
      </button>
    </div>
  ),
}));

vi.mock('../../../src/renderer/components/SkeletonGrid', () => ({
  SkeletonGrid: () => <div data-testid="skeleton-grid" />,
}));

function renderGalleriesPage() {
  return render(<GalleryPage subTab="galleries" />);
}

function renderAllPage() {
  return render(<GalleryPage subTab="all" />);
}

function createGalleryImages(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const id = index + 1;
    return {
      id,
      name: `image-${String(id).padStart(4, '0')}`,
      filename: `image-${String(id).padStart(4, '0')}.jpg`,
      filepath: `D:/gallery/test/image-${String(id).padStart(4, '0')}.jpg`,
      createdAt: `2026-04-14T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
      updatedAt: `2026-04-14T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
    };
  });
}

describe('GalleryPage gallery delete action', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();

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

    getGalleries.mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          name: '测试相册',
          createdAt: '2026-04-14T00:00:00.000Z',
          updatedAt: '2026-04-14T00:00:00.000Z',
          imageCount: 3,
          recursive: true,
          autoScan: false,
        },
      ],
    });
    getThumbnail.mockResolvedValue({ success: false, error: 'no-thumb' });
    deleteGallery.mockResolvedValue({ success: true });
    getImages.mockResolvedValue({ success: true, data: [] });
    searchImages.mockResolvedValue({ success: true, data: [], total: 0 });
    getRecentImages.mockResolvedValue({ success: true, data: [] });
    getRecentImagesAfter.mockResolvedValue({ success: true, data: [] });
    getConfig.mockResolvedValue({ success: true, data: {} });
    saveConfig.mockResolvedValue({ success: true });
    getGalleryPagePreferences.mockResolvedValue({ success: true, data: undefined });
    saveGalleryPagePreferences.mockResolvedValue({ success: true });
    getGallery.mockResolvedValue({
      success: true,
      data: {
        id: 1,
        name: '测试相册',
        folderPath: 'D:/gallery/test',
        createdAt: '2026-04-14T00:00:00.000Z',
        updatedAt: '2026-04-14T00:00:00.000Z',
        imageCount: 3,
        recursive: true,
        autoScan: false,
      },
    });
    getImagesByGallery.mockResolvedValue({ success: true, data: [] });
    getGallerySourceFavoriteTags.mockResolvedValue({
      success: true,
      data: [
        {
          id: 101,
          tagName: 'source_tag',
          downloadBinding: {
            lastStatus: 'completed',
          },
        },
      ],
    });
    // Phase 7B 默认 mock：多文件夹对话框 + 缺失集合 + 文件夹操作 + 自动扫描
    getGalleryFolders.mockResolvedValue({
      success: true,
      data: [{ folderPath: 'D:/gallery/test', recursive: true, extensions: ['.jpg'] }],
    });
    getMissingGalleryFolders.mockResolvedValue([]);
    migrateMissingFolderImages.mockResolvedValue({ success: true, data: { migrated: 0, skipped: 0 } });
    bindFolder.mockResolvedValue({ success: true, data: { imported: 0, skipped: 0 } });
    unbindFolder.mockResolvedValue({ success: true });
    changeFolderPath.mockResolvedValue({ success: true });
    updateGallery.mockResolvedValue({ success: true });
    syncGalleryFolder.mockResolvedValue({ success: true, data: { imported: 0, skipped: 0, imageCount: 3, lastScannedAt: 'x' } });

    (window as any).electronAPI = {
      gallery: {
        getGalleries,
        deleteGallery,
        getGallery,
        getImagesByGallery,
        getRecentImages,
        getRecentImagesAfter,
        getGalleryFolders,
        getMissingGalleryFolders,
        migrateMissingFolderImages,
        bindFolder,
        unbindFolder,
        changeFolderPath,
        updateGallery,
        syncGalleryFolder,
      },
      image: {
        getThumbnail,
      },
      system: {
        showItem: vi.fn(),
        selectFolder: vi.fn(),
      },
      db: {
        getImages,
        searchImages,
      },
      booru: {
        getGallerySourceFavoriteTags,
      },
      config: {
        get: getConfig,
        save: saveConfig,
      },
      pagePreferences: {
        gallery: {
          get: getGalleryPagePreferences,
          save: saveGalleryPagePreferences,
        },
      },
    };
  });

  it('右键相册时应显示编辑和删除操作，并在删除确认后调用删除接口', async () => {
    const confirmSpy = vi.spyOn(Modal, 'confirm').mockImplementation(() => ({
      destroy: vi.fn(),
      update: vi.fn(),
      then: vi.fn(),
    }) as any);

    renderGalleriesPage();

    const galleryName = await screen.findByText('测试相册');
    await userEvent.pointer({
      keys: '[MouseRight]',
      target: galleryName,
    });

    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('编辑')).toBeDefined();
    const deleteItem = within(menu).getByText('删除');

    await userEvent.click(deleteItem);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const confirmConfig = confirmSpy.mock.calls[0]?.[0];
    // bug12：删除相册会级联清理数据库记录与缩略图，并将文件夹加入忽略名单，
    // 但磁盘原图保留。弹窗文案需同时覆盖这几条关键信息。
    expect(confirmConfig?.content).toContain('已忽略文件夹');
    expect(confirmConfig?.content).toContain('磁盘原图不会被删除');

    await confirmConfig?.onOk?.();

    expect(deleteGallery).toHaveBeenCalledWith(1);
  });

  it('删除成功后应刷新相册列表并提示成功', async () => {
    const successSpy = vi.spyOn(message, 'success').mockImplementation(() => undefined as any);
    const confirmSpy = vi.spyOn(Modal, 'confirm').mockImplementation(() => ({
      destroy: vi.fn(),
      update: vi.fn(),
      then: vi.fn(),
    }) as any);

    renderGalleriesPage();

    const galleryName = await screen.findByText('测试相册');
    await userEvent.pointer({ keys: '[MouseRight]', target: galleryName });
    const menu = await screen.findByRole('menu');
    await userEvent.click(within(menu).getByText('删除'));

    const confirmConfig = confirmSpy.mock.calls[0]?.[0];
    await confirmConfig?.onOk?.();

    expect(deleteGallery).toHaveBeenCalledWith(1);
    expect(successSpy).toHaveBeenCalledWith('相册已删除');
    await waitFor(() => {
      expect(getGalleries).toHaveBeenCalledTimes(2);
    });
  });

  it('删除失败时应提示错误且不刷新相册列表', async () => {
    const errorSpy = vi.spyOn(message, 'error').mockImplementation(() => undefined as any);
    const confirmSpy = vi.spyOn(Modal, 'confirm').mockImplementation(() => ({
      destroy: vi.fn(),
      update: vi.fn(),
      then: vi.fn(),
    }) as any);
    deleteGallery.mockResolvedValueOnce({ success: false, error: 'delete failed' });

    renderGalleriesPage();

    const galleryName = await screen.findByText('测试相册');
    await userEvent.pointer({ keys: '[MouseRight]', target: galleryName });
    const menu = await screen.findByRole('menu');
    await userEvent.click(within(menu).getByText('删除'));

    const confirmConfig = confirmSpy.mock.calls[0]?.[0];
    await confirmConfig?.onOk?.();

    expect(deleteGallery).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith('delete failed');
    expect(getGalleries).toHaveBeenCalledTimes(1);
  });

  it('删除接口抛出异常时应提示错误且不刷新相册列表', async () => {
    const errorSpy = vi.spyOn(message, 'error').mockImplementation(() => undefined as any);
    const confirmSpy = vi.spyOn(Modal, 'confirm').mockImplementation(() => ({
      destroy: vi.fn(),
      update: vi.fn(),
      then: vi.fn(),
    }) as any);
    deleteGallery.mockRejectedValueOnce(new Error('boom'));

    renderGalleriesPage();

    const galleryName = await screen.findByText('测试相册');
    await userEvent.pointer({ keys: '[MouseRight]', target: galleryName });
    const menu = await screen.findByRole('menu');
    await userEvent.click(within(menu).getByText('删除'));

    const confirmConfig = confirmSpy.mock.calls[0]?.[0];
    await confirmConfig?.onOk?.();

    expect(deleteGallery).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith('删除相册失败');
    expect(getGalleries).toHaveBeenCalledTimes(1);
  });

  it('编辑相册弹窗应保留系统关闭按钮', async () => {
    renderGalleriesPage();

    const galleryName = await screen.findByText('测试相册');
    await userEvent.pointer({ keys: '[MouseRight]', target: galleryName });
    const menu = await screen.findByRole('menu');
    await userEvent.click(within(menu).getByText('编辑'));

    const dialog = await screen.findByRole('dialog', { name: '编辑相册' });
    const modal = dialog.closest('.ant-modal');
    expect(modal?.querySelector('.ant-modal-close')).toBeTruthy();
  });

  it('相册信息模态框应与悬浮信息面一致展示来源收藏标签', async () => {
    renderGalleriesPage();

    await userEvent.click(await screen.findByRole('button', { name: '封面' }));

    expect(await screen.findByText('相册信息')).toBeTruthy();
    await waitFor(() => {
      expect(getGallerySourceFavoriteTags).toHaveBeenCalledWith(1);
    });
    expect(screen.getByText('来源收藏标签')).toBeTruthy();
    expect(screen.getByText('source_tag')).toBeTruthy();
  });

  it('打开另一个相册信息前应先清空旧的来源收藏标签，避免展示串页数据', async () => {
    getGalleries.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 1,
          name: '测试相册',
          createdAt: '2026-04-14T00:00:00.000Z',
          updatedAt: '2026-04-14T00:00:00.000Z',
          imageCount: 3,
          recursive: true,
          autoScan: false,
        },
        {
          id: 2,
          name: '另一个相册',
          createdAt: '2026-04-14T00:00:00.000Z',
          updatedAt: '2026-04-14T00:00:00.000Z',
          imageCount: 1,
          recursive: false,
          autoScan: false,
        },
      ],
    });
    getGallerySourceFavoriteTags
      .mockResolvedValueOnce({
        success: true,
        data: [
          {
            id: 101,
            tagName: 'source_tag',
            downloadBinding: { lastStatus: 'completed' },
          },
        ],
      })
      .mockImplementationOnce(() => new Promise(() => {}));

    renderGalleriesPage();

    const initialCoverButtons = await screen.findAllByRole('button', { name: '封面' });
    await userEvent.click(initialCoverButtons[0]);
    expect(await screen.findByText('source_tag')).toBeTruthy();

    const coverButtons = await screen.findAllByRole('button', { name: '封面' });
    await userEvent.click(coverButtons[1]);

    await waitFor(() => {
      expect(screen.getByText('相册信息')).toBeTruthy();
    });
    expect(screen.queryByText('source_tag')).toBeNull();
  });

  it('打开信息对话框后再进入详情，详情视图不再拉取来源收藏标签，对话框标签不被污染', async () => {
    // Phase 7B：来源收藏标签只在 GalleryFolderManagerDialog 中展示，详情视图（返回按钮那屏）
    // 不再拉取/显示来源标签。这里验证：对话框展示自己的 modal_tag；随后进入详情视图
    // 不会触发对详情的二次来源标签拉取，对话框里的 modal_tag 不被覆盖。
    const modalTags = createDeferred<{ success: true; data: any[] }>();
    const detailImages = createDeferred<{ success: true; data: any[] }>();

    getGallerySourceFavoriteTags.mockImplementationOnce(() => modalTags.promise);
    getImagesByGallery.mockImplementationOnce(() => detailImages.promise);

    renderGalleriesPage();

    await userEvent.click(await screen.findByRole('button', { name: '封面' }));
    expect(await screen.findByText('相册信息')).toBeTruthy();

    // 对话框只调一次来源标签接口（不再有详情视图的第二次调用）
    await waitFor(() => {
      expect(getGallerySourceFavoriteTags).toHaveBeenCalledTimes(1);
    });

    const galleryNameEntries = await screen.findAllByText('测试相册');
    await userEvent.click(galleryNameEntries[0]);
    expect(await screen.findByRole('button', { name: /返\s*回/ })).toBeTruthy();

    modalTags.resolve({
      success: true,
      data: [{ id: 201, tagName: 'modal_tag', downloadBinding: { lastStatus: 'completed' } }],
    });

    expect(await screen.findByText('modal_tag')).toBeTruthy();

    detailImages.resolve({ success: true, data: [] });

    // 进入详情视图不应再对来源标签接口发起第二次调用
    await waitFor(() => {
      expect(screen.getByText('modal_tag')).toBeTruthy();
    });
    expect(getGallerySourceFavoriteTags).toHaveBeenCalledTimes(1);
  });

  it('打开相册信息弹窗后切到 recent 时应清空旧 modal 标签且返回 galleries 后弹窗不应残留', async () => {
    const modalTags = createDeferred<{ success: true; data: any[] }>();
    getGallerySourceFavoriteTags.mockImplementationOnce(() => modalTags.promise);

    const view = renderGalleriesPage();

    await userEvent.click(await screen.findByRole('button', { name: '封面' }));
    expect(await screen.findByText('相册信息')).toBeTruthy();

    modalTags.resolve({
      success: true,
      data: [{ id: 401, tagName: 'modal_tag', downloadBinding: { lastStatus: 'completed' } }],
    });

    expect(await screen.findByText('modal_tag')).toBeTruthy();

    view.rerender(<GalleryPage subTab="recent" />);

    await waitFor(() => {
      expect(screen.queryByText('modal_tag')).toBeNull();
    });

    view.rerender(<GalleryPage subTab="galleries" />);

    await waitFor(() => {
      expect(screen.queryByText('modal_tag')).toBeNull();
    });
  });

  it('删除当前相册后，晚到的信息请求结果不应回灌弹窗状态', async () => {
    const confirmSpy = vi.spyOn(Modal, 'confirm').mockImplementation(() => ({
      destroy: vi.fn(),
      update: vi.fn(),
      then: vi.fn(),
    }) as any);
    const modalTags = createDeferred<{ success: true; data: any[] }>();
    getGallerySourceFavoriteTags.mockImplementationOnce(() => modalTags.promise);

    renderGalleriesPage();

    await userEvent.click(await screen.findByRole('button', { name: '封面' }));
    expect(await screen.findByText('相册信息')).toBeTruthy();

    const galleryName = await screen.findAllByText('测试相册');
    await userEvent.pointer({ keys: '[MouseRight]', target: galleryName[0] });
    const menu = await screen.findByRole('menu');
    await userEvent.click(within(menu).getByText('删除'));

    const confirmConfig = confirmSpy.mock.calls[0]?.[0];
    await confirmConfig?.onOk?.();

    modalTags.resolve({
      success: true,
      data: [{ id: 501, tagName: 'late_modal_tag', downloadBinding: { lastStatus: 'completed' } }],
    });

    await waitFor(() => {
      expect(screen.queryByText('late_modal_tag')).toBeNull();
    });
  });

  it('all 子页激活时应通过 pagePreferences.gallery 恢复搜索状态且不应在 hydrate 后立即回写相同偏好', async () => {
    getGalleryPagePreferences.mockResolvedValueOnce({
      success: true,
      data: {
        all: {
          searchQuery: 'persisted query',
          isSearchMode: true,
          allPage: 4,
          searchPage: 3,
        },
      },
    });
    searchImages.mockResolvedValueOnce({ success: true, data: [{ id: 11 }], total: 21 });

    renderAllPage();

    await waitFor(() => {
      expect(getGalleryPagePreferences).toHaveBeenCalled();
      expect(searchImages).toHaveBeenCalledWith('persisted query', 3, 20);
    });

    await waitFor(() => {
      expect(saveGalleryPagePreferences).not.toHaveBeenCalled();
    });

    expect(getConfig).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('recent 缓存页从 suspended 恢复时不应重新加载或重置懒加载状态', async () => {
    getRecentImages.mockResolvedValue({
      success: true,
      data: Array.from({ length: 250 }, (_, index) => ({
        id: index + 1,
        name: `recent-${index + 1}`,
        updatedAt: new Date(Date.UTC(2026, 3, 20, 0, 0, 0, 250 - index)).toISOString(),
      })),
    });

    const view = render(<GalleryPage subTab="recent" suspended={false} />);

    expect(await screen.findByText('recent-1')).toBeTruthy();
    expect(screen.queryByText('recent-250')).toBeNull();

    await userEvent.click(screen.getByTestId('lazy-load-footer'));
    expect(await screen.findByText('recent-250')).toBeTruthy();

    expect(getGalleryPagePreferences).toHaveBeenCalledTimes(1);
    expect(getRecentImages).toHaveBeenCalledTimes(1);
    getGalleryPagePreferences.mockClear();
    getRecentImages.mockClear();
    getRecentImagesAfter.mockClear();

    view.rerender(<GalleryPage subTab="recent" suspended={true} />);
    view.rerender(<GalleryPage subTab="recent" suspended={false} />);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(getGalleryPagePreferences).not.toHaveBeenCalled();
    expect(getRecentImages).not.toHaveBeenCalled();
    expect(getRecentImagesAfter).toHaveBeenCalledTimes(1);
    expect(screen.getByText('recent-250')).toBeTruthy();
  });

  it('recent 缓存页恢复时应将新增图片放入独立的 20 张增量块', async () => {
    const baseImages = Array.from({ length: 200 }, (_, index) => ({
      id: 200 - index,
      name: `base-${index + 1}`,
      updatedAt: new Date(Date.UTC(2026, 3, 20, 0, 0, 0, 200 - index)).toISOString(),
    }));
    const newImages = Array.from({ length: 25 }, (_, index) => ({
      id: 300 - index,
      name: `new-${index + 1}`,
      updatedAt: new Date(Date.UTC(2026, 3, 21, 0, 0, 0, 25 - index)).toISOString(),
    }));

    getRecentImages.mockResolvedValueOnce({ success: true, data: baseImages });
    getRecentImagesAfter.mockResolvedValueOnce({ success: true, data: newImages });

    const view = render(<GalleryPage subTab="recent" suspended={false} />);

    expect(await screen.findByText('base-1')).toBeTruthy();
    getRecentImages.mockClear();

    view.rerender(<GalleryPage subTab="recent" suspended={true} />);
    view.rerender(<GalleryPage subTab="recent" suspended={false} />);

    await waitFor(() => {
      expect(screen.getByText('new-1')).toBeTruthy();
      expect(screen.getByText('new-25')).toBeTruthy();
    });

    expect(getRecentImages).not.toHaveBeenCalled();
    expect(getRecentImagesAfter).toHaveBeenCalledWith(
      baseImages[0].updatedAt,
      baseImages[0].id,
      200,
      undefined,
      undefined
    );
    expect(screen.getByText('新· 1')).toBeTruthy();
    expect(screen.getByText('新· 2')).toBeTruthy();
  });

  it('recent 空缓存页恢复时应回退到完整加载', async () => {
    getRecentImages
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockResolvedValueOnce({
        success: true,
        data: [{ id: 1, name: 'first-new-image', updatedAt: '2026-04-21T00:00:00.000Z' }],
      });

    const view = render(<GalleryPage subTab="recent" suspended={false} />);

    await waitFor(() => {
      expect(getRecentImages).toHaveBeenCalledTimes(1);
    });

    getRecentImagesAfter.mockClear();

    view.rerender(<GalleryPage subTab="recent" suspended={true} />);
    view.rerender(<GalleryPage subTab="recent" suspended={false} />);

    expect(await screen.findByText('first-new-image')).toBeTruthy();
    expect(getRecentImages).toHaveBeenCalledTimes(2);
    expect(getRecentImagesAfter).not.toHaveBeenCalled();
  });

  it('recent 缓存页恢复时应分页拉取超过 200 张的新增图片', async () => {
    const baseImages = [{
      id: 1,
      name: 'base-top',
      updatedAt: '2026-04-20T00:00:00.000Z',
    }];
    const firstPage = Array.from({ length: 200 }, (_, index) => ({
      id: 500 - index,
      name: `new-page-1-${index + 1}`,
      updatedAt: new Date(Date.UTC(2026, 3, 21, 0, 0, 0, 250 - index)).toISOString(),
    }));
    const secondPage = Array.from({ length: 50 }, (_, index) => ({
      id: 300 - index,
      name: `new-page-2-${index + 1}`,
      updatedAt: new Date(Date.UTC(2026, 3, 21, 0, 0, 0, 50 - index)).toISOString(),
    }));

    getRecentImages.mockResolvedValueOnce({ success: true, data: baseImages });
    getRecentImagesAfter
      .mockResolvedValueOnce({ success: true, data: firstPage })
      .mockResolvedValueOnce({ success: true, data: secondPage });

    const view = render(<GalleryPage subTab="recent" suspended={false} />);

    expect(await screen.findByText('base-top')).toBeTruthy();
    getRecentImages.mockClear();

    view.rerender(<GalleryPage subTab="recent" suspended={true} />);
    view.rerender(<GalleryPage subTab="recent" suspended={false} />);

    await waitFor(() => {
      expect(screen.getByText('new-page-2-50')).toBeTruthy();
    });

    expect(getRecentImages).not.toHaveBeenCalled();
    expect(getRecentImagesAfter).toHaveBeenCalledTimes(2);
    const lastFirstPageImage = firstPage[firstPage.length - 1];
    expect(getRecentImagesAfter).toHaveBeenLastCalledWith(
      baseImages[0].updatedAt,
      baseImages[0].id,
      200,
      lastFirstPageImage.updatedAt,
      lastFirstPageImage.id
    );
  });

  it('galleries 子页激活时应通过 pagePreferences.gallery 恢复选中相册并重新打开详情视图', async () => {
    getGalleryPagePreferences.mockResolvedValueOnce({
      success: true,
      data: {
        galleries: {
          gallerySearchQuery: '测试',
          gallerySortKey: 'name',
          gallerySortOrder: 'asc',
          selectedGalleryId: 1,
          gallerySort: 'name',
        },
      },
    });

    renderGalleriesPage();

    await waitFor(() => {
      expect(getGalleryPagePreferences).toHaveBeenCalled();
      expect(getGallery).toHaveBeenCalledWith(1);
      expect(getImagesByGallery).toHaveBeenCalledWith(1, 1, 1000);
    });

    expect(await screen.findByRole('button', { name: /返\s*回/ })).toBeTruthy();
    expect(screen.getByText('测试相册')).toBeTruthy();
    expect(saveGalleryPagePreferences).not.toHaveBeenCalled();
    expect(getConfig).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('Bug10 回归：点击返回按钮时应 persistPreferences 带 selectedGalleryId=null 同步落盘', async () => {
    getGalleryPagePreferences.mockResolvedValueOnce({
      success: true,
      data: {
        galleries: {
          gallerySearchQuery: 'keyword',
          gallerySortKey: 'name',
          gallerySortOrder: 'asc',
          selectedGalleryId: 1,
          gallerySort: 'name',
        },
      },
    });

    renderGalleriesPage();

    // 等待 hydrate 自动打开详情视图
    const backButton = await screen.findByRole('button', { name: /返\s*回/ });
    await waitFor(() => {
      expect(getGallery).toHaveBeenCalledWith(1);
    });

    // 清理 hydrate 期间可能的 save 调用记录，专注点击返回后的一次
    saveGalleryPagePreferences.mockClear();

    const user = userEvent.setup();
    await user.click(backButton);

    // 返回按钮 onClick 内 await persistPreferences，断言 save 被调用且 selectedGalleryId 为 null
    await waitFor(() => {
      expect(saveGalleryPagePreferences).toHaveBeenCalled();
    });

    // 找到第一次带 galleries 字段的调用并断言 selectedGalleryId === null
    const callsWithGalleries = saveGalleryPagePreferences.mock.calls.filter(([arg]) => arg?.galleries !== undefined);
    expect(callsWithGalleries.length).toBeGreaterThanOrEqual(1);
    const payload = callsWithGalleries[0][0];
    expect(payload.galleries.selectedGalleryId).toBeNull();
  });

  it('滚动位置记忆：进入相册下拉后返回，列表恢复进入前的滚动位置', async () => {
    // 列表与详情共用同一个页级滚动容器（App 缓存页外壳），用带 overflowY:auto 的
    // 包装 div 模拟它；useViewScrollMemory 按视图分别记住 scrollTop
    render(
      <div data-testid="page-scroller" style={{ overflowY: 'auto' }}>
        <GalleryPage subTab="galleries" />
      </div>,
    );
    const scroller = screen.getByTestId('page-scroller');

    // 列表就绪后滚到 300（模拟用户浏览列表到中部）
    const galleryName = await screen.findByText('测试相册');
    scroller.scrollTop = 300;
    scroller.dispatchEvent(new Event('scroll'));

    // 进入详情：详情视图应从顶部开始，而不是带着列表的 300
    await userEvent.click(galleryName);
    const backButton = await screen.findByRole('button', { name: /返\s*回/ });
    expect(scroller.scrollTop).toBe(0);

    // 详情里下拉到 500 后返回：列表应恢复进入前的 300，而不是详情留下的 500
    scroller.scrollTop = 500;
    scroller.dispatchEvent(new Event('scroll'));
    await userEvent.click(backButton);
    await screen.findByText('测试相册');
    expect(scroller.scrollTop).toBe(300);
  });

  it('切换 subTab 时应等待新子页 hydrate，且不应在 hydrate 后立即回写对应页面偏好', async () => {
    const allPreferences = {
      searchQuery: 'persisted all query',
      isSearchMode: true,
      allPage: 4,
      searchPage: 3,
    };
    const galleriesPreferences = {
      gallerySearchQuery: 'persisted gallery query',
      gallerySortKey: 'name',
      gallerySortOrder: 'asc',
      selectedGalleryId: 1,
      gallerySort: 'name',
    };

    getGalleryPagePreferences
      .mockResolvedValueOnce({
        success: true,
        data: {
          all: allPreferences,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          galleries: galleriesPreferences,
        },
      })
      .mockResolvedValue({ success: true, data: undefined });

    searchImages.mockResolvedValueOnce({ success: true, data: [{ id: 11 }], total: 21 });

    const view = renderAllPage();

    await waitFor(() => {
      expect(searchImages).toHaveBeenCalledWith('persisted all query', 3, 20);
    });

    saveGalleryPagePreferences.mockClear();
    getGallery.mockClear();

    view.rerender(<GalleryPage subTab="galleries" />);

    await waitFor(() => {
      expect(getGallery).toHaveBeenCalledWith(1);
    });

    await waitFor(() => {
      expect(saveGalleryPagePreferences).not.toHaveBeenCalled();
    });

    expect(getConfig).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('galleries 子页停留在列表视图时应通过 pagePreferences.gallery 恢复搜索框和排序控件的持久化值', async () => {
    getGalleryPagePreferences.mockResolvedValueOnce({
      success: true,
      data: {
        galleries: {
          gallerySearchQuery: '测试',
          gallerySortKey: 'name',
          gallerySortOrder: 'asc',
          gallerySort: 'name',
        },
      },
    });

    renderGalleriesPage();

    await waitFor(() => {
      expect((screen.getByPlaceholderText('搜索相册名称...') as HTMLInputElement).value).toBe('测试');
    });

    expect(getGallery).not.toHaveBeenCalled();
    expect(screen.getByText('名字')).toBeTruthy();
    expect(screen.getByText('升序')).toBeTruthy();
    expect(getConfig).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('galleries 子页用户修改搜索关键字后应通过 pagePreferences.gallery 保存新偏好', async () => {
    getGalleryPagePreferences.mockResolvedValueOnce({
      success: true,
      data: {
        galleries: {
          gallerySearchQuery: '测试',
          gallerySortKey: 'name',
          gallerySortOrder: 'asc',
          gallerySort: 'name',
        },
      },
    });

    renderGalleriesPage();

    await waitFor(() => {
      expect((screen.getByPlaceholderText('搜索相册名称...') as HTMLInputElement).value).toBe('测试');
    });

    saveGalleryPagePreferences.mockClear();

    await userEvent.clear(screen.getByPlaceholderText('搜索相册名称...'));
    await userEvent.type(screen.getByPlaceholderText('搜索相册名称...'), '新相册');

    await waitFor(() => {
      expect(saveGalleryPagePreferences).toHaveBeenCalledWith({
        galleries: {
          gallerySearchQuery: '新相册',
          gallerySortKey: 'name',
          gallerySortOrder: 'asc',
          selectedGalleryId: undefined,
          gallerySort: 'name',
          galleryDetailSortOrder: 'asc',
        },
      });
    });

    expect(getConfig).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('galleries 子页重新 hydrate 且未持久化 selectedGalleryId 时应回到列表视图', async () => {
    getGalleryPagePreferences.mockResolvedValueOnce({
      success: true,
      data: {
        galleries: {
          gallerySearchQuery: '测试',
          gallerySortKey: 'name',
          gallerySortOrder: 'asc',
          selectedGalleryId: 1,
          gallerySort: 'name',
        },
      },
    });

    const view = renderGalleriesPage();

    await waitFor(() => {
      expect(getGallery).toHaveBeenCalledWith(1);
    });
    expect(await screen.findByRole('button', { name: /返\s*回/ })).toBeTruthy();

    getGalleryPagePreferences.mockReset();
    getGalleryPagePreferences
      .mockResolvedValueOnce({ success: true, data: undefined })
      .mockResolvedValueOnce({
        success: true,
        data: {
          galleries: {
            gallerySearchQuery: '测试',
            gallerySortKey: 'name',
            gallerySortOrder: 'asc',
            gallerySort: 'name',
          },
        },
      })
      .mockResolvedValue({ success: true, data: undefined });
    getGallery.mockClear();
    getImagesByGallery.mockClear();

    view.rerender(<GalleryPage subTab="recent" />);
    view.rerender(<GalleryPage subTab="galleries" />);

    await waitFor(() => {
      expect((screen.getByPlaceholderText('搜索相册名称...') as HTMLInputElement).value).toBe('测试');
    });

    expect(screen.queryByRole('button', { name: /返\s*回/ })).toBeNull();
    expect(getGallery).not.toHaveBeenCalled();
    expect(getImagesByGallery).not.toHaveBeenCalled();
    expect(getConfig).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('切换子页后再打开新相册时，旧详情请求晚到结果不应污染当前相册', async () => {
    getGalleries.mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          name: '测试相册',
          folderPath: 'D:/gallery/test',
          createdAt: '2026-04-14T00:00:00.000Z',
          updatedAt: '2026-04-14T00:00:00.000Z',
          imageCount: 3,
          recursive: true,
          autoScan: false,
        },
        {
          id: 2,
          name: '另一个相册',
          folderPath: 'D:/gallery/another',
          createdAt: '2026-04-14T00:00:00.000Z',
          updatedAt: '2026-04-14T00:00:00.000Z',
          imageCount: 1,
          recursive: false,
          autoScan: false,
        },
      ],
    });
    getGallery.mockImplementation(async (galleryId: number) => ({
      success: true,
      data: galleryId === 2
        ? {
            id: 2,
            name: '另一个相册',
            folderPath: 'D:/gallery/another',
            createdAt: '2026-04-14T00:00:00.000Z',
            updatedAt: '2026-04-14T00:00:00.000Z',
            imageCount: 1,
            recursive: false,
            autoScan: false,
          }
        : {
            id: 1,
            name: '测试相册',
            folderPath: 'D:/gallery/test',
            createdAt: '2026-04-14T00:00:00.000Z',
            updatedAt: '2026-04-14T00:00:00.000Z',
            imageCount: 3,
            recursive: true,
            autoScan: false,
          },
    }));

    const staleTags = createDeferred<{ success: true; data: any[] }>();
    const freshTags = createDeferred<{ success: true; data: any[] }>();
    const staleImages = createDeferred<{ success: true; data: any[] }>();
    const freshImages = createDeferred<{ success: true; data: any[] }>();

    getGallerySourceFavoriteTags.mockImplementation((galleryId: number) => (
      galleryId === 2 ? freshTags.promise : staleTags.promise
    ));
    getImagesByGallery.mockImplementation((galleryId: number) => (
      galleryId === 2 ? freshImages.promise : staleImages.promise
    ));

    const view = renderGalleriesPage();

    await userEvent.click(await screen.findByText('测试相册'));
    expect(await screen.findByRole('button', { name: /返\s*回/ })).toBeTruthy();

    view.rerender(<GalleryPage subTab="recent" />);
    view.rerender(<GalleryPage subTab="galleries" />);

    await waitFor(() => {
      expect(screen.getByText('另一个相册')).toBeTruthy();
    });

    await userEvent.click(screen.getByText('另一个相册'));
    expect(await screen.findByText('另一个相册')).toBeTruthy();

    freshTags.resolve({
      success: true,
      data: [{ id: 202, tagName: 'fresh_tag', downloadBinding: { lastStatus: 'completed' } }],
    });

    // Phase 7B：详情加载不再先 await 来源收藏标签（对话框自取），因此进入第二个相册会直接
    // 调 getImagesByGallery(2)；这里断言确实带 (2,1,1000) 取了第二个相册（不再耦合旧的「只调 1 次」时序）。
    await waitFor(() => {
      expect(getImagesByGallery).toHaveBeenCalledWith(2, 1, 1000);
    });

    freshImages.resolve({
      success: true,
      data: [{ id: 222, name: 'fresh-image' }],
    });

    await waitFor(() => {
      expect(screen.getByTestId('image-list-wrapper').textContent).toContain('fresh-image');
    });

    staleTags.resolve({
      success: true,
      data: [{ id: 101, tagName: 'stale_tag', downloadBinding: { lastStatus: 'completed' } }],
    });
    staleImages.resolve({
      success: true,
      data: [{ id: 999, name: 'stale-image' }],
    });

    await waitFor(() => {
      expect(screen.queryByText('stale-image')).toBeNull();
    });

    await userEvent.click(screen.getByRole('button', { name: /返\s*回/ }));
    const coverButtons = await screen.findAllByRole('button', { name: '封面' });
    await userEvent.click(coverButtons[1]);

    expect(await screen.findByText('相册信息')).toBeTruthy();
    expect(screen.getByText('fresh_tag')).toBeTruthy();
    expect(screen.queryByText('stale_tag')).toBeNull();
  });

  it('Bug11 反模式守卫：子窗口模式下切换详情排序不应回写 pagePreferences（主窗口 selectedGalleryId 不被污染）', async () => {
    getGalleryPagePreferences.mockResolvedValueOnce({
      success: true,
      data: {
        galleries: {
          gallerySearchQuery: '',
          gallerySortKey: 'updatedAt',
          gallerySortOrder: 'desc',
          gallerySort: 'time',
        },
      },
    });

    render(
      <GalleryPage
        subTab="galleries"
        initialGalleryId={1}
        disablePreferencesPersistence={true}
      />,
    );

    // 等待 hydrate 完成并进入详情视图
    await screen.findByRole('button', { name: /返\s*回/ });
    await waitFor(() => {
      expect(getGallery).toHaveBeenCalledWith(1);
    });

    saveGalleryPagePreferences.mockClear();

    // 在详情视图切换排序（"按文件名"），会触发 gallerySort 变化 →
    // 保存 effect 的默认路径（250ms 防抖）；子窗口模式必须跳过落盘。
    const sortByName = screen.getByText('按文件名');
    await userEvent.click(sortByName);

    // 等待超过 250ms 防抖时间
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(saveGalleryPagePreferences).not.toHaveBeenCalled();
  });

  it('Bug5：相册详情加载多批图片后切换排序字段或顺序，应回到顶部并只渲染首批200张', async () => {
    getGalleryPagePreferences.mockResolvedValueOnce({
      success: true,
      data: {
        galleries: {
          gallerySearchQuery: '',
          gallerySortKey: 'updatedAt',
          gallerySortOrder: 'desc',
          gallerySort: 'time',
        },
      },
    });
    getImagesByGallery.mockResolvedValueOnce({
      success: true,
      data: createGalleryImages(1000),
    });

    render(
      <div data-testid="scroll-host" style={{ overflowY: 'auto', height: 480 }}>
        <GalleryPage subTab="galleries" initialGalleryId={1} />
      </div>,
    );

    await screen.findByRole('button', { name: /返\s*回/ });
    await waitFor(() => {
      expect(screen.getByTestId('image-list-wrapper').getAttribute('data-image-count')).toBe('200');
    });

    const loadMore = screen.getByTestId('lazy-load-footer');
    await userEvent.click(loadMore);
    await userEvent.click(loadMore);
    await userEvent.click(loadMore);
    await userEvent.click(loadMore);

    await waitFor(() => {
      expect(screen.getByTestId('image-list-wrapper').getAttribute('data-image-count')).toBe('1000');
    });

    const scrollHost = screen.getByTestId('scroll-host') as HTMLElement;
    scrollHost.scrollTop = 1200;
    await userEvent.click(screen.getByText('按文件名'));

    await waitFor(() => {
      const wrapper = screen.getByTestId('image-list-wrapper');
      expect(wrapper.getAttribute('data-sort-by')).toBe('name');
      expect(wrapper.getAttribute('data-sort-order')).toBe('asc');
      expect(wrapper.getAttribute('data-image-count')).toBe('200');
    });
    expect(scrollHost.scrollTop).toBe(0);

    scrollHost.scrollTop = 900;
    await userEvent.click(screen.getByRole('button', { name: '切换为降序' }));

    await waitFor(() => {
      const wrapper = screen.getByTestId('image-list-wrapper');
      expect(wrapper.getAttribute('data-sort-order')).toBe('desc');
      expect(wrapper.getAttribute('data-image-count')).toBe('200');
    });
    expect(scrollHost.scrollTop).toBe(0);
  });

  it('Bug5：相册详情应恢复持久化的图片排序顺序', async () => {
    getGalleryPagePreferences.mockResolvedValueOnce({
      success: true,
      data: {
        galleries: {
          gallerySearchQuery: '',
          gallerySortKey: 'updatedAt',
          gallerySortOrder: 'desc',
          gallerySort: 'name',
          galleryDetailSortOrder: 'desc',
        },
      },
    });
    getImagesByGallery.mockResolvedValueOnce({
      success: true,
      data: createGalleryImages(1),
    });

    render(<GalleryPage subTab="galleries" initialGalleryId={1} />);

    await screen.findByRole('button', { name: /返\s*回/ });
    await waitFor(() => {
      const wrapper = screen.getByTestId('image-list-wrapper');
      expect(wrapper.getAttribute('data-sort-by')).toBe('name');
      expect(wrapper.getAttribute('data-sort-order')).toBe('desc');
    });
    expect(screen.getByRole('button', { name: '切换为升序' })).toBeTruthy();
  });

  it('Bug11 反模式守卫：子窗口模式下"返回"= 关窗，不应 persistPreferences 落盘', async () => {
    getGalleryPagePreferences.mockResolvedValueOnce({
      success: true,
      data: {
        galleries: {
          gallerySearchQuery: '',
          gallerySortKey: 'updatedAt',
          gallerySortOrder: 'desc',
          gallerySort: 'time',
        },
      },
    });

    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});

    render(
      <GalleryPage
        subTab="galleries"
        initialGalleryId={1}
        disablePreferencesPersistence={true}
      />,
    );

    const backButton = await screen.findByRole('button', { name: /返\s*回/ });
    await waitFor(() => {
      expect(getGallery).toHaveBeenCalledWith(1);
    });

    saveGalleryPagePreferences.mockClear();

    await userEvent.click(backButton);

    // 等待 onClick 内可能的 await 链
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(saveGalleryPagePreferences).not.toHaveBeenCalled();

    closeSpy.mockRestore();
  });

  it('打开相册详情后直接离开 galleries 时，旧详情请求晚到不应污染其他子页状态', async () => {
    const staleTags = createDeferred<{ success: true; data: any[] }>();
    const staleImages = createDeferred<{ success: true; data: any[] }>();
    const recentImagesDeferred = createDeferred<{ success: true; data: any[] }>();
    getGallerySourceFavoriteTags.mockImplementation(() => staleTags.promise);
    getImagesByGallery.mockImplementation(() => staleImages.promise);
    getRecentImages.mockImplementation(() => recentImagesDeferred.promise);

    const view = renderGalleriesPage();

    await userEvent.click(await screen.findByText('测试相册'));
    expect(await screen.findByRole('button', { name: /返\s*回/ })).toBeTruthy();

    view.rerender(<GalleryPage subTab="recent" />);

    await waitFor(() => {
      expect(screen.getByTestId('image-list-wrapper').getAttribute('data-loading')).toBe('true');
    });
    expect(screen.queryByRole('button', { name: /返\s*回/ })).toBeNull();

    staleTags.resolve({
      success: true,
      data: [{ id: 301, tagName: 'late_tag', downloadBinding: { lastStatus: 'completed' } }],
    });
    staleImages.resolve({
      success: true,
      data: [{ id: 401, name: 'late-image' }],
    });

    await waitFor(() => {
      expect(screen.queryByText('late-image')).toBeNull();
    });
    expect(screen.queryByText('late_tag')).toBeNull();
    expect(screen.queryByRole('button', { name: /返\s*回/ })).toBeNull();
    expect(screen.getByTestId('image-list-wrapper').getAttribute('data-loading')).toBe('true');
  });

  // ===== Phase 7B：相册信息多文件夹管理对话框接入 + 进入相册自动扫描 + 卡片缺失标记 =====

  it('Phase 7B：点击卡片信息图标应打开多文件夹管理对话框并按 getGalleryFolders 列出文件夹', async () => {
    renderGalleriesPage();

    await userEvent.click(await screen.findByRole('button', { name: '封面' }));

    // 新对话框标题「相册信息」，并通过 getGalleryFolders 拉取绑定文件夹
    expect(await screen.findByText('相册信息')).toBeTruthy();
    await waitFor(() => {
      expect(getGalleryFolders).toHaveBeenCalledWith(1);
    });
    expect(await screen.findByText('D:/gallery/test')).toBeTruthy();
  });

  it('Phase 7B：进入 autoScan=true 的相册应自动扫描一次（syncGalleryFolder）', async () => {
    getGalleries.mockResolvedValue({
      success: true,
      data: [{
        id: 7,
        name: '自动扫描相册',
        createdAt: '2026-04-14T00:00:00.000Z',
        updatedAt: '2026-04-14T00:00:00.000Z',
        imageCount: 1,
        recursive: true,
        autoScan: true,
      }],
    });
    getGallery.mockResolvedValue({
      success: true,
      data: {
        id: 7,
        name: '自动扫描相册',
        createdAt: '2026-04-14T00:00:00.000Z',
        updatedAt: '2026-04-14T00:00:00.000Z',
        imageCount: 1,
        recursive: true,
        autoScan: true,
      },
    });

    renderGalleriesPage();

    await userEvent.click(await screen.findByText('自动扫描相册'));
    expect(await screen.findByRole('button', { name: /返\s*回/ })).toBeTruthy();

    await waitFor(() => {
      expect(syncGalleryFolder).toHaveBeenCalledWith(7);
    });
  });

  it('修复轮 U15：退出相册详情后再次进入同一相册应再次触发自动扫描（按次进入语义）', async () => {
    getGalleries.mockResolvedValue({
      success: true,
      data: [{
        id: 7,
        name: '自动扫描相册',
        createdAt: '2026-04-14T00:00:00.000Z',
        updatedAt: '2026-04-14T00:00:00.000Z',
        imageCount: 1,
        recursive: true,
        autoScan: true,
      }],
    });
    getGallery.mockResolvedValue({
      success: true,
      data: {
        id: 7,
        name: '自动扫描相册',
        createdAt: '2026-04-14T00:00:00.000Z',
        updatedAt: '2026-04-14T00:00:00.000Z',
        imageCount: 1,
        recursive: true,
        autoScan: true,
      },
    });

    renderGalleriesPage();

    // 第一次进入：触发一次自动扫描
    await userEvent.click(await screen.findByText('自动扫描相册'));
    expect(await screen.findByRole('button', { name: /返\s*回/ })).toBeTruthy();
    await waitFor(() => {
      expect(syncGalleryFolder).toHaveBeenCalledTimes(1);
    });

    // 返回列表：离开详情会清空「本次进入」自动扫描记录
    await userEvent.click(screen.getByRole('button', { name: /返\s*回/ }));
    expect(await screen.findByText('自动扫描相册')).toBeTruthy();

    // 再次进入同一相册：自动扫描按「每次进入」语义应再次触发
    await userEvent.click(screen.getByText('自动扫描相册'));
    await waitFor(() => {
      expect(syncGalleryFolder).toHaveBeenCalledTimes(2);
    });
  });

  it('修复轮 U15：同一次进入内自动扫描回灌重载不应重复触发扫描', async () => {
    getGalleries.mockResolvedValue({
      success: true,
      data: [{
        id: 7,
        name: '自动扫描相册',
        createdAt: '2026-04-14T00:00:00.000Z',
        updatedAt: '2026-04-14T00:00:00.000Z',
        imageCount: 1,
        recursive: true,
        autoScan: true,
      }],
    });
    getGallery.mockResolvedValue({
      success: true,
      data: {
        id: 7,
        name: '自动扫描相册',
        createdAt: '2026-04-14T00:00:00.000Z',
        updatedAt: '2026-04-14T00:00:00.000Z',
        imageCount: 1,
        recursive: true,
        autoScan: true,
      },
    });
    // imported > 0 时 autoScanGalleryOnEnter 会回灌调用 loadGalleryImages，
    // 该重载属于同一次进入，不应再次触发 syncGalleryFolder
    syncGalleryFolder.mockResolvedValue({
      success: true,
      data: { imported: 2, skipped: 0, imageCount: 3, lastScannedAt: 'x' },
    });

    renderGalleriesPage();

    await userEvent.click(await screen.findByText('自动扫描相册'));
    expect(await screen.findByRole('button', { name: /返\s*回/ })).toBeTruthy();

    await waitFor(() => {
      expect(syncGalleryFolder).toHaveBeenCalledTimes(1);
    });
    // 给回灌重载留出时间：若守卫按 runId 而非「本次进入」判定，这里会出现第二次扫描
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(syncGalleryFolder).toHaveBeenCalledTimes(1);
  });

  it('Phase 7B：进入 autoScan=false 的相册不应自动扫描', async () => {
    // 默认 getGalleries/getGallery 返回 autoScan:false 的「测试相册」(id=1)
    renderGalleriesPage();

    await userEvent.click(await screen.findByText('测试相册'));
    expect(await screen.findByRole('button', { name: /返\s*回/ })).toBeTruthy();

    // 给足够时间让任何潜在自动扫描触发；autoScan=false 时不应调用
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(syncGalleryFolder).not.toHaveBeenCalled();
  });

  it('Phase 7B：getMissingGalleryFolders 命中的相册卡片应显示「文件夹丢失」标记', async () => {
    getMissingGalleryFolders.mockResolvedValue([{ galleryId: 1, folderPath: 'D:/gallery/test' }]);

    renderGalleriesPage();

    expect(await screen.findByText('测试相册')).toBeTruthy();
    await waitFor(() => {
      expect(getMissingGalleryFolders).toHaveBeenCalled();
    });
    expect(await screen.findByText('文件夹丢失')).toBeTruthy();
  });

  // ===== 丢失文件夹横幅：详情页三选项（去重定位 / 全部迁入无效项 / 忽略） =====

  const missingBannerGallery = {
    id: 9,
    name: '丢失横幅相册',
    createdAt: '2026-04-14T00:00:00.000Z',
    updatedAt: '2026-04-14T00:00:00.000Z',
    imageCount: 2,
    recursive: true,
    autoScan: false,
  };

  function mockMissingBannerGallery(missingPaths: string[]) {
    getGalleries.mockResolvedValue({ success: true, data: [missingBannerGallery] });
    getGallery.mockResolvedValue({ success: true, data: missingBannerGallery });
    getMissingGalleryFolders.mockResolvedValue(
      missingPaths.map((folderPath) => ({ galleryId: 9, folderPath, galleryName: '丢失横幅相册' }))
    );
  }

  it('丢失文件夹横幅：进入命中相册展示缺失路径，「去重定位」触发 onOpenRelocate', async () => {
    mockMissingBannerGallery(['D:/lost/a']);
    const onOpenRelocate = vi.fn();
    render(<GalleryPage subTab="galleries" onOpenRelocate={onOpenRelocate} />);

    await userEvent.click(await screen.findByText('丢失横幅相册'));

    expect(await screen.findByText(/1 个绑定文件夹在磁盘上不存在/)).toBeTruthy();
    expect(screen.getByText('D:/lost/a')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /去重定位/ }));
    expect(onOpenRelocate).toHaveBeenCalledTimes(1);
  });

  it('丢失文件夹横幅：「全部迁入无效项」确认后逐文件夹调用批量迁移并关闭横幅', async () => {
    mockMissingBannerGallery(['D:/lost/a', 'D:/lost/b']);
    migrateMissingFolderImages.mockResolvedValue({ success: true, data: { migrated: 2, skipped: 0 } });
    renderGalleriesPage();

    await userEvent.click(await screen.findByText('丢失横幅相册'));
    expect(await screen.findByText(/2 个绑定文件夹在磁盘上不存在/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /全部迁入无效项/ }));
    await userEvent.click(await screen.findByRole('button', { name: /^迁\s*入$/ }));

    await waitFor(() => {
      expect(migrateMissingFolderImages).toHaveBeenCalledWith(9, 'D:/lost/a');
      expect(migrateMissingFolderImages).toHaveBeenCalledWith(9, 'D:/lost/b');
    });
    // 迁移是明确处置：横幅随之关闭
    await waitFor(() => {
      expect(screen.queryByText(/绑定文件夹在磁盘上不存在/)).toBeNull();
    });
  });

  it('丢失文件夹横幅：全部迁移失败时不关闭横幅（保留重试入口）', async () => {
    mockMissingBannerGallery(['D:/lost/a', 'D:/lost/b']);
    migrateMissingFolderImages.mockResolvedValue({ success: false, error: '该文件夹不是此相册的绑定文件夹' });
    renderGalleriesPage();

    await userEvent.click(await screen.findByText('丢失横幅相册'));
    expect(await screen.findByText(/2 个绑定文件夹在磁盘上不存在/)).toBeTruthy();

    const galleriesCallsBefore = getGalleries.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: /全部迁入无效项/ }));
    await userEvent.click(await screen.findByRole('button', { name: /^迁\s*入$/ }));

    await waitFor(() => {
      expect(migrateMissingFolderImages).toHaveBeenCalledTimes(2);
    });
    // dismiss 决策在批量调用全部返回后同步做出、随后才刷新列表；等到列表重新拉取
    // 说明 handler 已走完（不依赖 antd 静态 message 容器，避免跨用例顺序抖动）
    await waitFor(() => {
      expect(getGalleries.mock.calls.length).toBeGreaterThan(galleriesCallsBefore);
    });
    // 全部失败不算「已处置」：横幅必须留着（GalleryPage 常驻缓存，dismissed 活一整个会话，
    // 关掉等于让用户失去该场景的主要处置入口）
    expect(screen.getByText(/2 个绑定文件夹在磁盘上不存在/)).toBeTruthy();
  });

  it('丢失文件夹横幅：未提供 onOpenRelocate（子窗口）时不渲染「去重定位」；忽略后横幅关闭', async () => {
    mockMissingBannerGallery(['D:/lost/a']);
    renderGalleriesPage();

    await userEvent.click(await screen.findByText('丢失横幅相册'));
    expect(await screen.findByText(/1 个绑定文件夹在磁盘上不存在/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /去重定位/ })).toBeNull();

    // 忽略（关闭横幅）
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    await waitFor(() => {
      expect(screen.queryByText(/绑定文件夹在磁盘上不存在/)).toBeNull();
    });
  });
});

describe('GalleryPage app event refresh', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();

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

    getGalleries.mockResolvedValue({ success: true, data: [] });
    getGallery.mockResolvedValue({ success: true, data: undefined });
    getImagesByGallery.mockResolvedValue({ success: true, data: [] });
    getThumbnail.mockResolvedValue({ success: false, error: 'no-thumb' });
    deleteGallery.mockResolvedValue({ success: true });
    getGallerySourceFavoriteTags.mockResolvedValue({ success: true, data: [] });
    getImages.mockResolvedValue({ success: true, data: [] });
    searchImages.mockResolvedValue({ success: true, data: [], total: 0 });
    getRecentImages.mockResolvedValue({ success: true, data: [] });
    getRecentImagesAfter.mockResolvedValue({ success: true, data: [] });
    getConfig.mockResolvedValue({ success: true, data: {} });
    saveConfig.mockResolvedValue({ success: true });
    getGalleryPagePreferences.mockResolvedValue({ success: true, data: undefined });
    saveGalleryPagePreferences.mockResolvedValue({ success: true });
    getGalleryFolders.mockResolvedValue({ success: true, data: [] });
    getMissingGalleryFolders.mockResolvedValue([]);
    migrateMissingFolderImages.mockResolvedValue({ success: true, data: { migrated: 0, skipped: 0 } });
    bindFolder.mockResolvedValue({ success: true, data: { imported: 0, skipped: 0 } });
    unbindFolder.mockResolvedValue({ success: true });
    changeFolderPath.mockResolvedValue({ success: true });
    updateGallery.mockResolvedValue({ success: true });
    syncGalleryFolder.mockResolvedValue({ success: true, data: { imported: 0, skipped: 0, imageCount: 0, lastScannedAt: 'x' } });

    (window as any).electronAPI = {
      gallery: {
        getGalleries,
        deleteGallery,
        getGallery,
        getImagesByGallery,
        getRecentImages,
        getRecentImagesAfter,
        getGalleryFolders,
        getMissingGalleryFolders,
        migrateMissingFolderImages,
        bindFolder,
        unbindFolder,
        changeFolderPath,
        updateGallery,
        syncGalleryFolder,
      },
      image: {
        getThumbnail,
      },
      system: {
        showItem: vi.fn(),
        selectFolder: vi.fn(),
      },
      db: {
        getImages,
        searchImages,
      },
      booru: {
        getGallerySourceFavoriteTags,
      },
      config: {
        get: getConfig,
        save: saveConfig,
      },
      pagePreferences: {
        gallery: {
          get: getGalleryPagePreferences,
          save: saveGalleryPagePreferences,
        },
      },
    };
  });

  it('recent 页收到 gallery:images-imported 事件后应走游标增量刷新', async () => {
    let appEventCallback: ((event: any) => void) | undefined;
    (window as any).electronAPI.system.onAppEvent = vi.fn((callback) => {
      appEventCallback = callback;
      return vi.fn();
    });

    const baseImages = [{
      id: 10,
      name: 'base-top-for-event',
      updatedAt: '2026-04-20T00:00:00.000Z',
    }];
    const newImages = [{
      id: 11,
      name: 'event-new-image',
      updatedAt: '2026-04-21T00:00:00.000Z',
    }];
    getRecentImages.mockResolvedValueOnce({ success: true, data: baseImages });
    getRecentImagesAfter.mockResolvedValueOnce({ success: true, data: newImages });

    render(<GalleryPage subTab="recent" suspended={false} />);

    expect(await screen.findByText('base-top-for-event')).toBeTruthy();
    getRecentImagesAfter.mockClear();

    act(() => {
      appEventCallback?.({
        type: 'gallery:images-imported',
        version: 1,
        occurredAt: '2026-04-24T00:00:00.000Z',
        source: 'galleryService',
        payload: {
          folderPath: 'D:/gallery',
          imported: 1,
          skipped: 0,
          reason: 'scanAndImportFolder',
        },
      });
    });

    await waitFor(() => {
      expect(getRecentImagesAfter).toHaveBeenCalledWith(
        baseImages[0].updatedAt,
        baseImages[0].id,
        200,
        undefined,
        undefined
      );
    });
    expect(await screen.findByText('event-new-image')).toBeTruthy();
  });

  it('recent page removes visible images after gallery:images-changed deleted event', async () => {
    let appEventCallback: ((event: any) => void) | undefined;
    (window as any).electronAPI.system.onAppEvent = vi.fn((callback) => {
      appEventCallback = callback;
      return vi.fn();
    });

    getRecentImages.mockResolvedValueOnce({
      success: true,
      data: [{
        id: 21,
        name: 'delete-event-image',
        updatedAt: '2026-04-22T00:00:00.000Z',
      }],
    });

    render(<GalleryPage subTab="recent" suspended={false} />);

    expect(await screen.findByText('delete-event-image')).toBeTruthy();

    act(() => {
      appEventCallback?.({
        type: 'gallery:images-changed',
        version: 1,
        occurredAt: '2026-04-24T00:00:00.000Z',
        source: 'imageService',
        payload: {
          action: 'deleted',
          imageId: 21,
          affectedImageIds: [21],
          affectedCount: 1,
          reason: 'userDelete',
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByText('delete-event-image')).toBeNull();
    });
  });

  it('suspended 的 recent 页不应订阅 gallery:images-imported 事件', () => {
    let appEventCallback: ((event: any) => void) | undefined;
    const onAppEvent = vi.fn((callback) => {
      appEventCallback = callback;
      return vi.fn();
    });
    (window as any).electronAPI.system.onAppEvent = onAppEvent;

    render(<GalleryPage subTab="recent" suspended />);

    // 两个传输层订阅：gallery:paths-relocated 全量失效订阅（修复轮 U11，不随 suspended
    // 挂起）在前，域事件订阅在后——appEventCallback 捕获到的是后注册的域事件回调
    expect(onAppEvent).toHaveBeenCalledTimes(2);
    getRecentImagesAfter.mockClear();

    act(() => {
      appEventCallback?.({
        type: 'gallery:images-imported',
        version: 1,
        occurredAt: '2026-04-24T00:00:00.000Z',
        source: 'galleryService',
        payload: {
          folderPath: 'D:/gallery',
          imported: 1,
          skipped: 0,
          reason: 'scanAndImportFolder',
        },
      });
    });

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(getRecentImagesAfter).not.toHaveBeenCalled();
        resolve();
      }, 250);
    });
  });

  it('does not replay gallery events received while recent page is suspended', async () => {
    let appEventCallback: ((event: any) => void) | undefined;
    (window as any).electronAPI.system.onAppEvent = vi.fn((callback) => {
      appEventCallback = callback;
      return vi.fn();
    });

    const baseImages = [{
      id: 31,
      name: 'cached-recent-image',
      updatedAt: '2026-04-20T00:00:00.000Z',
    }];
    getRecentImages.mockResolvedValueOnce({ success: true, data: baseImages });
    getRecentImagesAfter.mockResolvedValue({ success: true, data: [] });

    const view = render(<GalleryPage subTab="recent" suspended={false} />);

    expect(await screen.findByText('cached-recent-image')).toBeTruthy();
    getRecentImagesAfter.mockClear();

    view.rerender(<GalleryPage subTab="recent" suspended />);

    act(() => {
      appEventCallback?.({
        type: 'gallery:images-imported',
        version: 1,
        occurredAt: '2026-04-24T00:00:00.000Z',
        source: 'galleryService',
        payload: {
          folderPath: 'D:/gallery',
          imported: 1,
          skipped: 0,
          reason: 'scanAndImportFolder',
        },
      });
    });

    view.rerender(<GalleryPage subTab="recent" suspended={false} />);

    await waitFor(() => {
      expect(getRecentImagesAfter).toHaveBeenCalledTimes(1);
    });

    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(getRecentImagesAfter).toHaveBeenCalledTimes(1);
  });

  // 修复轮 U11：重定位根目录（applyRelocateRoot）成功后主进程广播 gallery:paths-relocated。
  // 重定位只改路径字符串、不动 updatedAt，「最近」的增量游标与各按 id 补丁事件都感知不到，
  // 本页必须整体失效：挂起态（用户停在设置页应用重定位）作废水合标记、恢复激活时完整重新
  // 初始化；激活态（如相册子窗口）立即重载。
  it('suspended 期间收到 gallery:paths-relocated → 恢复激活时完整重新初始化而非增量游标', async () => {
    // 该事件订阅不随 suspended 挂起，页面存在两个 onAppEvent 订阅（域事件 + 重定位失效），
    // 按真实 preload 多路分发语义收集全部回调并逐一派发
    const appEventCallbacks: Array<(event: any) => void> = [];
    (window as any).electronAPI.system.onAppEvent = vi.fn((callback) => {
      appEventCallbacks.push(callback);
      return vi.fn();
    });

    getRecentImages.mockResolvedValueOnce({
      success: true,
      data: [{ id: 51, name: 'stale-old-path-image', updatedAt: '2026-04-20T00:00:00.000Z' }],
    });

    const view = render(<GalleryPage subTab="recent" suspended={false} />);
    expect(await screen.findByText('stale-old-path-image')).toBeTruthy();
    expect(getRecentImages).toHaveBeenCalledTimes(1);

    // 用户切到设置页（本页进入导航缓存挂起态），此时应用重定位
    view.rerender(<GalleryPage subTab="recent" suspended />);

    // 非 Once：避免断言失败时残留的 once 队列泄漏到后续用例（beforeEach 会重置默认实现）
    getRecentImages.mockResolvedValue({
      success: true,
      data: [{ id: 51, name: 'relocated-fresh-image', updatedAt: '2026-04-20T00:00:00.000Z' }],
    });
    getRecentImagesAfter.mockClear();

    act(() => {
      appEventCallbacks.forEach((callback) => callback({
        type: 'gallery:paths-relocated',
        version: 1,
        occurredAt: '2026-07-02T00:00:00.000Z',
        source: 'galleryRelocateService',
        payload: { affected: [{ table: 'images', column: 'filepath', count: 1 }], totalCount: 1 },
      }));
    });

    // 挂起期间只作废水合标记，不发起任何拉取
    expect(getRecentImages).toHaveBeenCalledTimes(1);

    // 切回图库页：完整重新初始化（重新 getRecentImages），而不是 updatedAt 游标增量
    //（重定位不改 updatedAt，游标路径什么都看不到——正是缺陷场景）
    view.rerender(<GalleryPage subTab="recent" suspended={false} />);

    expect(await screen.findByText('relocated-fresh-image')).toBeTruthy();
    expect(getRecentImages).toHaveBeenCalledTimes(2);
    expect(getRecentImagesAfter).not.toHaveBeenCalled();
  });

  it('激活态的 galleries 页收到 gallery:paths-relocated → 立即重载相册列表与缺失文件夹集合', async () => {
    const appEventCallbacks: Array<(event: any) => void> = [];
    (window as any).electronAPI.system.onAppEvent = vi.fn((callback) => {
      appEventCallbacks.push(callback);
      return vi.fn();
    });

    getGalleries.mockResolvedValue({
      success: true,
      data: [{ id: 1, name: 'relocate-gallery', imageCount: 1, createdAt: '2026-04-20', updatedAt: '2026-04-20' }],
    });

    render(<GalleryPage subTab="galleries" suspended={false} />);

    await waitFor(() => {
      expect(getGalleries).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(getMissingGalleryFolders).toHaveBeenCalledTimes(1);
    });

    act(() => {
      appEventCallbacks.forEach((callback) => callback({
        type: 'gallery:paths-relocated',
        version: 1,
        occurredAt: '2026-07-02T00:00:00.000Z',
        source: 'galleryRelocateService',
        payload: { affected: [{ table: 'gallery_folders', column: 'folderPath', count: 1 }], totalCount: 1 },
      }));
    });

    // 相册列表与「文件夹丢失」标记集合都按新路径重新拉取（丢失标记应随重定位消失）
    await waitFor(() => {
      expect(getGalleries).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(getMissingGalleryFolders).toHaveBeenCalledTimes(2);
    });
  });

  it('clears pending recent refresh timer when leaving recent page', async () => {
    let appEventCallback: ((event: any) => void) | undefined;
    (window as any).electronAPI.system.onAppEvent = vi.fn((callback) => {
      appEventCallback = callback;
      return vi.fn();
    });

    const baseImages = [{
      id: 41,
      name: 'recent-before-tab-change',
      updatedAt: '2026-04-20T00:00:00.000Z',
    }];
    getRecentImages.mockResolvedValueOnce({ success: true, data: baseImages });
    getRecentImagesAfter.mockResolvedValue({ success: true, data: [] });

    const view = render(<GalleryPage subTab="recent" suspended={false} />);

    expect(await screen.findByText('recent-before-tab-change')).toBeTruthy();
    getRecentImagesAfter.mockClear();

    act(() => {
      appEventCallback?.({
        type: 'gallery:images-imported',
        version: 1,
        occurredAt: '2026-04-24T00:00:00.000Z',
        source: 'galleryService',
        payload: {
          folderPath: 'D:/gallery',
          imported: 1,
          skipped: 0,
          reason: 'scanAndImportFolder',
        },
      });
    });

    view.rerender(<GalleryPage subTab="all" suspended={false} />);

    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(getRecentImagesAfter).not.toHaveBeenCalled();
  });

  it('clears pending galleries refresh timer when leaving galleries page', async () => {
    let appEventCallback: ((event: any) => void) | undefined;
    (window as any).electronAPI.system.onAppEvent = vi.fn((callback) => {
      appEventCallback = callback;
      return vi.fn();
    });

    getGalleries.mockResolvedValueOnce({
      success: true,
      data: [{
        id: 51,
        name: 'gallery-before-tab-change',
        createdAt: '2026-04-14T00:00:00.000Z',
        updatedAt: '2026-04-14T00:00:00.000Z',
        imageCount: 1,
        recursive: true,
        autoScan: false,
      }],
    });

    const view = render(<GalleryPage subTab="galleries" suspended={false} />);

    expect(await screen.findByText('gallery-before-tab-change')).toBeTruthy();
    getGalleries.mockClear();

    act(() => {
      appEventCallback?.({
        type: 'gallery:galleries-changed',
        version: 1,
        occurredAt: '2026-04-24T00:00:00.000Z',
        source: 'galleryService',
        payload: {
          action: 'statsUpdated',
          galleryId: 51,
          affectedCount: 1,
        },
      });
    });

    view.rerender(<GalleryPage subTab="recent" suspended={false} />);

    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(getGalleries).not.toHaveBeenCalled();
  });

  it('galleries 子页应在 thumbnail:generated 事件后补上封面缩略图', async () => {
    let appEventCallback: ((event: any) => void) | undefined;
    (window as any).electronAPI.system.onAppEvent = vi.fn((callback) => {
      appEventCallback = callback;
      return vi.fn();
    });

    getGalleries.mockResolvedValueOnce({
      success: true,
      data: [{
        id: 1,
        name: 'cover-event-gallery',
        createdAt: '2026-04-14T00:00:00.000Z',
        updatedAt: '2026-04-14T00:00:00.000Z',
        imageCount: 1,
        recursive: true,
        autoScan: false,
        coverImage: {
          id: 101,
          filepath: 'D:/images/cover-event.jpg',
        },
      }],
    });
    getThumbnail.mockResolvedValueOnce({ success: true, pending: true });

    render(<GalleryPage subTab="galleries" suspended={false} />);

    expect(await screen.findByText('cover-event-gallery')).toBeTruthy();
    expect(screen.getByTestId('gallery-cover-image').getAttribute('data-thumbnail-path')).toBe('');

    act(() => {
      appEventCallback?.({
        type: 'thumbnail:generated',
        version: 1,
        occurredAt: '2026-05-23T00:00:00.000Z',
        source: 'thumbnailService',
        payload: {
          imagePath: 'D:/images/cover-event.jpg',
          thumbnailPath: 'D:/data/thumbnails/cover-event.webp',
          success: true,
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('gallery-cover-image').getAttribute('data-thumbnail-path')).toBe('D:/data/thumbnails/cover-event.webp');
    });
  });
});
