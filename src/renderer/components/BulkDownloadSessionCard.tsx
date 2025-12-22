/**
 * 批量下载会话卡片组件
 * 参考：Boorusama task_tile.dart
 * 功能：
 * - 显示会话状态和进度
 * - 显示任务信息（标签、路径等）
 * - 提供操作按钮（暂停、取消、删除等）
 */

import React, { useEffect, useState } from 'react';
import { Card, Progress, Tag, Button, Space, Popconfirm, message, Descriptions, Modal } from 'antd';
import {
  PauseOutlined,
  PlayCircleOutlined,
  StopOutlined,
  DeleteOutlined,
  ReloadOutlined,
  EyeOutlined
} from '@ant-design/icons';
import { BulkDownloadSession, BulkDownloadSessionStatus } from '../../shared/types';
import { BulkDownloadSessionDetail } from './BulkDownloadSessionDetail';

interface BulkDownloadSessionCardProps {
  session: BulkDownloadSession;
  onRefresh: () => void;
}

export const BulkDownloadSessionCard: React.FC<BulkDownloadSessionCardProps> = ({
  session,
  onRefresh
}) => {
  const [stats, setStats] = useState<{
    total: number;
    completed: number;
    failed: number;
    pending: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);

  // 判断是否可以查看详情 - 所有状态都可以查看详情
  const canViewDetails = true;

  // 加载统计信息
  const loadStats = async () => {
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.bulkDownload.getSessionStats(session.id);
      if (result.success && result.data) {
        setStats(result.data);
      }
    } catch (error) {
      console.error('加载统计失败:', error);
    }
  };

  useEffect(() => {
    loadStats();

    // 如果会话正在运行，定期刷新统计（降低频率，减少 IPC 调用）
    if (session.status === 'running' || session.status === 'dryRun') {
      const interval = setInterval(() => {
        loadStats();
      }, 5000); // 从2秒改为5秒，减少 IPC 调用频率
      return () => clearInterval(interval);
    }
  }, [session.id, session.status]);

  // 获取状态标签
  const getStatusTag = (status: BulkDownloadSessionStatus) => {
    const statusMap: Record<BulkDownloadSessionStatus, { color: string; text: string }> = {
      pending: { color: 'default', text: '等待中' },
      dryRun: { color: 'processing', text: '扫描中' },
      running: { color: 'processing', text: '下载中' },
      paused: { color: 'warning', text: '已暂停' },
      suspended: { color: 'warning', text: '已暂停' },
      completed: { color: 'success', text: '已完成' },
      allSkipped: { color: 'default', text: '全部跳过' },
      failed: { color: 'error', text: '失败' },
      cancelled: { color: 'default', text: '已取消' }
    };

    const statusInfo = statusMap[status] || { color: 'default', text: status };
    return <Tag color={statusInfo.color}>{statusInfo.text}</Tag>;
  };

  // 启动会话
  const handleStart = async () => {
    setLoading(true);
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.bulkDownload.startSession(session.id);
      if (result.success) {
        message.success('下载已启动');
        onRefresh();
      } else {
        message.error('启动失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      console.error('启动失败:', error);
      message.error('启动失败');
    } finally {
      setLoading(false);
    }
  };

  // 暂停会话
  const handlePause = async () => {
    setLoading(true);
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.bulkDownload.pauseSession(session.id);
      if (result.success) {
        message.success('已暂停');
        onRefresh();
      } else {
        message.error('暂停失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      console.error('暂停失败:', error);
      message.error('暂停失败');
    } finally {
      setLoading(false);
    }
  };

  // 取消会话
  const handleCancel = async () => {
    setLoading(true);
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.bulkDownload.cancelSession(session.id);
      if (result.success) {
        message.success('已取消');
        onRefresh();
      } else {
        message.error('取消失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      console.error('取消失败:', error);
      message.error('取消失败');
    } finally {
      setLoading(false);
    }
  };

  // 删除会话
  const handleDelete = async () => {
    setLoading(true);
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.bulkDownload.deleteSession(session.id);
      if (result.success) {
        message.success('已删除');
        onRefresh();
      } else {
        message.error('删除失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      console.error('删除失败:', error);
      message.error('删除失败');
    } finally {
      setLoading(false);
    }
  };

  const task = session.task;
  const progress = stats 
    ? stats.total > 0 
      ? Math.round((stats.completed / stats.total) * 100) 
      : 0
    : 0;

  return (
    <Card
      title={
        <Space>
          {getStatusTag(session.status)}
          <span>{task?.tags || '无标签'}</span>
        </Space>
      }
      extra={
        <Space>
          {session.status === 'pending' && (
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={handleStart}
              loading={loading}
            >
              开始
            </Button>
          )}
          {session.status === 'running' && (
            <Button
              icon={<PauseOutlined />}
              onClick={handlePause}
              loading={loading}
            >
              暂停
            </Button>
          )}
          {session.status === 'paused' && (
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={handleStart}
              loading={loading}
            >
              继续
            </Button>
          )}
          {(session.status === 'running' || session.status === 'paused' || session.status === 'dryRun') && (
            <Popconfirm
              title="确定要取消下载吗？"
              onConfirm={handleCancel}
            >
              <Button
                danger
                icon={<StopOutlined />}
                loading={loading}
              >
                取消
              </Button>
            </Popconfirm>
          )}
          {(session.status === 'completed' || session.status === 'failed' || session.status === 'cancelled' || session.status === 'allSkipped') && (
            <Popconfirm
              title="确定要删除这个会话吗？"
              onConfirm={handleDelete}
            >
              <Button
                danger
                icon={<DeleteOutlined />}
                loading={loading}
              >
                删除
              </Button>
            </Popconfirm>
          )}
          {canViewDetails && (
            <Button
              icon={<EyeOutlined />}
              onClick={() => setDetailVisible(true)}
            >
              查看详情
            </Button>
          )}
          <Button
            icon={<ReloadOutlined />}
            onClick={loadStats}
            loading={loading}
          >
            刷新
          </Button>
        </Space>
      }
    >
      <Descriptions column={2} size="small">
        <Descriptions.Item label="下载路径">{task?.path || '-'}</Descriptions.Item>
        <Descriptions.Item label="标签">{task?.tags || '-'}</Descriptions.Item>
        <Descriptions.Item label="每页数量">{task?.perPage || '-'}</Descriptions.Item>
        <Descriptions.Item label="并发数">{task?.concurrency || '-'}</Descriptions.Item>
        {session.currentPage && (
          <Descriptions.Item label="当前页面">
            {session.currentPage} / {session.totalPages || '?'}
          </Descriptions.Item>
        )}
        {session.startedAt && (
          <Descriptions.Item label="开始时间">
            {new Date(session.startedAt).toLocaleString()}
          </Descriptions.Item>
        )}
      </Descriptions>

      {stats && (
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 8 }}>
            <Space>
              <span>进度: {stats.completed} / {stats.total}</span>
              {stats.failed > 0 && (
                <Tag color="error">失败: {stats.failed}</Tag>
              )}
              {stats.pending > 0 && (
                <Tag color="default">等待: {stats.pending}</Tag>
              )}
            </Space>
          </div>
          <Progress
            percent={progress}
            status={session.status === 'failed' ? 'exception' : 'active'}
            strokeColor={
              session.status === 'completed' 
                ? '#52c41a' 
                : session.status === 'failed' 
                ? '#ff4d4f' 
                : undefined
            }
          />
        </div>
      )}

      {session.status === 'dryRun' && (
        <div style={{ marginTop: 16, color: '#1890ff' }}>
          正在扫描页面 {session.currentPage}...
        </div>
      )}

      {session.error && (
        <div style={{ marginTop: 16 }}>
          <Tag color="error">错误: {session.error}</Tag>
        </div>
      )}

      {/* 详情弹窗 */}
      <Modal
        title={null}
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width="90%"
        style={{ maxWidth: '1200px' }}
        destroyOnHidden
      >
        <BulkDownloadSessionDetail
          session={session}
          onClose={() => setDetailVisible(false)}
          onRefresh={() => {
            loadStats();
            onRefresh();
          }}
        />
      </Modal>
    </Card>
  );
};

