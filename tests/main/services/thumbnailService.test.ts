import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * ThumbnailQueue 逻辑测试
 * thumbnailService.ts 中的 ThumbnailQueue 是私有类，无法直接导入
 * 这里使用等价实现来测试队列的核心逻辑：
 * - 并发控制（maxConcurrent）
 * - 重复任务去重
 * - 队列 FIFO 顺序
 * - 错误处理
 */

type TaskResult = { success: boolean; data?: string; error?: string };
type TaskWorker = (imagePath: string) => Promise<TaskResult>;

class TestThumbnailQueue {
  private queue: Array<{
    imagePath: string;
    resolve: (value: TaskResult) => void;
    reject: (error: Error) => void;
  }> = [];
  private running: Map<string, Promise<TaskResult>> = new Map();
  private maxConcurrent: number;
  private worker: TaskWorker;

  constructor(maxConcurrent: number, worker: TaskWorker) {
    this.maxConcurrent = maxConcurrent;
    this.worker = worker;
  }

  async enqueue(imagePath: string): Promise<TaskResult> {
    // 如果正在运行中，返回同一个 Promise
    const existingTask = this.running.get(imagePath);
    if (existingTask) {
      return existingTask;
    }

    // 如果已在队列中，共享 Promise
    const existingInQueue = this.queue.find(task => task.imagePath === imagePath);
    if (existingInQueue) {
      return new Promise((resolve, reject) => {
        const originalResolve = existingInQueue.resolve;
        const originalReject = existingInQueue.reject;
        existingInQueue.resolve = (value) => { originalResolve(value); resolve(value); };
        existingInQueue.reject = (error) => { originalReject(error); reject(error); };
      });
    }

    return new Promise<TaskResult>((resolve, reject) => {
      this.queue.push({ imagePath, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.running.size >= this.maxConcurrent) return;
    if (this.queue.length === 0) return;

    const task = this.queue.shift();
    if (!task) return;

    const { imagePath, resolve, reject } = task;

    const taskPromise = (async () => {
      try {
        const result = await this.worker(imagePath);
        resolve(result);
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        reject(new Error(errorMessage));
        return { success: false, error: errorMessage };
      } finally {
        this.running.delete(imagePath);
        this.processQueue();
      }
    })();

    this.running.set(imagePath, taskPromise);
  }

  getRunningCount(): number {
    return this.running.size;
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}

describe('ThumbnailQueue 逻辑', () => {
  describe('基本功能', () => {
    it('应正确处理单个任务', async () => {
      const worker = vi.fn(async (path: string) => ({ success: true, data: path + '_thumb' }));
      const queue = new TestThumbnailQueue(3, worker);

      const result = await queue.enqueue('/test/image.jpg');
      expect(result).toEqual({ success: true, data: '/test/image.jpg_thumb' });
      expect(worker).toHaveBeenCalledWith('/test/image.jpg');
    });

    it('应按顺序处理多个任务', async () => {
      const order: string[] = [];
      const worker = vi.fn(async (path: string) => {
        order.push(path);
        return { success: true, data: path };
      });
      const queue = new TestThumbnailQueue(1, worker);

      const p1 = queue.enqueue('a.jpg');
      const p2 = queue.enqueue('b.jpg');
      const p3 = queue.enqueue('c.jpg');

      await Promise.all([p1, p2, p3]);
      expect(order).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    });

    it('应返回正确的结果', async () => {
      const worker = vi.fn(async (path: string) => {
        if (path === 'fail.jpg') return { success: false, error: '生成失败' };
        return { success: true, data: path + '_thumb' };
      });
      const queue = new TestThumbnailQueue(3, worker);

      const r1 = await queue.enqueue('ok.jpg');
      const r2 = await queue.enqueue('fail.jpg');

      expect(r1.success).toBe(true);
      expect(r1.data).toBe('ok.jpg_thumb');
      expect(r2.success).toBe(false);
      expect(r2.error).toBe('生成失败');
    });
  });

  describe('并发控制', () => {
    it('应限制最大并发数', async () => {
      let maxConcurrent = 0;
      let currentRunning = 0;

      const worker = vi.fn(async (path: string) => {
        currentRunning++;
        maxConcurrent = Math.max(maxConcurrent, currentRunning);
        // 模拟异步工作
        await new Promise(resolve => setTimeout(resolve, 10));
        currentRunning--;
        return { success: true, data: path };
      });

      const queue = new TestThumbnailQueue(2, worker);

      const tasks = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'];
      await Promise.all(tasks.map(t => queue.enqueue(t)));

      expect(maxConcurrent).toBeLessThanOrEqual(2);
      expect(worker).toHaveBeenCalledTimes(5);
    });

    it('并发数为 1 时应串行执行', async () => {
      const order: string[] = [];
      const worker = vi.fn(async (path: string) => {
        order.push('start:' + path);
        await new Promise(resolve => setTimeout(resolve, 5));
        order.push('end:' + path);
        return { success: true, data: path };
      });

      const queue = new TestThumbnailQueue(1, worker);

      await Promise.all([
        queue.enqueue('a.jpg'),
        queue.enqueue('b.jpg'),
      ]);

      // 串行时，a 应在 b 之前完全完成
      expect(order.indexOf('end:a.jpg')).toBeLessThan(order.indexOf('start:b.jpg'));
    });
  });

  describe('去重', () => {
    it('正在运行的相同路径应共享结果', async () => {
      let callCount = 0;
      const worker = vi.fn(async (path: string) => {
        callCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
        return { success: true, data: path + '_thumb' };
      });

      const queue = new TestThumbnailQueue(1, worker);

      // 同时提交相同路径
      const p1 = queue.enqueue('same.jpg');
      const p2 = queue.enqueue('same.jpg');

      const [r1, r2] = await Promise.all([p1, p2]);

      // worker 只应被调用一次
      expect(callCount).toBe(1);
      // 两个结果应相同
      expect(r1).toEqual(r2);
    });

    it('队列中的相同路径应共享结果', async () => {
      let callCount = 0;
      const worker = vi.fn(async (path: string) => {
        callCount++;
        await new Promise(resolve => setTimeout(resolve, 10));
        return { success: true, data: path + '_thumb' };
      });

      const queue = new TestThumbnailQueue(1, worker);

      // 先占用并发槽
      const blocking = queue.enqueue('blocking.jpg');
      // 然后提交两个相同的
      const p1 = queue.enqueue('dup.jpg');
      const p2 = queue.enqueue('dup.jpg');

      await blocking;
      const [r1, r2] = await Promise.all([p1, p2]);

      // dup.jpg 的 worker 只应被调用一次
      expect(worker).toHaveBeenCalledTimes(2); // blocking + dup
      expect(r1).toEqual(r2);
    });

    it('不同路径不应去重', async () => {
      const worker = vi.fn(async (path: string) => {
        return { success: true, data: path };
      });

      const queue = new TestThumbnailQueue(3, worker);

      await Promise.all([
        queue.enqueue('a.jpg'),
        queue.enqueue('b.jpg'),
        queue.enqueue('c.jpg'),
      ]);

      expect(worker).toHaveBeenCalledTimes(3);
    });
  });

  describe('错误处理', () => {
    it('worker 抛出异常应 reject', async () => {
      const worker = vi.fn(async () => {
        throw new Error('sharp 加载失败');
      });

      const queue = new TestThumbnailQueue(3, worker);

      await expect(queue.enqueue('crash.jpg')).rejects.toThrow('sharp 加载失败');
    });

    it('单个任务失败不应影响其他任务', async () => {
      let callIndex = 0;
      const worker = vi.fn(async (path: string) => {
        callIndex++;
        if (callIndex === 2) throw new Error('第二个任务失败');
        return { success: true, data: path };
      });

      const queue = new TestThumbnailQueue(1, worker);

      const p1 = queue.enqueue('a.jpg');
      const p2 = queue.enqueue('b.jpg');
      const p3 = queue.enqueue('c.jpg');

      const r1 = await p1;
      expect(r1.success).toBe(true);

      await expect(p2).rejects.toThrow('第二个任务失败');

      const r3 = await p3;
      expect(r3.success).toBe(true);
    });

    it('失败后队列应继续处理', async () => {
      const results: string[] = [];
      const worker = vi.fn(async (path: string) => {
        if (path === 'fail.jpg') throw new Error('失败');
        results.push(path);
        return { success: true, data: path };
      });

      const queue = new TestThumbnailQueue(1, worker);

      const p1 = queue.enqueue('before.jpg');
      const p2 = queue.enqueue('fail.jpg');
      const p3 = queue.enqueue('after.jpg');

      await p1;
      try { await p2; } catch {}
      await p3;

      expect(results).toEqual(['before.jpg', 'after.jpg']);
    });
  });

  describe('队列状态', () => {
    it('空队列状态应为 0', () => {
      const queue = new TestThumbnailQueue(3, async () => ({ success: true }));
      expect(queue.getRunningCount()).toBe(0);
      expect(queue.getQueueLength()).toBe(0);
    });

    it('任务完成后运行计数应清零', async () => {
      const queue = new TestThumbnailQueue(3, async (path) => ({ success: true, data: path }));

      await queue.enqueue('test.jpg');
      expect(queue.getRunningCount()).toBe(0);
      expect(queue.getQueueLength()).toBe(0);
    });
  });
});
