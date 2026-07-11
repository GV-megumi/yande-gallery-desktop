import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

/**
 * 缩略图生成取消（真实模块，非等价实现）：
 * - cancelPending：等待队列中的任务被移除（sharp 不会为其启动），promise 以 cancelled 结果 resolve；
 * - 墓碑：正在生成中的任务被取消后，完成时删除刚生成的缩略图文件、不发 thumbnail:generated；
 * - 目的：堵住"删除图片/相册 → 清理缩略图 → 队列补生成"留下永久孤儿缩略图的竞态。
 *
 * mock 边界：sharp（toFile 由测试控制何时完成）、fs/promises（源文件存在/缩略图不存在/unlink 记录）、
 * config（缩略图目录与参数）、rendererEventBus（通知断言）。
 */

const h = vi.hoisted(() => ({
  /** imagePath → 控制该次 toFile 完成的钩子 */
  toFileControls: new Map<string, { resolve: () => void; reject: (e: Error) => void }>(),
  /** 实际启动过 sharp 生成的 imagePath 顺序 */
  toFileStarted: [] as string[],
  unlinked: [] as string[],
}));

vi.mock('sharp', () => ({
  default: (imagePath: string) => ({
    resize: () => ({
      webp: () => ({
        toFile: (_thumbPath: string) =>
          new Promise<void>((resolve, reject) => {
            h.toFileStarted.push(imagePath);
            h.toFileControls.set(imagePath, { resolve, reject });
          }),
      }),
    }),
  }),
}));

vi.mock('fs/promises', () => ({
  default: {
    // 源文件（M:/src/ 前缀）存在；缩略图文件不存在（触发生成）
    access: vi.fn(async (p: string) => {
      if (p.startsWith('M:/src/')) return undefined;
      const err: NodeJS.ErrnoException = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    }),
    mkdir: vi.fn(async () => undefined),
    unlink: vi.fn(async (p: string) => {
      h.unlinked.push(p);
    }),
  },
}));

vi.mock('../../../src/main/services/config.js', () => ({
  getConfig: vi.fn(() => ({
    thumbnails: {
      maxWidth: 800, maxHeight: 800, quality: 92, format: 'webp', effort: 3,
      preview: { cachePath: 'previews', maxWidth: 1600, maxHeight: 1600, quality: 88, format: 'webp', effort: 3 },
    },
  })),
  getThumbnailsPath: vi.fn(() => 'M:/thumbs'),
  getPreviewsPath: vi.fn(() => 'M:/previews'),
}));

const emitBuiltRendererAppEvent = vi.fn();
vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent: (...args: unknown[]) => emitBuiltRendererAppEvent(...args),
}));

import {
  generateThumbnail,
  enqueueThumbnailGeneration,
  cancelThumbnailGeneration,
  generatePreview,
} from '../../../src/main/services/thumbnailService';
import path from 'path';

