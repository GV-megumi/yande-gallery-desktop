import { useLayoutEffect, useRef } from 'react';

/**
 * useViewScrollMemory — 页内视图切换的滚动位置记忆（内存级，不持久化）。
 *
 * 背景：App 的每个缓存页只有一个 overflowY:auto 的滚动容器，页内「列表 ↔ 详情」
 * 这类整视图切换共用同一个容器，scrollTop 会从一个视图"漏"到另一个视图——
 * 进详情下拉后返回，列表也跟着滚走了。本 hook 按 viewKey 给每个视图记住各自位置：
 *
 *   - 通过容器 scroll 事件持续记录当前 viewKey 的 scrollTop（passive 监听）。
 *     不能等切换时再读：React 提交后 DOM 内容已换，scrollTop 可能已被浏览器
 *     按新内容高度截断，读到的不再是旧视图的位置；
 *   - viewKey 变化时（DOM 已提交、绘制前）把新视图记住的位置写回容器，首访默认 0。
 *
 * 约束：
 *   - 恢复时若新视图内容尚未撑起高度（如详情图片异步加载中），浏览器会把写入值
 *     截到当前最大值，属预期降级；首要场景「返回列表」的列表数据仍在 state 里，
 *     提交即有完整高度，恢复精确；
 *   - 同一容器上可能有多个本 hook 实例（App 缓存页外壳 + 页面自身）。被叠加/切走
 *     的页面必须传 enabled=false（一般用 !suspended），否则会把别的视图滚动记到
 *     自己当前 viewKey 头上。
 */

/** 从 start 起（含自身）向上找最近的可滚动祖先（overflowY: auto|scroll） */
export function findScrollableAncestor(start: HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = start;
  while (el) {
    const style = window.getComputedStyle(el);
    if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

interface ViewScrollMemoryOptions {
  /** 为 false 时暂停记录与恢复（页面被导航栈叠加或切走隐藏时传 !suspended），默认 true */
  enabled?: boolean;
}

export function useViewScrollMemory(
  anchorRef: React.RefObject<HTMLElement | null>,
  viewKey: string,
  options: ViewScrollMemoryOptions = {},
): void {
  const enabled = options.enabled ?? true;
  const positionsRef = useRef<Map<string, number>>(new Map());
  const activeKeyRef = useRef(viewKey);
  const containerRef = useRef<HTMLElement | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // 解析滚动容器并挂 scroll 监听，持续记录当前视图的位置。
  // 无依赖数组：首渲可能处于加载分支（锚点未挂载），每次提交轻量重试直到解析成功；
  // 容器是缓存页外壳这类与页面同生命周期的元素，解析成功后 O(1) 早退不再重复。
  useLayoutEffect(() => {
    if (containerRef.current) return;
    const container = findScrollableAncestor(anchorRef.current);
    if (!container) return;
    containerRef.current = container;
    const handleScroll = () => {
      if (!enabledRef.current) return;
      positionsRef.current.set(activeKeyRef.current, container.scrollTop);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    detachRef.current = () => container.removeEventListener('scroll', handleScroll);
  });

  // 卸载时移除监听
  useLayoutEffect(() => () => {
    detachRef.current?.();
    detachRef.current = null;
  }, []);

  // viewKey 变化（且未悬挂）时恢复新视图的已记位置；悬挂期间发生的切换在恢复
  // enabled 时补做（activeKeyRef 与 viewKey 不一致即视为有待恢复的切换）。
  useLayoutEffect(() => {
    if (!enabled) return;
    if (activeKeyRef.current === viewKey) return;
    activeKeyRef.current = viewKey;
    const container = containerRef.current;
    if (!container) return;
    container.scrollTop = positionsRef.current.get(viewKey) ?? 0;
  }, [viewKey, enabled]);
}
