import React, { useState, useEffect, useMemo, useCallback, Suspense, createContext, useContext } from 'react';

/** 标题栏右侧插槽 context，供子页面注入操作按钮 */
export const HeaderExtraContext = createContext<(node: React.ReactNode) => void>(() => {});
/** 读取标题栏右侧插槽的 hook */
export const useHeaderExtra = () => useContext(HeaderExtraContext);
import { Layout, Menu, message, App as AntApp, Tooltip, Dropdown } from 'antd';
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
const BooruDownloadPage = React.lazy(() => import('./pages/BooruDownloadPage'));
const BooruBulkDownloadPage = React.lazy(() => import('./pages/BooruBulkDownloadPage').then(m => ({ default: m.BooruBulkDownloadPage })));
const BooruTagSearchPage = React.lazy(() => import('./pages/BooruTagSearchPage').then(m => ({ default: m.BooruTagSearchPage })));
const BooruFavoritesPage = React.lazy(() => import('./pages/BooruFavoritesPage').then(m => ({ default: m.BooruFavoritesPage })));
const FavoriteTagsPage = React.lazy(() => import('./pages/FavoriteTagsPage').then(m => ({ default: m.FavoriteTagsPage })));
const BlacklistedTagsPage = React.lazy(() => import('./pages/BlacklistedTagsPage').then(m => ({ default: m.BlacklistedTagsPage })));
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
type PinnedItem = { key: string; section: 'gallery' | 'booru' | 'google' };

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
    { key: 'favorite-tags', icon: <DotIcon color={iconColors.favoriteTags} icon={<StarOutlined />} />, label: t('menu.favoriteTags') },
    { key: 'blacklisted-tags', icon: <DotIcon color="#EF4444" icon={<StopOutlined />} />, label: t('menu.blacklist') },
    { key: 'downloads', icon: <DotIcon color={iconColors.downloads} icon={<CloudDownloadOutlined />} />, label: t('menu.downloads') },
    { key: 'bulk-download', icon: <DotIcon color={iconColors.bulkDownload} icon={<CloudDownloadOutlined />} />, label: t('menu.bulkDownload') },
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
  /** 本次会话中已挂载过的固定页面 id Set（切换后保留缓存，不卸载） */
  const [mountedPinnedIds, setMountedPinnedIds] = useState<Set<string>>(new Set());

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

  /** 持久化某个菜单的排序到 config.yaml */
  const saveMenuOrder = useCallback(async (section: 'main' | 'gallery' | 'booru' | 'google', keys: string[]) => {
    try {
      const result = await window.electronAPI.config.get();
      if (!result.success) return;
      const newConfig = {
        ...result.data,
        ui: {
          ...result.data?.ui,
          menuOrder: { ...result.data?.ui?.menuOrder, [section]: keys },
        },
      };
      await window.electronAPI.config.save(newConfig);
      console.log(`[App] 菜单排序已保存: ${section}`, keys);
    } catch (err) {
      console.error('[App] 保存菜单排序失败:', err);
    }
  }, []);

  /** 持久化固定菜单项到 config.yaml */
  const savePinnedItems = useCallback(async (items: PinnedItem[]) => {
    try {
      const result = await window.electronAPI.config.get();
      if (!result.success) return;
      const newConfig = { ...result.data, ui: { ...result.data?.ui, pinnedItems: items } };
      await window.electronAPI.config.save(newConfig);
      console.log('[App] 固定菜单项已保存', items);
    } catch (err) {
      console.error('[App] 保存固定菜单项失败:', err);
    }
  }, []);

  /** 固定一个菜单项（最多 5 个） */
  const pinItem = useCallback((section: PinnedItem['section'], key: string) => {
    setPinnedItems(prev => {
      if (prev.length >= 5 || prev.some(p => p.section === section && p.key === key)) return prev;
      const next = [...prev, { section, key }];
      savePinnedItems(next);
      console.log('[App] 已固定菜单项:', section, key);
      return next;
    });
  }, [savePinnedItems]);

  /** 取消固定一个菜单项，并清理其缓存 */
  const unpinItem = useCallback((section: PinnedItem['section'], key: string) => {
    const pinId = `${section}:${key}`;
    setPinnedItems(prev => {
      const next = prev.filter(p => !(p.section === section && p.key === key));
      savePinnedItems(next);
      console.log('[App] 已取消固定菜单项:', section, key);
      return next;
    });
    setMountedPinnedIds(prev => { const s = new Set(prev); s.delete(pinId); return s; });
    setActivePinnedId(cur => cur === pinId ? null : cur);
  }, [savePinnedItems]);

  /** 关闭固定页面缓存（不取消固定，只卸载缓存） */
  const closePin = useCallback((section: PinnedItem['section'], key: string) => {
    const pinId = `${section}:${key}`;
    setMountedPinnedIds(prev => { const s = new Set(prev); s.delete(pinId); return s; });
    setActivePinnedId(cur => cur === pinId ? null : cur);
    console.log('[App] 已关闭固定页面缓存:', pinId);
  }, []);

  /** 点击固定菜单项：挂载并激活其缓存层 */
  const handlePinnedClick = useCallback((pin: PinnedItem) => {
    const pinId = `${pin.section}:${pin.key}`;
    console.log('[App] 切换到固定页面:', pinId);
    setMountedPinnedIds(prev => new Set([...prev, pinId]));
    setActivePinnedId(pinId);
  }, []);

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
    if (selectedKey === 'gallery') setSelectedSubKey('settings');
    else setSelectedBooruSubKey('settings');
  }, [selectedKey]);

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
          // 加载已保存的菜单排序
          const cfgResult = await window.electronAPI.config.get();
          if (cfgResult.success && cfgResult.data?.ui?.menuOrder) {
            const order = cfgResult.data.ui.menuOrder;
            if (order.main?.length)    setMainOrder(order.main);
            if (order.gallery?.length) setGalleryOrder(order.gallery);
            if (order.booru?.length)   setBooruOrder(order.booru);
            if (order.google?.length)  setGoogleOrder(order.google);
            console.log('[App] 菜单排序已加载', order);
          }
          // 加载固定菜单项
          if (cfgResult.data?.ui?.pinnedItems?.length) {
            setPinnedItems((cfgResult.data.ui.pinnedItems as PinnedItem[]).slice(0, 5));
            console.log('[App] 固定菜单项已加载', cfgResult.data.ui.pinnedItems);
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

  const handleSavedSearchRun = (query: string, siteId?: number | null) => {
    console.log('[App] 执行保存的搜索:', query, siteId);
    setSelectedBooruSubKey('posts');
    navigateToTagSearch(query, siteId);
  };

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

  /** 渲染固定页面（独立缓存层，props 与 renderBasePage 保持一致） */
  const renderPageForPin = (pin: PinnedItem): React.ReactNode => {
    const { section, key } = pin;
    if (section === 'gallery') {
      if (key === 'settings') return <SettingsPage />;
      if (key === 'invalid-images') return <InvalidImagesPage />;
      return <GalleryPage subTab={key as 'recent' | 'all' | 'galleries'} />;
    }
    if (section === 'booru') {
      if (key === 'posts') return <BooruPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} onCharacterClick={navigateToCharacter} suspended={false} />;
      if (key === 'popular') return <BooruPopularPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} suspended={false} />;
      if (key === 'pools') return <BooruPoolsPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} suspended={false} />;
      if (key === 'forums') return <BooruForumPage onUserClick={navigateToUser} suspended={false} />;
      if (key === 'user-profile') return <BooruUserPage onTagClick={navigateToTagSearch} />;
      if (key === 'favorites') return <BooruFavoritesPage onTagClick={navigateToTagSearch} suspended={false} />;
      if (key === 'server-favorites') return <BooruServerFavoritesPage onTagClick={navigateToTagSearch} suspended={false} />;
      if (key === 'favorite-tags') return <FavoriteTagsPage onTagClick={navigateToTagSearch} />;
      if (key === 'blacklisted-tags') return <BlacklistedTagsPage />;
      if (key === 'downloads') return <BooruDownloadPage />;
      if (key === 'bulk-download') return <BooruBulkDownloadPage />;
      if (key === 'saved-searches') return <BooruSavedSearchesPage onRunSearch={handleSavedSearchRun} />;
      if (key === 'booru-settings') return <BooruSettingsPage />;
      if (key === 'settings') return <SettingsPage />;
    }
    if (section === 'google') {
      if (key === 'gdrive') return <GoogleDrivePage />;
      if (key === 'gphotos') return <GooglePhotosPage />;
      if (key === 'gemini') return <GeminiPage />;
    }
    return null;
  };

  /** 渲染基础页面（底层页面） */
  const renderBasePage = () => {
    const baseSuspended = navigationStack.length > 0;
    switch (selectedKey) {
      case 'gallery':
        if (selectedSubKey === 'settings') return <SettingsPage />;
        if (selectedSubKey === 'invalid-images') return <InvalidImagesPage />;
        return <GalleryPage subTab={selectedSubKey as "recent" | "all" | "galleries" | undefined} />;
      case 'booru':
        if (selectedBooruSubKey === 'posts') return <BooruPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} onCharacterClick={navigateToCharacter} suspended={baseSuspended} />;
        if (selectedBooruSubKey === 'popular') return <BooruPopularPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} suspended={baseSuspended} />;
        if (selectedBooruSubKey === 'pools') return <BooruPoolsPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} suspended={baseSuspended} />;
        if (selectedBooruSubKey === 'forums') return <BooruForumPage onUserClick={navigateToUser} suspended={baseSuspended} />;
        if (selectedBooruSubKey === 'user-profile') return <BooruUserPage onTagClick={navigateToTagSearch} />;
        if (selectedBooruSubKey === 'favorites') return <BooruFavoritesPage onTagClick={navigateToTagSearch} suspended={baseSuspended} />;
        if (selectedBooruSubKey === 'server-favorites') return <BooruServerFavoritesPage onTagClick={navigateToTagSearch} suspended={baseSuspended} />;
        if (selectedBooruSubKey === 'favorite-tags') return <FavoriteTagsPage onTagClick={navigateToTagSearch} />;
        if (selectedBooruSubKey === 'blacklisted-tags') return <BlacklistedTagsPage />;
        if (selectedBooruSubKey === 'downloads') return <BooruDownloadPage />;
        if (selectedBooruSubKey === 'bulk-download') return <BooruBulkDownloadPage />;
        if (selectedBooruSubKey === 'saved-searches') return <BooruSavedSearchesPage onRunSearch={handleSavedSearchRun} />;
        if (selectedBooruSubKey === 'booru-settings') return <BooruSettingsPage />;
        if (selectedBooruSubKey === 'settings') return <SettingsPage />;
        return <BooruPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} onCharacterClick={navigateToCharacter} suspended={baseSuspended} />;
      case 'google':
        if (selectedGoogleSubKey === 'gdrive') return <GoogleDrivePage />;
        if (selectedGoogleSubKey === 'gphotos') return <GooglePhotosPage />;
        if (selectedGoogleSubKey === 'gemini') return <GeminiPage />;
        return <GoogleDrivePage />;
      default:
        return <BooruPage onTagClick={navigateToTagSearch} onArtistClick={navigateToArtist} onCharacterClick={navigateToCharacter} suspended={baseSuspended} />;
    }
  };

  // 是否有叠加页面（导航栈非空时表示有叠加页面）
  const hasOverlay = navigationStack.length > 0;

  /** Suspense 加载中占位 */
  const suspenseFallback = (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
      <div style={{ color: colors.textTertiary }}>加载中...</div>
    </div>
  );

  /** 渲染基础页面内容（不含叠加页面） */
  const renderBaseContent = () => {
    if (loading) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
          <h2 style={{ color: colors.textTertiary, fontWeight: 400, fontSize: fontSize.lg }}>{t('app.initializing')}</h2>
        </div>
      );
    }

    const basePage = renderBasePage();
    const hasStack = navigationStack.length > 0;

    // 始终保持一致的 React 树结构，避免基础页面因树结构变化而被卸载/重新挂载
    // 导航栈非空时，基础页面用 display:none 隐藏但保持挂载（保留状态）
    return (
      <>
        <div style={hasStack ? { display: 'none' } : undefined}>{basePage}</div>
        {navigationStack.map((entry, index) => {
          const isTop = index === navigationStack.length - 1;
          return (
            <div key={`nav-${entry.type}-${index}`} style={isTop ? undefined : { display: 'none' }}>
              {renderNavigationEntry(entry, index)}
            </div>
          );
        })}
      </>
    );
  };

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
                <div
                  onClick={() => setSidebarWidth(isCollapsed ? layout.sidebarWidth : SIDEBAR_MIN)}
                  title={isCollapsed ? '展开侧边栏' : '折叠侧边栏'}
                  style={{ width: 32, height: 32, borderRadius: 8, background: `linear-gradient(135deg, ${colors.primary}, ${colors.accent})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontSize: 16, fontWeight: 700, flexShrink: 0, cursor: 'pointer', userSelect: 'none' as const }}
                >Y</div>
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
            selectedKey={selectedKey}
            onSelect={(key) => {
              console.log(`[App] 主菜单切换: ${key}`);
              setSelectedKey(key); setNavigationStack([]);
              setActivePinnedId(null);
              if (key === 'gallery') setSelectedSubKey('recent');
              if (key === 'google') setSelectedGoogleSubKey('gdrive');
            }}
            onReorder={(keys) => { setMainOrder(keys); saveMenuOrder('main', keys); }}
            isCollapsed={isCollapsed}
            isDark={isDark}
            style={{ borderBottom: `1px solid ${colors.separator}`, paddingBottom: spacing.xs }}
          />
        </div>

        {/* ── 第二段：二级菜单（随一级更改，可滚动） ── */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* 分区标签 */}
          {!isCollapsed && (
            <div style={{ padding: `${spacing.md}px ${spacing.lg}px ${spacing.xs}px`, fontSize: 10, fontWeight: 700, color: colors.textTertiary, textTransform: 'uppercase' as const, letterSpacing: '1px', flexShrink: 0 }}>
              {selectedKey === 'gallery' ? t('menu.browse') : selectedKey === 'booru' ? 'BOORU' : 'GOOGLE'}
            </div>
          )}
          {/* 可滚动菜单列表 */}
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
            {selectedKey === 'gallery' && (
              <SortableMenu
                items={orderedGalleryItems}
                selectedKey={activePinnedId ? '' : selectedSubKey}
                onSelect={(key) => { console.log(`[App] 图库子菜单: ${key}`); setSelectedSubKey(key); if (pinnedItems.some(p => p.section === 'gallery' && p.key === key)) { handlePinnedClick({ section: 'gallery', key }); } else { setActivePinnedId(null); } }}
                onReorder={(keys) => { setGalleryOrder(keys); saveMenuOrder('gallery', keys); }}
                isCollapsed={isCollapsed}
                isDark={isDark}
                pinnedKeys={pinnedItems.filter(p => p.section === 'gallery').map(p => p.key)}
                canAddPin={pinnedItems.length < 5}
                onPinToggle={(key, cur) => cur ? unpinItem('gallery', key) : pinItem('gallery', key)}
              />
            )}
            {selectedKey === 'booru' && (
              <SortableMenu
                items={orderedBooruItems}
                selectedKey={activePinnedId ? '' : selectedBooruSubKey}
                onSelect={(key) => { console.log(`[App] Booru子菜单: ${key}`); setSelectedBooruSubKey(key); setNavigationStack([]); if (pinnedItems.some(p => p.section === 'booru' && p.key === key)) { handlePinnedClick({ section: 'booru', key }); } else { setActivePinnedId(null); } }}
                onReorder={(keys) => { setBooruOrder(keys); saveMenuOrder('booru', keys); }}
                isCollapsed={isCollapsed}
                isDark={isDark}
                pinnedKeys={pinnedItems.filter(p => p.section === 'booru').map(p => p.key)}
                canAddPin={pinnedItems.length < 5}
                onPinToggle={(key, cur) => cur ? unpinItem('booru', key) : pinItem('booru', key)}
              />
            )}
            {selectedKey === 'google' && (
              <SortableMenu
                items={orderedGoogleItems}
                selectedKey={activePinnedId ? '' : selectedGoogleSubKey}
                onSelect={(key) => { console.log(`[App] 应用子菜单: ${key}`); setSelectedGoogleSubKey(key); if (pinnedItems.some(p => p.section === 'google' && p.key === key)) { handlePinnedClick({ section: 'google', key }); } else { setActivePinnedId(null); } }}
                onReorder={(keys) => { setGoogleOrder(keys); saveMenuOrder('google', keys); }}
                isCollapsed={isCollapsed}
                isDark={isDark}
                pinnedKeys={pinnedItems.filter(p => p.section === 'google').map(p => p.key)}
                canAddPin={pinnedItems.length < 5}
                onPinToggle={(key, cur) => cur ? unpinItem('google', key) : pinItem('google', key)}
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
              const isCached = mountedPinnedIds.has(pinId);
              const activeBg    = isDark ? 'rgba(129,140,248,0.15)' : 'rgba(79,70,229,0.08)';
              const activeColor = isDark ? '#818CF8' : '#4F46E5';
              const normalColor = isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.55)';
              const itemContent = (
                <Dropdown
                  trigger={['contextMenu']}
                  menu={{
                    items: [
                      { key: 'close', label: '关闭', disabled: !mountedPinnedIds.has(`${pin.section}:${pin.key}`) },
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
            const handleSettingsClick = () => { if (selectedKey === 'booru') setSelectedBooruSubKey('settings'); else setSelectedSubKey('settings'); };
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
          {/* 普通滚动容器（嵌入页或查看固定页面时隐藏，但保持挂载以维持状态） */}
          <div
            className="ios-page-enter noise-bg"
            key={`${selectedKey}-${selectedSubKey}-${selectedBooruSubKey}`}
            style={{
              padding: `${spacing.lg}px ${spacing.lg}px`,
              overflowY: 'auto',
              overflowX: 'hidden',
              height: '100%',
              display: (isEmbedPage || activePinnedId) ? 'none' : undefined,
            }}
          >
            {!isEmbedPage && !activePinnedId && (
              <Suspense fallback={suspenseFallback}>
                {renderBaseContent()}
              </Suspense>
            )}
          </div>

          {/* 固定页面缓存层：首次打开后保持挂载，切换时 display:none 隐藏 */}
          {pinnedItems
            .filter(p => mountedPinnedIds.has(`${p.section}:${p.key}`))
            .map(pin => {
              const pinId = `${pin.section}:${pin.key}`;
              const isActive = activePinnedId === pinId;
              const isEmbed = pin.section === 'google' && (pin.key === 'gdrive' || pin.key === 'gphotos' || pin.key === 'gemini');
              if (isEmbed) {
                return (
                  <div key={`pinned-${pinId}`} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', zIndex: 1, display: isActive ? undefined : 'none' }}>
                    <Suspense fallback={suspenseFallback}>{renderPageForPin(pin)}</Suspense>
                  </div>
                );
              }
              return (
                <div key={`pinned-${pinId}`} className="noise-bg" style={{ padding: `${spacing.lg}px`, overflowY: 'auto', overflowX: 'hidden', height: '100%', display: isActive ? undefined : 'none' }}>
                  <Suspense fallback={suspenseFallback}>{renderPageForPin(pin)}</Suspense>
                </div>
              );
            })
          }
        </Content>

        {/* 嵌入式全屏覆盖层：
            - position:absolute + top/bottom 确定像素高度（不依赖 height:100% 链）
            - 直接调 renderBasePage()，跳过 renderBaseContent() 里无高度的包装 div */}
        {isEmbedPage && (
          <div
            className="ios-page-enter"
            key={`embed-${selectedKey}-${selectedGoogleSubKey}`}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              overflow: 'hidden',
              zIndex: 1,
            }}
          >
            <Suspense fallback={suspenseFallback}>
              {renderBasePage()}
            </Suspense>
          </div>
        )}
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
