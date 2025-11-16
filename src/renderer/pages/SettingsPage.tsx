import React, { useState } from 'react';
import { Card, Form, Input, Button, Switch, Select, message, Space } from 'antd';
import { SaveOutlined, FolderOutlined } from '@ant-design/icons';

const { Option } = Select;

export const SettingsPage: React.FC = () => {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  // 保存设置
  const handleSave = async (values: any) => {
    setSaving(true);
    try {
      // 这里应该保存设置到配置文件
      console.log('Saving settings:', values);

      // 模拟保存过程
      setTimeout(() => {
        message.success('设置已保存');
        setSaving(false);
      }, 1000);
    } catch (error) {
      console.error('Failed to save settings:', error);
      message.error('保存失败');
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
      <Card title="应用设置" style={{ marginBottom: '24px' }}>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
          initialValues={{
            downloadPath: './downloads',
            thumbnailSize: 200,
            autoGenerateThumbnail: true,
            theme: 'light',
            language: 'zh-CN'
          }}
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