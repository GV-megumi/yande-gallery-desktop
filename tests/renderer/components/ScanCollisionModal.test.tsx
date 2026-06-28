/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScanCollisionModal } from '../../../src/renderer/components/ScanCollisionModal';

// antd 组件依赖 matchMedia / getComputedStyle，jsdom 默认无实现，补 no-op。
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

// vitest 未开启 globals，手动 cleanup 防止 antd Modal portal 残留跨 test 干扰。
afterEach(() => {
  cleanup();
});

const baseProps = {
  open: true,
  newFolders: [{ folderPath: 'D:/pics/new-a', name: 'new-a' }],
  collisions: [
    { folderPath: 'D:/pics/dup-a', name: 'dup-a', existingGalleryId: 11, existingGalleryName: '已有图集A' },
    { folderPath: 'D:/pics/dup-b', name: 'dup-b', existingGalleryId: 22, existingGalleryName: '已有图集B' },
  ],
  skipped: [{ folderPath: 'D:/pics/skip-a', name: 'skip-a', reason: 'alreadyBound' as const }],
  onCancel: () => {},
  onConfirm: vi.fn(),
};

describe('ScanCollisionModal', () => {
  it('open=false 不渲染', () => {
    const { container } = render(<ScanCollisionModal {...baseProps} open={false} onConfirm={vi.fn()} />);
    expect(container.querySelector('.ant-modal')).toBeNull();
  });

  it('展示每个碰撞行的文件夹名、已有图集名，以及新增/跳过计数', () => {
    render(<ScanCollisionModal {...baseProps} onConfirm={vi.fn()} />);
    expect(screen.getByText('dup-a')).toBeTruthy();
    expect(screen.getByText('dup-b')).toBeTruthy();
    // 已有图集名出现在合并选项里
    expect(screen.getAllByText(/已有图集A/).length).toBeGreaterThan(0);
    // 新增 1 个、跳过 1 个的计数提示存在（可能出现在多处，断言至少一处）
    expect(screen.getAllByText(/新增/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/跳过/).length).toBeGreaterThan(0);
  });

  it('默认全部合并：确认时把碰撞按 galleryId 合并，并带上 newFolders', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ScanCollisionModal {...baseProps} onConfirm={onConfirm} />);

    await userEvent.click(screen.getByRole('button', { name: /确\s*认/ }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
    expect(onConfirm).toHaveBeenCalledWith({
      create: [{ folderPath: 'D:/pics/new-a', name: 'new-a' }],
      merge: [
        { folderPath: 'D:/pics/dup-a', galleryId: 11 },
        { folderPath: 'D:/pics/dup-b', galleryId: 22 },
      ],
    });
  });

  it('「全部新建」后确认：碰撞改为以原名新建独立图集，merge 为空', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ScanCollisionModal {...baseProps} onConfirm={onConfirm} />);

    await userEvent.click(screen.getByRole('button', { name: /全部新建/ }));
    await userEvent.click(screen.getByRole('button', { name: /确\s*认/ }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
    expect(onConfirm).toHaveBeenCalledWith({
      create: [
        { folderPath: 'D:/pics/new-a', name: 'new-a' },
        { folderPath: 'D:/pics/dup-a', name: 'dup-a' },
        { folderPath: 'D:/pics/dup-b', name: 'dup-b' },
      ],
      merge: [],
    });
  });

  it('单行切换为新建后其余仍合并', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ScanCollisionModal {...baseProps} onConfirm={onConfirm} />);

    // 找到 dup-a 所在行，点击该行的「新建独立图集」选项
    const rowA = screen.getByText('dup-a').closest('[data-testid="collision-row"]') as HTMLElement;
    expect(rowA).toBeTruthy();
    const createRadio = within(rowA).getByRole('radio', { name: /新建独立图集/ });
    await userEvent.click(createRadio);

    await userEvent.click(screen.getByRole('button', { name: /确\s*认/ }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
    expect(onConfirm).toHaveBeenCalledWith({
      create: [
        { folderPath: 'D:/pics/new-a', name: 'new-a' },
        { folderPath: 'D:/pics/dup-a', name: 'dup-a' },
      ],
      merge: [{ folderPath: 'D:/pics/dup-b', galleryId: 22 }],
    });
  });
});
