/**
 * TW-05 验收测试：轻量子窗口 preload 暴露面最小化。
 *
 * 覆盖：
 *   - 只暴露 window / booru / booruPreferences / system 四个域
 *   - db / gallery / image / config / bulkDownload / pagePreferences 不可访问
 *   - window 域包含 4 个必需方法
 *
 * secondary-menu 子窗口不走这份 preload，不在此测试范围内。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const exposed: Record<string, unknown> = {};

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: unknown) => {
      exposed[name] = api;
    },
  },
  ipcRenderer: {
    invoke: vi.fn(async () => undefined),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

beforeEach(() => {
  for (const k of Object.keys(exposed)) delete exposed[k];
  vi.resetModules();
});

describe('subwindow preload 暴露面', () => {
  it('只暴露 window/booru/booruPreferences/system 四个域', async () => {
    await import('../../src/preload/subwindow-index');
    const api = exposed.electronAPI as Record<string, unknown> | undefined;
    expect(api).toBeDefined();

    const ALLOWED = new Set(['window', 'booru', 'booruPreferences', 'system']);
    for (const key of Object.keys(api!)) {
      expect(ALLOWED.has(key), `子窗口不应暴露 "${key}" 域`).toBe(true);
    }
    // 4 个必需域都必须存在
    for (const required of ALLOWED) {
      expect(api![required]).toBeDefined();
    }
  });

  it.each([['db'], ['gallery'], ['image'], ['config'], ['bulkDownload'], ['pagePreferences']])(
    '子窗口不暴露 %s 域',
    async (domain) => {
      await import('../../src/preload/subwindow-index');
      const api = exposed.electronAPI as Record<string, unknown>;
      expect(api[domain]).toBeUndefined();
    }
  );

  it('window 域含 4 个必需方法', async () => {
    await import('../../src/preload/subwindow-index');
    const api = exposed.electronAPI as { window: Record<string, unknown> };
    expect(typeof api.window.openTagSearch).toBe('function');
    expect(typeof api.window.openArtist).toBe('function');
    expect(typeof api.window.openCharacter).toBe('function');
    expect(typeof api.window.openSecondaryMenu).toBe('function');
  });

  it('booru 域含核心方法（站点/帖子/收藏等）', async () => {
    await import('../../src/preload/subwindow-index');
    const api = exposed.electronAPI as { booru: Record<string, unknown> };
    // 挑几个代表性方法验证工厂迁移完整
    expect(typeof api.booru.getSites).toBe('function');
    expect(typeof api.booru.searchPosts).toBe('function');
    expect(typeof api.booru.getArtist).toBe('function');
    expect(typeof api.booru.getTagRelationships).toBe('function');
    expect(typeof api.booru.autocompleteTags).toBe('function');
    expect(typeof api.booru.onDownloadProgress).toBe('function');
  });

  it('booruPreferences.appearance 包含 get / onChanged', async () => {
    await import('../../src/preload/subwindow-index');
    const api = exposed.electronAPI as { booruPreferences: { appearance: Record<string, unknown> } };
    expect(typeof api.booruPreferences.appearance.get).toBe('function');
    expect(typeof api.booruPreferences.appearance.onChanged).toBe('function');
  });

  it('system 域含 openExternal（BooruArtistPage 所需）', async () => {
    await import('../../src/preload/subwindow-index');
    const api = exposed.electronAPI as { system: Record<string, unknown> };
    expect(typeof api.system.openExternal).toBe('function');
  });
});
