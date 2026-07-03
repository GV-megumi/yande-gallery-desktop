import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      mkdir: vi.fn(async () => undefined),
      unlink: vi.fn(async () => undefined),
    },
    config: {
      getConfig: vi.fn(),
      getThumbnailsPath: vi.fn(() => 'D:/thumbs'),
      getPreviewsPath: vi.fn(() => 'D:/previews'),
    },
    emitBuiltRendererAppEvent: vi.fn(),
    toFile,
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

describe('thumbnailService runtime behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mocks.config.getConfig.mockReturnValue({
      thumbnails: {
        maxWidth: 800,
        maxHeight: 800,
        quality: 92,
        format: 'webp',
        effort: 'invalid',
        preview: { cachePath: 'previews', maxWidth: 1600, maxHeight: 1600, quality: 88, format: 'webp', effort: 3 },
      },
    });
    mocks.config.getThumbnailsPath.mockReturnValue('D:/thumbs');
    mocks.config.getPreviewsPath.mockReturnValue('D:/previews');
    mocks.fs.access.mockImplementation(async (targetPath: string) => {
      if (targetPath === 'D:/images/cover.jpg') {
        return;
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
  });

  it('generateThumbnail 在非法 effort 配置下应回退到默认值 3', async () => {
    const { generateThumbnail } = await import('../../../src/main/services/thumbnailService.js');

    const result = await generateThumbnail('D:/images/cover.jpg', true);

    expect(result.success).toBe(true);
    expect(mocks.webp).toHaveBeenCalledWith(expect.objectContaining({
      quality: 92,
      effort: 3,
    }));
    expect(mocks.toFile).toHaveBeenCalledTimes(1);
  });
});
