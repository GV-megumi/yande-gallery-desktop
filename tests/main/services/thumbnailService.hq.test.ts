import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * HQ 高质量图档生成管线（spec §2.1）：
 * - jpg→mozjpeg q85 / webp→webp q85 同格式；png→jpeg q85 + flatten 白底（扩展名变 .jpg）；
 * - GIF 直通回源；体积保护：产物 ≥ 源文件 → 回源路径；
 * - 缓存命中短路；源缺失 missing:true；不发 thumbnail:generated。
 */

const mocks = vi.hoisted(() => {
  const toFile = vi.fn(async () => undefined);
  const webp = vi.fn(() => ({ toFile }));
  const jpeg = vi.fn(() => ({ toFile }));
  const flatten = vi.fn(() => ({ jpeg }));
  const resize = vi.fn(() => ({ webp, jpeg, flatten }));
  const sharpFactory = vi.fn(() => ({ resize }));
  return {
    fs: {
      access: vi.fn(),
      stat: vi.fn(),
      mkdir: vi.fn(async () => undefined),
      unlink: vi.fn(async () => undefined),
    },
    config: {
      getConfig: vi.fn(() => ({
        thumbnails: {
          cachePath: 'thumbnails', maxWidth: 800, maxHeight: 800, quality: 92, format: 'webp', effort: 3,
          preview: { cachePath: 'previews', maxWidth: 1600, maxHeight: 1600, quality: 88, format: 'webp', effort: 3 },
          hq: { cachePath: 'hq', maxWidth: 2560, maxHeight: 2560, quality: 85, effort: 3 },
        },
      })),
      getThumbnailsPath: vi.fn(() => 'D:/thumbs'),
      getPreviewsPath: vi.fn(() => 'D:/previews'),
      getHqPath: vi.fn(() => 'D:/hq'),
    },
    emitBuiltRendererAppEvent: vi.fn(),
    toFile, resize, webp, jpeg, flatten, sharpFactory,
  };
});

vi.mock('fs/promises', () => ({ default: mocks.fs }));
vi.mock('../../../src/main/services/config.js', () => ({
  getConfig: mocks.config.getConfig,
  getThumbnailsPath: mocks.config.getThumbnailsPath,
  getPreviewsPath: mocks.config.getPreviewsPath,
  getHqPath: mocks.config.getHqPath,
}));
vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent: mocks.emitBuiltRendererAppEvent,
}));
vi.mock('sharp', () => ({ default: mocks.sharpFactory }));

const JPG = 'D:/lib/a.jpg';
const PNG = 'D:/lib/b.png';
const WEBP = 'D:/lib/c.webp';

// path.join 在 Windows 下会把 'D:/hq' 规整成 'D:\hq'（反斜杠分隔符）；生产代码算出的 HQ 缓存路径
// 因此也是反斜杠。这里统一用 path.normalize 再比较前缀，否则裸字符串 startsWith('D:/hq') 在 Windows
// 上永远不命中，会把 HQ 产物路径误判成源文件路径，导致缓存命中/体积保护/源缺失等用例全部误判。
const HQ_DIR = path.normalize('D:/hq');

/** stat 分派：源文件给大尺寸、HQ 产物给小尺寸（体积保护默认通过）；缓存路径默认 ENOENT（未命中）。 */
function statSourceBigHqSmall(hqHit: boolean) {
  mocks.fs.stat.mockImplementation(async (p: string) => {
    if (path.normalize(p).startsWith(HQ_DIR)) {
      if (!hqHit) throw new Error('ENOENT');
      return { isFile: () => true, size: 100_000 };
    }
    return { isFile: () => true, size: 5_000_000 };   // 源文件
  });
}

