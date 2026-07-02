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

  it('应用按钮在未预览前禁用', () => {
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

  it('编辑映射后预览结果失效，应用重新被禁用', async () => {
    const onPreview = vi.fn().mockResolvedValue({
      success: true,
      data: { affected: [{ table: 'gallery_folders', column: 'folderPath', count: 5 }], collisions: [] },
    });
    render(<RelocateRootModal {...makeProps({ onPreview })} />);

    await fillFirstRow('D:/old', 'E:/new');
    await userEvent.click(screen.getByRole('button', { name: /预\s*览/ }));
    await screen.findByText(/gallery_folders/);
    await waitFor(() => expect((screen.getByRole('button', { name: /应\s*用/ }) as HTMLButtonElement).disabled).toBe(false));

    // 改动旧前缀 → 预览结果作废，应用禁用
    const oldInput = screen.getByPlaceholderText(/旧路径前缀/);
    await userEvent.type(oldInput, 'X');
    expect((screen.getByRole('button', { name: /应\s*用/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
