/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { App } from 'antd';
import { GoogleDrivePage } from '../../../src/renderer/pages/GoogleDrivePage';
import { GooglePhotosPage } from '../../../src/renderer/pages/GooglePhotosPage';
import { GeminiPage } from '../../../src/renderer/pages/GeminiPage';

const openExternal = vi.fn();

function renderWithApp(node: React.ReactElement) {
  return render(<App>{node}</App>);
}

describe('Google embedded pages error fallback', () => {
  beforeEach(() => {
    openExternal.mockReset();

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return false; },
      }),
    });

    (window as any).electronAPI = {
      system: {
        openExternal,
      },
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('GoogleDrivePage webview 加载失败时应显示错误态、重试按钮和外部打开退路', async () => {
    const { container } = renderWithApp(<GoogleDrivePage />);
    const webview = container.querySelector('webview') as any;
    expect(webview).toBeTruthy();
    webview.reload = vi.fn();

    fireEvent(webview, new Event('did-fail-load'));

    expect(await screen.findByText('Google Drive 加载失败')).toBeTruthy();
    expect(screen.getByRole('button', { name: /重\s*试/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '在外部浏览器打开' }));
    expect(openExternal).toHaveBeenCalledWith('https://drive.google.com');

    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(webview.reload).toHaveBeenCalledTimes(1);

    fireEvent(webview, new Event('did-fail-load'));
    expect(await screen.findByRole('button', { name: '在外部浏览器打开' })).toBeTruthy();
  });

  it('GooglePhotosPage webview 加载失败时应显示错误态、重试按钮和外部打开退路', async () => {
    const { container } = renderWithApp(<GooglePhotosPage />);
    const webview = container.querySelector('webview') as any;
    expect(webview).toBeTruthy();
    webview.reload = vi.fn();

    fireEvent(webview, new Event('did-fail-load'));

    expect(await screen.findByText('Google Photos 加载失败')).toBeTruthy();
    expect(screen.getByRole('button', { name: /重\s*试/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '在外部浏览器打开' }));
    expect(openExternal).toHaveBeenCalledWith('https://photos.google.com');

    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(webview.reload).toHaveBeenCalledTimes(1);

    fireEvent(webview, new Event('did-fail-load'));
    expect(await screen.findByRole('button', { name: '在外部浏览器打开' })).toBeTruthy();
  });

  it('GeminiPage webview 加载失败时应显示错误态、重试按钮和外部打开退路', async () => {
    const { container } = renderWithApp(<GeminiPage />);
    const webview = container.querySelector('webview') as any;
    expect(webview).toBeTruthy();
    webview.reload = vi.fn();

    fireEvent(webview, new Event('did-fail-load'));

    expect(await screen.findByText('Gemini 加载失败')).toBeTruthy();
    expect(screen.getByRole('button', { name: /重\s*试/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '在外部浏览器打开' }));
    expect(openExternal).toHaveBeenCalledWith('https://gemini.google.com');

    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(webview.reload).toHaveBeenCalledTimes(1);

    fireEvent(webview, new Event('did-fail-load'));
    expect(await screen.findByRole('button', { name: '在外部浏览器打开' })).toBeTruthy();
  });
});
