/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, render, screen, waitFor, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from 'antd';
import { SettingsPage } from '../../../src/renderer/pages/SettingsPage';
import { BooruSettingsPage } from '../../../src/renderer/pages/BooruSettingsPage';

const getConfig = vi.fn();
const getNotifications = vi.fn();
const setNotifications = vi.fn();
const getDesktop = vi.fn();
const setDesktop = vi.fn();
const getAppearancePreference = vi.fn();
const saveConfig = vi.fn();
const updateGalleryFolders = vi.fn();
const getCacheStats = vi.fn();
const clearCache = vi.fn();
const selectFolder = vi.fn();
const exportBackup = vi.fn();
const importBackup = vi.fn();
const checkForUpdate = vi.fn();
const openExternal = vi.fn();
const testBaidu = vi.fn();
const testGoogle = vi.fn();
const getGalleries = vi.fn();
const createGallery = vi.fn();
const updateGallery = vi.fn();
const deleteGallery = vi.fn();
const planScanFolder = vi.fn();
const applyScanPlan = vi.fn();
const previewRelocateRoot = vi.fn();
const applyRelocateRoot = vi.fn();
// 维护动作：清理孤儿缩略图
const cleanupOrphanThumbnails = vi.fn();
const getSites = vi.fn();
const addSite = vi.fn();
const updateSite = vi.fn();
const deleteSite = vi.fn();
const getPosts = vi.fn();
const login = vi.fn();
const logout = vi.fn();
const getApiServiceConfig = vi.fn();
const saveApiServiceConfig = vi.fn();
const getApiServiceStatus = vi.fn();
const generateApiServiceKey = vi.fn();
const getApiServiceLogs = vi.fn();
const setThemeMode = vi.fn();
const setLocale = vi.fn();
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let appEventCallback: ((event: any) => void) | undefined;

vi.mock('../../../src/renderer/hooks/useTheme', () => ({
  useTheme: () => ({
    themeMode: 'light',
    setThemeMode,
  }),
}));

