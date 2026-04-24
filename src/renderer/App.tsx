import React, { useState, useEffect, useMemo, useCallback, Suspense, createContext, useContext } from 'react';

/** 标题栏右侧插槽 context，供子页面注入操作按钮 */
export const HeaderExtraContext = createContext<(node: React.ReactNode) => void>(() => {});
/** 读取标题栏右侧插槽的 hook */
export const useHeaderExtra = () => useContext(HeaderExtraContext);
import { Layout, Menu, message, App as AntApp, Tooltip, Dropdown } from 'antd';
import appIconUrl from './assets/icon.png';
import { useTheme } from './hooks/useTheme';
import { useLocale } from './locales';
import { useKeyboardShortcuts, SHORTCUT_KEYS } from './hooks/useKeyboardShortcuts';
import { ShortcutsModal } from './components/ShortcutsModal';
import { SortableMenu } from './components/SortableMenu';
import {
  PictureOutlined, SettingOutlined, ClockCircleOutlined,
  AppstoreOutlined, CloudOutlined, BookOutlined,
  CloudDownloadOutlined, StarOutlined, FolderOutlined,
  SunOutlined, MoonOutlined, StopOutlined,
  FireOutlined, DatabaseOutlined, HeartOutlined,
  SearchOutlined, SmileOutlined, MessageOutlined,
  HddOutlined, CameraOutlined, UserOutlined, WarningOutlined
} from '@ant-design/icons';

// 页面级组件：使用 React.lazy 实现代码分割
const GalleryPage = React.lazy(() => import('./pages/GalleryPage').then(m => ({ default: m.GalleryPage })));
const InvalidImagesPage = React.lazy(() => import('./pages/InvalidImagesPage').then(m => ({ default: m.InvalidImagesPage })));
const SettingsPage = React.lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const BooruPage = React.lazy(() => import('./pages/BooruPage').then(m => ({ default: m.BooruPage })));
const BooruSettingsPage = React.lazy(() => import('./pages/BooruSettingsPage').then(m => ({ default: m.BooruSettingsPage })));
const BooruTagSearchPage = React.lazy(() => import('./pages/BooruTagSearchPage').then(m => ({ default: m.BooruTagSearchPage })));
const BooruFavoritesPage = React.lazy(() => import('./pages/BooruFavoritesPage').then(m => ({ default: m.BooruFavoritesPage })));
const BooruTagManagementPage = React.lazy(() => import('./pages/BooruTagManagementPage').then(m => ({ default: m.BooruTagManagementPage })));
const BooruDownloadHubPage = React.lazy(() => import('./pages/BooruDownloadHubPage').then(m => ({ default: m.BooruDownloadHubPage })));
const BooruPopularPage = React.lazy(() => import('./pages/BooruPopularPage').then(m => ({ default: m.BooruPopularPage })));
const BooruPoolsPage = React.lazy(() => import('./pages/BooruPoolsPage').then(m => ({ default: m.BooruPoolsPage })));
const BooruArtistPage = React.lazy(() => import('./pages/BooruArtistPage').then(m => ({ default: m.BooruArtistPage })));
const BooruCharacterPage = React.lazy(() => import('./pages/BooruCharacterPage').then(m => ({ default: m.BooruCharacterPage })));
const BooruWikiPage = React.lazy(() => import('./pages/BooruWikiPage').then(m => ({ default: m.BooruWikiPage })));
const BooruUserPage = React.lazy(() => import('./pages/BooruUserPage').then(m => ({ default: m.BooruUserPage })));
const BooruSavedSearchesPage = React.lazy(() => import('./pages/BooruSavedSearchesPage').then(m => ({ default: m.BooruSavedSearchesPage })));
const BooruForumPage = React.lazy(() => import('./pages/BooruForumPage').then(m => ({ default: m.BooruForumPage })));
const BooruServerFavoritesPage = React.lazy(() => import('./pages/BooruServerFavoritesPage').then(m => ({ default: m.BooruServerFavoritesPage })));
const GoogleDrivePage = React.lazy(() => import('./pages/GoogleDrivePage').then(m => ({ default: m.GoogleDrivePage })));
const GooglePhotosPage = React.lazy(() => import('./pages/GooglePhotosPage').then(m => ({ default: m.GooglePhotosPage })));
const GeminiPage = React.lazy(() => import('./pages/GeminiPage').then(m => ({ default: m.GeminiPage })));
import { colors, spacing, radius, layout, fontSize, iconColors, shadows } from './styles/tokens';

const { Content, Sider } = Layout;

type MenuItem = {
  key: string;
  icon: React.ReactNode;
  label: string;
};

/** 固定到底部的菜单项（最多 5 个，持久化到 config.yaml） */
type PinnedItem = { key: string; section: 'gallery' | 'booru' | 'google'; defaultTab?: string };

/** 侧边栏图标：小圆角方块 + 品牌色 */
const IconBadge: React.FC<{ color: string; icon: React.ReactNode }> = ({ color, icon }) => (
  <span style={{
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 26,
    height: 26,
    borderRadius: 6,
    background: color,
    color: '#FFFFFF',
    fontSize: 13,
    flexShrink: 0,
  }}>
    {icon}
  </span>
);

/** 侧边栏小圆点图标（子菜单用） */
const DotIcon: React.FC<{ color: string; icon: React.ReactNode }> = ({ color, icon }) => (
  <span style={{ color, fontSize: 15, display: 'inline-flex', alignItems: 'center' }}>
    {icon}
  </span>
);

function buildMainMenuItems(t: (path: string) => string): MenuItem[] {
  return [
    { key: 'gallery', icon: <IconBadge color={iconColors.gallery} icon={<PictureOutlined />} />, label: t('menu.gallery') },
    { key: 'booru', icon: <IconBadge color={iconColors.booru} icon={<CloudOutlined />} />, label: t('menu.booru') },
    { key: 'google', icon: <IconBadge color={iconColors.google} icon={<AppstoreOutlined />} />, label: '应用' },
  ];
}

/** Google Drive 官方三角图标 */
const GoogleDriveIcon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none">
    <path d="M1.5 18.6L3.9 22.8H20.1L22.5 18.6H1.5Z" fill="#4285F4"/>
    <path d="M12 2L2.4 18.6H7.2L16.8 2H12Z" fill="#FBBC04"/>
    <path d="M16.8 2L22.5 18.6H17.7L12 8.4L16.8 2Z" fill="#0F9D58"/>
  </svg>
);

/** Google Photos 官方花瓣图标 */
const GooglePhotosIcon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none">
    <path d="M12 12C12 9.24 9.76 7 7 7C4.24 7 2 9.24 2 12H12Z" fill="#EA4335"/>
    <path d="M12 12C14.76 12 17 9.76 17 7C17 4.24 14.76 2 12 2V12Z" fill="#4285F4"/>
    <path d="M12 12C12 14.76 14.24 17 17 17C19.76 17 22 14.76 22 12H12Z" fill="#34A853"/>
    <path d="M12 12C9.24 12 7 14.24 7 17C7 19.76 9.24 22 12 22V12Z" fill="#FBBC04"/>
  </svg>
);

/** Gemini 官方星形图标 */
const GeminiIcon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none">
    <path d="M12 2C12 2 13.5 8.5 17 12C13.5 15.5 12 22 12 22C12 22 10.5 15.5 7 12C10.5 8.5 12 2 12 2Z" fill="url(#gemini_grad)"/>
    <defs>
      <linearGradient id="gemini_grad" x1="7" y1="2" x2="17" y2="22" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#4285F4"/>
        <stop offset="100%" stopColor="#8AB4F8"/>
      </linearGradient>
    </defs>
  </svg>
);


