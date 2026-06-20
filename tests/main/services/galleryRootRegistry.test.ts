import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadGalleryRoots,
  addGalleryRoot,
  removeGalleryRoot,
  getGalleryRootsSnapshot,
} from '../../../src/main/services/galleryRootRegistry.js';

describe('galleryRootRegistry', () => {
  beforeEach(() => {
    loadGalleryRoots([]);
  });

  it('loadGalleryRoots 用给定列表整体替换缓存', () => {
    loadGalleryRoots(['M:/a', 'M:/b']);
    expect(getGalleryRootsSnapshot().sort()).toEqual(['M:/a', 'M:/b']);
  });

  it('addGalleryRoot 增量加入且去重', () => {
    loadGalleryRoots(['M:/a']);
    addGalleryRoot('M:/b');
    addGalleryRoot('M:/b');
    expect(getGalleryRootsSnapshot().sort()).toEqual(['M:/a', 'M:/b']);
  });

  it('removeGalleryRoot 移除指定根，不存在时静默', () => {
    loadGalleryRoots(['M:/a', 'M:/b']);
    removeGalleryRoot('M:/a');
    removeGalleryRoot('M:/not-there');
    expect(getGalleryRootsSnapshot()).toEqual(['M:/b']);
  });

  it('getGalleryRootsSnapshot 返回副本，外部修改不影响内部', () => {
    loadGalleryRoots(['M:/a']);
    const snap = getGalleryRootsSnapshot();
    snap.push('M:/hacked');
    expect(getGalleryRootsSnapshot()).toEqual(['M:/a']);
  });

  it('忽略空字符串/undefined', () => {
    loadGalleryRoots(['M:/a', '', undefined as unknown as string]);
    addGalleryRoot('');
    expect(getGalleryRootsSnapshot()).toEqual(['M:/a']);
  });
});
