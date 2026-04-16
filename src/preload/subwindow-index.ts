/**
 * 精简 subwindow preload。
 * 只服务 tag-search / artist / character 三种轻量子窗口。
 * secondary-menu 仍使用主 preload（由主进程 createSubWindow 根据 hash 前缀分流）。
 *
 * 暴露域（最小集合，与 SubWindow 实际加载页面的扫描结果对齐）：
 *   - window：再打开子窗口（openTagSearch / openArtist / openCharacter / openSecondaryMenu）
 *   - booru：Booru 数据读写（BooruTagSearchPage / BooruArtistPage / BooruCharacterPage 及其 hooks 使用）
 *   - booruPreferences：外观偏好（页面读取 appearance + onChanged 订阅）
 *   - system：打开外链等（BooruArtistPage 打开 artist URL 用）
 *
 * 明确剔除：
 *   - db / gallery / image / config / bulkDownload / pagePreferences
 *
 * 共享工厂由 src/preload/shared/ 提供，主 preload 也通过同样工厂组合，
 * 保证主窗口对外暴露的等价性。
 */
import { contextBridge } from 'electron';
import { createWindowApi } from './shared/createWindowApi.js';
import { createBooruApi } from './shared/createBooruApi.js';
import { createBooruPreferencesApi } from './shared/createBooruPreferencesApi.js';
import { createSystemApi } from './shared/createSystemApi.js';

console.log('[Preload:subwindow] Exposing minimal electronAPI to lightweight sub-window');

contextBridge.exposeInMainWorld('electronAPI', {
  window: createWindowApi(),
  booru: createBooruApi(),
  booruPreferences: createBooruPreferencesApi(),
  system: createSystemApi(),
});

console.log('[Preload:subwindow] Minimal electronAPI exposed successfully');
