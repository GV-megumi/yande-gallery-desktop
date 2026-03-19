import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('FavoriteTagsPage component contract', () => {
  const pagePath = path.resolve(process.cwd(), 'src/renderer/pages/FavoriteTagsPage.tsx');
  const source = readFileSync(pagePath, 'utf-8');

  it('应在真实页面中展示下载状态/进度/上次下载时间/绑定图集列', () => {
    expect(source).toContain("title: t('favoriteTags.boundGallery')");
    expect(source).toContain("title: t('favoriteTags.downloadStatus')");
    expect(source).toContain("title: t('favoriteTags.downloadProgress')");
    expect(source).toContain("title: t('favoriteTags.lastDownloadTime')");
  });

  it('应在真实页面中暴露配置下载、历史查看和解除绑定操作', () => {
    expect(source).toContain("t('favoriteTags.configureDownload')");
    expect(source).toContain("t('favoriteTags.viewDownloadHistory')");
    expect(source).toContain("t('favoriteTags.clearDownloadBinding')");
  });

  it('应在真实页面中调用 favorite-tag 相关 booru APIs', () => {
    expect(source).toContain('window.electronAPI.booru.getFavoriteTagsWithDownloadState');
    expect(source).toContain('window.electronAPI.booru.upsertFavoriteTagDownloadBinding');
    expect(source).toContain('window.electronAPI.booru.removeFavoriteTagDownloadBinding');
    expect(source).toContain('window.electronAPI.booru.startFavoriteTagBulkDownload');
    expect(source).toContain('window.electronAPI.booru.getFavoriteTagDownloadHistory');
  });

  it('应在真实页面中监听 bulk download 进度与状态事件', () => {
    expect(source).toContain('window.electronAPI?.system?.onBulkDownloadRecordProgress');
    expect(source).toContain('window.electronAPI?.system?.onBulkDownloadRecordStatus');
  });

  it('应在真实页面中支持图集绑定不一致提示', () => {
    expect(source).toContain('galleryBindingConsistent === false');
    expect(source).toContain("t('favoriteTags.galleryBindingMismatchAlert')");
  });
});
