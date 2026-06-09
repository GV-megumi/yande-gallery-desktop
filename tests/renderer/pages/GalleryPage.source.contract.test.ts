import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('GalleryPage recent images contract', () => {
  const source = readFileSync(
    path.resolve(process.cwd(), 'src/renderer/pages/GalleryPage.tsx'),
    'utf-8',
  );

  it('uses gallery domain events for recent incremental refresh', () => {
    expect(source).toContain('useGalleryDomainEvents({');
    expect(source).toContain('onImagesImported: () => {');
    expect(source).toContain('checkRecentImagesAfterCacheResume()');
  });

  it('uses gallery domain events for galleries list invalidation', () => {
    expect(source).toContain('onGalleriesChanged: (payload) => {');
    expect(source).toContain("subTab === 'galleries'");
    expect(source).toContain('await loadGalleries()');
  });

  it('does not hand-roll system.onAppEvent subscriptions in the page', () => {
    expect(source).not.toContain('window.electronAPI?.system?.onAppEvent');
  });

  it('keeps day grouping for recent images without the old showTimeline prop', () => {
    expect(source.match(/groupBy="day"/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(source).not.toContain('showTimeline');
  });
});
