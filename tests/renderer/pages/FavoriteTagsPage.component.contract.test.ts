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

  it('应在真实页面中暴露配置下载、历史查看、解除绑定和手动选路径操作', () => {
    expect(source).toContain("t('favoriteTags.configureDownload')");
    expect(source).toContain("t('favoriteTags.viewDownloadHistory')");
    expect(source).toContain("t('favoriteTags.clearDownloadBinding')");
    expect(source).toContain('handleSelectFavoriteTagDownloadPath');
    expect(source).toContain('window.electronAPI.system.selectFolder()');
    expect(source).toContain("t('favoriteTags.selectFolder')");
    expect(source).toContain("downloadForm.setFieldsValue({ downloadPath: result.data })");
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
    expect(source).toContain('window.electronAPI?.system?.onAppEvent');
    expect(source).toContain("event.type === 'favorite-tag-download:created'");
    expect(source).toContain("event.type === 'favorite-tags:changed'");
  });

  it('应在真实页面中支持图集绑定不一致提示', () => {
    expect(source).toContain('galleryBindingConsistent === false');
    expect(source).toContain("t('favoriteTags.galleryBindingMismatchAlert')");
  });

  it('图集绑定选择器应支持搜索，避免大图集列表无法检索', () => {
    expect(source).toContain('showSearch');
    expect(source).toContain('optionFilterProp="children"');
  });

  it('收藏标签页不再暴露自定义排序和拖拽手柄，分页位于底部居中', () => {
    expect(source).not.toContain('@dnd-kit');
    expect(source).not.toContain('DragHandle');
    expect(source).not.toContain('SortAscendingOutlined');
    expect(source).not.toContain('setSortKey');
    expect(source).toContain("position: ['bottomCenter']");
  });
});
