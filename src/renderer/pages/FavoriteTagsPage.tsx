import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Table, Button, Input, Space, Tag, message, Popconfirm, Modal, Form, Select, Empty, Tooltip } from 'antd';
import { StarOutlined, StarFilled, DeleteOutlined, PlusOutlined, EditOutlined, SearchOutlined, ExportOutlined, ImportOutlined, HolderOutlined } from '@ant-design/icons';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import type { FavoriteTag } from '../../shared/types';
import { useLocale } from '../locales';

interface FavoriteTagsPageProps {
  /** 点击标签时的回调，用于跳转到标签搜索页面 */
  onTagClick?: (tag: string, siteId?: number | null) => void;
}

/** 可拖拽的表格行组件 */
const SortableRow: React.FC<any> = (props) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props['data-row-key'],
  });

  const style: React.CSSProperties = {
    ...props.style,
    transform: CSS.Transform.toString(transform),
    transition,
    cursor: 'move',
    ...(isDragging ? { position: 'relative', zIndex: 9999, background: '#fafafa', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' } : {}),
  };

  return <tr {...props} ref={setNodeRef} style={style} {...attributes} {...listeners} />;
};

/**
 * 收藏标签管理页面
 * 展示用户收藏的标签列表，支持添加、编辑、删除、拖拽排序
 */
export const FavoriteTagsPage: React.FC<FavoriteTagsPageProps> = ({ onTagClick }) => {
  const { t } = useLocale();
  const [favoriteTags, setFavoriteTags] = useState<FavoriteTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [editingTag, setEditingTag] = useState<FavoriteTag | null>(null);
  const [sites, setSites] = useState<any[]>([]);
  const [filterSiteId, setFilterSiteId] = useState<number | null | undefined>(undefined);
  const [form] = Form.useForm();

  // dnd-kit 传感器：需要拖拽 5px 才触发，防止误触
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

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
      message.error(t('common.failed'));
    } finally {
      setLoading(false);
    }
  }, [filterSiteId, t]);

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

  useEffect(() => { loadSites(); }, [loadSites]);
  useEffect(() => { loadFavoriteTags(); }, [loadFavoriteTags]);

  // 拖拽排序结束
  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = favoriteTags.findIndex(tag => tag.id === active.id);
    const newIndex = favoriteTags.findIndex(tag => tag.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // 乐观更新：先更新 UI
    const newTags = arrayMove(favoriteTags, oldIndex, newIndex);
    setFavoriteTags(newTags);

    // 批量更新 sortOrder 到后端
    console.log('[FavoriteTagsPage] 拖拽排序: 从', oldIndex, '到', newIndex);
    try {
      const updates = newTags.map((tag, index) => ({
        id: tag.id,
        sortOrder: index + 1,
      }));
      // 逐个更新 sortOrder
      await Promise.all(
        updates.map(u => window.electronAPI.booru.updateFavoriteTag(u.id, { sortOrder: u.sortOrder }))
      );
      console.log('[FavoriteTagsPage] 排序保存成功');
    } catch (error) {
      console.error('[FavoriteTagsPage] 排序保存失败:', error);
      message.error(t('common.failed'));
      // 回滚：重新加载
      loadFavoriteTags();
    }
  }, [favoriteTags, loadFavoriteTags, t]);

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
        message.success(t('favoriteTags.favorited', { name: tagName }));
        setAddModalVisible(false);
        form.resetFields();
        loadFavoriteTags();
      } else {
        message.error(t('common.failed') + ': ' + result.error);
      }
    } catch (error) {
      console.error('[FavoriteTagsPage] 添加收藏标签失败:', error);
      message.error(t('common.failed'));
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
        message.success(t('favoriteTags.updateSuccess'));
        setEditingTag(null);
        form.resetFields();
        loadFavoriteTags();
      } else {
        message.error(t('common.failed') + ': ' + result.error);
      }
    } catch (error) {
      console.error('[FavoriteTagsPage] 编辑收藏标签失败:', error);
      message.error(t('common.failed'));
    }
  };

  // 删除收藏标签
  const handleDelete = async (id: number) => {
    try {
      const result = await window.electronAPI.booru.removeFavoriteTag(id);
      if (result.success) {
        message.success(t('favoriteTags.unfavorited'));
        loadFavoriteTags();
      } else {
        message.error(t('common.failed') + ': ' + result.error);
      }
    } catch (error) {
      console.error('[FavoriteTagsPage] 删除收藏标签失败:', error);
      message.error(t('common.failed'));
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
    if (siteId === null) return t('favoriteTags.global');
    const site = sites.find(s => s.id === siteId);
    return site ? site.name : `#${siteId}`;
  };

  // 表格列定义
  const columns = [
    {
      title: '',
      dataIndex: 'sort',
      key: 'sort',
      width: 40,
      render: () => <HolderOutlined style={{ cursor: 'grab', color: '#999' }} />,
    },
    {
      title: t('favoriteTags.tagName'),
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
      title: t('favoriteTags.site'),
      dataIndex: 'siteId',
      key: 'siteId',
      width: 120,
      render: (siteId: number | null) => (
        <Tag color={siteId === null ? 'default' : 'green'}>{getSiteName(siteId)}</Tag>
      ),
    },
    {
      title: t('favoriteTags.group'),
      dataIndex: 'labels',
      key: 'labels',
      width: 200,
      render: (labels?: string[]) => (
        labels && labels.length > 0
          ? labels.map(label => <Tag key={label} color="purple">{label}</Tag>)
          : <span style={{ color: '#ccc' }}>{t('common.none')}</span>
      ),
    },
    {
      title: t('favoriteTags.notes'),
      dataIndex: 'notes',
      key: 'notes',
      width: 200,
      ellipsis: true,
      render: (notes?: string) => notes || <span style={{ color: '#ccc' }}>-</span>,
    },
    {
      title: t('favoriteTags.actions'),
      key: 'actions',
      width: 150,
      render: (_: any, record: FavoriteTag) => (
        <Space>
          <Tooltip title={t('favoriteTags.searchTag')}>
            <Button
              type="link"
              size="small"
              icon={<SearchOutlined />}
              onClick={() => handleTagClick(record)}
            />
          </Tooltip>
          <Tooltip title={t('common.edit')}>
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
          <Popconfirm title={t('favorites.removeConfirm')} onConfirm={() => handleDelete(record.id)}>
            <Tooltip title={t('favoriteTags.unfavorited')}>
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
              {t('favoriteTags.count', { count: favoriteTags.length })}
            </span>
          </Space>
          <Space>
            <Select
              placeholder={t('favoriteTags.filterSite')}
              allowClear
              style={{ width: 150 }}
              value={filterSiteId ?? '__all__'}
              onChange={(value: string | number) => setFilterSiteId(value === '__all__' ? null : value as number)}
            >
              <Select.Option value="__all__">{t('favoriteTags.globalTags')}</Select.Option>
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
              {t('favoriteTags.add')}
            </Button>
            <Button
              icon={<ExportOutlined />}
              onClick={async () => {
                try {
                  const result = await window.electronAPI.booru.exportFavoriteTags(filterSiteId);
                  if (result.success && result.data) {
                    message.success(t('favoriteTags.exportSuccess', { count: result.data.count }));
                  } else if (result.error !== '取消导出') {
                    message.error(t('favoriteTags.exportFailed') + ': ' + result.error);
                  }
                } catch (error) {
                  message.error(t('favoriteTags.exportFailed'));
                }
              }}
            >
              {t('common.export')}
            </Button>
            <Button
              icon={<ImportOutlined />}
              onClick={async () => {
                try {
                  const result = await window.electronAPI.booru.importFavoriteTags();
                  if (result.success && result.data) {
                    message.success(t('favoriteTags.importSuccess', {
                      imported: result.data.importedTags,
                      labels: result.data.importedLabels,
                      skipped: result.data.skippedTags
                    }));
                    loadFavoriteTags();
                  } else if (result.error !== '取消导入') {
                    message.error(t('favoriteTags.importFailed') + ': ' + result.error);
                  }
                } catch (error) {
                  message.error(t('favoriteTags.importFailed'));
                }
              }}
            >
              {t('common.import')}
            </Button>
          </Space>
        </Space>
      </Card>

      {/* 快捷标签区域 */}
      {favoriteTags.length > 0 && onTagClick && (
        <Card size="small" style={{ marginBottom: 16 }} title={t('favoriteTags.quickSearch')}>
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

      {/* 可拖拽排序的标签列表 */}
      <Card>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToVerticalAxis]}
        >
          <SortableContext
            items={favoriteTags.map(tag => tag.id)}
            strategy={verticalListSortingStrategy}
          >
            <Table
              dataSource={favoriteTags}
              columns={columns}
              rowKey="id"
              loading={loading}
              pagination={{ pageSize: 50 }}
              locale={{ emptyText: <Empty description={t('favoriteTags.noTags')} /> }}
              components={{
                body: {
                  row: SortableRow,
                },
              }}
            />
          </SortableContext>
        </DndContext>
      </Card>

      {/* 添加收藏标签弹窗 */}
      <Modal
        title={t('favoriteTags.addTitle')}
        open={addModalVisible}
        onCancel={() => { setAddModalVisible(false); form.resetFields(); }}
        onOk={() => form.submit()}
        okText={t('details.favorite')}
        cancelText={t('common.cancel')}
      >
        <Form form={form} layout="vertical" onFinish={handleAdd}>
          <Form.Item
            name="tagName"
            label={t('favoriteTags.tagName')}
            rules={[{ required: true, message: t('favoriteTags.tagNameRequired') }]}
          >
            <Input placeholder={t('favoriteTags.tagNamePlaceholder')} />
          </Form.Item>
          <Form.Item name="siteId" label={t('favoriteTags.site')}>
            <Select placeholder={t('favoriteTags.sitePlaceholder')} allowClear>
              {sites.map(site => (
                <Select.Option key={site.id} value={site.id}>{site.name}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="labels" label={t('favoriteTags.groupSeparator')}>
            <Input placeholder={t('favoriteTags.groupPlaceholder')} />
          </Form.Item>
          <Form.Item name="notes" label={t('favoriteTags.notes')}>
            <Input.TextArea rows={2} placeholder={t('favoriteTags.notesPlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑收藏标签弹窗 */}
      <Modal
        title={t('favoriteTags.editTitle', { name: editingTag?.tagName || '' })}
        open={!!editingTag}
        onCancel={() => { setEditingTag(null); form.resetFields(); }}
        onOk={() => form.submit()}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
      >
        <Form form={form} layout="vertical" onFinish={handleEdit}>
          <Form.Item name="labels" label={t('favoriteTags.groupSeparator')}>
            <Input placeholder={t('favoriteTags.groupPlaceholder')} />
          </Form.Item>
          <Form.Item name="notes" label={t('favoriteTags.notes')}>
            <Input.TextArea rows={2} placeholder={t('favoriteTags.notesPlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default FavoriteTagsPage;
