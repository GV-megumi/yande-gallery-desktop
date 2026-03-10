/**
 * 保存的搜索页面
 * 管理用户保存的搜索查询，支持快速跳转到对应搜索
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button, Input, Modal, Empty, App, Popconfirm, Select, Typography, Tag, Tooltip } from 'antd';
import { PlusOutlined, DeleteOutlined, SearchOutlined, EditOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { BooruSite } from '../../shared/types';
import { colors, spacing, fontSize, radius, shadows } from '../styles/tokens';

const { Text } = Typography;
const { Option } = Select;

interface SavedSearch {
  id: number;
  siteId: number | null;
  name: string;
  query: string;
  createdAt: string;
}

interface BooruSavedSearchesPageProps {
  /** 点击"搜索"时导航到 BooruPage 并带入标签 */
  onRunSearch?: (query: string, siteId?: number | null) => void;
}

export const BooruSavedSearchesPage: React.FC<BooruSavedSearchesPageProps> = ({ onRunSearch }) => {
  const { message } = App.useApp();
  const [sites, setSites] = useState<BooruSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(false);

  // 新建/编辑弹窗
  const [modalVisible, setModalVisible] = useState(false);
  const [editingSearch, setEditingSearch] = useState<SavedSearch | null>(null);
  const [formName, setFormName] = useState('');
  const [formQuery, setFormQuery] = useState('');
  const [formSiteId, setFormSiteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // 加载站点列表
  useEffect(() => {
    const loadSites = async () => {
      if (!window.electronAPI) return;
      try {
        const result = await window.electronAPI.booru.getSites();
        if (result.success && result.data) setSites(result.data);
      } catch (error) {
        console.error('[BooruSavedSearchesPage] 加载站点失败:', error);
      }
    };
    loadSites();
  }, []);

  // 加载保存的搜索
  const loadSearches = useCallback(async () => {
    if (!window.electronAPI) return;
    setLoading(true);
    try {
      const result = await window.electronAPI.booru.getSavedSearches(selectedSiteId);
      if (result.success && result.data) {
        setSearches(result.data);
        console.log('[BooruSavedSearchesPage] 加载保存的搜索:', result.data.length, '条');
      }
    } catch (error) {
      console.error('[BooruSavedSearchesPage] 加载保存的搜索失败:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedSiteId]);

  useEffect(() => { loadSearches(); }, [loadSearches]);

  // 打开新建弹窗
  const handleAdd = () => {
    setEditingSearch(null);
    setFormName('');
    setFormQuery('');
    setFormSiteId(selectedSiteId);
    setModalVisible(true);
  };

  // 打开编辑弹窗
  const handleEdit = (s: SavedSearch) => {
    setEditingSearch(s);
    setFormName(s.name);
    setFormQuery(s.query);
    setFormSiteId(s.siteId);
    setModalVisible(true);
  };

  // 保存（新建或更新）
  const handleSave = async () => {
    if (!formName.trim()) { message.warning('请输入名称'); return; }
    if (!formQuery.trim()) { message.warning('请输入搜索词'); return; }

    setSaving(true);
    try {
      if (editingSearch) {
        const result = await window.electronAPI.booru.updateSavedSearch(editingSearch.id, formName.trim(), formQuery.trim());
        if (result.success) {
          message.success('已更新');
          setModalVisible(false);
          loadSearches();
        } else {
          message.error('更新失败: ' + result.error);
        }
      } else {
        const result = await window.electronAPI.booru.addSavedSearch(formSiteId, formName.trim(), formQuery.trim());
        if (result.success) {
          message.success('已保存');
          setModalVisible(false);
          loadSearches();
        } else {
          message.error('保存失败: ' + result.error);
        }
      }
    } catch (error) {
      message.error('操作失败');
    } finally {
      setSaving(false);
    }
  };

  // 删除
  const handleDelete = async (id: number) => {
    try {
      const result = await window.electronAPI.booru.deleteSavedSearch(id);
      if (result.success) {
        message.success('已删除');
        loadSearches();
      } else {
        message.error('删除失败: ' + result.error);
      }
    } catch (error) {
      message.error('删除失败');
    }
  };

  // 执行搜索
  const handleRun = (s: SavedSearch) => {
    console.log('[BooruSavedSearchesPage] 执行搜索:', s.query, '站点:', s.siteId);
    if (onRunSearch) {
      onRunSearch(s.query, s.siteId);
    } else {
      message.info('导航功能未配置');
    }
  };

  const getSiteName = (siteId: number | null) => {
    if (!siteId) return '全部站点';
    return sites.find(s => s.id === siteId)?.name || '未知站点';
  };

  return (
    <div>
      {/* 工具栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg }}>
        <Select
          value={selectedSiteId}
          onChange={setSelectedSiteId}
          style={{ width: 180 }}
          placeholder="全部站点"
        >
          <Option value={null}>全部站点</Option>
          {sites.map(s => <Option key={s.id} value={s.id}>{s.name}</Option>)}
        </Select>

        <div style={{ flex: 1 }} />

        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleAdd}
        >
          新建搜索
        </Button>
      </div>

      {/* 搜索列表 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: spacing.xl, color: colors.textTertiary }}>加载中...</div>
      ) : searches.length === 0 ? (
        <Empty
          image={<SearchOutlined style={{ fontSize: 48, color: colors.textTertiary }} />}
          description={<span style={{ color: colors.textTertiary }}>暂无保存的搜索，点击"新建搜索"添加</span>}
          style={{ marginTop: spacing.xl * 2 }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
          {searches.map(s => (
            <div
              key={s.id}
              style={{
                background: colors.bgBase,
                borderRadius: radius.md,
                border: `1px solid ${colors.borderCard}`,
                boxShadow: shadows.subtle,
                padding: `${spacing.md}px ${spacing.lg}px`,
                display: 'flex',
                alignItems: 'center',
                gap: spacing.md,
              }}
            >
              {/* 图标 */}
              <SearchOutlined style={{ fontSize: 18, color: colors.primary, flexShrink: 0 }} />

              {/* 内容 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: fontSize.base, color: colors.textPrimary, marginBottom: 2 }}>
                  {s.name}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
                  <code style={{
                    fontSize: fontSize.sm,
                    color: colors.textSecondary,
                    background: colors.bgLight,
                    padding: '2px 6px',
                    borderRadius: 4,
                    maxWidth: 400,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'inline-block',
                  }}>
                    {s.query}
                  </code>
                  <Tag style={{ fontSize: fontSize.xs, margin: 0 }}>{getSiteName(s.siteId)}</Tag>
                </div>
              </div>

              {/* 操作按钮 */}
              <div style={{ display: 'flex', gap: spacing.sm, flexShrink: 0 }}>
                <Tooltip title="执行搜索">
                  <Button
                    type="primary"
                    size="small"
                    icon={<PlayCircleOutlined />}
                    onClick={() => handleRun(s)}
                  >
                    搜索
                  </Button>
                </Tooltip>
                <Tooltip title="编辑">
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => handleEdit(s)}
                  />
                </Tooltip>
                <Popconfirm
                  title="确认删除这条保存的搜索？"
                  onConfirm={() => handleDelete(s.id)}
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                >
                  <Button size="small" icon={<DeleteOutlined />} danger />
                </Popconfirm>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 新建/编辑弹窗 */}
      <Modal
        title={editingSearch ? '编辑搜索' : '新建搜索'}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={handleSave}
        okText={editingSearch ? '保存' : '创建'}
        cancelText="取消"
        confirmLoading={saving}
        destroyOnClose
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, padding: `${spacing.md}px 0` }}>
          <div>
            <Text type="secondary" style={{ fontSize: fontSize.sm, marginBottom: 4, display: 'block' }}>名称</Text>
            <Input
              value={formName}
              onChange={e => setFormName(e.target.value)}
              placeholder="如：蓝色系角色"
              autoFocus
            />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: fontSize.sm, marginBottom: 4, display: 'block' }}>搜索词（标签）</Text>
            <Input
              value={formQuery}
              onChange={e => setFormQuery(e.target.value)}
              placeholder="如：blue_eyes rating:s score:>50"
            />
          </div>
          {!editingSearch && (
            <div>
              <Text type="secondary" style={{ fontSize: fontSize.sm, marginBottom: 4, display: 'block' }}>站点</Text>
              <Select
                value={formSiteId}
                onChange={setFormSiteId}
                style={{ width: '100%' }}
                placeholder="全部站点"
              >
                <Option value={null}>全部站点</Option>
                {sites.map(s => <Option key={s.id} value={s.id}>{s.name}</Option>)}
              </Select>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
