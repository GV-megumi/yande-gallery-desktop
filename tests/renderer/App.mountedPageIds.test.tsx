/** @vitest-environment jsdom */

/**
 * bug1: 测试 mountedPageIds 统一缓存层行为
 *
 * 三条核心路径：
 * 1. 一级菜单切回某 section 时，若当前 subKey 命中 pin 列表 → 恢复 pin 缓存
 *    （反模式守卫：旧代码 onSelect 一刀切 setActivePinnedId(null)，哪怕命中 pin 也不恢复）
 * 2. 三个 section 各自的"当前页"都保留挂载（display:none 切换，不卸载）
 * 3. 同 section 切换 subKey 后，旧 subKey 若非 pin 应被释放（出 mountedPageIds）
 *
 * 实现思路：通过 DOM 断言（Option B）——每个 mountedPageIds 条目在渲染层里对应
 * 一个 `.ios-page-enter` div 包装，通过观察它的 `style.display` 断言激活状态，
 * 通过观察它是否存在断言挂载状态。
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
        'menu.popular': '热门',
        'menu.forums': '论坛',
        'menu.recent': '最近',
        'menu.all': '全部',
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
  }: {
    items: Array<{ key: string; label?: React.ReactNode }>;
    selectedKey: string;
    onSelect: (key: string) => void;
    onReorder?: (keys: string[]) => void;
    onPinToggle?: (key: string, current: boolean) => void;
    pinnedKeys?: string[];
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
      <div data-testid={testId}>
        {items.map((item) => (
          <button
            key={item.key}
            data-testid={`${testId}-${item.key}`}
            data-selected={String(selectedKey === item.key)}
            onClick={() => onSelect(item.key)}
          >
            {typeof item.label === 'string' ? item.label : item.key}
          </button>
        ))}
      </div>
    );
  },
}));

/**
 * mount 次数计数器：每条实例 mount/unmount 通过 useEffect 记录，用来侧面验证
 * 切换回来时页面没有被重新挂载（命中缓存）。
 */
const mountCounts: Record<string, number> = {};
const resetMountCounts = () => {
  for (const k of Object.keys(mountCounts)) delete mountCounts[k];
};

function makeCountedPage(testId: string) {
  return function CountedPage() {
    React.useEffect(() => {
      mountCounts[testId] = (mountCounts[testId] ?? 0) + 1;
    }, []);
    return <div data-testid={testId}>{testId}</div>;
  };
}

vi.mock('../../src/renderer/pages/GalleryPage', () => ({
  GalleryPage: ({ subTab }: { subTab?: string }) => {
    const testId = `gallery-page-${subTab ?? 'none'}`;
    React.useEffect(() => {
      mountCounts[testId] = (mountCounts[testId] ?? 0) + 1;
    }, []);
    return <div data-testid={testId}>gallery:{subTab ?? 'none'}</div>;
  },
}));

vi.mock('../../src/renderer/pages/BooruPage', () => ({
  BooruPage: makeCountedPage('booru-page'),
}));

vi.mock('../../src/renderer/pages/BooruPopularPage', () => ({
  BooruPopularPage: makeCountedPage('booru-popular-page'),
}));

vi.mock('../../src/renderer/pages/BooruForumPage', () => ({
  BooruForumPage: makeCountedPage('booru-forum-page'),
}));

vi.mock('../../src/renderer/pages/BooruDownloadHubPage', () => ({
  BooruDownloadHubPage: makeCountedPage('download-hub-page'),
}));

vi.mock('../../src/renderer/pages/BooruTagManagementPage', () => ({
  BooruTagManagementPage: makeCountedPage('tag-management-page'),
}));

vi.mock('../../src/renderer/pages/GoogleDrivePage', () => ({
  GoogleDrivePage: makeCountedPage('google-drive-page'),
}));

