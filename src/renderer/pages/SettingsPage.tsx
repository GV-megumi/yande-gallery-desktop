/**
 * 设置页面 — iOS Grouped Inset 风格
 */
import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Switch, Select, message, Modal, Spin, Segmented, Space, Popconfirm } from 'antd';
import { SaveOutlined, FolderOutlined, PlusOutlined, DeleteOutlined, ScanOutlined, BulbOutlined, InboxOutlined, ExportOutlined } from '@ant-design/icons';
import { useTheme, ThemeMode } from '../hooks/useTheme';
import { useLocale, type LocaleType } from '../locales';
import { colors, spacing, radius, fontSize, shadows } from '../styles/tokens';

const { Option } = Select;

interface GalleryFolder {
  path: string;
  name: string;
  autoScan: boolean;
  recursive: boolean;
  extensions: string[];
}

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
  description?: string;
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
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [folders, setFolders] = useState<GalleryFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState<string | null>(null);
  const [proxyForm] = Form.useForm();
  const { themeMode, setThemeMode } = useTheme();
  const { t, locale, setLocale } = useLocale();
  const [activeTab, setActiveTab] = useState<'general' | 'proxy'>('general');

  // 表单值状态（用于即时渲染）
  const [downloadPath, setDownloadPath] = useState('');
  const [thumbnailSize, setThumbnailSize] = useState(800);
  const [thumbnailQuality, setThumbnailQuality] = useState(92);
  const [autoGenThumbnail, setAutoGenThumbnail] = useState(true);
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyProtocol, setProxyProtocol] = useState('http');
  const [proxyHost, setProxyHost] = useState('127.0.0.1');
  const [proxyPort, setProxyPort] = useState('7890');
  const [exportingBackup, setExportingBackup] = useState(false);
  const [importingBackup, setImportingBackup] = useState(false);

  useEffect(() => {
    console.log('[SettingsPage] 组件挂载，加载配置');
    loadConfig();
  }, []);

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
        setDownloadPath(dp);
        setThumbnailSize(ts);
        setThumbnailQuality(tq);
        form.setFieldsValue({ downloadPath: dp, thumbnailSize: ts, thumbnailQuality: tq, autoGenerateThumbnail: true, language: 'zh-CN' });

        const proxy = config.network?.proxy || { enabled: false, protocol: 'http', host: '127.0.0.1', port: 7890 };
        setProxyEnabled(proxy.enabled);
        setProxyProtocol(proxy.protocol || 'http');
        setProxyHost(proxy.host || '127.0.0.1');
        setProxyPort(String(proxy.port || 7890));
        proxyForm.setFieldsValue({
          proxyEnabled: proxy.enabled, proxyProtocol: proxy.protocol,
          proxyHost: proxy.host, proxyPort: proxy.port,
          proxyUsername: proxy.username || '', proxyPassword: proxy.password || ''
        });
      }
    } catch (error) {
      console.error('Failed to load config:', error);
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  };

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
      Modal.confirm({
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

  const handleDeleteFolder = (index: number) => {
    const folderName = folders[index].name;
    Modal.confirm({
      title: '确认删除', content: `确定要删除文件夹 "${folderName}" 吗？`,
      okText: '删除', cancelText: '取消', okType: 'danger',
      onOk: async () => {
        const updated = folders.filter((_, i) => i !== index);
        setFolders(updated);
        await saveFoldersConfig(updated);
        message.success('已删除文件夹');
      }
    });
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
        form.setFieldsValue({ downloadPath: result.data });
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
      const proxyValues = await proxyForm.validateFields();
      const configResult = await window.electronAPI.config.get();
      if (!configResult.success || !configResult.data) { message.error('获取配置失败'); return; }
      const updatedConfig = {
        ...configResult.data,
        downloads: { ...configResult.data.downloads, path: downloadPath },
        thumbnails: { ...configResult.data.thumbnails, maxWidth: thumbnailSize, maxHeight: thumbnailSize, quality: thumbnailQuality },
        network: { ...configResult.data.network, proxy: {
          enabled: proxyValues.proxyEnabled, protocol: proxyValues.proxyProtocol,
          host: proxyValues.proxyHost, port: Number(proxyValues.proxyPort),
          username: proxyValues.proxyUsername || '', password: proxyValues.proxyPassword || ''
        }},
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
    Modal.confirm({
      title: '导入应用备份',
      content: '推荐使用“合并恢复”，仅补充或覆盖同 ID 数据；若需要清空当前站点/收藏/标签/搜索数据，请使用下方的“完全替换恢复”按钮。',
      okText: '合并恢复',
      cancelText: '取消',
      okButtonProps: { icon: <InboxOutlined /> },
      onOk: async () => runImportBackup('merge')
    });
  };

  const handleReplaceBackup = async () => {
    Modal.confirm({
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
          onChange={(value) => setActiveTab(value as 'general' | 'proxy')}
          options={[
            { label: t('settings.tabGeneral'), value: 'general' },
            { label: t('settings.tabProxy'), value: 'proxy' },
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
                <div style={{
                  padding: `${spacing.xxl}px`,
                  textAlign: 'center',
                  color: colors.textTertiary,
                  fontSize: fontSize.base,
                }}>
                  {t('settings.noFolders')}
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
            </div>
          </SettingsGroup>

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
              label={t('settings.autoGenThumbnail')}
              description={t('settings.autoGenThumbnailDesc')}
              isLast
              extra={
                <Switch
                  checked={autoGenThumbnail}
                  onChange={setAutoGenThumbnail}
                />
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

          {/* 高级 */}
          <SettingsGroup title={t('settings.advanced')}>
            <SettingsRow label={t('settings.reindexDb')} onClick={() => message.info(t('settings.featureDev'))} />
            <SettingsRow
              label={<span style={{ color: colors.danger }}>{t('settings.resetAll')}</span>}
              isLast
              onClick={() => message.info(t('settings.featureDev'))}
            />
          </SettingsGroup>

          {/* 关于 */}
          <SettingsGroup title={t('settings.about')}>
            <SettingsRow label={t('settings.version')} extra={<span style={{ color: colors.textTertiary }}>1.0.0</span>} />
            <SettingsRow label="Electron" extra={<span style={{ color: colors.textTertiary }}>39.x</span>} />
            <SettingsRow label="React" extra={<span style={{ color: colors.textTertiary }}>18.2.0</span>} />
            <SettingsRow label="Ant Design" extra={<span style={{ color: colors.textTertiary }}>5.x</span>} isLast />
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
                try {
                  const result = await window.electronAPI.system.testBaidu();
                  if (result.success) message.success(t('settings.baiduSuccess', { status: result.status ?? 200 }));
                  else message.error(t('settings.baiduFailed') + ': ' + result.error);
                } catch (error) {
                  message.error(t('settings.baiduFailed') + ': ' + String(error));
                }
              }}
              extra={<span style={{ color: colors.textTertiary, fontSize: fontSize.sm }}>Baidu</span>}
            />
            <SettingsRow
              label={t('settings.testGoogle')}
              isLast
              onClick={async () => {
                if (!window.electronAPI) return;
                try {
                  const result = await window.electronAPI.system.testGoogle();
                  if (result.success) message.success(t('settings.googleSuccess', { status: result.status ?? 200 }));
                  else message.error(t('settings.googleFailed') + ': ' + result.error);
                } catch (error) {
                  message.error(t('settings.googleFailed') + ': ' + String(error));
                }
              }}
              extra={<span style={{ color: colors.textTertiary, fontSize: fontSize.sm }}>Google</span>}
            />
          </SettingsGroup>
        </>
      )}

      {/* ===== 保存按钮（始终显示） ===== */}
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

      {/* 底部留白 */}
      <div style={{ height: spacing['3xl'] }} />
    </div>
  );
};
