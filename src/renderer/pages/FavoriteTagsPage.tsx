import React, { useState, useEffect, useCallback } from 'react';
import { Card, Table, Button, Input, Space, Tag, message, Popconfirm, Modal, Form, Select, Empty, Tooltip } from 'antd';
import { StarOutlined, StarFilled, DeleteOutlined, PlusOutlined, EditOutlined, SearchOutlined } from '@ant-design/icons';
import type { FavoriteTag } from '../../shared/types';

interface FavoriteTagsPageProps {
  /** 点击标签时的回调，用于跳转到标签搜索页面 */
  onTagClick?: (tag: string, siteId?: number | null) => void;
}

/**
 * 收藏标签管理页面
 * 展示用户收藏的标签列表，支持添加、编辑、删除收藏标签
 */
export const FavoriteTagsPage: React.FC<FavoriteTagsPageProps> = ({ onTagClick }) => {
  const [favoriteTags, setFavoriteTags] = useState<FavoriteTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [editingTag, setEditingTag] = useState<FavoriteTag | null>(null);
  const [sites, setSites] = useState<any[]>([]);
  const [filterSiteId, setFilterSiteId] = useState<number | null | undefined>(undefined);
  const [form] = Form.useForm();

  // 加载收藏标签列表
  const loadFavoriteTags = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.booru.getFavoriteTags(filterSiteId);
      if (result.success && result.data) {
        setFavoriteTags(result.data);
        console.log('[FavoriteTagsPage] 加载收藏标签:', result.data.length, '个');
      } else {
        console.error('[FavoriteTagsPage] 加载收藏标签失败:', result.error);
      }
    } catch (error) {
      console.error('[FavoriteTagsPage] 加载收藏标签失败:', error);
      message.error('加载收藏标签失败');
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
      console.error('[FavoriteTagsPage] 加载站点列表失败:', error);
    }
  }, []);

  useEffect(() => {
    loadSites();
  }, [loadSites]);

  useEffect(() => {
    loadFavoriteTags();
  }, [loadFavoriteTags]);

  // 添加收藏标签
  const handleAdd = async (values: any) => {
    try {
      const { tagName, siteId, notes, labels } = values;
      const result = await window.electronAPI.booru.addFavoriteTag(
        siteId ?? null,
        tagName.trim(),
        {
          notes: notes || undefined,
          labels: labels ? labels.split(',').map((l: string) => l.trim()).filter(Boolean) : undefined
        }
      );
      if (result.success) {
        message.success(`已收藏标签: ${tagName}`);
        setAddModalVisible(false);
        form.resetFields();
        loadFavoriteTags();
      } else {
        message.error('收藏失败: ' + result.error);
      }
    } catch (error) {
      console.error('[FavoriteTagsPage] 添加收藏标签失败:', error);
      message.error('收藏标签失败');
    }
  };

  // 编辑收藏标签
  const handleEdit = async (values: any) => {
    if (!editingTag) return;
    try {
      const result = await window.electronAPI.booru.updateFavoriteTag(editingTag.id, {
        notes: values.notes || undefined,
        labels: values.labels ? values.labels.split(',').map((l: string) => l.trim()).filter(Boolean) : undefined
      });
      if (result.success) {
        message.success('更新成功');
        setEditingTag(null);
        form.resetFields();
        loadFavoriteTags();
      } else {
        message.error('更新失败: ' + result.error);
      }
    } catch (error) {
      console.error('[FavoriteTagsPage] 编辑收藏标签失败:', error);
      message.error('编辑失败');
    }
  };

  // 删除收藏标签
  const handleDelete = async (id: number) => {
    try {
      const result = await window.electronAPI.booru.removeFavoriteTag(id);
      if (result.success) {
        message.success('已取消收藏');
        loadFavoriteTags();
      } else {
        message.error('取消收藏失败: ' + result.error);
      }
    } catch (error) {
      console.error('[FavoriteTagsPage] 删除收藏标签失败:', error);
      message.error('删除失败');
    }
  };

  // 点击标签进行搜索
  const handleTagClick = (tag: FavoriteTag) => {
    if (onTagClick) {
      onTagClick(tag.tagName, tag.siteId);
    }
  };

  // 获取站点名称
  const getSiteName = (siteId: number | null) => {
    if (siteId === null) return '全局';
    const site = sites.find(s => s.id === siteId);
    return site ? site.name : `站点 #${siteId}`;
  };

  // 表格列定义
  const columns = [
    {
      title: '标签名',
      dataIndex: 'tagName',
      key: 'tagName',
      render: (tagName: string, record: FavoriteTag) => (
        <a onClick={() => handleTagClick(record)} style={{ cursor: 'pointer' }}>
          <Tag color="blue" style={{ cursor: 'pointer', fontSize: '14px', padding: '2px 8px' }}>
            {tagName.replace(/_/g, ' ')}
          </Tag>
        </a>
      ),
    },
    {
      title: '站点',
      dataIndex: 'siteId',
      key: 'siteId',
      width: 120,
      render: (siteId: number | null) => (
        <Tag color={siteId === null ? 'default' : 'green'}>{getSiteName(siteId)}</Tag>
      ),
    },
    {
      title: '分组',
      dataIndex: 'labels',
      key: 'labels',
      width: 200,
      render: (labels?: string[]) => (
        labels && labels.length > 0
          ? labels.map(label => <Tag key={label} color="purple">{label}</Tag>)
          : <span style={{ color: '#ccc' }}>无</span>
      ),
    },
    {
      title: '备注',
      dataIndex: 'notes',
      key: 'notes',
      width: 200,
      ellipsis: true,
      render: (notes?: string) => notes || <span style={{ color: '#ccc' }}>-</span>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_: any, record: FavoriteTag) => (
        <Space>
          <Tooltip title="搜索此标签">
            <Button
              type="link"
              size="small"
              icon={<SearchOutlined />}
              onClick={() => handleTagClick(record)}
            />
          </Tooltip>
          <Tooltip title="编辑">
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setEditingTag(record);
                form.setFieldsValue({
                  notes: record.notes || '',
                  labels: record.labels ? record.labels.join(', ') : ''
                });
              }}
            />
          </Tooltip>
          <Popconfirm title="确定取消收藏？" onConfirm={() => handleDelete(record.id)}>
            <Tooltip title="取消收藏">
              <Button type="link" size="small" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* 工具栏 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space>
            <StarFilled style={{ color: '#faad14', fontSize: 18 }} />
            <span style={{ fontSize: 16, fontWeight: 500 }}>
              收藏标签 ({favoriteTags.length})
            </span>
          </Space>
          <Space>
            <Select
              placeholder="筛选站点"
              allowClear
              style={{ width: 150 }}
              value={filterSiteId}
              onChange={(value) => setFilterSiteId(value)}
            >
              <Select.Option value={null}>全局标签</Select.Option>
              {sites.map(site => (
                <Select.Option key={site.id} value={site.id}>{site.name}</Select.Option>
              ))}
            </Select>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields();
                setAddModalVisible(true);
              }}
            >
              添加收藏
            </Button>
          </Space>
        </Space>
      </Card>

      {/* 快捷标签区域 */}
      {favoriteTags.length > 0 && onTagClick && (
        <Card size="small" style={{ marginBottom: 16 }} title="快速搜索">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {favoriteTags.map(tag => (
              <Tag
                key={tag.id}
                color="blue"
                style={{ cursor: 'pointer', fontSize: '13px', padding: '4px 10px' }}
                onClick={() => handleTagClick(tag)}
              >
                <StarFilled style={{ marginRight: 4, color: '#faad14' }} />
                {tag.tagName.replace(/_/g, ' ')}
              </Tag>
            ))}
          </div>
        </Card>
      )}

      {/* 标签列表 */}
      <Card>
        <Table
          dataSource={favoriteTags}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20 }}
          locale={{ emptyText: <Empty description="还没有收藏的标签" /> }}
        />
      </Card>

      {/* 添加收藏标签弹窗 */}
      <Modal
        title="添加收藏标签"
        open={addModalVisible}
        onCancel={() => { setAddModalVisible(false); form.resetFields(); }}
        onOk={() => form.submit()}
        okText="收藏"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" onFinish={handleAdd}>
          <Form.Item
            name="tagName"
            label="标签名"
            rules={[{ required: true, message: '请输入标签名' }]}
          >
            <Input placeholder="例如: blue_eyes, landscape" />
          </Form.Item>
          <Form.Item name="siteId" label="所属站点">
            <Select placeholder="选择站点（留空为全局）" allowClear>
              {sites.map(site => (
                <Select.Option key={site.id} value={site.id}>{site.name}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="labels" label="分组（逗号分隔）">
            <Input placeholder="例如: 角色, 风格" />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} placeholder="可选备注信息" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑收藏标签弹窗 */}
      <Modal
        title={`编辑收藏标签: ${editingTag?.tagName || ''}`}
        open={!!editingTag}
        onCancel={() => { setEditingTag(null); form.resetFields(); }}
        onOk={() => form.submit()}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" onFinish={handleEdit}>
          <Form.Item name="labels" label="分组（逗号分隔）">
            <Input placeholder="例如: 角色, 风格" />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} placeholder="可选备注信息" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default FavoriteTagsPage;
