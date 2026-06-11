/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.setConfig({ testTimeout: 90000 });

vi.mock('../../src/renderer/hooks/useTheme', () => ({
  useTheme: () => ({
    isDark: false,
    themeMode: 'light',
    setThemeMode: vi.fn(),
  }),
}));

vi.mock('../../src/renderer/locales', () => ({
  useLocale: () => ({
    locale: 'zh-CN',
    t: (key: string) => {
      const map: Record<string, string> = {
        'menu.gallery': '图库',
        'menu.booru': 'Booru',
        'menu.browse': '浏览',
        'menu.posts': '帖子',
        'menu.recent': '最近',
        'pageTitle.gallery': '图库',
        'pageTitle.booru': 'Booru',
        'app.initializing': '初始化中',
        'menu.settings': '设置',
        'shortcuts.toggleTheme': 'toggle theme',
        'shortcuts.openSettings': 'open settings',
        'shortcuts.focusSearch': 'focus search',
        'shortcuts.showShortcuts': 'show shortcuts',
        'shortcuts.goBack': 'go back',
        'app.lightMode': '浅色',
        'app.darkMode': '深色',
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock('../../src/renderer/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: () => undefined,
  SHORTCUT_KEYS: {
    TOGGLE_THEME: 'toggle-theme',
    OPEN_SETTINGS: 'open-settings',
    FOCUS_SEARCH: 'focus-search',
    SHOW_SHORTCUTS: 'show-shortcuts',
    GO_BACK: 'go-back',
  },
}));

vi.mock('../../src/renderer/components/ShortcutsModal', () => ({
  ShortcutsModal: () => null,
}));

vi.mock('../../src/renderer/components/SortableMenu', () => ({
  SortableMenu: ({
    items,
    selectedKey,
    onSelect,
    onReorder,
    onPinToggle,
    pinnedKeys,
    onQuickToggle,
    quickKeys,
  }: {
    items: Array<{ key: string; label?: React.ReactNode }>;
    selectedKey: string;
    onSelect: (key: string) => void;
    onReorder?: (keys: string[]) => void;
    onPinToggle?: (key: string, current: boolean) => void;
    pinnedKeys?: string[];
    onQuickToggle?: (key: string, current: boolean) => void;
    quickKeys?: string[];
  }) => {
    const keys = items.map((item) => item.key);
    const testId = keys.includes('gallery') && keys.includes('booru')
      ? 'main-menu'
      : keys.includes('recent')
        ? 'gallery-menu'
        : keys.includes('posts')
          ? 'booru-menu'
          : keys.includes('gdrive')
            ? 'google-menu'
            : 'generic-menu';

    return (
      <div data-testid={testId} data-order={items.map((item) => item.key).join(',')}>
        {items.map((item) => {
          const pinned = pinnedKeys?.includes(item.key) ?? false;
          return (
            <div key={item.key}>
              <button
                data-testid={`${testId}-${item.key}`}
                data-selected={String(selectedKey === item.key)}
                onClick={() => onSelect(item.key)}
              >
                {typeof item.label === 'string' ? item.label : item.key}
              </button>
              {onReorder ? (
                <button
                  data-testid={`${testId}-${item.key}-move-first`}
                  onClick={() => onReorder([item.key, ...keys.filter((key) => key !== item.key)])}
                >
                  move-first
                </button>
              ) : null}
              {onPinToggle ? (
                <button
                  data-testid={`${testId}-${item.key}-pin`}
                  onClick={() => onPinToggle(item.key, pinned)}
                >
                  {pinned ? 'unpin' : 'pin'}
                </button>
              ) : null}
              {onQuickToggle ? (
                <button
                  data-testid={`${testId}-${item.key}-quick`}
                  onClick={() => onQuickToggle(item.key, (quickKeys ?? []).includes(item.key))}
                >
                  {(quickKeys ?? []).includes(item.key) ? 'unquick' : 'quick'}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  },
}));

vi.mock('../../src/renderer/pages/GalleryPage', () => ({
  GalleryPage: ({ subTab }: { subTab?: string }) => <div data-testid="gallery-page">gallery:{subTab ?? 'none'}</div>,
}));

vi.mock('../../src/renderer/pages/BooruPage', () => ({
  BooruPage: () => <div data-testid="booru-page">booru</div>,
}));

vi.mock('../../src/renderer/pages/BooruDownloadHubPage', () => ({
  BooruDownloadHubPage: ({ active }: { active?: boolean }) => (
    <div data-testid="download-hub-page" data-active={String(active)}>download-hub</div>
  ),
}));

vi.mock('../../src/renderer/pages/BooruTagManagementPage', () => ({
  BooruTagManagementPage: ({ active }: { active?: boolean }) => (
    <div data-testid="tag-management-page" data-active={String(active)}>tag-management</div>
  ),
}));

vi.mock('../../src/renderer/pages/GoogleDrivePage', () => ({
  GoogleDrivePage: () => <div data-testid="google-drive-page">google-drive</div>,
}));

vi.mock('../../src/renderer/pages/SettingsPage', () => ({
  SettingsPage: () => <div data-testid="settings-page">settings</div>,
}));

describe('App navigation synchronization', () => {
  let appEventCallback: ((event: any) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    appEventCallback = undefined;
    (window as any).electronAPI = {
      db: {
        init: vi.fn().mockResolvedValue({ success: true }),
      },
      config: {
        get: vi.fn().mockResolvedValue({ success: true, data: {} }),
        save: vi.fn().mockResolvedValue({ success: true }),
      },
      pagePreferences: {
        appShell: {
          get: vi.fn().mockResolvedValue({ success: true, data: {} }),
          save: vi.fn().mockResolvedValue({ success: true }),
        },
      },
      window: {
        openSecondaryMenu: vi.fn(),
      },
      system: {
        onAppEvent: vi.fn((callback) => {
          appEventCallback = callback;
          return vi.fn();
        }),
      },
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('应用初始化时应通过 pagePreferences.appShell 恢复菜单与固定项，且不再读取整包 config', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');
    const appShellGet = (window as any).electronAPI.pagePreferences.appShell.get as ReturnType<typeof vi.fn>;
    const configGet = (window as any).electronAPI.config.get as ReturnType<typeof vi.fn>;

    appShellGet.mockResolvedValue({
      success: true,
      data: {
        menuOrder: {
          main: ['booru', 'gallery', 'google'],
          booru: ['download', 'posts', 'settings'],
        },
        pinnedItems: [{ section: 'google', key: 'gdrive' }],
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Drive')).toBeTruthy();
    });

    expect(appShellGet).toHaveBeenCalledTimes(1);
    expect(configGet).not.toHaveBeenCalled();

    // 一级菜单只切换侧边栏列表；点击二级菜单才切换内容
    await user.click(screen.getByTestId('main-menu-booru'));
    await waitFor(() => {
      expect(screen.queryByTestId('booru-menu-posts')).not.toBeNull();
    });
    await user.click(screen.getByTestId('booru-menu-posts'));

    await waitFor(() => {
      expect(screen.getByTestId('booru-menu-posts').getAttribute('data-selected')).toBe('true');
    });

    await waitFor(() => {
      expect(screen.getByTestId('booru-page')).toBeTruthy();
    });
  });

  it('接收 app shell 配置变更事件后应重新读取菜单偏好', async () => {
    const { App } = await import('../../src/renderer/App');
    const appShellGet = (window as any).electronAPI.pagePreferences.appShell.get as ReturnType<typeof vi.fn>;

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('main-menu').getAttribute('data-order')).toBe('gallery,booru,google');
    });
    expect(appShellGet).toHaveBeenCalledTimes(1);

    appShellGet.mockResolvedValueOnce({
      success: true,
      data: {
        menuOrder: {
          main: ['google', 'gallery', 'booru'],
        },
      },
    });

    await act(async () => {
      appEventCallback?.({
        type: 'config:changed',
        version: 1,
        occurredAt: '2026-06-09T00:00:00.000Z',
        source: 'configService',
        payload: { version: 2, sections: ['ui.pagePreferences.appShell'] },
      });
    });

    await waitFor(() => {
      expect(appShellGet).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByTestId('main-menu').getAttribute('data-order')).toBe('google,gallery,booru');
    });
  });

  it('设置是全局页面：打开设置后点击一级菜单应回到该分区上次的二级页', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');

    render(<App />);

    // 初始在图库：最近
    await waitFor(() => {
      expect(screen.getByTestId('gallery-page')).toBeTruthy();
    });

    // 打开底部全局设置入口
    await user.click(screen.getByText('设置'));
    await waitFor(() => {
      expect(screen.getByTestId('settings-page')).toBeTruthy();
    });

    // 一级菜单只切换侧边栏列表，设置页保持打开
    await user.click(screen.getByTestId('main-menu-gallery'));
    expect(screen.getByTestId('settings-page')).toBeTruthy();

    // 点击二级菜单才真正导航：关闭设置并回到图库最近，而不是停留在设置
    await user.click(screen.getByTestId('gallery-menu-recent'));
    await waitFor(() => {
      expect(screen.queryByTestId('settings-page')).toBeNull();
    });
    expect(screen.getByTestId('gallery-page')).toBeTruthy();
    expect(screen.getByTestId('gallery-menu-recent').getAttribute('data-selected')).toBe('true');
  });

  it('一级菜单只切换二级菜单列表，点击二级菜单才切换内容', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');

    render(<App />);

    expect((await screen.findByTestId('gallery-page')).textContent).toContain('gallery:recent');

    // 点一级菜单 Booru：仅侧边栏二级列表切换，内容仍是图库
    await user.click(screen.getByTestId('main-menu-booru'));
    await waitFor(() => {
      expect(screen.queryByTestId('booru-menu-posts')).not.toBeNull();
    });
    expect(screen.queryByTestId('booru-page')).toBeNull();
    const galleryContainer = screen.getByTestId('gallery-page').closest('.ios-page-enter') as HTMLElement;
    expect(galleryContainer.style.display).not.toBe('none');

    // 点二级菜单 帖子：才真正切换内容
    await user.click(screen.getByTestId('booru-menu-posts'));
    await waitFor(() => {
      expect(screen.getByTestId('booru-page')).toBeTruthy();
    });
    expect(screen.getByTestId('booru-menu-posts').getAttribute('data-selected')).toBe('true');
    // 图库页保持挂载但容器 display:none 隐藏
    expect(galleryContainer.style.display).toBe('none');
    const booruContainer = screen.getByTestId('booru-page').closest('.ios-page-enter') as HTMLElement;
    expect(booruContainer.style.display).not.toBe('none');
  });

  it('快捷访问项点击应直达对应页面', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');

    (window as any).electronAPI.pagePreferences.appShell.get = vi.fn().mockResolvedValue({
      success: true,
      data: { pinnedItems: [], quickAccessItems: [{ section: 'booru', key: 'posts' }] },
    });

    render(<App />);

    await screen.findByTestId('gallery-page');

    // 底部快捷访问渲染"帖子"入口（此时 booru 二级菜单未显示，文本唯一）
    const quickEntry = await screen.findByText('帖子');
    await user.click(quickEntry);

    await waitFor(() => {
      expect(screen.getByTestId('booru-page')).toBeTruthy();
    });
    // 导航语义：侧边栏切到 booru 列表且 posts 选中
    await waitFor(() => {
      expect(screen.getByTestId('booru-menu-posts').getAttribute('data-selected')).toBe('true');
    });
  });

  it('添加快捷访问应保存 quickAccessItems 并渲染到底部快捷栏', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');
    const appShellSave = (window as any).electronAPI.pagePreferences.appShell.save as ReturnType<typeof vi.fn>;

    render(<App />);

    await user.click(await screen.findByTestId('main-menu-google'));
    await user.click(screen.getByTestId('google-menu-gdrive-quick'));

    await waitFor(() => {
      expect(appShellSave).toHaveBeenCalledWith({ quickAccessItems: [{ section: 'google', key: 'gdrive' }] });
    });
    // google 二级菜单和底部快捷栏各有一份 Drive 文本
    await waitFor(() => {
      expect(screen.getAllByText('Drive').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('固定项状态变化时应通过 pagePreferences.appShell 保存，且不再写整包 config', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');
    const appShellSave = (window as any).electronAPI.pagePreferences.appShell.save as ReturnType<typeof vi.fn>;
    const configSave = (window as any).electronAPI.config.save as ReturnType<typeof vi.fn>;

    render(<App />);

    await user.click(await screen.findByTestId('main-menu-google'));
    await user.click(screen.getByTestId('google-menu-gdrive-pin'));

    await waitFor(() => {
      expect(appShellSave).toHaveBeenCalledWith({ pinnedItems: [{ section: 'google', key: 'gdrive' }] });
    });
    expect(configSave).not.toHaveBeenCalled();
  });

  it('固定页面覆盖普通内容时，底层 download hub 应收到 inactive 以停止隐藏副作用', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');

    (window as any).electronAPI.pagePreferences.appShell.get = vi.fn().mockResolvedValue({
      success: true,
      data: {
        pinnedItems: [{ section: 'google', key: 'gdrive' }],
      },
    });

    render(<App />);

    await user.click(await screen.findByTestId('main-menu-booru'));
    await user.click(screen.getByTestId('booru-menu-download'));

    await waitFor(() => {
      expect(screen.getByTestId('download-hub-page').getAttribute('data-active')).toBe('true');
    });

    await user.click(screen.getByText('Drive'));

    await waitFor(() => {
      expect(screen.getByTestId('google-drive-page')).toBeTruthy();
    });

    expect(screen.getByTestId('download-hub-page').getAttribute('data-active')).toBe('false');
  });

  it('固定页面覆盖普通内容时，底层 tag management 应收到 inactive 以停止隐藏副作用', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');

    (window as any).electronAPI.pagePreferences.appShell.get = vi.fn().mockResolvedValue({
      success: true,
      data: {
        pinnedItems: [{ section: 'google', key: 'gdrive' }],
      },
    });

    render(<App />);

    await user.click(await screen.findByTestId('main-menu-booru'));
    await user.click(screen.getByTestId('booru-menu-tag-management'));

    await waitFor(() => {
      expect(screen.getByTestId('tag-management-page').getAttribute('data-active')).toBe('true');
    });

    await user.click(screen.getByText('Drive'));

    await waitFor(() => {
      expect(screen.getByTestId('google-drive-page')).toBeTruthy();
    });

    expect(screen.getByTestId('tag-management-page').getAttribute('data-active')).toBe('false');
  });

  it('固定项迁移应完成旧 key 映射与去重，且不丢失后续唯一项', async () => {
    const { App } = await import('../../src/renderer/App');
    const appShellSave = (window as any).electronAPI.pagePreferences.appShell.save as ReturnType<typeof vi.fn>;

    (window as any).electronAPI.pagePreferences.appShell.get = vi.fn().mockResolvedValue({
      success: true,
      data: {
        pinnedItems: [
          { section: 'booru', key: 'favorite-tags' },
          { section: 'booru', key: 'tag-management' },
          { section: 'booru', key: 'downloads' },
          { section: 'booru', key: 'download' },
          { section: 'booru', key: 'bulk-download' },
          { section: 'google', key: 'gdrive' },
          { section: 'google', key: 'gphotos' },
          { section: 'booru', key: 'saved-searches' },
        ],
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(appShellSave).toHaveBeenCalledWith({
        pinnedItems: [
          { section: 'booru', key: 'tag-management', defaultTab: 'favorite' },
          { section: 'booru', key: 'download', defaultTab: 'downloads' },
          { section: 'google', key: 'gdrive' },
          { section: 'google', key: 'gphotos' },
          { section: 'booru', key: 'saved-searches' },
        ],
      });
    });
  });

  it('菜单排序保存返回 success false 时不应继续显示未保存的新顺序', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');
    const appShellSave = (window as any).electronAPI.pagePreferences.appShell.save as ReturnType<typeof vi.fn>;

    appShellSave.mockResolvedValueOnce({ success: false, error: 'save failed' });

    render(<App />);

    expect((await screen.findByTestId('main-menu')).getAttribute('data-order')).toBe('gallery,booru,google');

    await user.click(screen.getByTestId('main-menu-booru-move-first'));

    await waitFor(() => {
      expect(appShellSave).toHaveBeenCalledWith({
        menuOrder: {
          main: ['booru', 'gallery', 'google'],
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('main-menu').getAttribute('data-order')).toBe('gallery,booru,google');
    });
  });

  it('固定项保存返回 success false 时应回滚固定状态', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');
    const appShellSave = (window as any).electronAPI.pagePreferences.appShell.save as ReturnType<typeof vi.fn>;

    appShellSave.mockResolvedValueOnce({ success: false, error: 'save failed' });

    render(<App />);

    await user.click(await screen.findByTestId('main-menu-google'));
    expect(screen.getByTestId('google-menu-gdrive-pin').textContent).toBe('pin');

    await user.click(screen.getByTestId('google-menu-gdrive-pin'));

    await waitFor(() => {
      expect(appShellSave).toHaveBeenCalledWith({ pinnedItems: [{ section: 'google', key: 'gdrive' }] });
    });

    await waitFor(() => {
      expect(screen.getByTestId('google-menu-gdrive-pin').textContent).toBe('pin');
    });
  });

  it('取消固定保存返回 success false 时应回滚固定状态', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');
    const appShellSave = (window as any).electronAPI.pagePreferences.appShell.save as ReturnType<typeof vi.fn>;

    (window as any).electronAPI.pagePreferences.appShell.get = vi.fn().mockResolvedValue({
      success: true,
      data: {
        pinnedItems: [{ section: 'booru', key: 'download' }],
        // 显式给出快捷访问，避免首次迁移的保存调用消耗下面的失败 mock
        quickAccessItems: [],
      },
    });
    appShellSave.mockResolvedValueOnce({ success: false, error: 'save failed' });

    render(<App />);

    await user.click(await screen.findByTestId('main-menu-booru'));
    await user.click(screen.getByTestId('booru-menu-download'));

    await waitFor(() => {
      expect(screen.getByTestId('booru-menu-download').getAttribute('data-selected')).toBe('true');
    });
    expect(screen.getByTestId('booru-menu-download-pin').textContent).toBe('unpin');

    await user.click(screen.getByTestId('booru-menu-download-pin'));

    await waitFor(() => {
      expect(appShellSave).toHaveBeenCalledWith({ pinnedItems: [] });
    });

    // 保存失败 → 回滚为固定态；页面保持活跃
    await waitFor(() => {
      expect(screen.getByTestId('booru-menu-download-pin').textContent).toBe('unpin');
    });
    expect(screen.getAllByTestId('download-hub-page').some((node) => node.getAttribute('data-active') === 'true')).toBe(true);
  });

  it('菜单排序保存失败时不应继续显示未保存的新顺序', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');
    const appShellSave = (window as any).electronAPI.pagePreferences.appShell.save as ReturnType<typeof vi.fn>;

    appShellSave.mockRejectedValueOnce(new Error('save failed'));

    render(<App />);

    expect((await screen.findByTestId('main-menu')).getAttribute('data-order')).toBe('gallery,booru,google');

    await user.click(screen.getByTestId('main-menu-booru-move-first'));

    await waitFor(() => {
      expect(appShellSave).toHaveBeenCalledWith({
        menuOrder: {
          main: ['booru', 'gallery', 'google'],
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('main-menu').getAttribute('data-order')).toBe('gallery,booru,google');
    });
  });
});
