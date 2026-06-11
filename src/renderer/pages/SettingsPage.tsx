/**
 * 设置页面 — iOS Grouped Inset 风格
 */
import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Switch, Select, Spin, Segmented, Space, Popconfirm, App, Alert, Empty, Tooltip } from 'antd';
import { SaveOutlined, FolderOutlined, PlusOutlined, DeleteOutlined, ScanOutlined, BulbOutlined, InboxOutlined, ExportOutlined, StopOutlined, CopyOutlined } from '@ant-design/icons';
import { useTheme, ThemeMode } from '../hooks/useTheme';
import { useRendererAppEvent } from '../hooks/useRendererAppEvent';
import { useLocale, type LocaleType } from '../locales';
import { colors, spacing, radius, fontSize, shadows } from '../styles/tokens';
import type { ApiLogEntry, ApiServiceConfig, ApiServicePermissionKey, ApiServiceStatus, UpdateCheckResult } from '../../shared/types';
import pkgJson from '../../../package.json';
import { IgnoredFoldersModal } from '../components/IgnoredFoldersModal';

const { Option } = Select;

interface GalleryFolder {
  path: string;
  name: string;
  autoScan: boolean;
  recursive: boolean;
  extensions: string[];
}

const API_PERMISSION_LABELS: Record<ApiServicePermissionKey, string> = {
  galleryRead: '图集读取',
  imageRead: '图片元数据读取',
  imageBinary: '图片内容访问',
  booruRead: 'Booru 只读',
  booruWrite: 'Booru 业务写操作',
  favoriteTagsRead: '收藏标签只读',
  favoriteTagsWrite: '收藏标签写操作',
  downloadsRead: '下载只读',
  downloadsControl: '下载控制',
  eventsSubscribe: '事件订阅',
  apiLogsRead: 'API 日志查看',
};

type ApiServicePatch = Partial<Omit<ApiServiceConfig, 'permissions' | 'logs'>> & {
  permissions?: Partial<ApiServiceConfig['permissions']>;
  logs?: Partial<ApiServiceConfig['logs']>;
};

const mergeApiServicePatch = (config: ApiServiceConfig, patch: ApiServicePatch): ApiServiceConfig => ({
  ...config,
  ...patch,
  permissions: patch.permissions ? { ...config.permissions, ...patch.permissions } : config.permissions,
  logs: patch.logs ? { ...config.logs, ...patch.logs } : config.logs,
});

/** iOS 风格分组容器 */
const SettingsGroup: React.FC<{
  title?: string;
  footer?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ title, footer, children, style }) => (
  <div style={{ marginBottom: spacing.xxl, ...style }}>
    {title && (
      <div style={{
        padding: `0 ${spacing.lg}px ${spacing.sm}px`,
        fontSize: fontSize.md,
        fontWeight: 400,
        color: colors.textTertiary,
        letterSpacing: '0.3px',
      }}>
        {title}
      </div>
    )}
    <div style={{
      background: colors.bgBase,
      borderRadius: radius.md,
      overflow: 'hidden',
      boxShadow: shadows.subtle,
      border: `1px solid ${colors.borderCard}`,
    }}>
      {children}
    </div>
    {footer && (
      <div style={{
        padding: `${spacing.sm}px ${spacing.lg}px 0`,
        fontSize: fontSize.sm,
        color: colors.textTertiary,
        lineHeight: '16px',
      }}>
        {footer}
      </div>
    )}
  </div>
);

/** iOS 风格列表行 */
const SettingsRow: React.FC<{
  label: string | React.ReactNode;
  description?: React.ReactNode;
  extra?: React.ReactNode;
  isLast?: boolean;
  onClick?: () => void;
}> = ({ label, description, extra, isLast = false, onClick }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: `${spacing.md}px ${spacing.lg}px`,
      minHeight: 44,
      cursor: onClick ? 'pointer' : 'default',
      borderBottom: isLast ? 'none' : `0.5px solid ${colors.separator}`,
      marginLeft: isLast ? 0 : 0,
      transition: 'background 0.15s',
    }}
    onClick={onClick}
    // 可点击行的键盘可达性：Enter / Space 等同点击
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    onKeyDown={onClick ? (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    } : undefined}
    onMouseEnter={(e) => {
      if (onClick) e.currentTarget.style.background = colors.bgLight;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = 'transparent';
    }}
  >
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        fontSize: fontSize.base,
        color: colors.textPrimary,
        fontWeight: 400,
      }}>
        {label}
      </div>
      {description && (
        <div style={{
          fontSize: fontSize.sm,
          color: colors.textTertiary,
          marginTop: 2,
        }}>
          {description}
        </div>
      )}
    </div>
    {extra && <div style={{ marginLeft: spacing.md, flexShrink: 0 }}>{extra}</div>}
  </div>
);

