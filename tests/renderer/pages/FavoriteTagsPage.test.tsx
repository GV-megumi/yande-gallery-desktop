import { describe, it, expect } from 'vitest';

type FavoriteTagRow = {
  siteId: number | null;
  queryType: 'tag' | 'raw' | 'list';
  downloadBinding?: {
    enabled?: boolean;
    lastStatus?: string | null;
    autoCreateGallery?: boolean | null;
    autoSyncGalleryAfterDownload?: boolean | null;
  };
  runtimeProgress?: {
    status: string;
    percent: number;
    completed: number;
    total: number;
  } | null;
};

function getStatusKey(record: FavoriteTagRow) {
  if (record.runtimeProgress?.status) {
    return record.runtimeProgress.status;
  }
  if (record.downloadBinding?.lastStatus) {
    return record.downloadBinding.lastStatus;
  }
  if (record.downloadBinding?.enabled) {
    return 'ready';
  }
  return 'notConfigured';
}

function isDownloadDisabled(record: FavoriteTagRow) {
  return record.queryType !== 'tag' || record.siteId == null;
}

function resolveProgressText(record: FavoriteTagRow) {
  if (!record.runtimeProgress) {
    return '-';
  }
  return `${record.runtimeProgress.completed}/${record.runtimeProgress.total} (${record.runtimeProgress.percent}%)`;
}

function syncPathFromGallery(
  galleries: Array<{ id: number; folderPath: string }>,
  galleryId?: number
) {
  if (!galleryId) {
    return undefined;
  }
  return galleries.find(gallery => gallery.id === galleryId)?.folderPath;
}

function describeAutomation(record: FavoriteTagRow) {
  return {
    autoCreateGallery: Boolean(record.downloadBinding?.autoCreateGallery),
    autoSyncGalleryAfterDownload: Boolean(record.downloadBinding?.autoSyncGalleryAfterDownload),
  };
}

describe('FavoriteTagsPage behavior rules', () => {
  it('未配置时应显示 notConfigured', () => {
    expect(getStatusKey({ siteId: 1, queryType: 'tag' })).toBe('notConfigured');
  });

  it('有启用绑定但无运行态时应显示 ready', () => {
    expect(getStatusKey({ siteId: 1, queryType: 'tag', downloadBinding: { enabled: true } })).toBe('ready');
  });

  it('运行态状态应覆盖 lastStatus', () => {
    expect(getStatusKey({
      siteId: 1,
      queryType: 'tag',
      downloadBinding: { enabled: true, lastStatus: 'completed' },
      runtimeProgress: { status: 'running', percent: 20, completed: 1, total: 5 },
    })).toBe('running');
  });

  it('queryType=raw 时下载按钮应禁用', () => {
    expect(isDownloadDisabled({ siteId: 1, queryType: 'raw' })).toBe(true);
  });

  it('queryType=list 时下载按钮应禁用', () => {
    expect(isDownloadDisabled({ siteId: 1, queryType: 'list' })).toBe(true);
  });

  it('siteId 为 null 时下载按钮应禁用', () => {
    expect(isDownloadDisabled({ siteId: null, queryType: 'tag' })).toBe(true);
  });

  it('queryType=tag 且有 siteId 时下载按钮可用', () => {
    expect(isDownloadDisabled({ siteId: 2, queryType: 'tag' })).toBe(false);
  });

  it('无运行态时进度文本应显示 -', () => {
    expect(resolveProgressText({ siteId: 1, queryType: 'tag' })).toBe('-');
  });

  it('有运行态时应显示 completed/total 和 percent', () => {
    expect(resolveProgressText({
      siteId: 1,
      queryType: 'tag',
      runtimeProgress: { status: 'running', percent: 75, completed: 15, total: 20 },
    })).toBe('15/20 (75%)');
  });

  it('选择图集时应同步其 folderPath', () => {
    expect(syncPathFromGallery([
      { id: 1, folderPath: 'D:/g1' },
      { id: 2, folderPath: 'D:/g2' },
    ], 2)).toBe('D:/g2');
  });

  it('未命中图集时不应同步路径', () => {
    expect(syncPathFromGallery([{ id: 1, folderPath: 'D:/g1' }], 99)).toBeUndefined();
  });

  it('应暴露 autoCreateGallery / autoSyncGalleryAfterDownload 开关状态', () => {
    expect(describeAutomation({
      siteId: 1,
      queryType: 'tag',
      downloadBinding: {
        enabled: true,
        autoCreateGallery: true,
        autoSyncGalleryAfterDownload: true,
      },
    })).toEqual({
      autoCreateGallery: true,
      autoSyncGalleryAfterDownload: true,
    });
  });
});
