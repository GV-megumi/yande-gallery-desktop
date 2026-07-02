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

  // 修复轮 U11：重定位根目录后主进程广播 gallery:paths-relocated（不动 updatedAt，
  // 增量游标感知不到），页面必须常驻订阅（不随 suspended 挂起）并作废水合缓存整页重载
  it('subscribes gallery:paths-relocated for full invalidation after root relocate', () => {
    expect(source).toContain("useRendererAppEvent('gallery:paths-relocated'");
    expect(source).toContain('setRelocateRefreshToken((token) => token + 1)');
    // 失效令牌必须驱动水合 effect 重跑（deps 含 relocateRefreshToken）
    expect(source).toContain('[subTab, suspended, relocateRefreshToken]');
  });

  it('keeps day grouping for recent images without the old showTimeline prop', () => {
    expect(source.match(/groupBy="day"/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(source).not.toContain('showTimeline');
  });
});
