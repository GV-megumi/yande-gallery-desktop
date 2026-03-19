import { describe, it, expect } from 'vitest';

type FavoriteTagRow = {
  siteId: number | null;
  queryType: 'tag' | 'raw' | 'list';
  downloadBinding?: {
    enabled?: boolean;
    lastStatus?: string | null;
    lastSessionId?: string | null;
    galleryId?: number | null;
    downloadPath?: string;
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

function canTriggerOneClickDownload(record: FavoriteTagRow) {
  if (record.queryType !== 'tag') {
    return { ok: false, reason: 'queryType' };
  }
  if (record.siteId == null) {
    return { ok: false, reason: 'siteId' };
  }
  return { ok: true };
}

function resolvePathFromGallerySelection(
  galleries: Array<{ id: number; folderPath: string }>,
  galleryId?: number
) {
  if (!galleryId) {
    return undefined;
  }

  return galleries.find(gallery => gallery.id === galleryId)?.folderPath;
}

describe('FavoriteTagsPage logic - status derivation', () => {
  it('未配置绑定时应返回 notConfigured', () => {
    expect(getStatusKey({ siteId: 1, queryType: 'tag' })).toBe('notConfigured');
  });

  it('有 enabled 绑定但无运行态时应返回 ready', () => {
    expect(getStatusKey({
      siteId: 1,
      queryType: 'tag',
      downloadBinding: { enabled: true },
    })).toBe('ready');
  });

  it('有 lastStatus 时应优先返回 lastStatus', () => {
    expect(getStatusKey({
      siteId: 1,
      queryType: 'tag',
      downloadBinding: { enabled: true, lastStatus: 'completed' },
    })).toBe('completed');
  });

  it('有 runtimeProgress 时应优先返回运行态状态', () => {
    expect(getStatusKey({
      siteId: 1,
      queryType: 'tag',
      downloadBinding: { enabled: true, lastStatus: 'completed' },
      runtimeProgress: { status: 'running', percent: 50, completed: 10, total: 20 },
    })).toBe('running');
  });
});

describe('FavoriteTagsPage logic - download availability', () => {
  it('queryType=tag 且 siteId 有值时允许一键下载', () => {
    expect(canTriggerOneClickDownload({ siteId: 1, queryType: 'tag' })).toEqual({ ok: true });
  });

  it('queryType=raw 时应禁用一键下载', () => {
    expect(canTriggerOneClickDownload({ siteId: 1, queryType: 'raw' })).toEqual({ ok: false, reason: 'queryType' });
  });

  it('queryType=list 时应禁用一键下载', () => {
    expect(canTriggerOneClickDownload({ siteId: 1, queryType: 'list' })).toEqual({ ok: false, reason: 'queryType' });
  });

  it('siteId 为 null 时应禁用一键下载', () => {
    expect(canTriggerOneClickDownload({ siteId: null, queryType: 'tag' })).toEqual({ ok: false, reason: 'siteId' });
  });
});

describe('FavoriteTagsPage logic - gallery selection', () => {
  const galleries = [
    { id: 1, folderPath: 'D:/gallery/a' },
    { id: 2, folderPath: 'D:/gallery/b' },
  ];

  it('选择图集后应回填对应 folderPath', () => {
    expect(resolvePathFromGallerySelection(galleries, 2)).toBe('D:/gallery/b');
  });

  it('未选择图集时不应返回路径', () => {
    expect(resolvePathFromGallerySelection(galleries, undefined)).toBeUndefined();
  });

  it('图集不存在时不应返回路径', () => {
    expect(resolvePathFromGallerySelection(galleries, 999)).toBeUndefined();
  });
});
