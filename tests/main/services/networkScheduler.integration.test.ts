import { afterEach, describe, expect, it, vi } from 'vitest';

describe('networkScheduler 实际监听管理', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('onChange 应返回可取消监听的函数', async () => {
    vi.useFakeTimers();
    const { networkScheduler } = await import('../../../src/main/services/networkScheduler.js');
    const callback = vi.fn();

    const unsubscribe = networkScheduler.onChange(callback);
    expect(typeof unsubscribe).toBe('function');

    unsubscribe();
    networkScheduler.incrementBrowsing();

    expect(callback).not.toHaveBeenCalled();
  });

  it('取消单个监听后不应影响其他监听器', async () => {
    vi.useFakeTimers();
    const { networkScheduler } = await import('../../../src/main/services/networkScheduler.js');
    const removed = vi.fn();
    const kept = vi.fn();

    const unsubscribe = networkScheduler.onChange(removed);
    networkScheduler.onChange(kept);

    unsubscribe();
    networkScheduler.incrementBrowsing();

    expect(removed).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledWith(true);
  });
});