/** 带阴影的应用图标包装（仅 Google 二级菜单使用） */
const GoogleIconWrap: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ fontSize: 30, display: 'inline-flex', alignItems: 'center' }}>
    {children}
  </span>
);

function buildGoogleSubMenuItems(): MenuItem[] {
  return [
    { key: 'gdrive',   icon: <GoogleIconWrap><GoogleDriveIcon /></GoogleIconWrap>,   label: 'Drive' },
    { key: 'gphotos',  icon: <GoogleIconWrap><GooglePhotosIcon /></GoogleIconWrap>,  label: 'Photos' },
    { key: 'gemini',   icon: <GoogleIconWrap><GeminiIcon /></GoogleIconWrap>,        label: 'Gemini' },
  ];
}

function buildGallerySubMenuItems(t: (path: string) => string): MenuItem[] {
  return [
    { key: 'recent', icon: <DotIcon color={iconColors.recent} icon={<ClockCircleOutlined />} />, label: t('menu.recent') },
    { key: 'all', icon: <DotIcon color={iconColors.all} icon={<AppstoreOutlined />} />, label: t('menu.all') },
    { key: 'galleries', icon: <DotIcon color={iconColors.galleries} icon={<FolderOutlined />} />, label: t('menu.galleries') },
    { key: 'invalid-images', icon: <DotIcon color={iconColors.invalidImages} icon={<WarningOutlined />} />, label: t('menu.invalidImages') }
  ];
}

function buildBooruSubMenuItems(t: (path: string) => string): MenuItem[] {
  return [
    { key: 'posts', icon: <DotIcon color={iconColors.posts} icon={<CloudOutlined />} />, label: t('menu.posts') },
    { key: 'popular', icon: <DotIcon color={iconColors.popular} icon={<FireOutlined />} />, label: t('menu.popular') },
    { key: 'pools', icon: <DotIcon color={iconColors.pools} icon={<DatabaseOutlined />} />, label: t('menu.pools') },
    { key: 'forums', icon: <DotIcon color="#0EA5E9" icon={<MessageOutlined />} />, label: t('menu.forums') },
    { key: 'user-profile', icon: <DotIcon color={iconColors.favorites} icon={<UserOutlined />} />, label: t('menu.userProfile') },
    { key: 'favorites', icon: <DotIcon color={iconColors.favorites} icon={<BookOutlined />} />, label: t('menu.favorites') },
    { key: 'server-favorites', icon: <DotIcon color={iconColors.serverFavorites} icon={<HeartOutlined />} />, label: t('menu.serverFavorites') },
    { key: 'tag-management', icon: <DotIcon color={iconColors.favoriteTags} icon={<StarOutlined />} />, label: t('menu.tagManagement') },
    { key: 'download', icon: <DotIcon color={iconColors.downloads} icon={<CloudDownloadOutlined />} />, label: t('menu.download') },
    { key: 'saved-searches', icon: <DotIcon color="#6366F1" icon={<SearchOutlined />} />, label: t('menu.savedSearches') },
    { key: 'booru-settings', icon: <DotIcon color={iconColors.booruSettings} icon={<CloudOutlined />} />, label: t('menu.siteConfig') },
  ];
}

/** 导航栈条目类型（参考 Boorusama 的 GoRouter push/pop 机制） */
type NavigationEntry =
  | { type: 'tag-search'; tag: string; siteId?: number | null }
  | { type: 'artist'; name: string; siteId?: number | null }
  | { type: 'wiki'; name: string; siteId?: number | null }
  | { type: 'user'; userId?: number; username?: string; siteId?: number | null }
  | { type: 'character'; name: string; siteId?: number | null };

