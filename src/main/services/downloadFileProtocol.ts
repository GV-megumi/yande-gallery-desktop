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
