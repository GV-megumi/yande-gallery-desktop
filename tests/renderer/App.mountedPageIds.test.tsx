/** @vitest-environment jsdom */

/**
 * bug1: 测试 mountedPageIds 统一缓存层行为
 *
 * 核心路径（新导航模型：一级菜单只切侧边栏列表，二级菜单点击才导航）：
 * 1. 固定（保活）页切走再切回应命中缓存，不重新挂载
 * 2. 三个 section 各自的"当前页"都保留挂载（display:none 切换，不卸载）
 * 3. 同 section 切换 subKey 后，旧 subKey 若非固定应被释放（出 mountedPageIds）
 * 4. 关闭页面缓存：命中当前页时守卫跳过；非当前固定页应被卸载
 *
 * 实现思路：通过 DOM 断言（Option B）——每个 mountedPageIds 条目在渲染层里对应
 * 一个 `.ios-page-enter` div 包装，通过观察它的 `style.display` 断言激活状态，
 * 通过观察它是否存在断言挂载状态。
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    onClosePage,
  }: {
    items: Array<{ key: string; label?: React.ReactNode }>;
    selectedKey: string;
    onSelect: (key: string) => void;
    onReorder?: (keys: string[]) => void;
    onPinToggle?: (key: string, current: boolean) => void;
    pinnedKeys?: string[];
    onClosePage?: (key: string) => void;
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
          <React.Fragment key={item.key}>
            <button
              data-testid={`${testId}-${item.key}`}
              data-selected={String(selectedKey === item.key)}
              onClick={() => onSelect(item.key)}
            >
              {typeof item.label === 'string' ? item.label : item.key}
            </button>
            {onClosePage ? (
              <button
                data-testid={`${testId}-${item.key}-close`}
                onClick={() => onClosePage(item.key)}
              >
                close
              </button>
            ) : null}
          </React.Fragment>
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

/**
 * GalleryPage mock：
 *  - 记录 mount 次数（缓存行为测试）
 *  - 记录每次 render 时的 suspended prop（bug1-I2 验证 App.tsx 按 !isActive 传）
 */
const galleryPageSuspendedLog: Array<{ subTab: string; suspended: boolean }> = [];
const resetSuspendedLog = () => { galleryPageSuspendedLog.length = 0; };

