import React, { useEffect, useState } from 'react';
import { Card, Table, Progress, Button, Space, Tag, Tabs, Popconfirm, message, App } from 'antd';
import { 
  DownloadOutlined, 
  PauseCircleOutlined, 
  PlayCircleOutlined, 
  DeleteOutlined, 
  CheckCircleOutlined, 
  CloseCircleOutlined,
  SyncOutlined
} from '@ant-design/icons';
import { DownloadQueueItem } from '../../shared/types';

const { TabPane } = Tabs;

export const BooruDownloadPage: React.FC = () => {
  const { message } = App.useApp();
  const [activeDownloads, setActiveDownloads] = useState<DownloadQueueItem[]>([]);
  const [completedDownloads, setCompletedDownloads] = useState<DownloadQueueItem[]>([]);
  const [failedDownloads, setFailedDownloads] = useState<DownloadQueueItem[]>([]);
  const [loading, setLoading] = useState(false);

  // 加载下载队列
  const loadQueue = async () => {
    setLoading(true);
    try {
      if (!window.electronAPI) return;

      // 获取不同状态的队列
      const pendingRes = await window.electronAPI.booru.getDownloadQueue('pending');
      const downloadingRes = await window.electronAPI.booru.getDownloadQueue('downloading');
      const completedRes = await window.electronAPI.booru.getDownloadQueue('completed');
      const failedRes = await window.electronAPI.booru.getDownloadQueue('failed');

      if (pendingRes.success && downloadingRes.success) {
        // 合并正在下载和等待中的
        const active = [...(downloadingRes.data || []), ...(pendingRes.data || [])];
        setActiveDownloads(active);
      }

      if (completedRes.success) {
        setCompletedDownloads(completedRes.data || []);
      }

      if (failedRes.success) {
        setFailedDownloads(failedRes.data || []);
      }
    } catch (error) {
      console.error('加载下载队列失败:', error);
      message.error('加载下载队列失败');
    } finally {
      setLoading(false);
    }
  };

  // 监听下载进度
  useEffect(() => {
    loadQueue();

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

    return () => {
      if (removeProgressListener) removeProgressListener();
      if (removeStatusListener) removeStatusListener();
    };
  }, []);

  // 格式化字节数
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
      render: (status: string) => {
        const colors: Record<string, string> = {
          pending: 'default',
          downloading: 'processing',
          paused: 'warning',
        };
        const texts: Record<string, string> = {
          pending: '等待中',
          downloading: '下载中',
          paused: '已暂停',
        };
        return <Tag color={colors[status]}>{texts[status] || status}</Tag>;
      }
    },
    {
      title: '进度',
      key: 'progress',
      width: 250,
      render: (_: any, record: DownloadQueueItem) => (
        <Space direction="vertical" style={{ width: '100%' }} size={0}>
          <Progress percent={record.progress} size="small" status={record.status === 'downloading' ? 'active' : 'normal'} />
          <span style={{ fontSize: '12px', color: '#888' }}>
            {formatBytes(record.downloadedBytes)} / {formatBytes(record.totalBytes)}
          </span>
        </Space>
      )
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_: any, record: DownloadQueueItem) => (
        <Space>
          {/* 暂停/恢复功能暂未实现，预留按钮 */}
          {/* <Button 
            type="text" 
            icon={record.status === 'paused' ? <PlayCircleOutlined /> : <PauseCircleOutlined />} 
          /> */}
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
      render: (path: string) => path ? path.split(/[\\/]/).pop() : '未知',
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
      width: 100,
      render: (_: any, record: DownloadQueueItem) => (
        <Button type="link" size="small">查看</Button>
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
          </Space>
        }
        extra={
          <Button icon={<SyncOutlined />} onClick={loadQueue} loading={loading}>
            刷新
          </Button>
        }
      >
        <Tabs defaultActiveKey="active">
          <TabPane tab={`进行中 (${activeDownloads.length})`} key="active">
            <Table 
              dataSource={activeDownloads} 
              columns={activeColumns} 
              rowKey="id"
              pagination={false}
            />
          </TabPane>
          <TabPane tab={`已完成 (${completedDownloads.length})`} key="completed">
            <Table 
              dataSource={completedDownloads} 
              columns={completedColumns} 
              rowKey="id"
            />
          </TabPane>
          <TabPane tab={`失败 (${failedDownloads.length})`} key="failed">
            <Table 
              dataSource={failedDownloads} 
              rowKey="id"
              columns={[
                ...activeColumns.slice(0, 2),
                {
                  title: '错误信息',
                  dataIndex: 'errorMessage',
                  key: 'errorMessage',
                  render: (msg: string) => <Tag color="red">{msg}</Tag>
                },
                {
                  title: '操作',
                  key: 'action',
                  render: (_: any, record: DownloadQueueItem) => (
                    <Button 
                      size="small" 
                      type="primary"
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
          </TabPane>
        </Tabs>
      </Card>
    </div>
  );
};

export default BooruDownloadPage;
