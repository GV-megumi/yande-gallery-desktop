/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../../../src/renderer/pages/SettingsPage';

const getConfig = vi.fn();
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
const setThemeMode = vi.fn();
const setLocale = vi.fn();
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let renderResult: RenderResult;

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

  saveConfig.mockResolvedValue({ success: true });
  getCacheStats.mockResolvedValue({ success: true, data: { sizeMB: 0, fileCount: 0 } });
  checkForUpdate.mockResolvedValue({ success: false, error: 'skip' });

  (window as any).electronAPI = {
    config: {
      get: getConfig,
      save: saveConfig,
      updateGalleryFolders,
    },
    booru: {
      getCacheStats,
      clearCache,
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
  cleanup();
});

describe('SettingsPage save behavior', () => {
  it('在通用设置页点击保存所有设置时应保留已有代理配置', async () => {
    renderResult = render(<SettingsPage />);

    const actionButtons = await screen.findAllByRole('button');
    const saveButton = actionButtons[actionButtons.length - 1];
    await userEvent.click(saveButton);

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
            username: 'user',
            password: 'secret',
          },
        },
      })
    );
    expect(consoleErrorSpy.mock.calls).toEqual([]);
  });
});
