/**
 * 批量下载页面
 * 参考：Boorusama bulk_download_page.dart
 * 功能：
 * - 显示活跃的批量下载会话
 * - 创建新的批量下载任务
 * - 管理批量下载会话（启动、暂停、取消、删除）
 */

import React, { useEffect, useState } from 'react';
import { Card, Button, Space, message, Modal, Empty, Spin, List, Popconfirm, Tag, Divider } from 'antd';
import { 
  DownloadOutlined, 
  PlusOutlined,
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
  PlayCircleOutlined
} from '@ant-design/icons';
import { BulkDownloadSession, BulkDownloadOptions, BooruSite, BulkDownloadTask } from '../../shared/types';
import { BulkDownloadTaskForm } from '../components/BulkDownloadTaskForm';
import { BulkDownloadSessionCard } from '../components/BulkDownloadSessionCard';

export const BooruBulkDownloadPage: React.FC = () => {
  const [sessions, setSessions] = useState<BulkDownloadSession[]>([]);
  const [tasks, setTasks] = useState<BulkDownloadTask[]>([]);
  const [sites, setSites] = useState<BooruSite[]>([]);
  const [loading, setLoading] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<BulkDownloadTask | undefined>(undefined);

  // 加载活跃会话
  const loadSessions = async () => {
    setLoading(true);
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.bulkDownload.getActiveSessions();
      if (result.success && result.data) {
        setSessions(result.data);
      } else {
        message.error('加载会话失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      console.error('加载会话失败:', error);
      message.error('加载会话失败');
    } finally {
      setLoading(false);
    }
  };

  // 加载已保存的任务
  const loadTasks = async () => {
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.bulkDownload.getTasks();
      if (result.success && result.data) {
        setTasks(result.data);
      } else {
        console.error('加载任务失败:', result.error);
      }
    } catch (error) {
      console.error('加载任务失败:', error);
    }
  };

  // 加载站点列表
  const loadSites = async () => {
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.booru.getSites();
      if (result.success && result.data) {
        setSites(result.data);
      }
    } catch (error) {
      console.error('加载站点失败:', error);
    }
  };

  useEffect(() => {
    loadSessions();
    loadTasks();
    loadSites();

    // 定期刷新会话状态
    const interval = setInterval(() => {
      loadSessions();
    }, 2000); // 每2秒刷新一次

    return () => clearInterval(interval);
  }, []);

  // 创建或更新任务
  const handleCreateOrUpdateTask = async (options: BulkDownloadOptions, taskId?: string) => {
    try {
      if (!window.electronAPI) return;

      if (taskId) {
        // 更新任务
        const updateResult = await window.electronAPI.bulkDownload.updateTask(taskId, options);
        if (!updateResult.success) {
          message.error('更新任务失败: ' + (updateResult.error || '未知错误'));
          return;
        }
        message.success('任务更新成功');
        setFormVisible(false);
        setEditingTask(undefined);
        loadTasks();
      } else {
        // 创建任务并启动会话
        const createResult = await window.electronAPI.bulkDownload.createTask(options);
        if (!createResult.success || !createResult.data) {
          message.error('创建任务失败: ' + (createResult.error || '未知错误'));
          return;
        }

        const newTaskId = createResult.data.id;
        message.success('任务创建成功');

        // 创建会话
        const sessionResult = await window.electronAPI.bulkDownload.createSession(newTaskId);
        if (!sessionResult.success || !sessionResult.data) {
          message.error('创建会话失败: ' + (sessionResult.error || '未知错误'));
          return;
        }

        const sessionId = sessionResult.data.id;
        message.success('会话创建成功，开始下载...');

        // 启动会话
        const startResult = await window.electronAPI.bulkDownload.startSession(sessionId);
        if (!startResult.success) {
          message.error('启动下载失败: ' + (startResult.error || '未知错误'));
          return;
        }

        setFormVisible(false);
        loadSessions();
        loadTasks();
      }
    } catch (error) {
      console.error('操作失败:', error);
      message.error('操作失败');
    }
  };

  // 从已保存的任务创建会话
  const handleStartFromTask = async (task: BulkDownloadTask) => {
    try {
      if (!window.electronAPI) return;

      const sessionResult = await window.electronAPI.bulkDownload.createSession(task.id);
      if (!sessionResult.success || !sessionResult.data) {
        message.error('创建会话失败: ' + (sessionResult.error || '未知错误'));
        return;
      }

      const sessionId = sessionResult.data.id;
      message.success('会话创建成功，开始下载...');

      const startResult = await window.electronAPI.bulkDownload.startSession(sessionId);
      if (!startResult.success) {
        message.error('启动下载失败: ' + (startResult.error || '未知错误'));
        return;
      }

      loadSessions();
    } catch (error) {
      console.error('启动任务失败:', error);
      message.error('启动任务失败');
    }
  };

  // 编辑任务
  const handleEditTask = (task: BulkDownloadTask) => {
    setEditingTask(task);
    setFormVisible(true);
  };

  // 删除任务
  const handleDeleteTask = async (taskId: string) => {
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.bulkDownload.deleteTask(taskId);
      if (result.success) {
        message.success('任务删除成功');
        loadTasks();
      } else {
        message.error('删除任务失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      console.error('删除任务失败:', error);
      message.error('删除任务失败');
    }
  };

  // 刷新会话
  const handleRefresh = () => {
    loadSessions();
  };

  return (
    <div style={{ padding: '24px' }}>
      <Card
        title={
          <Space>
            <DownloadOutlined />
            批量下载
          </Space>
        }
        extra={
          <Space>
            <Button 
              icon={<ReloadOutlined />} 
              onClick={handleRefresh}
              loading={loading}
            >
              刷新
            </Button>
            <Button 
              type="primary" 
              icon={<PlusOutlined />}
              onClick={() => setFormVisible(true)}
            >
              新建下载任务
            </Button>
          </Space>
        }
      >
        {loading && sessions.length === 0 && tasks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <Spin size="large" />
          </div>
        ) : sessions.length === 0 && tasks.length === 0 ? (
          <Empty 
            description="暂无活跃的批量下载会话和已保存的任务"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            <Button 
              type="primary" 
              icon={<PlusOutlined />}
              onClick={() => {
                setEditingTask(undefined);
                setFormVisible(true);
              }}
            >
              创建新的下载任务
            </Button>
          </Empty>
        ) : (
          <>
            {/* 活跃会话 */}
            {sessions.length > 0 && (
              <Space direction="vertical" style={{ width: '100%' }} size="large">
                {sessions.map(session => (
                  <BulkDownloadSessionCard
                    key={session.id}
                    session={session}
                    onRefresh={loadSessions}
                  />
                ))}
              </Space>
            )}

            {/* 已保存的任务列表 */}
            {tasks.length > 0 && (
              <>
                {sessions.length > 0 && <Divider />}
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ margin: 0 }}>已保存的任务</h3>
                  <p style={{ color: '#999', marginTop: 8, marginBottom: 16 }}>
                    点击"开始"按钮可以从已保存的任务创建新的下载会话
                  </p>
                </div>
                <List
                  dataSource={tasks}
                  renderItem={(task) => {
                    const site = sites.find(s => s.id === task.siteId);
                    return (
                      <List.Item
                        actions={[
                          <Button
                            key="start"
                            type="primary"
                            icon={<PlayCircleOutlined />}
                            onClick={() => handleStartFromTask(task)}
                          >
                            开始
                          </Button>,
                          <Button
                            key="edit"
                            icon={<EditOutlined />}
                            onClick={() => handleEditTask(task)}
                          >
                            编辑
                          </Button>,
                          <Popconfirm
                            key="delete"
                            title="确定要删除这个任务吗？"
                            onConfirm={() => handleDeleteTask(task.id)}
                            okText="确定"
                            cancelText="取消"
                          >
                            <Button
                              danger
                              icon={<DeleteOutlined />}
                            >
                              删除
                            </Button>
                          </Popconfirm>
                        ]}
                      >
                        <List.Item.Meta
                          title={
                            <Space>
                              <span>{site?.name || '未知站点'}</span>
                              <Tag>{task.tags}</Tag>
                            </Space>
                          }
                          description={
                            <Space direction="vertical" size={4}>
                              <span>路径: {task.path}</span>
                              <Space>
                                <span>每页: {task.perPage}</span>
                                <span>并发: {task.concurrency}</span>
                                {task.quality && <span>质量: {task.quality}</span>}
                              </Space>
                            </Space>
                          }
                        />
                      </List.Item>
                    );
                  }}
                />
              </>
            )}
          </>
        )}
      </Card>

      {/* 创建/编辑任务表单 */}
      <Modal
        title={editingTask ? '编辑批量下载任务' : '创建批量下载任务'}
        open={formVisible}
        onCancel={() => {
          setFormVisible(false);
          setEditingTask(undefined);
        }}
        footer={null}
        width={800}
        destroyOnClose
        key={editingTask?.id || 'create'} // 确保编辑不同任务时组件重新创建
      >
        <BulkDownloadTaskForm
          sites={sites}
          task={editingTask}
          onSubmit={handleCreateOrUpdateTask}
          onCancel={() => {
            setFormVisible(false);
            setEditingTask(undefined);
          }}
        />
      </Modal>
    </div>
  );
};

export default BooruBulkDownloadPage;

