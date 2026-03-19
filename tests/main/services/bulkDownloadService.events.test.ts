import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('bulkDownloadService - event emission wiring', () => {
  const servicePath = path.resolve(process.cwd(), 'src/main/services/bulkDownloadService.ts');
  const source = readFileSync(servicePath, 'utf-8');

  it('应真实发射 bulk-download:record-progress 事件', () => {
    expect(source).toContain("'bulk-download:record-progress'");
  });

  it('应真实发射 bulk-download:record-status 事件', () => {
    expect(source).toContain("'bulk-download:record-status'");
  });

  it('应通过 BrowserWindow.getAllWindows 广播事件', () => {
    expect(source).toContain('BrowserWindow.getAllWindows()');
    expect(source).toContain('win.webContents.send(');
  });
});