const flush = async (times = 5) => {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

function expectedThumbPath(imagePath: string): string {
  const hash = crypto.createHash('md5').update(imagePath).digest('hex');
  return path.join('M:/thumbs', `${hash}.webp`);
}

function expectedPreviewPath(imagePath: string): string {
  const hash = crypto.createHash('md5').update(imagePath).digest('hex');
  return path.join('M:/previews', `${hash}.webp`);
}

beforeEach(() => {
  h.toFileControls.clear();
  h.toFileStarted.length = 0;
  h.unlinked.length = 0;
  emitBuiltRendererAppEvent.mockClear();
});

describe('cancelThumbnailGeneration', () => {
  it('等待队列中的任务被取消：sharp 不为其启动，promise 以 cancelled 结果 resolve', async () => {
    // 并发上限 3：前 3 个开跑并挂起，第 4/5 个排队
    enqueueThumbnailGeneration('M:/src/1.jpg');
    enqueueThumbnailGeneration('M:/src/2.jpg');
    enqueueThumbnailGeneration('M:/src/3.jpg');
    enqueueThumbnailGeneration('M:/src/4.jpg');
    const queuedPromise = generateThumbnail('M:/src/5.jpg');
    await flush();
    expect(h.toFileStarted).toEqual(['M:/src/1.jpg', 'M:/src/2.jpg', 'M:/src/3.jpg']);

    // 取消还在排队的两个
    cancelThumbnailGeneration(['M:/src/4.jpg', 'M:/src/5.jpg']);
    const cancelled = await queuedPromise;
    expect(cancelled.success).toBe(false);
    expect((cancelled as { cancelled?: boolean }).cancelled).toBe(true);

    // 放行运行中的 3 个，队列继续消化——被取消的两个永远不会启动 sharp
    for (const p of ['M:/src/1.jpg', 'M:/src/2.jpg', 'M:/src/3.jpg']) {
      h.toFileControls.get(p)!.resolve();
    }
    await flush();
    expect(h.toFileStarted).toHaveLength(3);
    expect(h.toFileStarted).not.toContain('M:/src/4.jpg');
    expect(h.toFileStarted).not.toContain('M:/src/5.jpg');
  });

  it('运行中的任务被取消（墓碑）：完成后删除刚生成的缩略图文件、不发 thumbnail:generated', async () => {
    const resultPromise = generateThumbnail('M:/src/running.jpg');
    await flush();
    expect(h.toFileStarted).toContain('M:/src/running.jpg');

    // 生成中途取消（图片被删除）
    cancelThumbnailGeneration(['M:/src/running.jpg']);
    h.toFileControls.get('M:/src/running.jpg')!.resolve();

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect((result as { cancelled?: boolean }).cancelled).toBe(true);
    await flush();

    // 产物被立即删除（不留孤儿），且不向渲染层通知
    expect(h.unlinked).toContain(expectedThumbPath('M:/src/running.jpg'));
    const notified = emitBuiltRendererAppEvent.mock.calls
      .map(([event]) => (event as { payload?: { imagePath?: string } })?.payload?.imagePath)
      .filter(Boolean);
    expect(notified).not.toContain('M:/src/running.jpg');
  });

  it('取消未入队路径为 no-op；取消不影响其它任务正常完成并通知', async () => {
    cancelThumbnailGeneration(['M:/src/never-enqueued.jpg']);

    const okPromise = generateThumbnail('M:/src/ok.jpg');
    await flush();
    cancelThumbnailGeneration(['M:/src/unrelated.jpg']);
    h.toFileControls.get('M:/src/ok.jpg')!.resolve();

    const result = await okPromise;
    expect(result.success).toBe(true);
    expect(result.data).toBe(expectedThumbPath('M:/src/ok.jpg'));
    await flush();
    const notified = emitBuiltRendererAppEvent.mock.calls
      .map(([event]) => (event as { payload?: { imagePath?: string } })?.payload?.imagePath)
      .filter(Boolean);
    expect(notified).toContain('M:/src/ok.jpg');
    expect(h.unlinked).not.toContain(expectedThumbPath('M:/src/ok.jpg'));
  });

  it('cancelThumbnailGeneration 传裸路径时同时投毒 thumbnail:/preview: 两档：排队中的预览档任务也被取消', async () => {
    // 占满 3 个运行槽位（缩略图档，background 优先级）。
    // 注意：ThumbnailQueue 是模块级单例、beforeEach 不重置——占位路径必须与其它
    // 用例不同名（t4- 前缀），否则前序用例未排干的同名 key 会把这里的入队去重吞掉。
    enqueueThumbnailGeneration('M:/src/t4-1.jpg');
    enqueueThumbnailGeneration('M:/src/t4-2.jpg');
    enqueueThumbnailGeneration('M:/src/t4-3.jpg');
    await flush();
    expect(h.toFileStarted).toEqual(['M:/src/t4-1.jpg', 'M:/src/t4-2.jpg', 'M:/src/t4-3.jpg']);

    // 预览档任务（generatePreview 走 preview:${path} key）——运行槽位已满，排队等待
    const previewPromise = generatePreview('M:/src/t4-deleted.jpg');
    await flush();
    expect(h.toFileStarted).not.toContain('M:/src/t4-deleted.jpg');

    // 只传裸路径（不带 tier 前缀）：cancelPending 需自行扇出 thumbnail:/preview: 两个 key，
    // 否则排队中的预览档任务（key 为 preview:t4-deleted.jpg）不会被命中而永远挂起。
    cancelThumbnailGeneration(['M:/src/t4-deleted.jpg']);
    const result = await previewPromise;
    expect(result.success).toBe(false);
    expect((result as { cancelled?: boolean }).cancelled).toBe(true);

    // 放行三个运行中的缩略图任务，队列继续消化——被取消的预览档任务永远不会启动 sharp
    for (const p of ['M:/src/t4-1.jpg', 'M:/src/t4-2.jpg', 'M:/src/t4-3.jpg']) {
      h.toFileControls.get(p)!.resolve();
    }
    await flush();
    expect(h.toFileStarted).not.toContain('M:/src/t4-deleted.jpg');
    expect(h.unlinked).not.toContain(expectedPreviewPath('M:/src/t4-deleted.jpg'));
  });
});