describe('generateHq 高质量图档生成', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.fs.access.mockResolvedValue(undefined);
    statSourceBigHqSmall(false);
  });

  it('jpg 源：2560 边界 + mozjpeg q85 同格式生成 .jpg 到 hq 目录', async () => {
    // 生成完成后体积保护要 stat 产物：toFile 后产物存在
    mocks.toFile.mockImplementation(async () => { statSourceBigHqSmall(true); });
    const { generateHq } = await import('../../../src/main/services/thumbnailService.js');
    const result = await generateHq(JPG);
    expect(result.success).toBe(true);
    expect(result.data).toMatch(/^D:[\\/]hq[\\/][0-9a-f]{32}\.jpg$/);
    expect(mocks.resize).toHaveBeenCalledWith(2560, 2560, { fit: 'inside', withoutEnlargement: true });
    expect(mocks.jpeg).toHaveBeenCalledWith(expect.objectContaining({ quality: 85, mozjpeg: true }));
  });

  it('webp 源：同格式 .webp（webp q85）', async () => {
    mocks.toFile.mockImplementation(async () => { statSourceBigHqSmall(true); });
    const { generateHq } = await import('../../../src/main/services/thumbnailService.js');
    const result = await generateHq(WEBP);
    expect(result.success).toBe(true);
    expect(result.data).toMatch(/\.webp$/);
    expect(mocks.webp).toHaveBeenCalledWith(expect.objectContaining({ quality: 85, effort: 3 }));
  });

  it('png 源：flatten 白底转 .jpg（D2 透明铺白）', async () => {
    mocks.toFile.mockImplementation(async () => { statSourceBigHqSmall(true); });
    const { generateHq } = await import('../../../src/main/services/thumbnailService.js');
    const result = await generateHq(PNG);
    expect(result.success).toBe(true);
    expect(result.data).toMatch(/\.jpg$/);
    expect(mocks.flatten).toHaveBeenCalledWith({ background: '#ffffff' });
    expect(mocks.jpeg).toHaveBeenCalledWith(expect.objectContaining({ quality: 85, mozjpeg: true }));
  });

  it('GIF 直通回源且不调 sharp', async () => {
    const { generateHq } = await import('../../../src/main/services/thumbnailService.js');
    const result = await generateHq('D:/lib/d.gif');
    expect(result).toEqual({ success: true, data: 'D:/lib/d.gif' });
    expect(mocks.sharpFactory).not.toHaveBeenCalled();
  });

  it('体积保护：产物 ≥ 源文件 → 回源文件路径', async () => {
    mocks.toFile.mockImplementation(async () => {
      mocks.fs.stat.mockImplementation(async (p: string) => (
        path.normalize(p).startsWith(HQ_DIR)
          ? { isFile: () => true, size: 6_000_000 }   // 产物比源还大
          : { isFile: () => true, size: 5_000_000 }
      ));
    });
    const { generateHq } = await import('../../../src/main/services/thumbnailService.js');
    const result = await generateHq(JPG);
    expect(result).toEqual({ success: true, data: JPG });
  });

  it('缓存命中：不调 sharp，返回缓存路径（体积保护仍生效）', async () => {
    statSourceBigHqSmall(true);
    const { generateHq } = await import('../../../src/main/services/thumbnailService.js');
    const result = await generateHq(JPG);
    expect(result.success).toBe(true);
    expect(result.data).toMatch(/^D:[\\/]hq[\\/]/);
    expect(mocks.sharpFactory).not.toHaveBeenCalled();
  });

  it('源缺失 → missing:true（路由映射 404）', async () => {
    mocks.fs.access.mockRejectedValue(new Error('ENOENT'));
    const { generateHq } = await import('../../../src/main/services/thumbnailService.js');
    const result = await generateHq(JPG);
    expect(result.success).toBe(false);
    expect(result.missing).toBe(true);
  });

  it('HQ 生成不发 thumbnail:generated 事件', async () => {
    mocks.toFile.mockImplementation(async () => { statSourceBigHqSmall(true); });
    const { generateHq } = await import('../../../src/main/services/thumbnailService.js');
    await generateHq(JPG);
    expect(mocks.emitBuiltRendererAppEvent).not.toHaveBeenCalled();
  });
});
