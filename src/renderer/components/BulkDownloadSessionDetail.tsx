/**
 * 批量下载会话详情页面
 * 参考：Boorusama download_manager_page.dart
 * 功能：
 * - 显示会话的所有下载记录
 * - 支持按状态过滤（all、pending、downloading、completed、failed）
 * - 显示每个记录的详细信息
 * - 支持重试单个失败记录
 * - 支持重试所有失败记录
 */

import React, { useEffect, useState } from 'react';
import { Card, Table, Tag, Button, Space, Tabs, message, Empty, Spin, Popconfirm, Modal, Progress } from 'antd';
import {
  ReloadOutlined,
  EyeOutlined
} from '@ant-design/icons';
import { BulkDownloadSession, BulkDownloadRecord, BulkDownloadRecordStatus } from '../../shared/types';
import { StatusTag } from './StatusTag';

interface BulkDownloadSessionDetailProps {
  session: BulkDownloadSession;
  onClose: () => void;
  onRefresh?: () => void;
}

export const BulkDownloadSessionDetail: React.FC<BulkDownloadSessionDetailProps> = ({
  session,
  onClose,
  onRefresh
}) => {
  const [records, setRecords] = useState<BulkDownloadRecord[]>([]);
  const [activeTab, setActiveTab] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // 使用 useMemo 计算过滤后的记录，避免闪烁
  const filteredRecords = React.useMemo(() => {
    if (activeTab === 'all') {
      return records;
    }
    return records.filter(r => r.status === activeTab);
  }, [records, activeTab]);

  // 加载记录（静默刷新）
  const loadRecords = async (silent: boolean = false, autoFix: boolean = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.bulkDownload.getRecords(session.id, undefined, undefined, autoFix);
      if (result.success && result.data) {
        // 使用函数式更新，确保状态更新是原子的
        setRecords(prevRecords => {
          const newRecords = result.data!;
          
          // 如果数据没有变化，不更新状态，避免不必要的重渲染
          if (prevRecords.length === newRecords.length) {
            // 创建 URL 到记录的映射，用于快速查找
            const prevMap = new Map(prevRecords.map(r => [r.url, r]));
            
            // 检查是否有任何记录的状态、文件大小或进度发生变化
            const hasChanged = newRecords.some((newRecord) => {
              const prevRecord = prevMap.get(newRecord.url);
              if (!prevRecord) return true; // 新记录，需要更新
              
              // 比较关键字段（包括进度）
              return (
                prevRecord.status !== newRecord.status ||
                prevRecord.fileSize !== newRecord.fileSize ||
                prevRecord.error !== newRecord.error ||
                prevRecord.fileName !== newRecord.fileName ||
                prevRecord.progress !== newRecord.progress ||
                prevRecord.downloadedBytes !== newRecord.downloadedBytes ||
                prevRecord.totalBytes !== newRecord.totalBytes
              );
            });
            
            if (!hasChanged) {
              return prevRecords; // 数据未变化，不更新
            }
          }
          
          // 数据有变化，更新状态
          return newRecords;
        });
        if (isInitialLoad) {
          setIsInitialLoad(false);
        }
      } else if (!silent) {
        message.error('加载记录失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      console.error('加载记录失败:', error);
      if (!silent) {
        message.error('加载记录失败');
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    // 首次加载显示 loading
    loadRecords(false);

    // 监听实时进度更新（通过 IPC 事件，不依赖轮询）
    const removeProgressListener = window.electronAPI?.system?.onBulkDownloadRecordProgress?.((data: {
      sessionId: string;
      url: string;
      progress: number;
      downloadedBytes: number;
      totalBytes: number;
    }) => {
      // 只处理当前会话的进度更新
      if (data.sessionId === session.id) {
        setRecords(prevRecords => {
          return prevRecords.map(record => {
            if (record.url === data.url) {
              return {
                ...record,
                progress: data.progress,
                downloadedBytes: data.downloadedBytes,
                totalBytes: data.totalBytes,
                status: 'downloading' as BulkDownloadRecordStatus
              };
            }
            return record;
          });
        });
      }
    });

    // 监听状态变化（完成、失败等）
    const removeStatusListener = window.electronAPI?.system?.onBulkDownloadRecordStatus?.((data: {
      sessionId: string;
      url: string;
      status: BulkDownloadRecordStatus;
      fileSize?: number;
      progress?: number;
      downloadedBytes?: number;
      totalBytes?: number;
      error?: string;
    }) => {
      // 只处理当前会话的状态更新
      if (data.sessionId === session.id) {
        setRecords(prevRecords => {
          return prevRecords.map(record => {
            if (record.url === data.url) {
              return {
                ...record,
                status: data.status,
                fileSize: data.fileSize ?? record.fileSize,
                progress: data.progress ?? record.progress,
                downloadedBytes: data.downloadedBytes ?? record.downloadedBytes,
                totalBytes: data.totalBytes ?? record.totalBytes,
                error: data.error ?? record.error
              };
            }
            return record;
          });
        });
      }
    });

    // 如果会话正在运行，定期静默刷新（用于同步状态变化，如完成、失败等）
    // 但进度更新和状态变化主要依赖实时事件，所以可以大幅降低轮询频率
    // 页面不可见时暂停轮询，避免后台 CPU 空转
    let interval: NodeJS.Timeout | null = null;
    let handleVisibility: (() => void) | null = null;
    if (session.status === 'running' || session.status === 'paused') {
      interval = setInterval(() => {
        loadRecords(true);
      }, 10000);
      handleVisibility = () => {
        if (document.hidden) {
          if (interval) { clearInterval(interval); interval = null; }
        } else {
          if (!interval) { loadRecords(true); interval = setInterval(() => loadRecords(true), 10000); }
        }
      };
      document.addEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      if (removeProgressListener) {
        removeProgressListener();
      }
      if (removeStatusListener) {
        removeStatusListener();
      }
      if (interval) {
        clearInterval(interval);
      }
      if (handleVisibility) {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, [session.id, session.status]);

  // 获取状态标签（使用统一 StatusTag 组件）
  const getStatusTag = (status: BulkDownloadRecordStatus) => (
    <StatusTag status={status} />
  );

  // 重试单个失败记录
  const handleRetryRecord = async (record: BulkDownloadRecord) => {
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.bulkDownload.retryFailedRecord(session.id, record.url);
      if (result.success) {
        message.success('已加入重试队列');
        loadRecords(true); // 静默刷新
        onRefresh?.();
      } else {
        message.error('重试失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      console.error('重试失败:', error);
      message.error('重试失败');
    }
  };

  // 重试所有失败记录
  const handleRetryAllFailed = async () => {
    setRetrying(true);
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.bulkDownload.retryAllFailed(session.id);
      if (result.success) {
        message.success('已将所有失败项加入重试队列');
        loadRecords(true); // 静默刷新
        onRefresh?.();
      } else {
        message.error('重试失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      console.error('重试所有失败项失败:', error);
      message.error('重试所有失败项失败');
    } finally {
      setRetrying(false);
    }
  };

  // 格式化文件大小
  const formatBytes = (bytes?: number) => {
    if (!bytes) return '-';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // 统计各状态数量
  const stats = {
    all: records.length,
    pending: records.filter(r => r.status === 'pending').length,
    downloading: records.filter(r => r.status === 'downloading').length,
    completed: records.filter(r => r.status === 'completed').length,
    failed: records.filter(r => r.status === 'failed').length
  };

  // 表格列定义
  const columns = [
    {
      title: '文件名',
      dataIndex: 'fileName',
      key: 'fileName',
      ellipsis: true,
      render: (text: string) => <span title={text}>{text}</span>
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: BulkDownloadRecordStatus) => getStatusTag(status)
    },
    {
      title: '页面',
      key: 'page',
      width: 100,
      render: (_: any, record: BulkDownloadRecord) => (
        <span>第 {record.page} 页</span>
      )
    },
    {
      title: '文件大小',
      dataIndex: 'fileSize',
      key: 'fileSize',
      width: 120,
      render: (size: number | undefined, record: BulkDownloadRecord) => {
        if (record.status === 'downloading' && record.totalBytes) {
          return formatBytes(record.totalBytes);
        }
        return formatBytes(size);
      }
    },
    {
      title: '下载进度',
      key: 'progress',
      width: 200,
      render: (_: any, record: BulkDownloadRecord) => {
        if (record.status === 'downloading') {
          const progress = record.progress || 0;
          const downloaded = record.downloadedBytes || 0;
          const total = record.totalBytes || 0;
          return (
            <Space direction="vertical" style={{ width: '100%' }} size={0}>
              <Progress 
                percent={progress} 
                size="small" 
                status="active"
                showInfo={false}
              />
              <span style={{ fontSize: '12px', color: '#888' }}>
                {formatBytes(downloaded)} / {formatBytes(total)} ({progress}%)
              </span>
            </Space>
          );
        }
        return '-';
      }
    },
    {
      title: '错误信息',
      dataIndex: 'error',
      key: 'error',
      ellipsis: true,
      render: (error?: string) => error ? <Tag color="red">{error}</Tag> : '-'
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: any, record: BulkDownloadRecord) => (
        record.status === 'failed' ? (
          <Button
            type="link"
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => handleRetryRecord(record)}
          >
            重试
          </Button>
        ) : null
      )
    }
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <EyeOutlined />
          <span style={{ fontSize: '16px', fontWeight: 'bold' }}>
            下载详情 - {session.task?.tags || '无标签'}
          </span>
        </Space>
        <Space>
          <Button 
            icon={<ReloadOutlined />} 
            onClick={() => loadRecords(false, true)} 
            loading={loading}
            title="刷新并自动修复状态不一致的记录"
          >
            刷新
          </Button>
          <Button onClick={onClose}>关闭</Button>
        </Space>
      </div>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'all',
            label: `全部 (${stats.all})`,
            children: null
          },
          {
            key: 'pending',
            label: `等待中 (${stats.pending})`,
            children: null
          },
          {
            key: 'downloading',
            label: `下载中 (${stats.downloading})`,
            children: null
          },
          {
            key: 'completed',
            label: `已完成 (${stats.completed})`,
            children: null
          },
          {
            key: 'failed',
            label: `失败 (${stats.failed})`,
            children: null
          }
        ]}
      />

      {isInitialLoad && loading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <Spin size="large" />
        </div>
      ) : filteredRecords.length === 0 ? (
        <Empty description="暂无记录" />
      ) : (
        <>
          <Table
            dataSource={filteredRecords}
            columns={columns}
            rowKey={(record) => `${record.url}-${record.sessionId}`}
            pagination={{
              pageSize: 20,
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条记录`,
              // 保持分页状态，避免刷新时跳回第一页
              showQuickJumper: false
            }}
            size="small"
            loading={isInitialLoad && loading}
          />
          
          {/* 重试所有失败项按钮（只在失败标签页显示） */}
          {activeTab === 'failed' && stats.failed > 0 && (
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <Popconfirm
                title={`确定要重试所有 ${stats.failed} 个失败项吗？`}
                onConfirm={handleRetryAllFailed}
              >
                <Button
                  type="primary"
                  icon={<ReloadOutlined />}
                  loading={retrying}
                  size="large"
                >
                  重试所有失败项 ({stats.failed})
                </Button>
              </Popconfirm>
            </div>
          )}
        </>
      )}
    </div>
  );
};