vi.mock('../../../src/renderer/locales', () => ({
  useLocale: () => ({
    locale: 'zh-CN',
    setLocale,
    t: (key: string, params?: Record<string, string | number>) => {
      const mapping: Record<string, string> = {
        'settings.tabGeneral': '通用配置',
        'settings.tabProxy': '代理配置',
        'settings.tabAbout': '关于',
        'settings.saveAll': '保存所有设置',
        'settings.saveSuccess': '设置已保存',
        'settings.saveFailed': '保存失败',
        'settings.galleryFolders': '图库文件夹',
        'settings.galleryFoldersFooter': '图库目录',
        'settings.noFolders': '暂无文件夹',
        'settings.addFolder': '添加文件夹',
        'settings.scanFolder': '扫描文件夹',
        'settings.deleteFolder': '删除文件夹',
        'settings.deleteFolderConfirm': '确认删除',
        'settings.scanApplySummary': '新增 {created} 个图集，合并 {merged} 个，失败 {failedFolders} 个文件夹，{skippedFiles} 张图片已存在',
        'settings.cleanupOrphanThumbs': '清理孤儿缩略图',
        'settings.cleanupOrphanThumbsDesc': '删除与库内图片已无对应关系的缩略图缓存文件（只清无主项，安全）',
        'settings.cleanupOrphanThumbsSuccess': '已清理 {deleted} 个孤儿缩略图（释放 {freedMb} MB），共对账 {scanned} 个',
        'settings.cleanupOrphanThumbsFailed': '清理孤儿缩略图失败',
        'settings.download': '下载设置',
        'settings.downloadPath': '下载路径',
        'settings.notSet': '未设置',
        'settings.thumbnails': '缩略图',
        'settings.thumbnailsFooter': '缩略图设置',
        'settings.thumbnailSize': '缩略图大小',
        'settings.thumbnailEffort': '压缩强度',
        'settings.thumbnailEffortFast': '快速 (2)',
        'settings.thumbnailEffortBalanced': '均衡 (3)',
        'settings.thumbnailEffortBest': '最高压缩 (6)',
        'settings.sizeSmall': '小',
        'settings.sizeMedium': '中',
        'settings.sizeLarge': '大',
        'settings.sizeHD': '高清',
        'settings.sizeUHD': '超清',
        'settings.thumbnailQuality': '缩略图质量',
        'settings.qualityStandard': '标准',
        'settings.qualityGood': '良好',
        'settings.qualityHigh': '高',
        'settings.qualityVeryHigh': '很高',
        'settings.qualityMax': '最高',
        'settings.autoGenThumbnail': '自动生成缩略图',
        'settings.autoGenThumbnailDesc': '自动生成',
        'settings.appearance': '外观',
        'settings.theme': '主题',
        'settings.themeLight': '浅色',
        'settings.themeDark': '深色',
        'settings.themeSystem': '跟随系统',
        'settings.language': '语言',
        'settings.languageZh': '中文',
        'settings.languageEn': 'English',
        'settings.hardwareAcceleration': '启用硬件加速',
        'settings.hardwareAccelerationDesc': '使用 GPU 加速窗口渲染和媒体显示，重启后生效。',
        'settings.advanced': '高级',
        'settings.reindexDb': '重建索引',
        'settings.resetAll': '重置全部',
        'settings.featureDev': '开发中',
        'settings.about': '关于',
        'settings.version': '版本',
        'settings.proxyServer': '代理服务器',
        'settings.networkFooter': '代理说明',
        'settings.proxyEnabled': '启用代理',
        'settings.proxyProtocol': '协议',
        'settings.proxyHost': '主机',
        'settings.proxyPort': '端口',
        'settings.connectivityTest': '连通性测试',
        'settings.testBaidu': '测试百度',
        'settings.testGoogle': '测试谷歌',
        'settings.baiduSuccess': '百度成功',
        'settings.baiduFailed': '百度失败',
        'settings.googleSuccess': '谷歌成功',
        'settings.googleFailed': '谷歌失败'
      };
      // 与真实 useLocale 的 t 对齐：支持 {param} 占位符替换
      const template = mapping[key] ?? key;
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, (_, name: string) => (name in params ? String(params[name]) : `{${name}}`));
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  appEventCallback = undefined;
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  const originalGetComputedStyle = window.getComputedStyle.bind(window);
  Object.defineProperty(window, 'getComputedStyle', {
    writable: true,
    value: (element: Element, pseudoElt?: string | null) => originalGetComputedStyle(element, pseudoElt || undefined),
  });

  getConfig.mockResolvedValue({
    success: true,
    data: {
      downloads: { path: 'D:/downloads', createSubfolders: true, subfolderFormat: ['tags'] },
      thumbnails: { cachePath: 'thumbnails', maxWidth: 800, maxHeight: 800, quality: 92, format: 'webp', effort: 3 },
      network: {
        proxy: {
          enabled: true,
          protocol: 'http',
          host: '127.0.0.1',
          port: 7890,
          username: 'user',
          password: 'secret',
        },
      },
      app: {
        recentImagesCount: 100,
        pageSize: 50,
        defaultViewMode: 'grid',
        showImageInfo: true,
        autoScan: true,
        autoScanInterval: 30,
      },
      logging: {
        level: 'info',
        filePath: 'app.log',
        consoleOutput: true,
        maxFileSize: 10,
        maxFiles: 5,
      },
      yande: {
        apiUrl: 'https://yande.re/post.json',
        pageSize: 20,
        downloadTimeout: 60,
        maxConcurrentDownloads: 5,
      },
      database: { path: 'gallery.db', logging: true },
      booru: {
        appearance: {
          gridSize: 330,
          previewQuality: 'auto',
          itemsPerPage: 20,
          paginationPosition: 'bottom',
          pageMode: 'pagination',
          spacing: 16,
          borderRadius: 8,
          margin: 24,
        },
        download: {
          filenameTemplate: '{site}_{id}_{md5}.{extension}',
          tokenDefaults: {},
        },
      },
    },
  });

  getAppearancePreference.mockResolvedValue({
    success: true,
    data: {
      gridSize: 280,
      previewQuality: 'high',
      itemsPerPage: 35,
      paginationPosition: 'both',
      spacing: 20,
      borderRadius: 12,
      margin: 32,
      maxCacheSizeMB: 900,
    },
  });
  saveConfig.mockResolvedValue({ success: true });
  getNotifications.mockResolvedValue({
    success: true,
    data: {
      enabled: true,
      byStatus: { completed: true, failed: true, allSkipped: true },
      singleDownload: { enabled: false },
      clickAction: 'openDownloadHub',
    },
  });
  setNotifications.mockResolvedValue({ success: true });
  getDesktop.mockResolvedValue({
    success: true,
    data: {
      closeAction: 'hide-to-tray',
      autoLaunch: false,
      startMinimized: false,
      hardwareAcceleration: false,
    },
  });
  setDesktop.mockResolvedValue({ success: true });
  getCacheStats.mockResolvedValue({ success: true, data: { sizeMB: 0, fileCount: 0 } });
  checkForUpdate.mockResolvedValue({ success: false, error: 'skip' });
  getGalleries.mockResolvedValue({ success: true, data: [] });
  createGallery.mockResolvedValue({ success: true, data: { id: 1 } });
  updateGallery.mockResolvedValue({ success: true });
  deleteGallery.mockResolvedValue({ success: true });
  planScanFolder.mockResolvedValue({
    success: true,
    data: { newFolders: [], collisions: [], skipped: [] },
  });
  applyScanPlan.mockResolvedValue({
    success: true,
    data: { created: 0, merged: 0, imported: 0, failedFolders: 0, skippedFiles: 0 },
  });
  previewRelocateRoot.mockResolvedValue({ success: true, data: { affected: [], collisions: [] } });
  applyRelocateRoot.mockResolvedValue({ success: true, data: { affected: [] } });
  cleanupOrphanThumbnails.mockResolvedValue({ success: true, data: { scanned: 0, deleted: 0, freedBytes: 0 } });
  getSites.mockResolvedValue({ success: true, data: [] });
  addSite.mockResolvedValue({ success: true });
  updateSite.mockResolvedValue({ success: true });
  deleteSite.mockResolvedValue({ success: true });
  getPosts.mockResolvedValue({ success: true, data: [] });
  login.mockResolvedValue({ success: true });
  logout.mockResolvedValue({ success: true });
  getApiServiceConfig.mockResolvedValue({
    success: true,
    data: {
      enabled: false,
      mode: 'localhost',
      port: 38947,
      apiKey: 'secret-key',
      permissions: {
        galleryRead: true,
        imageRead: true,
        imageBinary: false,
        booruRead: true,
        booruWrite: false,
        imageWrite: false,
        galleryWrite: false,
        favoriteTagsRead: true,
        favoriteTagsWrite: false,
        downloadsRead: true,
        downloadsControl: false,
        eventsSubscribe: false,
        apiLogsRead: false,
      },
      logs: { enabled: false, visibleInUi: false, retentionDays: 14, maxEntries: 1000 },
    },
  });
  saveApiServiceConfig.mockResolvedValue({ success: true });
  getApiServiceStatus.mockResolvedValue({
    success: true,
    data: {
      running: false,
      enabled: false,
      mode: 'localhost',
      port: 38947,
      bindAddress: null,
      baseUrl: null,
      startedAt: null,
      lastError: null,
    },
  });
  generateApiServiceKey.mockResolvedValue({ success: true, data: { apiKey: 'new-key' } });
  getApiServiceLogs.mockResolvedValue({ success: true, data: { items: [], total: 0 } });

  (window as any).electronAPI = {
    config: {
      get: getConfig,
      save: saveConfig,
      updateGalleryFolders,
      getNotifications,
      setNotifications,
      getDesktop,
      setDesktop,
    },
    booru: {
      getCacheStats,
      clearCache,
      getSites,
      addSite,
      updateSite,
      deleteSite,
      getPosts,
      login,
      logout,
    },
    booruPreferences: {
      appearance: {
        get: getAppearancePreference,
        onChanged: vi.fn(),
      },
    },
    system: {
      selectFolder,
      exportBackup,
      importBackup,
      checkForUpdate,
      openExternal,
      testBaidu,
      testGoogle,
      onAppEvent: vi.fn((callback) => {
        appEventCallback = callback;
        return vi.fn();
      }),
    },
    gallery: {
      getGalleries,
      createGallery,
      updateGallery,
      deleteGallery,
      planScanFolder,
      applyScanPlan,
      previewRelocateRoot,
      applyRelocateRoot,
    },
    image: {
      cleanupOrphanThumbnails,
    },
    apiService: {
      getConfig: getApiServiceConfig,
      saveConfig: saveApiServiceConfig,
      getStatus: getApiServiceStatus,
      generateKey: generateApiServiceKey,
      getLogs: getApiServiceLogs,
    },
  };
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  consoleLogSpy.mockRestore();
  cleanup();
});

describe('SettingsPage general tab behavior', () => {
  it('接收 config:changed 后应按受影响 section 重新加载配置', async () => {
    render(<App><SettingsPage /></App>);

    await screen.findByText('图库文件夹');
    await waitFor(() => {
      expect(getConfig).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      appEventCallback?.({
        type: 'config:changed',
        version: 1,
        occurredAt: '2026-06-09T00:00:00.000Z',
        source: 'configService',
        payload: { version: 2, sections: ['downloads'] },
      });
    });

    await waitFor(() => {
      expect(getConfig).toHaveBeenCalledTimes(2);
    });
  });

  it('接收 api-service:status-changed 后应直接刷新 API 服务状态展示', async () => {
    render(<App><SettingsPage /></App>);

    const apiTab = await screen.findByText('API 服务');
    await userEvent.click(apiTab);
    await screen.findByText('运行状态');

    await act(async () => {
      appEventCallback?.({
        type: 'api-service:status-changed',
        version: 1,
        occurredAt: '2026-06-09T00:00:00.000Z',
        source: 'apiService',
        payload: {
          running: true,
          enabled: true,
          mode: 'localhost',
          port: 38947,
          bindAddress: '127.0.0.1',
          baseUrl: 'http://127.0.0.1:38947',
          startedAt: '2026-06-09T00:00:00.000Z',
          lastError: null,
        },
      });
    });

    await screen.findByText('运行中 http://127.0.0.1:38947（绑定 127.0.0.1）');
  });

  it('API 服务页应加载配置并保存启用状态的精确 patch', async () => {
    render(<App><SettingsPage /></App>);

    const apiTab = await screen.findByText('API 服务');
    await userEvent.click(apiTab);

    await screen.findByText('监听模式');
    await screen.findByText('图集读取');

    const enableLabel = screen.getByText('启用 Agent API');
    const enableRow = enableLabel.closest('div[style*="display: flex"]') as HTMLElement;
    const enableSwitch = enableRow.querySelector('.ant-switch') as HTMLButtonElement;
    await userEvent.click(enableSwitch);

    await waitFor(() => {
      expect(saveApiServiceConfig).toHaveBeenCalledWith({ enabled: true });
    });
  });

  it('API 权限开关应只保存单个权限的 nested patch', async () => {
    render(<App><SettingsPage /></App>);

    const apiTab = await screen.findByText('API 服务');
    await userEvent.click(apiTab);

    const permissionLabel = await screen.findByText('图片内容访问');
    const permissionRow = permissionLabel.closest('div[style*="display: flex"]') as HTMLElement;
    const permissionSwitch = permissionRow.querySelector('.ant-switch') as HTMLButtonElement;
    await userEvent.click(permissionSwitch);

    await waitFor(() => {
      expect(saveApiServiceConfig).toHaveBeenCalledWith({
        permissions: { imageBinary: true },
      });
    });
  });

  it('API 端口应先编辑 draft，失焦后再保存', async () => {
    render(<App><SettingsPage /></App>);

    const apiTab = await screen.findByText('API 服务');
    await userEvent.click(apiTab);

    const portInput = await screen.findByDisplayValue('38947') as HTMLInputElement;
    await userEvent.clear(portInput);
    await userEvent.type(portInput, '38948');

    expect(saveApiServiceConfig).not.toHaveBeenCalled();

    portInput.blur();

    await waitFor(() => {
      expect(saveApiServiceConfig).toHaveBeenCalledWith({ port: 38948 });
    });
  });

  it('不展示没有真实配置链路的自动生成缩略图伪设置', async () => {
    render(<App><SettingsPage /></App>);

    await screen.findByText('缩略图');

    expect(screen.queryByText('自动生成缩略图')).toBeNull();
    expect(screen.queryByText('自动生成')).toBeNull();
  });

  it('全局设置页不展示 Booru 原图缓存管理入口', async () => {
    render(<App><SettingsPage /></App>);

    await screen.findByText('备份与恢复');

    expect(screen.queryByText('缓存管理')).toBeNull();
    expect(screen.queryByText('缓存大小')).toBeNull();
    expect(screen.queryByText('清理缓存')).toBeNull();
    expect(getCacheStats).not.toHaveBeenCalled();
    expect(clearCache).not.toHaveBeenCalled();
  });

  it('不展示误导性的页面模式伪设置', async () => {
    render(
      <App>
        <BooruSettingsPage />
      </App>
    );

    const appearanceTab = await screen.findByRole('tab', { name: /外观配置/ });
    await userEvent.click(appearanceTab);

    await screen.findByText('保存外观配置');

    expect(screen.queryByText('页面模式')).toBeNull();
    expect(screen.queryByText('翻页')).toBeNull();
    expect(screen.queryByText('无限滚动')).toBeNull();
  });

  it('外观配置页应通过 booruPreferences.appearance.get 加载受控 appearance DTO 且不再依赖 config.get', async () => {
    render(
      <App>
        <BooruSettingsPage />
      </App>
    );

    const appearanceTab = await screen.findByRole('tab', { name: /外观配置/ });
    await userEvent.click(appearanceTab);

    await screen.findByText('保存外观配置');

    await waitFor(() => {
      expect(getAppearancePreference).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText('Booru 原图缓存设置')).not.toBeNull();
    expect(screen.getByText('Booru 原图缓存目录最大大小')).not.toBeNull();
    expect(screen.getByText('当前 Booru 原图缓存状态')).not.toBeNull();

    expect(getConfig).toHaveBeenCalledTimes(1);

    const numberInputs = screen.getAllByRole('spinbutton');
    expect(numberInputs.some((input) => (input as HTMLInputElement).value === '35')).toBe(true);
    expect(numberInputs.some((input) => (input as HTMLInputElement).value === '900')).toBe(true);
    expect(screen.queryByDisplayValue('20')).toBeNull();
  });

  it('保存外观配置时不会回写遗留的 pageMode 字段', async () => {
    render(
      <App>
        <BooruSettingsPage />
      </App>
    );

    const appearanceTab = await screen.findByRole('tab', { name: /外观配置/ });
    await userEvent.click(appearanceTab);

    const saveButtonLabel = await screen.findByText('保存外观配置');
    const saveButton = saveButtonLabel.closest('button');
    expect(saveButton).not.toBeNull();
    await userEvent.click(saveButton!);

    await waitFor(() => {
      expect(saveConfig).toHaveBeenCalled();
    });

    const savedAppearance = (saveConfig.mock.calls.at(-1)?.[0] as any)?.booru?.appearance;
    expect(savedAppearance).toEqual({
      gridSize: 280,
      previewQuality: 'high',
      itemsPerPage: 35,
      paginationPosition: 'both',
      spacing: 20,
      borderRadius: 12,
      margin: 32,
      maxCacheSizeMB: 900,
    });
    expect(savedAppearance).not.toHaveProperty('pageMode');
  });

  it('不展示仅提示开发中的高级伪操作', async () => {
    render(<App><SettingsPage /></App>);

    await screen.findByText('备份与恢复');

    expect(screen.queryByText('高级')).toBeNull();
    expect(screen.queryByText('重建索引')).toBeNull();
    expect(screen.queryByText('重置全部')).toBeNull();
  });
  it('应在桌面行为中展示硬件加速开关并保存到 desktop 配置域', async () => {
    render(<App><SettingsPage /></App>);

    const label = await screen.findByText('启用硬件加速');
    const row = label.closest('div[style*="display: flex"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    const switchButton = row!.querySelector('.ant-switch') as HTMLButtonElement | null;
    expect(switchButton).not.toBeNull();

    await userEvent.click(switchButton!);

    await waitFor(() => {
      expect(setDesktop).toHaveBeenCalledWith({ hardwareAcceleration: true });
    });
  });

  it('不再展示按图库逐条列出的旧列表（图集列表已迁至图库页）', async () => {
    getGalleries.mockResolvedValue({
      success: true,
      data: [
        { id: 1, folderPath: 'D:/pics/a', name: '图集A', recursive: true, extensions: ['.jpg'], imageCount: 3, isWatching: true },
      ],
    });

    render(<App><SettingsPage /></App>);

    await screen.findByText('图库文件夹');
    // 旧的逐条列表与其行内操作不再出现
    expect(screen.queryByText('图集A')).toBeNull();
    expect(screen.queryByText('停止监视')).toBeNull();
    expect(screen.queryByText('删除文件夹')).toBeNull();
  });

  it('扫描文件夹无碰撞时直接 applyScanPlan 并带上 planScanFolder 返回的 newFolders', async () => {
    selectFolder.mockResolvedValue({ success: true, data: 'D:/pics/root' });
    planScanFolder.mockResolvedValue({
      success: true,
      data: {
        newFolders: [
          { folderPath: 'D:/pics/root/a', name: 'a' },
          { folderPath: 'D:/pics/root/b', name: 'b' },
        ],
        collisions: [],
        skipped: [],
      },
    });

    render(<App><SettingsPage /></App>);

    const scanButton = await screen.findByRole('button', { name: /扫描文件夹/ });
    await userEvent.click(scanButton);

    await waitFor(() => {
      expect(planScanFolder).toHaveBeenCalledWith('D:/pics/root');
    });
    await waitFor(() => {
      expect(applyScanPlan).toHaveBeenCalledWith({
        create: [
          { folderPath: 'D:/pics/root/a', name: 'a' },
          { folderPath: 'D:/pics/root/b', name: 'b' },
        ],
        merge: [],
      });
    });
  });

  it('扫描汇总 toast 分开表述文件夹级失败与文件级已存在，不再混成一个跳过计数', async () => {
    selectFolder.mockResolvedValue({ success: true, data: 'D:/pics/root' });
    planScanFolder.mockResolvedValue({
      success: true,
      data: {
        newFolders: [
          { folderPath: 'D:/pics/root/a', name: 'a' },
          { folderPath: 'D:/pics/root/b', name: 'b' },
        ],
        collisions: [],
        skipped: [],
      },
    });
    // 模拟：2 个新建成功、1 个文件夹项失败、3200 个文件因已入库被跳过（幂等重扫）
    applyScanPlan.mockResolvedValue({
      success: true,
      data: { created: 2, merged: 0, imported: 10, failedFolders: 1, skippedFiles: 3200 },
    });

    render(<App><SettingsPage /></App>);

    const scanButton = await screen.findByRole('button', { name: /扫描文件夹/ });
    await userEvent.click(scanButton);

    await waitFor(() => {
      expect(applyScanPlan).toHaveBeenCalled();
    });

    // 两种单位分开呈现：文件夹级失败数与文件级已存在数各自可读，且不出现「跳过 3201 个」这类混合值
    await screen.findByText('新增 2 个图集，合并 0 个，失败 1 个文件夹，3200 张图片已存在');
  });

  it('扫描文件夹用户取消选择目录时不规划也不应用', async () => {
    selectFolder.mockResolvedValue({ success: false });

    render(<App><SettingsPage /></App>);

    const scanButton = await screen.findByRole('button', { name: /扫描文件夹/ });
    await userEvent.click(scanButton);

    await waitFor(() => {
      expect(selectFolder).toHaveBeenCalled();
    });
    expect(planScanFolder).not.toHaveBeenCalled();
    expect(applyScanPlan).not.toHaveBeenCalled();
  });

  it('点击重定位根目录可打开重定位维护弹窗', async () => {
    render(<App><SettingsPage /></App>);

    const relocateEntry = await screen.findByRole('button', { name: /重定位根目录/ });
    await userEvent.click(relocateEntry);

    // 弹窗（dialog）出现后，在其作用域内断言说明文案与预览按钮，避免与行内 tooltip 文案冲突
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/跨机器迁移/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /预\s*览/ })).toBeTruthy();
  });

  it('清理孤儿缩略图：点击后调用维护接口并给出结果提示', async () => {
    cleanupOrphanThumbnails.mockResolvedValue({
      success: true,
      data: { scanned: 12, deleted: 3, freedBytes: 2.5 * 1024 * 1024 },
    });
    render(<App><SettingsPage /></App>);

    await userEvent.click(await screen.findByRole('button', { name: /清理孤儿缩略图/ }));

    await waitFor(() => {
      expect(cleanupOrphanThumbnails).toHaveBeenCalled();
    });
    expect(await screen.findByText(/已清理 3 个孤儿缩略图（释放 2\.5 MB），共对账 12 个/)).toBeTruthy();
  });

  it('丢失文件夹横幅跳转：pendingRelocateOpen 挂载即自动打开重定位弹窗并消费信号', async () => {
    const onRelocateOpenConsumed = vi.fn();
    render(
      <App>
        <SettingsPage pendingRelocateOpen onRelocateOpenConsumed={onRelocateOpenConsumed} />
      </App>
    );

    // 无需任何点击：弹窗自动打开（来自图集详情「去重定位」跳转）
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/跨机器迁移/)).toBeTruthy();
    // 一次性信号被消费，避免下次正常打开设置页误弹
    await waitFor(() => {
      expect(onRelocateOpenConsumed).toHaveBeenCalled();
    });
  });
});

