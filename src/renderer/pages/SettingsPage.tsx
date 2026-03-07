/**
 * 设置页面 — iOS Grouped Inset 风格
 */
import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Switch, Select, message, List, Modal, Spin, Segmented, Space, Popconfirm } from 'antd';
import { SaveOutlined, FolderOutlined, PlusOutlined, DeleteOutlined, ScanOutlined, BulbOutlined } from '@ant-design/icons';
import { useTheme, ThemeMode } from '../hooks/useTheme';
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

export const SettingsPage: React.FC = () => {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [folders, setFolders] = useState<GalleryFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState<string | null>(null);
  const [proxyForm] = Form.useForm();
  const { themeMode, setThemeMode } = useTheme();

  // 表单值状态（用于即时渲染）
  const [downloadPath, setDownloadPath] = useState('');
  const [thumbnailSize, setThumbnailSize] = useState(800);
  const [thumbnailQuality, setThumbnailQuality] = useState(92);
  const [autoGenThumbnail, setAutoGenThumbnail] = useState(true);
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyProtocol, setProxyProtocol] = useState('http');
  const [proxyHost, setProxyHost] = useState('127.0.0.1');
  const [proxyPort, setProxyPort] = useState('7890');

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
    console.log('[SettingsPage] 保存设置');
    setSaving(true);
    try {
      if (!window.electronAPI) { message.error('系统功能不可用'); return; }
      const configResult = await window.electronAPI.config.get();
      if (!configResult.success || !configResult.data) { message.error('获取配置失败'); return; }
      const updatedConfig = {
        ...configResult.data,
        downloads: { ...configResult.data.downloads, path: downloadPath },
        thumbnails: { ...configResult.data.thumbnails, maxWidth: thumbnailSize, maxHeight: thumbnailSize, quality: thumbnailQuality },
      };
      const result = await window.electronAPI.config.save(updatedConfig);
      if (result.success) { message.success('设置已保存'); }
      else { message.error(result.error || '保存失败'); }
    } catch (error) {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProxy = async () => {
    try {
      const values = await proxyForm.validateFields();
      if (!window.electronAPI) { message.error('系统功能不可用'); return; }
      const configResult = await window.electronAPI.config.get();
      if (!configResult.success || !configResult.data) { message.error('获取配置失败'); return; }
      const updatedConfig = {
        ...configResult.data,
        network: { ...configResult.data.network, proxy: {
          enabled: values.proxyEnabled, protocol: values.proxyProtocol,
          host: values.proxyHost, port: values.proxyPort,
          username: values.proxyUsername || '', password: values.proxyPassword || ''
        }}
      };
      const result = await window.electronAPI.config.save(updatedConfig);
      if (result.success) message.success('代理设置已保存');
      else message.error(result.error || '保存失败');
    } catch (error) {
      message.error('保存代理设置失败');
    }
  };

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: `0 ${spacing.lg}px` }}>
      {/* ===== 图库文件夹 ===== */}
      <SettingsGroup
        title="图库文件夹"
        footer="首次添加文件夹时，程序会自动扫描子文件夹并创建图集。"
      >
        <Spin spinning={loading}>
          {folders.length === 0 ? (
            <div style={{
              padding: `${spacing.xxl}px`,
              textAlign: 'center',
              color: colors.textTertiary,
              fontSize: fontSize.base,
            }}>
              暂无配置的文件夹
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
                      扫描
                    </Button>
                    <Popconfirm
                      title="确定删除此文件夹？"
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
                        删除
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
            添加文件夹
          </Button>
        </div>
      </SettingsGroup>

      {/* ===== 下载设置 ===== */}
      <SettingsGroup title="下载">
        <SettingsRow
          label="下载路径"
          description={downloadPath || '未设置'}
          isLast
          onClick={handleSelectDownloadPath}
          extra={
            <FolderOutlined style={{ color: colors.textTertiary, fontSize: 16 }} />
          }
        />
      </SettingsGroup>

      {/* ===== 缩略图设置 ===== */}
      <SettingsGroup title="缩略图" footer="更大的缩略图尺寸和质量会占用更多磁盘空间。">
        <SettingsRow
          label="缩略图尺寸"
          extra={
            <Select
              value={thumbnailSize}
              onChange={(v) => setThumbnailSize(v)}
              style={{ width: 140 }}
              variant="borderless"
            >
              <Option value={300}>小 (300px)</Option>
              <Option value={400}>中 (400px)</Option>
              <Option value={600}>大 (600px)</Option>
              <Option value={800}>高清 (800px)</Option>
              <Option value={1000}>超清 (1000px)</Option>
            </Select>
          }
        />
        <SettingsRow
          label="缩略图质量"
          extra={
            <Select
              value={thumbnailQuality}
              onChange={(v) => setThumbnailQuality(v)}
              style={{ width: 140 }}
              variant="borderless"
            >
              <Option value={80}>标准 (80)</Option>
              <Option value={85}>良好 (85)</Option>
              <Option value={90}>高质量 (90)</Option>
              <Option value={92}>超高 (92)</Option>
              <Option value={95}>极高 (95)</Option>
            </Select>
          }
        />
        <SettingsRow
          label="自动生成缩略图"
          description="导入新图片时自动生成"
          isLast
          extra={
            <Switch
              checked={autoGenThumbnail}
              onChange={setAutoGenThumbnail}
            />
          }
        />
      </SettingsGroup>

      {/* ===== 外观 ===== */}
      <SettingsGroup title="外观">
        <SettingsRow
          label="主题"
          isLast
          extra={
            <Segmented
              value={themeMode}
              onChange={(value) => setThemeMode(value as ThemeMode)}
              options={[
                { label: '浅色', value: 'light' },
                { label: '深色', value: 'dark' },
                { label: '跟随系统', value: 'system' }
              ]}
              size="small"
            />
          }
        />
      </SettingsGroup>

      {/* ===== 网络代理 ===== */}
      <SettingsGroup title="网络代理" footer="用于访问 Booru 站点等需要代理的网络资源。">
        <Form form={proxyForm} style={{ margin: 0 }}>
          <SettingsRow
            label="启用代理"
            extra={
              <Form.Item name="proxyEnabled" valuePropName="checked" noStyle>
                <Switch onChange={setProxyEnabled} />
              </Form.Item>
            }
          />
          <SettingsRow
            label="协议"
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
            label="主机"
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
            label="端口"
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

      {/* 代理保存和测试 */}
      <SettingsGroup>
        <SettingsRow
          label={<span style={{ color: colors.primary, fontWeight: 500 }}>保存代理设置</span>}
          onClick={handleSaveProxy}
        />
        <SettingsRow
          label="测试百度连接"
          onClick={async () => {
            if (!window.electronAPI) return;
            try {
              const result = await window.electronAPI.system.testBaidu();
              if (result.success) message.success(`百度连接成功！状态码: ${result.status}`);
              else message.error('百度连接失败: ' + result.error);
            } catch (error) {
              message.error('测试失败: ' + String(error));
            }
          }}
          extra={<span style={{ color: colors.textTertiary, fontSize: fontSize.sm }}>Baidu</span>}
        />
        <SettingsRow
          label="测试 Google 连接"
          isLast
          onClick={async () => {
            if (!window.electronAPI) return;
            try {
              const result = await window.electronAPI.system.testGoogle();
              if (result.success) message.success(`Google 连接成功！状态码: ${result.status}`);
              else message.error('Google 连接失败: ' + result.error);
            } catch (error) {
              message.error('测试失败: ' + String(error));
            }
          }}
          extra={<span style={{ color: colors.textTertiary, fontSize: fontSize.sm }}>Google</span>}
        />
      </SettingsGroup>

      {/* ===== 保存按钮 ===== */}
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
          保存所有设置
        </Button>
      </div>

      {/* ===== 高级 ===== */}
      <SettingsGroup title="高级">
        <SettingsRow label="清除缓存" onClick={() => message.info('功能开发中')} />
        <SettingsRow label="重新索引数据库" onClick={() => message.info('功能开发中')} />
        <SettingsRow
          label={<span style={{ color: colors.danger }}>重置所有设置</span>}
          isLast
          onClick={() => message.info('功能开发中')}
        />
      </SettingsGroup>

      {/* ===== 关于 ===== */}
      <SettingsGroup title="关于">
        <SettingsRow label="版本" extra={<span style={{ color: colors.textTertiary }}>1.0.0</span>} />
        <SettingsRow label="Electron" extra={<span style={{ color: colors.textTertiary }}>39.x</span>} />
        <SettingsRow label="React" extra={<span style={{ color: colors.textTertiary }}>18.2.0</span>} />
        <SettingsRow label="Ant Design" extra={<span style={{ color: colors.textTertiary }}>5.x</span>} isLast />
      </SettingsGroup>

      {/* 底部留白 */}
      <div style={{ height: spacing['3xl'] }} />
    </div>
  );
};