vi.mock('../../src/renderer/pages/GalleryPage', () => ({
  GalleryPage: ({ subTab, suspended }: { subTab?: string; suspended?: boolean }) => {
    const testId = `gallery-page-${subTab ?? 'none'}`;
    React.useEffect(() => {
      mountCounts[testId] = (mountCounts[testId] ?? 0) + 1;
    }, []);
    galleryPageSuspendedLog.push({ subTab: subTab ?? 'none', suspended: !!suspended });
    return (
      <div data-testid={testId} data-suspended={suspended ? 'true' : 'false'}>
        gallery:{subTab ?? 'none'}
      </div>
    );
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

// bug1 Issue3：记录 BooruDownloadHubPage / BooruTagManagementPage 的 defaultTab
// 以便断言 pin 上的 defaultTab 被 App.tsx 透传下来。
const downloadHubProps: Array<{ defaultTab?: string; active?: boolean }> = [];
const tagMgmtProps: Array<{ defaultTab?: string; active?: boolean }> = [];
const resetDefaultTabLogs = () => {
  downloadHubProps.length = 0;
  tagMgmtProps.length = 0;
};

vi.mock('../../src/renderer/pages/BooruDownloadHubPage', () => ({
  BooruDownloadHubPage: (props: { defaultTab?: string; active?: boolean }) => {
    React.useEffect(() => {
      mountCounts['download-hub-page'] = (mountCounts['download-hub-page'] ?? 0) + 1;
    }, []);
    downloadHubProps.push({ defaultTab: props.defaultTab, active: props.active });
    return (
      <div data-testid="download-hub-page" data-default-tab={props.defaultTab ?? ''}>
        download-hub:{props.defaultTab ?? 'undef'}
      </div>
    );
  },
}));

vi.mock('../../src/renderer/pages/BooruTagManagementPage', () => ({
  BooruTagManagementPage: (props: { defaultTab?: string; active?: boolean }) => {
    React.useEffect(() => {
      mountCounts['tag-management-page'] = (mountCounts['tag-management-page'] ?? 0) + 1;
    }, []);
    tagMgmtProps.push({ defaultTab: props.defaultTab, active: props.active });
    return (
      <div data-testid="tag-management-page" data-default-tab={props.defaultTab ?? ''}>
        tag-management:{props.defaultTab ?? 'undef'}
      </div>
    );
  },
}));

vi.mock('../../src/renderer/pages/GoogleDrivePage', () => ({
  GoogleDrivePage: makeCountedPage('google-drive-page'),
}));

describe('App mountedPageIds cache behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMountCounts();
    resetSuspendedLog();
    resetDefaultTabLogs();
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

  it('固定页面切走再切回应命中缓存而非重新挂载', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');

    // 预置：booru:posts 被固定（保活）
    (window as any).electronAPI.pagePreferences.appShell.get = vi.fn().mockResolvedValue({
      success: true,
      data: {
        pinnedItems: [{ section: 'booru', key: 'posts' }],
        quickAccessItems: [],
      },
    });

    render(<App />);

    // 初始在 gallery
    await screen.findByTestId('gallery-page-recent');

    // 进入 booru:posts（一级菜单只切列表，需点二级菜单导航）
    await user.click(screen.getByTestId('main-menu-booru'));
    await user.click(await screen.findByTestId('booru-menu-posts'));

    await waitFor(() => {
      expect(screen.getByTestId('booru-page')).toBeTruthy();
    });

    const booruContainer = screen.getByTestId('booru-page').closest('.ios-page-enter') as HTMLElement;
    expect(booruContainer.style.display).not.toBe('none');

    // 记录此时 booru-page 的 mount 次数
    const mountCountAfterFirstSwitch = mountCounts['booru-page'];
    expect(mountCountAfterFirstSwitch).toBeGreaterThan(0);

    // 切到 gallery:recent
    await user.click(screen.getByTestId('main-menu-gallery'));
    await user.click(await screen.findByTestId('gallery-menu-recent'));

    await waitFor(() => {
      const galleryContainer = screen.getByTestId('gallery-page-recent').closest('.ios-page-enter') as HTMLElement;
      expect(galleryContainer.style.display).not.toBe('none');
    });

    // booru 页应仍挂载（固定保活，display:none），mount 次数不变
    expect(screen.queryByTestId('booru-page')).not.toBeNull();
    expect(mountCounts['booru-page']).toBe(mountCountAfterFirstSwitch);

    // 切回 booru:posts
    await user.click(screen.getByTestId('main-menu-booru'));
    await user.click(await screen.findByTestId('booru-menu-posts'));

    await waitFor(() => {
      const container = screen.getByTestId('booru-page').closest('.ios-page-enter') as HTMLElement;
      expect(container.style.display).not.toBe('none');
    });

    // 关键断言：booru-page mount 次数仍不变 → 命中缓存而非重新挂载
    expect(mountCounts['booru-page']).toBe(mountCountAfterFirstSwitch);
  });

  it('三个 section 各自的当前页都保留挂载（非 pin 也常驻）', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');

    render(<App />);

    // gallery:recent 初始激活
    await screen.findByTestId('gallery-page-recent');

    // 切到 booru:posts
    await user.click(screen.getByTestId('main-menu-booru'));
    await user.click(await screen.findByTestId('booru-menu-posts'));
    await waitFor(() => expect(screen.getByTestId('booru-page')).toBeTruthy());

    // 切回 gallery:recent
    await user.click(screen.getByTestId('main-menu-gallery'));
    await user.click(await screen.findByTestId('gallery-menu-recent'));
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

    // 进入 booru:posts
    await user.click(screen.getByTestId('main-menu-booru'));
    await user.click(await screen.findByTestId('booru-menu-posts'));
    await waitFor(() => expect(screen.getByTestId('booru-page')).toBeTruthy());

    // 切到 forums（未固定）
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
        quickAccessItems: [],
      },
    });

    render(<App />);

    await screen.findByTestId('gallery-page-recent');

    await user.click(screen.getByTestId('main-menu-booru'));
    await user.click(await screen.findByTestId('booru-menu-posts'));
    await waitFor(() => expect(screen.getByTestId('booru-page')).toBeTruthy());
    const postsMountCount = mountCounts['booru-page'];

    // 切到 forums（未固定）：booru:posts 已固定，切走后应仍保留在 mountedPageIds 里
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

  /**
   * 关闭页面缓存守卫回归（原 bug1-I1）：
   * 命中当前 section+subKey 时跳过卸载，避免 DOM unmount → mount effect 立即
   * 加回 → 重挂载丢状态。新交互里"关闭页面"在二级菜单右键菜单中，
   * mock 直接暴露 close 按钮（绕过 closableKeys 过滤）以验证守卫本身。
   */
  it('关闭页面缓存命中当前 subKey 时不应卸载 DOM（守卫）', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');

    (window as any).electronAPI.pagePreferences.appShell.get = vi.fn().mockResolvedValue({
      success: true,
      data: {
        pinnedItems: [{ section: 'booru', key: 'posts' }],
        quickAccessItems: [],
      },
    });

    render(<App />);

    await screen.findByTestId('gallery-page-recent');

    await user.click(screen.getByTestId('main-menu-booru'));
    await user.click(await screen.findByTestId('booru-menu-posts'));
    await waitFor(() => expect(screen.getByTestId('booru-page')).toBeTruthy());
    expect(mountCounts['booru-page']).toBe(1);

    // 对当前页触发"关闭页面"：守卫应跳过卸载
    await user.click(screen.getByTestId('booru-menu-posts-close'));

    await waitFor(() => {
      expect(screen.queryByTestId('booru-page')).not.toBeNull();
    });
    expect(mountCounts['booru-page']).toBe(1);
    const container = screen.getByTestId('booru-page').closest('.ios-page-enter') as HTMLElement;
    expect(container.style.display).not.toBe('none');
  });

  it('关闭页面缓存：非当前的固定页应被卸载释放', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');

    (window as any).electronAPI.pagePreferences.appShell.get = vi.fn().mockResolvedValue({
      success: true,
      data: {
        pinnedItems: [{ section: 'booru', key: 'posts' }],
        quickAccessItems: [],
      },
    });

    render(<App />);

    await screen.findByTestId('gallery-page-recent');

    // 进入 booru:posts 再切到 forums：posts 因固定保留在后台
    await user.click(screen.getByTestId('main-menu-booru'));
    await user.click(await screen.findByTestId('booru-menu-posts'));
    await waitFor(() => expect(screen.getByTestId('booru-page')).toBeTruthy());
    await user.click(screen.getByTestId('booru-menu-forums'));
    await waitFor(() => expect(screen.getByTestId('booru-forum-page')).toBeTruthy());
    expect(screen.queryByTestId('booru-page')).not.toBeNull();

    // 关闭 posts 的页面缓存：应从 DOM 卸载（固定状态保留，下次访问重新加载）
    await user.click(screen.getByTestId('booru-menu-posts-close'));

    await waitFor(() => {
      expect(screen.queryByTestId('booru-page')).toBeNull();
    });
  });

  /**
   * bug1-I2 回归：GalleryPage 非活跃时应收到 suspended=true
   *
   * 场景：从 gallery/recent 切到 booru/posts 后，gallery 容器保留 display:none
   * 常驻在缓存层。GalleryPage 内部的水合 / 保存 useEffect 是重活
   * （扫描 / 偏好保存 / 图片列表加载），切走后仍跑会持续占 IPC / 主进程 IO。
   *
   * 修复：App.tsx renderPageForId 对 gallery 分支传 suspended={!isActive}，
   * GalleryPage 内的 useEffect 读 suspended 并跳过。
   *
   * 反模式证据：去掉 App.tsx 里 `suspended={!isActive}` 后，GalleryPage
   * 会一直收到 suspended=undefined（falsy），本条会 FAIL。
   */
  it('bug1-I2：切走 gallery 后 GalleryPage 应收到 suspended=true', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');

    render(<App />);

    await screen.findByTestId('gallery-page-recent');

    // 初始 gallery 活跃 → suspended 应为 false
    const galleryEl = screen.getByTestId('gallery-page-recent');
    expect(galleryEl.getAttribute('data-suspended')).toBe('false');
    expect(galleryPageSuspendedLog.some(e => e.subTab === 'recent' && !e.suspended)).toBe(true);

    // 切到 booru:posts
    await user.click(screen.getByTestId('main-menu-booru'));
    await user.click(await screen.findByTestId('booru-menu-posts'));
    await waitFor(() => expect(screen.getByTestId('booru-page')).toBeTruthy());

    // 等一帧让 React 完成父级重渲染把新的 suspended 推下去
    await waitFor(() => {
      // 切走后 gallery-page-recent 仍挂载（常驻缓存层），但 data-suspended 应变为 true
      const el = screen.queryByTestId('gallery-page-recent');
      expect(el).not.toBeNull();
      expect(el!.getAttribute('data-suspended')).toBe('true');
    });

    // 切走后的 render 中必然包含 suspended=true 的记录
    const tailRenders = galleryPageSuspendedLog.filter(e => e.subTab === 'recent').slice(-3);
    expect(tailRenders.some(e => e.suspended)).toBe(true);
  });

  /**
   * bug1 Issue3 反模式守卫：renderPageForId 必须透传 pin 上的 defaultTab。
   *
   * 场景：旧 pin key（blacklisted-tags / bulk-download）会被启动迁移成
   * tag-management / download 且保留 defaultTab。但如果 renderPageForId
   * 不接收/不透传 defaultTab，页面会退回组件默认 tab（favorite / downloads），
   * 构成从旧配置恢复 pin 后的可见回归。
   *
   * 反模式证据：把 App.tsx renderPageForId 的 defaultTab 参数和
   * {[...mountedPageIds].map 里的 pinDefaultTab 去掉，本条将 FAIL
   * （mock 收到的 defaultTab 会是 undefined 或组件默认值）。
   */
  it('bug1 Issue3：pin 的 defaultTab 应透传给 BooruTagManagementPage', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');

    // 预置：tag-management pin 携带 defaultTab='blacklist'
    (window as any).electronAPI.pagePreferences.appShell.get = vi.fn().mockResolvedValue({
      success: true,
      data: {
        pinnedItems: [{ section: 'booru', key: 'tag-management', defaultTab: 'blacklist' }],
      },
    });

    render(<App />);

    await screen.findByTestId('gallery-page-recent');

    // 切到 booru；默认 posts 不会挂 tag-management，所以再切到 tag-management
    await user.click(screen.getByTestId('main-menu-booru'));
    // 二级菜单里 tag-management key
    await waitFor(() => {
      expect(screen.queryByTestId('booru-menu-tag-management')).not.toBeNull();
    });
    await user.click(screen.getByTestId('booru-menu-tag-management'));

    await waitFor(() => {
      expect(screen.getByTestId('tag-management-page')).toBeTruthy();
    });

    // 关键断言：mock 收到的 props.defaultTab 必须是 pin 上的 'blacklist'
    const el = screen.getByTestId('tag-management-page');
    expect(el.getAttribute('data-default-tab')).toBe('blacklist');
    // 历史 render 记录里必然有 defaultTab='blacklist' 的一次
    expect(tagMgmtProps.some(p => p.defaultTab === 'blacklist')).toBe(true);
  });

  /**
   * bug1 Issue3：pin 的 defaultTab='bulk' 应透传给 BooruDownloadHubPage
   * （对应旧 key 'bulk-download' 迁移的场景）。
   */
  it('bug1 Issue3：pin 的 defaultTab 应透传给 BooruDownloadHubPage', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');

    (window as any).electronAPI.pagePreferences.appShell.get = vi.fn().mockResolvedValue({
      success: true,
      data: {
        pinnedItems: [{ section: 'booru', key: 'download', defaultTab: 'bulk' }],
      },
    });

    render(<App />);

    await screen.findByTestId('gallery-page-recent');

    await user.click(screen.getByTestId('main-menu-booru'));
    await waitFor(() => {
      expect(screen.queryByTestId('booru-menu-download')).not.toBeNull();
    });
    await user.click(screen.getByTestId('booru-menu-download'));

    await waitFor(() => {
      expect(screen.getByTestId('download-hub-page')).toBeTruthy();
    });

    const el = screen.getByTestId('download-hub-page');
    expect(el.getAttribute('data-default-tab')).toBe('bulk');
    expect(downloadHubProps.some(p => p.defaultTab === 'bulk')).toBe(true);
  });
});
