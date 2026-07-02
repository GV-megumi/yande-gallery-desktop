/** @vitest-environment jsdom */

import React, { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useViewScrollMemory, findScrollableAncestor } from '../../../src/renderer/hooks/useViewScrollMemory';

/**
 * useViewScrollMemory — 页内视图切换的滚动位置记忆
 *
 * jsdom 无布局引擎：scrollTop 是可读写的普通属性且不被内容高度截断，
 * scroll 事件用 dispatchEvent 手动派发，正好可以精确断言保存/恢复行为。
 */

/** 测试组件：外层可滚动容器 + 内层锚点，viewKey/enabled 由 props 驱动 */
const Harness: React.FC<{ viewKey: string; enabled?: boolean }> = ({ viewKey, enabled }) => {
  const anchorRef = useRef<HTMLDivElement>(null);
  useViewScrollMemory(anchorRef, viewKey, { enabled });
  return (
    <div data-testid="scroller" style={{ overflowY: 'auto', height: 100 }}>
      <div ref={anchorRef}>content</div>
    </div>
  );
};

/** 把容器滚到指定位置并派发 scroll 事件（模拟用户滚动） */
function scrollTo(container: HTMLElement, top: number): void {
  container.scrollTop = top;
  container.dispatchEvent(new Event('scroll'));
}

afterEach(() => {
  cleanup();
});

describe('useViewScrollMemory', () => {
  it('切换视图时各自记住并恢复滚动位置；首次进入的视图回到顶部', () => {
    const { rerender } = render(<Harness viewKey="list" />);
    const scroller = screen.getByTestId('scroller');

    // 列表滚到 300
    scrollTo(scroller, 300);

    // 进入详情：首访 → 顶部
    rerender(<Harness viewKey="detail:1" />);
    expect(scroller.scrollTop).toBe(0);

    // 详情里滚到 120，返回列表 → 恢复 300
    scrollTo(scroller, 120);
    rerender(<Harness viewKey="list" />);
    expect(scroller.scrollTop).toBe(300);

    // 再进同一详情 → 恢复 120
    rerender(<Harness viewKey="detail:1" />);
    expect(scroller.scrollTop).toBe(120);
  });

  it('enabled=false 期间的滚动不记入当前视图（防止叠加页滚动污染）', () => {
    const { rerender } = render(<Harness viewKey="list" enabled />);
    const scroller = screen.getByTestId('scroller');
    scrollTo(scroller, 300);

    // 悬挂：期间容器被别的视图（如导航栈叠加页）滚到 700，不得记到 list 头上
    rerender(<Harness viewKey="list" enabled={false} />);
    scrollTo(scroller, 700);

    // 恢复启用（key 未变不触发恢复），随后进详情再返回列表 → 仍是悬挂前的 300
    rerender(<Harness viewKey="list" enabled />);
    rerender(<Harness viewKey="detail:9" enabled />);
    scrollTo(scroller, 50);
    rerender(<Harness viewKey="list" enabled />);
    expect(scroller.scrollTop).toBe(300);
  });

  it('悬挂期间发生的视图切换在恢复启用时补做恢复', () => {
    const { rerender } = render(<Harness viewKey="list" enabled />);
    const scroller = screen.getByTestId('scroller');
    scrollTo(scroller, 300);

    // 悬挂状态下切到详情：不立即恢复（scrollTop 保持原值）
    rerender(<Harness viewKey="detail:2" enabled={false} />);
    expect(scroller.scrollTop).toBe(300);

    // 恢复启用：补做详情视图的恢复（首访 → 顶部）
    rerender(<Harness viewKey="detail:2" enabled />);
    expect(scroller.scrollTop).toBe(0);

    // 返回列表恢复 300
    rerender(<Harness viewKey="list" enabled />);
    expect(scroller.scrollTop).toBe(300);
  });

  it('无可滚动祖先时安全 no-op（子窗口等场景不崩溃）', () => {
    const Bare: React.FC<{ viewKey: string }> = ({ viewKey }) => {
      const anchorRef = useRef<HTMLDivElement>(null);
      useViewScrollMemory(anchorRef, viewKey);
      return <div ref={anchorRef}>bare</div>;
    };
    const { rerender } = render(<Bare viewKey="list" />);
    expect(() => rerender(<Bare viewKey="detail:1" />)).not.toThrow();
  });

  it('锚点后挂载（首渲处于加载分支）时，容器在后续提交被解析并正常工作', () => {
    const Late: React.FC<{ ready: boolean; viewKey: string }> = ({ ready, viewKey }) => {
      const anchorRef = useRef<HTMLDivElement>(null);
      useViewScrollMemory(anchorRef, viewKey);
      return (
        <div data-testid="late-scroller" style={{ overflowY: 'auto' }}>
          {ready ? <div ref={anchorRef}>content</div> : <span>loading</span>}
        </div>
      );
    };
    const { rerender } = render(<Late ready={false} viewKey="list" />);
    const scroller = screen.getByTestId('late-scroller');

    // 锚点挂载后容器解析成功，滚动开始被记录
    rerender(<Late ready viewKey="list" />);
    scrollTo(scroller, 240);
    rerender(<Late ready viewKey="detail:5" />);
    expect(scroller.scrollTop).toBe(0);
    rerender(<Late ready viewKey="list" />);
    expect(scroller.scrollTop).toBe(240);
  });
});

describe('findScrollableAncestor', () => {
  it('从自身起向上找最近的 overflowY:auto|scroll 祖先；找不到返回 null', () => {
    render(
      <div data-testid="outer" style={{ overflowY: 'scroll' }}>
        <div data-testid="inner" style={{ overflowY: 'auto' }}>
          <div data-testid="leaf">leaf</div>
        </div>
      </div>,
    );
    const outer = screen.getByTestId('outer');
    const inner = screen.getByTestId('inner');
    const leaf = screen.getByTestId('leaf');

    // 就近原则：leaf → inner；inner 自身可滚动 → inner；outer 自身 → outer
    expect(findScrollableAncestor(leaf)).toBe(inner);
    expect(findScrollableAncestor(inner)).toBe(inner);
    expect(findScrollableAncestor(outer)).toBe(outer);
    expect(findScrollableAncestor(null)).toBeNull();
  });
});
