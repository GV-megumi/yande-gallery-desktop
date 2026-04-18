/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dropdown, Modal, message } from 'antd';
import { GalleryPage } from '../../../src/renderer/pages/GalleryPage';

const getGalleries = vi.fn();
const getGallery = vi.fn();
const getImagesByFolder = vi.fn();
const getThumbnail = vi.fn();
const deleteGallery = vi.fn();
const getGallerySourceFavoriteTags = vi.fn();
const getImages = vi.fn();
const searchImages = vi.fn();
const getRecentImages = vi.fn();
const getConfig = vi.fn();
const saveConfig = vi.fn();
const getGalleryPagePreferences = vi.fn();
const saveGalleryPagePreferences = vi.fn();

vi.mock('../../../src/renderer/components/ImageGrid', () => ({
  ImageGrid: () => <div data-testid="image-grid" />,
}));

vi.mock('../../../src/renderer/components/ImageListWrapper', () => ({
  ImageListWrapper: ({ children, images, loading }: { children?: React.ReactNode; images?: Array<{ id?: number; name?: string }>; loading?: boolean }) => (
    <div>
      <div data-testid="image-list-wrapper" data-loading={loading ? 'true' : 'false'}>
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
  LazyLoadFooter: () => <div data-testid="lazy-load-footer" />,
}));

vi.mock('../../../src/renderer/components/GalleryCoverImage', () => ({
  GalleryCoverImage: ({ onInfoClick }: { onInfoClick?: () => void }) => (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onInfoClick?.();
      }}
    >
      封面
    </button>
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
          name: '测试图集',
          createdAt: '2026-04-14T00:00:00.000Z',
          updatedAt: '2026-04-14T00:00:00.000Z',
          imageCount: 3,
          recursive: true,
          isWatching: false,
        },
      ],
    });
    getThumbnail.mockResolvedValue({ success: false, error: 'no-thumb' });
    deleteGallery.mockResolvedValue({ success: true });
    getImages.mockResolvedValue({ success: true, data: [] });
    searchImages.mockResolvedValue({ success: true, data: [], total: 0 });
    getRecentImages.mockResolvedValue({ success: true, data: [] });
    getConfig.mockResolvedValue({ success: true, data: {} });
    saveConfig.mockResolvedValue({ success: true });
    getGalleryPagePreferences.mockResolvedValue({ success: true, data: undefined });
    saveGalleryPagePreferences.mockResolvedValue({ success: true });
    getGallery.mockResolvedValue({
      success: true,
      data: {
        id: 1,
        name: '测试图集',
        folderPath: 'D:/gallery/test',
        createdAt: '2026-04-14T00:00:00.000Z',
        updatedAt: '2026-04-14T00:00:00.000Z',
        imageCount: 3,
        recursive: true,
        isWatching: false,
      },
    });
    getImagesByFolder.mockResolvedValue({ success: true, data: [] });
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

    (window as any).electronAPI = {
      gallery: {
        getGalleries,
        deleteGallery,
        getGallery,
        getImagesByFolder,
        getRecentImages,
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

  it('右键图集时应显示编辑和删除操作，并在删除确认后调用删除接口', async () => {
    const confirmSpy = vi.spyOn(Modal, 'confirm').mockImplementation(() => ({
      destroy: vi.fn(),
      update: vi.fn(),
      then: vi.fn(),
    }) as any);

    renderGalleriesPage();

    const galleryName = await screen.findByText('测试图集');
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
    expect(confirmConfig?.content).toContain('只会删除图集记录及其关联记录');
    expect(confirmConfig?.content).toContain('不会删除本地文件');

    await confirmConfig?.onOk?.();

    expect(deleteGallery).toHaveBeenCalledWith(1);
  });

  it('删除成功后应刷新图集列表并提示成功', async () => {
    const successSpy = vi.spyOn(message, 'success').mockImplementation(() => undefined as any);
    const confirmSpy = vi.spyOn(Modal, 'confirm').mockImplementation(() => ({
      destroy: vi.fn(),
      update: vi.fn(),
      then: vi.fn(),
    }) as any);

    renderGalleriesPage();

    const galleryName = await screen.findByText('测试图集');
    await userEvent.pointer({ keys: '[MouseRight]', target: galleryName });
    const menu = await screen.findByRole('menu');
    await userEvent.click(within(menu).getByText('删除'));

    const confirmConfig = confirmSpy.mock.calls[0]?.[0];
    await confirmConfig?.onOk?.();

    expect(deleteGallery).toHaveBeenCalledWith(1);
    expect(successSpy).toHaveBeenCalledWith('图集已删除');
    await waitFor(() => {
      expect(getGalleries).toHaveBeenCalledTimes(2);
    });
  });

  it('删除失败时应提示错误且不刷新图集列表', async () => {
    const errorSpy = vi.spyOn(message, 'error').mockImplementation(() => undefined as any);
    const confirmSpy = vi.spyOn(Modal, 'confirm').mockImplementation(() => ({
      destroy: vi.fn(),
      update: vi.fn(),
      then: vi.fn(),
    }) as any);
    deleteGallery.mockResolvedValueOnce({ success: false, error: 'delete failed' });

    renderGalleriesPage();

    const galleryName = await screen.findByText('测试图集');
    await userEvent.pointer({ keys: '[MouseRight]', target: galleryName });
    const menu = await screen.findByRole('menu');
    await userEvent.click(within(menu).getByText('删除'));

    const confirmConfig = confirmSpy.mock.calls[0]?.[0];
    await confirmConfig?.onOk?.();

    expect(deleteGallery).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith('delete failed');
    expect(getGalleries).toHaveBeenCalledTimes(1);
  });

  it('删除接口抛出异常时应提示错误且不刷新图集列表', async () => {
    const errorSpy = vi.spyOn(message, 'error').mockImplementation(() => undefined as any);
    const confirmSpy = vi.spyOn(Modal, 'confirm').mockImplementation(() => ({
      destroy: vi.fn(),
      update: vi.fn(),
      then: vi.fn(),
    }) as any);
    deleteGallery.mockRejectedValueOnce(new Error('boom'));

    renderGalleriesPage();

    const galleryName = await screen.findByText('测试图集');
    await userEvent.pointer({ keys: '[MouseRight]', target: galleryName });
    const menu = await screen.findByRole('menu');
    await userEvent.click(within(menu).getByText('删除'));

    const confirmConfig = confirmSpy.mock.calls[0]?.[0];
    await confirmConfig?.onOk?.();

    expect(deleteGallery).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith('删除图集失败');
    expect(getGalleries).toHaveBeenCalledTimes(1);
  });

  it('编辑图集弹窗应保留系统关闭按钮', async () => {
    renderGalleriesPage();

    const galleryName = await screen.findByText('测试图集');
    await userEvent.pointer({ keys: '[MouseRight]', target: galleryName });
    const menu = await screen.findByRole('menu');
    await userEvent.click(within(menu).getByText('编辑'));

    const dialog = await screen.findByRole('dialog', { name: '编辑图集' });
    const modal = dialog.closest('.ant-modal');
    expect(modal?.querySelector('.ant-modal-close')).toBeTruthy();
  });

  it('图集信息模态框应与悬浮信息面一致展示来源收藏标签', async () => {
    renderGalleriesPage();

    await userEvent.click(await screen.findByRole('button', { name: '封面' }));

    expect(await screen.findByText('图集信息')).toBeTruthy();
    await waitFor(() => {
      expect(getGallerySourceFavoriteTags).toHaveBeenCalledWith(1);
    });
    expect(screen.getByText('来源收藏标签')).toBeTruthy();
    expect(screen.getByText('source_tag')).toBeTruthy();
  });

  it('打开另一个图集信息前应先清空旧的来源收藏标签，避免展示串页数据', async () => {
    getGalleries.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 1,
          name: '测试图集',
          createdAt: '2026-04-14T00:00:00.000Z',
          updatedAt: '2026-04-14T00:00:00.000Z',
          imageCount: 3,
          recursive: true,
          isWatching: false,
        },
        {
          id: 2,
          name: '另一个图集',
          createdAt: '2026-04-14T00:00:00.000Z',
          updatedAt: '2026-04-14T00:00:00.000Z',
          imageCount: 1,
          recursive: false,
          isWatching: false,
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
      expect(screen.getByText('图集信息')).toBeTruthy();
    });
    expect(screen.queryByText('source_tag')).toBeNull();
  });

  it('详情请求晚到时不应覆盖当前信息弹窗的来源收藏标签', async () => {
    const modalTags = createDeferred<{ success: true; data: any[] }>();
    const detailTags = createDeferred<{ success: true; data: any[] }>();
    const detailImages = createDeferred<{ success: true; data: any[] }>();

    getGallerySourceFavoriteTags
      .mockImplementationOnce(() => modalTags.promise)
      .mockImplementationOnce(() => detailTags.promise);
    getImagesByFolder.mockImplementationOnce(() => detailImages.promise);

    renderGalleriesPage();

    await userEvent.click(await screen.findByRole('button', { name: '封面' }));
    expect(await screen.findByText('图集信息')).toBeTruthy();

    const galleryNameEntries = await screen.findAllByText('测试图集');
    await userEvent.click(galleryNameEntries[0]);
    expect(await screen.findByRole('button', { name: /返\s*回/ })).toBeTruthy();

    modalTags.resolve({
      success: true,
      data: [{ id: 201, tagName: 'modal_tag', downloadBinding: { lastStatus: 'completed' } }],
    });

    expect(await screen.findByText('modal_tag')).toBeTruthy();

    detailTags.resolve({
      success: true,
      data: [{ id: 301, tagName: 'detail_tag', downloadBinding: { lastStatus: 'completed' } }],
    });
    detailImages.resolve({ success: true, data: [] });

    await waitFor(() => {
      expect(screen.getByText('modal_tag')).toBeTruthy();
    });
    expect(screen.queryByText('detail_tag')).toBeNull();
  });

  it('打开图集信息弹窗后切到 recent 时应清空旧 modal 标签且返回 galleries 后弹窗不应残留', async () => {
    const modalTags = createDeferred<{ success: true; data: any[] }>();
    getGallerySourceFavoriteTags.mockImplementationOnce(() => modalTags.promise);

    const view = renderGalleriesPage();

    await userEvent.click(await screen.findByRole('button', { name: '封面' }));
    expect(await screen.findByText('图集信息')).toBeTruthy();

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

  it('删除当前图集后，晚到的信息请求结果不应回灌弹窗状态', async () => {
    const confirmSpy = vi.spyOn(Modal, 'confirm').mockImplementation(() => ({
      destroy: vi.fn(),
      update: vi.fn(),
      then: vi.fn(),
    }) as any);
    const modalTags = createDeferred<{ success: true; data: any[] }>();
    getGallerySourceFavoriteTags.mockImplementationOnce(() => modalTags.promise);

    renderGalleriesPage();

    await userEvent.click(await screen.findByRole('button', { name: '封面' }));
    expect(await screen.findByText('图集信息')).toBeTruthy();

    const galleryName = await screen.findAllByText('测试图集');
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

  it('galleries 子页激活时应通过 pagePreferences.gallery 恢复选中图集并重新打开详情视图', async () => {
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
      expect(getImagesByFolder).toHaveBeenCalledWith('D:/gallery/test', 1, 1000);
    });

    expect(await screen.findByRole('button', { name: /返\s*回/ })).toBeTruthy();
    expect(screen.getByText('测试图集')).toBeTruthy();
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
      expect((screen.getByPlaceholderText('搜索图集名称...') as HTMLInputElement).value).toBe('测试');
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
      expect((screen.getByPlaceholderText('搜索图集名称...') as HTMLInputElement).value).toBe('测试');
    });

    saveGalleryPagePreferences.mockClear();

    await userEvent.clear(screen.getByPlaceholderText('搜索图集名称...'));
    await userEvent.type(screen.getByPlaceholderText('搜索图集名称...'), '新图集');

    await waitFor(() => {
      expect(saveGalleryPagePreferences).toHaveBeenCalledWith({
        galleries: {
          gallerySearchQuery: '新图集',
          gallerySortKey: 'name',
          gallerySortOrder: 'asc',
          selectedGalleryId: undefined,
          gallerySort: 'name',
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
    getImagesByFolder.mockClear();

    view.rerender(<GalleryPage subTab="recent" />);
    view.rerender(<GalleryPage subTab="galleries" />);

    await waitFor(() => {
      expect((screen.getByPlaceholderText('搜索图集名称...') as HTMLInputElement).value).toBe('测试');
    });

    expect(screen.queryByRole('button', { name: /返\s*回/ })).toBeNull();
    expect(getGallery).not.toHaveBeenCalled();
    expect(getImagesByFolder).not.toHaveBeenCalled();
    expect(getConfig).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('切换子页后再打开新图集时，旧详情请求晚到结果不应污染当前图集', async () => {
    getGalleries.mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          name: '测试图集',
          folderPath: 'D:/gallery/test',
          createdAt: '2026-04-14T00:00:00.000Z',
          updatedAt: '2026-04-14T00:00:00.000Z',
          imageCount: 3,
          recursive: true,
          isWatching: false,
        },
        {
          id: 2,
          name: '另一个图集',
          folderPath: 'D:/gallery/another',
          createdAt: '2026-04-14T00:00:00.000Z',
          updatedAt: '2026-04-14T00:00:00.000Z',
          imageCount: 1,
          recursive: false,
          isWatching: false,
        },
      ],
    });
    getGallery.mockImplementation(async (galleryId: number) => ({
      success: true,
      data: galleryId === 2
        ? {
            id: 2,
            name: '另一个图集',
            folderPath: 'D:/gallery/another',
            createdAt: '2026-04-14T00:00:00.000Z',
            updatedAt: '2026-04-14T00:00:00.000Z',
            imageCount: 1,
            recursive: false,
            isWatching: false,
          }
        : {
            id: 1,
            name: '测试图集',
            folderPath: 'D:/gallery/test',
            createdAt: '2026-04-14T00:00:00.000Z',
            updatedAt: '2026-04-14T00:00:00.000Z',
            imageCount: 3,
            recursive: true,
            isWatching: false,
          },
    }));

    const staleTags = createDeferred<{ success: true; data: any[] }>();
    const freshTags = createDeferred<{ success: true; data: any[] }>();
    const staleImages = createDeferred<{ success: true; data: any[] }>();
    const freshImages = createDeferred<{ success: true; data: any[] }>();

    getGallerySourceFavoriteTags.mockImplementation((galleryId: number) => (
      galleryId === 2 ? freshTags.promise : staleTags.promise
    ));
    getImagesByFolder.mockImplementation((folderPath: string) => (
      folderPath === 'D:/gallery/another' ? freshImages.promise : staleImages.promise
    ));

    const view = renderGalleriesPage();

    await userEvent.click(await screen.findByText('测试图集'));
    expect(await screen.findByRole('button', { name: /返\s*回/ })).toBeTruthy();

    view.rerender(<GalleryPage subTab="recent" />);
    view.rerender(<GalleryPage subTab="galleries" />);

    await waitFor(() => {
      expect(screen.getByText('另一个图集')).toBeTruthy();
    });

    await userEvent.click(screen.getByText('另一个图集'));
    expect(await screen.findByText('另一个图集')).toBeTruthy();

    freshTags.resolve({
      success: true,
      data: [{ id: 202, tagName: 'fresh_tag', downloadBinding: { lastStatus: 'completed' } }],
    });

    await waitFor(() => {
      expect(getImagesByFolder).toHaveBeenCalledTimes(1);
      expect(getImagesByFolder).toHaveBeenCalledWith('D:/gallery/another', 1, 1000);
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

    expect(await screen.findByText('图集信息')).toBeTruthy();
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

  it('打开图集详情后直接离开 galleries 时，旧详情请求晚到不应污染其他子页状态', async () => {
    const staleTags = createDeferred<{ success: true; data: any[] }>();
    const staleImages = createDeferred<{ success: true; data: any[] }>();
    const recentImagesDeferred = createDeferred<{ success: true; data: any[] }>();
    getGallerySourceFavoriteTags.mockImplementation(() => staleTags.promise);
    getImagesByFolder.mockImplementation(() => staleImages.promise);
    getRecentImages.mockImplementation(() => recentImagesDeferred.promise);

    const view = renderGalleriesPage();

    await userEvent.click(await screen.findByText('测试图集'));
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
});
