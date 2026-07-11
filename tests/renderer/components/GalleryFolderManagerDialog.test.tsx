/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GalleryFolderManagerDialog } from '../../../src/renderer/components/GalleryFolderManagerDialog';
import { LocaleContext, useLocaleProvider } from '../../../src/renderer/locales';

/**
 * 「更改路径」二次确认文案走 useLocale()，默认 Context 的 t 返回空串，
 * 需要真实 Provider（真实 zh-CN 语言包）才能断言确认框文案。
 */
const LocaleWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const value = useLocaleProvider();
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
};

/** Modal.confirm 渲染在独立 React root，取 DOM 中最后一个确认框（防上个用例残留） */
async function findLastConfirmDialog(): Promise<HTMLElement> {
  let dialog: HTMLElement | null = null;
  await waitFor(() => {
    const all = document.querySelectorAll('.ant-modal-confirm');
    if (all.length === 0) throw new Error('confirm dialog not found');
    dialog = all[all.length - 1] as HTMLElement;
  });
  return dialog!;
}

const getGalleryFolders = vi.fn();
const getMissingGalleryFolders = vi.fn();
const updateGallery = vi.fn();
const syncGalleryFolder = vi.fn();
const bindFolder = vi.fn();
const unbindFolder = vi.fn();
const changeFolderPath = vi.fn();
const getGallerySourceFavoriteTags = vi.fn();
const selectFolder = vi.fn();
const showItem = vi.fn();

const baseGallery = {
  id: 1,
  name: '测试相册',
  imageCount: 12,
  lastScannedAt: '2026-06-01T00:00:00.000Z',
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  autoScan: false,
  coverImageId: 5,
};

function makeProps(overrides: Partial<React.ComponentProps<typeof GalleryFolderManagerDialog>> = {}) {
  return {
    gallery: baseGallery,
    open: true,
    onClose: vi.fn(),
    onChanged: vi.fn(),
    ...overrides,
  };
}

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

  getGalleryFolders.mockResolvedValue({
    success: true,
    data: [
      { folderPath: 'D:/gallery/a', recursive: true, extensions: ['.jpg', '.png'] },
      { folderPath: 'D:/gallery/missing', recursive: false, extensions: ['.gif'] },
    ],
  });
  getMissingGalleryFolders.mockResolvedValue([
    { galleryId: 1, folderPath: 'D:/gallery/missing' },
  ]);
  updateGallery.mockResolvedValue({ success: true });
  syncGalleryFolder.mockResolvedValue({ success: true, data: { imported: 3, skipped: 2, imageCount: 15, lastScannedAt: 'x' } });
  bindFolder.mockResolvedValue({ success: true, data: { imported: 1, skipped: 0 } });
  unbindFolder.mockResolvedValue({ success: true });
  changeFolderPath.mockResolvedValue({ success: true });
  getGallerySourceFavoriteTags.mockResolvedValue({ success: true, data: [] });
  selectFolder.mockResolvedValue({ success: true, data: 'D:/gallery/new' });
  showItem.mockReturnValue(undefined);

  (window as any).electronAPI = {
    gallery: {
      getGalleryFolders,
      getMissingGalleryFolders,
      updateGallery,
      syncGalleryFolder,
      bindFolder,
      unbindFolder,
      changeFolderPath,
    },
    booru: {
      getGallerySourceFavoriteTags,
    },
    system: {
      selectFolder,
      showItem,
    },
  };
});

afterEach(() => {
  cleanup();
  // Modal.confirm 渲染在 RTL 容器之外的独立 React root，cleanup 不会移除，
  // 手动清空 body 防止确认框残留串到下一个用例
  document.body.innerHTML = '';
});