/** 缓存管理分组 */
const CacheManagementGroup: React.FC = () => {
  const { t } = useLocale();
  // antd v5 上下文化提示，替代静态 message
  const { message } = App.useApp();
  const [cacheStats, setCacheStats] = useState<{ sizeMB: number; fileCount: number } | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [clearing, setClearing] = useState(false);

  const loadStats = async () => {
    if (!window.electronAPI) return;
    setLoadingStats(true);
    try {
      const result = await window.electronAPI.booru.getCacheStats();
      if (result.success && result.data) setCacheStats(result.data);
    } catch (error) {
      console.error('[CacheManagementGroup] 获取缓存统计失败:', error);
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => { loadStats(); }, []);

  const handleClearCache = async () => {
    if (!window.electronAPI) return;
    setClearing(true);
    try {
      const result = await window.electronAPI.booru.clearCache();
      if (result.success && result.data) {
        const d = result.data;
        message.success(`已清除 ${d.deletedCount} 个缓存文件，释放 ${d.freedMB.toFixed(1)} MB`);
        await loadStats();
      } else {
        message.error('清除缓存失败: ' + result.error);
      }
    } catch (error) {
      message.error('清除缓存失败');
    } finally {
      setClearing(false);
    }
  };

  return (
    <SettingsGroup title={t('settings.cacheManagement')}>
      <SettingsRow
        label={t('settings.cacheSize')}
        description={cacheStats ? `${cacheStats.fileCount} ${t('settings.cacheFiles')}` : undefined}
        extra={
          loadingStats ? (
            <Spin size="small" />
          ) : (
            <span style={{ color: colors.textTertiary }}>
              {cacheStats ? `${cacheStats.sizeMB.toFixed(1)} MB` : '-'}
            </span>
          )
        }
      />
      <SettingsRow
        label={<span style={{ color: colors.danger }}>{t('settings.clearCache')}</span>}
        description={t('settings.clearCacheDesc')}
        isLast
        extra={
          <Button
            size="small"
            danger
            loading={clearing}
            onClick={handleClearCache}
          >
            {t('settings.clearCache')}
          </Button>
        }
      />
    </SettingsGroup>
  );
};

export const SettingsPage: React.FC = () => {
  // antd v5 上下文化提示，替代静态 message / Modal（App.tsx 已包 <App>）
  const { message, modal } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [folders, setFolders] = useState<GalleryFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState<string | null>(null);
  const [proxyForm] = Form.useForm();
  const { themeMode, setThemeMode } = useTheme();
  const { t, locale, setLocale } = useLocale();
  const [activeTab, setActiveTab] = useState<'general' | 'proxy' | 'api' | 'about'>('general');

  // 表单值状态（用于即时渲染）
  const [downloadPath, setDownloadPath] = useState('');
  const [thumbnailSize, setThumbnailSize] = useState(800);
  const [thumbnailQuality, setThumbnailQuality] = useState(92);
  const [thumbnailEffort, setThumbnailEffort] = useState(3);
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyProtocol, setProxyProtocol] = useState('http');
  const [proxyHost, setProxyHost] = useState('127.0.0.1');
  const [proxyPort, setProxyPort] = useState('7890');
  const [exportingBackup, setExportingBackup] = useState(false);
  const [importingBackup, setImportingBackup] = useState(false);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [ignoredModalOpen, setIgnoredModalOpen] = useState(false);
  const [apiConfig, setApiConfig] = useState<ApiServiceConfig | null>(null);
  const [apiStatus, setApiStatus] = useState<ApiServiceStatus | null>(null);
  const [apiLogs, setApiLogs] = useState<ApiLogEntry[]>([]);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [apiPortDraft, setApiPortDraft] = useState('');
  // API 服务配置加载失败信息（null 表示无错误）
  const [apiLoadError, setApiLoadError] = useState<string | null>(null);
  // 连通性测试进行中的目标（防止重复触发）
  const [testing, setTesting] = useState<'baidu' | 'google' | null>(null);

  // bug9：通知 / 桌面行为状态。mount 时通过新 preload API 拉取，setter 立即写回主进程。
  // 使用 optimistic update：先 setState 给 UI 即时反馈，setter 失败再 load 回滚。
  const [notif, setNotifState] = useState<{
    enabled: boolean;
    byStatus: { completed: boolean; failed: boolean; allSkipped: boolean };
    singleDownload: { enabled: boolean };
    clickAction: 'focus' | 'openDownloadHub' | 'openSessionDetail';
  }>({
    enabled: true,
    byStatus: { completed: true, failed: true, allSkipped: true },
    singleDownload: { enabled: false },
    clickAction: 'openDownloadHub',
  });
  const [desktop, setDesktopState] = useState<{
    closeAction: 'hide-to-tray' | 'quit' | 'ask';
    autoLaunch: boolean;
    startMinimized: boolean;
    hardwareAcceleration: boolean;
  }>({
    closeAction: 'hide-to-tray',
    autoLaunch: false,
    startMinimized: false,
    hardwareAcceleration: false,
  });

  const handleCheckForUpdate = async () => {
    if (!window.electronAPI) return;
    setUpdateChecking(true);
    try {
      const res = await window.electronAPI.system.checkForUpdate();
      if (res.success && res.data) {
        setUpdateResult(res.data);
      } else {
        setUpdateResult({
          currentVersion: '-',
          latestVersion: null,
          hasUpdate: false,
          releaseUrl: null,
          releaseName: null,
          publishedAt: null,
          error: res.error || '检查失败',
          checkedAt: new Date().toISOString(),
        });
      }
    } finally {
      setUpdateChecking(false);
    }
  };

  useEffect(() => {
    console.log('[SettingsPage] 组件挂载，加载配置');
    loadConfig();
    // bug9：额外拉一次通知 / 桌面行为配置
    void loadNotificationsAndDesktop();
  }, []);

  const loadNotificationsAndDesktop = async () => {
    if (!window.electronAPI?.config) return;
    try {
      const [notifRes, desktopRes] = await Promise.all([
        window.electronAPI.config.getNotifications?.(),
        window.electronAPI.config.getDesktop?.(),
      ]);
      if (notifRes?.success && notifRes.data) setNotifState(notifRes.data);
      if (desktopRes?.success && desktopRes.data) setDesktopState(desktopRes.data);
    } catch (err) {
      console.warn('[SettingsPage] 加载通知/桌面配置失败:', err);
    }
  };

  // 通知开关的 optimistic update：先改本地 state，再调 setNotifications
  // key 支持扁平点路径（如 'byStatus.completed' / 'singleDownload.enabled'）与顶层字段
  const setNotif = async (key: string, value: any) => {
    setNotifState(prev => {
      const next = { ...prev, byStatus: { ...prev.byStatus }, singleDownload: { ...prev.singleDownload } };
      if (key === 'enabled') next.enabled = value;
      else if (key === 'clickAction') next.clickAction = value;
      else if (key === 'singleDownload.enabled') next.singleDownload.enabled = value;
      else if (key === 'byStatus.completed') next.byStatus.completed = value;
      else if (key === 'byStatus.failed') next.byStatus.failed = value;
      else if (key === 'byStatus.allSkipped') next.byStatus.allSkipped = value;
      return next;
    });
    try {
      const patch: any = {};
      if (key === 'enabled') patch.enabled = value;
      else if (key === 'clickAction') patch.clickAction = value;
      else if (key === 'singleDownload.enabled') patch.singleDownload = { enabled: value };
      else if (key.startsWith('byStatus.')) {
        patch.byStatus = { [key.split('.')[1]]: value };
      }
      const res = await window.electronAPI?.config?.setNotifications?.(patch);
      if (!res?.success) {
        message.error(res?.error || '保存通知配置失败');
        await loadNotificationsAndDesktop();
      }
    } catch (err) {
      console.error('[SettingsPage] setNotifications 异常:', err);
      await loadNotificationsAndDesktop();
    }
  };

  const setDesktop = async (key: 'closeAction' | 'autoLaunch' | 'startMinimized' | 'hardwareAcceleration', value: any) => {
    setDesktopState(prev => ({ ...prev, [key]: value }));
    try {
      const patch: any = { [key]: value };
      const res = await window.electronAPI?.config?.setDesktop?.(patch);
      if (!res?.success) {
        message.error(res?.error || '保存桌面配置失败');
        await loadNotificationsAndDesktop();
      }
    } catch (err) {
      console.error('[SettingsPage] setDesktop 异常:', err);
      await loadNotificationsAndDesktop();
    }
  };

  const loadApiService = async () => {
    if (!window.electronAPI?.apiService) return;
    try {
      const [configRes, statusRes, logsRes] = await Promise.all([
        window.electronAPI.apiService.getConfig(),
        window.electronAPI.apiService.getStatus(),
        window.electronAPI.apiService.getLogs({ limit: 10, offset: 0 }),
      ]);
      if (configRes?.success && configRes.data) {
        setApiConfig(configRes.data);
        setApiPortDraft(String(configRes.data.port));
        setApiLoadError(null);
      } else {
        // 配置拉取失败：记录错误用于渲染重试入口
        setApiLoadError(configRes?.error || '加载 API 服务配置失败');
      }
      if (statusRes?.success && statusRes.data) setApiStatus(statusRes.data);
      if (logsRes?.success && logsRes.data) setApiLogs(logsRes.data.items || []);
    } catch (err) {
      console.warn('[SettingsPage] 加载 API 服务配置失败:', err);
      setApiLoadError(err instanceof Error ? err.message : '加载 API 服务配置失败');
    }
  };

  const saveApiServicePatch = async (patch: ApiServicePatch) => {
    if (!window.electronAPI?.apiService) return;
    const previous = apiConfig;
    if (previous) {
      setApiConfig(mergeApiServicePatch(previous, patch));
    }
    let saved = false;
    try {
      const res = await window.electronAPI.apiService.saveConfig(patch);
      if (!res?.success) {
        message.error(res?.error || '保存 API 服务配置失败');
      } else {
        saved = true;
      }
    } catch (err) {
      message.error('保存 API 服务配置失败');
    } finally {
      await loadApiService();
      if (!saved && previous) setApiConfig(previous);
    }
  };

  const saveApiServiceNestedPatch = async (
    key: 'permissions' | 'logs',
    value: Partial<ApiServiceConfig['permissions']> | Partial<ApiServiceConfig['logs']>,
  ) => {
    await saveApiServicePatch({ [key]: value } as ApiServicePatch);
  };

  const commitApiServicePortDraft = async () => {
    if (!apiConfig) return;
    const nextPort = Number(apiPortDraft);
    if (!Number.isInteger(nextPort) || nextPort < 1 || nextPort > 65535) {
      message.error('端口必须是 1-65535 的整数');
      setApiPortDraft(String(apiConfig.port));
      return;
    }
    if (nextPort === apiConfig.port) return;
    await saveApiServicePatch({ port: nextPort });
  };

  const generateApiServiceKey = async () => {
    if (!window.electronAPI?.apiService) return;
    try {
      const result = await window.electronAPI.apiService.generateKey();
      if (!result?.success) {
        message.error(result?.error || '生成 API Key 失败');
      }
    } catch (err) {
      message.error('生成 API Key 失败');
    } finally {
      await loadApiService();
    }
  };

  useEffect(() => {
    if (activeTab !== 'proxy') return;
    proxyForm.setFieldsValue({
      proxyEnabled,
      proxyProtocol,
      proxyHost,
      proxyPort: Number(proxyPort),
    });
  }, [activeTab, proxyEnabled, proxyProtocol, proxyHost, proxyPort, proxyForm]);

  useEffect(() => {
    if (activeTab !== 'api') return;
    void loadApiService();
  }, [activeTab]);

  const loadConfig = async () => {
    if (!window.electronAPI) return;
    console.log('[SettingsPage] 开始加载配置');
    try {
      setLoading(true);
      const result = await window.electronAPI.config.get();
      if (result.success && result.data) {
        const config = result.data;
        console.log('[SettingsPage] 配置加载成功');
        setFolders(config.galleries?.folders || []);
        const dp = config.downloads?.path || './downloads';
        const ts = config.thumbnails?.maxWidth || 800;
        const tq = config.thumbnails?.quality || 92;
        const te = config.thumbnails?.effort ?? 3;
        setDownloadPath(dp);
        setThumbnailSize(ts);
        setThumbnailQuality(tq);
        setThumbnailEffort(te);

        const proxy = config.network?.proxy || { enabled: false, protocol: 'http', host: '127.0.0.1', port: 7890 };
        setProxyEnabled(proxy.enabled);
        setProxyProtocol(proxy.protocol || 'http');
        setProxyHost(proxy.host || '127.0.0.1');
        setProxyPort(String(proxy.port || 7890));
      }
    } catch (error) {
      console.error('Failed to load config:', error);
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  useRendererAppEvent(['config:changed', 'api-service:status-changed', 'app:data-restored'], (event) => {
    if (event.type === 'api-service:status-changed') {
      setApiStatus(event.payload);
      return;
    }

    if (event.type === 'app:data-restored') {
      void loadConfig();
      void loadNotificationsAndDesktop();
      if (activeTab === 'api') void loadApiService();
      return;
    }

    const sections = event.payload.sections;
    const hasSection = (name: string) =>
      sections.some(section => section === name || section.startsWith(`${name}.`));

    if (hasSection('downloads') || hasSection('thumbnails') || hasSection('network') || hasSection('galleries')) {
      void loadConfig();
    }

    if (hasSection('notifications') || hasSection('desktop')) {
      void loadNotificationsAndDesktop();
    }

    if (hasSection('apiService') && activeTab === 'api') {
      void loadApiService();
    }
  });

  const handleAddFolder = async () => {
    if (!window.electronAPI) { message.error('系统功能不可用'); return; }
    try {
      const result = await window.electronAPI.system.selectFolder();
      if (!result.success || !result.data) return;
      const folderPath = result.data;
      if (folders.some(f => f.path === folderPath)) { message.warning('该文件夹已存在'); return; }
      const folderName = folderPath.split(/[/\\]/).pop() || '未命名文件夹';
      const newFolder: GalleryFolder = {
        path: folderPath, name: folderName, autoScan: true, recursive: true,
        extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
      };
      const updatedFolders = [...folders, newFolder];
      setFolders(updatedFolders);
      await saveFoldersConfig(updatedFolders);
      modal.confirm({
        title: '扫描子文件夹',
        content: `是否立即扫描 "${folderName}" 下的所有子文件夹并创建图集？`,
        okText: '立即扫描', cancelText: '稍后扫描',
        onOk: () => { void scanSubfolders(folderPath, newFolder.extensions); }
      });
    } catch (error) {
      console.error('Failed to add folder:', error);
      message.error('添加文件夹失败');
    }
  };

  const scanSubfolders = async (rootPath: string, extensions: string[]) => {
    if (!window.electronAPI) return;
    try {
      setScanning(rootPath);
      message.loading({ content: '正在后台扫描子文件夹...', key: 'scanning', duration: 0 });
      const result = await window.electronAPI.gallery.scanSubfolders(rootPath, extensions);
      if (result.success && result.data) {
        const d: any = result.data;
        message.success({ content: `扫描完成：创建图集 ${d.created} 个，跳过 ${d.skipped} 个，导入图片 ${d.imported ?? 0} 张`, key: 'scanning', duration: 5 });
      } else {
        message.error({ content: result.error || '扫描失败', key: 'scanning', duration: 3 });
      }
    } catch (error) {
      message.error({ content: '扫描失败', key: 'scanning', duration: 3 });
    } finally {
      setScanning(null);
    }
  };

  // 删除文件夹：确认由列表行的 Popconfirm 负责，这里直接执行删除
  const handleDeleteFolder = async (index: number) => {
    const updated = folders.filter((_, i) => i !== index);
    setFolders(updated);
    await saveFoldersConfig(updated);
    message.success('已删除文件夹');
  };

  const saveFoldersConfig = async (foldersToSave: GalleryFolder[]) => {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.config.updateGalleryFolders(foldersToSave);
      if (!result.success) message.error(result.error || '保存配置失败');
    } catch (error) {
      message.error('保存配置失败');
    }
  };

  const handleSelectDownloadPath = async () => {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.system.selectFolder();
      if (result.success && result.data) {
        setDownloadPath(result.data);
      }
    } catch (error) {
      message.error('选择路径失败');
    }
  };

  const handleSave = async () => {
    console.log('[SettingsPage] 保存所有设置');
    setSaving(true);
    try {
      if (!window.electronAPI) { message.error('系统功能不可用'); return; }
      const configResult = await window.electronAPI.config.get();
      if (!configResult.success || !configResult.data) { message.error('获取配置失败'); return; }

      const currentProxy = configResult.data.network?.proxy || {
        enabled: false,
        protocol: 'http',
        host: '127.0.0.1',
        port: 7890,
      };

      let nextProxy = {
        enabled: currentProxy.enabled,
        protocol: currentProxy.protocol,
        host: currentProxy.host,
        port: currentProxy.port,
      };
      if (activeTab === 'proxy') {
        await proxyForm.validateFields();
        const proxyValues = proxyForm.getFieldsValue(true);
        nextProxy = { ...nextProxy };
        if (proxyValues.proxyEnabled !== undefined) nextProxy.enabled = proxyValues.proxyEnabled;
        if (proxyValues.proxyProtocol !== undefined) nextProxy.protocol = proxyValues.proxyProtocol;
        if (proxyValues.proxyHost !== undefined) nextProxy.host = proxyValues.proxyHost;
        if (proxyValues.proxyPort !== undefined) nextProxy.port = Number(proxyValues.proxyPort);
      }

      const updatedConfig = {
        downloads: { path: downloadPath },
        thumbnails: { maxWidth: thumbnailSize, maxHeight: thumbnailSize, quality: thumbnailQuality, effort: thumbnailEffort },
        network: { proxy: nextProxy },
      };
      const result = await window.electronAPI.config.save(updatedConfig);
      if (result.success) { message.success(t('settings.saveSuccess')); }
      else { message.error(result.error || t('settings.saveFailed')); }
    } catch (error) {
      message.error(t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleExportBackup = async () => {
    if (!window.electronAPI) return;
    setExportingBackup(true);
    try {
      const result = await window.electronAPI.system.exportBackup();
      if (result.success && result.data) {
        message.success(`备份已导出到 ${result.data.path}`);
      } else if (result.error && result.error !== '已取消导出') {
        message.error(result.error);
      }
    } catch (error) {
      console.error('[SettingsPage] 导出备份失败:', error);
      message.error('导出备份失败');
    } finally {
      setExportingBackup(false);
    }
  };

  const runImportBackup = async (mode: 'merge' | 'replace') => {
    if (!window.electronAPI) return;
    setImportingBackup(true);
    try {
      const result = await window.electronAPI.system.importBackup(mode);
      if (result.success && result.data) {
        message.success(`备份已恢复（${mode === 'merge' ? '合并' : '完全替换'}），来源 ${result.data.path}`);
        await loadConfig();
      } else if (result.error && result.error !== '已取消导入') {
        message.error(result.error);
      }
    } catch (error) {
      console.error('[SettingsPage] 导入备份失败:', error);
      message.error(mode === 'merge' ? '导入备份失败' : '完全替换恢复失败');
    } finally {
      setImportingBackup(false);
    }
  };

  const handleImportBackup = async () => {
    if (!window.electronAPI) return;
    modal.confirm({
      title: '导入应用备份',
      content: '推荐使用“合并恢复”，仅补充或覆盖同 ID 数据；若需要清空当前站点/收藏/标签/搜索数据，请使用下方的“完全替换恢复”按钮。',
      okText: '合并恢复',
      cancelText: '取消',
      okButtonProps: { icon: <InboxOutlined /> },
      onOk: async () => runImportBackup('merge')
    });
  };

  const handleReplaceBackup = async () => {
    modal.confirm({
      title: '完全替换恢复',
      content: '这会先清空当前站点配置、收藏、标签、保存的搜索和搜索历史，再从备份文件恢复。仅在明确需要回滚到备份状态时使用。',
      okText: '继续替换',
      cancelText: '取消',
      okButtonProps: { danger: true, icon: <InboxOutlined /> },
      onOk: async () => runImportBackup('replace')
    });
  };

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: `0 ${spacing.lg}px` }}>
      {/* ===== 子页面切换 ===== */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: spacing.xl }}>
        <Segmented
          value={activeTab}
          onChange={(value) => setActiveTab(value as 'general' | 'proxy' | 'api' | 'about')}
          options={[
            { label: t('settings.tabGeneral'), value: 'general' },
            { label: t('settings.tabProxy'), value: 'proxy' },
            { label: 'API 服务', value: 'api' },
            { label: t('settings.tabAbout'), value: 'about' },
          ]}
        />
      </div>

      {/* ===== 通用配置 ===== */}
      {activeTab === 'general' && (
        <>
          {/* 图库文件夹 */}
          <SettingsGroup
            title={t('settings.galleryFolders')}
            footer={t('settings.galleryFoldersFooter')}
          >
            <Spin spinning={loading}>
              {folders.length === 0 ? (
                <div style={{ padding: `${spacing.xxl}px` }}>
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t('settings.noFolders')}
                  >
                    <Button type="primary" icon={<PlusOutlined />} onClick={handleAddFolder}>
                      {t('settings.addFolder')}
                    </Button>
                  </Empty>
                </div>
              ) : (
                folders.map((item, index) => (
                  <SettingsRow
                    key={item.path}
                    label={item.name}
                    description={item.path}
                    isLast={index === folders.length - 1}
                    extra={
                      <Space size={spacing.sm}>
                        <Button
                          type="text"
                          size="small"
                          icon={<ScanOutlined />}
                          loading={scanning === item.path}
                          onClick={() => scanSubfolders(item.path, item.extensions)}
                          style={{ color: colors.primary }}
                        >
                          {t('settings.scanFolder')}
                        </Button>
                        <Popconfirm
                          title={t('settings.deleteFolderConfirm')}
                          onConfirm={() => handleDeleteFolder(index)}
                          okText="删除"
                          cancelText="取消"
                        >
                          <Button
                            type="text"
                            size="small"
                            icon={<DeleteOutlined />}
                            danger
                          >
                            {t('settings.deleteFolder')}
                          </Button>
                        </Popconfirm>
                      </Space>
                    }
                  />
                ))
              )}
            </Spin>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: `${spacing.sm}px ${spacing.lg}px`,
              borderTop: `0.5px solid ${colors.separator}`,
            }}>
              <Button
                type="link"
                icon={<PlusOutlined />}
                onClick={handleAddFolder}
                style={{ padding: 0, color: colors.primary, fontWeight: 500 }}
              >
                {t('settings.addFolder')}
              </Button>
              <Button
                type="link"
                icon={<StopOutlined />}
                onClick={() => setIgnoredModalOpen(true)}
                style={{ padding: 0, color: colors.textSecondary, fontWeight: 500 }}
              >
                {t('settings.ignoredFolders')}
              </Button>
            </div>
          </SettingsGroup>

          <IgnoredFoldersModal open={ignoredModalOpen} onClose={() => setIgnoredModalOpen(false)} />

          {/* 下载设置 */}
          <SettingsGroup title={t('settings.download')}>
            <SettingsRow
              label={t('settings.downloadPath')}
              description={downloadPath || t('settings.notSet')}
              isLast
              onClick={handleSelectDownloadPath}
              extra={
                <FolderOutlined style={{ color: colors.textTertiary, fontSize: 16 }} />
              }
            />
          </SettingsGroup>

          {/* 缩略图设置 */}
          <SettingsGroup title={t('settings.thumbnails')} footer={t('settings.thumbnailsFooter')}>
            <SettingsRow
              label={t('settings.thumbnailSize')}
              extra={
                <Select
                  value={thumbnailSize}
                  onChange={(v) => setThumbnailSize(v)}
                  style={{ width: 140 }}
                  variant="borderless"
                >
                  <Option value={300}>{t('settings.sizeSmall')}</Option>
                  <Option value={400}>{t('settings.sizeMedium')}</Option>
                  <Option value={600}>{t('settings.sizeLarge')}</Option>
                  <Option value={800}>{t('settings.sizeHD')}</Option>
                  <Option value={1000}>{t('settings.sizeUHD')}</Option>
                </Select>
              }
            />
            <SettingsRow
              label={t('settings.thumbnailQuality')}
              extra={
                <Select
                  value={thumbnailQuality}
                  onChange={(v) => setThumbnailQuality(v)}
                  style={{ width: 140 }}
                  variant="borderless"
                >
                  <Option value={80}>{t('settings.qualityStandard')}</Option>
                  <Option value={85}>{t('settings.qualityGood')}</Option>
                  <Option value={90}>{t('settings.qualityHigh')}</Option>
                  <Option value={92}>{t('settings.qualityVeryHigh')}</Option>
                  <Option value={95}>{t('settings.qualityMax')}</Option>
                </Select>
              }
            />
            <SettingsRow
              label={t('settings.thumbnailEffort')}
              isLast
              extra={
                <Select
                  value={thumbnailEffort}
                  onChange={(v) => setThumbnailEffort(v)}
                  style={{ width: 150 }}
                  variant="borderless"
                >
                  <Option value={2}>{t('settings.thumbnailEffortFast')}</Option>
                  <Option value={3}>{t('settings.thumbnailEffortBalanced')}</Option>
                  <Option value={6}>{t('settings.thumbnailEffortBest')}</Option>
                </Select>
              }
            />
          </SettingsGroup>

          {/* 外观 */}
          <SettingsGroup title={t('settings.appearance')}>
            <SettingsRow
              label={t('settings.theme')}
              extra={
                <Segmented
                  value={themeMode}
                  onChange={(value) => setThemeMode(value as ThemeMode)}
                  options={[
                    { label: t('settings.themeLight'), value: 'light' },
                    { label: t('settings.themeDark'), value: 'dark' },
                    { label: t('settings.themeSystem'), value: 'system' }
                  ]}
                  size="small"
                />
              }
            />
            <SettingsRow
              label={t('settings.language')}
              isLast
              extra={
                <Segmented
                  value={locale}
                  onChange={(value) => setLocale(value as LocaleType)}
                  options={[
                    { label: t('settings.languageZh'), value: 'zh-CN' },
                    { label: t('settings.languageEn'), value: 'en-US' }
                  ]}
                  size="small"
                />
              }
            />
          </SettingsGroup>

          {/* 通知（bug9） */}
          <SettingsGroup title={t('settings.notifications')} footer={t('settings.notificationsFooter')}>
            <SettingsRow
              label={t('settings.notifEnabled')}
              extra={<Switch checked={notif.enabled} onChange={v => setNotif('enabled', v)} />}
            />
            <SettingsRow
              label={t('settings.notifCompleted')}
              extra={<Switch checked={notif.byStatus.completed} onChange={v => setNotif('byStatus.completed', v)} disabled={!notif.enabled} />}
            />
            <SettingsRow
              label={t('settings.notifFailed')}
              extra={<Switch checked={notif.byStatus.failed} onChange={v => setNotif('byStatus.failed', v)} disabled={!notif.enabled} />}
            />
            <SettingsRow
              label={t('settings.notifAllSkipped')}
              extra={<Switch checked={notif.byStatus.allSkipped} onChange={v => setNotif('byStatus.allSkipped', v)} disabled={!notif.enabled} />}
            />
            <SettingsRow
              label={t('settings.notifSingleDownload')}
              extra={<Switch checked={notif.singleDownload.enabled} onChange={v => setNotif('singleDownload.enabled', v)} disabled={!notif.enabled} />}
            />
            <SettingsRow
              isLast
              label={t('settings.notifClickAction')}
              extra={
                <Select
                  value={notif.clickAction}
                  onChange={v => setNotif('clickAction', v)}
                  style={{ width: 200 }}
                  disabled={!notif.enabled}
                  options={[
                    { value: 'focus', label: t('settings.notifClickFocus') },
                    { value: 'openDownloadHub', label: t('settings.notifClickHub') },
                    { value: 'openSessionDetail', label: t('settings.notifClickSession') },
                  ]}
                />
              }
            />
          </SettingsGroup>

          {/* 桌面行为（bug9） */}
          <SettingsGroup title={t('settings.desktop')} footer={t('settings.desktopFooter')}>
            <SettingsRow
              label={t('settings.desktopCloseAction')}
              extra={
                <Segmented
                  value={desktop.closeAction}
                  onChange={(v) => setDesktop('closeAction', v as 'hide-to-tray' | 'quit' | 'ask')}
                  options={[
                    { value: 'hide-to-tray', label: t('settings.closeHideToTray') },
                    { value: 'quit', label: t('settings.closeQuit') },
                    { value: 'ask', label: t('settings.closeAsk') },
                  ]}
                  size="small"
                />
              }
            />
            <SettingsRow
              label={t('settings.autoLaunch')}
              extra={<Switch checked={desktop.autoLaunch} onChange={v => setDesktop('autoLaunch', v)} />}
            />
            <SettingsRow
              label={t('settings.startMinimized')}
              extra={<Switch checked={desktop.startMinimized} onChange={v => setDesktop('startMinimized', v)} disabled={!desktop.autoLaunch} />}
            />
            <SettingsRow
              isLast
              label={t('settings.hardwareAcceleration')}
              description={t('settings.hardwareAccelerationDesc')}
              extra={<Switch checked={desktop.hardwareAcceleration} onChange={v => setDesktop('hardwareAcceleration', v)} />}
            />
          </SettingsGroup>

          {/* 缓存管理 */}
          <CacheManagementGroup />

          <SettingsGroup title="备份与恢复" footer="导出当前站点配置、收藏、标签、保存的搜索与搜索历史；导入时支持合并恢复或完全替换。">
            <SettingsRow
              label="导出应用数据"
              description="生成 JSON 备份文件，便于迁移或手动归档"
              extra={
                <Button
                  size="small"
                  icon={<ExportOutlined />}
                  loading={exportingBackup}
                  onClick={handleExportBackup}
                >
                  导出
                </Button>
              }
            />
            <SettingsRow
              label="导入应用数据"
              description="从备份文件恢复站点、收藏、标签和搜索数据"
              extra={
                <Space size={spacing.sm}>
                  <Button
                    size="small"
                    icon={<InboxOutlined />}
                    loading={importingBackup}
                    onClick={handleImportBackup}
                  >
                    合并恢复
                  </Button>
                  <Button
                    size="small"
                    danger
                    icon={<InboxOutlined />}
                    loading={importingBackup}
                    onClick={handleReplaceBackup}
                  >
                    完全替换
                  </Button>
                </Space>
              }
              isLast
            />
          </SettingsGroup>

        </>
      )}

      {/* ===== 关于 ===== */}
      {activeTab === 'about' && (
        <>
          <SettingsGroup title={t('settings.about')}>
            <SettingsRow
              label="Yande Gallery Desktop"
              description="Personal Yande.re Gallery Manager"
              isLast
            />
          </SettingsGroup>

          <SettingsGroup title={t('settings.version')}>
            <SettingsRow
              label={t('settings.version')}
              extra={<span style={{ color: colors.textTertiary }}>{pkgJson.version}</span>}
            />
            <SettingsRow label="Electron" extra={<span style={{ color: colors.textTertiary }}>39.x</span>} />
            {/* React / Ant Design 版本从 package.json 读取，去掉语义化前缀（^ / ~） */}
            <SettingsRow label="React" extra={<span style={{ color: colors.textTertiary }}>{pkgJson.dependencies.react.replace(/^[\^~]/, '')}</span>} />
            <SettingsRow label="Ant Design" extra={<span style={{ color: colors.textTertiary }}>{pkgJson.dependencies.antd.replace(/^[\^~]/, '')}</span>} isLast />
          </SettingsGroup>

          <SettingsGroup title="更新">
            <SettingsRow
              label="检查更新"
              description={
                updateResult?.error
                  ? <span style={{ color: colors.danger }}>检查失败：{updateResult.error}</span>
                  : updateResult?.hasUpdate
                    ? <span style={{ color: colors.success }}>发现新版本 v{updateResult.latestVersion}（当前 v{updateResult.currentVersion}）</span>
                    : updateResult
                      ? <span style={{ color: colors.textTertiary }}>当前已是最新版本 v{updateResult.currentVersion}</span>
                      : <span style={{ color: colors.textTertiary }}>点击按钮检查是否有新版本</span>
              }
              isLast
              extra={
                updateResult?.hasUpdate && updateResult.releaseUrl ? (
                  <Button
                    type="primary"
                    size="small"
                    onClick={() => window.electronAPI?.system.openExternal(updateResult.releaseUrl!)}
                  >
                    查看发布页
                  </Button>
                ) : (
                  <Button
                    size="small"
                    loading={updateChecking}
                    onClick={handleCheckForUpdate}
                  >
                    检查更新
                  </Button>
                )
              }
            />
          </SettingsGroup>

          <SettingsGroup title="GitHub">
            <SettingsRow
              label="GitHub"
              description="https://github.com/GV-megumi/yande-gallery-desktop"
              isLast
              onClick={() => {
                window.electronAPI?.system.openExternal('https://github.com/GV-megumi/yande-gallery-desktop');
              }}
              extra={<ExportOutlined style={{ color: colors.textTertiary, fontSize: 16 }} />}
            />
          </SettingsGroup>
        </>
      )}

      {/* ===== API 服务 ===== */}
      {/* 加载失败：渲染错误提示 + 重试入口 */}
      {activeTab === 'api' && apiLoadError && (
        <Alert
          type="error"
          showIcon
          message="加载 API 服务配置失败"
          description={apiLoadError}
          style={{ marginBottom: spacing.xxl }}
          action={
            <Button size="small" onClick={() => { setApiLoadError(null); void loadApiService(); }}>
              重试
            </Button>
          }
        />
      )}
      {/* 加载中：配置尚未就绪时渲染居中 Spin */}
      {activeTab === 'api' && !apiLoadError && (!apiConfig || !apiStatus) && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: `${spacing['4xl']}px 0` }}>
          <Spin />
        </div>
      )}
      {activeTab === 'api' && !apiLoadError && apiConfig && apiStatus && (
        <>
          <SettingsGroup title="API 服务" footer="默认仅本机访问；局域网模式仍会拦截非私网来源。">
            <SettingsRow
              label="启用 API 服务"
              description={apiStatus.running ? `运行中 ${apiStatus.baseUrl || ''}` : (apiStatus.lastError || '未运行')}
              extra={<Switch checked={apiConfig.enabled} onChange={enabled => void saveApiServicePatch({ enabled })} />}
            />
            <SettingsRow
              label="监听模式"
              extra={
                <Segmented
                  value={apiConfig.mode}
                  onChange={(mode) => void saveApiServicePatch({ mode: mode as ApiServiceConfig['mode'] })}
                  options={[
                    { label: '仅本机', value: 'localhost' },
                    { label: '局域网', value: 'lan' },
                  ]}
                  size="small"
                />
              }
            />
            <SettingsRow
              label="端口"
              extra={
                <Input
                  type="number"
                  value={apiPortDraft}
                  style={{ width: 120, textAlign: 'right' }}
                  variant="borderless"
                  onChange={event => setApiPortDraft(event.target.value)}
                  onBlur={() => { void commitApiServicePortDraft(); }}
                  onPressEnter={() => { void commitApiServicePortDraft(); }}
                />
              }
            />
            <SettingsRow
              label="当前绑定地址"
              description={apiStatus.bindAddress || '-'}
              isLast
            />
          </SettingsGroup>

          <SettingsGroup title="API Key" footer="生成后客户端需要使用新的 key。">
            <SettingsRow
              label="API Key"
              description={apiKeyVisible ? (apiConfig.apiKey || '未生成') : (apiConfig.apiKey ? '已生成，当前隐藏' : '未生成')}
              extra={
                <Space size={spacing.sm}>
                  <Button size="small" onClick={() => setApiKeyVisible(v => !v)}>
                    {apiKeyVisible ? '隐藏' : '显示'}
                  </Button>
                  {/* 重新生成是破坏性操作：二次确认 + danger 样式 */}
                  <Popconfirm
                    title="重新生成将使旧 Key 立即失效，已接入的客户端需更新"
                    okText="生成"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => void generateApiServiceKey()}
                  >
                    <Button size="small" danger>
                      生成新 Key
                    </Button>
                  </Popconfirm>
                </Space>
              }
            />
            <SettingsRow
              label="当前值"
              description={apiKeyVisible ? apiConfig.apiKey || '未生成' : '已隐藏'}
              isLast
              extra={
                <Tooltip title="复制">
                  <Button
                    size="small"
                    type="text"
                    icon={<CopyOutlined />}
                    disabled={!apiConfig.apiKey}
                    onClick={async () => {
                      if (!apiConfig.apiKey) return;
                      try {
                        await navigator.clipboard.writeText(apiConfig.apiKey);
                        message.success('已复制');
                      } catch (err) {
                        console.error('[SettingsPage] 复制 API Key 失败:', err);
                        message.error('复制失败');
                      }
                    }}
                  />
                </Tooltip>
              }
            />
          </SettingsGroup>

          <SettingsGroup title="权限">
            {Object.entries(API_PERMISSION_LABELS).map(([key, label], index, entries) => {
              const permissionKey = key as ApiServicePermissionKey;
              return (
                <SettingsRow
                  key={permissionKey}
                  label={label}
                  extra={
                    <Switch
                      checked={Boolean(apiConfig.permissions[permissionKey])}
                      onChange={checked => void saveApiServiceNestedPatch('permissions', { [permissionKey]: checked })}
                    />
                  }
                  isLast={index === entries.length - 1}
                />
              );
            })}
          </SettingsGroup>

          <SettingsGroup title="日志">
            <SettingsRow
              label="启用 API 日志"
              extra={
                <Switch
                  checked={apiConfig.logs.enabled}
                  onChange={enabled => void saveApiServiceNestedPatch('logs', { enabled })}
                />
              }
            />
            <SettingsRow
              label="在界面显示日志"
              extra={
                <Switch
                  checked={apiConfig.logs.visibleInUi}
                  onChange={visibleInUi => void saveApiServiceNestedPatch('logs', { visibleInUi })}
                />
              }
            />
            <SettingsRow
              label="最近日志"
              description={apiLogs.length > 0 ? `${apiLogs.length} 条` : '暂无日志'}
              isLast
            />
          </SettingsGroup>
        </>
      )}

      {/* ===== 代理配置 ===== */}
      {activeTab === 'proxy' && (
        <>
          {/* 代理服务器 */}
          <SettingsGroup title={t('settings.proxyServer')} footer={t('settings.networkFooter')}>
            <Form form={proxyForm} style={{ margin: 0 }}>
              <SettingsRow
                label={t('settings.proxyEnabled')}
                extra={
                  <Form.Item name="proxyEnabled" valuePropName="checked" noStyle>
                    <Switch onChange={setProxyEnabled} />
                  </Form.Item>
                }
              />
              <SettingsRow
                label={t('settings.proxyProtocol')}
                extra={
                  <Form.Item name="proxyProtocol" noStyle>
                    <Select style={{ width: 120 }} variant="borderless" disabled={!proxyEnabled}>
                      <Option value="http">HTTP</Option>
                      <Option value="https">HTTPS</Option>
                      <Option value="socks5">SOCKS5</Option>
                    </Select>
                  </Form.Item>
                }
              />
              <SettingsRow
                label={t('settings.proxyHost')}
                extra={
                  <Form.Item name="proxyHost" noStyle>
                    <Input
                      placeholder="127.0.0.1"
                      variant="borderless"
                      style={{ width: 160, textAlign: 'right' }}
                      disabled={!proxyEnabled}
                    />
                  </Form.Item>
                }
              />
              <SettingsRow
                label={t('settings.proxyPort')}
                isLast
                extra={
                  <Form.Item name="proxyPort" noStyle>
                    <Input
                      type="number"
                      placeholder="7890"
                      variant="borderless"
                      style={{ width: 100, textAlign: 'right' }}
                      disabled={!proxyEnabled}
                    />
                  </Form.Item>
                }
              />
            </Form>
          </SettingsGroup>

          {/* 连通性测试 */}
          <SettingsGroup title={t('settings.connectivityTest')}>
            <SettingsRow
              label={t('settings.testBaidu')}
              onClick={async () => {
                if (!window.electronAPI) return;
                // 测试进行中：忽略重复点击
                if (testing) return;
                setTesting('baidu');
                try {
                  const result = await window.electronAPI.system.testBaidu();
                  if (result.success) message.success(t('settings.baiduSuccess', { status: result.status ?? 200 }));
                  else message.error(t('settings.baiduFailed') + ': ' + result.error);
                } catch (error) {
                  message.error(t('settings.baiduFailed') + ': ' + String(error));
                } finally {
                  setTesting(null);
                }
              }}
              extra={
                testing === 'baidu'
                  ? <Spin size="small" />
                  : <span style={{ color: colors.textTertiary, fontSize: fontSize.sm }}>Baidu</span>
              }
            />
            <SettingsRow
              label={t('settings.testGoogle')}
              isLast
              onClick={async () => {
                if (!window.electronAPI) return;
                // 测试进行中：忽略重复点击
                if (testing) return;
                setTesting('google');
                try {
                  const result = await window.electronAPI.system.testGoogle();
                  if (result.success) message.success(t('settings.googleSuccess', { status: result.status ?? 200 }));
                  else message.error(t('settings.googleFailed') + ': ' + result.error);
                } catch (error) {
                  message.error(t('settings.googleFailed') + ': ' + String(error));
                } finally {
                  setTesting(null);
                }
              }}
              extra={
                testing === 'google'
                  ? <Spin size="small" />
                  : <span style={{ color: colors.textTertiary, fontSize: fontSize.sm }}>Google</span>
              }
            />
          </SettingsGroup>
        </>
      )}

      {/* ===== 保存按钮（关于页不显示） ===== */}
      {(activeTab === 'general' || activeTab === 'proxy') && (
        <div style={{ marginBottom: spacing.xxl, display: 'flex', justifyContent: 'center', gap: spacing.md }}>
          <Button
            type="primary"
            size="large"
            loading={saving}
            icon={<SaveOutlined />}
            onClick={handleSave}
            style={{
              borderRadius: radius.sm,
              minWidth: 200,
              height: 44,
              fontWeight: 600,
            }}
          >
            {t('settings.saveAll')}
          </Button>
        </div>
      )}

      {/* 底部留白 */}
      <div style={{ height: spacing['3xl'] }} />
    </div>
  );
};
