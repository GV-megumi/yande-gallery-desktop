import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Card, Table, Progress, Button, Space, Tag, Tabs, Popconfirm, App, Tooltip, Image, Select } from 'antd';
import { StatusTag } from '../components/StatusTag';
import { useContextMenu, ContextMenuPortal } from '../components/ContextMenu';
import {
  DownloadOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  DeleteOutlined,
  SyncOutlined,
  ClearOutlined,
  ReloadOutlined,
  EyeOutlined,
  FolderOpenOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
  CopyOutlined
} from '@ant-design/icons';
import { DownloadQueueItem } from '../../shared/types';
import { localPathToAppUrl } from '../utils/url';

const { Option } = Select;

// 排序类型
type SortField = 'filename' | 'completedAt' | 'totalBytes';
type SortOrder = 'asc' | 'desc';

// 将本地文件路径转换为 app:// 协议 URL
const getImageUrl = (filePath: string): string => {
  if (!filePath) return '';
  if (filePath.startsWith('app://')) return filePath;
  return localPathToAppUrl(filePath);
};

interface QueueStatus {
  isPaused: boolean;
  activeCount: number;
  maxConcurrent: number;
}

export const BooruDownloadPage: React.FC = () => {
  const { message } = App.useApp();
  const [activeDownloads, setActiveDownloads] = useState<DownloadQueueItem[]>([]);
  const [completedDownloads, setCompletedDownloads] = useState<DownloadQueueItem[]>([]);
  const [failedDownloads, setFailedDownloads] = useState<DownloadQueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [queueStatus, setQueueStatus] = useState<QueueStatus>({ isPaused: false, activeCount: 0, maxConcurrent: 3 });
  const [resuming, setResuming] = useState(false);
  const hasResumedRef = useRef(false); // 标记是否已经尝试恢复过
  
  // 用于查看原图的状态
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);

  // 右键菜单
  const rowMenu = useContextMenu<DownloadQueueItem & { _tab?: string }>();

  // 已完成列表排序状态
  const [sortField, setSortField] = useState<SortField>('completedAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // 排序后的已完成列表
  const sortedCompletedDownloads = useMemo(() => {
    const sorted = [...completedDownloads].sort((a, b) => {
      let compareResult = 0;
      
      switch (sortField) {
        case 'filename':
          const nameA = a.targetPath ? a.targetPath.split(/[\\/]/).pop() || '' : '';
          const nameB = b.targetPath ? b.targetPath.split(/[\\/]/).pop() || '' : '';
          compareResult = nameA.localeCompare(nameB);
          break;
        case 'completedAt':
          const timeA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
          const timeB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
          compareResult = timeA - timeB;
          break;
        case 'totalBytes':
          compareResult = (a.totalBytes || 0) - (b.totalBytes || 0);
          break;
      }
      
      return sortOrder === 'asc' ? compareResult : -compareResult;
    });
    
    return sorted;
  }, [completedDownloads, sortField, sortOrder]);

  // 加载下载队列（使用 useCallback 避免闭包过期）
  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      if (!window.electronAPI) return;

      // 获取不同状态的队列
      const pendingRes = await window.electronAPI.booru.getDownloadQueue('pending');
      const downloadingRes = await window.electronAPI.booru.getDownloadQueue('downloading');
      const pausedRes = await window.electronAPI.booru.getDownloadQueue('paused');
      const completedRes = await window.electronAPI.booru.getDownloadQueue('completed');
      const failedRes = await window.electronAPI.booru.getDownloadQueue('failed');

      if (pendingRes.success && downloadingRes.success && pausedRes.success) {
        // 合并正在下载、等待中和已暂停的
        const active = [
          ...(downloadingRes.data || []), 
          ...(pendingRes.data || []),
          ...(pausedRes.data || [])
        ];
        setActiveDownloads(active);
      }

      if (completedRes.success) {
        setCompletedDownloads(completedRes.data || []);
      }

      if (failedRes.success) {
        setFailedDownloads(failedRes.data || []);
      }

      // 获取队列状态
      const statusRes = await window.electronAPI.booru.getQueueStatus();
      if (statusRes.success && statusRes.data) {
        setQueueStatus(statusRes.data);
      }
    } catch (error) {
      console.error('加载下载队列失败:', error);
      message.error('加载下载队列失败');
    } finally {
      setLoading(false);
    }
  }, [message]);

  // 恢复未完成的下载任务（首次进入时调用）
  const resumePendingDownloads = async () => {
    if (hasResumedRef.current) return;
    hasResumedRef.current = true;

    try {
      if (!window.electronAPI) return;

      setResuming(true);
      console.log('[BooruDownloadPage] 尝试恢复未完成的下载任务...');
      
      const result = await window.electronAPI.booru.resumePendingDownloads();
      
      if (result.success && result.data) {
        const { resumed, total } = result.data;
        if (resumed > 0) {
          message.info(`正在恢复 ${resumed} 个未完成的下载任务`);
        }
        console.log(`[BooruDownloadPage] 恢复结果: ${resumed}/${total} 个任务`);
      }
    } catch (error) {
      console.error('[BooruDownloadPage] 恢复下载任务失败:', error);
    } finally {
      setResuming(false);
    }
  };

  // 暂停所有下载
  const handlePauseAll = async () => {
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.booru.pauseAllDownloads();
      if (result.success) {
        message.success('已暂停所有下载');
        loadQueue();
      } else {
        message.error(result.error || '暂停失败');
      }
    } catch (error) {
      console.error('[BooruDownloadPage] 暂停下载失败:', error);
      message.error('暂停下载失败');
    }
  };

  // 恢复所有下载
  const handleResumeAll = async () => {
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.booru.resumeAllDownloads();
      if (result.success) {
        message.success('已恢复下载');
        loadQueue();
      } else {
        message.error(result.error || '恢复失败');
      }
    } catch (error) {
      console.error('[BooruDownloadPage] 恢复下载失败:', error);
      message.error('恢复下载失败');
    }
  };

  // 暂停单个下载
  const handlePauseDownload = async (queueId: number) => {
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.booru.pauseDownload(queueId);
      if (result.success) {
        message.success('已暂停下载');
        loadQueue();
      } else {
        message.error(result.error || '暂停失败');
      }
    } catch (error) {
      console.error('[BooruDownloadPage] 暂停下载失败:', error);
      message.error('暂停下载失败');
    }
  };

  // 恢复单个下载
  const handleResumeDownload = async (queueId: number) => {
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.booru.resumeDownload(queueId);
      if (result.success) {
        message.success('已恢复下载');
        loadQueue();
      } else {
        message.error(result.error || '恢复失败');
      }
    } catch (error) {
      console.error('[BooruDownloadPage] 恢复下载失败:', error);
      message.error('恢复下载失败');
    }
  };

  // 重试所有失败的下载
  const handleRetryAllFailed = async () => {
    try {
      if (!window.electronAPI) return;

      let successCount = 0;
      let failCount = 0;

      for (const item of failedDownloads) {
        try {
          const result = await window.electronAPI.booru.retryDownload(item.postId, item.siteId);
          if (result.success) {
            successCount++;
          } else {
            failCount++;
          }
        } catch {
          failCount++;
        }
      }

      if (successCount > 0) {
        message.success(`已重新加入 ${successCount} 个下载任务`);
      }
      if (failCount > 0) {
        message.warning(`${failCount} 个任务重试失败`);
      }
      
      loadQueue();
    } catch (error) {
      console.error('[BooruDownloadPage] 重试所有失败下载失败:', error);
      message.error('重试失败');
    }
  };

  // 监听下载进度
  useEffect(() => {
    // 加载队列
    loadQueue();

    // 首次进入时恢复未完成的下载
    resumePendingDownloads();

    // 监听进度更新
    const removeProgressListener = window.electronAPI?.booru.onDownloadProgress((data: any) => {
      setActiveDownloads(prev => prev.map(item => {
        if (item.id === data.id) {
          return {
            ...item,
            progress: data.progress,
            downloadedBytes: data.downloadedBytes,
            totalBytes: data.totalBytes,
            status: 'downloading'
          };
        }
        return item;
      }));
    });

    // 监听状态更新
    const removeStatusListener = window.electronAPI?.booru.onDownloadStatus((_data: any) => {
      // 状态变更时重新加载队列，确保列表准确
      loadQueue();
    });

    // 监听队列状态变化
    const removeQueueStatusListener = window.electronAPI?.booru.onQueueStatus((data: QueueStatus) => {
      setQueueStatus(data);
    });

    return () => {
      if (removeProgressListener) removeProgressListener();
      if (removeStatusListener) removeStatusListener();
      if (removeQueueStatusListener) removeQueueStatusListener();
    };
  }, [loadQueue]);

  // 格式化字节数
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // 清空下载记录
  const handleClearRecords = async (status: 'completed' | 'failed') => {
    console.log('[BooruDownloadPage] 清空下载记录，状态:', status);
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.booru.clearDownloadRecords(status);
      if (result.success) {
        const statusText = status === 'completed' ? '已完成' : '失败';
        message.success(`已清空 ${result.data || 0} 条${statusText}记录`);
        loadQueue(); // 重新加载队列
      } else {
        message.error(result.error || '清空失败');
      }
    } catch (error) {
      console.error('[BooruDownloadPage] 清空下载记录失败:', error);
      message.error('清空下载记录失败');
    }
  };

  // 获取右键菜单项
  const getRowContextItems = useCallback(() => {
    if (!rowMenu.data) return [];
    const record = rowMenu.data;
    const tab = record._tab;

    if (tab === 'active') {
      const items: any[] = [];
      if (record.status === 'paused') {
        items.push({ key: 'resume', label: '恢复下载', icon: <PlayCircleOutlined />, onClick: () => handleResumeDownload(record.id) });
      } else if (record.status === 'downloading') {
        items.push({ key: 'pause', label: '暂停下载', icon: <PauseCircleOutlined />, onClick: () => handlePauseDownload(record.id) });
      }
      return items;
    }

    if (tab === 'completed') {
      return [
        { key: 'preview', label: '查看原图', icon: <EyeOutlined />, disabled: !record.targetPath, onClick: () => {
          if (record.targetPath) {
            setPreviewImage(getImageUrl(record.targetPath));
            setPreviewVisible(true);
          }
        }},
        { key: 'showInFolder', label: '打开文件所在目录', icon: <FolderOpenOutlined />, disabled: !record.targetPath, onClick: () => handleViewFile(record) },
        { key: 'copyPath', label: '复制文件路径', icon: <CopyOutlined />, disabled: !record.targetPath, onClick: () => {
          if (record.targetPath) {
            navigator.clipboard.writeText(record.targetPath);
            message.success('已复制文件路径');
          }
        }},
      ];
    }

    if (tab === 'failed') {
      return [
        { key: 'retry', label: '重试下载', icon: <ReloadOutlined />, onClick: async () => {
          try {
            const result = await window.electronAPI.booru.retryDownload(record.postId, record.siteId);
            if (result.success) {
              message.success('已重新加入下载队列');
              loadQueue();
            } else {
              message.error(result.error || '重试失败');
            }
          } catch (error) {
            console.error('重试下载失败:', error);
            message.error('重试下载失败');
          }
        }},
        ...(record.errorMessage ? [{ key: 'copyError', label: '复制错误信息', icon: <CopyOutlined />, onClick: () => {
          navigator.clipboard.writeText(record.errorMessage || '');
          message.success('已复制错误信息');
        }}] : []),
      ];
    }

    return [];
  }, [rowMenu.data]);

  // 构造 onRow handler（附加 _tab 标识）
  const makeOnRow = useCallback((tab: string) => (record: DownloadQueueItem) => ({
    onContextMenu: (e: React.MouseEvent) => {
      rowMenu.show(e, { ...record, _tab: tab } as any);
    }
  }), [rowMenu.show]);

  // 查看文件（在文件管理器中显示）
  const handleViewFile = async (record: DownloadQueueItem) => {
    console.log('[BooruDownloadPage] 查看文件:', record.targetPath);
    try {
      if (!window.electronAPI) {
        message.error('系统API不可用');
        return;
      }

      if (!record.targetPath) {
        message.warning('文件路径不存在');
        return;
      }

      const result = await window.electronAPI.system.showItem(record.targetPath);
      if (!result.success) {
        message.error(result.error || '打开文件失败');
      }
    } catch (error) {
      console.error('[BooruDownloadPage] 查看文件失败:', error);
      message.error('查看文件失败: ' + String(error));
    }
  };

  // 活跃下载列定义
  const activeColumns = [
    {
      title: 'ID',
      dataIndex: 'postId',
      key: 'postId',
      width: 100,
    },
    {
      title: '文件名',
      dataIndex: 'targetPath',
      key: 'targetPath',
      render: (path: string) => path ? path.split(/[\\/]/).pop() : '未知',
      ellipsis: true,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: string) => <StatusTag status={status} />
    },
    {
      title: '进度',
      key: 'progress',
      width: 250,
      render: (_: any, record: DownloadQueueItem) => (
        <Space direction="vertical" style={{ width: '100%' }} size={0}>
          <Progress 
            percent={record.progress} 
            size="small" 
            status={record.status === 'downloading' ? 'active' : (record.status === 'paused' ? 'exception' : 'normal')} 
          />
          <span style={{ fontSize: '12px', color: '#888' }}>
            {formatBytes(record.downloadedBytes)} / {formatBytes(record.totalBytes)}
          </span>
        </Space>
      )
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: any, record: DownloadQueueItem) => (
        <Space>
          {/* 暂停/恢复按钮 */}
          {record.status === 'paused' ? (
            <Tooltip title="恢复下载">
              <Button 
                type="text" 
                icon={<PlayCircleOutlined />} 
                onClick={() => handleResumeDownload(record.id)}
                style={{ color: '#52c41a' }}
              />
            </Tooltip>
          ) : (
            <Tooltip title="暂停下载">
              <Button 
                type="text" 
                icon={<PauseCircleOutlined />} 
                onClick={() => handlePauseDownload(record.id)}
                disabled={record.status === 'pending'}
              />
            </Tooltip>
          )}
          {/* 删除按钮 */}
          <Popconfirm title="确定取消下载吗？" onConfirm={() => { /* TODO: 实现取消 */ }}>
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ];

  // 已完成列定义
  const completedColumns = [
    {
      title: 'ID',
      dataIndex: 'postId',
      key: 'postId',
      width: 100,
    },
    {
      title: '文件名',
      dataIndex: 'targetPath',
      key: 'targetPath',
      render: (path: string, record: DownloadQueueItem) => {
        const fileName = path ? path.split(/[\\/]/).pop() : '未知';
        return (
          <Tooltip title="点击在资源管理器中显示">
            <span 
              style={{ 
                color: '#007AFF',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4
              }}
              onClick={() => handleViewFile(record)}
            >
              <FolderOpenOutlined />
              {fileName}
            </span>
          </Tooltip>
        );
      },
      ellipsis: true,
    },
    {
      title: '完成时间',
      dataIndex: 'completedAt',
      key: 'completedAt',
      width: 180,
      render: (date: string) => new Date(date).toLocaleString()
    },
    {
      title: '大小',
      dataIndex: 'totalBytes',
      key: 'totalBytes',
      width: 120,
      render: (bytes: number) => formatBytes(bytes)
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: any, record: DownloadQueueItem) => (
        <Button 
          type="link" 
          size="small"
          icon={<EyeOutlined />}
          onClick={() => {
            if (record.targetPath) {
              setPreviewImage(getImageUrl(record.targetPath));
              setPreviewVisible(true);
            }
          }}
          disabled={!record.targetPath}
        >
          查看原图
        </Button>
      )
    }
  ];


  return (
    <div style={{ padding: '24px' }}>
      <Card 
        title={
          <Space>
            <DownloadOutlined />
            下载管理
            {queueStatus.isPaused && <Tag color="warning">全部暂停</Tag>}
            {resuming && <Tag color="processing">恢复中...</Tag>}
          </Space>
        }
        extra={
          <Button icon={<SyncOutlined />} onClick={loadQueue} loading={loading}>
            刷新
          </Button>
        }
      >
        <Tabs defaultActiveKey="active" items={[
          {
            key: 'active',
            label: `进行中 (${activeDownloads.length})`,
            children: (
              <>
                {/* 工具栏 */}
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
                  <Space>
                    {activeDownloads.length > 0 && (
                      queueStatus.isPaused ? (
                        <Button
                          type="primary"
                          icon={<PlayCircleOutlined />}
                          onClick={handleResumeAll}
                        >
                          全部继续
                        </Button>
                      ) : (
                        <Button
                          icon={<PauseCircleOutlined />}
                          onClick={handlePauseAll}
                        >
                          全部暂停
                        </Button>
                      )
                    )}
                  </Space>
                </div>
                <Table
                  dataSource={activeDownloads}
                  columns={activeColumns}
                  rowKey="id"
                  pagination={false}
                  locale={{ emptyText: '没有进行中的下载' }}
                  onRow={makeOnRow('active')}
                />
              </>
            )
          },
          {
            key: 'completed',
            label: `已完成 (${completedDownloads.length})`,
            children: (
              <>
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Space>
                    <span style={{ color: 'rgba(60, 60, 67, 0.60)' }}>排序:</span>
                    <Select
                      value={sortField}
                      onChange={(value: SortField) => setSortField(value)}
                      style={{ width: 120 }}
                      size="small"
                    >
                      <Option value="completedAt">完成时间</Option>
                      <Option value="filename">文件名</Option>
                      <Option value="totalBytes">文件大小</Option>
                    </Select>
                    <Button
                      type="text"
                      size="small"
                      icon={sortOrder === 'asc' ? <SortAscendingOutlined /> : <SortDescendingOutlined />}
                      onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                    >
                      {sortOrder === 'asc' ? '升序' : '降序'}
                    </Button>
                  </Space>
                  <Popconfirm
                    title="确定要清空所有已完成的下载记录吗？"
                    onConfirm={() => handleClearRecords('completed')}
                    okText="确定"
                    cancelText="取消"
                    disabled={completedDownloads.length === 0}
                  >
                    <Button
                      icon={<ClearOutlined />}
                      danger
                      disabled={completedDownloads.length === 0}
                    >
                      清空记录
                    </Button>
                  </Popconfirm>
                </div>
                <Table
                  dataSource={sortedCompletedDownloads}
                  columns={completedColumns}
                  rowKey="id"
                  onRow={makeOnRow('completed')}
                />
              </>
            )
          },
          {
            key: 'failed',
            label: `失败 (${failedDownloads.length})`,
            children: (
              <>
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                  <Space>
                    {failedDownloads.length > 0 && (
                      <Popconfirm
                        title={`确定要重试所有 ${failedDownloads.length} 个失败的下载吗？`}
                        onConfirm={handleRetryAllFailed}
                        okText="确定"
                        cancelText="取消"
                      >
                        <Button
                          type="primary"
                          icon={<ReloadOutlined />}
                        >
                          全部重试
                        </Button>
                      </Popconfirm>
                    )}
                    <Popconfirm
                      title="确定要清空所有失败的下载记录吗？"
                      onConfirm={() => handleClearRecords('failed')}
                      okText="确定"
                      cancelText="取消"
                      disabled={failedDownloads.length === 0}
                    >
                      <Button
                        icon={<ClearOutlined />}
                        danger
                        disabled={failedDownloads.length === 0}
                      >
                        清空记录
                      </Button>
                    </Popconfirm>
                  </Space>
                </div>
                <Table
                  dataSource={failedDownloads}
                  rowKey="id"
                  onRow={makeOnRow('failed')}
                  columns={[
                    ...activeColumns.slice(0, 2),
                    {
                      title: '错误信息',
                      dataIndex: 'errorMessage',
                      key: 'errorMessage',
                      ellipsis: true,
                      render: (msg: string) => (
                        <Tooltip title={msg}>
                          <Tag color="red" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {msg || '未知错误'}
                          </Tag>
                        </Tooltip>
                      )
                    },
                    {
                      title: '操作',
                      key: 'action',
                      width: 100,
                      render: (_: any, record: DownloadQueueItem) => (
                        <Button
                          size="small"
                          type="primary"
                          icon={<ReloadOutlined />}
                          onClick={async () => {
                            try {
                              const result = await window.electronAPI.booru.retryDownload(record.postId, record.siteId);
                              if (result.success) {
                                message.success('已重新加入下载队列');
                                loadQueue();
                              } else {
                                message.error(result.error || '重试失败');
                              }
                            } catch (error) {
                              console.error('重试下载失败:', error);
                              message.error('重试下载失败');
                            }
                          }}
                        >
                          重试
                        </Button>
                      )
                    }
                  ]}
                />
              </>
            )
          }
        ]} />
      </Card>
      
      {/* 图片预览组件 */}
      <Image
        width={0}
        height={0}
        style={{ display: 'none' }}
        src={previewImage || ''}
        preview={{
          visible: previewVisible,
          src: previewImage || '',
          onVisibleChange: (visible) => {
            setPreviewVisible(visible);
            if (!visible) {
              setPreviewImage(null);
            }
          }
        }}
      />

      {/* 表格行右键菜单 */}
      <ContextMenuPortal
        open={rowMenu.open}
        x={rowMenu.x}
        y={rowMenu.y}
        items={getRowContextItems()}
        onClose={rowMenu.close}
      />
    </div>
  );
};

export default BooruDownloadPage;
