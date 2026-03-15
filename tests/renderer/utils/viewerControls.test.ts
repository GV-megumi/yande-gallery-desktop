import { describe, expect, it } from 'vitest';
import { buildViewerTransform, getComparablePreviewUrl, normalizeRotation, rotateBy } from '../../../src/renderer/utils/viewerControls';

describe('viewerControls', () => {
  it('normalizes negative rotation values', () => {
    expect(normalizeRotation(-90)).toBe(270);
  });

  it('rotates in 90 degree steps', () => {
    expect(rotateBy(270, 90)).toBe(0);
    expect(rotateBy(0, -90)).toBe(270);
  });

  it('builds combined rotate, flip and translate transform string', () => {
    const transform = buildViewerTransform({
      rotation: 90,
      flipX: true,
      flipY: false,
      scale: 2,
      positionX: 40,
      positionY: -20,
    });

    expect(transform).toBe('rotate(90deg) scale(-2, 2) translate(20px, -10px)');
  });

  it('prefers sample url for compare view', () => {
    expect(getComparablePreviewUrl({ sampleUrl: 'sample', previewUrl: 'preview', fileUrl: 'file' })).toBe('sample');
    expect(getComparablePreviewUrl({ previewUrl: 'preview', fileUrl: 'file' })).toBe('preview');
    expect(getComparablePreviewUrl({ fileUrl: 'file' })).toBe('file');
  });
});