describe('SettingsPage save behavior', () => {
  it('在通用设置页点击保存所有设置时不应把代理凭据回传到渲染层保存负载', async () => {
    render(<App><SettingsPage /></App>);

    const saveButtonLabel = await screen.findByText('保存所有设置');
    const saveButton = saveButtonLabel.closest('button');
    expect(saveButton).not.toBeNull();
    await userEvent.click(saveButton!);

    await waitFor(() => {
      expect(saveConfig).toHaveBeenCalledTimes(1);
    });

    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        network: {
          proxy: {
            enabled: true,
            protocol: 'http',
            host: '127.0.0.1',
            port: 7890,
          },
        },
      })
    );
    expect((saveConfig.mock.calls[0]?.[0] as any)?.network?.proxy).not.toHaveProperty('username');
    expect((saveConfig.mock.calls[0]?.[0] as any)?.network?.proxy).not.toHaveProperty('password');
    expect(consoleErrorSpy.mock.calls).toEqual([]);
  });

  it('保存所有设置时不应把已单独保存的 desktop 配置整包回写', async () => {
    render(<App><SettingsPage /></App>);

    const hardwareAccelerationLabel = await screen.findByText('启用硬件加速');
    const hardwareAccelerationRow = hardwareAccelerationLabel.closest('div[style*="display: flex"]') as HTMLElement | null;
    expect(hardwareAccelerationRow).not.toBeNull();
    const hardwareAccelerationSwitch = hardwareAccelerationRow!.querySelector('.ant-switch') as HTMLButtonElement | null;
    expect(hardwareAccelerationSwitch).not.toBeNull();

    await userEvent.click(hardwareAccelerationSwitch!);

    await waitFor(() => {
      expect(setDesktop).toHaveBeenCalledWith({ hardwareAcceleration: true });
    });

    const saveButtonLabel = await screen.findByText('保存所有设置');
    const saveButton = saveButtonLabel.closest('button');
    expect(saveButton).not.toBeNull();
    await userEvent.click(saveButton!);

    await waitFor(() => {
      expect(saveConfig).toHaveBeenCalledTimes(1);
    });

    expect(saveConfig.mock.calls[0]?.[0]).not.toHaveProperty('desktop');
  });

  it('编辑站点时不应预填敏感凭据，且保存普通字段时不回传 salt 与 apiKey', async () => {
    getSites.mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          name: 'Yande',
          url: 'https://yande.re',
          type: 'moebooru',
          username: 'alice',
          authenticated: true,
          favoriteSupport: true,
          active: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    });

    render(
      <App>
        <BooruSettingsPage />
      </App>
    );

    // 编辑入口已收纳进"更多操作"下拉菜单
    const moreButton = await screen.findByRole('button', { name: '更多操作' });
    await userEvent.click(moreButton);
    const editMenuItem = await screen.findByText('编辑');
    await userEvent.click(editMenuItem);

    const [saltInput, apiKeyInput] = await screen.findAllByPlaceholderText('留空保留当前值；仅在需要覆盖时填写') as HTMLInputElement[];
    const usernameInput = screen.getByDisplayValue('alice') as HTMLInputElement;
    const nameInput = screen.getByDisplayValue('Yande') as HTMLInputElement;

    expect(saltInput.value).toBe('');
    expect(apiKeyInput.value).toBe('');
    expect(usernameInput.value).toBe('alice');
    expect(nameInput.value).toBe('Yande');

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Yande Mirror');

    const modalContent = saltInput.closest('.ant-modal-content') as HTMLElement | null;
    expect(modalContent).not.toBeNull();
    const saveButton = modalContent!.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    expect(saveButton).not.toBeNull();
    await userEvent.click(saveButton!);

    await waitFor(() => {
      expect(updateSite).toHaveBeenCalledTimes(1);
    });

    expect(updateSite).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        name: 'Yande Mirror',
        username: 'alice',
      })
    );

    const payload = updateSite.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('salt');
    expect(payload).not.toHaveProperty('apiKey');
  });

  it('编辑站点并填写敏感字段时不应把 salt 与 apiKey 写入控制台日志', async () => {
    getSites.mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          name: 'Yande',
          url: 'https://yande.re',
          type: 'moebooru',
          username: 'alice',
          authenticated: true,
          favoriteSupport: true,
          active: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    });

    render(
      <App>
        <BooruSettingsPage />
      </App>
    );

    // 编辑入口已收纳进"更多操作"下拉菜单
    const moreButton = await screen.findByRole('button', { name: '更多操作' });
    await userEvent.click(moreButton);
    const editMenuItem = await screen.findByText('编辑');
    await userEvent.click(editMenuItem);

    const [saltInput, apiKeyInput] = await screen.findAllByPlaceholderText('留空保留当前值；仅在需要覆盖时填写') as HTMLInputElement[];
    const nameInput = screen.getByDisplayValue('Yande') as HTMLInputElement;

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Yande Mirror');
    await userEvent.type(saltInput, 'secret-salt');
    await userEvent.type(apiKeyInput, 'secret-api-key');

    const modalContent = saltInput.closest('.ant-modal-content') as HTMLElement | null;
    expect(modalContent).not.toBeNull();
    const saveButton = modalContent!.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    expect(saveButton).not.toBeNull();
    await userEvent.click(saveButton!);

    await waitFor(() => {
      expect(updateSite).toHaveBeenCalledTimes(1);
    });

    const leakedPayload = consoleLogSpy.mock.calls.find(([, value]) => {
      if (!value || typeof value !== 'object') {
        return false;
      }

      const loggedObject = value as Record<string, unknown>;
      return loggedObject.salt === 'secret-salt' || loggedObject.apiKey === 'secret-api-key';
    });

    expect(leakedPayload).toBeUndefined();
  });

  it('站点认证展示应基于 authenticated 而不是 passwordHash', async () => {
    getSites.mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          name: 'Yande',
          url: 'https://yande.re',
          type: 'moebooru',
          username: 'alice',
          authenticated: false,
          favoriteSupport: true,
          active: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    });

    render(
      <App>
        <BooruSettingsPage />
      </App>
    );

    await screen.findByText('Yande');
    expect(screen.getByText('未登录')).not.toBeNull();
    const loginButtons = screen.getAllByRole('button').filter((button) => button.textContent?.includes('登录'));
    expect(loginButtons.length).toBeGreaterThan(0);
    expect(screen.queryByText('登出')).toBeNull();
  });
});
