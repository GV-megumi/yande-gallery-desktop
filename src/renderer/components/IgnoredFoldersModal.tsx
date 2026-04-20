import React, { useEffect, useState } from 'react';
import { Modal, List, Button, Input, Space, Popconfirm, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useLocale } from '../locales';

/**
 * IgnoredFoldersModal
 *
 * bug12 配套 UI：展示和管理 gallery_ignored_folders 表。
 * 用户可以：
 *   - 选择一个本地文件夹并把它加入忽略名单（防止被扫描成图集）；
 *   - 编辑某条记录的备注；
 *   - 从忽略名单中移除某条记录（下次扫描可能会重新创建图集）。
 *
 * 数据来源：window.electronAPI.gallery.{listIgnoredFolders, addIgnoredFolder,
 *   updateIgnoredFolder, removeIgnoredFolder}。本组件只做 UI 与状态管理，
 *   归一化和持久化全部在主进程 galleryService 里完成。
 */

interface IgnoredFolder {
  id: number;
  folderPath: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export const IgnoredFoldersModal: React.FC<Props> = ({ open, onClose }) => {
  const { t } = useLocale();
  const [rows, setRows] = useState<IgnoredFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingNote, setEditingNote] = useState('');

  /**
   * bug12 I2：preload 尚未就绪时不再静默 early-return，而是给用户反馈。
   * 正常流程下 preload 先于 React 渲染完成，这里命中通常说明 API 漂移
   * 或用户在应用初始化极早阶段操作过。统一用 console.warn + message.error。
   */
  const ensureApiReady = (needSystem: boolean): boolean => {
    if (!window.electronAPI?.gallery || (needSystem && !window.electronAPI?.system)) {
      console.warn('[IgnoredFoldersModal] electronAPI 未就绪', {
        gallery: Boolean(window.electronAPI?.gallery),
        system: Boolean(window.electronAPI?.system),
      });
      message.error(t('settings.ignoredFolderApiNotReady'));
      return false;
    }
    return true;
  };

  const load = async () => {
    if (!ensureApiReady(false)) return;
    setLoading(true);
    try {
      const r = await window.electronAPI.gallery.listIgnoredFolders();
      if (r?.success && r.data) setRows(r.data);
      else if (r && !r.success) {
        message.error(r.error || t('settings.ignoredFolderLoadFailed'));
      }
    } catch (err) {
      console.error('[IgnoredFoldersModal] 加载忽略名单失败:', err);
      message.error(t('settings.ignoredFolderLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  const handleAdd = async () => {
    if (!ensureApiReady(true)) return;
    const picked = await window.electronAPI.system.selectFolder();
    if (!picked?.success || !picked.data) return;
    const r = await window.electronAPI.gallery.addIgnoredFolder(picked.data);
    if (r?.success) {
      message.success(t('settings.ignoredFolderAddSuccess'));
      load();
    } else {
      message.error(r?.error || t('settings.ignoredFolderAddFailed'));
    }
  };

  const handleStartEdit = (item: IgnoredFolder) => {
    setEditingId(item.id);
    setEditingNote(item.note ?? '');
  };

  const handleSaveEdit = async (id: number) => {
    if (!ensureApiReady(false)) return;
    const r = await window.electronAPI.gallery.updateIgnoredFolder(id, { note: editingNote });
    if (r?.success) {
      setEditingId(null);
      load();
    } else {
      message.error(r?.error || t('settings.ignoredFolderSaveFailed'));
    }
  };

  const handleRemove = async (id: number) => {
    if (!ensureApiReady(false)) return;
    const r = await window.electronAPI.gallery.removeIgnoredFolder(id);
    if (r?.success) {
      load();
    } else {
      message.error(r?.error || t('settings.ignoredFolderRemoveFailed'));
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      title={t('settings.ignoredFoldersModalTitle')}
      width={680}
    >
      <div style={{ marginBottom: 12 }}>
        <Button icon={<PlusOutlined />} onClick={handleAdd}>
          {t('settings.ignoredFolderAdd')}
        </Button>
      </div>
      <List
        loading={loading}
        dataSource={rows}
        locale={{ emptyText: t('settings.ignoredFoldersEmpty') }}
        renderItem={item => (
          <List.Item
            actions={[
              editingId === item.id ? (
                <Space key="edit-actions">
                  <Button type="link" onClick={() => handleSaveEdit(item.id)}>
                    {t('settings.ignoredFolderSave')}
                  </Button>
                  <Button type="link" onClick={() => setEditingId(null)}>
                    {t('settings.ignoredFolderCancel')}
                  </Button>
                </Space>
              ) : (
                <Button
                  key="edit"
                  type="link"
                  icon={<EditOutlined />}
                  onClick={() => handleStartEdit(item)}
                >
                  {t('settings.ignoredFolderEdit')}
                </Button>
              ),
              <Popconfirm
                key="remove"
                title={t('settings.ignoredFolderRemoveConfirm')}
                onConfirm={() => handleRemove(item.id)}
              >
                <Button type="link" danger icon={<DeleteOutlined />}>
                  {t('settings.ignoredFolderDelete')}
                </Button>
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              title={item.folderPath}
              description={
                editingId === item.id ? (
                  <Input
                    value={editingNote}
                    onChange={e => setEditingNote(e.target.value)}
                    placeholder={t('settings.ignoredFolderNotePlaceholder')}
                  />
                ) : (
                  item.note || t('settings.ignoredFolderNoNote')
                )
              }
            />
          </List.Item>
        )}
      />
    </Modal>
  );
};
