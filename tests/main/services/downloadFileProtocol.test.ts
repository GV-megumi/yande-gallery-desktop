import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildDownloadTempPath,
  getFinalPathFromTempPath,
  replaceFileWithTemp,
  shouldDeleteTargetOnFailure,
  shouldDeleteTempFileOnFailure,
  validateDownloadedFileMd5,
  validateDownloadedFileSize,
} from '../../../src/main/services/downloadFileProtocol.js';

describe('downloadFileProtocol', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'download-file-protocol-'));
    tempDirs.push(dir);
    return dir;
  }

  it('应为最终路径生成 .part 临时文件路径', () => {
    expect(buildDownloadTempPath('/downloads/image.jpg')).toBe('/downloads/image.jpg.part');
  });

  it('应能从 .part 路径还原最终路径', () => {
    expect(getFinalPathFromTempPath('/downloads/image.jpg.part')).toBe('/downloads/image.jpg');
  });

  it('失败清理时只应删除临时文件，不应删除最终目标文件', () => {
    expect(shouldDeleteTempFileOnFailure('/downloads/image.jpg.part')).toBe(true);
    expect(shouldDeleteTargetOnFailure('/downloads/image.jpg')).toBe(false);
  });

  it('应拒绝空文件', () => {
    expect(() => validateDownloadedFileSize(0, null)).toThrow('Downloaded file is empty');
  });

  it('应拒绝与 Content-Length 不一致的文件大小', () => {
    expect(() => validateDownloadedFileSize(3, 4)).toThrow('File size mismatch: expected 4 bytes, got 3 bytes');
  });

  it('当文件非空且大小匹配时应通过校验', () => {
    expect(() => validateDownloadedFileSize(4, 4)).not.toThrow();
    expect(() => validateDownloadedFileSize(4, null)).not.toThrow();
  });

  it('final 不存在时应将 temp 原子替换为 final', () => {
    const dir = createTempDir();
    const finalPath = path.join(dir, 'image.jpg');
    const tempPath = buildDownloadTempPath(finalPath);
    fs.writeFileSync(tempPath, 'new-content');

    replaceFileWithTemp(tempPath, finalPath);

    expect(fs.existsSync(finalPath)).toBe(true);
    expect(fs.readFileSync(finalPath, 'utf8')).toBe('new-content');
    expect(fs.existsSync(tempPath)).toBe(false);
  });

  it('final 已存在时应安全替换为 temp 内容', () => {
    const dir = createTempDir();
    const finalPath = path.join(dir, 'image.jpg');
    const tempPath = buildDownloadTempPath(finalPath);
    fs.writeFileSync(finalPath, 'old-content');
    fs.writeFileSync(tempPath, 'new-content');

    replaceFileWithTemp(tempPath, finalPath);

    expect(fs.readFileSync(finalPath, 'utf8')).toBe('new-content');
    expect(fs.existsSync(tempPath)).toBe(false);
  });

  it('当未传入 expectedMd5 时应跳过 md5 校验', () => {
    const dir = createTempDir();
    const filePath = path.join(dir, 'image.jpg');
    fs.writeFileSync(filePath, 'hello world');

    expect(() => validateDownloadedFileMd5(filePath, null)).not.toThrow();
    expect(() => validateDownloadedFileMd5(filePath, undefined)).not.toThrow();
    expect(() => validateDownloadedFileMd5(filePath, '')).not.toThrow();
    expect(() => validateDownloadedFileMd5(filePath, '   ')).not.toThrow();
  });

  it('当 expectedMd5 与文件实际 md5 一致时不应抛错', () => {
    const dir = createTempDir();
    const filePath = path.join(dir, 'image.jpg');
    fs.writeFileSync(filePath, 'hello world');
    // md5("hello world") = 5eb63bbbe01eeed093cb22bb8f5acdc3
    expect(() =>
      validateDownloadedFileMd5(filePath, '5eb63bbbe01eeed093cb22bb8f5acdc3'),
    ).not.toThrow();
    // 大小写不敏感
    expect(() =>
      validateDownloadedFileMd5(filePath, '5EB63BBBE01EEED093CB22BB8F5ACDC3'),
    ).not.toThrow();
  });

  it('当 expectedMd5 与文件实际 md5 不一致时应抛出 md5 mismatch 错误', () => {
    const dir = createTempDir();
    const filePath = path.join(dir, 'image.jpg');
    fs.writeFileSync(filePath, 'hello world');
    expect(() =>
      validateDownloadedFileMd5(filePath, '00000000000000000000000000000000'),
    ).toThrow(/File md5 mismatch/);
  });

  it('final 已存在且替换失败时应保住原 final', () => {
    const dir = createTempDir();
    const finalPath = path.join(dir, 'image.jpg');
    const tempPath = buildDownloadTempPath(finalPath);
    fs.writeFileSync(finalPath, 'old-content');
    fs.writeFileSync(tempPath, 'new-content');

    const originalRenameSync = fs.renameSync;
    fs.renameSync = ((oldPath: fs.PathLike, newPath: fs.PathLike) => {
      if (String(oldPath) === tempPath && String(newPath) === finalPath) {
        throw new Error('replace failed');
      }
      return originalRenameSync(oldPath, newPath);
    }) as typeof fs.renameSync;

    try {
      expect(() => replaceFileWithTemp(tempPath, finalPath)).toThrow('replace failed');
      expect(fs.readFileSync(finalPath, 'utf8')).toBe('old-content');
      expect(fs.existsSync(tempPath)).toBe(true);
      expect(fs.readFileSync(tempPath, 'utf8')).toBe('new-content');
    } finally {
      fs.renameSync = originalRenameSync;
    }
  });
});
