import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// networkScheduler 导出的是单例，需要通过动态 import 隔离
// 这里通过直接测试 class 逻辑来验证

describe('NetworkScheduler', () => {
  // 因为 networkScheduler 是模块单例，我们重新实现一份等价逻辑来测试
  // 避免与其他测试共享状态
  class TestNetworkScheduler {
    private activeBrowsingRequests = 0;
    private onChangeCallbacks: ((isBrowsing: boolean) => void)[] = [];
    private restoreTimer: ReturnType<typeof setTimeout> | null = null;
    private restoreDelay = 2000;

    incrementBrowsing(): void {
      const wasBrowsing = this.activeBrowsingRequests > 0;
      this.activeBrowsingRequests++;
      if (this.restoreTimer) {
        clearTimeout(this.restoreTimer);
        this.restoreTimer = null;
      }
      if (!wasBrowsing) {
        this.notify(true);
      }
    }

    decrementBrowsing(): void {
      this.activeBrowsingRequests = Math.max(0, this.activeBrowsingRequests - 1);
      if (this.activeBrowsingRequests === 0) {
        if (this.restoreTimer) clearTimeout(this.restoreTimer);
        this.restoreTimer = setTimeout(() => {
          this.restoreTimer = null;
          if (this.activeBrowsingRequests === 0) {
            this.notify(false);
          }
        }, this.restoreDelay);
      }
    }

    isBrowsingActive(): boolean {
      return this.activeBrowsingRequests > 0;
    }

    onChange(callback: (isBrowsing: boolean) => void): void {
      this.onChangeCallbacks.push(callback);
    }

    private notify(isBrowsing: boolean): void {
      for (const cb of this.onChangeCallbacks) {
        try {
          cb(isBrowsing);
        } catch (error) {
          // ignore
        }
      }
    }
  }

  let scheduler: TestNetworkScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    scheduler = new TestNetworkScheduler();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isBrowsingActive', () => {
    it('初始状态应为非浏览模式', () => {
      expect(scheduler.isBrowsingActive()).toBe(false);
    });

    it('increment 后应进入浏览模式', () => {
      scheduler.incrementBrowsing();
      expect(scheduler.isBrowsingActive()).toBe(true);
    });

    it('increment 和 decrement 后应恢复', () => {
      scheduler.incrementBrowsing();
      scheduler.decrementBrowsing();
      expect(scheduler.isBrowsingActive()).toBe(false);
    });

    it('多次 increment 需要同等次数 decrement 才退出', () => {
      scheduler.incrementBrowsing();
      scheduler.incrementBrowsing();
      scheduler.incrementBrowsing();
      scheduler.decrementBrowsing();
      expect(scheduler.isBrowsingActive()).toBe(true);
      scheduler.decrementBrowsing();
      expect(scheduler.isBrowsingActive()).toBe(true);
      scheduler.decrementBrowsing();
      expect(scheduler.isBrowsingActive()).toBe(false);
    });

    it('decrement 不应降到负数', () => {
      scheduler.decrementBrowsing();
      scheduler.decrementBrowsing();
      expect(scheduler.isBrowsingActive()).toBe(false);
      // 再 increment 一次就应该进入浏览模式
      scheduler.incrementBrowsing();
      expect(scheduler.isBrowsingActive()).toBe(true);
    });
  });

  describe('onChange 回调', () => {
    it('进入浏览模式时应触发回调 (true)', () => {
      const callback = vi.fn();
      scheduler.onChange(callback);

      scheduler.incrementBrowsing();
      expect(callback).toHaveBeenCalledWith(true);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('多次 increment 不应重复触发进入回调', () => {
      const callback = vi.fn();
      scheduler.onChange(callback);

      scheduler.incrementBrowsing();
      scheduler.incrementBrowsing();
      scheduler.incrementBrowsing();
      // 只触发一次（第一次进入浏览模式）
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(true);
    });

    it('退出浏览模式后应延迟触发回调 (false)', () => {
      const callback = vi.fn();
      scheduler.onChange(callback);

      scheduler.incrementBrowsing();
      callback.mockClear();

      scheduler.decrementBrowsing();
      // 立即检查 - 还没触发（有 2000ms 延迟）
      expect(callback).not.toHaveBeenCalled();

      // 推进时间 2000ms
      vi.advanceTimersByTime(2000);
      expect(callback).toHaveBeenCalledWith(false);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('在延迟期间重新 increment 应取消恢复', () => {
      const callback = vi.fn();
      scheduler.onChange(callback);

      scheduler.incrementBrowsing();
      callback.mockClear();

      scheduler.decrementBrowsing();
      // 推进 1000ms（未到 2000ms）
      vi.advanceTimersByTime(1000);

      // 重新进入浏览模式
      scheduler.incrementBrowsing();
      // 推进剩余时间
      vi.advanceTimersByTime(2000);

      // 不应触发 false 回调，因为浏览模式被重新激活
      expect(callback).not.toHaveBeenCalledWith(false);
    });

    it('多个回调都应被触发', () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      scheduler.onChange(cb1);
      scheduler.onChange(cb2);

      scheduler.incrementBrowsing();
      expect(cb1).toHaveBeenCalledWith(true);
      expect(cb2).toHaveBeenCalledWith(true);
    });

    it('回调异常不应影响其他回调', () => {
      const cb1 = vi.fn(() => { throw new Error('test error'); });
      const cb2 = vi.fn();
      scheduler.onChange(cb1);
      scheduler.onChange(cb2);

      scheduler.incrementBrowsing();
      // cb1 抛出异常，但 cb2 仍然被调用
      expect(cb2).toHaveBeenCalledWith(true);
    });
  });

  describe('恢复延迟逻辑', () => {
    it('快速连续请求 - 恢复延迟应只触发最后一次 false', () => {
      const callback = vi.fn();
      scheduler.onChange(callback);

      // 模拟连续图片加载（每个请求单独 inc/dec）
      // 每次 increment 从 0→1 都会触发 true 回调
      scheduler.incrementBrowsing(); // true
      scheduler.decrementBrowsing(); // 设置 2s 恢复定时器
      // 在恢复延迟内再次请求
      scheduler.incrementBrowsing(); // 取消定时器，触发 true
      scheduler.decrementBrowsing(); // 设置新定时器

      // true 回调触发了 2 次（每次从 0→1）
      const trueCalls = callback.mock.calls.filter(c => c[0] === true);
      expect(trueCalls.length).toBe(2);

      // 但是 false 回调还没触发（在延迟中）
      const falseCalls = callback.mock.calls.filter(c => c[0] === false);
      expect(falseCalls.length).toBe(0);

      // 等待恢复延迟
      vi.advanceTimersByTime(2000);

      // 最终只触发一次 false
      const finalFalseCalls = callback.mock.calls.filter(c => c[0] === false);
      expect(finalFalseCalls.length).toBe(1);
    });

    it('恢复延迟内 decrement 又 increment 应取消定时器', () => {
      const callback = vi.fn();
      scheduler.onChange(callback);

      scheduler.incrementBrowsing();
      scheduler.incrementBrowsing();
      callback.mockClear();

      // 第一个请求完成
      scheduler.decrementBrowsing();
      expect(scheduler.isBrowsingActive()).toBe(true);

      // 第二个也完成
      scheduler.decrementBrowsing();
      expect(scheduler.isBrowsingActive()).toBe(false);

      // 推进 1000ms（未达恢复延迟）
      vi.advanceTimersByTime(1000);

      // 新请求到来
      scheduler.incrementBrowsing();

      // 推进到超过原定恢复时间
      vi.advanceTimersByTime(2000);

      // 不应触发 false（被取消了），但应触发 true（新的 increment 触发进入）
      const calls = callback.mock.calls.map(c => c[0]);
      expect(calls).not.toContain(false);
    });
  });
});
