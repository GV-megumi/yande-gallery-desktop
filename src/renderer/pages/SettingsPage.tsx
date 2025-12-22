import React, { useState, useEffect } from 'react';
import { Card, Form, Input, Button, Switch, Select, message, Space, List, Modal, Spin } from 'antd';
import { SaveOutlined, FolderOutlined, PlusOutlined, DeleteOutlined, ScanOutlined } from '@ant-design/icons';

const { Option } = Select;

interface GalleryFolder {
  path: string;
  name: string;
  autoScan: boolean;
  recursive: boolean;
  extensions: string[];
}

export const SettingsPage: React.FC = () => {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [folders, setFolders] = useState<GalleryFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState<string | null>(null);
  const [proxyForm] = Form.useForm();

  // 加载配置
  useEffect(() => {
    console.log('[SettingsPage] 组件挂载，加载配置');
    loadConfig();
  }, []);

  const loadConfig = async () => {
    if (!window.electronAPI) {
      console.error('[SettingsPage] electronAPI is not available');
      return;
    }

    console.log('[SettingsPage] 开始加载配置');
    try {
      setLoading(true);
      const result = await window.electronAPI.config.get();
      if (result.success && result.data) {
        const config = result.data;
        console.log('[SettingsPage] 配置加载成功', config);
        setFolders(config.galleries?.folders || []);
        form.setFieldsValue({
          downloadPath: config.downloads?.path || './downloads',
          thumbnailSize: config.thumbnails?.maxWidth || 800,
          thumbnailQuality: config.thumbnails?.quality || 92,
          autoGenerateThumbnail: true,
          theme: config.app?.defaultViewMode || 'light',
          language: 'zh-CN'
        });

        // 加载代理配置
        const proxy = config.network?.proxy || {
          enabled: false,
          protocol: 'http',
          host: '127.0.0.1',
          port: 7890,
          username: '',
          password: ''
        };
        proxyForm.setFieldsValue({
          proxyEnabled: proxy.enabled,
          proxyProtocol: proxy.protocol,
          proxyHost: proxy.host,
          proxyPort: proxy.port,
          proxyUsername: proxy.username || '',
          proxyPassword: proxy.password || ''
        });
      } else {
        console.error('[SettingsPage] 配置加载失败:', result.error);
      }
    } catch (error) {
      console.error('Failed to load config:', error);
      message.error('加载配置失败');
    } finally {
      setLoading(false);
      console.log('[SettingsPage] 配置加载完成');
    }
  };

  // 添加文件夹
  const handleAddFolder = async () => {
    if (!window.electronAPI) {
      console.error('[SettingsPage] electronAPI is not available');
      message.error('系统功能不可用');
      return;
    }

    console.log('[SettingsPage] 开始添加文件夹');
    try {
      const result = await window.electronAPI.system.selectFolder();
      if (!result.success || !result.data) {
        console.log('[SettingsPage] 取消添加文件夹或选择失败');
        return;
      }

      const folderPath = result.data;
      console.log(`[SettingsPage] 选择文件夹成功: ${folderPath}`);

      // 检查是否已存在
      if (folders.some(f => f.path === folderPath)) {
        console.warn('[SettingsPage] 文件夹已存在，跳过添加');
        message.warning('该文件夹已存在');
        return;
      }

      // 生成文件夹名称（使用文件夹名）
      const folderName = folderPath.split(/[/\\]/).pop() || '未命名文件夹';
      console.log(`[SettingsPage] 生成文件夹名称: ${folderName}`);

      // 创建新文件夹配置
      const newFolder: GalleryFolder = {
        path: folderPath,
        name: folderName,
        autoScan: true,
        recursive: true,
        extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
      };

      // 添加到列表
      const updatedFolders = [...folders, newFolder];
      setFolders(updatedFolders);
      console.log(`[SettingsPage] 添加到列表，当前文件夹数量: ${updatedFolders.length}`);

      // 保存配置
      await saveFoldersConfig(updatedFolders);

      // 首次添加时自动扫描子文件夹并创建图集（后台执行，弹框立即关闭）
      Modal.confirm({
        title: '扫描子文件夹',
        content: `是否立即扫描 "${folderName}" 下的所有子文件夹并创建图集？`,
        okText: '立即扫描',
        cancelText: '稍后扫描',
        onOk: () => {
          console.log('[SettingsPage] 用户确认扫描子文件夹');
          // 后台触发，不阻塞弹框关闭
          void scanSubfolders(folderPath, newFolder.extensions);
        }
      });
    } catch (error) {
      console.error('Failed to add folder:', error);
      message.error('添加文件夹失败');
    }
  };

  // 扫描子文件夹并创建图集
  const scanSubfolders = async (rootPath: string, extensions: string[]) => {
    if (!window.electronAPI) {
      console.error('[SettingsPage] electronAPI is not available');
      message.error('系统功能不可用');
      return;
    }

    console.log(`[SettingsPage] 开始扫描子文件夹: ${rootPath}`);
    try {
      setScanning(rootPath);
      message.loading({ content: '正在后台扫描子文件夹...', key: 'scanning', duration: 0 });

      const result = await window.electronAPI.gallery.scanSubfolders(rootPath, extensions);

      if (result.success && result.data) {
        const anyData: any = result.data;
        const { created, skipped } = anyData;
        const imported = anyData.imported ?? 0;
        const imageSkipped = anyData.imageSkipped ?? 0;
        console.log(`[SettingsPage] 子文件夹扫描成功: 创建图集 ${created} 个，跳过 ${skipped} 个，导入图片 ${imported} 张，跳过 ${imageSkipped} 张`);
        message.success({
          content: `扫描完成：创建图集 ${created} 个，跳过 ${skipped} 个，导入图片 ${imported} 张，跳过 ${imageSkipped} 张`,
          key: 'scanning',
          duration: 5
        });
      } else {
        console.error('[SettingsPage] 子文件夹扫描失败:', result.error);
        message.error({
          content: result.error || '扫描失败',
          key: 'scanning',
          duration: 3
        });
      }
    } catch (error) {
      console.error('Failed to scan subfolders:', error);
      message.error({
        content: '扫描失败',
        key: 'scanning',
        duration: 3
      });
    } finally {
      setScanning(null);
      console.log('[SettingsPage] 子文件夹扫描完成');
    }
  };

  // 删除文件夹
  const handleDeleteFolder = (index: number) => {
    const folderName = folders[index].name;
    console.log(`[SettingsPage] 用户请求删除文件夹: ${folderName}`);
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除文件夹 "${folderName}" 吗？`,
      okText: '删除',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        console.log(`[SettingsPage] 确认删除文件夹: ${folderName}`);
        const updatedFolders = folders.filter((_, i) => i !== index);
        setFolders(updatedFolders);
        await saveFoldersConfig(updatedFolders);
        console.log('[SettingsPage] 文件夹删除成功');
        message.success('已删除文件夹');
      }
    });
  };

  // 保存文件夹配置
  const saveFoldersConfig = async (foldersToSave: GalleryFolder[]) => {
    if (!window.electronAPI) {
      console.error('[SettingsPage] electronAPI is not available');
      message.error('系统功能不可用');
      return;
    }

    console.log(`[SettingsPage] 保存文件夹配置，数量: ${foldersToSave.length}`);
    try {
      const result = await window.electronAPI.config.updateGalleryFolders(foldersToSave);
      if (result.success) {
        console.log('[SettingsPage] 文件夹配置保存成功');
      } else {
        console.error('[SettingsPage] 保存文件夹配置失败:', result.error);
        message.error(result.error || '保存配置失败');
      }
    } catch (error) {
      console.error('Failed to save folders config:', error);
      message.error('保存配置失败');
    }
  };

  // 选择下载路径
  const handleSelectDownloadPath = async () => {
    if (!window.electronAPI) {
      message.error('系统功能不可用');
      return;
    }

    try {
      const result = await window.electronAPI.system.selectFolder();
      if (result.success && result.data) {
        form.setFieldsValue({ downloadPath: result.data });
      }
    } catch (error) {
      console.error('Failed to select download path:', error);
      message.error('选择路径失败');
    }
  };

  // 保存设置
  const handleSave = async (values: any) => {
    console.log('[SettingsPage] 开始保存设置', values);
    setSaving(true);
    try {
      if (!window.electronAPI) {
        console.error('[SettingsPage] electronAPI is not available');
        message.error('系统功能不可用');
        return;
      }

      // 加载当前配置
      console.log('[SettingsPage] 加载当前配置');
      const configResult = await window.electronAPI.config.get();
      if (!configResult.success || !configResult.data) {
        console.error('[SettingsPage] 获取配置失败:', configResult.error);
        message.error('获取配置失败');
        return;
      }

      // 更新配置
      console.log('[SettingsPage] 更新配置项');
      const updatedConfig = {
        ...configResult.data,
        downloads: {
          ...configResult.data.downloads,
          path: values.downloadPath
        },
        thumbnails: {
          ...configResult.data.thumbnails,
          maxWidth: values.thumbnailSize,
          maxHeight: values.thumbnailSize,
          quality: values.thumbnailQuality || 92
        },
        app: {
          ...configResult.data.app,
          defaultViewMode: values.theme
        }
      };

      const result = await window.electronAPI.config.save(updatedConfig);
      if (result.success) {
        console.log('[SettingsPage] 设置保存成功');
        message.success('设置已保存');
      } else {
        console.error('[SettingsPage] 设置保存失败:', result.error);
        message.error(result.error || '保存失败');
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
      message.error('保存失败');
    } finally {
      setSaving(false);
      console.log('[SettingsPage] 设置保存完成');
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto' }}>
      <Card title="图库文件夹配置" style={{ marginBottom: '24px' }}>
        <div style={{ marginBottom: '16px' }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAddFolder}
          >
            添加文件夹
          </Button>
          <span style={{ marginLeft: '16px', color: '#666' }}>
            首次添加文件夹时，程序会自动扫描该文件夹下的所有子文件夹，为包含图片的子文件夹创建图集
          </span>
        </div>

        <Spin spinning={loading}>
          <List
            dataSource={folders}
            renderItem={(item, index) => (
              <List.Item
                actions={[
                  <Button
                    key="scan"
                    type="link"
                    icon={<ScanOutlined />}
                    loading={scanning === item.path}
                    onClick={() => scanSubfolders(item.path, item.extensions)}
                  >
                    重新扫描
                  </Button>,
                  <Button
                    key="delete"
                    type="link"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => handleDeleteFolder(index)}
                  >
                    删除
                  </Button>
                ]}
              >
                <List.Item.Meta
                  title={item.name}
                  description={
                    <div>
                      <div>路径: {item.path}</div>
                      <div style={{ marginTop: '4px', fontSize: '12px', color: '#999' }}>
                        自动扫描: {item.autoScan ? '是' : '否'} | 
                        递归: {item.recursive ? '是' : '否'} | 
                        格式: {item.extensions.join(', ')}
                      </div>
                    </div>
                  }
                />
              </List.Item>
            )}
            locale={{ emptyText: '暂无配置的文件夹' }}
          />
        </Spin>
      </Card>

      <Card title="应用设置" style={{ marginBottom: '24px' }}>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
        >
          <Form.Item
            label="下载路径"
            name="downloadPath"
            rules={[{ required: true, message: '请输入下载路径' }]}
          >
            <Input
              readOnly
              addonAfter={
                <FolderOutlined 
                  style={{ cursor: 'pointer' }} 
                  onClick={handleSelectDownloadPath} 
                />
              }
              placeholder="请选择下载路径"
              onClick={handleSelectDownloadPath}
            />
          </Form.Item>

          <Form.Item
            label="缩略图大小"
            name="thumbnailSize"
            rules={[{ required: true, message: '请选择缩略图大小' }]}
            tooltip="缩略图的宽度和高度（像素），建议 400-1000 以获得更好的质量"
          >
            <Select>
              <Option value={300}>小 (300px)</Option>
              <Option value={400}>中 (400px)</Option>
              <Option value={600}>大 (600px)</Option>
              <Option value={800}>高清 (800px)</Option>
              <Option value={1000}>超清 (1000px)</Option>
            </Select>
          </Form.Item>

          <Form.Item
            label="缩略图质量"
            name="thumbnailQuality"
            rules={[{ required: true, message: '请输入缩略图质量' }]}
            tooltip="图片质量 (1-100)，数值越高质量越好，文件也越大。建议 85-95，通常 90 以上能达到约 500KB 大小"
          >
            <Select>
              <Option value={80}>标准 (80)</Option>
              <Option value={85}>良好 (85)</Option>
              <Option value={90}>高质量 (90)</Option>
              <Option value={92}>超高质量 (92)</Option>
              <Option value={95}>极高 (95)</Option>
            </Select>
          </Form.Item>

          <Form.Item
            label="自动生成缩略图"
            name="autoGenerateThumbnail"
            valuePropName="checked"
            tooltip="导入新图片时自动生成缩略图"
          >
            <Switch />
          </Form.Item>

          <Form.Item
            label="主题"
            name="theme"
            rules={[{ required: true, message: '请选择主题' }]}
          >
            <Select>
              <Option value="light">浅色主题</Option>
              <Option value="dark">深色主题</Option>
              <Option value="auto">跟随系统</Option>
            </Select>
          </Form.Item>

          <Form.Item
            label="语言"
            name="language"
            rules={[{ required: true, message: '请选择语言' }]}
          >
            <Select>
              <Option value="zh-CN">简体中文</Option>
              <Option value="en-US">English</Option>
            </Select>
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />}>
                保存设置
              </Button>
              <Button onClick={() => form.resetFields()}>
                重置
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Card title="网络设置" style={{ marginBottom: '24px' }}>
        <Form
          form={proxyForm}
          layout="vertical"
          onFinish={async (values) => {
            console.log('[SettingsPage] 保存代理配置', values);
            try {
              if (!window.electronAPI) {
                console.error('[SettingsPage] electronAPI is not available');
                message.error('系统功能不可用');
                return;
              }

              // 加载当前配置
              console.log('[SettingsPage] 加载当前配置');
              const configResult = await window.electronAPI.config.get();
              if (!configResult.success || !configResult.data) {
                console.error('[SettingsPage] 获取配置失败:', configResult.error);
                message.error('获取配置失败');
                return;
              }

              // 更新代理配置
              const updatedConfig = {
                ...configResult.data,
                network: {
                  ...configResult.data.network,
                  proxy: {
                    enabled: values.proxyEnabled,
                    protocol: values.proxyProtocol,
                    host: values.proxyHost,
                    port: values.proxyPort,
                    username: values.proxyUsername || '',
                    password: values.proxyPassword || ''
                  }
                }
              };

              const result = await window.electronAPI.config.save(updatedConfig);
              if (result.success) {
                console.log('[SettingsPage] 代理设置保存成功');
                message.success('代理设置已保存');
              } else {
                console.error('[SettingsPage] 代理设置保存失败:', result.error);
                message.error(result.error || '保存代理设置失败');
              }
            } catch (error) {
              console.error('Failed to save proxy settings:', error);
              message.error('保存代理设置失败');
            }
          }}
        >
          <Form.Item
            label="启用代理"
            name="proxyEnabled"
            valuePropName="checked"
            tooltip="用于访问 Google、Booru 站点等需要代理的网络资源"
          >
            <Switch />
          </Form.Item>

          <Form.Item
            label="代理协议"
            name="proxyProtocol"
            rules={[{ required: true, message: '请选择代理协议' }]}
          >
            <Select style={{ width: 200 }}>
              <Option value="http">HTTP</Option>
              <Option value="https">HTTPS</Option>
              <Option value="socks5">SOCKS5</Option>
            </Select>
          </Form.Item>

          <Form.Item
            label="代理主机"
            name="proxyHost"
            rules={[{ required: true, message: '请输入代理主机' }]}
            tooltip="例如：127.0.0.1 或 localhost"
          >
            <Input placeholder="127.0.0.1" style={{ width: '50%' }} />
          </Form.Item>

          <Form.Item
            label="代理端口"
            name="proxyPort"
            rules={[{ required: true, message: '请输入代理端口' }]}
            tooltip="通常为 7890、1080、10809 等"
          >
            <Input type="number" placeholder="7890" style={{ width: 200 }} />
          </Form.Item>

          <Form.Item
            label="用户名（可选）"
            name="proxyUsername"
            tooltip="如果代理需要认证，请输入用户名"
          >
            <Input placeholder="留空表示不需要认证" style={{ width: '50%' }} />
          </Form.Item>

          <Form.Item
            label="密码（可选）"
            name="proxyPassword"
            tooltip="如果代理需要认证，请输入密码"
          >
            <Input.Password placeholder="留空表示不需要认证" style={{ width: '50%' }} />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>
                保存代理设置
              </Button>
              <Button onClick={async () => {
                await proxyForm.resetFields();
                await loadConfig();
              }}>
                重置
              </Button>
            </Space>
          </Form.Item>

          <Form.Item label="网络连通性测试">
            <Space>
              <Button 
                onClick={async () => {
                  console.log('[SettingsPage] 开始测试百度连接');
                  if (!window.electronAPI) {
                    message.error('系统功能不可用');
                    return;
                  }
                  
                  try {
                    const result = await window.electronAPI.system.testBaidu();
                    if (result.success) {
                      message.success(`百度连接成功！状态码: ${result.status}`);
                    } else {
                      message.error('百度连接失败: ' + result.error);
                    }
                  } catch (error) {
                    console.error('[SettingsPage] 测试百度连接失败:', error);
                    message.error('测试失败: ' + String(error));
                  }
                }}
              >
                测试百度
              </Button>
              <Button 
                onClick={async () => {
                  console.log('[SettingsPage] 开始测试Google连接');
                  if (!window.electronAPI) {
                    message.error('系统功能不可用');
                    return;
                  }
                  
                  try {
                    const result = await window.electronAPI.system.testGoogle();
                    if (result.success) {
                      message.success(`Google连接成功！状态码: ${result.status}`);
                    } else {
                      message.error('Google连接失败: ' + result.error);
                    }
                  } catch (error) {
                    console.error('[SettingsPage] 测试Google连接失败:', error);
                    message.error('测试失败: ' + String(error));
                  }
                }}
              >
                测试Google
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Card title="高级设置" style={{ marginBottom: '24px' }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Button>
            清除缓存
          </Button>
          <Button>
            重新索引数据库
          </Button>
          <Button danger>
            重置所有设置
          </Button>
        </Space>
      </Card>

      <Card title="关于">
        <p>版本: 1.0.0</p>
        <p>Electron: 27.0.0</p>
        <p>React: 18.2.0</p>
        <p>Ant Design: 5.11.0</p>
      </Card>
    </div>
  );
};
