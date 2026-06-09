import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough, Readable } from 'stream';

const TEST_URL = 'https://example.test/image.jpg';
const realCreateWriteStream = fsSync.createWriteStream.bind(fsSync);

function finalPath(cacheDir: string, md5: string, extension: string): string {
  return path.join(cacheDir, md5.substring(0, 2), `${md5}.${extension}`);
}

function partPath(cacheDir: string, md5: string, extension: string): string {
  return `${finalPath(cacheDir, md5, extension)}.part`;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function createFailingStream(message = 'download failed'): Readable {
  return new Readable({
    read() {
      this.destroy(new Error(message));
    },
  });
}

async function loadService(cacheDir: string, axiosMock = vi.fn()) {
  const networkScheduler = {
    incrementBrowsing: vi.fn(),
    decrementBrowsing: vi.fn(),
  };
  const emitBooruImageCacheCleared = vi.fn();

  vi.doMock('../../../src/main/services/config.js', () => ({
    getCachePath: () => cacheDir,
    getConfig: () => ({
      booru: {
        appearance: {
          maxCacheSizeMB: 1024,
        },
      },
    }),
    getProxyConfig: () => undefined,
  }));

  vi.doMock('../../../src/main/services/networkScheduler.js', () => ({
    networkScheduler,
  }));

  vi.doMock('../../../src/main/services/appEventPublisher.js', () => ({
    emitBooruImageCacheCleared,
  }));

  vi.doMock('axios', () => ({
    default: axiosMock,
  }));

  const service = await import('../../../src/main/services/imageCacheService.js');
  return { service, axiosMock, networkScheduler, emitBooruImageCacheCleared };
}

function createDeferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('imageCacheService atomic cache writes', () => {
  let cacheDir: string;
  let createWriteStreamSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'image-cache-atomic-'));
    createWriteStreamSpy = vi.spyOn(fsSync, 'createWriteStream');
  });

  afterEach(async () => {
    createWriteStreamSpy.mockRestore();
    vi.doUnmock('../../../src/main/services/config.js');
    vi.doUnmock('../../../src/main/services/networkScheduler.js');
    vi.doUnmock('../../../src/main/services/appEventPublisher.js');
    vi.doUnmock('axios');
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  it('does not expose a part file as a cached image', async () => {
    const md5 = 'abpartonly';
    const extension = 'jpg';
    const part = partPath(cacheDir, md5, extension);
    await fs.mkdir(path.dirname(part), { recursive: true });
    await fs.writeFile(part, 'partial bytes');

    const { service } = await loadService(cacheDir);

    await expect(service.getCachedImagePath(md5, extension)).resolves.toBeNull();
    await expect(service.getCachedImageUrl(md5, extension)).resolves.toBeNull();
  });

  it('returns the final file when final and stale part files both exist', async () => {
    const md5 = 'abfinalwins';
    const extension = 'jpg';
    const final = finalPath(cacheDir, md5, extension);
    const part = partPath(cacheDir, md5, extension);
    await fs.mkdir(path.dirname(final), { recursive: true });
    await fs.writeFile(final, 'complete bytes');
    await fs.writeFile(part, 'stale partial bytes');

    const { service } = await loadService(cacheDir);

    await expect(service.getCachedImagePath(md5, extension)).resolves.toBe(final);
  });

  it('writes downloads to a part file before atomically publishing final cache', async () => {
    const md5 = 'cdsuccess';
    const extension = 'jpg';
    const final = finalPath(cacheDir, md5, extension);
    const part = partPath(cacheDir, md5, extension);
    const axiosMock = vi.fn(async (options: { method: string }) => {
      if (options.method === 'HEAD') {
        return { headers: { 'content-length': '18' } };
      }
      return { data: Readable.from([Buffer.from('first '), Buffer.from('second')]) };
    });

    const { service, networkScheduler } = await loadService(cacheDir, axiosMock);

    await expect(service.cacheImage(TEST_URL, md5, extension)).resolves.toBe(final);

    expect(createWriteStreamSpy).toHaveBeenCalledWith(part);
    await expect(fs.readFile(final, 'utf8')).resolves.toBe('first second');
    await expect(exists(part)).resolves.toBe(false);
    expect(networkScheduler.incrementBrowsing).toHaveBeenCalledTimes(1);
    expect(networkScheduler.decrementBrowsing).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent cacheImage calls for the same cache key while waiting for a slot', async () => {
    const md5 = 'dedupekey';
    const extension = 'jpg';
    const final = finalPath(cacheDir, md5, extension);
    const part = partPath(cacheDir, md5, extension);
    const blockerStreams: PassThrough[] = [];
    const blockerStarted = createDeferred();
    let blockerGetCount = 0;
    let sameKeyGetCount = 0;

    const axiosMock = vi.fn(async (options: { method: string; url: string }) => {
      if (options.method === 'HEAD') {
        return { headers: { 'content-length': '18' } };
      }

      if (options.url.startsWith(`${TEST_URL}?blocker=`)) {
        blockerGetCount++;
        if (blockerGetCount === 8) {
          blockerStarted.resolve();
        }
        const stream = new PassThrough();
        blockerStreams.push(stream);
        return { data: stream };
      }

      sameKeyGetCount++;
      return { data: Readable.from([Buffer.from('deduplicated bytes')]) };
    });

    const { service } = await loadService(cacheDir, axiosMock);
    const blockerPromises = Array.from({ length: 8 }, (_, index) =>
      service.cacheImage(`${TEST_URL}?blocker=${index}`, `b${index}blocker`, extension)
    );

    try {
      await blockerStarted.promise;

      const first = service.cacheImage(TEST_URL, md5, extension);
      const second = service.cacheImage(TEST_URL, md5, extension);
      await new Promise(resolve => setTimeout(resolve, 20));

      blockerStreams[0].end(Buffer.from('blocker bytes'));

      await expect(Promise.all([first, second])).resolves.toEqual([final, final]);
      expect(sameKeyGetCount).toBe(1);
      await expect(fs.readFile(final, 'utf8')).resolves.toBe('deduplicated bytes');
      await expect(exists(part)).resolves.toBe(false);
    } finally {
      for (const stream of blockerStreams) {
        if (!stream.destroyed && !stream.writableEnded) {
          stream.end(Buffer.from('blocker bytes'));
        }
      }
      await Promise.allSettled(blockerPromises);
    }
  });

  it('keeps an existing final file that appears after temp download finishes', async () => {
    const md5 = 'efpublish';
    const extension = 'jpg';
    const final = finalPath(cacheDir, md5, extension);
    const part = partPath(cacheDir, md5, extension);
    const existingBytes = 'published by another request';
    const downloadedBytes = 'downloaded temp bytes';
    const axiosMock = vi.fn(async (options: { method: string }) => {
      if (options.method === 'HEAD') {
        return { headers: { 'content-length': '21' } };
      }
      return { data: Readable.from([Buffer.from(downloadedBytes)]) };
    });

    createWriteStreamSpy.mockImplementation(((filePath: fsSync.PathLike) => {
      const stream = realCreateWriteStream(filePath);
      if (String(filePath) === part) {
        stream.once('finish', () => {
          fsSync.writeFileSync(final, existingBytes);
        });
      }
      return stream;
    }) as typeof fsSync.createWriteStream);

    const { service } = await loadService(cacheDir, axiosMock);

    await expect(service.cacheImage(TEST_URL, md5, extension)).resolves.toBe(final);
    await expect(fs.readFile(final, 'utf8')).resolves.toBe(existingBytes);
    await expect(exists(part)).resolves.toBe(false);
  });

  it('emits a cache-cleared domain event after deleting cache files', async () => {
    const first = finalPath(cacheDir, 'aaclearone', 'jpg');
    const second = finalPath(cacheDir, 'bbcleartwo', 'png');
    await fs.mkdir(path.dirname(first), { recursive: true });
    await fs.mkdir(path.dirname(second), { recursive: true });
    await fs.writeFile(first, 'one');
    await fs.writeFile(second, 'two');

    const { service, emitBooruImageCacheCleared } = await loadService(cacheDir);

    await expect(service.clearAllCache()).resolves.toMatchObject({ deletedCount: 2 });
    expect(emitBooruImageCacheCleared).toHaveBeenCalledTimes(1);
    expect(emitBooruImageCacheCleared).toHaveBeenCalledWith({
      action: 'cleared',
      affectedCount: 2,
    });
  });

  it('cleans stale part files when a download fails without creating final cache', async () => {
    const md5 = 'effailure';
    const extension = 'jpg';
    const final = finalPath(cacheDir, md5, extension);
    const part = partPath(cacheDir, md5, extension);
    await fs.mkdir(path.dirname(part), { recursive: true });
    await fs.writeFile(part, 'old partial bytes');

    const axiosMock = vi.fn(async (options: { method: string }) => {
      if (options.method === 'HEAD') {
        return { headers: { 'content-length': '18' } };
      }
      return { data: createFailingStream() };
    });

    const { service, networkScheduler } = await loadService(cacheDir, axiosMock);

    await expect(service.cacheImage(TEST_URL, md5, extension)).rejects.toThrow('download failed');
    await expect(exists(part)).resolves.toBe(false);
    await expect(exists(final)).resolves.toBe(false);
    expect(networkScheduler.incrementBrowsing).toHaveBeenCalledTimes(1);
    expect(networkScheduler.decrementBrowsing).toHaveBeenCalledTimes(1);
  });

  it('does not delete a completed final file that appears while a failed download is in flight', async () => {
    const md5 = 'abpreserve';
    const extension = 'jpg';
    const final = finalPath(cacheDir, md5, extension);
    const part = partPath(cacheDir, md5, extension);
    const existingBytes = 'already complete';

    const axiosMock = vi.fn(async (options: { method: string }) => {
      if (options.method === 'HEAD') {
        return { headers: { 'content-length': '18' } };
      }
      await fs.mkdir(path.dirname(final), { recursive: true });
      await fs.writeFile(final, existingBytes);
      return { data: createFailingStream() };
    });

    const { service } = await loadService(cacheDir, axiosMock);

    await expect(service.cacheImage(TEST_URL, md5, extension)).rejects.toThrow('download failed');
    await expect(fs.readFile(final, 'utf8')).resolves.toBe(existingBytes);
    await expect(exists(part)).resolves.toBe(false);
  });

  it('ignores part files in cache stats', async () => {
    const md5 = 'abstats';
    const extension = 'jpg';
    const final = finalPath(cacheDir, md5, extension);
    const part = partPath(cacheDir, md5, extension);
    await fs.mkdir(path.dirname(final), { recursive: true });
    await fs.writeFile(final, Buffer.alloc(5));
    await fs.writeFile(part, Buffer.alloc(50));

    const { service } = await loadService(cacheDir);

    await expect(service.getCacheStats()).resolves.toEqual({
      sizeMB: 5 / (1024 * 1024),
      fileCount: 1,
    });
  });
});
