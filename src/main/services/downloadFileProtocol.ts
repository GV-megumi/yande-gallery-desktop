export function buildDownloadTempPath(finalPath: string): string {
  return `${finalPath}.part`;
}

export function getFinalPathFromTempPath(tempPath: string): string {
  return tempPath.endsWith('.part') ? tempPath.slice(0, -5) : tempPath;
}

export function shouldDeleteTempFileOnFailure(filePath: string): boolean {
  return filePath.endsWith('.part');
}

import fs from 'fs';

export function shouldDeleteTargetOnFailure(_filePath: string): boolean {
  return false;
}

export function replaceFileWithTemp(tempPath: string, finalPath: string): void {
  if (!fs.existsSync(finalPath)) {
    fs.renameSync(tempPath, finalPath);
    return;
  }

  const backupPath = `${finalPath}.backup`;
  if (fs.existsSync(backupPath)) {
    fs.unlinkSync(backupPath);
  }

  fs.renameSync(finalPath, backupPath);

  try {
    fs.renameSync(tempPath, finalPath);
    fs.unlinkSync(backupPath);
  } catch (error) {
    if (!fs.existsSync(finalPath) && fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, finalPath);
    }
    throw error;
  }
}

export function validateDownloadedFileSize(actualSize: number, expectedSize: number | null): void {
  if (actualSize === 0) {
    throw new Error('Downloaded file is empty');
  }

  if (expectedSize !== null && actualSize !== expectedSize) {
    throw new Error(`File size mismatch: expected ${expectedSize} bytes, got ${actualSize} bytes`);
  }
}

import crypto from 'crypto';

/**
 * 校验已落盘文件的 MD5 指纹。
 * - 当 expectedMd5 为 null/undefined 时不做校验，保持与旧行为兼容
 * - 当实际指纹与 Booru 提供的 md5 不一致时抛出错误，由上层决定是删除 .part 还是重试
 *
 * 计算仅涉及一次顺序读取，典型图片 (<10MB) 的开销可忽略；对大文件可以后续
 * 替换为流式计算。
 */
export function validateDownloadedFileMd5(filePath: string, expectedMd5: string | null | undefined): void {
  if (!expectedMd5) {
    return;
  }

  const normalizedExpected = expectedMd5.trim().toLowerCase();
  if (normalizedExpected.length === 0) {
    return;
  }

  const content = fs.readFileSync(filePath);
  const actual = crypto.createHash('md5').update(content).digest('hex');
  if (actual !== normalizedExpected) {
    throw new Error(`File md5 mismatch: expected ${normalizedExpected}, got ${actual}`);
  }
}