export const AppContent: React.FC = () => {
  /** 侧边栏当前展示哪组二级菜单（仅控制左侧列表，不影响右侧内容） */
  const [sidebarSection, setSidebarSection] = useState<'gallery' | 'booru' | 'google'>('gallery');
  /** 右侧内容当前所属的 section（仅在用户点击二级菜单时更新） */
  const [selectedKey, setSelectedKey] = useState('gallery');
  const [selectedSubKey, setSelectedSubKey] = useState('recent');
  const [selectedBooruSubKey, setSelectedBooruSubKey] = useState('posts');
  const [selectedGoogleSubKey, setSelectedGoogleSubKey] = useState('gdrive');
  const [loading, setLoading] = useState(true);
  const [headerExtra, setHeaderExtra] = useState<React.ReactNode>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(layout.sidebarWidth);
  // 导航栈：支持嵌套页面（详情→标签搜索→详情→标签搜索→...）
  const [navigationStack, setNavigationStack] = useState<NavigationEntry[]>([]);
  const { isDark, themeMode, setThemeMode } = useTheme();
  const { t } = useLocale();
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);

  const mainMenuItems = useMemo(() => buildMainMenuItems(t), [t]);
  const gallerySubMenuItems = useMemo(() => buildGallerySubMenuItems(t), [t]);
  const booruSubMenuItems = useMemo(() => buildBooruSubMenuItems(t), [t]);
  const googleSubMenuItems = useMemo(() => buildGoogleSubMenuItems(), []);

  // ── 菜单排序状态（从 config.yaml 持久化） ──
  const [mainOrder, setMainOrder] = useState<string[]>([]);
  const [galleryOrder, setGalleryOrder] = useState<string[]>([]);
  const [booruOrder, setBooruOrder] = useState<string[]>([]);
  const [googleOrder, setGoogleOrder] = useState<string[]>([]);

  // ── 固定到底部的菜单项（最多 5 个，持久化；本次会话开启的保留缓存） ──
  const [pinnedItems, setPinnedItems] = useState<PinnedItem[]>([]);
  /** 当前活跃的固定页面 id（"section:key"），null = 查看普通内容 */
  const [activePinnedId, setActivePinnedId] = useState<string | null>(null);
  /** 本次会话中已挂载过的页面 id Set（pin 与 base 共用；`${section}:${subKey}`） */
  const [mountedPageIds, setMountedPageIds] = useState<Set<string>>(new Set());

  /** 按已保存的顺序重排菜单项，未记录的新项追加到末尾 */
  const applyOrder = useCallback(<T extends { key: string }>(items: T[], order: string[]): T[] => {
    if (!order.length) return items;
    const map = new Map(items.map(item => [item.key, item]));
    const ordered = order.filter(k => map.has(k)).map(k => map.get(k)!);
    const extra = items.filter(item => !order.includes(item.key));
    return [...ordered, ...extra];
  }, []);

  const orderedMainItems   = useMemo(() => applyOrder(mainMenuItems, mainOrder),     [mainMenuItems, mainOrder, applyOrder]);
  const orderedGalleryItems = useMemo(() => applyOrder(gallerySubMenuItems, galleryOrder), [gallerySubMenuItems, galleryOrder, applyOrder]);
  const orderedBooruItems  = useMemo(() => applyOrder(booruSubMenuItems, booruOrder),  [booruSubMenuItems, booruOrder, applyOrder]);
  const orderedGoogleItems = useMemo(() => applyOrder(googleSubMenuItems, googleOrder), [googleSubMenuItems, googleOrder, applyOrder]);

  /** 持久化某个菜单的排序到偏好接口 */
  const saveMenuOrder = useCallback(async (
    section: 'main' | 'gallery' | 'booru' | 'google',
    keys: string[],
    rollback?: () => void,
  ) => {
    try {
      const result = await window.electronAPI.pagePreferences.appShell.save({
        menuOrder: {
          [section]: keys,
        },
      });
      if (!result.success) {
        throw new Error(result.error || 'save failed');
      }
      console.log(`[App] 菜单排序已保存: ${section}`, keys);
    } catch (err) {
      console.error('[App] 保存菜单排序失败:', err);
      rollback?.();
      message.error('菜单排序保存失败');
    }
  }, []);

  /** 持久化固定菜单项到偏好接口 */
  const savePinnedItems = useCallback(async (items: PinnedItem[], rollback?: () => void) => {
    try {
      const result = await window.electronAPI.pagePreferences.appShell.save({ pinnedItems: items });
      if (!result.success) {
        throw new Error(result.error || 'save failed');
      }
      console.log('[App] 固定菜单项已保存', items);
    } catch (err) {
      console.error('[App] 保存固定菜单项失败:', err);
      rollback?.();
      message.error('固定项保存失败');
    }
  }, []);

  /** 固定一个菜单项（最多 5 个） */
  const pinItem = useCallback((section: PinnedItem['section'], key: string) => {
    setPinnedItems(prev => {
      if (prev.length >= 5 || prev.some(p => p.section === section && p.key === key)) return prev;
      const next = [...prev, { section, key }];
      savePinnedItems(next, () => setPinnedItems(prev));
      console.log('[App] 已固定菜单项:', section, key);
      return next;
    });
  }, [savePinnedItems]);

  /** 取消固定一个菜单项，并清理其缓存 */
  const unpinItem = useCallback((section: PinnedItem['section'], key: string) => {
    const pinId = `${section}:${key}`;
    const previousMounted = mountedPageIds;
    const previousActive = activePinnedId;
    setPinnedItems(prev => {
      const previous = prev;
      const next = prev.filter(p => !(p.section === section && p.key === key));
      savePinnedItems(next, () => {
        setPinnedItems(previous);
        setMountedPageIds(previousMounted);
        setActivePinnedId(previousActive);
      });
      console.log('[App] 已取消固定菜单项:', section, key);
      return next;
    });
    setMountedPageIds(prev => { const s = new Set(prev); s.delete(pinId); return s; });
    setActivePinnedId(cur => cur === pinId ? null : cur);
  }, [activePinnedId, mountedPageIds, savePinnedItems]);

  /** 关闭固定页面缓存（不取消固定，只卸载缓存） */
  const closePin = useCallback((section: PinnedItem['section'], key: string) => {
    const pinId = `${section}:${key}`;
    setMountedPageIds(prev => {
      const s = new Set(prev);
      // 守卫：若该 pin 恰好是某 section 的当前 subKey，直接 delete 会出现
      // DOM 瞬间 unmount → mount effect 立即把 id 加回来 → 一次 flash 重挂载 +
      // 状态丢失。命中当前页时不做卸载（语义上也没意义：用户还停在这页）。
      const currentSub = section === 'gallery' ? selectedSubKey
        : section === 'booru' ? selectedBooruSubKey
        : selectedGoogleSubKey;
      if (!(selectedKey === section && currentSub === key)) {
        s.delete(pinId);
      }
      return s;
    });
    setActivePinnedId(cur => cur === pinId ? null : cur);
    console.log('[App] 已关闭固定页面缓存:', pinId);
  }, [selectedKey, selectedSubKey, selectedBooruSubKey, selectedGoogleSubKey]);

  /** 点击固定菜单项：挂载并激活其缓存层 */
  const handlePinnedClick = useCallback((pin: PinnedItem) => {
    const pinId = `${pin.section}:${pin.key}`;
    console.log('[App] 切换到固定页面:', pinId);
    setMountedPageIds(prev => new Set([...prev, pinId]));
    setActivePinnedId(pinId);
  }, []);

  /**
   * 二级菜单 subKey 切换时维护 mountedPageIds：
   *   - 新 id 入集合
   *   - 旧 id 若非固定项、也不再是该 section 的当前页 → 出集合（释放）
   * 固定项始终保留（由 handlePinnedClick 维护）。
   */
  const onSubKeyChanged = useCallback((
    section: 'gallery' | 'booru' | 'google',
    oldKey: string,
    newKey: string,
  ) => {
    setMountedPageIds(prev => {
      const next = new Set(prev);
      next.add(`${section}:${newKey}`);
      if (oldKey && oldKey !== newKey) {
        const oldId = `${section}:${oldKey}`;
        const oldIsPinned = pinnedItems.some(p => p.section === section && p.key === oldKey);
        if (!oldIsPinned) next.delete(oldId);
      }
      return next;
    });
  }, [pinnedItems]);

  /** 根据 section 取对应子菜单列表的元数据（用于固定项图标/标签） */
  const getPinnedItemMeta = useCallback((pin: PinnedItem) => {
    const list = pin.section === 'gallery' ? orderedGalleryItems
      : pin.section === 'booru' ? orderedBooruItems
      : orderedGoogleItems;
    return list.find(i => i.key === pin.key);
  }, [orderedGalleryItems, orderedBooruItems, orderedGoogleItems]);

  const toggleTheme = useCallback(() => {
    setThemeMode(isDark ? 'light' : 'dark');
  }, [isDark, setThemeMode]);

  /** 侧边栏宽度阈值常量 */
  const SIDEBAR_MIN = 64;
  const SIDEBAR_MAX = 320;
  const SIDEBAR_COLLAPSE_THRESHOLD = 140;
  /** 宽度低于阈值时折叠为纯图标模式 */
  const isCollapsed = sidebarWidth < SIDEBAR_COLLAPSE_THRESHOLD;

  /** 拖拽调整侧边栏宽度 */
  const handleSidebarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startWidth + ev.clientX - startX));
      setSidebarWidth(newWidth);
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [sidebarWidth]);

  const openSettings = useCallback(() => {
    if (sidebarSection === 'gallery') { setSelectedKey('gallery'); setSelectedSubKey('settings'); }
    else { setSelectedKey('booru'); setSelectedBooruSubKey('settings'); }
  }, [sidebarSection]);

  const focusSearch = useCallback(() => {
    const searchInput = document.querySelector<HTMLInputElement>(
      '.ant-input-search input, .ant-input-affix-wrapper input, input[type="search"]'
    );
    if (searchInput) { searchInput.focus(); searchInput.select(); }
  }, []);

  useKeyboardShortcuts([
    { key: SHORTCUT_KEYS.TOGGLE_THEME, handler: toggleTheme, description: t('shortcuts.toggleTheme') },
    { key: SHORTCUT_KEYS.OPEN_SETTINGS, handler: openSettings, description: t('shortcuts.openSettings') },
    { key: SHORTCUT_KEYS.FOCUS_SEARCH, handler: focusSearch, description: t('shortcuts.focusSearch'), enableInInput: true },
    { key: SHORTCUT_KEYS.SHOW_SHORTCUTS, handler: () => setShortcutsModalOpen(true), description: t('shortcuts.showShortcuts') },
    { key: SHORTCUT_KEYS.GO_BACK, handler: () => { if (navigationStack.length > 0) popNavigation(); }, description: t('shortcuts.goBack') },
  ]);

  useEffect(() => {
    console.log('[App] 应用启动，初始化数据库');
    const initDatabase = async () => {
      try {
        if (window.electronAPI) {
          const result = await window.electronAPI.db.init();
          if (result.success) {
            console.log('[App] 数据库初始化成功');
          } else {
            console.error('[App] 数据库初始化失败:', result.error);
            message.error('数据库初始化失败: ' + result.error);
          }
          // 加载 App 壳层偏好
          const appShellResult = await window.electronAPI.pagePreferences.appShell.get();
          if (appShellResult.success && appShellResult.data?.menuOrder) {
            const order = appShellResult.data.menuOrder;
            if (order.main?.length)    setMainOrder(order.main);
            if (order.gallery?.length) setGalleryOrder(order.gallery);
            if (order.booru?.length) {
              // 迁移旧的 booru 菜单排序 key
              const BOORU_ORDER_MIGRATION: Record<string, string> = {
                'favorite-tags': 'tag-management',
                'blacklisted-tags': 'tag-management',
                'downloads': 'download',
                'bulk-download': 'download',
              };
              const seen = new Set<string>();
              const migratedBooruOrder = (order.booru as string[])
                .map(k => BOORU_ORDER_MIGRATION[k] ?? k)
                .filter(k => { if (seen.has(k)) return false; seen.add(k); return true; });
              setBooruOrder(migratedBooruOrder);
              if (migratedBooruOrder.length !== order.booru.length || migratedBooruOrder.some((key, index) => key !== order.booru?.[index])) {
                saveMenuOrder('booru', migratedBooruOrder);
              }
            }
            if (order.google?.length)  setGoogleOrder(order.google);
            console.log('[App] 菜单排序已加载', order);
          }
          // 加载固定菜单项（含旧 key 迁移）
          if (appShellResult.data?.pinnedItems?.length) {
            const PINNED_MIGRATION: Record<string, { key: string; defaultTab: string }> = {
              'favorite-tags':   { key: 'tag-management', defaultTab: 'favorite' },
              'blacklisted-tags': { key: 'tag-management', defaultTab: 'blacklist' },
              'downloads':       { key: 'download',       defaultTab: 'downloads' },
              'bulk-download':   { key: 'download',       defaultTab: 'bulk' },
            };
            let migrated = false;
            const raw = appShellResult.data.pinnedItems as PinnedItem[];
            const migratedPins: PinnedItem[] = [];
            const seen = new Set<string>();
            for (const pin of raw) {
              const mapping = PINNED_MIGRATION[pin.key];
              const newPin = mapping
                ? { ...pin, key: mapping.key, defaultTab: pin.defaultTab ?? mapping.defaultTab }
                : pin;
              if (mapping) migrated = true;
              // 去重：合并后可能出现重复的 key
              const dedupKey = `${newPin.section}:${newPin.key}`;
              if (!seen.has(dedupKey)) {
                seen.add(dedupKey);
                migratedPins.push(newPin);
              }
              if (migratedPins.length >= 5) {
                break;
              }
            }
            setPinnedItems(migratedPins);
            if (migrated) {
              console.log('[App] 固定菜单项已迁移旧 key', migratedPins);
              // 异步持久化迁移后的结果
              savePinnedItems(migratedPins);
            } else {
              console.log('[App] 固定菜单项已加载', migratedPins);
            }
          }
        }
      } catch (error) {
        console.error('Failed to initialize database:', error);
        message.error('数据库初始化失败');
      } finally {
        setLoading(false);
      }
    };
    initDatabase();
  }, []);

  useEffect(() => {
    if (selectedKey === 'gallery' && !selectedSubKey) setSelectedSubKey('recent');
    if (selectedKey === 'booru' && !selectedBooruSubKey) setSelectedBooruSubKey('posts');
    if (selectedKey === 'google' && !selectedGoogleSubKey) setSelectedGoogleSubKey('gdrive');
  }, [selectedKey, selectedSubKey, selectedBooruSubKey, selectedGoogleSubKey]);

  // 首次挂载 / 当前 section+subKey 变化时，确保对应页面 id 入 mountedPageIds
  // 让初始页面也进入统一缓存层
  useEffect(() => {
    const subKey = selectedKey === 'gallery' ? selectedSubKey
      : selectedKey === 'booru' ? selectedBooruSubKey
      : selectedGoogleSubKey;
    if (!subKey) return;
    setMountedPageIds(prev => {
      const id = `${selectedKey}:${subKey}`;
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, [selectedKey, selectedSubKey, selectedBooruSubKey, selectedGoogleSubKey]);

  // bug9：监听主进程 SYSTEM_NAVIGATE（目前来源是通知 click）。收到后切 section + 对应 subKey。
  // 已是 pin 的页面走 handlePinnedClick 恢复缓存页面上下文（依赖 bug1 的 pin 恢复链）。
  // 依赖 pinnedItems + handlePinnedClick 以跟踪最新固定项集合；当前不为 sessionId 做硬联动（下载管理页自己决定是否读取高亮）。
  useEffect(() => {
    const off = window.electronAPI?.system?.onSystemNavigate?.((payload) => {
      if (!payload || typeof payload.section !== 'string' || typeof payload.subKey !== 'string') return;
      const section = payload.section as 'gallery' | 'booru' | 'google';
      const subKey = payload.subKey;
      if (section === 'gallery') {
        setSidebarSection('gallery');
        setSelectedKey('gallery');
        setSelectedSubKey(subKey);
      } else if (section === 'booru') {
        setSidebarSection('booru');
        setSelectedKey('booru');
        setSelectedBooruSubKey(subKey);
      } else if (section === 'google') {
        setSidebarSection('google');
        setSelectedKey('google');
        setSelectedGoogleSubKey(subKey);
      } else {
        return;
      }
      // 如果目标页在固定项里，触发 pin 恢复链；否则清除 activePinnedId，让 UI 回到普通二级菜单态
      if (pinnedItems.some(p => p.section === section && p.key === subKey)) {
        handlePinnedClick({ section, key: subKey });
      } else {
        setActivePinnedId(null);
      }
    });
    return () => { off?.(); };
  }, [pinnedItems, handlePinnedClick]);

  // 导航栈操作：push 压栈（保留下层页面），pop 弹栈（返回上一页）
  const pushNavigation = useCallback((entry: NavigationEntry) => {
    const label = entry.type === 'tag-search'
      ? entry.tag
      : entry.type === 'user'
        ? (entry.username || (entry.userId ? `#${entry.userId}` : 'user'))
        : entry.name;
    console.log('[App] 导航栈 push:', entry.type, label);
    setNavigationStack(prev => [...prev, entry]);
  }, []);

  const popNavigation = useCallback(() => {
    console.log('[App] 导航栈 pop');
    setNavigationStack(prev => prev.slice(0, -1));
  }, []);

  const navigateToTagSearch = useCallback((tag: string, siteId?: number | null) => {
    pushNavigation({ type: 'tag-search', tag, siteId });
  }, [pushNavigation]);

  const openTagSearchWindow = useCallback(async (tag: string, siteId?: number | null) => {
    const result = await window.electronAPI.window.openTagSearch(tag, siteId);
    if (!result.success) {
      throw new Error('打开标签搜索窗口失败');
    }
  }, []);

  const navigateToArtist = useCallback((name: string, siteId?: number | null) => {
    pushNavigation({ type: 'artist', name, siteId });
  }, [pushNavigation]);

  const navigateToWiki = useCallback((name: string, siteId?: number | null) => {
    pushNavigation({ type: 'wiki', name, siteId });
  }, [pushNavigation]);

  const navigateToUser = useCallback((params: { userId?: number; username?: string }, siteId?: number | null) => {
    pushNavigation({ type: 'user', userId: params.userId, username: params.username, siteId });
  }, [pushNavigation]);

  const navigateToCharacter = useCallback((name: string, siteId?: number | null) => {
    pushNavigation({ type: 'character', name, siteId });
  }, [pushNavigation]);

  const handleSavedSearchRun = useCallback((query: string, siteId?: number | null) => {
    console.log('[App] 执行保存的搜索:', query, siteId);
    setSelectedBooruSubKey('posts');
    navigateToTagSearch(query, siteId);
  }, [navigateToTagSearch]);

  /** 合并页面对应的默认 tab 映射 */
  const MERGED_DEFAULT_TABS: Record<string, string> = {
    'tag-management': 'favorite',
    'download': 'downloads',
  };

  /** 在子窗口中打开二级菜单页面 */
  const handleOpenSubWindow = useCallback((section: 'gallery' | 'booru' | 'google', key: string) => {
    const tab = MERGED_DEFAULT_TABS[key];
    console.log('[App] 单独窗口打开:', section, key, tab);
    window.electronAPI?.window.openSecondaryMenu(section, key, tab);
  }, []);

  // 导航栈顶部条目（当前显示的叠加页面）
  const topNavEntry = navigationStack.length > 0 ? navigationStack[navigationStack.length - 1] : null;

  const pageTitle = useMemo(() => {
    // 固定页面激活时显示其标题
    if (activePinnedId) {
      const pin = pinnedItems.find(p => `${p.section}:${p.key}` === activePinnedId);
      if (pin) {
        const meta = (pin.section === 'gallery' ? orderedGalleryItems : pin.section === 'booru' ? orderedBooruItems : orderedGoogleItems).find(i => i.key === pin.key);
        const sectionName = pin.section === 'gallery' ? t('pageTitle.gallery') : pin.section === 'booru' ? t('pageTitle.booru') : '应用';
        return { main: sectionName, sub: meta?.label as string | undefined };
      }
    }
    // 导航栈有内容时，显示栈顶页面的标题
    if (topNavEntry) {
      switch (topNavEntry.type) {
        case 'character': return { main: '角色', sub: topNavEntry.name.replace(/_/g, ' ') };
        case 'artist': return { main: '艺术家', sub: topNavEntry.name.replace(/_/g, ' ') };
        case 'wiki': return { main: 'Wiki', sub: topNavEntry.name.replace(/_/g, ' ') };
        case 'user': return { main: '用户', sub: topNavEntry.username || (topNavEntry.userId ? `#${topNavEntry.userId}` : '主页') };
        case 'tag-search': return { main: t('pageTitle.tagSearch'), sub: topNavEntry.tag.replace(/_/g, ' ') };
      }
    }
    switch (selectedKey) {
      case 'gallery':
        if (selectedSubKey === 'settings') return { main: t('pageTitle.settings') };
        return { main: t('pageTitle.gallery'), sub: gallerySubMenuItems.find(i => i.key === selectedSubKey)?.label };
      case 'booru':
        if (selectedBooruSubKey === 'booru-settings') return { main: t('pageTitle.booru'), sub: t('menu.siteConfig') };
        if (selectedBooruSubKey === 'settings') return { main: t('pageTitle.settings') };
        return { main: t('pageTitle.booru'), sub: booruSubMenuItems.find(i => i.key === selectedBooruSubKey)?.label };
      case 'google':
        return { main: '应用', sub: googleSubMenuItems.find(i => i.key === selectedGoogleSubKey)?.label };
      default:
        return { main: t('pageTitle.booru') };
    }
  }, [activePinnedId, pinnedItems, selectedKey, selectedSubKey, selectedBooruSubKey, selectedGoogleSubKey, topNavEntry, t, gallerySubMenuItems, booruSubMenuItems, googleSubMenuItems, orderedGalleryItems, orderedBooruItems, orderedGoogleItems]);

  /** 渲染导航栈中的单个条目 */
  const renderNavigationEntry = (entry: NavigationEntry, index: number) => {
    const isSuspended = index < navigationStack.length - 1;
    switch (entry.type) {
      case 'tag-search':
        return (
          <BooruTagSearchPage
            initialTag={entry.tag}
            initialSiteId={entry.siteId}
            onBack={popNavigation}
            onTagClick={navigateToTagSearch}
            onArtistClick={navigateToArtist}
            onWikiClick={navigateToWiki}
            onCharacterClick={navigateToCharacter}
            suspended={isSuspended}
          />
        );
      case 'artist':
        return (
          <BooruArtistPage
            artistName={entry.name}
            initialSiteId={entry.siteId}
            onBack={popNavigation}
            onTagClick={navigateToTagSearch}
            suspended={isSuspended}
          />
        );
      case 'character':
        return (
          <BooruCharacterPage
            characterName={entry.name}
            initialSiteId={entry.siteId}
            onBack={popNavigation}
            onTagClick={navigateToTagSearch}
            suspended={isSuspended}
          />
        );
      case 'wiki':
        return (
          <BooruWikiPage
            wikiTitle={entry.name}
            initialSiteId={entry.siteId}
            onBack={popNavigation}
            onTagClick={navigateToTagSearch}
            onWikiClick={navigateToWiki}
          />
        );
      case 'user':
        return (
          <BooruUserPage
            userId={entry.userId}
            username={entry.username}
            initialSiteId={entry.siteId}
            onBack={popNavigation}
            onTagClick={navigateToTagSearch}
          />
        );
    }
  };

  /** 折叠模式下渲染纯图标菜单（tooltip 显示标签），完全绕过 antd Menu 的内部渲染 */
  const renderIconMenu = (
    items: MenuItem[],
    activeKey: string,
    onSelect: (key: string) => void,
    extraStyle?: React.CSSProperties,
  ) => (
    <div style={{ padding: '4px 0', ...extraStyle }}>
      {items.map(item => {
        const isActive = activeKey === item.key;
        return (
          <Tooltip key={item.key} title={item.label} placement="right" mouseEnterDelay={0.3}>
            <div
              onClick={() => onSelect(item.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: 40,
                margin: '1px 8px',
                borderRadius: 8,
                cursor: 'pointer',
                background: isActive
                  ? (isDark ? 'rgba(129,140,248,0.15)' : 'rgba(79,70,229,0.08)')
                  : 'transparent',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => {
                if (!isActive) (e.currentTarget as HTMLDivElement).style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
              }}
              onMouseLeave={e => {
                if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
              }}
            >
              {item.icon}
            </div>
          </Tooltip>
        );
      })}
    </div>
  );

  /** 当前是否为嵌入式全屏页面（webview 等需要占满容器的场景，仅适用于普通导航） */
  const isEmbedPage = !activePinnedId && selectedKey === 'google' && (selectedGoogleSubKey === 'gdrive' || selectedGoogleSubKey === 'gphotos' || selectedGoogleSubKey === 'gemini');
  /** Google 区域隐藏顶部标题栏（普通导航）；查看固定页面时始终显示标题栏 */
  const isHeaderHidden = !activePinnedId && selectedKey === 'google';

  /**
   * 根据 (section, subKey) 渲染对应页面实例。
   * 用于 mountedPageIds 叠加层里每个 id 的内容；不读全局 selectedKey/selectedSubKey，
   * 以便多份页面并存。
   *
   * defaultTab：来自 pinnedItems 上对应 pin 的 defaultTab。
   * 旧 pin key（blacklisted-tags / bulk-download）会在启动时被迁移成
   * tag-management / download，并保留 defaultTab；这里必须把它继续传给
   * BooruTagManagementPage / BooruDownloadHubPage，否则老用户从备份恢复
   * 的 pin 会回退到组件默认 tab（blacklisted-tags → favorite，
   * bulk-download → downloads），构成可见回归。
   */
  const renderPageForId = useCallback((
    section: 'gallery' | 'booru' | 'google',
    key: string,
    isActive: boolean,
    defaultTab?: string,
  ): React.ReactNode => {
    // 被叠加且非活跃的页面用 suspended 降级渲染（参考现有 BooruPage 等实现）
    const baseSuspended = !isActive || navigationStack.length > 0;
    if (section === 'gallery') {
      if (key === 'settings') return <SettingsPage />;
      if (key === 'invalid-images') return <InvalidImagesPage />;
      // bug1-I2：常驻缓存层下非活跃时挂起 GalleryPage 内部副作用（水合/保存）。
      // 其它页面（BooruUserPage / SavedSearches / Google embeds）视后续性能观察
      // 决定是否补；当前先收口 GalleryPage。
      return <GalleryPage subTab={key as 'recent' | 'all' | 'galleries'} suspended={!isActive} />;
    }
    if (section === 'booru') {
      if (key === 'posts') return <BooruPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} onCharacterClick={navigateToCharacter} suspended={baseSuspended} />;
      if (key === 'popular') return <BooruPopularPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} suspended={baseSuspended} />;
      if (key === 'pools') return <BooruPoolsPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} suspended={baseSuspended} />;
      if (key === 'forums') return <BooruForumPage onUserClick={navigateToUser} suspended={baseSuspended} />;
      if (key === 'user-profile') return <BooruUserPage onTagClick={navigateToTagSearch} />;
      if (key === 'favorites') return <BooruFavoritesPage onTagClick={navigateToTagSearch} suspended={baseSuspended} />;
      if (key === 'server-favorites') return <BooruServerFavoritesPage onTagClick={navigateToTagSearch} suspended={baseSuspended} />;
      if (key === 'tag-management') return <BooruTagManagementPage onTagClick={openTagSearchWindow} active={isActive} defaultTab={(defaultTab as 'favorite' | 'blacklist' | undefined) ?? 'favorite'} />;
      if (key === 'download') return <BooruDownloadHubPage active={isActive} defaultTab={(defaultTab as 'downloads' | 'bulk' | undefined) ?? 'downloads'} />;
      if (key === 'saved-searches') return <BooruSavedSearchesPage onRunSearch={handleSavedSearchRun} />;
      if (key === 'booru-settings') return <BooruSettingsPage />;
      if (key === 'settings') return <SettingsPage />;
      return <BooruPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} onCharacterClick={navigateToCharacter} suspended={baseSuspended} />;
    }
    // google
    if (key === 'gdrive') return <GoogleDrivePage />;
    if (key === 'gphotos') return <GooglePhotosPage />;
    if (key === 'gemini') return <GeminiPage />;
    return null;
  }, [
    navigationStack.length,
    navigateToTagSearch,
    openTagSearchWindow,
    navigateToArtist,
    navigateToCharacter,
    navigateToUser,
    handleSavedSearchRun,
  ]);

  /** 当前 section 对应的 subKey */
  const currentSubKey: string = selectedKey === 'gallery' ? selectedSubKey
    : selectedKey === 'booru' ? selectedBooruSubKey
    : selectedGoogleSubKey;

  /** Suspense 加载中占位 */
  const suspenseFallback = (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
      <div style={{ color: colors.textTertiary }}>加载中...</div>
    </div>
  );

  // 离开嵌入页时清空 headerExtra
  useEffect(() => {
    if (!isEmbedPage) setHeaderExtra(null);
  }, [isEmbedPage]);

  return (
    <HeaderExtraContext.Provider value={setHeaderExtra}>
    <Layout style={{ height: '100vh', overflow: 'hidden', background: colors.bgLight }}>
      {/* 侧边栏 */}
      <Sider
        width={sidebarWidth}
        theme={isDark ? 'dark' : 'light'}
        style={{
          height: '100vh',
          overflow: 'hidden',
          background: colors.sidebarBg,
          borderRight: `1px solid ${colors.separator}`,
          position: 'relative',
          flexShrink: 0,
          transition: 'none',
        }}
      >
        {/* 内层 flex 包装：Sider 内部有 ant-layout-sider-children 非 flex 层，
            需在此处建立真正的 flex column 容器才能让第三段贴底 */}
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: colors.sidebarBg, position: 'relative' }}>
        {/* 拖拽调整宽度的手柄，位于侧边栏右边缘 */}
        <div
          onMouseDown={handleSidebarMouseDown}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 200, background: 'transparent', transition: 'background 0.2s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
        />

        {/* ── 第一段：Logo + 一级菜单（固定顶部） ── */}
        <div style={{ flexShrink: 0 }}>
          {/* Logo */}
          <div style={{ padding: isCollapsed ? '20px 0 12px' : '20px 16px 12px', display: 'flex', justifyContent: isCollapsed ? 'center' : 'flex-start' }}>
            <Tooltip title={isCollapsed ? 'Yande Gallery Desktop' : ''} placement="right">
              <div style={{ display: 'flex', alignItems: 'center', gap: isCollapsed ? 0 : 10, overflow: 'hidden' }}>
                <img
                  src={appIconUrl}
                  alt="Yande Gallery"
                  onClick={() => setSidebarWidth(isCollapsed ? layout.sidebarWidth : SIDEBAR_MIN)}
                  title={isCollapsed ? '展开侧边栏' : '折叠侧边栏'}
                  style={{ width: 32, height: 32, flexShrink: 0, cursor: 'pointer', userSelect: 'none' as const, objectFit: 'contain' }}
                  draggable={false}
                />
                {!isCollapsed && (
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.3px', color: colors.textPrimary, lineHeight: '18px', fontFamily: 'var(--font-display, sans-serif)', whiteSpace: 'nowrap' }}>Yande Gallery</div>
                    <div style={{ fontSize: 10, color: colors.textTertiary, letterSpacing: '0.5px', textTransform: 'uppercase' as const, fontWeight: 600, lineHeight: '12px', marginTop: 2, whiteSpace: 'nowrap' }}>Desktop</div>
                  </div>
                )}
              </div>
            </Tooltip>
          </div>
          {/* 一级菜单（支持长按拖拽排序） */}
          <SortableMenu
            items={orderedMainItems}
            selectedKey={sidebarSection}
            onSelect={(key) => {
              const nextSection = key as 'gallery' | 'booru' | 'google';
              console.log(`[App] 主菜单切换分区: ${nextSection}`);
              setSidebarSection(nextSection);
              setSelectedKey(nextSection);
              setNavigationStack([]);
              // 目标 section 的当前 subKey
              const targetSubKey = nextSection === 'gallery' ? selectedSubKey
                : nextSection === 'booru' ? selectedBooruSubKey
                : selectedGoogleSubKey;
              // 确保该页面被挂载（首次切入此 section 时也入集合）
              setMountedPageIds(prev => new Set([...prev, `${nextSection}:${targetSubKey}`]));
              // 若目标是固定项 → 激活 pin；否则 activePinnedId 置空走基础层
              if (pinnedItems.some(p => p.section === nextSection && p.key === targetSubKey)) {
                handlePinnedClick({ section: nextSection, key: targetSubKey });
              } else {
                setActivePinnedId(null);
              }
            }}
            onReorder={(keys) => { const previous = mainOrder; setMainOrder(keys); saveMenuOrder('main', keys, () => setMainOrder(previous)); }}
            isCollapsed={isCollapsed}
            isDark={isDark}
            style={{ borderBottom: `1px solid ${colors.separator}`, paddingBottom: spacing.xs }}
          />
        </div>

        {/* ── 第二段：二级菜单（随一级更改，可滚动） ── */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* 分区标签（跟随 sidebarSection，不跟 selectedKey） */}
          {!isCollapsed && (
            <div style={{ padding: `${spacing.md}px ${spacing.lg}px ${spacing.xs}px`, fontSize: 10, fontWeight: 700, color: colors.textTertiary, textTransform: 'uppercase' as const, letterSpacing: '1px', flexShrink: 0 }}>
              {sidebarSection === 'gallery' ? t('menu.browse') : sidebarSection === 'booru' ? 'BOORU' : 'GOOGLE'}
            </div>
          )}
          {/* 可滚动菜单列表（跟随 sidebarSection） */}
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
            {sidebarSection === 'gallery' && (
              <SortableMenu
                items={orderedGalleryItems}
                selectedKey={activePinnedId ? '' : (selectedKey === 'gallery' ? selectedSubKey : '')}
                onSelect={(key) => {
                  console.log(`[App] 图库子菜单: ${key}`);
                  const oldKey = selectedSubKey;
                  setSelectedKey('gallery');
                  setSidebarSection('gallery');
                  setSelectedSubKey(key);
                  setNavigationStack([]);
                  onSubKeyChanged('gallery', oldKey, key);
                  if (pinnedItems.some(p => p.section === 'gallery' && p.key === key)) {
                    handlePinnedClick({ section: 'gallery', key });
                  } else {
                    setActivePinnedId(null);
                  }
                }}
                onReorder={(keys) => { const previous = galleryOrder; setGalleryOrder(keys); saveMenuOrder('gallery', keys, () => setGalleryOrder(previous)); }}
                isCollapsed={isCollapsed}
                isDark={isDark}
                pinnedKeys={pinnedItems.filter(p => p.section === 'gallery').map(p => p.key)}
                canAddPin={pinnedItems.length < 5}
                onPinToggle={(key, cur) => cur ? unpinItem('gallery', key) : pinItem('gallery', key)}
                onOpenSubWindow={(key) => handleOpenSubWindow('gallery', key)}
              />
            )}
            {sidebarSection === 'booru' && (
              <SortableMenu
                items={orderedBooruItems}
                selectedKey={activePinnedId ? '' : (selectedKey === 'booru' ? selectedBooruSubKey : '')}
                onSelect={(key) => {
                  console.log(`[App] Booru子菜单: ${key}`);
                  const oldKey = selectedBooruSubKey;
                  setSelectedKey('booru');
                  setSidebarSection('booru');
                  setSelectedBooruSubKey(key);
                  setNavigationStack([]);
                  onSubKeyChanged('booru', oldKey, key);
                  if (pinnedItems.some(p => p.section === 'booru' && p.key === key)) {
                    handlePinnedClick({ section: 'booru', key });
                  } else {
                    setActivePinnedId(null);
                  }
                }}
                onReorder={(keys) => { const previous = booruOrder; setBooruOrder(keys); saveMenuOrder('booru', keys, () => setBooruOrder(previous)); }}
                isCollapsed={isCollapsed}
                isDark={isDark}
                pinnedKeys={pinnedItems.filter(p => p.section === 'booru').map(p => p.key)}
                canAddPin={pinnedItems.length < 5}
                onPinToggle={(key, cur) => cur ? unpinItem('booru', key) : pinItem('booru', key)}
                onOpenSubWindow={(key) => handleOpenSubWindow('booru', key)}
              />
            )}
            {sidebarSection === 'google' && (
              <SortableMenu
                items={orderedGoogleItems}
                selectedKey={activePinnedId ? '' : (selectedKey === 'google' ? selectedGoogleSubKey : '')}
                onSelect={(key) => {
                  console.log(`[App] 应用子菜单: ${key}`);
                  const oldKey = selectedGoogleSubKey;
                  setSelectedKey('google');
                  setSidebarSection('google');
                  setSelectedGoogleSubKey(key);
                  setNavigationStack([]);
                  onSubKeyChanged('google', oldKey, key);
                  if (pinnedItems.some(p => p.section === 'google' && p.key === key)) {
                    handlePinnedClick({ section: 'google', key });
                  } else {
                    setActivePinnedId(null);
                  }
                }}
                onReorder={(keys) => { const previous = googleOrder; setGoogleOrder(keys); saveMenuOrder('google', keys, () => setGoogleOrder(previous)); }}
                isCollapsed={isCollapsed}
                isDark={isDark}
                pinnedKeys={pinnedItems.filter(p => p.section === 'google').map(p => p.key)}
                canAddPin={pinnedItems.length < 5}
                onPinToggle={(key, cur) => cur ? unpinItem('google', key) : pinItem('google', key)}
                onOpenSubWindow={(key) => handleOpenSubWindow('google', key)}
              />
            )}
          </div>
        </div>

        {/* ── 第二·五段：固定项（最多5个，始终可见，不随一级菜单切换） ── */}
        {pinnedItems.length > 0 && (
          <div style={{ flexShrink: 0, borderTop: `1px solid ${colors.separator}`, paddingTop: 4, paddingBottom: 4 }}>
            {pinnedItems.map(pin => {
              const meta = getPinnedItemMeta(pin);
              if (!meta) return null;
              const pinId = `${pin.section}:${pin.key}`;
              const isActive = activePinnedId === pinId;
              const isCached = mountedPageIds.has(pinId);
              const activeBg    = isDark ? 'rgba(129,140,248,0.15)' : 'rgba(79,70,229,0.08)';
              const activeColor = isDark ? '#818CF8' : '#4F46E5';
              const normalColor = isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.55)';
              const itemContent = (
                <Dropdown
                  trigger={['contextMenu']}
                  menu={{
                    items: [
                      { key: 'close', label: '关闭', disabled: !mountedPageIds.has(`${pin.section}:${pin.key}`) },
                      { key: 'unpin', label: '取消固定', danger: true },
                    ],
                    onClick: ({ key }) => key === 'close' ? closePin(pin.section, pin.key) : unpinItem(pin.section, pin.key),
                  }}
                >
                  <div
                    onClick={() => handlePinnedClick(pin)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: isCollapsed ? 'center' : 'flex-start', height: 38, margin: '1px 8px', padding: isCollapsed ? 0 : '0 8px 0 12px', borderRadius: 8, cursor: 'pointer', background: isActive ? activeBg : 'transparent', color: isActive ? activeColor : normalColor, fontSize: 14, fontWeight: isActive ? 600 : 400, gap: isCollapsed ? 0 : 10, overflow: 'hidden', transition: 'background 0.15s', userSelect: 'none' as const,
                      // 已缓存时加左侧阴影条
                      boxShadow: isCached ? `inset 2px 0 0 0 ${isDark ? 'rgba(129,140,248,0.5)' : 'rgba(79,70,229,0.35)'}` : undefined,
                    }}
                    onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'; }}
                    onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                  >
                    {meta.icon}
                    {!isCollapsed && <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.label}</span>}
                  </div>
                </Dropdown>
              );
              return isCollapsed ? (
                <Tooltip key={pinId} title={meta.label} placement="right" mouseEnterDelay={0.3}>{itemContent}</Tooltip>
              ) : <React.Fragment key={pinId}>{itemContent}</React.Fragment>;
            })}
          </div>
        )}

        {/* ── 第三段：设置 + 深色模式（固定底部，不随一级菜单切换） ── */}
        <div style={{ flexShrink: 0, borderTop: `1px solid ${colors.separator}` }}>
          {/* 应用设置入口 */}
          {(() => {
            const settingsActiveKey = (selectedKey === 'booru' && selectedBooruSubKey === 'settings') || (selectedKey !== 'booru' && selectedSubKey === 'settings') ? 'settings' : '';
            const handleSettingsClick = () => { if (sidebarSection === 'booru') { setSelectedKey('booru'); setSelectedBooruSubKey('settings'); } else { setSelectedKey('gallery'); setSelectedSubKey('settings'); } };
            const settingsItem = [{ key: 'settings', icon: <DotIcon color={iconColors.settings} icon={<SettingOutlined />} />, label: t('menu.settings') }];
            return isCollapsed
              ? renderIconMenu(settingsItem, settingsActiveKey, handleSettingsClick)
              : <Menu mode="inline" selectedKeys={settingsActiveKey ? ['settings'] : []} items={settingsItem} onClick={handleSettingsClick} style={{ background: 'transparent', borderRight: 'none' }} />;
          })()}
          {/* 深色模式切换 */}
          <div style={{ padding: `${spacing.xs}px ${spacing.md}px ${spacing.sm}px`, display: 'flex', justifyContent: 'center' }}>
            <Tooltip title={isCollapsed ? (isDark ? t('app.lightMode') : t('app.darkMode')) : ''} placement="right">
              <button
                onClick={toggleTheme}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: isCollapsed ? 0 : 6, width: isCollapsed ? 36 : '100%', height: isCollapsed ? 36 : undefined, padding: isCollapsed ? '0' : '8px 12px', borderRadius: isCollapsed ? '50%' : radius.sm, border: 'none', background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)', color: colors.textSecondary, fontSize: isCollapsed ? 16 : fontSize.sm, fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s ease' }}
                onMouseEnter={e => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)'; }}
              >
                {isDark ? <SunOutlined /> : <MoonOutlined />}
                {!isCollapsed && (isDark ? t('app.lightMode') : t('app.darkMode'))}
              </button>
            </Tooltip>
          </div>
        </div>
        </div>
      </Sider>

      {/* 主内容区 */}
      <Layout style={{
        height: '100vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: colors.bgLight,
        position: 'relative',
      }}>
        {/* 标题栏（Google 区域隐藏） */}
        <div style={{
          padding: `0 ${spacing.xl}px`,
          height: layout.headerHeight,
          display: isHeaderHidden ? 'none' : 'flex',
          alignItems: 'center',
          flexShrink: 0,
          background: isDark
            ? 'rgba(15, 17, 23, 0.80)'
            : 'rgba(248, 248, 252, 0.80)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          borderBottom: `1px solid ${colors.separator}`,
          zIndex: 10,
        }}>
          <span style={{
            fontSize: fontSize.xl,
            fontWeight: 700,
            letterSpacing: '-0.3px',
            color: colors.textPrimary,
            fontFamily: 'var(--font-display, sans-serif)',
          }}>
            {pageTitle.main}
          </span>
          {pageTitle.sub && (
            <>
              <span style={{
                fontSize: fontSize.xl,
                fontWeight: 700,
                color: colors.textQuaternary,
                margin: '0 8px',
                fontFamily: 'var(--font-display, sans-serif)',
              }}>
                /
              </span>
              <span style={{
                fontSize: fontSize.xl,
                fontWeight: 700,
                letterSpacing: '-0.3px',
                color: colors.textTertiary,
                fontFamily: 'var(--font-display, sans-serif)',
              }}>
                {pageTitle.sub}
              </span>
            </>
          )}
          {/* 页面注入的右侧操作按钮 */}
          {headerExtra && (
            <div style={{ marginLeft: 'auto' }}>
              {headerExtra}
            </div>
          )}
        </div>

        {/* 内容区 */}
        <Content
          style={{
            margin: 0,
            flex: 1,
            height: 0,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* 加载中占位 */}
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
              <h2 style={{ color: colors.textTertiary, fontWeight: 400, fontSize: fontSize.lg }}>{t('app.initializing')}</h2>
            </div>
          )}

          {/* 统一页面缓存层：pin 与基础页共用 mountedPageIds，不再各走一套 */}
          {!loading && [...mountedPageIds].map(id => {
            const [sec, subKey] = id.split(':', 2) as ['gallery' | 'booru' | 'google', string];
            const isEmbed = sec === 'google' && (subKey === 'gdrive' || subKey === 'gphotos' || subKey === 'gemini');
            const pinId = `${sec}:${subKey}`;
            // bug1 Issue3：pin 上的 defaultTab 需透传给页面，否则迁移后的旧 pin
            // （blacklisted-tags / bulk-download）打开会退回组件默认 tab。
            const pinMeta = pinnedItems.find(p => `${p.section}:${p.key}` === pinId);
            const isPin = !!pinMeta;
            const pinDefaultTab = pinMeta?.defaultTab;
            const isBaseCurrent = !activePinnedId && selectedKey === sec && currentSubKey === subKey;
            // 是否激活：pin 命中 activePinnedId，或基础层当前页（支持 pin 项被
            // closePin 后 activePinnedId=null 但用户仍停在对应 subKey 的情况，
            // 这时 pin 项应作为基础层 active 继续显示）。
            const isActive = (isPin && activePinnedId === pinId) || isBaseCurrent;
            // embed 页（gdrive/gphotos/gemini）继续走 absolute 独立层（webview 需要占满容器）
            if (isEmbed) {
              return (
                <div
                  key={`page-${pinId}`}
                  className="ios-page-enter"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    overflow: 'hidden',
                    zIndex: 1,
                    display: isActive ? undefined : 'none',
                  }}
                >
                  <Suspense fallback={suspenseFallback}>
                    {renderPageForId(sec, subKey, isActive, pinDefaultTab)}
                  </Suspense>
                </div>
              );
            }
            // 只在当前活跃基础页且导航栈非空时，用栈顶覆盖本页（与历史 renderBaseContent 行为一致）
            const shouldOverlayNavStack = isActive && isBaseCurrent && navigationStack.length > 0;
            return (
              <div
                key={`page-${pinId}`}
                className="ios-page-enter noise-bg"
                style={{
                  padding: `${spacing.lg}px`,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  height: '100%',
                  display: isActive ? undefined : 'none',
                }}
              >
                <Suspense fallback={suspenseFallback}>
                  {shouldOverlayNavStack ? (
                    <>
                      <div style={{ display: 'none' }}>{renderPageForId(sec, subKey, false, pinDefaultTab)}</div>
                      {navigationStack.map((entry, index) => {
                        const isTop = index === navigationStack.length - 1;
                        return (
                          <div key={`nav-${entry.type}-${index}`} style={isTop ? undefined : { display: 'none' }}>
                            {renderNavigationEntry(entry, index)}
                          </div>
                        );
                      })}
                    </>
                  ) : renderPageForId(sec, subKey, isActive, pinDefaultTab)}
                </Suspense>
              </div>
            );
          })}
        </Content>
      </Layout>

      <ShortcutsModal open={shortcutsModalOpen} onClose={() => setShortcutsModalOpen(false)} />
    </Layout>
    </HeaderExtraContext.Provider>
  );
};

export const App: React.FC = () => (
  <AntApp>
    <AppContent />
  </AntApp>
);
