/**
 * 批量下载页面
 * 参考：Boorusama bulk_download_page.dart
 * 功能：
 * - 显示活跃的批量下载会话
 * - 创建新的批量下载任务
 * - 管理批量下载会话（启动、暂停、取消、删除）
 */

import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { Card, Button, Space, App, Modal, Empty, Spin, List, Popconfirm, Tag, Tabs, Tooltip } from 'antd';
import {
  DownloadOutlined,
  PlusOutlined,
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  HistoryOutlined,
  ThunderboltOutlined,
  SaveOutlined
} from '@ant-design/icons';
import { BulkDownloadSession, BulkDownloadOptions, BooruSite, BulkDownloadTask } from '../../shared/types';
import { BulkDownloadTaskForm } from '../components/BulkDownloadTaskForm';
import { BulkDownloadSessionCard } from '../components/BulkDownloadSessionCard';
import { useRendererAppEvent } from '../hooks/useRendererAppEvent';

interface BooruBulkDownloadPageProps {
  active?: boolean;
}

// 刷新防抖：trailing 200ms 合并密集事件；maxWait 1000ms 兜底。
// records-changed 在每个文件完成/失败时都会触发，小文件 + 高并发（跳过风暴）下
// 事件间隔可能持续小于 200ms，纯 trailing 防抖会被不断重置而"饿死"——
// 风暴期间列表始终不刷新。maxWait 保证从第一次挂起的刷新算起，最多等 1000ms 必定执行一次。
const REFRESH_DEBOUNCE_MS = 200;
const REFRESH_MAX_WAIT_MS = 1000;

