import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 1600px 预览档生成管线（真实模块）：
 * - generatePreview：1600 边界 + q88 webp 到 previews 目录，命名 md5(源绝对路径).webp；
 * - 缓存命中短路、force 重生成、源缺失 → missing:true（供路由映射 404）；
 * - GIF 不转码直接回源文件路径；
 * - 预览档不发 thumbnail:generated（避免污染渲染层缩略图缓存）。
 *
 * mock 边界：sharp（链式 mock）、fs/promises（按路径选择性放行 access）、config、rendererEventBus。
 */

const mocks = vi.hoisted(() => {
  const toFile = vi.fn(async () => undefined);
  const webp = vi.fn(() => ({ toFile }));
  const jpeg = vi.fn(() => ({ toFile }));
  const png = vi.fn(() => ({ toFile }));
  const gif = vi.fn(() => ({ toFile }));
  const resize = vi.fn(() => ({
    webp,
    jpeg,
    png,
    gif,
  }));
  const sharpFactory = vi.fn(() => ({ resize }));

  return {
    fs: {
      access: vi.fn(),
      // 缓存命中判定现走 fs.stat（要求 size>0，剔除 0 字节残骸），非 fs.access——
      // 各用例按需设 stat：命中给非空 stat，未命中让其抛（ENOENT）走生成。
      stat: vi.fn(),
      mkdir: vi.fn(async () => undefined),
      unlink: vi.fn(async () => undefined),
    },
    config: {
      getConfig: vi.fn(() => ({
        thumbnails: {
          cachePath: 'thumbnails', maxWidth: 800, maxHeight: 800, quality: 92, format: 'webp', effort: 3,
          preview: { cachePath: 'previews', maxWidth: 1600, maxHeight: 1600, quality: 88, format: 'webp', effort: 3 },
        },
      })),
      getThumbnailsPath: vi.fn(() => 'D:/thumbs'),
      getPreviewsPath: vi.fn(() => 'D:/previews'),
    },
    emitBuiltRendererAppEvent: vi.fn(),
    toFile,
    resize,
    webp,
    sharpFactory,
  };
});

vi.mock('fs/promises', () => ({
  default: mocks.fs,
}));

vi.mock('../../../src/main/services/config.js', () => ({
  getConfig: mocks.config.getConfig,
  getThumbnailsPath: mocks.config.getThumbnailsPath,
  getPreviewsPath: mocks.config.getPreviewsPath,
}));

vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent: mocks.emitBuiltRendererAppEvent,
}));

vi.mock('sharp', () => ({
  default: mocks.sharpFactory,
}));

const SOURCE = 'D:/lib/a.jpg';
const sourceExistsCacheMissing = async (p: string) => {
  if (p === SOURCE || p === 'D:/lib/a.gif') return undefined;
  throw new Error('ENOENT');
};

describe('generatePreview 1600px 预览档生成', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // 默认缓存未命中（stat 抛 ENOENT）：clearAllMocks 不重置实现，会跨用例串味——
    // 命中用例设的 stat=resolve 若残留，会让「源缺失」等用例误判命中而短路。命中用例单独覆盖。
    mocks.fs.stat.mockRejectedValue(new Error('ENOENT'));
  });

  it('generatePreview 以 1600 边界与 q88 生成 webp 到 previews 目录', async () => {
    mocks.fs.access.mockImplementation(sourceExistsCacheMissing);
    const { generatePreview } = await import('../../../src/main/services/thumbnailService.js');
    const result = await generatePreview(SOURCE);
    expect(result.success).toBe(true);
    expect(result.data).toMatch(/^D:[\\/]previews[\\/][0-9a-f]{32}\.webp$/);
    expect(mocks.sharpFactory).toHaveBeenCalledWith(SOURCE);
    expect(mocks.resize).toHaveBeenCalledWith(1600, 1600, { fit: 'inside', withoutEnlargement: true });
    expect(mocks.webp).toHaveBeenCalledWith(expect.objectContaining({ quality: 88, effort: 3 }));
  });

  it('缓存命中：不调 sharp 直接返回缓存路径（spec §10 缓存复用）', async () => {
    mocks.fs.access.mockResolvedValue(undefined); // 源存在
    mocks.fs.stat.mockResolvedValue({ isFile: () => true, size: 100 }); // 缓存存在且非空 → 命中
    const { generatePreview } = await import('../../../src/main/services/thumbnailService.js');
    const result = await generatePreview(SOURCE);
    expect(result.success).toBe(true);
    expect(result.data).toMatch(/previews/);
    expect(mocks.sharpFactory).not.toHaveBeenCalled();
  });

  it('force=true 时无视缓存重新生成', async () => {
    mocks.fs.access.mockResolvedValue(undefined);
    const { generatePreview } = await import('../../../src/main/services/thumbnailService.js');
    await generatePreview(SOURCE, true);
    expect(mocks.sharpFactory).toHaveBeenCalledWith(SOURCE);
  });

  it('源文件缺失 → missing:true（供路由映射 404，spec §6.3 对账契约）', async () => {
    mocks.fs.access.mockRejectedValue(new Error('ENOENT'));
    const { generatePreview } = await import('../../../src/main/services/thumbnailService.js');
    const result = await generatePreview(SOURCE);
    expect(result.success).toBe(false);
    expect(result.missing).toBe(true);
  });

  it('GIF 直接回源文件路径且不调 sharp', async () => {
    const { generatePreview } = await import('../../../src/main/services/thumbnailService.js');
    const result = await generatePreview('D:/lib/a.gif');
    expect(result).toEqual({ success: true, data: 'D:/lib/a.gif' });
    expect(mocks.sharpFactory).not.toHaveBeenCalled();
  });

  it('preview 生成不发 thumbnail:generated 事件', async () => {
    mocks.fs.access.mockImplementation(sourceExistsCacheMissing);
    const { generatePreview } = await import('../../../src/main/services/thumbnailService.js');
    await generatePreview(SOURCE);
    expect(mocks.emitBuiltRendererAppEvent).not.toHaveBeenCalled();
  });
});
