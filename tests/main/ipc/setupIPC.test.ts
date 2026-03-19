import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('setupIPC source-level registration coverage', () => {
  const handlersPath = path.resolve(process.cwd(), 'src/main/ipc/handlers.ts');
  const source = readFileSync(handlersPath, 'utf-8');

  it('应在真实 handlers.ts 中注册 favorite-tag 下载相关 handlers', () => {
    expect(source).toContain('ipcMain.handle(IPC_CHANNELS.BOORU_GET_FAVORITE_TAGS_WITH_DOWNLOAD_STATE');
    expect(source).toContain('ipcMain.handle(IPC_CHANNELS.BOORU_GET_FAVORITE_TAG_DOWNLOAD_BINDING');
    expect(source).toContain('ipcMain.handle(IPC_CHANNELS.BOORU_GET_FAVORITE_TAG_DOWNLOAD_HISTORY');
    expect(source).toContain('ipcMain.handle(IPC_CHANNELS.BOORU_GET_GALLERY_SOURCE_FAVORITE_TAGS');
    expect(source).toContain('ipcMain.handle(IPC_CHANNELS.BOORU_UPSERT_FAVORITE_TAG_DOWNLOAD_BINDING');
    expect(source).toContain('ipcMain.handle(IPC_CHANNELS.BOORU_REMOVE_FAVORITE_TAG_DOWNLOAD_BINDING');
    expect(source).toContain('ipcMain.handle(IPC_CHANNELS.BOORU_START_FAVORITE_TAG_BULK_DOWNLOAD');
  });

  it('应在真实 handlers.ts 中注册 favorite-tag 导入导出 handlers', () => {
    expect(source).toContain('ipcMain.handle(IPC_CHANNELS.BOORU_EXPORT_FAVORITE_TAGS');
    expect(source).toContain('ipcMain.handle(IPC_CHANNELS.BOORU_IMPORT_FAVORITE_TAGS');
  });
});
