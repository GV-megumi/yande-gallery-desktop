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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  /**
   * bug1-I1 回归：closePin 守卫当前 subKey
   *
   * 场景：pin 了 booru:posts 且当前就停在 booru/posts，右键 → "关闭"。
   * 旧代码无条件 delete(pinId) → mountedPageIds 暂时丢失 → DOM unmount →
   * 随后 mount effect（App.tsx ~L484 根据 selectedKey/subKey 确保页面 id 入集）
   * 再次把它加回来 → 重新挂载，丢失本地 state（mount 次数 ≥ 2）。
   *
   * 修复后：closePin 检测到当前 section+subKey 命中 → 跳过 delete，
   * 仅将 activePinnedId 置 null（基础层接管），DOM 不动，mount 次数维持 1。
   *
   * 反模式证据：把 App.tsx closePin 的守卫去掉后重跑本条应 FAIL
   * （mount 次数 = 2 而非 1）。
   */
  it('bug1-I1：closePin 命中当前 subKey 时不应卸载 DOM', async () => {
    const user = userEvent.setup();
    const { App } = await import('../../src/renderer/App');

    (window as any).electronAPI.pagePreferences.appShell.get = vi.fn().mockResolvedValue({
      success: true,
      data: {
        pinnedItems: [{ section: 'booru', key: 'posts' }],
      },
    });

    render(<App />);

    // 初始 gallery
    await screen.findByTestId('gallery-page-recent');

    // 切到 booru（默认 subKey=posts，命中 pin）
    await user.click(screen.getByTestId('main-menu-booru'));
    await waitFor(() => expect(screen.getByTestId('booru-page')).toBeTruthy());

    // 此时 booru-page 已挂载 1 次
    expect(mountCounts['booru-page']).toBe(1);

    // 找到侧边栏的 pin 项（含 meta.label="帖子"），右键触发 antd Dropdown
    // Dropdown trigger=['contextMenu']。这里用固定项那一行的外层 div。
    // 固定项位于第二·五段（非 SortableMenu），文本 "帖子" 出现两次：
    // SortableMenu 里的按钮（data-testid=booru-menu-posts） + 固定项一行。
    // 用 "帖子" 文本查全部，挑出不在 data-testid 按钮内的那一个。
    const allPostsText = screen.getAllByText('帖子');
    const pinnedItemText = allPostsText.find(el => !el.closest('[data-testid="booru-menu-posts"]'));
    expect(pinnedItemText).toBeTruthy();
    const pinnedRow = pinnedItemText!.closest('div[style]') as HTMLElement;
    expect(pinnedRow).toBeTruthy();

    // 触发 contextmenu 打开下拉菜单
    fireEvent.contextMenu(pinnedRow);

    // 等待 antd Dropdown 的菜单项 "关闭" 出现
    const closeItem = await screen.findByText('关闭');
    // 点击 "关闭"
    await user.click(closeItem);

    // 给 state 更新一帧机会
    await waitFor(() => {
      // activePinnedId 被清空 → pin 的阴影条会消失，但我们用更稳的信号：
      // booru-page DOM 容器仍存在（命中守卫，未 unmount）
      expect(screen.queryByTestId('booru-page')).not.toBeNull();
    });

    // 关键断言：booru-page 的 mount 次数仍为 1（未被 unmount→remount）
    expect(mountCounts['booru-page']).toBe(1);

    // 容器仍是激活态（此时走基础层：activePinnedId=null，
    // selectedKey=booru + selectedBooruSubKey=posts → isBaseCurrent=true）
    const container = screen.getByTestId('booru-page').closest('.ios-page-enter') as HTMLElement;
    expect(container.style.display).not.toBe('none');
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

    // 切到 booru
    await user.click(screen.getByTestId('main-menu-booru'));
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
