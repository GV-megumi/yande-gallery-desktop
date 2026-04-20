/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { BlacklistedTagsPage } from '../../../src/renderer/pages/BlacklistedTagsPage';

const getBlacklistedTags = vi.fn();
const getSites = vi.fn();
const getConfig = vi.fn();
const saveConfig = vi.fn();
const getBlacklistedTagsPreferences = vi.fn();
const saveBlacklistedTagsPreferences = vi.fn();

function renderPage(active = true) {
  return render(
    <AntdApp>
      <BlacklistedTagsPage active={active} />
    </AntdApp>
  );
}

describe('BlacklistedTagsPage page preference persistence', () => {
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

    getSites.mockResolvedValue({ success: true, data: [{ id: 1, name: 'Yande' }] });
    getBlacklistedTags.mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            id: 1,
            tagName: 'blocked_tag',
            siteId: 1,
            isActive: true,
            createdAt: '2026-04-15T00:00:00.000Z',
          },
        ],
        total: 1,
      },
    });
    getConfig.mockResolvedValue({ success: true, data: {} });
    saveConfig.mockResolvedValue({ success: true });
    getBlacklistedTagsPreferences.mockResolvedValue({ success: true, data: undefined });
    saveBlacklistedTagsPreferences.mockResolvedValue({ success: true });

    (window as any).electronAPI = {
      booru: {
        getSites,
        getBlacklistedTags,
        addBlacklistedTag: vi.fn(),
        removeBlacklistedTag: vi.fn(),
        toggleBlacklistedTag: vi.fn(),
        addBlacklistedTags: vi.fn(),
        importBlacklistedTagsPickFile: vi.fn(),
        importBlacklistedTagsCommit: vi.fn(),
        exportBlacklistedTags: vi.fn(),
      },
      config: {
        get: getConfig,
        save: saveConfig,
      },
      pagePreferences: {
        blacklistedTags: {
          get: getBlacklistedTagsPreferences,
          save: saveBlacklistedTagsPreferences,
        },
      },
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('激活时应从 pagePreferences.blacklistedTags 恢复筛选和分页状态，并写回变更', async () => {
    getBlacklistedTagsPreferences.mockResolvedValueOnce({
      success: true,
      data: {
        filterSiteId: 1,
        keyword: 'persisted blacklist',
        page: 2,
        pageSize: 50,
      },
    });

    renderPage(true);

    await waitFor(() => {
      expect(getBlacklistedTagsPreferences).toHaveBeenCalled();
      expect(getConfig).not.toHaveBeenCalled();
      expect(getBlacklistedTags).toHaveBeenCalledWith({
        siteId: 1,
        keyword: 'persisted blacklist',
        offset: 50,
        limit: 50,
      });
    });

    await waitFor(() => {
      expect(saveBlacklistedTagsPreferences).toHaveBeenCalledWith({
        filterSiteId: 1,
        keyword: 'persisted blacklist',
        page: 2,
        pageSize: 50,
      });
      expect(saveConfig).not.toHaveBeenCalled();
    });

    fireEvent.change(screen.getByPlaceholderText('搜索黑名单标签'), {
      target: { value: 'updated blacklist' },
    });

    await waitFor(() => {
      expect(saveBlacklistedTagsPreferences).toHaveBeenCalledWith(expect.objectContaining({
        keyword: 'updated blacklist',
        page: 1,
      }));
      expect(saveConfig).not.toHaveBeenCalled();
    });
  });

  it('非激活状态时不应加载或保存黑名单页面偏好', async () => {
    renderPage(false);

    await waitFor(() => {
      expect(getBlacklistedTagsPreferences).not.toHaveBeenCalled();
      expect(getConfig).not.toHaveBeenCalled();
      expect(getSites).not.toHaveBeenCalled();
      expect(getBlacklistedTags).not.toHaveBeenCalled();
      expect(saveBlacklistedTagsPreferences).not.toHaveBeenCalled();
      expect(saveConfig).not.toHaveBeenCalled();
    });
  });

  it('重新激活时应先重新 hydrate，再保存新的黑名单页面偏好', async () => {
    const firstPreferences = {
      filterSiteId: 1,
      keyword: 'first blacklist',
      page: 2,
      pageSize: 50,
    };
    const reactivatedPreferences = {
      filterSiteId: 1,
      keyword: 'reactivated blacklist',
      page: 4,
      pageSize: 100,
    };

    getBlacklistedTagsPreferences
      .mockResolvedValueOnce({
        success: true,
        data: firstPreferences,
      })
      .mockResolvedValueOnce({
        success: true,
        data: reactivatedPreferences,
      })
      .mockResolvedValue({ success: true, data: undefined });

    const view = renderPage(true);

    await waitFor(() => {
      expect(getBlacklistedTags).toHaveBeenCalledWith({
        siteId: 1,
        keyword: 'first blacklist',
        offset: 50,
        limit: 50,
      });
    });

    saveBlacklistedTagsPreferences.mockClear();
    getBlacklistedTags.mockClear();

    view.rerender(
      <AntdApp>
        <BlacklistedTagsPage active={false} />
      </AntdApp>
    );
    view.rerender(
      <AntdApp>
        <BlacklistedTagsPage active />
      </AntdApp>
    );

    await waitFor(() => {
      expect(getBlacklistedTagsPreferences).toHaveBeenCalledTimes(2);
      expect(getConfig).not.toHaveBeenCalled();
      expect(getBlacklistedTags).toHaveBeenCalledWith({
        siteId: 1,
        keyword: 'reactivated blacklist',
        offset: 300,
        limit: 100,
      });
    });

    await waitFor(() => {
      expect(saveBlacklistedTagsPreferences).toHaveBeenCalled();
      expect(saveConfig).not.toHaveBeenCalled();
    });

    const firstReactivatedSave = saveBlacklistedTagsPreferences.mock.calls[0]?.[0];
    expect(firstReactivatedSave).toEqual(reactivatedPreferences);
  });

});
