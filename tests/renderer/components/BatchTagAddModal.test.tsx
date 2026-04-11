/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BatchTagAddModal } from '../../../src/renderer/components/BatchTagAddModal';

const sites = [
  { id: 1, name: 'yande' },
  { id: 2, name: 'danbooru' },
];

// antd 组件（Modal / Select 等）依赖 matchMedia / getComputedStyle 等浏览器 API，
// jsdom 默认对 matchMedia 无实现，这里补一个 no-op 以避免渲染时报错。
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

// vitest 没有开启 globals，@testing-library/react 的自动 cleanup
// 不会生效。antd Modal 会把内容 portal 到 body，跨 test 会造成残留
// 元素干扰查询（例如多按钮），因此手动 cleanup。
afterEach(() => {
  cleanup();
});

describe('BatchTagAddModal', () => {
  it('open=false 不渲染', () => {
    const { container } = render(
      <BatchTagAddModal
        open={false}
        title="批量添加"
        sites={sites}
        onCancel={() => {}}
        onSubmit={async () => {}}
      />
    );
    expect(container.querySelector('.ant-modal')).toBeNull();
  });

  it('open=true 渲染标题和三个字段', () => {
    render(
      <BatchTagAddModal
        open
        title="批量添加收藏标签"
        sites={sites}
        extraField={{ name: 'labels', label: '分组', placeholder: '例如: 角色' }}
        onCancel={() => {}}
        onSubmit={async () => {}}
      />
    );
    expect(screen.getByText('批量添加收藏标签')).toBeTruthy();
    expect(screen.getByLabelText('所属站点')).toBeTruthy();
    expect(screen.getByLabelText('标签')).toBeTruthy();
    expect(screen.getByLabelText('分组')).toBeTruthy();
  });

  it('空 tagNames 阻止提交', async () => {
    const onSubmit = vi.fn();
    render(
      <BatchTagAddModal
        open
        title="批量添加"
        sites={sites}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />
    );
    // antd 在相邻两个 CJK 字符之间插入一个空格渲染按钮文本（"保 存"），
    // 所以这里用允许中间空白的正则
    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText(/请至少输入一个标签/)).toBeTruthy();
    });
  });

  it('提交后收到正确参数', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <BatchTagAddModal
        open
        title="批量添加"
        sites={sites}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />
    );
    const textarea = screen.getByLabelText('标签');
    await userEvent.type(textarea, 'aoi\ngin');
    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          tagNames: 'aoi\ngin',
          siteId: null,
        })
      );
    });
  });

  it('onSubmit pending 期间保存按钮 loading', async () => {
    let resolveSubmit: () => void = () => {};
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveSubmit = r;
        })
    );
    render(
      <BatchTagAddModal
        open
        title="批量添加"
        sites={sites}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />
    );
    await userEvent.type(screen.getByLabelText('标签'), 'a');
    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /保\s*存/ });
      expect(btn.querySelector('.ant-btn-loading-icon')).toBeTruthy();
    });
    resolveSubmit();
  });
});
