import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Table, Button, Input, Space, Tag, message, Popconfirm, Modal, Form, Select, Empty, Tooltip, Alert, Progress, Switch, InputNumber, List } from 'antd';
import type { TableColumnsType } from 'antd';
import { StarFilled, DeleteOutlined, PlusOutlined, EditOutlined, SearchOutlined, ExportOutlined, ImportOutlined, HolderOutlined, InboxOutlined, DownloadOutlined, SettingOutlined, DisconnectOutlined, FolderOpenOutlined, HistoryOutlined, RedoOutlined, ToolOutlined, SortAscendingOutlined, SortDescendingOutlined } from '@ant-design/icons';
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
import type { FavoriteTag, FavoriteTagDownloadDisplayStatus, FavoriteTagWithDownloadState } from '../../shared/types';
import { getDisplayStatus, getStatusColor as getStatusColorUtil, isRetryableStatus, isErrorStatus } from '../../shared/favoriteTagStatus';
import { useLocale } from '../locales';
import { BatchTagAddModal } from '../components/BatchTagAddModal';
import { ImportTagsDialog } from '../components/ImportTagsDialog';

interface FavoriteTagsPageProps {
  onTagClick?: (tag: string, siteId?: number | null) => void;
}

interface SiteOption {
  id: number;
  name: string;
}

interface GalleryOption {
  id: number;
  name: string;
  folderPath: string;
}

interface DownloadBindingFormValues {
  galleryId?: number | null;
  downloadPath: string;
  autoCreateGallery?: boolean;
  autoSyncGalleryAfterDownload?: boolean;
  quality?: string;
  perPage?: number;
  concurrency?: number;
  skipIfExists?: boolean;
  notifications?: boolean;
  blacklistedTags?: string;
}

interface FavoriteTagDownloadHistoryItem {
  sessionId: string;
  taskId: string;
  status: string;
  startedAt: string;
  completedAt?: string | null;
  error?: string | null;
}

