import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

/**
 * cleanupOrphanThumbnails（孤儿缩略图兜底清扫，真实临时目录）：
 * - 只处理形如 <32位hex>.<ext> 的文件；hash 段对账（不看扩展名，兼容历史格式切换）；
 * - 保护集 = images.filepath 的 md5 全集 ∪ invalid_images.thumbnailPath 的 hash 段
 *   （无效列表页仍展示这些缩略图，清掉会变破图）；
 * - 非缩略图命名的文件一概不动；目录不存在时安全返回零结果。
 */

const h = vi.hoisted(() => ({
  tmpDir: '',
  imageRows: [] as Array<{ filepath: string }>,
  invalidRows: [] as Array<{ thumbnailPath: string | null }>,
}));

vi.mock('../../../src/main/services/config.js', () => ({
  getConfig: vi.fn(() => ({
    thumbnails: { maxWidth: 800, maxHeight: 800, quality: 92, format: 'webp', effort: 3 },
  })),
  getThumbnailsPath: vi.fn(() => h.tmpDir),
}));

vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(async () => ({})),
  all: vi.fn(async (_db: unknown, sql: string) => {
    if (sql.includes('FROM images')) return h.imageRows;
    if (sql.includes('invalid_images')) return h.invalidRows;
    return [];
  }),
}));

import { cleanupOrphanThumbnails } from '../../../src/main/services/thumbnailService';

function md5(s: string): string {
  return crypto.createHash('md5').update(s).digest('hex');
}

beforeEach(async () => {
  h.tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'thumb-cleanup-'));
  h.imageRows = [];
  h.invalidRows = [];
});

afterEach(async () => {
  await fs.rm(h.tmpDir, { recursive: true, force: true });
});

describe('cleanupOrphanThumbnails', () => {
  it('删除库内无对应图片的孤儿缩略图；保护在库图片、无效项引用与非缩略图文件', async () => {
    const keepHash = md5('M:/lib/keep.jpg');
    const orphanHash = md5('M:/lib/gone.jpg');
    const orphanJpegHash = md5('M:/lib/gone2.jpg');
    const invalidHash = md5('M:/lib/invalid.jpg');

    await fs.writeFile(path.join(h.tmpDir, `${keepHash}.webp`), 'k');
    await fs.writeFile(path.join(h.tmpDir, `${orphanHash}.webp`), 'oooo');
    // 历史格式切换产物：hash 对账、扩展名不同也应识别为孤儿
    await fs.writeFile(path.join(h.tmpDir, `${orphanJpegHash}.jpeg`), 'oo');
    await fs.writeFile(path.join(h.tmpDir, `${invalidHash}.webp`), 'i');
    await fs.writeFile(path.join(h.tmpDir, 'notes.txt'), 'not a thumbnail');

    h.imageRows = [{ filepath: 'M:/lib/keep.jpg' }];
    h.invalidRows = [{ thumbnailPath: path.join(h.tmpDir, `${invalidHash}.webp`) }];

    const result = await cleanupOrphanThumbnails();

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ scanned: 4, deleted: 2, freedBytes: 6 });

    const remaining = (await fs.readdir(h.tmpDir)).sort();
    expect(remaining).toEqual([`${invalidHash}.webp`, `${keepHash}.webp`, 'notes.txt'].sort());
  });

  it('全部有主时零删除；缩略图目录不存在时安全返回零结果', async () => {
    const keepHash = md5('M:/lib/a.jpg');
    await fs.writeFile(path.join(h.tmpDir, `${keepHash}.webp`), 'k');
    h.imageRows = [{ filepath: 'M:/lib/a.jpg' }];

    const result = await cleanupOrphanThumbnails();
    expect(result.data).toEqual({ scanned: 1, deleted: 0, freedBytes: 0 });

    // 目录不存在
    h.tmpDir = path.join(h.tmpDir, 'not-exists');
    const missing = await cleanupOrphanThumbnails();
    expect(missing.success).toBe(true);
    expect(missing.data).toEqual({ scanned: 0, deleted: 0, freedBytes: 0 });
  });
});
