/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from 'antd';
import { SettingsPage } from '../../../src/renderer/pages/SettingsPage';
import { BooruSettingsPage } from '../../../src/renderer/pages/BooruSettingsPage';

const getConfig = vi.fn();
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
const scanSubfolders = vi.fn();
const getSites = vi.fn();
const addSite = vi.fn();
const updateSite = vi.fn();
const deleteSite = vi.fn();
const getPosts = vi.fn();
const login = vi.fn();
const logout = vi.fn();
const setThemeMode = vi.fn();
const setLocale = vi.fn();
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;

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
    t: (key: string) => {
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
        'settings.download': '下载设置',
        'settings.downloadPath': '下载路径',
        'settings.notSet': '未设置',
        'settings.thumbnails': '缩略图',
        'settings.thumbnailsFooter': '缩略图设置',
        'settings.thumbnailSize': '缩略图大小',
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
        'settings.cacheManagement': '缓存管理',
        'settings.cacheSize': '缓存大小',
        'settings.cacheFiles': '个文件',
        'settings.clearCache': '清理缓存',
        'settings.clearCacheDesc': '清理缓存说明',
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
      return mapping[key] ?? key;
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
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
      thumbnails: { cachePath: 'thumbnails', maxWidth: 800, maxHeight: 800, quality: 92, format: 'webp' },
      galleries: { folders: [] },
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
  getCacheStats.mockResolvedValue({ success: true, data: { sizeMB: 0, fileCount: 0 } });
  checkForUpdate.mockResolvedValue({ success: false, error: 'skip' });
  getSites.mockResolvedValue({ success: true, data: [] });
  addSite.mockResolvedValue({ success: true });
  updateSite.mockResolvedValue({ success: true });
  deleteSite.mockResolvedValue({ success: true });
  getPosts.mockResolvedValue({ success: true, data: [] });
  login.mockResolvedValue({ success: true });
  logout.mockResolvedValue({ success: true });

  (window as any).electronAPI = {
    config: {
      get: getConfig,
      save: saveConfig,
      updateGalleryFolders,
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
    },
    gallery: {
      scanSubfolders,
    },
  };
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  consoleLogSpy.mockRestore();
  cleanup();
});

describe('SettingsPage general tab behavior', () => {
  it('不展示没有真实配置链路的自动生成缩略图伪设置', async () => {
    render(<SettingsPage />);

    await screen.findByText('缩略图');

    expect(screen.queryByText('自动生成缩略图')).toBeNull();
    expect(screen.queryByText('自动生成')).toBeNull();
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
    render(<SettingsPage />);

    await screen.findByText('缓存管理');

    expect(screen.queryByText('高级')).toBeNull();
    expect(screen.queryByText('重建索引')).toBeNull();
    expect(screen.queryByText('重置全部')).toBeNull();
  });
});

describe('SettingsPage save behavior', () => {
  it('在通用设置页点击保存所有设置时不应把代理凭据回传到渲染层保存负载', async () => {
    render(<SettingsPage />);

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

    const editButtonLabel = await screen.findByText('编辑');
    const editButton = editButtonLabel.closest('button');
    expect(editButton).not.toBeNull();
    await userEvent.click(editButton!);

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

    const editButtonLabel = await screen.findByText('编辑');
    const editButton = editButtonLabel.closest('button');
    expect(editButton).not.toBeNull();
    await userEvent.click(editButton!);

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
