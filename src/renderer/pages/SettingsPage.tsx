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

  // 加载配置
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    if (!window.electronAPI) {
      console.error('electronAPI is not available');
      return;
    }

    try {
      setLoading(true);
      const result = await window.electronAPI.config.get();
      if (result.success && result.data) {
        const config = result.data;
        setFolders(config.galleries?.folders || []);
        form.setFieldsValue({
          downloadPath: config.downloads?.path || './downloads',
          thumbnailSize: config.thumbnails?.maxWidth || 200,
          autoGenerateThumbnail: true,
          theme: config.app?.defaultViewMode || 'light',
          language: 'zh-CN'
        });
      }
    } catch (error) {
      console.error('Failed to load config:', error);
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  // 添加文件夹
  const handleAddFolder = async () => {
    if (!window.electronAPI) {
      message.error('系统功能不可用');
      return;
    }

    try {
      const result = await window.electronAPI.system.selectFolder();
      if (!result.success || !result.data) {
        return;
      }

      const folderPath = result.data;
      
      // 检查是否已存在
      if (folders.some(f => f.path === folderPath)) {
        message.warning('该文件夹已存在');
        return;
      }

      // 生成文件夹名称（使用文件夹名）
      const folderName = folderPath.split(/[/\\]/).pop() || '未命名文件夹';

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

      // 保存配置
      await saveFoldersConfig(updatedFolders);

      // 首次添加时自动扫描子文件夹并创建图集（后台执行，弹框立即关闭）
      Modal.confirm({
        title: '扫描子文件夹',
        content: `是否立即扫描 "${folderName}" 下的所有子文件夹并创建图集？`,
        okText: '立即扫描',
        cancelText: '稍后扫描',
        onOk: () => {
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
      message.error('系统功能不可用');
      return;
    }

    try {
      setScanning(rootPath);
      message.loading({ content: '正在后台扫描子文件夹...', key: 'scanning', duration: 0 });

      const result = await window.electronAPI.gallery.scanSubfolders(rootPath, extensions);
      
      if (result.success && result.data) {
        const anyData: any = result.data;
        const { created, skipped } = anyData;
        const imported = anyData.imported ?? 0;
        const imageSkipped = anyData.imageSkipped ?? 0;
        message.success({
          content: `扫描完成：创建图集 ${created} 个，跳过 ${skipped} 个，导入图片 ${imported} 张，跳过 ${imageSkipped} 张`,
          key: 'scanning',
          duration: 5
        });
      } else {
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
    }
  };

  // 删除文件夹
  const handleDeleteFolder = (index: number) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除文件夹 "${folders[index].name}" 吗？`,
      okText: '删除',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        const updatedFolders = folders.filter((_, i) => i !== index);
        setFolders(updatedFolders);
        await saveFoldersConfig(updatedFolders);
        message.success('已删除文件夹');
      }
    });
  };

  // 保存文件夹配置
  const saveFoldersConfig = async (foldersToSave: GalleryFolder[]) => {
    if (!window.electronAPI) {
      message.error('系统功能不可用');
      return;
    }

    try {
      const result = await window.electronAPI.config.updateGalleryFolders(foldersToSave);
      if (result.success) {
        console.log('Folders config saved');
      } else {
        message.error(result.error || '保存配置失败');
      }
    } catch (error) {
      console.error('Failed to save folders config:', error);
      message.error('保存配置失败');
    }
  };

  // 保存设置
  const handleSave = async (values: any) => {
    setSaving(true);
    try {
      if (!window.electronAPI) {
        message.error('系统功能不可用');
        return;
      }

      // 加载当前配置
      const configResult = await window.electronAPI.config.get();
      if (!configResult.success || !configResult.data) {
        message.error('获取配置失败');
        return;
      }

      // 更新配置
      const updatedConfig = {
        ...configResult.data,
        downloads: {
          ...configResult.data.downloads,
          path: values.downloadPath
        },
        thumbnails: {
          ...configResult.data.thumbnails,
          maxWidth: values.thumbnailSize,
          maxHeight: values.thumbnailSize
        },
        app: {
          ...configResult.data.app,
          defaultViewMode: values.theme
        }
      };

      const result = await window.electronAPI.config.save(updatedConfig);
      if (result.success) {
        message.success('设置已保存');
      } else {
        message.error(result.error || '保存失败');
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
      message.error('保存失败');
    } finally {
      setSaving(false);
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
              addonAfter={<FolderOutlined />}
              placeholder="./downloads"
            />
          </Form.Item>

          <Form.Item
            label="缩略图大小"
            name="thumbnailSize"
            rules={[{ required: true, message: '请选择缩略图大小' }]}
          >
            <Select>
              <Option value={150}>小 (150px)</Option>
              <Option value={200}>中 (200px)</Option>
              <Option value={300}>大 (300px)</Option>
            </Select>
          </Form.Item>

          <Form.Item
            label="自动生成缩略图"
            name="autoGenerateThumbnail"
            valuePropName="checked"
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
