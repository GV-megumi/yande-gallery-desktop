import React, { useState, useEffect, useCallback } from 'react';
import { Card, Table, Button, Input, Space, Tag, Popconfirm, Modal, Form, Select, Empty, Switch, App, Tooltip } from 'antd';
import { DeleteOutlined, PlusOutlined, StopOutlined, ImportOutlined, ExportOutlined, DownloadOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import type { BlacklistedTag } from '../../shared/types';
import { colors, spacing, radius, fontSize } from '../styles/tokens';

const { TextArea } = Input;

/**
 * 黑名单标签管理页面
 * 管理用户设置的黑名单标签，包含黑名单标签的图片在浏览时自动隐藏
 */
export const BlacklistedTagsPage: React.FC = () => {
  const { message } = App.useApp();
  const [blacklistedTags, setBlacklistedTags] = useState<BlacklistedTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [batchAddMode, setBatchAddMode] = useState(false);
  const [sites, setSites] = useState<any[]>([]);
  const [filterSiteId, setFilterSiteId] = useState<number | null | undefined>(undefined);
  const [form] = Form.useForm();

  // 加载黑名单标签列表
  const loadBlacklistedTags = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.booru.getBlacklistedTags(filterSiteId);
      if (result.success && result.data) {
        setBlacklistedTags(result.data);
        console.log('[BlacklistedTagsPage] 加载黑名单标签:', result.data.length, '个');
      } else {
        console.error('[BlacklistedTagsPage] 加载黑名单标签失败:', result.error);
      }
    } catch (error) {
      console.error('[BlacklistedTagsPage] 加载黑名单标签失败:', error);
      message.error('加载黑名单标签失败');
    } finally {
      setLoading(false);
    }
  }, [filterSiteId]);

  // 加载站点列表
  const loadSites = useCallback(async () => {
    try {
      const result = await window.electronAPI.booru.getSites();
      if (result.success && result.data) {
        setSites(result.data);
      }
    } catch (error) {
      console.error('[BlacklistedTagsPage] 加载站点列表失败:', error);
    }
  }, []);

  useEffect(() => {
    loadSites();
  }, [loadSites]);

  useEffect(() => {
    loadBlacklistedTags();
  }, [loadBlacklistedTags]);

  // 添加单个黑名单标签
  const handleAdd = async (values: any) => {
    try {
      if (batchAddMode) {
        // 批量添加模式
        const result = await window.electronAPI.booru.addBlacklistedTags(
          values.tagNames,
          values.siteId ?? null,
          values.reason || undefined
        );
        if (result.success && result.data) {
          message.success(`已添加 ${result.data.added} 个标签，跳过 ${result.data.skipped} 个`);
          setAddModalVisible(false);
          form.resetFields();
          loadBlacklistedTags();
        } else {
          message.error('添加失败: ' + result.error);
        }
      } else {
        // 单个添加模式
        const result = await window.electronAPI.booru.addBlacklistedTag(
          values.tagName.trim(),
          values.siteId ?? null,
          values.reason || undefined
        );
        if (result.success) {
          message.success(`已添加黑名单: ${values.tagName}`);
          setAddModalVisible(false);
          form.resetFields();
          loadBlacklistedTags();
        } else {
          message.error('添加失败: ' + result.error);
        }
      }
    } catch (error) {
      console.error('[BlacklistedTagsPage] 添加黑名单标签失败:', error);
      message.error('添加黑名单标签失败');
    }
  };

  // 删除黑名单标签
  const handleDelete = async (id: number) => {
    try {
      const result = await window.electronAPI.booru.removeBlacklistedTag(id);
      if (result.success) {
        message.success('已移除黑名单标签');
        loadBlacklistedTags();
      } else {
        message.error('移除失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BlacklistedTagsPage] 删除黑名单标签失败:', error);
      message.error('删除失败');
    }
  };

  // 切换激活状态
  const handleToggle = async (id: number) => {
    try {
      const result = await window.electronAPI.booru.toggleBlacklistedTag(id);
      if (result.success) {
        loadBlacklistedTags();
      } else {
        message.error('切换状态失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BlacklistedTagsPage] 切换黑名单标签状态失败:', error);
      message.error('切换状态失败');
    }
  };

  // 获取站点名称
  const getSiteName = (siteId: number | null) => {
    if (siteId === null) return '全局';
    const site = sites.find(s => s.id === siteId);
    return site ? site.name : `站点 #${siteId}`;
  };

  // 统计信息
  const activeCount = blacklistedTags.filter(t => t.isActive).length;
  const totalCount = blacklistedTags.length;

  // 表格列定义
  const columns = [
    {
      title: '标签名',
      dataIndex: 'tagName',
      key: 'tagName',
      render: (tagName: string, record: BlacklistedTag) => (
        <Tag
          color={record.isActive ? 'red' : 'default'}
          style={{ fontSize: '14px', padding: '2px 8px' }}
        >
          <StopOutlined style={{ marginRight: 4 }} />
          {tagName.replace(/_/g, ' ')}
        </Tag>
      )
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 100,
      render: (isActive: boolean, record: BlacklistedTag) => (
        <Tooltip title={isActive ? '点击禁用' : '点击启用'}>
          <Switch
            checked={isActive}
            onChange={() => handleToggle(record.id)}
            checkedChildren={<CheckCircleOutlined />}
            unCheckedChildren={<CloseCircleOutlined />}
            size="small"
          />
        </Tooltip>
      )
    },
    {
      title: '站点',
      dataIndex: 'siteId',
      key: 'siteId',
      width: 120,
      render: (siteId: number | null) => (
        <Tag color={siteId === null ? 'purple' : 'blue'}>
          {getSiteName(siteId)}
        </Tag>
      )
    },
    {
      title: '原因',
      dataIndex: 'reason',
      key: 'reason',
      width: 200,
      render: (reason: string | undefined) => reason || '-'
    },
    {
      title: '添加时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (date: string) => new Date(date).toLocaleString('zh-CN')
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_: any, record: BlacklistedTag) => (
        <Popconfirm
          title="确定移除此黑名单标签？"
          onConfirm={() => handleDelete(record.id)}
          okText="确定"
          cancelText="取消"
        >
          <Button type="text" danger size="small" icon={<DeleteOutlined />} />
        </Popconfirm>
      )
    }
  ];

  return (
    <div style={{ padding: spacing.xl }}>
      {/* 顶部统计和操作 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing.lg
      }}>
        <div>
          <span style={{ color: colors.textSecondary, fontSize: fontSize.md }}>
            共 {totalCount} 个黑名单标签，{activeCount} 个已激活
          </span>
        </div>
        <Space>
          <Select
            style={{ width: 160 }}
            placeholder="筛选站点"
            allowClear
            value={filterSiteId ?? '__all__'}
            onChange={(value: string | number) => setFilterSiteId(value === '__all__' ? null : value as number)}
          >
            <Select.Option value="__all__">全部站点</Select.Option>
            {sites.map(site => (
              <Select.Option key={site.id} value={site.id}>{site.name}</Select.Option>
            ))}
          </Select>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setBatchAddMode(false);
              setAddModalVisible(true);
            }}
          >
            添加
          </Button>
          <Button
            icon={<ImportOutlined />}
            onClick={() => {
              setBatchAddMode(true);
              setAddModalVisible(true);
            }}
          >
            批量添加
          </Button>
          <Button
            icon={<ExportOutlined />}
            onClick={async () => {
              try {
                const result = await window.electronAPI.booru.exportBlacklistedTags(filterSiteId);
                if (result.success && result.data) {
                  message.success(`已导出 ${result.data.count} 个黑名单标签`);
                } else if (result.error !== '取消导出') {
                  message.error('导出失败: ' + result.error);
                }
              } catch (error) {
                message.error('导出失败');
              }
            }}
          >
            导出
          </Button>
          <Button
            icon={<DownloadOutlined />}
            onClick={async () => {
              try {
                const result = await window.electronAPI.booru.importBlacklistedTags();
                if (result.success && result.data) {
                  message.success(`已导入 ${result.data.imported} 个标签，跳过 ${result.data.skipped} 个`);
                  loadBlacklistedTags();
                } else if (result.error !== '取消导入') {
                  message.error('导入失败: ' + result.error);
                }
              } catch (error) {
                message.error('导入失败');
              }
            }}
          >
            导入
          </Button>
        </Space>
      </div>

      {/* 标签列表 */}
      {blacklistedTags.length === 0 && !loading ? (
        <Card style={{ borderRadius: radius.md }}>
          <Empty
            description="暂无黑名单标签"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setBatchAddMode(false);
                setAddModalVisible(true);
              }}
            >
              添加黑名单标签
            </Button>
          </Empty>
        </Card>
      ) : (
        <Card style={{ borderRadius: radius.md }} bodyStyle={{ padding: 0 }}>
          <Table
            dataSource={blacklistedTags}
            columns={columns}
            rowKey="id"
            loading={loading}
            pagination={blacklistedTags.length > 20 ? { pageSize: 20 } : false}
            size="middle"
          />
        </Card>
      )}

      {/* 添加黑名单标签弹窗 */}
      <Modal
        title={batchAddMode ? '批量添加黑名单标签' : '添加黑名单标签'}
        open={addModalVisible}
        onCancel={() => {
          setAddModalVisible(false);
          form.resetFields();
        }}
        footer={null}
        width={500}
        forceRender
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleAdd}
          initialValues={{ siteId: undefined }}
        >
          {batchAddMode ? (
            <Form.Item
              name="tagNames"
              label="标签列表（每行一个）"
              rules={[{ required: true, message: '请输入至少一个标签' }]}
            >
              <TextArea
                rows={8}
                placeholder={"ugly_tag\nbad_quality\nlow_resolution"}
              />
            </Form.Item>
          ) : (
            <Form.Item
              name="tagName"
              label="标签名"
              rules={[{ required: true, message: '请输入标签名' }]}
            >
              <Input placeholder="输入标签名，如: ugly_tag" />
            </Form.Item>
          )}

          <Form.Item name="siteId" label="适用站点">
            <Select placeholder="全局（所有站点）" allowClear>
              {sites.map(site => (
                <Select.Option key={site.id} value={site.id}>{site.name}</Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item name="reason" label="原因（可选）">
            <Input placeholder="添加黑名单的原因" />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                {batchAddMode ? '批量添加' : '添加'}
              </Button>
              <Button onClick={() => {
                setAddModalVisible(false);
                form.resetFields();
              }}>
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
