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
        'menu.downloads': '\u4e0b\u8f7d\u7ba1\u7406',
        'menu.bulkDownload': '\u6279\u91cf\u4e0b\u8f7d',
      };
      return map[key] ?? key;
    },
  }),
}));

const booruDownloadPageSpy = vi.fn(({ active }: { active?: boolean }) => (
  <div data-testid="download-page" data-active={String(Boolean(active))}>BooruDownloadPage</div>
));
const booruBulkDownloadPageSpy = vi.fn(({ active }: { active?: boolean }) => (
  <div data-testid="bulk-download-page" data-active={String(Boolean(active))}>BooruBulkDownloadPage</div>
));

// mock child pages as simple placeholders
vi.mock('../../../src/renderer/pages/BooruDownloadPage', () => ({
  default: (props: { active?: boolean }) => booruDownloadPageSpy(props),
  BooruDownloadPage: (props: { active?: boolean }) => booruDownloadPageSpy(props),
}));

vi.mock('../../../src/renderer/pages/BooruBulkDownloadPage', () => ({
  default: (props: { active?: boolean }) => booruBulkDownloadPageSpy(props),
  BooruBulkDownloadPage: (props: { active?: boolean }) => booruBulkDownloadPageSpy(props),
}));

import { BooruDownloadHubPage } from '../../../src/renderer/pages/BooruDownloadHubPage';

describe('BooruDownloadHubPage', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('should show downloads tab by default', async () => {
    render(<BooruDownloadHubPage />);
    // Wait for React.lazy to resolve
    const dlPage = await screen.findByTestId('download-page');
    expect(dlPage).toBeTruthy();
    // Bulk download should be hidden
    const bulkPage = await screen.findByTestId('bulk-download-page');
    const bulkContainer = bulkPage.parentElement!;
    expect(bulkContainer.style.display).toBe('none');
  });

  it('should show bulk-download tab when defaultTab="bulk"', async () => {
    render(<BooruDownloadHubPage defaultTab="bulk" />);
    const dlPage = await screen.findByTestId('download-page');
    const dlContainer = dlPage.parentElement!;
    expect(dlContainer.style.display).toBe('none');
    const bulkPage = await screen.findByTestId('bulk-download-page');
    const bulkContainer = bulkPage.parentElement!;
    expect(bulkContainer.style.display).toBe('');
  });

  it('should switch to bulk-download tab on click', async () => {
    const user = userEvent.setup();
    render(<BooruDownloadHubPage />);
    // Wait for loading
    await screen.findByTestId('download-page');
    // Click bulk download tab
    await user.click(screen.getByText('\u6279\u91cf\u4e0b\u8f7d'));
    await waitFor(() => {
      const dlContainer = screen.getByTestId('download-page').parentElement!;
      expect(dlContainer.style.display).toBe('none');
    });
    const bulkContainer = screen.getByTestId('bulk-download-page').parentElement!;
    expect(bulkContainer.style.display).toBe('');
  });

  it('should pass active flag so hidden pages can stop side effects', async () => {
    const user = userEvent.setup();
    render(<BooruDownloadHubPage />);

    expect(await screen.findByTestId('download-page')).toBeTruthy();
    expect(screen.getByTestId('download-page').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('bulk-download-page').getAttribute('data-active')).toBe('false');

    await user.click(screen.getByText('\u6279\u91cf\u4e0b\u8f7d'));

    await waitFor(() => {
      expect(screen.getByTestId('download-page').getAttribute('data-active')).toBe('false');
      expect(screen.getByTestId('bulk-download-page').getAttribute('data-active')).toBe('true');
    });
  });
});
