/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
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
    t: (key: string) => key,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();

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
  cleanup();
});

describe('SettingsPage save behavior', () => {
  it('在通用设置页点击保存所有设置时应保留已有代理配置', async () => {
    render(<SettingsPage />);

    const saveButton = await screen.findByRole('button', { name: /settings\.saveAll/i });
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
  });
});