export const BooruBulkDownloadPage: React.FC<BooruBulkDownloadPageProps> = ({ active = true }) => {
  const { message } = App.useApp();
  const [sessions, setSessions] = useState<BulkDownloadSession[]>([]);
  const [tasks, setTasks] = useState<BulkDownloadTask[]>([]);
  const [sites, setSites] = useState<BooruSite[]>([]);
  const [loading, setLoading] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<BulkDownloadTask | undefined>(undefined);
  const [activeSessionTab, setActiveSessionTab] = useState('active');
  const activeRef = useRef(active);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshNeedsTasksRef = useRef(false);
  // 本轮防抖窗口内第一次挂起刷新的时间戳（null 表示当前没有挂起的刷新），用于 maxWait 判定
  const refreshFirstPendingAtRef = useRef<number | null>(null);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // 加载活跃会话
  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.bulkDownload.getActiveSessions();
      if (result.success && result.data) {
        if (activeRef.current) {
          setSessions(result.data);
        }
      } else {
        message.error('加载会话失败: ' + (result.error || '未知错误'));
      }
    } catch (error) {
      console.error('加载会话失败:', error);
      message.error('加载会话失败');
    } finally {
      if (activeRef.current) {
        setLoading(false);
      }
    }
  }, [message]);

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
  const loadTasks = useCallback(async () => {
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.bulkDownload.getTasks();
      if (result.success && result.data) {
        if (activeRef.current) {
          setTasks(result.data);
        }
      } else {
        console.error('加载任务失败:', result.error);
      }
    } catch (error) {
      console.error('加载任务失败:', error);
    }
  }, []);

  // 加载站点列表
  const loadSites = useCallback(async () => {
    try {
      if (!window.electronAPI) return;

      const result = await window.electronAPI.booru.getSites();
      if (result.success && result.data) {
        if (activeRef.current) {
          setSites(result.data);
        }
      }
    } catch (error) {
      console.error('加载站点失败:', error);
    }
  }, []);

  const scheduleRefresh = useCallback((withTasks: boolean) => {
    refreshNeedsTasksRef.current = refreshNeedsTasksRef.current || withTasks;

    // 执行刷新并复位防抖状态（trailing 定时器触发与 maxWait 强制 flush 共用）
    const flush = () => {
      const shouldLoadTasks = refreshNeedsTasksRef.current;
      refreshTimerRef.current = null;
      refreshNeedsTasksRef.current = false;
      refreshFirstPendingAtRef.current = null;
      loadSessions();
      if (shouldLoadTasks) {
        loadTasks();
      }
    };

    const now = Date.now();
    if (refreshFirstPendingAtRef.current === null) {
      // 新一轮防抖窗口：记录第一次挂起刷新的时间
      refreshFirstPendingAtRef.current = now;
    } else if (now - refreshFirstPendingAtRef.current >= REFRESH_MAX_WAIT_MS) {
      // 持续不断的事件会一直重置 trailing 定时器；从第一次挂起算起超过 maxWait
      // 时不再重新计时，立即刷新，避免下载风暴期间列表长时间不更新（防抖饿死）
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      flush();
      return;
    }

    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = setTimeout(flush, REFRESH_DEBOUNCE_MS);
  }, [loadSessions, loadTasks]);

  useEffect(() => () => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    refreshNeedsTasksRef.current = false;
    refreshFirstPendingAtRef.current = null;
  }, []);

  // 下载恢复已移至 init.ts，程序启动时自动后台恢复，无需手动触发
  useEffect(() => {
    if (!active) {
      return;
    }

    loadSessions();
    loadTasks();
    loadSites();
  }, [active, loadSessions, loadSites, loadTasks]);

  useRendererAppEvent([
    'bulk-download:sessions-changed',
    'bulk-download:tasks-changed',
    'bulk-download:records-changed',
    'favorite-tag-download:created',
  ] as const, (event) => {
    if (event.type === 'bulk-download:sessions-changed') {
      scheduleRefresh(false);
      return;
    }
    if (event.type === 'bulk-download:tasks-changed') {
      scheduleRefresh(true);
      return;
    }
    if (event.type === 'bulk-download:records-changed') {
      scheduleRefresh(false);
      return;
    }
    if (event.type === 'favorite-tag-download:created') {
      scheduleRefresh(true);
    }
  }, { active, replayDirtyOnActive: false });

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
  }, [active, activeSessions.length, loadSessions]); // 当页面可见性或活跃会话数量变化时重新设置定时器

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

  // 页面内边距统一由 BooruDownloadHubPage 根容器提供，避免与 Segmented 切换栏错位
  return (
    <div>
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
        ) : (
          <Tabs
            activeKey={activeSessionTab}
            onChange={setActiveSessionTab}
            items={[
              {
                key: 'active',
                label: (
                  <span>
                    <ThunderboltOutlined />
                    活跃任务 ({activeSessions.length})
                  </span>
                ),
                children: activeSessions.length > 0 ? (
                  <Space direction="vertical" style={{ width: '100%' }} size="large">
                    {activeSessions.map(session => (
                      <BulkDownloadSessionCard
                        key={session.id}
                        session={session}
                        siteName={sites.find(s => s.id === session.siteId)?.name}
                        onRefresh={loadSessions}
                      />
                    ))}
                  </Space>
                ) : (
                  <Empty description="暂无活跃任务" />
                )
              },
              {
                key: 'history',
                label: (
                  <span>
                    <HistoryOutlined />
                    历史任务 ({historySessions.length})
                  </span>
                ),
                children: historySessions.length > 0 ? (
                  <Space direction="vertical" style={{ width: '100%' }} size="large">
                    {historySessions.map(session => (
                      <BulkDownloadSessionCard
                        key={session.id}
                        session={session}
                        siteName={sites.find(s => s.id === session.siteId)?.name}
                        onRefresh={loadSessions}
                      />
                    ))}
                  </Space>
                ) : (
                  <Empty description="暂无历史任务" />
                )
              },
              {
                key: 'saved',
                label: (
                  <span>
                    <SaveOutlined />
                    已保存任务 ({tasks.length})
                  </span>
                ),
                children: tasks.length > 0 ? (
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
                                {/* Tooltip 放在 Popconfirm 内层，避免两个浮层触发冲突 */}
                                <Tooltip title="删除任务">
                                  <Button
                                    danger
                                    size="small"
                                    icon={<DeleteOutlined />}
                                    aria-label="删除任务"
                                  />
                                </Tooltip>
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
                ) : (
                  <Empty description="暂无已保存任务" />
                )
              }
            ]}
          />
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

