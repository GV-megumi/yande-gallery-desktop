import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Modal,
  Descriptions,
  Space,
  Button,
  Tag,
  Tooltip,
  Popconfirm,
  Switch,
  Input,
  message,
} from 'antd';
import {
  SyncOutlined,
  EditOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { colors } from '../styles/tokens';
import { useLocale } from '../locales';

/**
 * Phase 7B — 图集多文件夹管理对话框（取代旧的只读「图集信息」Modal + Popover）。
 *
 * 把原先只读的图集信息升级为可操作的多文件夹管理器：
 *   - 内联改名（gallery.updateGallery({name})）
 *   - 自动扫描开关（gallery.updateGallery({autoScan})，列名「自动扫描」，DB 列为 autoScan）
 *   - 立即扫描（gallery.syncGalleryFolder）
 *   - 文件夹列表：每个绑定文件夹一行，展示路径/递归/格式 + 「文件夹丢失」标记，
 *     行内可「更改路径」「解绑」；底部「+ 添加文件夹」
 *   - 只读元信息：图片数量 / 最后扫描 / 创建时间 / 更新时间 / 来源收藏标签
 *
 * 本对话框是页面级 controller，直接调用 window.electronAPI（与原 GalleryPage 的图集信息
 * 弹窗一致）；它自行拉取绑定文件夹、缺失集合与来源收藏标签，不依赖父级注入数据。
 */

interface GalleryInfo {
  id: number;
  name: string;
  imageCount: number;
  lastScannedAt?: string;
  createdAt: string;
  updatedAt: string;
  autoScan: boolean;
  coverImageId?: number;
}

interface GalleryFolderRow {
  folderPath: string;
  recursive: boolean;
  extensions: string[];
}

interface GalleryFolderManagerDialogProps {
  gallery: GalleryInfo;
  open: boolean;
  onClose: () => void;
  /** 任何会改变图集/文件夹状态的操作成功后回调，供父级刷新列表/详情 */
  onChanged?: () => void;
}

export const GalleryFolderManagerDialog: React.FC<GalleryFolderManagerDialogProps> = ({
  gallery,
  open,
  onClose,
  onChanged,
}) => {
  const { t } = useLocale();
  const [folders, setFolders] = useState<GalleryFolderRow[]>([]);
  const [missingPaths, setMissingPaths] = useState<Set<string>>(new Set());
  const [sourceFavoriteTags, setSourceFavoriteTags] = useState<any[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [watching, setWatching] = useState<boolean>(gallery.autoScan);
  const [watchingSaving, setWatchingSaving] = useState(false);
  // 内联改名
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(gallery.name);
  const [renameSaving, setRenameSaving] = useState(false);
  // 行内操作 loading（按 folderPath 标记）
  const [rowBusyPath, setRowBusyPath] = useState<string | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);

  // 防止已关闭后的异步回包写状态
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 拉取该图集的绑定文件夹列表 + 缺失文件夹集合
  const loadFolders = useCallback(async () => {
    if (!window.electronAPI?.gallery) return;
    setFoldersLoading(true);
    try {
      const result = await window.electronAPI.gallery.getGalleryFolders(gallery.id);
      if (!mountedRef.current) return;
      if (result.success && result.data) {
        setFolders(result.data);
      } else {
        setFolders([]);
      }

      // getMissingGalleryFolders 直接返回裸数组（非 {success} 包裹），可能 throw → 包 try/catch
      try {
        const missing = await window.electronAPI.gallery.getMissingGalleryFolders();
        if (!mountedRef.current) return;
        const set = new Set<string>(
          (Array.isArray(missing) ? missing : [])
            .filter((m) => m.galleryId === gallery.id)
            .map((m) => m.folderPath)
        );
        setMissingPaths(set);
      } catch (err) {
        console.warn('[GalleryFolderManagerDialog] 读取缺失文件夹失败:', err);
        if (mountedRef.current) setMissingPaths(new Set());
      }
    } catch (error) {
      console.error('[GalleryFolderManagerDialog] 读取绑定文件夹失败:', error);
      if (mountedRef.current) setFolders([]);
    } finally {
      if (mountedRef.current) setFoldersLoading(false);
    }
  }, [gallery.id]);

  // 拉取来源收藏标签（与旧「图集信息」弹窗一致）
  const loadSourceFavoriteTags = useCallback(async () => {
    if (!window.electronAPI?.booru) return;
    try {
      const result = await window.electronAPI.booru.getGallerySourceFavoriteTags(gallery.id);
      if (!mountedRef.current) return;
      if (result.success && result.data) {
        setSourceFavoriteTags(result.data);
      } else {
        setSourceFavoriteTags([]);
      }
    } catch (error) {
      console.error('[GalleryFolderManagerDialog] 读取来源收藏标签失败:', error);
      if (mountedRef.current) setSourceFavoriteTags([]);
    }
  }, [gallery.id]);

  // 打开时（或切换图集时）拉取数据并同步本地受控态
  useEffect(() => {
    if (!open) return;
    setWatching(gallery.autoScan);
    setRenameValue(gallery.name);
    setRenaming(false);
    void loadFolders();
    void loadSourceFavoriteTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, gallery.id]);

  // 自动扫描开关：写 gallery.autoScan（UI 标签为「自动扫描」）
  const handleToggleWatching = async (checked: boolean) => {
    setWatchingSaving(true);
    setWatching(checked); // 乐观更新
    try {
      const result = await window.electronAPI.gallery.updateGallery(gallery.id, { autoScan: checked });
      if (result.success) {
        onChanged?.();
      } else {
        setWatching(!checked); // 回滚
        message.error(result.error || '更新失败');
      }
    } catch (error) {
      console.error('[GalleryFolderManagerDialog] 更新自动扫描失败:', error);
      setWatching(!checked);
      message.error('更新失败');
    } finally {
      if (mountedRef.current) setWatchingSaving(false);
    }
  };

  // 立即扫描全部绑定文件夹
  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const result = await window.electronAPI.gallery.syncGalleryFolder(gallery.id);
      if (result.success && result.data) {
        message.success(`导入 ${result.data.imported}，跳过 ${result.data.skipped}`);
        await loadFolders();
        onChanged?.();
      } else {
        message.error(result.error || '扫描失败');
      }
    } catch (error) {
      console.error('[GalleryFolderManagerDialog] 立即扫描失败:', error);
      message.error('扫描失败');
    } finally {
      if (mountedRef.current) setSyncing(false);
    }
  };

  // 保存改名
  const handleSaveRename = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      message.error('图集名称不能为空');
      return;
    }
    setRenameSaving(true);
    try {
      const result = await window.electronAPI.gallery.updateGallery(gallery.id, { name: trimmed });
      if (result.success) {
        message.success('图集已更新');
        setRenaming(false);
        onChanged?.();
      } else {
        message.error(result.error || '更新失败');
      }
    } catch (error) {
      console.error('[GalleryFolderManagerDialog] 改名失败:', error);
      message.error('更新失败');
    } finally {
      if (mountedRef.current) setRenameSaving(false);
    }
  };

  // 在资源管理器中打开文件夹
  const handleShowItem = (folderPath: string) => {
    window.electronAPI?.system?.showItem(folderPath);
  };

  // 添加文件夹：选目录 → bindFolder → 刷新
  const handleAddFolder = async () => {
    setAddingFolder(true);
    try {
      const picked = await window.electronAPI.system.selectFolder();
      // selectFolder 返回 { success, data? }，非裸字符串
      if (!picked?.success || !picked.data) {
        return;
      }
      const result = await window.electronAPI.gallery.bindFolder(gallery.id, picked.data);
      if (result.success) {
        message.success('文件夹已添加');
        await loadFolders();
        onChanged?.();
      } else {
        message.error(result.error || '添加文件夹失败');
      }
    } catch (error) {
      console.error('[GalleryFolderManagerDialog] 添加文件夹失败:', error);
      message.error('添加文件夹失败');
    } finally {
      if (mountedRef.current) setAddingFolder(false);
    }
  };

  // 更改路径确认通过后的实际执行：changeFolderPath(old,new) → 刷新
  const doChangeFolderPath = async (oldPath: string, newPath: string) => {
    setRowBusyPath(oldPath);
    try {
      const result = await window.electronAPI.gallery.changeFolderPath(gallery.id, oldPath, newPath);
      if (result.success) {
        message.success('文件夹路径已更新');
        await loadFolders();
        onChanged?.();
      } else {
        message.error(result.error || '更改路径失败');
      }
    } catch (error) {
      console.error('[GalleryFolderManagerDialog] 更改路径失败:', error);
      message.error('更改路径失败');
    } finally {
      if (mountedRef.current) setRowBusyPath(null);
    }
  };

  // 更改路径：选新目录 → 二次确认 → doChangeFolderPath(old,new)。
  // 更改路径 = 解绑旧文件夹（孤儿回收：删图片记录/本地标签/封面 + 复位 booru 下载状态）+ 绑定新文件夹重扫，
  // 破坏面与「解绑」等价，必须像解绑（Popconfirm）/删除图集（Modal.confirm）一样二次确认；
  // 用 Modal.confirm 而非 Popconfirm 是为了完整展示旧→新路径与「重定位根目录」无损替代方案指引。
  const handleChangePath = async (oldPath: string) => {
    setRowBusyPath(oldPath);
    try {
      const picked = await window.electronAPI.system.selectFolder();
      if (!picked?.success || !picked.data) {
        return;
      }
      const newPath = picked.data;
      Modal.confirm({
        title: t('gallery.changePathConfirmTitle'),
        content: (
          <div>
            <div style={{ wordBreak: 'break-all', marginBottom: 8 }}>
              <div>{oldPath}</div>
              <div>→ {newPath}</div>
            </div>
            <div>{t('gallery.changePathConfirmWarning')}</div>
            <div style={{ marginTop: 8, color: colors.textTertiary }}>
              {t('gallery.changePathConfirmRelocateHint')}
            </div>
          </div>
        ),
        okText: t('gallery.changePathConfirmOk'),
        okType: 'danger',
        cancelText: t('common.cancel'),
        closable: false,
        width: 480,
        // onOk 返回 Promise：确认按钮转 loading，执行完毕后自动关闭
        onOk: () => doChangeFolderPath(oldPath, newPath),
      });
    } catch (error) {
      console.error('[GalleryFolderManagerDialog] 更改路径失败:', error);
      message.error('更改路径失败');
    } finally {
      // 目录选择结束即恢复行内按钮；确认执行期间的 loading 由 doChangeFolderPath 重新标记
      if (mountedRef.current) setRowBusyPath(null);
    }
  };

  // 解绑：unbindFolder → 刷新
  const handleUnbind = async (folderPath: string) => {
    setRowBusyPath(folderPath);
    try {
      const result = await window.electronAPI.gallery.unbindFolder(gallery.id, folderPath);
      if (result.success) {
        message.success('文件夹已解绑');
        await loadFolders();
        onChanged?.();
      } else {
        message.error(result.error || '解绑失败');
      }
    } catch (error) {
      console.error('[GalleryFolderManagerDialog] 解绑失败:', error);
      message.error('解绑失败');
    } finally {
      if (mountedRef.current) setRowBusyPath(null);
    }
  };

  return (
    <Modal
      open={open}
      title="图集信息"
      closable
      maskClosable
      keyboard
      onCancel={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
      width={640}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {/* 图集名称 + 内联改名 + 自动扫描 + 立即扫描 */}
        <Space style={{ width: '100%', justifyContent: 'space-between' }} align="center">
          <Space align="center">
            {renaming ? (
              <Space.Compact>
                <Input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onPressEnter={handleSaveRename}
                  style={{ width: 200 }}
                  autoFocus
                />
                <Button type="primary" loading={renameSaving} onClick={handleSaveRename}>
                  保存
                </Button>
              </Space.Compact>
            ) : (
              <>
                <span style={{ fontWeight: 600, fontSize: 16 }}>{gallery.name}</span>
                <Tooltip title="重命名图集">
                  <Button
                    type="text"
                    size="small"
                    aria-label="改名"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setRenameValue(gallery.name);
                      setRenaming(true);
                    }}
                  />
                </Tooltip>
              </>
            )}
          </Space>
          <Space align="center">
            <Tooltip title="开启后，进入该图集时自动扫描其文件夹一次，补入新图">
              <Space size={4} align="center">
                <span style={{ fontSize: 13, color: colors.textTertiary }}>自动扫描</span>
                <Switch
                  size="small"
                  checked={watching}
                  loading={watchingSaving}
                  onChange={handleToggleWatching}
                />
              </Space>
            </Tooltip>
            <Tooltip title="立即扫描全部绑定文件夹">
              <Button
                type="text"
                aria-label="立即扫描"
                icon={<SyncOutlined />}
                loading={syncing}
                onClick={handleSyncNow}
              />
            </Tooltip>
          </Space>
        </Space>

        {/* 文件夹列表 */}
        <div>
          <div style={{ fontSize: 13, color: colors.textTertiary, marginBottom: 8 }}>
            绑定文件夹
          </div>
          {folders.length === 0 ? (
            <div style={{ color: colors.textTertiary, padding: '8px 0' }}>
              {foldersLoading ? '加载中…' : '暂无绑定文件夹'}
            </div>
          ) : (
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              {folders.map((folder) => {
                const isMissing = missingPaths.has(folder.folderPath);
                const rowBusy = rowBusyPath === folder.folderPath;
                return (
                  <div
                    key={folder.folderPath}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '6px 8px',
                      border: `1px solid ${colors.separator}`,
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Tooltip title="在资源管理器中打开">
                          <span
                            role="button"
                            tabIndex={0}
                            style={{
                              color: colors.primary,
                              cursor: 'pointer',
                              textDecoration: 'underline',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            onClick={() => handleShowItem(folder.folderPath)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleShowItem(folder.folderPath);
                              }
                            }}
                          >
                            {folder.folderPath}
                          </span>
                        </Tooltip>
                        {isMissing && <Tag color="error">文件夹丢失</Tag>}
                      </div>
                      <div style={{ fontSize: 12, color: colors.textTertiary, marginTop: 2 }}>
                        递归扫描：{folder.recursive ? '是' : '否'}
                        {folder.extensions.length > 0 && (
                          <span style={{ marginLeft: 12 }}>
                            支持格式：{folder.extensions.join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                    <Space size={4}>
                      <Tooltip title="更改路径">
                        <Button
                          type="text"
                          size="small"
                          aria-label="更改路径"
                          icon={<FolderOpenOutlined />}
                          loading={rowBusy}
                          onClick={() => handleChangePath(folder.folderPath)}
                        />
                      </Tooltip>
                      <Tooltip title="解绑">
                        <Popconfirm
                          title="解绑文件夹"
                          description="解绑后将从库中移除该文件夹的图片信息（磁盘原文件保留），是否继续？"
                          okText="继续"
                          cancelText="取消"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => handleUnbind(folder.folderPath)}
                        >
                          <Button
                            type="text"
                            size="small"
                            danger
                            aria-label="解绑"
                            icon={<DeleteOutlined />}
                            loading={rowBusy}
                          />
                        </Popconfirm>
                      </Tooltip>
                    </Space>
                  </div>
                );
              })}
            </Space>
          )}
          <Button
            type="dashed"
            size="small"
            icon={<PlusOutlined />}
            loading={addingFolder}
            onClick={handleAddFolder}
            style={{ marginTop: 8 }}
          >
            添加文件夹
          </Button>
        </div>

        {/* 只读元信息 */}
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="图片数量">{gallery.imageCount}</Descriptions.Item>
          {gallery.lastScannedAt && (
            <Descriptions.Item label="最后扫描">
              {new Date(gallery.lastScannedAt).toLocaleString()}
            </Descriptions.Item>
          )}
          <Descriptions.Item label="创建时间">
            {new Date(gallery.createdAt).toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="更新时间">
            {new Date(gallery.updatedAt).toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="来源收藏标签">
            {sourceFavoriteTags.length > 0
              ? sourceFavoriteTags.map((tag: any) => (
                  <Tooltip
                    key={tag.id}
                    title={
                      <div>
                        <div>状态: {tag.downloadBinding?.lastStatus || '未配置'}</div>
                        {tag.downloadBinding?.lastCompletedAt && (
                          <div>
                            上次下载: {new Date(tag.downloadBinding.lastCompletedAt).toLocaleString()}
                          </div>
                        )}
                      </div>
                    }
                  >
                    <Tag
                      color={
                        tag.downloadBinding?.lastStatus === 'completed'
                          ? 'success'
                          : tag.downloadBinding?.lastStatus === 'failed'
                          ? 'error'
                          : 'blue'
                      }
                    >
                      {tag.tagName}
                    </Tag>
                  </Tooltip>
                ))
              : '-'}
          </Descriptions.Item>
        </Descriptions>
      </Space>
    </Modal>
  );
};
