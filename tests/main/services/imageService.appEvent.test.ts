import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';

const getDatabase = vi.fn();
const all = vi.fn();
const run = vi.fn();
const get = vi.fn();
const runInTransaction = vi.fn();
const readdir = vi.fn();
const stat = vi.fn();
const generateThumbnail = vi.fn();
const deleteThumbnail = vi.fn();
const getConfig = vi.fn();
const emitBuiltRendererAppEvent = vi.fn();

vi.mock('fs/promises', () => ({
  default: {
    readdir,
    stat,
  },
  readdir,
  stat,
}));

vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase,
  all,
  run,
  get,
  runInTransaction,
}));

vi.mock('../../../src/main/services/thumbnailService.js', () => ({
  generateThumbnail,
  deleteThumbnail,
}));

vi.mock('../../../src/main/services/config.js', () => ({
  getConfig,
}));

vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent,
}));

describe('imageService.scanAndImportFolder app event', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getDatabase.mockResolvedValue({});
    all.mockResolvedValue([]);
    run.mockResolvedValue(undefined);
    get.mockResolvedValue({ id: 101 });
    runInTransaction.mockImplementation(async (_db, callback) => callback());
    getConfig.mockReturnValue({ app: { autoScan: false } });
    generateThumbnail.mockResolvedValue(undefined);
    deleteThumbnail.mockResolvedValue(undefined);
  });

  it('导入新图片后应广播 gallery:images-imported', async () => {
    const folderPath = 'D:\\gallery';
    const filePath = path.join(folderPath, 'new.jpg');
    readdir.mockResolvedValueOnce([
      {
        name: 'new.jpg',
        isDirectory: () => false,
        isFile: () => true,
      },
    ]);
    stat.mockResolvedValueOnce({
      size: 1234,
      birthtime: new Date('2026-04-24T01:00:00.000Z'),
      mtime: new Date('2026-04-24T02:00:00.000Z'),
    });

    const { scanAndImportFolder } = await import('../../../src/main/services/imageService.js');
    const result = await scanAndImportFolder(folderPath, ['.jpg'], false);

    expect(result).toEqual({ success: true, data: { imported: 1, skipped: 0 } });
    expect(all).toHaveBeenCalledWith(
      {},
      expect.stringContaining('SELECT filepath FROM images WHERE filepath IN'),
      [filePath],
    );
    expect(run).toHaveBeenCalledWith(
      {},
      expect.stringContaining('INSERT INTO images'),
      expect.arrayContaining(['new.jpg', filePath, 1234, 1920, 1080, 'jpg']),
    );
    expect(emitBuiltRendererAppEvent).toHaveBeenCalledWith({
      type: 'gallery:images-imported',
      source: 'imageService',
      payload: {
        folderPath,
        imported: 1,
        skipped: 0,
        recursive: false,
        reason: 'scanAndImportFolder',
      },
    });
  });

  it('没有导入新图片时不应广播 gallery:images-imported', async () => {
    const folderPath = 'D:\\gallery';
    const filePath = path.join(folderPath, 'old.jpg');
    readdir.mockResolvedValueOnce([
      {
        name: 'old.jpg',
        isDirectory: () => false,
        isFile: () => true,
      },
    ]);
    all.mockResolvedValueOnce([{ filepath: filePath }]);

    const { scanAndImportFolder } = await import('../../../src/main/services/imageService.js');
    const result = await scanAndImportFolder(folderPath, ['.jpg'], false);

    expect(result).toEqual({ success: true, data: { imported: 0, skipped: 1 } });
    expect(stat).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(emitBuiltRendererAppEvent).not.toHaveBeenCalled();
  });
});
