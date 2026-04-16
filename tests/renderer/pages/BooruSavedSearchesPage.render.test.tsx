/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from 'antd';
import { BooruSavedSearchesPage } from '../../../src/renderer/pages/BooruSavedSearchesPage';

const getSites = vi.fn();
const getSavedSearches = vi.fn();
const addSavedSearch = vi.fn();
const updateSavedSearch = vi.fn();
const deleteSavedSearch = vi.fn();

function renderPage() {
  return render(
    <App>
      <BooruSavedSearchesPage />
    </App>
  );
}

describe('BooruSavedSearchesPage render behavior', () => {
  afterEach(() => {
    cleanup();
  });

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
      value: (element: Element) => originalGetComputedStyle(element),
    });

    getSites.mockResolvedValue({
      success: true,
      data: [
        { id: 1, name: 'Yande' },
        { id: 2, name: 'Konachan' },
      ],
    });
    getSavedSearches.mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          siteId: 1,
          name: '蓝色系',
          query: 'blue_eyes',
          createdAt: '2026-04-14T00:00:00.000Z',
        },
      ],
    });
    addSavedSearch.mockResolvedValue({ success: true });
    updateSavedSearch.mockResolvedValue({ success: true });
    deleteSavedSearch.mockResolvedValue({ success: true });

    (window as any).electronAPI = {
      booru: {
        getSites,
        getSavedSearches,
        addSavedSearch,
        updateSavedSearch,
        deleteSavedSearch,
      },
    };
  });

  it('编辑保存搜索时应展示站点选择器并将 siteId 一并传给 updateSavedSearch', async () => {
    renderPage();

    expect(await screen.findByText('蓝色系')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: '编辑保存搜索 蓝色系' }));

    const nameInput = await screen.findByDisplayValue('蓝色系');
    fireEvent.change(nameInput, { target: { value: '蓝色系-更新' } });

    const queryInput = await screen.findByDisplayValue('blue_eyes');
    fireEvent.change(queryInput, { target: { value: 'blue_eyes rating:s' } });

    expect(screen.queryByText('站点')).toBeTruthy();

    const comboboxes = await screen.findAllByRole('combobox');
    fireEvent.mouseDown(comboboxes[comboboxes.length - 1]);
    fireEvent.click(await screen.findByText('Konachan'));

    fireEvent.click(screen.getByRole('button', { name: /^保\s*存$/ }));

    await waitFor(
      () => {
        expect(updateSavedSearch).toHaveBeenCalled();
      },
      { timeout: 15_000 }
    );

    // mock 已被调用，同步检查参数
    expect(updateSavedSearch).toHaveBeenCalledWith(1, {
      name: '蓝色系-更新',
      query: 'blue_eyes rating:s',
      siteId: 2,
    });
  });

  it('编辑保存搜索切换到全部站点时应以 null 传给 updateSavedSearch', async () => {
    renderPage();

    expect(await screen.findByText('蓝色系')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: '编辑保存搜索 蓝色系' }));

    const dialog = await screen.findByRole('dialog', { name: '编辑搜索' });
    const comboboxes = within(dialog).getAllByRole('combobox');
    fireEvent.mouseDown(comboboxes[comboboxes.length - 1]);
    const allSitesOptions = await screen.findAllByText('全部站点');
    fireEvent.click(allSitesOptions[allSitesOptions.length - 1]);

    fireEvent.click(screen.getByRole('button', { name: /^保\s*存$/ }));

    await waitFor(
      () => {
        expect(updateSavedSearch).toHaveBeenCalled();
      },
      { timeout: 15_000 }
    );

    // mock 已被调用，同步检查参数
    expect(updateSavedSearch).toHaveBeenCalledWith(1, {
      name: '蓝色系',
      query: 'blue_eyes',
      siteId: null,
    });
  });
});
