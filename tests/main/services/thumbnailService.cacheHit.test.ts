import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

/**
 * 缓存命中判断的 0 字节防线（真实临时目录）：
 * 生成中断/失败会在缓存路径留下 0 字节残骸。历史上 thumbnailExists 只做 fs.access（存在性），
 * 把残骸当有效命中——于是 serveBinaryFile 把它发成 Content-Length:0 的 200，客户端图片库
 * （Coil 等）缓存成「成功但空」条目并永久命中，重试重打同一 URL 仍命中空缓存、无法自愈
 * （真机联调实证的封面「加载失败」投毒）。命中判断必须要求 size>0，让残骸触发重新生成。
 */

const h = vi.hoisted(() => ({ tmpDir: '', previewsDir: '' }));

vi.mock('../../../src/main/services/config.js', () => ({
  getConfig: vi.fn(() => ({
    thumbnails: {
      maxWidth: 800, maxHeight: 800, quality: 92, format: 'webp', effort: 3,
      preview: { cachePath: 'previews', maxWidth: 1600, maxHeight: 1600, quality: 88, format: 'webp', effort: 3 },
    },
  })),
  getThumbnailsPath: vi.fn(() => h.tmpDir),
  getPreviewsPath: vi.fn(() => h.previewsDir),
}));

import { getThumbnailIfExists, getPreviewIfExists } from '../../../src/main/services/thumbnailService';

function md5(s: string): string {
  return crypto.createHash('md5').update(s).digest('hex');
}

beforeEach(async () => {
  h.tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'thumb-cachehit-'));
  h.previewsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-cachehit-'));
});

afterEach(async () => {
  await fs.rm(h.tmpDir, { recursive: true, force: true });
  await fs.rm(h.previewsDir, { recursive: true, force: true });
});

describe('缓存命中判断：0 字节残骸不算有效缓存', () => {
  it('getThumbnailIfExists：0 字节缓存返回 null（触发重生成），非空返回路径', async () => {
    const imagePath = 'M:/lib/img.png';
    const cachePath = path.join(h.tmpDir, `${md5(imagePath)}.webp`);

    // 0 字节残骸：不算命中，返回 null（上层据此重新生成，而非把空文件服务出去）
    await fs.writeFile(cachePath, Buffer.alloc(0));
    expect(await getThumbnailIfExists(imagePath)).toBeNull();

    // 正常非空缓存：命中，返回路径
    await fs.writeFile(cachePath, Buffer.from('thumbnail-bytes'));
    expect(await getThumbnailIfExists(imagePath)).toBe(cachePath);
  });

  it('getPreviewIfExists：0 字节预览档返回 null，非空返回路径', async () => {
    const imagePath = 'M:/lib/photo.jpg';
    const cachePath = path.join(h.previewsDir, `${md5(imagePath)}.webp`);

    await fs.writeFile(cachePath, Buffer.alloc(0));
    expect(await getPreviewIfExists(imagePath)).toBeNull();

    await fs.writeFile(cachePath, Buffer.from('preview-bytes'));
    expect(await getPreviewIfExists(imagePath)).toBe(cachePath);
  });
});
