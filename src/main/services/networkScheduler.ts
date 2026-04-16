/**
 * 网络调度器 - 智能协调浏览和下载的网络优先级
 *
 * 当用户浏览图片时（图片缓存请求活跃），自动降低下载任务的并发数，
 * 确保浏览体验流畅；当浏览停止后，自动恢复下载并发。
 */

type BrowsingChangeCallback = (isBrowsingActive: boolean) => void;

type BrowsingChangeUnsubscribe = () => void;

class NetworkScheduler {
  /** 当前活跃的浏览请求数（图片缓存下载） */
  private activeBrowsingRequests = 0;
  /** 浏览状态变化的监听器 */
  private onChangeCallbacks = new Set<BrowsingChangeCallback>();
  /** 用于延迟恢复下载的定时器（避免频繁切换） */
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;
  /** 恢复延迟（ms），浏览请求结束后延迟一段时间再恢复下载并发 */
  private restoreDelay = 2000;

  /**
   * 记录一个浏览请求开始（图片缓存下载开始时调用）
   */
  incrementBrowsing(): void {
    const wasBrowsing = this.activeBrowsingRequests > 0;
    this.activeBrowsingRequests++;

    // 取消恢复定时器（因为有新的浏览请求）
    if (this.restoreTimer) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }

    if (!wasBrowsing) {
      console.log('[NetworkScheduler] 浏览模式激活，降低下载优先级');
      this.notify(true);
    }
  }

  /**
   * 记录一个浏览请求结束（图片缓存下载完成时调用）
   */
  decrementBrowsing(): void {
    this.activeBrowsingRequests = Math.max(0, this.activeBrowsingRequests - 1);

    if (this.activeBrowsingRequests === 0) {
      // 延迟恢复，避免连续请求间的频繁切换
      if (this.restoreTimer) clearTimeout(this.restoreTimer);
      this.restoreTimer = setTimeout(() => {
        this.restoreTimer = null;
        if (this.activeBrowsingRequests === 0) {
          console.log('[NetworkScheduler] 浏览模式结束，恢复下载优先级');
          this.notify(false);
        }
      }, this.restoreDelay);
    }
  }

  /**
   * 当前是否处于浏览模式（有活跃的图片加载请求）
   */
  isBrowsingActive(): boolean {
    return this.activeBrowsingRequests > 0;
  }

  /**
   * 注册浏览状态变化回调
   */
  onChange(callback: BrowsingChangeCallback): BrowsingChangeUnsubscribe {
    this.onChangeCallbacks.add(callback);
    return () => {
      this.onChangeCallbacks.delete(callback);
    };
  }

  private notify(isBrowsing: boolean): void {
    for (const cb of this.onChangeCallbacks) {
      try {
        cb(isBrowsing);
      } catch (error) {
        console.error('[NetworkScheduler] 回调执行失败:', error);
      }
    }
  }
}

export const networkScheduler = new NetworkScheduler();
