/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RelocateRootModal } from '../../../src/renderer/components/RelocateRootModal';

beforeEach(() => {
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
});

afterEach(() => {
  cleanup();
});

const makeProps = (overrides: Partial<React.ComponentProps<typeof RelocateRootModal>> = {}) => ({
  open: true,
  onCancel: vi.fn(),
  onPreview: vi.fn().mockResolvedValue({ success: true, data: { affected: [], collisions: [] } }),
  onApply: vi.fn().mockResolvedValue({ success: true, data: { affected: [] } }),
  onPickFolder: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

/** 在唯一一行映射里填入 oldPrefix / newPrefix 文本框 */
async function fillFirstRow(oldPrefix: string, newPrefix: string) {
  const oldInput = screen.getByPlaceholderText(/旧路径前缀/);
  const newInput = screen.getByPlaceholderText(/新路径前缀/);
  await userEvent.clear(oldInput);
  await userEvent.type(oldInput, oldPrefix);
  await userEvent.clear(newInput);
  await userEvent.type(newInput, newPrefix);
}

describe('RelocateRootModal', () => {
  it('open=false 不渲染', () => {
    const { container } = render(<RelocateRootModal {...makeProps({ open: false })} />);
    expect(container.querySelector('.ant-modal')).toBeNull();
  });

  it('没有可应用的映射时应用按钮禁用', () => {
    render(<RelocateRootModal {...makeProps()} />);
    const applyBtn = screen.getByRole('button', { name: /应\s*用/ }) as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
  });

  it('预览携带填好的映射调用 onPreview，并展示受影响计数', async () => {
    const onPreview = vi.fn().mockResolvedValue({
      success: true,
      data: { affected: [{ table: 'gallery_folders', column: 'folderPath', count: 7 }], collisions: [] },
    });
    render(<RelocateRootModal {...makeProps({ onPreview })} />);

    await fillFirstRow('D:/old', 'E:/new');
    await userEvent.click(screen.getByRole('button', { name: /预\s*览/ }));

    await waitFor(() => {
      expect(onPreview).toHaveBeenCalledWith([{ oldPrefix: 'D:/old', newPrefix: 'E:/new' }]);
    });
    // 受影响计数展示
    expect(await screen.findByText(/gallery_folders/)).toBeTruthy();
    expect(screen.getByText(/7/)).toBeTruthy();
  });

  it('预览发现碰撞时禁用应用并展示冲突路径警告', async () => {
    const onPreview = vi.fn().mockResolvedValue({
      success: true,
      data: {
        affected: [{ table: 'gallery_folders', column: 'folderPath', count: 3 }],
        collisions: [{ table: 'gallery_folders', column: 'folderPath', path: 'E:/new/dup' }],
      },
    });
    const onApply = vi.fn();
    render(<RelocateRootModal {...makeProps({ onPreview, onApply })} />);

    await fillFirstRow('D:/old', 'E:/new');
    await userEvent.click(screen.getByRole('button', { name: /预\s*览/ }));

    // 冲突路径出现
    expect(await screen.findByText(/E:\/new\/dup/)).toBeTruthy();

    // 应用仍禁用
    const applyBtn = screen.getByRole('button', { name: /应\s*用/ }) as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
  });

  it('无碰撞预览后确认应用：调用 onApply 并在成功后关闭', async () => {
    const onPreview = vi.fn().mockResolvedValue({
      success: true,
      data: { affected: [{ table: 'gallery_folders', column: 'folderPath', count: 5 }], collisions: [] },
    });
    const onApply = vi.fn().mockResolvedValue({ success: true, data: { affected: [{ table: 'gallery_folders', column: 'folderPath', count: 5 }] } });
    const onCancel = vi.fn();
    render(<RelocateRootModal {...makeProps({ onPreview, onApply, onCancel })} />);

    await fillFirstRow('D:/old', 'E:/new');
    await userEvent.click(screen.getByRole('button', { name: /预\s*览/ }));
    await screen.findByText(/gallery_folders/);

    const applyBtn = screen.getByRole('button', { name: /应\s*用/ }) as HTMLButtonElement;
    await waitFor(() => expect(applyBtn.disabled).toBe(false));
    await userEvent.click(applyBtn);

    // 破坏性操作的二次确认弹窗 → 点继续
    const confirmBtn = await screen.findByRole('button', { name: /继续重定位|确\s*定/ });
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(onApply).toHaveBeenCalledWith([{ oldPrefix: 'D:/old', newPrefix: 'E:/new' }]);
    });
    await waitFor(() => {
      expect(onCancel).toHaveBeenCalled();
    });
  });

  it('预览返回仅大小写差异 warnings 时展示非阻断提示，应用仍可用', async () => {
    const onPreview = vi.fn().mockResolvedValue({
      success: true,
      data: {
        affected: [{ table: 'images', column: 'filepath', count: 4 }],
        collisions: [],
        warnings: [
          { table: 'images', column: 'filepath', newPrefix: 'E:/New', existingPrefix: 'E:/new', count: 3 },
        ],
      },
    });
    render(<RelocateRootModal {...makeProps({ onPreview })} />);

    await fillFirstRow('D:/old', 'E:/New');
    await userEvent.click(screen.getByRole('button', { name: /预\s*览/ }));

    // 非阻断提示出现（含既有前缀字节形态与行数）
    expect(await screen.findByText(/仅大小写不同的路径/)).toBeTruthy();
    expect(screen.getByText(/E:\/new/)).toBeTruthy();
    expect(screen.getByText(/3\s*行/)).toBeTruthy();

    // 与 collisions 不同：应用不被禁用
    const applyBtn = screen.getByRole('button', { name: /应\s*用/ }) as HTMLButtonElement;
    await waitFor(() => expect(applyBtn.disabled).toBe(false));
  });

  it('点击新增行后可填写第二条映射', async () => {
    render(<RelocateRootModal {...makeProps()} />);
    expect(screen.getAllByPlaceholderText(/旧路径前缀/)).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /添加映射/ }));
    expect(screen.getAllByPlaceholderText(/旧路径前缀/)).toHaveLength(2);
  });

  describe('丢失文件夹修复清单', () => {
    const missing = [
      { galleryId: 1, folderPath: 'D:/pics/a', galleryName: 'Alpha' },
      { galleryId: 2, folderPath: 'D:/pics/b', galleryName: 'Beta' },
      { galleryId: 3, folderPath: 'E:/solo', galleryName: 'Gamma' },
    ];

    it('打开时自动列出丢失文件夹：旧路径只读展示 + 小字标注归属相册', async () => {
      const onLoadMissingFolders = vi.fn().mockResolvedValue(missing);
      render(<RelocateRootModal {...makeProps({ onLoadMissingFolders })} />);

      expect(await screen.findByText(/检测到 3 个丢失的绑定文件夹/)).toBeTruthy();
      expect(screen.getByText('D:/pics/a')).toBeTruthy();
      expect(screen.getByText(/相册：Alpha/)).toBeTruthy();
      expect(screen.getByText(/相册：Gamma/)).toBeTruthy();
      // 每项右侧一个"未选择新位置"输入
      expect(screen.getAllByPlaceholderText(/未选择新位置/)).toHaveLength(3);
    });

    it('为一项选择新位置后，同根其它项自动推断（带推断标记），不同根不受影响', async () => {
      const onLoadMissingFolders = vi.fn().mockResolvedValue(missing);
      const onPickFolder = vi.fn().mockResolvedValue('F:/moved/pics/a');
      render(<RelocateRootModal {...makeProps({ onLoadMissingFolders, onPickFolder })} />);
      await screen.findByText(/检测到 3 个丢失的绑定文件夹/);

      // 列表按 oldPath 排序：D:/pics/a、D:/pics/b、E:/solo
      await userEvent.click(screen.getAllByRole('button', { name: '选择新位置' })[0]);

      const inputs = screen.getAllByPlaceholderText(/未选择新位置/) as HTMLInputElement[];
      expect(inputs[0].value).toBe('F:/moved/pics/a');
      expect(inputs[1].value).toBe('F:/moved/pics/b'); // 同根推断
      expect(inputs[2].value).toBe(''); // 不同根不推断
      expect(screen.getByText('推断')).toBeTruthy();
    });

    it('选中 UNC 新位置（NAS 共享目录）时推断保留 \\\\ 前缀，不产出相对形态坏值', async () => {
      const onLoadMissingFolders = vi.fn().mockResolvedValue(missing);
      const onPickFolder = vi.fn().mockResolvedValue('\\\\NAS\\photos\\a');
      render(<RelocateRootModal {...makeProps({ onLoadMissingFolders, onPickFolder })} />);
      await screen.findByText(/检测到 3 个丢失的绑定文件夹/);

      await userEvent.click(screen.getAllByRole('button', { name: '选择新位置' })[0]);

      const inputs = screen.getAllByPlaceholderText(/未选择新位置/) as HTMLInputElement[];
      expect(inputs[0].value).toBe('\\\\NAS\\photos\\a');
      expect(inputs[1].value).toBe('\\\\NAS\\photos\\b'); // 同根推断：前导 \\ 必须保留
      expect(inputs[2].value).toBe('');
    });

    it('选中 POSIX 绝对路径时推断保留前导 /', async () => {
      const onLoadMissingFolders = vi.fn().mockResolvedValue(missing);
      const onPickFolder = vi.fn().mockResolvedValue('/mnt/photos/a');
      render(<RelocateRootModal {...makeProps({ onLoadMissingFolders, onPickFolder })} />);
      await screen.findByText(/检测到 3 个丢失的绑定文件夹/);

      await userEvent.click(screen.getAllByRole('button', { name: '选择新位置' })[0]);

      const inputs = screen.getAllByPlaceholderText(/未选择新位置/) as HTMLInputElement[];
      expect(inputs[0].value).toBe('/mnt/photos/a');
      expect(inputs[1].value).toBe('/mnt/photos/b'); // 同根推断：前导 / 必须保留
    });

    it('选中值为相对路径（防御场景）时不向其它项推断传播', async () => {
      const onLoadMissingFolders = vi.fn().mockResolvedValue(missing);
      const onPickFolder = vi.fn().mockResolvedValue('moved/pics/a');
      render(<RelocateRootModal {...makeProps({ onLoadMissingFolders, onPickFolder })} />);
      await screen.findByText(/检测到 3 个丢失的绑定文件夹/);

      await userEvent.click(screen.getAllByRole('button', { name: '选择新位置' })[0]);

      const inputs = screen.getAllByPlaceholderText(/未选择新位置/) as HTMLInputElement[];
      expect(inputs[1].value).toBe(''); // 相对形态无法可靠推断，宁可留空让用户手选
    });

    it('推断不覆盖用户手选；清除只清当前行', async () => {
      const onLoadMissingFolders = vi.fn().mockResolvedValue(missing);
      const onPickFolder = vi.fn()
        .mockResolvedValueOnce('X:/manual/b') // 先手选第二行
        .mockResolvedValueOnce('F:/moved/pics/a'); // 再选第一行触发推断
      render(<RelocateRootModal {...makeProps({ onLoadMissingFolders, onPickFolder })} />);
      await screen.findByText(/检测到 3 个丢失的绑定文件夹/);

      const pickButtons = screen.getAllByRole('button', { name: '选择新位置' });
      await userEvent.click(pickButtons[1]);
      await userEvent.click(pickButtons[0]);

      const inputs = screen.getAllByPlaceholderText(/未选择新位置/) as HTMLInputElement[];
      expect(inputs[0].value).toBe('F:/moved/pics/a');
      expect(inputs[1].value).toBe('X:/manual/b'); // 手选未被推断覆盖

      // 清除第一行：只影响自己
      await userEvent.click(screen.getAllByRole('button', { name: '清除' })[0]);
      const after = screen.getAllByPlaceholderText(/未选择新位置/) as HTMLInputElement[];
      expect(after[0].value).toBe('');
      expect(after[1].value).toBe('X:/manual/b');
    });

    it('预览/应用只携带已选择新位置的项', async () => {
      const twoRoots = [
        { galleryId: 1, folderPath: 'D:/pics/a', galleryName: 'Alpha' },
        { galleryId: 3, folderPath: 'E:/solo', galleryName: 'Gamma' },
      ];
      const onLoadMissingFolders = vi.fn().mockResolvedValue(twoRoots);
      const onPickFolder = vi.fn().mockResolvedValue('F:/moved/pics/a');
      const onPreview = vi.fn().mockResolvedValue({ success: true, data: { affected: [], collisions: [] } });
      render(<RelocateRootModal {...makeProps({ onLoadMissingFolders, onPickFolder, onPreview })} />);
      await screen.findByText(/检测到 2 个丢失的绑定文件夹/);

      await userEvent.click(screen.getAllByRole('button', { name: '选择新位置' })[0]);
      await userEvent.click(screen.getByRole('button', { name: /预\s*览/ }));

      await waitFor(() => {
        expect(onPreview).toHaveBeenCalledWith([{ oldPrefix: 'D:/pics/a', newPrefix: 'F:/moved/pics/a' }]);
      });
    });

    it('未手动预览直接应用：内置预检通过后执行 onApply', async () => {
      const onLoadMissingFolders = vi.fn().mockResolvedValue([missing[0]]);
      const onPickFolder = vi.fn().mockResolvedValue('F:/x/a');
      const onPreview = vi.fn().mockResolvedValue({ success: true, data: { affected: [], collisions: [] } });
      const onApply = vi.fn().mockResolvedValue({ success: true, data: { affected: [] } });
      const onCancel = vi.fn();
      render(<RelocateRootModal {...makeProps({ onLoadMissingFolders, onPickFolder, onPreview, onApply, onCancel })} />);
      await screen.findByText(/检测到 1 个丢失的绑定文件夹/);

      await userEvent.click(screen.getAllByRole('button', { name: '选择新位置' })[0]);
      const applyBtn = screen.getByRole('button', { name: /应\s*用/ }) as HTMLButtonElement;
      await waitFor(() => expect(applyBtn.disabled).toBe(false));
      await userEvent.click(applyBtn);
      await userEvent.click(await screen.findByRole('button', { name: /继续重定位/ }));

      await waitFor(() => {
        expect(onPreview).toHaveBeenCalledWith([{ oldPrefix: 'D:/pics/a', newPrefix: 'F:/x/a' }]);
        expect(onApply).toHaveBeenCalledWith([{ oldPrefix: 'D:/pics/a', newPrefix: 'F:/x/a' }]);
      });
      await waitFor(() => expect(onCancel).toHaveBeenCalled());
    });

    it('内置预检发现冲突：不执行 onApply 并展示冲突明细', async () => {
      const onLoadMissingFolders = vi.fn().mockResolvedValue([missing[0]]);
      const onPickFolder = vi.fn().mockResolvedValue('F:/x/a');
      const onPreview = vi.fn().mockResolvedValue({
        success: true,
        data: { affected: [], collisions: [{ table: 'images', column: 'filepath', path: 'F:/x/a/1.jpg' }] },
      });
      const onApply = vi.fn();
      render(<RelocateRootModal {...makeProps({ onLoadMissingFolders, onPickFolder, onPreview, onApply })} />);
      await screen.findByText(/检测到 1 个丢失的绑定文件夹/);

      await userEvent.click(screen.getAllByRole('button', { name: '选择新位置' })[0]);
      await userEvent.click(screen.getByRole('button', { name: /应\s*用/ }));
      await userEvent.click(await screen.findByRole('button', { name: /继续重定位/ }));

      expect(await screen.findByText(/存在路径冲突，无法应用/)).toBeTruthy();
      expect(onApply).not.toHaveBeenCalled();
    });

    it('无丢失文件夹时提示空态并自动展开高级前缀映射', async () => {
      const onLoadMissingFolders = vi.fn().mockResolvedValue([]);
      render(<RelocateRootModal {...makeProps({ onLoadMissingFolders })} />);

      expect(await screen.findByText(/未检测到丢失的绑定文件夹/)).toBeTruthy();
      // 高级区自动展开：手动前缀映射输入可用
      expect(await screen.findByPlaceholderText(/旧路径前缀/)).toBeTruthy();
    });
  });

  it('编辑映射后预览结果失效（结果区隐藏），应用仍可用并在点击时自动重新预检', async () => {
    const onPreview = vi.fn().mockResolvedValue({
      success: true,
      data: { affected: [{ table: 'gallery_folders', column: 'folderPath', count: 5 }], collisions: [] },
    });
    const onApply = vi.fn().mockResolvedValue({ success: true, data: { affected: [] } });
    render(<RelocateRootModal {...makeProps({ onPreview, onApply })} />);

    await fillFirstRow('D:/old', 'E:/new');
    await userEvent.click(screen.getByRole('button', { name: /预\s*览/ }));
    await screen.findByText(/gallery_folders/);

    // 改动旧前缀 → 预览结果作废（结果区隐藏），但应用不禁用（点击时会自动重新预检）
    const oldInput = screen.getByPlaceholderText(/旧路径前缀/);
    await userEvent.type(oldInput, 'X');
    expect(screen.queryByText(/gallery_folders/)).toBeNull();
    const applyBtn = screen.getByRole('button', { name: /应\s*用/ }) as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(false);

    await userEvent.click(applyBtn);
    await userEvent.click(await screen.findByRole('button', { name: /继续重定位/ }));
    await waitFor(() => {
      // 自动重新预检携带编辑后的映射，然后才应用
      expect(onPreview).toHaveBeenLastCalledWith([{ oldPrefix: 'D:/oldX', newPrefix: 'E:/new' }]);
      expect(onApply).toHaveBeenCalledWith([{ oldPrefix: 'D:/oldX', newPrefix: 'E:/new' }]);
    });
  });
});
