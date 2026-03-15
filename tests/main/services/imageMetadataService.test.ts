import { describe, expect, it } from 'vitest';

describe('image metadata result shape', () => {
  it('keeps exif presence as boolean', () => {
    const result = {
      format: 'jpeg',
      width: 1920,
      height: 1080,
      space: 'srgb',
      density: 72,
      hasAlpha: false,
      orientation: 1,
      channels: 3,
      hasExif: true,
      pathSource: 'cache' as const,
    };

    expect(result.hasExif).toBe(true);
    expect(result.pathSource).toBe('cache');
    expect(result.width).toBeGreaterThan(0);
  });
});