describe('App mountedPageIds cache behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMountCounts();
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
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('一级菜单切回 booru 时，若当前 subKey 是 pin 应恢复 pin 缓存（反模式守卫）', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');

    // 预置：booru:posts 在 pin 列表里
    (window as any).electronAPI.pagePreferences.appShell.get = vi.fn().mockResolvedValue({
      success: true,
      data: {
        pinnedItems: [{ section: 'booru', key: 'posts' }],
      },
    });

    render(<App />);

    // 初始在 gallery
    await screen.findByTestId('gallery-page-recent');

    // 切到 booru（默认 subKey='posts'，命中 pin）
    await user.click(screen.getByTestId('main-menu-booru'));

    await waitFor(() => {
      expect(screen.getByTestId('booru-page')).toBeTruthy();
    });

    const booruContainer = screen.getByTestId('booru-page').closest('.ios-page-enter') as HTMLElement;
    expect(booruContainer.style.display).not.toBe('none');

    // 记录此时 booru-page 的 mount 次数
    const mountCountAfterFirstSwitch = mountCounts['booru-page'];
    expect(mountCountAfterFirstSwitch).toBeGreaterThan(0);

    // 切到 gallery
    await user.click(screen.getByTestId('main-menu-gallery'));

    await waitFor(() => {
      const galleryContainer = screen.getByTestId('gallery-page-recent').closest('.ios-page-enter') as HTMLElement;
      expect(galleryContainer.style.display).not.toBe('none');
    });

    // booru 页应仍挂载（display:none），mount 次数不变
    expect(screen.queryByTestId('booru-page')).not.toBeNull();
    expect(mountCounts['booru-page']).toBe(mountCountAfterFirstSwitch);

    // 切回 booru
    await user.click(screen.getByTestId('main-menu-booru'));

    await waitFor(() => {
      const container = screen.getByTestId('booru-page').closest('.ios-page-enter') as HTMLElement;
      expect(container.style.display).not.toBe('none');
    });

    // 关键断言：booru-page mount 次数仍不变 → 恢复 pin 缓存而非重新挂载
    expect(mountCounts['booru-page']).toBe(mountCountAfterFirstSwitch);
  });

  it('三个 section 各自的当前页都保留挂载（非 pin 也常驻）', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');

    render(<App />);

    // gallery:recent 初始激活
    await screen.findByTestId('gallery-page-recent');

    // 切到 booru
    await user.click(screen.getByTestId('main-menu-booru'));
    await waitFor(() => expect(screen.getByTestId('booru-page')).toBeTruthy());

    // 切回 gallery
    await user.click(screen.getByTestId('main-menu-gallery'));
    await waitFor(() => {
      const container = screen.getByTestId('gallery-page-recent').closest('.ios-page-enter') as HTMLElement;
      expect(container.style.display).not.toBe('none');
    });

    // gallery-recent 与 booru-page 两者都应仍挂载
    expect(screen.queryByTestId('gallery-page-recent')).not.toBeNull();
    expect(screen.queryByTestId('booru-page')).not.toBeNull();
    // 非激活的 booru-page 容器应被 display:none 隐藏
    const booruContainer = screen.getByTestId('booru-page').closest('.ios-page-enter') as HTMLElement;
    expect(booruContainer.style.display).toBe('none');
    // mount 次数都应为 1
    expect(mountCounts['gallery-page-recent']).toBe(1);
    expect(mountCounts['booru-page']).toBe(1);
  });

  it('同 section 切换 subKey 后，旧 subKey 若非 pin 应从 DOM 中卸载', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');

    render(<App />);

    await screen.findByTestId('gallery-page-recent');

    // 切到 booru：默认 posts
    await user.click(screen.getByTestId('main-menu-booru'));
    await waitFor(() => expect(screen.getByTestId('booru-page')).toBeTruthy());

    // 切到 forums（非 pin）
    await user.click(screen.getByTestId('booru-menu-forums'));
    await waitFor(() => expect(screen.getByTestId('booru-forum-page')).toBeTruthy());

    // booru-page（posts）应从 DOM 卸载（旧 subKey 出 mountedPageIds）
    expect(screen.queryByTestId('booru-page')).toBeNull();
    expect(screen.getByTestId('booru-forum-page')).toBeTruthy();

    // 再切到 popular（也非 pin）
    await user.click(screen.getByTestId('booru-menu-popular'));
    await waitFor(() => expect(screen.getByTestId('booru-popular-page')).toBeTruthy());

    // forums 也应被卸载
    expect(screen.queryByTestId('booru-forum-page')).toBeNull();
    expect(screen.getByTestId('booru-popular-page')).toBeTruthy();
  });

  it('同 section 切换 subKey 到 pin 项再切走，pin 项应保留缓存（display:none）', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');

    // 预置：booru:posts 在 pin 列表里
    (window as any).electronAPI.pagePreferences.appShell.get = vi.fn().mockResolvedValue({
      success: true,
      data: {
        pinnedItems: [{ section: 'booru', key: 'posts' }],
      },
    });

    render(<App />);

    await screen.findByTestId('gallery-page-recent');

    await user.click(screen.getByTestId('main-menu-booru'));
    await waitFor(() => expect(screen.getByTestId('booru-page')).toBeTruthy());
    const postsMountCount = mountCounts['booru-page'];

    // 切到 forums（非 pin），应释放非 pin 旧 subKey 会被释放，
    // 但 booru:posts 是 pin，切到 forums 时 posts 应仍保留（在 mountedPageIds 里）
    await user.click(screen.getByTestId('booru-menu-forums'));
    await waitFor(() => expect(screen.getByTestId('booru-forum-page')).toBeTruthy());

    // posts 页应仍挂载（因为是 pin）
    expect(screen.queryByTestId('booru-page')).not.toBeNull();
    // 但其容器应被隐藏
    const postsContainer = screen.getByTestId('booru-page').closest('.ios-page-enter') as HTMLElement;
    expect(postsContainer.style.display).toBe('none');
    // mount 次数不变
    expect(mountCounts['booru-page']).toBe(postsMountCount);
  });
});
