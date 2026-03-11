import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * useDebounce Hook 纯逻辑测试
 * 提取防抖的核心逻辑（setTimeout + clearTimeout）进行测试
 * 不依赖 React，纯逻辑验证
 */

// ========= 等价实现：防抖逻辑 =========

/**
 * 模拟 useDebounce 的核心逻辑
 * 使用回调模式而非 React state 模式
 */
function createDebouncer<T>(delay: number = 300) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let currentValue: T | undefined;

  return {
    /** 更新值，delay 后生效 */
    update(value: T, callback: (v: T) => void): void {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        currentValue = value;
        callback(value);
      }, delay);
    },
    /** 取消待生效的更新 */
    cancel(): void {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    /** 获取当前生效的值 */
    get value(): T | undefined {
      return currentValue;
    }
  };
}

// ========= 测试 =========

describe('useDebounce 核心逻辑', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('基本防抖功能', () => {
    it('应在 delay 后更新值', () => {
      const debouncer = createDebouncer<string>(300);
      const callback = vi.fn();

      debouncer.update('hello', callback);

      // 未到时间，不应调用
      expect(callback).not.toHaveBeenCalled();

      // 快进 300ms
      vi.advanceTimersByTime(300);

      expect(callback).toHaveBeenCalledWith('hello');
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('连续更新应只生效最后一次', () => {
      const debouncer = createDebouncer<string>(300);
      const callback = vi.fn();

      debouncer.update('a', callback);
      vi.advanceTimersByTime(100);
      debouncer.update('b', callback);
      vi.advanceTimersByTime(100);
      debouncer.update('c', callback);

      // 再等 300ms
      vi.advanceTimersByTime(300);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('c');
    });

    it('间隔足够大时每次更新都应生效', () => {
      const debouncer = createDebouncer<string>(300);
      const callback = vi.fn();

      debouncer.update('a', callback);
      vi.advanceTimersByTime(300);
      expect(callback).toHaveBeenCalledWith('a');

      debouncer.update('b', callback);
      vi.advanceTimersByTime(300);
      expect(callback).toHaveBeenCalledWith('b');

      expect(callback).toHaveBeenCalledTimes(2);
    });
  });

  describe('不同 delay 值', () => {
    it('delay=0 应立即生效（在下一个 tick）', () => {
      const debouncer = createDebouncer<number>(0);
      const callback = vi.fn();

      debouncer.update(42, callback);
      vi.advanceTimersByTime(0);

      expect(callback).toHaveBeenCalledWith(42);
    });

    it('delay=1000 应在 1 秒后生效', () => {
      const debouncer = createDebouncer<number>(1000);
      const callback = vi.fn();

      debouncer.update(42, callback);

      vi.advanceTimersByTime(500);
      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);
      expect(callback).toHaveBeenCalledWith(42);
    });
  });

  describe('取消功能', () => {
    it('cancel 应阻止值更新', () => {
      const debouncer = createDebouncer<string>(300);
      const callback = vi.fn();

      debouncer.update('hello', callback);
      vi.advanceTimersByTime(100);

      debouncer.cancel();
      vi.advanceTimersByTime(300);

      expect(callback).not.toHaveBeenCalled();
    });

    it('cancel 后可以重新 update', () => {
      const debouncer = createDebouncer<string>(300);
      const callback = vi.fn();

      debouncer.update('a', callback);
      debouncer.cancel();

      debouncer.update('b', callback);
      vi.advanceTimersByTime(300);

      expect(callback).toHaveBeenCalledWith('b');
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('类型安全', () => {
    it('应支持数字类型', () => {
      const debouncer = createDebouncer<number>(100);
      const callback = vi.fn();

      debouncer.update(42, callback);
      vi.advanceTimersByTime(100);

      expect(callback).toHaveBeenCalledWith(42);
    });

    it('应支持对象类型', () => {
      const debouncer = createDebouncer<{ name: string }>(100);
      const callback = vi.fn();
      const obj = { name: 'test' };

      debouncer.update(obj, callback);
      vi.advanceTimersByTime(100);

      expect(callback).toHaveBeenCalledWith(obj);
    });

    it('应支持 null 值', () => {
      const debouncer = createDebouncer<null>(100);
      const callback = vi.fn();

      debouncer.update(null, callback);
      vi.advanceTimersByTime(100);

      expect(callback).toHaveBeenCalledWith(null);
    });
  });

  describe('搜索场景模拟', () => {
    it('快速输入应只触发一次搜索', () => {
      const debouncer = createDebouncer<string>(300);
      const search = vi.fn();

      // 模拟用户快速输入 "girl"
      debouncer.update('g', search);
      vi.advanceTimersByTime(50);
      debouncer.update('gi', search);
      vi.advanceTimersByTime(50);
      debouncer.update('gir', search);
      vi.advanceTimersByTime(50);
      debouncer.update('girl', search);

      // 等待防抖结束
      vi.advanceTimersByTime(300);

      expect(search).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledWith('girl');
    });

    it('输入暂停后继续输入应重置计时器', () => {
      const debouncer = createDebouncer<string>(300);
      const search = vi.fn();

      debouncer.update('blue', search);
      vi.advanceTimersByTime(200); // 暂停 200ms
      debouncer.update('blue_eyes', search); // 继续输入

      vi.advanceTimersByTime(300);

      expect(search).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledWith('blue_eyes');
    });
  });
});
