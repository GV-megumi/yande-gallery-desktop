/**
 * 批量下载任务创建表单
 * 参考：Boorusama create_download_options_notifier.dart
 */

import React, { useState, useEffect } from 'react';
import { Form, Input, Select, Switch, InputNumber, Button, Space, message } from 'antd';
import { BulkDownloadOptions, BooruSite, BulkDownloadTask } from '../../shared/types';

interface BulkDownloadTaskFormProps {
  sites: BooruSite[];
  task?: BulkDownloadTask; // 编辑模式时传入任务
  onSubmit: (options: BulkDownloadOptions, taskId?: string) => Promise<void>;
  onCancel: () => void;
}

export const BulkDownloadTaskForm: React.FC<BulkDownloadTaskFormProps> = ({
  sites,
  task,
  onSubmit,
  onCancel
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [selectedSiteId, setSelectedSiteId] = useState<number | undefined>();
  const isEditMode = !!task;

  // 选择文件夹
  const handleSelectFolder = async () => {
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.system.selectFolder();
      if (result.success && result.data) {
        form.setFieldsValue({ path: result.data });
      }
    } catch (error) {
      console.error('选择文件夹失败:', error);
      message.error('选择文件夹失败');
    }
  };

  // 提交表单
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const options: BulkDownloadOptions = {
        siteId: values.siteId,
        path: values.path,
        tags: values.tags.split(/\s+/).filter((t: string) => t.trim()),
        blacklistedTags: values.blacklistedTags 
          ? values.blacklistedTags.split(/\s+/).filter((t: string) => t.trim())
          : undefined,
        notifications: values.notifications,
        skipIfExists: values.skipIfExists,
        quality: values.quality,
        perPage: values.perPage,
        concurrency: values.concurrency
      };

      await onSubmit(options, task?.id);
    } catch (error) {
      console.error('表单验证失败:', error);
    } finally {
      setLoading(false);
    }
  };

  // 初始化表单值（编辑模式）
  useEffect(() => {
    if (task) {
      form.setFieldsValue({
        siteId: task.siteId,
        path: task.path,
        tags: task.tags,
        blacklistedTags: task.blacklistedTags || '',
        notifications: task.notifications,
        skipIfExists: task.skipIfExists,
        quality: task.quality || 'original',
        perPage: task.perPage,
        concurrency: task.concurrency
      });
      setSelectedSiteId(task.siteId);
    }
  }, [task, form]);

  // 获取默认下载路径
  useEffect(() => {
    const loadDefaultPath = async () => {
      try {
        if (!window.electronAPI) return;

        const configResult = await window.electronAPI.config.get();
        if (configResult.success && configResult.data?.downloads?.path) {
          form.setFieldsValue({ path: configResult.data.downloads.path });
        }
      } catch (error) {
        console.error('加载默认路径失败:', error);
      }
    };

    loadDefaultPath();
  }, [form]);

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={{
        siteId: sites.find(s => s.active)?.id,
        notifications: true,
        skipIfExists: true,
        perPage: 20,
        concurrency: 3,
        quality: 'original'
      }}
    >
      <Form.Item
        label="站点"
        name="siteId"
        rules={[{ required: true, message: '请选择站点' }]}
      >
        <Select
          placeholder="选择Booru站点"
          onChange={(value) => setSelectedSiteId(value)}
        >
          {sites.map(site => (
            <Select.Option key={site.id} value={site.id}>
              {site.name}
            </Select.Option>
          ))}
        </Select>
      </Form.Item>

      <Form.Item
        label="下载路径"
        name="path"
        rules={[{ required: true, message: '请选择下载路径' }]}
      >
        <Input.Group compact>
          <Input
            style={{ width: 'calc(100% - 100px)' }}
            placeholder="选择下载目录"
            readOnly
          />
          <Button onClick={handleSelectFolder}>选择文件夹</Button>
        </Input.Group>
      </Form.Item>

      <Form.Item
        label="标签"
        name="tags"
        rules={[{ required: true, message: '请输入标签' }]}
        help="多个标签用空格分隔，例如: girl blue_eyes"
      >
        <Input.TextArea
          rows={3}
          placeholder="输入标签，多个标签用空格分隔"
        />
      </Form.Item>

      <Form.Item
        label="黑名单标签（可选）"
        name="blacklistedTags"
        help="排除包含这些标签的图片，多个标签用空格分隔"
      >
        <Input.TextArea
          rows={2}
          placeholder="输入要排除的标签，多个标签用空格分隔"
        />
      </Form.Item>

      <Form.Item
        label="图片质量"
        name="quality"
      >
        <Select>
          <Select.Option value="original">原图</Select.Option>
          <Select.Option value="sample">样本</Select.Option>
          <Select.Option value="preview">预览</Select.Option>
        </Select>
      </Form.Item>

      <Form.Item
        label="每页数量"
        name="perPage"
        rules={[{ required: true, message: '请输入每页数量' }]}
      >
        <InputNumber min={1} max={100} style={{ width: '100%' }} />
      </Form.Item>

      <Form.Item
        label="并发数"
        name="concurrency"
        rules={[{ required: true, message: '请输入并发数' }]}
        help="同时下载的图片数量"
      >
        <InputNumber min={1} max={10} style={{ width: '100%' }} />
      </Form.Item>

      <Form.Item
        label="通知"
        name="notifications"
        valuePropName="checked"
      >
        <Switch />
      </Form.Item>

      <Form.Item
        label="跳过已存在文件"
        name="skipIfExists"
        valuePropName="checked"
      >
        <Switch />
      </Form.Item>

      <Form.Item>
        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" onClick={handleSubmit} loading={loading}>
            {isEditMode ? '保存' : '创建并开始下载'}
          </Button>
        </Space>
      </Form.Item>
    </Form>
  );
};

