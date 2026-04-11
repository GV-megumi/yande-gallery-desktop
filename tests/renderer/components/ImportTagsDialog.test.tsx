/** @vitest-environment jsdom */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportTagsDialog } from '../../../src/renderer/components/ImportTagsDialog';

// antd Select needs matchMedia in jsdom
beforeEach(() => {
  if (!window.matchMedia) {
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
  }
});

afterEach(() => {
  cleanup();
});

const sites = [
  { id: 1, name: 'yande' },
  { id: 2, name: 'danbooru' },
];

describe('ImportTagsDialog', () => {
  it('初始未选站点时"选择文件"按钮禁用', () => {
    render(
      <ImportTagsDialog
        open
        title="导入收藏标签"
        sites={sites}
        onCancel={() => {}}
        onPickFile={vi.fn()}
        onCommit={vi.fn()}
        onImported={vi.fn()}
      />
    );
    const pickBtn = screen.getByRole('button', { name: /选\s*择\s*文\s*件/ });
    // antd disables button via the disabled attribute
    expect(pickBtn.getAttribute('disabled')).not.toBeNull();
  });

  it('选站点后按钮可用', async () => {
    render(
      <ImportTagsDialog
        open
        title="导入收藏标签"
        sites={sites}
        onCancel={() => {}}
        onPickFile={vi.fn()}
        onCommit={vi.fn()}
        onImported={vi.fn()}
      />
    );
    // Click the Select to open it
    const selectSearch = screen.getByRole('combobox');
    await userEvent.click(selectSearch);
    // Click the "全局" option
    await waitFor(() => {
      expect(screen.getByText('全局')).toBeTruthy();
    });
    await userEvent.click(screen.getByText('全局'));
    // Now the button should not be disabled
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /选\s*择\s*文\s*件/ });
      expect(btn.getAttribute('disabled')).toBeNull();
    });
  });

  it('pickFile 成功进入阶段 B 显示文件名和统计', async () => {
    const onPickFile = vi.fn().mockResolvedValue({
      success: true,
      data: {
        cancelled: false,
        fileName: 'tags.txt',
        records: [{ tagName: 'a' }, { tagName: 'b' }],
      },
    });
    render(
      <ImportTagsDialog
        open
        title="导入收藏标签"
        sites={sites}
        onCancel={() => {}}
        onPickFile={onPickFile}
        onCommit={vi.fn()}
        onImported={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByText('全局'));
    await userEvent.click(screen.getByRole('button', { name: /选\s*择\s*文\s*件/ }));
    await waitFor(() => {
      expect(screen.getByText(/tags\.txt/)).toBeTruthy();
      expect(screen.getByText(/2\s*条/)).toBeTruthy();
    });
  });

  it('pickFile 取消保持在阶段 A', async () => {
    const onPickFile = vi.fn().mockResolvedValue({
      success: true,
      data: { cancelled: true },
    });
    render(
      <ImportTagsDialog
        open
        title="导入"
        sites={sites}
        onCancel={() => {}}
        onPickFile={onPickFile}
        onCommit={vi.fn()}
        onImported={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByText('全局'));
    await userEvent.click(screen.getByRole('button', { name: /选\s*择\s*文\s*件/ }));
    // Should still be in Stage A (preview screen not shown)
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /确\s*认\s*导\s*入/ })).toBeNull();
    });
  });

  it('commit 成功调 onImported 并关闭', async () => {
    const onPickFile = vi.fn().mockResolvedValue({
      success: true,
      data: { cancelled: false, fileName: 'a.txt', records: [{ tagName: 'a' }] },
    });
    const onCommit = vi.fn().mockResolvedValue({
      success: true,
      data: { imported: 1, skipped: 0 },
    });
    const onImported = vi.fn();
    render(
      <ImportTagsDialog
        open
        title="导入"
        sites={sites}
        onCancel={() => {}}
        onPickFile={onPickFile}
        onCommit={onCommit}
        onImported={onImported}
      />
    );
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByText('全局'));
    await userEvent.click(screen.getByRole('button', { name: /选\s*择\s*文\s*件/ }));
    await waitFor(() => screen.getByText(/a\.txt/));
    await userEvent.click(screen.getByRole('button', { name: /确\s*认\s*导\s*入/ }));
    await waitFor(() => {
      expect(onImported).toHaveBeenCalledWith({ imported: 1, skipped: 0 });
    });
  });
});
