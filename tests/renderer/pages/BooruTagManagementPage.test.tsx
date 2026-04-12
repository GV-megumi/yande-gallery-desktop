/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// mock useLocale
vi.mock('../../../src/renderer/locales', () => ({
  useLocale: () => ({
    locale: 'zh-CN',
    t: (key: string) => {
      const map: Record<string, string> = {
        'menu.favoriteTags': '\u6536\u85cf\u6807\u7b7e',
        'menu.blacklist': '\u9ed1\u540d\u5355',
      };
      return map[key] ?? key;
    },
  }),
}));

// mock child pages as simple placeholders
vi.mock('../../../src/renderer/pages/FavoriteTagsPage', () => ({
  FavoriteTagsPage: (props: any) => (
    <div data-testid="favorite-tags-page">
      FavoriteTagsPage{props.onTagClick ? ' (with onTagClick)' : ''}
    </div>
  ),
}));

vi.mock('../../../src/renderer/pages/BlacklistedTagsPage', () => ({
  BlacklistedTagsPage: () => <div data-testid="blacklisted-tags-page">BlacklistedTagsPage</div>,
}));

import { BooruTagManagementPage } from '../../../src/renderer/pages/BooruTagManagementPage';

describe('BooruTagManagementPage', () => {
  afterEach(() => cleanup());

  it('should show favorite-tags tab by default', async () => {
    render(<BooruTagManagementPage />);
    // Wait for React.lazy to resolve
    const favPage = await screen.findByTestId('favorite-tags-page');
    expect(favPage).toBeTruthy();
    // Blacklisted-tags page should be hidden (display:none container)
    const blPage = await screen.findByTestId('blacklisted-tags-page');
    const blContainer = blPage.parentElement!;
    expect(blContainer.style.display).toBe('none');
  });

  it('should show blacklist tab when defaultTab="blacklist"', async () => {
    render(<BooruTagManagementPage defaultTab="blacklist" />);
    const favPage = await screen.findByTestId('favorite-tags-page');
    const favContainer = favPage.parentElement!;
    expect(favContainer.style.display).toBe('none');
    const blPage = await screen.findByTestId('blacklisted-tags-page');
    const blContainer = blPage.parentElement!;
    expect(blContainer.style.display).toBe('');
  });

  it('should switch to blacklist tab on click', async () => {
    const user = userEvent.setup();
    render(<BooruTagManagementPage />);
    // Wait for loading
    await screen.findByTestId('favorite-tags-page');
    // Click blacklist tab
    await user.click(screen.getByText('\u9ed1\u540d\u5355'));
    // Favorite-tags page should be hidden
    await waitFor(() => {
      const favContainer = screen.getByTestId('favorite-tags-page').parentElement!;
      expect(favContainer.style.display).toBe('none');
    });
    // Blacklisted-tags page should be visible
    const blContainer = screen.getByTestId('blacklisted-tags-page').parentElement!;
    expect(blContainer.style.display).toBe('');
  });

  it('should pass onTagClick to FavoriteTagsPage', async () => {
    const handleTagClick = vi.fn();
    render(<BooruTagManagementPage onTagClick={handleTagClick} />);
    expect(await screen.findByText(/with onTagClick/)).toBeTruthy();
  });
});