const SortableRow: React.FC<any> = (props) => {
  const { setNodeRef, transform, transition, isDragging } = useSortable({
    id: props['data-row-key'],
  });

  const style: React.CSSProperties = {
    ...props.style,
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { position: 'relative', zIndex: 9999, background: '#fafafa', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' } : {}),
  };

  return <tr {...props} ref={setNodeRef} style={style} />;
};

const DragHandle: React.FC<{ id: number }> = ({ id }) => {
  const { attributes, listeners } = useSortable({ id });

  return (
    <span
      {...attributes}
      {...listeners}
      style={{ cursor: 'grab', color: '#999', display: 'inline-flex', alignItems: 'center' }}
    >
      <HolderOutlined />
    </span>
  );
};

export const FavoriteTagsPage: React.FC<FavoriteTagsPageProps> = ({ onTagClick }) => {
  const { t } = useLocale();
  const [favoriteTags, setFavoriteTags] = useState<FavoriteTagWithDownloadState[]>([]);
  const [loading, setLoading] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [editingTag, setEditingTag] = useState<FavoriteTag | null>(null);
  const [configuringTag, setConfiguringTag] = useState<FavoriteTagWithDownloadState | null>(null);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [galleries, setGalleries] = useState<GalleryOption[]>([]);
  const [filterSiteId, setFilterSiteId] = useState<number | undefined>(undefined);
  const [savingDownloadConfig, setSavingDownloadConfig] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyTag, setHistoryTag] = useState<FavoriteTagWithDownloadState | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [downloadHistory, setDownloadHistory] = useState<FavoriteTagDownloadHistoryItem[]>([]);
  const [form] = Form.useForm();
  const [downloadForm] = Form.useForm<DownloadBindingFormValues>();

  const [isDragging, setIsDragging] = useState(false);
  const [batchAddModalOpen, setBatchAddModalOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  // labelGroups 在 pickFile 阶段从文件里解析得到，commit 阶段合并回 payload，
  // 通用 ImportTagsDialog 不感知该字段，由本页缓存透传即可。
  const [pendingLabelGroups, setPendingLabelGroups] = useState<import('../../shared/types').FavoriteTagLabelImportRecord[] | undefined>(undefined);

  const [sortKey, setSortKey] = useState<'tagName' | 'galleryName' | 'lastDownloadedAt'>('tagName');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  // 是否处于非默认排序模式（非按标签名升序）
  const isCustomSortActive = sortKey !== 'tagName' || sortOrder !== 'asc';

  const sortedTags = useMemo(() => {
    const list = [...favoriteTags];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'tagName':
          cmp = a.tagName.localeCompare(b.tagName);
          break;
        case 'galleryName': {
          const aName = a.galleryName || '';
          const bName = b.galleryName || '';
          if (!aName && bName) return 1;
          if (aName && !bName) return -1;
          cmp = aName.localeCompare(bName);
          if (cmp === 0) cmp = a.tagName.localeCompare(b.tagName);
          break;
        }
        case 'lastDownloadedAt': {
          const aTime = a.downloadBinding?.lastCompletedAt || a.downloadBinding?.lastStartedAt || '';
          const bTime = b.downloadBinding?.lastCompletedAt || b.downloadBinding?.lastStartedAt || '';
          if (!aTime && bTime) return 1;
          if (aTime && !bTime) return -1;
          cmp = aTime.localeCompare(bTime);
          if (cmp === 0) cmp = a.tagName.localeCompare(b.tagName);
          break;
        }
      }
      return sortOrder === 'desc' ? -cmp : cmp;
    });
    return list;
  }, [favoriteTags, sortKey, sortOrder]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeyword(keyword), 300);
    return () => clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    setPage(1);
  }, [debouncedKeyword]);

  const loadFavoriteTags = useCallback(async () => {
    setLoading(true);
    try {
      const offset = (page - 1) * pageSize;
      const result = await window.electronAPI.booru.getFavoriteTagsWithDownloadState({
        siteId: filterSiteId,
        keyword: debouncedKeyword.trim() || undefined,
        offset,
        limit: pageSize,
      });
      if (result.success && result.data) {
        setFavoriteTags(result.data.items);
        setTotal(result.data.total);
        console.log('[FavoriteTagsPage] 加载收藏标签:', result.data.items.length, '/', result.data.total);
      } else {
        message.error(`${t('common.failed')}: ${result.error}`);
      }
    } catch (error) {
      console.error('[FavoriteTagsPage] 加载收藏标签失败:', error);
      message.error(t('common.failed'));
    } finally {
      setLoading(false);
    }
  }, [filterSiteId, debouncedKeyword, page, pageSize, t]);

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

  const loadGalleries = useCallback(async () => {
    try {
      const result = await window.electronAPI.gallery.getGalleries();
      if (result.success && result.data) {
        setGalleries(result.data.map((gallery: any) => ({
          id: gallery.id,
          name: gallery.name,
          folderPath: gallery.folderPath,
        })));
      }
    } catch (error) {
      console.error('[FavoriteTagsPage] 加载图集列表失败:', error);
    }
  }, []);

  useEffect(() => { loadSites(); }, [loadSites]);
  useEffect(() => { loadGalleries(); }, [loadGalleries]);
  useEffect(() => { loadFavoriteTags(); }, [loadFavoriteTags]);

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      refreshTimer = setTimeout(() => {
        loadFavoriteTags();
      }, 250);
    };

    const removeProgressListener = window.electronAPI?.system?.onBulkDownloadRecordProgress?.((data: {
      sessionId: string;
      progress: number;
    }) => {
      setFavoriteTags(prev => prev.map(tag => {
        const sessionId = tag.downloadBinding?.lastSessionId;
        if (!sessionId || sessionId !== data.sessionId || !tag.runtimeProgress) {
          return tag;
        }

        return {
          ...tag,
          runtimeProgress: {
            ...tag.runtimeProgress,
            status: 'running',
          },
        };
      }));

      scheduleRefresh();
    });

    const removeStatusListener = window.electronAPI?.system?.onBulkDownloadRecordStatus?.((data: {
      sessionId: string;
      status: string;
    }) => {
      let needsRefresh = false;

      setFavoriteTags(prev => prev.map(tag => {
        const sessionId = tag.downloadBinding?.lastSessionId;
        if (!sessionId || sessionId !== data.sessionId) {
          return tag;
        }

        needsRefresh = true;
        return tag;
      }));

      if (needsRefresh) {
        scheduleRefresh();
      }
    });

    return () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      removeProgressListener?.();
      removeStatusListener?.();
    };
  }, [loadFavoriteTags]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    // DnD reordering is only meaningful when no keyword filter is active.
    // With a filter the visible rows are cherry-picked from the sort-order axis,
    // so writing sortOrder based on their visible position would corrupt the
    // positions of the unshown rows sitting between them.
    if (debouncedKeyword.trim()) {
      message.warning('搜索过滤时不能拖动排序');
      return;
    }

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = favoriteTags.findIndex(tag => tag.id === active.id);
    const newIndex = favoriteTags.findIndex(tag => tag.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const newTags = arrayMove(favoriteTags, oldIndex, newIndex);
    setFavoriteTags(newTags);

    try {
      // Use an absolute offset so that page-N rows don't collide with page-1's
      // sortOrder range (1..pageSize) after server-side pagination was introduced.
      const baseOffset = (page - 1) * pageSize;
      const updates = newTags.map((tag, index) => ({
        id: tag.id,
        sortOrder: baseOffset + index + 1,
      }));
      await Promise.all(updates.map(u => window.electronAPI.booru.updateFavoriteTag(u.id, { sortOrder: u.sortOrder })));
    } catch (error) {
      console.error('[FavoriteTagsPage] 排序保存失败:', error);
      message.error(t('common.failed'));
      loadFavoriteTags();
    }
  }, [favoriteTags, loadFavoriteTags, t, page, pageSize, debouncedKeyword]);

  const handleAdd = async (values: any) => {
    try {
      const { tagName, siteId, notes, labels } = values;
      const result = await window.electronAPI.booru.addFavoriteTag(
        siteId ?? null,
        tagName.trim(),
        {
          notes: notes || undefined,
          labels: labels ? labels.split(',').map((l: string) => l.trim()).filter(Boolean) : undefined,
        }
      );
      if (result.success) {
        message.success(t('favoriteTags.favorited', { name: tagName }));
        setAddModalVisible(false);
        form.resetFields();
        loadFavoriteTags();
      } else {
        message.error(`${t('common.failed')}: ${result.error}`);
      }
    } catch (error) {
      console.error('[FavoriteTagsPage] 添加收藏标签失败:', error);
      message.error(t('common.failed'));
    }
  };

  const handleEdit = async (values: any) => {
    if (!editingTag) return;
    try {
      const updates: any = {
        notes: values.notes || undefined,
        labels: values.labels
          ? values.labels.split(',').map((l: string) => l.trim()).filter(Boolean)
          : undefined,
      };
      // Only pass siteId when the current tag is global and user picked a specific site
      if (editingTag.siteId == null && values.siteId != null) {
        updates.siteId = values.siteId;
      }
      const result = await window.electronAPI.booru.updateFavoriteTag(editingTag.id, updates);
      if (result.success) {
        message.success(t('favoriteTags.updateSuccess'));
        setEditingTag(null);
        form.resetFields();
        loadFavoriteTags();
      } else {
        message.error(`${t('common.failed')}: ${result.error}`);
      }
    } catch (error) {
      console.error('[FavoriteTagsPage] 编辑收藏标签失败:', error);
      message.error(t('common.failed'));
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const result = await window.electronAPI.booru.removeFavoriteTag(id);
      if (result.success) {
        message.success(t('favoriteTags.unfavorited'));
        loadFavoriteTags();
      } else {
        message.error(`${t('common.failed')}: ${result.error}`);
      }
    } catch (error) {
      console.error('[FavoriteTagsPage] 删除收藏标签失败:', error);
      message.error(t('common.failed'));
    }
  };

  const handleTagClick = (tag: FavoriteTag) => {
    if (onTagClick) {
      onTagClick(tag.tagName, tag.siteId);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    // Open the new dialog; user must explicitly pick site + file
    setImportDialogOpen(true);
  }, []);

  const getSiteName = (siteId: number | null) => {
    if (siteId === null) return t('favoriteTags.global');
    const site = sites.find(s => s.id === siteId);
    return site ? site.name : `#${siteId}`;
  };

  const getStatusKey = (record: FavoriteTagWithDownloadState): FavoriteTagDownloadDisplayStatus => {
    return getDisplayStatus(record);
  };

  const getStatusColor = (record: FavoriteTagWithDownloadState) => {
    return getStatusColorUtil(getDisplayStatus(record));
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) {
      return t('favoriteTags.noLastDownload');
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  };

  const getDownloadDisabledReason = (record: FavoriteTagWithDownloadState) => {
    if (record.siteId == null) {
      return t('favoriteTags.siteRequiredForDownload');
    }
    return null;
  };

  const openDownloadConfig = (record: FavoriteTagWithDownloadState) => {
    setConfiguringTag(record);
    downloadForm.setFieldsValue({
      galleryId: record.downloadBinding?.galleryId ?? undefined,
      downloadPath: record.resolvedDownloadPath || record.downloadBinding?.downloadPath || '',
      autoCreateGallery: record.downloadBinding?.autoCreateGallery ?? false,
      autoSyncGalleryAfterDownload: record.downloadBinding?.autoSyncGalleryAfterDownload ?? false,
      quality: record.downloadBinding?.quality || 'original',
      perPage: record.downloadBinding?.perPage ?? 200,
      concurrency: record.downloadBinding?.concurrency ?? 3,
      skipIfExists: record.downloadBinding?.skipIfExists ?? true,
      notifications: record.downloadBinding?.notifications ?? true,
      blacklistedTags: record.downloadBinding?.blacklistedTags?.join(' ') || '',
    });
  };

  const handleGalleryChange = (galleryId?: number) => {
    if (!galleryId) return;
    const gallery = galleries.find(item => item.id === galleryId);
    if (gallery) {
      downloadForm.setFieldsValue({ downloadPath: gallery.folderPath });
    }
  };

  const triggerDownload = async (favoriteTagId: number) => {
    try {
      const result = await window.electronAPI.booru.startFavoriteTagBulkDownload(favoriteTagId);
      if (result.success && result.data) {
        if (result.data.deduplicated) {
          message.info('任务已存在');
        } else {
          message.success('任务创建成功');
        }
        await loadFavoriteTags();
      } else {
        message.error(`${t('common.failed')}: ${result.error}`);
      }
    } catch (error) {
      console.error('[FavoriteTagsPage] 启动标签下载失败:', error);
      message.error(t('common.failed'));
    }
  };

  const openDownloadHistory = async (record: FavoriteTagWithDownloadState) => {
    setHistoryTag(record);
    setHistoryVisible(true);
    setHistoryLoading(true);
    try {
      const result = await window.electronAPI.booru.getFavoriteTagDownloadHistory(record.id);
      if (result.success && result.data) {
        setDownloadHistory(result.data);
      } else {
        setDownloadHistory([]);
        message.error(`${t('common.failed')}: ${result.error}`);
      }
    } catch (error) {
      console.error('[FavoriteTagsPage] 加载收藏标签下载历史失败:', error);
      setDownloadHistory([]);
      message.error(t('common.failed'));
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleRetrySession = async (sessionId: string) => {
    try {
      const result = await window.electronAPI.bulkDownload.retryAllFailed(sessionId);
      if (result.success) {
        message.success(t('favoriteTags.retryStarted'));
        await loadFavoriteTags();
        if (historyTag) {
          await openDownloadHistory(historyTag);
        }
      } else {
        message.error(`${t('common.failed')}: ${result.error}`);
      }
    } catch (error) {
      console.error('[FavoriteTagsPage] 重试失败会话失败:', error);
      message.error(t('common.failed'));
    }
  };

  const handleFixGalleryBinding = async (record: FavoriteTagWithDownloadState) => {
    if (!record.downloadBinding || !record.downloadBinding.galleryId) return;
    const gallery = galleries.find(g => g.id === record.downloadBinding!.galleryId);
    if (!gallery) {
      message.error(t('favoriteTags.galleryNotFoundForFix'));
      return;
    }
    try {
      const result = await window.electronAPI.booru.upsertFavoriteTagDownloadBinding({
        favoriteTagId: record.id,
        galleryId: gallery.id,
        downloadPath: gallery.folderPath,
        enabled: record.downloadBinding.enabled,
        autoCreateGallery: record.downloadBinding.autoCreateGallery,
        autoSyncGalleryAfterDownload: record.downloadBinding.autoSyncGalleryAfterDownload,
        quality: record.downloadBinding.quality ?? undefined,
        perPage: record.downloadBinding.perPage ?? undefined,
        concurrency: record.downloadBinding.concurrency ?? undefined,
        skipIfExists: record.downloadBinding.skipIfExists ?? undefined,
        notifications: record.downloadBinding.notifications ?? undefined,
        blacklistedTags: record.downloadBinding.blacklistedTags ?? undefined,
      });
      if (result.success) {
        message.success(t('favoriteTags.galleryBindingFixed'));
        await loadFavoriteTags();
      } else {
        message.error(`${t('common.failed')}: ${result.error}`);
      }
    } catch (error) {
      console.error('[FavoriteTagsPage] 修复图集绑定失败:', error);
      message.error(t('common.failed'));
    }
  };

  const saveDownloadBinding = async (record: FavoriteTagWithDownloadState, startAfterSave: boolean) => {
    try {
      const values = await downloadForm.validateFields();
      setSavingDownloadConfig(true);
      const result = await window.electronAPI.booru.upsertFavoriteTagDownloadBinding({
        favoriteTagId: record.id,
        galleryId: values.galleryId ?? null,
        downloadPath: values.downloadPath,
        autoCreateGallery: values.autoCreateGallery,
        autoSyncGalleryAfterDownload: values.autoSyncGalleryAfterDownload,
        quality: values.quality,
        perPage: values.perPage,
        concurrency: values.concurrency,
        skipIfExists: values.skipIfExists,
        notifications: values.notifications,
        blacklistedTags: values.blacklistedTags
          ? values.blacklistedTags.split(/\s+/).map(tag => tag.trim()).filter(Boolean)
          : [],
      });

      if (!result.success) {
        message.error(`${t('common.failed')}: ${result.error}`);
        return;
      }

      message.success(t('favoriteTags.saveConfigSuccess'));
      setConfiguringTag(null);
      downloadForm.resetFields();
      await loadFavoriteTags();

      if (startAfterSave) {
        await triggerDownload(record.id);
      }
    } catch (error) {
      console.error('[FavoriteTagsPage] 保存下载配置失败:', error);
      message.error(t('common.failed'));
    } finally {
      setSavingDownloadConfig(false);
    }
  };

  const handleDownloadClick = async (record: FavoriteTagWithDownloadState) => {
    if (record.siteId == null) {
      message.warning(t('favoriteTags.siteRequiredForDownload'));
      return;
    }
    if (!record.downloadBinding) {
      openDownloadConfig(record);
      return;
    }
    await triggerDownload(record.id);
  };

  const handleClearDownloadBinding = async (favoriteTagId: number) => {
    try {
      const result = await window.electronAPI.booru.removeFavoriteTagDownloadBinding(favoriteTagId);
      if (result.success) {
        message.success(t('favoriteTags.clearBindingSuccess'));
        await loadFavoriteTags();
      } else {
        message.error(`${t('common.failed')}: ${result.error}`);
      }
    } catch (error) {
      console.error('[FavoriteTagsPage] 删除下载配置失败:', error);
      message.error(t('common.failed'));
    }
  };

  const columns: TableColumnsType<FavoriteTagWithDownloadState> = [
    // 排序模式下隐藏拖拽手柄，避免与数据排序冲突
    ...(!isCustomSortActive ? [{
      title: '',
      dataIndex: 'sort',
      key: 'sort',
      width: 40,
      render: (_: unknown, record: FavoriteTagWithDownloadState) => <DragHandle id={record.id} />,
    }] as TableColumnsType<FavoriteTagWithDownloadState> : []),
    {
      title: t('favoriteTags.tagName'),
      dataIndex: 'tagName',
      key: 'tagName',
      render: (tagName: string, record: FavoriteTagWithDownloadState) => (
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
      width: 180,
      responsive: ['lg'],
      render: (labels?: string[]) => (
        labels && labels.length > 0
          ? labels.map(label => <Tag key={label} color="purple">{label}</Tag>)
          : <span style={{ color: '#ccc' }}>{t('common.none')}</span>
      ),
    },
    {
      title: t('favoriteTags.boundGallery'),
      key: 'boundGallery',
      width: 220,
      responsive: ['lg'],
      render: (_: unknown, record: FavoriteTagWithDownloadState) => (
        <Space direction="vertical" size={2}>
          <span>{record.galleryName || t('favoriteTags.noGalleryBound')}</span>
          {record.galleryBindingConsistent === false && (
            <Tag color="warning">{t('favoriteTags.galleryBindingMismatch')}</Tag>
          )}
        </Space>
      ),
    },
    {
      title: t('favoriteTags.downloadStatus'),
      key: 'downloadStatus',
      width: 140,
      render: (_: unknown, record: FavoriteTagWithDownloadState) => (
        <Tag color={getStatusColor(record)}>{t(`favoriteTags.${getStatusKey(record)}`)}</Tag>
      ),
    },
    {
      title: t('favoriteTags.downloadProgress'),
      key: 'downloadProgress',
      width: 180,
      responsive: ['md'],
      render: (_: unknown, record: FavoriteTagWithDownloadState) => (
        record.runtimeProgress
          ? (
            <div style={{ minWidth: 140 }}>
              <Progress percent={record.runtimeProgress.percent} size="small" />
              <div style={{ fontSize: 12, color: '#666' }}>
                {record.runtimeProgress.completed}/{record.runtimeProgress.total}
              </div>
            </div>
          )
          : <span style={{ color: '#999' }}>-</span>
      ),
    },
    {
      title: t('favoriteTags.lastDownloadTime'),
      key: 'lastDownloadTime',
      width: 180,
      responsive: ['xl'],
      render: (_: unknown, record: FavoriteTagWithDownloadState) => formatDateTime(record.downloadBinding?.lastCompletedAt || record.downloadBinding?.lastStartedAt),
    },
    {
      title: t('favoriteTags.notes'),
      dataIndex: 'notes',
      key: 'notes',
      width: 180,
      responsive: ['xl'],
      ellipsis: true,
      render: (notes?: string) => notes || <span style={{ color: '#ccc' }}>-</span>,
    },
    {
      title: t('favoriteTags.actions'),
      key: 'actions',
      width: 240,
      fixed: 'right' as const,
      render: (_: unknown, record: FavoriteTagWithDownloadState) => (
        <Space wrap size={[0, 4]} style={{ width: '100%', justifyContent: 'flex-start' }}>
          <Tooltip title={t('favoriteTags.searchTag')}>
            <Button type="link" size="small" icon={<SearchOutlined />} onClick={() => handleTagClick(record)} />
          </Tooltip>
          <Tooltip title={t('favoriteTags.download')}>
            <Tooltip title={getDownloadDisabledReason(record) || t('favoriteTags.download')}>
              <span>
                <Button
                  type="link"
                  size="small"
                  icon={<DownloadOutlined />}
                  disabled={record.siteId == null}
                  onClick={() => handleDownloadClick(record)}
                />
              </span>
            </Tooltip>
          </Tooltip>
          <Tooltip title={t('favoriteTags.configureDownload')}>
            <Button type="link" size="small" icon={<SettingOutlined />} danger={record.galleryBindingConsistent === false} onClick={() => openDownloadConfig(record)} />
          </Tooltip>
          <Popconfirm title={t('favoriteTags.clearBindingConfirm')} onConfirm={() => handleClearDownloadBinding(record.id)}>
            <Tooltip title={t('favoriteTags.clearDownloadBinding')}>
              <Button type="link" size="small" icon={<DisconnectOutlined />} disabled={!record.downloadBinding} />
            </Tooltip>
          </Popconfirm>
          <Tooltip title={t('favoriteTags.viewDownloadHistory')}>
            <Button type="link" size="small" icon={<HistoryOutlined />} onClick={() => openDownloadHistory(record)} />
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
                  labels: record.labels ? record.labels.join(', ') : '',
                  siteId: record.siteId,
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
    <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} style={{ position: 'relative' }}>
      {isDragging && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 999, background: 'rgba(24, 144, 255, 0.08)', border: '2px dashed #1890ff', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ textAlign: 'center' }}>
            <InboxOutlined style={{ fontSize: 48, color: '#1890ff' }} />
            <div style={{ fontSize: 16, color: '#1890ff', marginTop: 8 }}>{t('favoriteTags.dropFileHere')}</div>
          </div>
        </div>
      )}

      <Card size="small" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Space size={8} style={{ minWidth: 0 }}>
            <StarFilled style={{ color: '#faad14', fontSize: 18 }} />
            <span style={{ fontSize: 16, fontWeight: 500 }}>{t('favoriteTags.count', { count: total })}</span>
          </Space>
          <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
              <Select
                placeholder={t('favoriteTags.filterSite')}
                allowClear
                style={{ width: 140, minWidth: 100, flex: '0 0 auto' }}
                value={filterSiteId ?? '__all__'}
                onChange={(value: string | number) => {
                  setFilterSiteId(value === '__all__' ? undefined : value as number);
                  setPage(1);
                }}
              >
                <Select.Option value="__all__">{t('common.all')}</Select.Option>
                {sites.map(site => (
                  <Select.Option key={site.id} value={site.id}>{site.name}</Select.Option>
                ))}
              </Select>
              <Select
                value={sortKey}
                onChange={(val) => setSortKey(val)}
                options={[
                  { label: '按标签名', value: 'tagName' },
                  { label: '按图集名', value: 'galleryName' },
                  { label: '按下载时间', value: 'lastDownloadedAt' },
                ]}
                style={{ width: 130, flex: '0 0 auto' }}
              />
              <Tooltip title={sortOrder === 'asc' ? '升序' : '降序'}>
                <Button
                  icon={sortOrder === 'asc' ? <SortAscendingOutlined /> : <SortDescendingOutlined />}
                  onClick={() => setSortOrder(o => o === 'asc' ? 'desc' : 'asc')}
                />
              </Tooltip>
              <Input
                placeholder="搜索喜欢标签"
                allowClear
                prefix={<SearchOutlined />}
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  setPage(1);
                }}
                style={{ width: 240, flex: '0 0 auto' }}
              />
              <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setAddModalVisible(true); }}>
                {t('favoriteTags.add')}
              </Button>
              <Button
                icon={<PlusOutlined />}
                onClick={() => setBatchAddModalOpen(true)}
              >
                批量添加
              </Button>
              <Button
                icon={<ExportOutlined />}
                onClick={async () => {
                  try {
                    const result = await window.electronAPI.booru.exportFavoriteTags(filterSiteId ?? null);
                    if (result.success && result.data) {
                      message.success(t('favoriteTags.exportSuccess', { count: result.data.count }));
                    } else if (result.error !== '取消导出') {
                      message.error(`${t('favoriteTags.exportFailed')}: ${result.error}`);
                    }
                  } catch {
                    message.error(t('favoriteTags.exportFailed'));
                  }
                }}
              >
                {t('common.export')}
              </Button>
              <Button
                icon={<ImportOutlined />}
                onClick={() => setImportDialogOpen(true)}
              >
                {t('common.import')}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {favoriteTags.some(tag => tag.galleryBindingConsistent === false) && (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          message={t('favoriteTags.galleryBindingMismatchAlert')}
          description={
            <Space direction="vertical" size={4} style={{ marginTop: 8 }}>
              {favoriteTags
                .filter(tag => tag.galleryBindingConsistent === false)
                .map(tag => (
                  <Space key={tag.id} size={8}>
                    <Tag color="blue">{tag.tagName.replace(/_/g, ' ')}</Tag>
                    <Tag color="warning">{tag.galleryBindingMismatchReason === 'galleryNotFound' ? t('favoriteTags.galleryNotFound') : t('favoriteTags.pathMismatch')}</Tag>
                    {tag.galleryBindingMismatchReason === 'pathMismatch' && (
                      <Button size="small" type="link" icon={<ToolOutlined />} onClick={() => handleFixGalleryBinding(tag)}>
                        {t('favoriteTags.fixBinding')}
                      </Button>
                    )}
                    <Button size="small" type="link" icon={<SettingOutlined />} onClick={() => openDownloadConfig(tag)}>
                      {t('favoriteTags.configureDownload')}
                    </Button>
                  </Space>
                ))}
            </Space>
          }
        />
      )}

      <Card>
        {isCustomSortActive ? (
          <Table
            dataSource={sortedTags}
            columns={columns}
            rowKey="id"
            loading={loading}
            scroll={{ x: 1600 }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: ['20', '50', '100'],
              onChange: (p, ps) => { setPage(p); setPageSize(ps); },
            }}
            locale={{ emptyText: <Empty description={t('favoriteTags.noTags')} /> }}
          />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis]}>
            <SortableContext items={sortedTags.map(tag => tag.id)} strategy={verticalListSortingStrategy}>
              <Table
                dataSource={sortedTags}
                columns={columns}
                rowKey="id"
                loading={loading}
                scroll={{ x: 1600 }}
                pagination={{
                  current: page,
                  pageSize,
                  total,
                  showSizeChanger: true,
                  pageSizeOptions: ['20', '50', '100'],
                  onChange: (p, ps) => { setPage(p); setPageSize(ps); },
                }}
                locale={{ emptyText: <Empty description={t('favoriteTags.noTags')} /> }}
                components={{ body: { row: SortableRow } }}
              />
            </SortableContext>
          </DndContext>
        )}
      </Card>

      <Modal
        title={t('favoriteTags.addTitle')}
        open={addModalVisible}
        onCancel={() => { setAddModalVisible(false); form.resetFields(); }}
        onOk={() => form.submit()}
        okText={t('details.favorite')}
        cancelText={t('common.cancel')}
      >
        <Form form={form} layout="vertical" onFinish={handleAdd}>
          <Form.Item name="tagName" label={t('favoriteTags.tagName')} rules={[{ required: true, message: t('favoriteTags.tagNameRequired') }]}> 
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

      <Modal
        title={t('favoriteTags.configTitle', { name: configuringTag?.tagName || '' })}
        open={!!configuringTag}
        footer={null}
        onCancel={() => {
          setConfiguringTag(null);
          downloadForm.resetFields();
        }}
      >
        <Form form={downloadForm} layout="vertical" initialValues={{ quality: 'original', perPage: 200, concurrency: 3, skipIfExists: true, notifications: true }}>
          <Form.Item name="galleryId" label={t('favoriteTags.selectGallery')}>
            <Select allowClear placeholder={t('favoriteTags.selectGalleryPlaceholder')} onChange={handleGalleryChange}>
              {galleries.map(gallery => (
                <Select.Option key={gallery.id} value={gallery.id}>{gallery.name}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="downloadPath" label={t('favoriteTags.downloadPath')} rules={[{ required: true, message: t('favoriteTags.selectPathFirst') }]}> 
            <Input readOnly />
          </Form.Item>
          <Form.Item name="autoCreateGallery" label={t('favoriteTags.autoCreateGallery')} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="autoSyncGalleryAfterDownload" label={t('favoriteTags.autoSyncGalleryAfterDownload')} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="quality" label={t('favoriteTags.quality')}>
            <Select>
              <Select.Option value="original">original</Select.Option>
              <Select.Option value="sample">sample</Select.Option>
              <Select.Option value="preview">preview</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="perPage" label={t('favoriteTags.perPage')}>
            <InputNumber min={1} max={1000} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="concurrency" label={t('favoriteTags.concurrency')}>
            <InputNumber min={1} max={10} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="blacklistedTags" label={t('favoriteTags.blacklistedTags')}>
            <Input.TextArea rows={2} placeholder={t('favoriteTags.blacklistedTagsPlaceholder')} />
          </Form.Item>
          <Form.Item name="skipIfExists" label={t('favoriteTags.skipIfExists')} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="notifications" label={t('favoriteTags.notifications')} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => configuringTag && saveDownloadBinding(configuringTag, false)} loading={savingDownloadConfig}>{t('common.save')}</Button>
            <Button type="primary" onClick={() => configuringTag && saveDownloadBinding(configuringTag, true)} loading={savingDownloadConfig}>{t('favoriteTags.saveAndDownload')}</Button>
          </Space>
        </Form>
      </Modal>

      <Modal
        title={t('favoriteTags.historyTitle', { name: historyTag?.tagName || '' })}
        open={historyVisible}
        footer={null}
        width={640}
        onCancel={() => {
          setHistoryVisible(false);
          setHistoryTag(null);
          setDownloadHistory([]);
        }}
      >
        {downloadHistory.length > 0 && (() => {
          const completed = downloadHistory.filter(h => h.status === 'completed').length;
          const failed = downloadHistory.filter(h => h.status === 'failed').length;
          const total = downloadHistory.length;
          return (
            <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fafafa', borderRadius: 6, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <span>{t('favoriteTags.historyTotal')}: <strong>{total}</strong></span>
              <span style={{ color: '#52c41a' }}>{t('favoriteTags.historyCompleted')}: <strong>{completed}</strong></span>
              <span style={{ color: '#ff4d4f' }}>{t('favoriteTags.historyFailed')}: <strong>{failed}</strong></span>
            </div>
          );
        })()}
        <List
          loading={historyLoading}
          locale={{ emptyText: t('favoriteTags.noDownloadHistory') }}
          dataSource={downloadHistory}
          renderItem={(item) => (
            <List.Item
              actions={
                isRetryableStatus(item.status as FavoriteTagDownloadDisplayStatus)
                  ? [
                      <Button
                        key="retry"
                        size="small"
                        icon={<RedoOutlined />}
                        onClick={() => handleRetrySession(item.sessionId)}
                      >
                        {t('favoriteTags.retryFailed')}
                      </Button>
                    ]
                  : undefined
              }
            >
              <List.Item.Meta
                title={
                  <Space>
                    <Tag color={getStatusColorUtil(item.status as FavoriteTagDownloadDisplayStatus)}>
                      {t(`favoriteTags.${item.status}`) || item.status}
                    </Tag>
                    <span style={{ fontSize: 12, color: '#999' }}>{item.sessionId.slice(0, 8)}</span>
                  </Space>
                }
                description={
                  <Space direction="vertical" size={2}>
                    <span>{t('favoriteTags.historyStartedAt')}: {formatDateTime(item.startedAt)}</span>
                    {item.completedAt && (
                      <span>{t('favoriteTags.historyCompletedAt')}: {formatDateTime(item.completedAt)}</span>
                    )}
                    {item.error && (
                      <Alert type="error" showIcon message={item.error} style={{ padding: '4px 8px', marginTop: 4 }} />
                    )}
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Modal>

      <Modal
        title={t('favoriteTags.editTitle', { name: editingTag?.tagName || '' })}
        open={!!editingTag}
        onCancel={() => { setEditingTag(null); form.resetFields(); }}
        onOk={() => form.submit()}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
      >
        <Form form={form} layout="vertical" onFinish={handleEdit}>
          <Form.Item name="siteId" label={t('favoriteTags.site')}>
            {editingTag?.siteId == null ? (
              <Select
                placeholder={t('favoriteTags.sitePlaceholder')}
                allowClear={false}
                options={[
                  { label: t('favoriteTags.global'), value: null },
                  ...sites.map(s => ({ label: s.name, value: s.id })),
                ]}
              />
            ) : (
              <Tooltip title="已指派到具体站点，无法修改">
                <Select
                  disabled
                  value={editingTag.siteId}
                  options={sites.map(s => ({ label: s.name, value: s.id }))}
                />
              </Tooltip>
            )}
          </Form.Item>
          <Form.Item name="labels" label={t('favoriteTags.groupSeparator')}>
            <Input placeholder={t('favoriteTags.groupPlaceholder')} />
          </Form.Item>
          <Form.Item name="notes" label={t('favoriteTags.notes')}>
            <Input.TextArea rows={2} placeholder={t('favoriteTags.notesPlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>

      <BatchTagAddModal
        open={batchAddModalOpen}
        title="批量添加收藏标签"
        sites={sites}
        extraField={{
          name: 'labels',
          label: '分组（逗号分隔）',
          placeholder: '例如: 角色, 风格',
        }}
        onCancel={() => setBatchAddModalOpen(false)}
        onSubmit={async (values) => {
          const result = await window.electronAPI.booru.addFavoriteTagsBatch(
            values.tagNames,
            values.siteId,
            values.extra || undefined
          );
          if (result.success && result.data) {
            message.success(`已添加 ${result.data.added} 个标签，跳过 ${result.data.skipped} 个`);
            setBatchAddModalOpen(false);
            loadFavoriteTags();
          } else {
            message.error(`${t('common.failed')}: ${result.error}`);
            throw new Error(result.error || 'failed');
          }
        }}
      />

      <ImportTagsDialog
        open={importDialogOpen}
        title="导入收藏标签"
        sites={sites}
        onCancel={() => {
          setImportDialogOpen(false);
          setPendingLabelGroups(undefined);
        }}
        onPickFile={async () => {
          const res = await window.electronAPI.booru.importFavoriteTagsPickFile();
          if (res.success && res.data && !res.data.cancelled) {
            setPendingLabelGroups(res.data.labelGroups);
          }
          return res;
        }}
        onCommit={(payload) => window.electronAPI.booru.importFavoriteTagsCommit({
          ...payload,
          labelGroups: pendingLabelGroups,
        })}
        onImported={(result) => {
          setPendingLabelGroups(undefined);
          const r = result as { imported: number; skipped: number; labelsImported?: number; labelsSkipped?: number };
          const parts = [`已导入 ${r.imported} 个标签，跳过 ${r.skipped} 个`];
          if (r.labelsImported || r.labelsSkipped) {
            parts.push(`分组: 导入 ${r.labelsImported ?? 0} / 跳过 ${r.labelsSkipped ?? 0}`);
          }
          message.success(parts.join('，'));
          setImportDialogOpen(false);
          loadFavoriteTags();
        }}
      />
    </div>
  );
};

export default FavoriteTagsPage;
