/**
 * 批量下载页面
 * 参考：Boorusama bulk_download_page.dart
 * 功能：
 * - 显示活跃的批量下载会话
 * - 创建新的批量下载任务
 * - 管理批量下载会话（启动、暂停、取消、删除）
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Card, Button, Space, App, Modal, Empty, Spin, List, Popconfirm, Tag, Divider, Tabs } from 'antd';
import { 
  DownloadOutlined, 
  PlusOutlined,
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  HistoryOutlined,
  ThunderboltOutlined
} from '@ant-design/icons';
import { BulkDownloadSession, BulkDownloadOptions, BooruSite, BulkDownloadTask } from '../../shared/types';
import { BulkDownloadTaskForm } from '../components/BulkDownloadTaskForm';
import { BulkDownloadSessionCard } from '../components/BulkDownloadSessionCard';

interface BooruBulkDownloadPageProps {
  active?: boolean;
}

export const BooruBulkDownloadPage: React.FC<BooruBulkDownloadPageProps> = ({ active = true }) => {
  const { message } = App.useApp();
  const [sessions, setSessions] = useState<BulkDownloadSession[]>([]);
  const [tasks, setTasks] = useState<BulkDownloadTask[]>([]);
  const [sites, setSites] = useState<BooruSite[]>([]);
  const [loading, setLoading] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<BulkDownloadTask | undefined>(undefined);
  const [activeSessionTab, setActiveSessionTab] = useState('active');

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

  // 根据 startSession 的返回值决定是否弹 "已加入队列" 提示。
  //
  // 历史实现是在 startSession 成功后再调用 getActiveSessions 查 status：
  //   - race：查询时 promoteNextQueued 可能已经把该 session 从 queued 推到
  //     pending/dryRun，UI 漏弹提示；
  //   - queued 幂等 noop 分支静默返回 {success:true}，UI 无法区分是否 noop。
  //
  // 现在直接读 startSession 返回的 queued 标记，去掉了中间这次查询。
  const notifyIfQueued = (startResult: { success: boolean; queued?: boolean; error?: string }) => {
    if (startResult.queued === true) {
      message.info('已加入队列，等待其他下载完成');
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

  // 下载恢复已移至 init.ts，程序启动时自动后台恢复，无需手动触发
  useEffect(() => {
    if (!active) {
      return;
    }

    loadSessions();
    loadTasks();
    loadSites();
  }, [active]);

  // 分离活跃会话和历史会话
  const { activeSessions, historySessions } = useMemo(() => {
    const active = sessions.filter(s =>
      s.status === 'pending' ||
      s.status === 'queued' ||
      s.status === 'dryRun' ||
      s.status === 'running' ||
      s.status === 'paused'
    );
    const history = sessions.filter(s =>
      s.status === 'completed' ||
      s.status === 'failed' ||
      s.status === 'cancelled' ||
      s.status === 'allSkipped'
    );
    return { activeSessions: active, historySessions: history };
  }, [sessions]);

  // 定期刷新会话状态（仅在存在活跃会话时刷新）
  useEffect(() => {
    if (!active) {
      return;
    }

    // 如果没有活跃会话，不设置定时器
    if (activeSessions.length === 0) {
      return;
    }

    // 定期刷新会话状态（页面不可见时暂停轮询）
    let interval: NodeJS.Timeout | null = setInterval(loadSessions, 5000);
    const handleVisibility = () => {
      if (document.hidden) {
        if (interval) { clearInterval(interval); interval = null; }
      } else {
        if (!interval) { loadSessions(); interval = setInterval(loadSessions, 5000); }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [active, activeSessions.length]); // 当页面可见性或活跃会话数量变化时重新设置定时器

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
        // 1. 创建任务（成功就可以关闭对话框了）
        const createResult = await window.electronAPI.bulkDownload.createTask(options);
        if (!createResult.success || !createResult.data) {
          message.error('创建任务失败: ' + (createResult.error || '未知错误'));
          return;
        }

        // 去重检查：如果任务已存在，直接提示并关闭
        if (createResult.data.deduplicated) {
          message.info('任务已存在');
          setFormVisible(false);
          loadTasks();
          return;
        }

        const newTaskId = createResult.data.id;
        console.log('[BooruBulkDownloadPage] 任务创建成功，ID:', newTaskId);

        // 任务创建成功，立即关闭对话框
        message.success('任务创建成功，正在开始下载...');
        setFormVisible(false);
        loadTasks();

        // 2. 后台创建会话并启动（不阻塞用户界面）
        // 使用 try-catch 确保错误不会影响主流程
        (async () => {
          try {
            // 创建会话
            const sessionResult = await window.electronAPI.bulkDownload.createSession(newTaskId);
            if (!sessionResult.success || !sessionResult.data) {
              message.error('创建会话失败: ' + (sessionResult.error || '未知错误'));
              return;
            }

            const sessionId = sessionResult.data.id;
            console.log('[BooruBulkDownloadPage] 会话创建成功，ID:', sessionId);

            // 启动会话
            const startResult = await window.electronAPI.bulkDownload.startSession(sessionId);
            if (!startResult.success) {
              message.error('启动下载失败: ' + (startResult.error || '未知错误'));
              return;
            }

            console.log('[BooruBulkDownloadPage] 下载已启动');
            // 刷新会话列表
            loadSessions();
            // 若新会话因并发闸门被打成 queued，提示用户（直接读 startSession 返回值，无 race）
            notifyIfQueued(startResult);
          } catch (error) {
            console.error('[BooruBulkDownloadPage] 后台启动下载出错:', error);
            message.error('启动下载失败: ' + (error instanceof Error ? error.message : '未知错误'));
          }
        })();
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

      // 服务层去重：任务已有活跃会话（pending/queued/dryRun/running/paused），
      // 直接提示，不再调用 startSession，避免连续点击产生多条 queued 记录。
      if (sessionResult.deduplicated) {
        message.info('该任务已有进行中的下载会话');
        loadSessions();
        return;
      }

      const sessionId = sessionResult.data.id;
      message.success('会话创建成功，开始下载...');

      // ① 立即刷新一次，让 pending 状态的新会话卡片先出现，避免 dryRun 阻塞期间的空窗
      loadSessions();

      // ② startSession 内部要跑 dryRun，可能阻塞数秒；
      //   放到后台 IIFE，不阻塞 UI 事件处理函数
      (async () => {
        try {
          const startResult = await window.electronAPI!.bulkDownload.startSession(sessionId);
          if (!startResult.success) {
            message.error('启动下载失败: ' + (startResult.error || '未知错误'));
            return;
          }
          // ③ 成功后再刷一次，反映 running 状态
          loadSessions();
          // 若新会话因并发闸门被打成 queued，提示用户（直接读 startSession 返回值，无 race）
          notifyIfQueued(startResult);
        } catch (err) {
          console.error('启动下载失败:', err);
          message.error('启动下载失败');
        }
      })();
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
            {/* 会话列表（使用标签页区分活跃会话和历史会话） */}
            {(activeSessions.length > 0 || historySessions.length > 0) && (
              <>
                <Tabs
                  activeKey={activeSessionTab}
                  onChange={setActiveSessionTab}
                  items={[
                    {
                      key: 'active',
                      label: (
                        <span>
                          <ThunderboltOutlined />
                          活跃会话 ({activeSessions.length})
                        </span>
                      ),
                      children: activeSessions.length > 0 ? (
                        <Space direction="vertical" style={{ width: '100%' }} size="large">
                          {activeSessions.map(session => (
                            <BulkDownloadSessionCard
                              key={session.id}
                              session={session}
                              onRefresh={loadSessions}
                            />
                          ))}
                        </Space>
                      ) : (
                        <Empty description="暂无活跃会话" />
                      )
                    },
                    {
                      key: 'history',
                      label: (
                        <span>
                          <HistoryOutlined />
                          历史会话 ({historySessions.length})
                        </span>
                      ),
                      children: historySessions.length > 0 ? (
                        <Space direction="vertical" style={{ width: '100%' }} size="large">
                          {historySessions.map(session => (
                            <BulkDownloadSessionCard
                              key={session.id}
                              session={session}
                              onRefresh={loadSessions}
                            />
                          ))}
                        </Space>
                      ) : (
                        <Empty description="暂无历史会话" />
                      )
                    }
                  ]}
                />
                <Divider />
              </>
            )}

            {/* 已保存的任务列表 */}
            {tasks.length > 0 && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ margin: 0 }}>已保存的任务</h3>
                  <p style={{ color: 'rgba(60, 60, 67, 0.60)', marginTop: 8, marginBottom: 16 }}>
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
                          <Space key="actions" size={8}>
                            <Button
                              type="primary"
                              size="small"
                              icon={<PlayCircleOutlined />}
                              onClick={() => handleStartFromTask(task)}
                            >
                              开始
                            </Button>
                            <Button
                              size="small"
                              icon={<EditOutlined />}
                              onClick={() => handleEditTask(task)}
                            >
                              编辑
                            </Button>
                            <Popconfirm
                              title="确定要删除这个任务吗？"
                              onConfirm={() => handleDeleteTask(task.id)}
                              okText="确定"
                              cancelText="取消"
                            >
                              <Button
                                danger
                                size="small"
                                icon={<DeleteOutlined />}
                              />
                            </Popconfirm>
                          </Space>
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
        closable
        maskClosable
        keyboard
        onCancel={() => {
          setFormVisible(false);
          setEditingTask(undefined);
        }}
        footer={null}
        width={800}
        destroyOnHidden
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

