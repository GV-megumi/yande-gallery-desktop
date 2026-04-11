import { describe, it, expect } from 'vitest';
import { IPC_CHANNELS } from '../../../src/main/ipc/channels';
import { readFileSync } from 'fs';
import path from 'path';

describe('favorite tag import/export contract', () => {
  const preloadPath = path.resolve(process.cwd(), 'src/preload/index.ts');
  const handlersPath = path.resolve(process.cwd(), 'src/main/ipc/handlers.ts');
  const booruServicePath = path.resolve(process.cwd(), 'src/main/services/booruService.ts');

  const preloadSource = readFileSync(preloadPath, 'utf-8');
  const handlersSource = readFileSync(handlersPath, 'utf-8');
  const serviceSource = readFileSync(booruServicePath, 'utf-8');

  it('应存在 favorite tag 导入导出 IPC channels', () => {
    expect(IPC_CHANNELS.BOORU_EXPORT_FAVORITE_TAGS).toBe('booru:export-favorite-tags');
    expect(IPC_CHANNELS.BOORU_IMPORT_FAVORITE_TAGS_PICK_FILE).toBe('booru:import-favorite-tags-pick-file');
    expect(IPC_CHANNELS.BOORU_IMPORT_FAVORITE_TAGS_COMMIT).toBe('booru:import-favorite-tags-commit');
  });

  it('preload 应真实暴露 exportFavoriteTags / importFavoriteTagsPickFile / importFavoriteTagsCommit', () => {
    expect(preloadSource).toContain('exportFavoriteTags: (siteId?: number | null) =>');
    expect(preloadSource).toContain('importFavoriteTagsPickFile: () =>');
    expect(preloadSource).toContain('importFavoriteTagsCommit: (payload:');
  });

  it('handlers 应真实注册导入导出 handler', () => {
    expect(handlersSource).toContain('ipcMain.handle(IPC_CHANNELS.BOORU_EXPORT_FAVORITE_TAGS');
    expect(handlersSource).toContain('ipcMain.handle(IPC_CHANNELS.BOORU_IMPORT_FAVORITE_TAGS_PICK_FILE');
    expect(handlersSource).toContain('ipcMain.handle(IPC_CHANNELS.BOORU_IMPORT_FAVORITE_TAGS_COMMIT');
  });

  it('booruService 应真实提供导入导出方法', () => {
    expect(serviceSource).toContain('export async function exportFavoriteTags');
    expect(serviceSource).toContain('export async function importFavoriteTagsPickFile');
    expect(serviceSource).toContain('export async function importFavoriteTagsCommit');
  });
});