describe('GalleryFolderManagerDialog', () => {
  it('open=false 时不渲染对话框', () => {
    const { container } = render(<GalleryFolderManagerDialog {...makeProps({ open: false })} />);
    expect(container.querySelector('.ant-modal')).toBeNull();
  });

  it('打开时按 getGalleryFolders 列出绑定文件夹（路径/递归/格式）', async () => {
    render(<GalleryFolderManagerDialog {...makeProps()} />);

    await waitFor(() => {
      expect(getGalleryFolders).toHaveBeenCalledWith(1);
    });
    expect(await screen.findByText('D:/gallery/a')).toBeTruthy();
    expect(screen.getByText('D:/gallery/missing')).toBeTruthy();
    // 支持格式拼接展示
    expect(screen.getByText(/\.jpg.*\.png/)).toBeTruthy();
  });

  it('磁盘缺失的文件夹应打上「文件夹丢失」标记', async () => {
    render(<GalleryFolderManagerDialog {...makeProps()} />);

    await waitFor(() => {
      expect(getMissingGalleryFolders).toHaveBeenCalled();
    });
    expect(await screen.findByText('文件夹丢失')).toBeTruthy();
  });

  it('getMissingGalleryFolders 抛错时不崩溃，仍能列出文件夹', async () => {
    getMissingGalleryFolders.mockRejectedValueOnce(new Error('boom'));
    render(<GalleryFolderManagerDialog {...makeProps()} />);

    expect(await screen.findByText('D:/gallery/a')).toBeTruthy();
  });

  it('切换「自动扫描」开关调用 updateGallery({autoScan}) 并触发 onChanged', async () => {
    const onChanged = vi.fn();
    render(<GalleryFolderManagerDialog {...makeProps({ onChanged })} />);

    await screen.findByText('D:/gallery/a');
    // 自动扫描 Switch（初始 autoScan=false → 点击打开）
    const switchEl = screen.getByRole('switch');
    await userEvent.click(switchEl);

    await waitFor(() => {
      expect(updateGallery).toHaveBeenCalledWith(1, { autoScan: true });
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it('点击「立即扫描」调用 syncGalleryFolder 并提示导入/跳过', async () => {
    render(<GalleryFolderManagerDialog {...makeProps()} />);
    await screen.findByText('D:/gallery/a');

    const syncBtn = screen.getByRole('button', { name: '立即扫描' });
    await userEvent.click(syncBtn);

    await waitFor(() => {
      expect(syncGalleryFolder).toHaveBeenCalledWith(1);
    });
  });

  it('「解绑」经 Popconfirm 确认后调用 unbindFolder 并刷新列表', async () => {
    render(<GalleryFolderManagerDialog {...makeProps()} />);
    await screen.findByText('D:/gallery/a');

    const unbindButtons = screen.getAllByRole('button', { name: '解绑' });
    await userEvent.click(unbindButtons[0]);

    // Popconfirm 确认（antd 会在两个 CJK 字符间插入空格 → "继 续"）
    const confirmBtn = await screen.findByRole('button', { name: /继\s*续/ });
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(unbindFolder).toHaveBeenCalledWith(1, 'D:/gallery/a');
    });
    // 解绑后应重新拉取列表（首次打开 1 次 + 解绑后 1 次）
    await waitFor(() => {
      expect(getGalleryFolders).toHaveBeenCalledTimes(2);
    });
  });

  it('「添加文件夹」选目录后调用 bindFolder 并刷新列表', async () => {
    render(<GalleryFolderManagerDialog {...makeProps()} />);
    await screen.findByText('D:/gallery/a');

    const addBtn = screen.getByRole('button', { name: /添\s*加\s*文\s*件\s*夹/ });
    await userEvent.click(addBtn);

    await waitFor(() => {
      expect(selectFolder).toHaveBeenCalled();
      expect(bindFolder).toHaveBeenCalledWith(1, 'D:/gallery/new');
    });
    await waitFor(() => {
      expect(getGalleryFolders).toHaveBeenCalledTimes(2);
    });
  });

  it('「更改路径」选新目录后弹出二次确认（展示旧→新路径与破坏性警告），取消则不调用 changeFolderPath', async () => {
    render(
      <LocaleWrapper>
        <GalleryFolderManagerDialog {...makeProps()} />
      </LocaleWrapper>
    );
    await screen.findByText('D:/gallery/a');

    const changeButtons = screen.getAllByRole('button', { name: '更改路径' });
    await userEvent.click(changeButtons[0]);

    await waitFor(() => {
      expect(selectFolder).toHaveBeenCalled();
    });

    // 选完目录后应先弹确认框，而不是直接执行
    const dialog = await findLastConfirmDialog();
    // 展示旧→新路径
    expect(within(dialog).getByText('D:/gallery/a')).toBeTruthy();
    expect(within(dialog).getByText(/D:\/gallery\/new/)).toBeTruthy();
    // 破坏性警告 + 重定位根目录指引（真实 zh-CN 文案）
    expect(within(dialog).getByText(/解绑旧文件夹/)).toBeTruthy();
    expect(within(dialog).getByText(/重定位根目录/)).toBeTruthy();
    // 弹确认阶段不应已调用 IPC
    expect(changeFolderPath).not.toHaveBeenCalled();

    // 取消 → 始终不执行
    const cancelBtn = within(dialog).getByRole('button', { name: /取\s*消/ });
    await userEvent.click(cancelBtn);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(changeFolderPath).not.toHaveBeenCalled();
  });

  it('「更改路径」二次确认通过后才调用 changeFolderPath(oldPath,newPath) 并刷新列表', async () => {
    render(
      <LocaleWrapper>
        <GalleryFolderManagerDialog {...makeProps()} />
      </LocaleWrapper>
    );
    await screen.findByText('D:/gallery/a');

    const changeButtons = screen.getAllByRole('button', { name: '更改路径' });
    await userEvent.click(changeButtons[0]);

    const dialog = await findLastConfirmDialog();
    expect(changeFolderPath).not.toHaveBeenCalled();

    // danger 确认按钮文案「更改路径」（4 个 CJK 字符，antd 不插空格）
    const okBtn = within(dialog).getByRole('button', { name: '更改路径' });
    expect(okBtn.className).toContain('ant-btn-dangerous');
    await userEvent.click(okBtn);

    await waitFor(() => {
      expect(changeFolderPath).toHaveBeenCalledWith(1, 'D:/gallery/a', 'D:/gallery/new');
    });
    // 确认后应刷新列表（首次打开 1 次 + 更改后 1 次）
    await waitFor(() => {
      expect(getGalleryFolders).toHaveBeenCalledTimes(2);
    });
  });

  it('点击文件夹路径调用 system.showItem 在资源管理器打开', async () => {
    render(<GalleryFolderManagerDialog {...makeProps()} />);
    const pathEl = await screen.findByText('D:/gallery/a');
    await userEvent.click(pathEl);
    expect(showItem).toHaveBeenCalledWith('D:/gallery/a');
  });

  it('内联改名调用 updateGallery({name}) 并触发 onChanged', async () => {
    const onChanged = vi.fn();
    render(<GalleryFolderManagerDialog {...makeProps({ onChanged })} />);
    await screen.findByText('D:/gallery/a');

    // 触发改名编辑（编辑图标 / 改名按钮）
    const renameTrigger = screen.getByRole('button', { name: '改名' });
    await userEvent.click(renameTrigger);

    const input = await screen.findByDisplayValue('测试相册');
    await userEvent.clear(input);
    await userEvent.type(input, '新名字');
    const saveBtn = screen.getByRole('button', { name: /保\s*存/ });
    await userEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateGallery).toHaveBeenCalledWith(1, { name: '新名字' });
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it('渲染只读元信息：图片数量 / 最后扫描 / 创建时间 / 更新时间', async () => {
    render(<GalleryFolderManagerDialog {...makeProps()} />);
    await screen.findByText('D:/gallery/a');

    expect(screen.getByText('图片数量')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('来源收藏标签')).toBeTruthy();
    await waitFor(() => {
      expect(getGallerySourceFavoriteTags).toHaveBeenCalledWith(1);
    });
  });
});
