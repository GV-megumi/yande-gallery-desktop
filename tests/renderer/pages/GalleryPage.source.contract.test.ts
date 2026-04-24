import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('GalleryPage recent images contract', () => {
  const source = readFileSync(
    path.resolve(process.cwd(), 'src/renderer/pages/GalleryPage.tsx'),
    'utf-8',
  );

  it('最近图片页消费 gallery:images-imported 事件并走增量刷新', () => {
    expect(source).toContain('window.electronAPI?.system?.onAppEvent');
    expect(source).toContain("event.type === 'gallery:images-imported'");
    expect(source).toContain('checkRecentImagesAfterCacheResume()');
  });

  it('图集页消费 gallery:galleries-changed 事件并刷新图集列表', () => {
    expect(source).toContain("event.type === 'gallery:galleries-changed'");
    expect(source).toContain("subTab === 'galleries'");
    expect(source).toContain('await loadGalleries()');
  });

  it('最近图片分支不再传 showTimeline，但保留 day 分组标题能力', () => {
    expect(source.match(/groupBy="day"/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(source).not.toContain('showTimeline');
  });
});
