import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Table, Button, Input, Space, Tag, Popconfirm, Modal, Form, Select, Empty, Switch, App, Tooltip } from 'antd';
import { DeleteOutlined, PlusOutlined, StopOutlined, ImportOutlined, ExportOutlined, CheckCircleOutlined, CloseCircleOutlined, SearchOutlined } from '@ant-design/icons';
import type { BlacklistedTag } from '../../shared/types';
import { colors, spacing, radius, fontSize } from '../styles/tokens';
import { BatchTagAddModal } from '../components/BatchTagAddModal';
import { ImportTagsDialog } from '../components/ImportTagsDialog';

/**
 * 黑名单标签管理页面
 * 管理用户设置的黑名单标签，包含黑名单标签的图片在浏览时自动隐藏
 */
interface BlacklistedTagsPageProps {
  active?: boolean;
}

export const BlacklistedTagsPage: React.FC<BlacklistedTagsPageProps> = ({ active = true }) => {
  const { message } = App.useApp();
  const [blacklistedTags, setBlacklistedTags] = useState<BlacklistedTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [batchAddModalOpen, setBatchAddModalOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [sites, setSites] = useState<any[]>([]);
  const [filterSiteId, setFilterSiteId] = useState<number | undefined>(undefined);
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [preferencesHydrated, setPreferencesHydrated] = useState(false);
  const [preferencesHydrationVersion, setPreferencesHydrationVersion] = useState(0);
  const skipNextKeywordResetRef = useRef(false);
  const preferencesHydrationRunIdRef = useRef(0);
  const preferencesHydratingRef = useRef(false);
  const [form] = Form.useForm();

  // 搜索关键字防抖，避免每次按键都打服务端
  useEffect(() => {
    const t = setTimeout(() => setDebouncedKeyword(keyword), 300);
    return () => clearTimeout(t);
  }, [keyword]);

  // 加载黑名单标签列表（服务端分页 + 关键字搜索）
  const loadBlacklistedTags = useCallback(async () => {
    setLoading(true);
    try {
      const offset = (page - 1) * pageSize;
      const result = await window.electronAPI.booru.getBlacklistedTags({
        siteId: filterSiteId,
        keyword: debouncedKeyword.trim() || undefined,
        offset,
        limit: pageSize,
      });
      if (result.success && result.data) {
        setBlacklistedTags(result.data.items);
        setTotal(result.data.total);
        console.log('[BlacklistedTagsPage] 加载黑名单标签:', result.data.items.length, '/', result.data.total);
      } else {
        console.error('[BlacklistedTagsPage] 加载黑名单标签失败:', result.error);
      }
    } catch (error) {
      console.error('[BlacklistedTagsPage] 加载黑名单标签失败:', error);
      message.error('加载黑名单标签失败');
    } finally {
      setLoading(false);
    }
  }, [filterSiteId, debouncedKeyword, page, pageSize, message]);

  useEffect(() => {
    if (skipNextKeywordResetRef.current) {
      skipNextKeywordResetRef.current = false;
      return;
    }
    setPage(1);
  }, [debouncedKeyword]);

  // 加载站点列表
  const loadSites = useCallback(async () => {
    try {
      const result = await window.electronAPI.booru.getSites();
      if (result.success && result.data) {
        setSites(result.data);
      }
    } catch (error) {
      console.error('[BlacklistedTagsPage] 加载站点列表失败:', error);
    }
  }, []);

  useEffect(() => {
    if (!active) {
      setPreferencesHydrated(false);
      preferencesHydratingRef.current = false;
      return;
    }

    let cancelled = false;
    const runId = preferencesHydrationRunIdRef.current + 1;
    preferencesHydrationRunIdRef.current = runId;
    preferencesHydratingRef.current = true;
    setPreferencesHydrated(false);

    const loadPreferences = async () => {
      try {
        const result = await window.electronAPI.pagePreferences.blacklistedTags.get();
        if (!result.success || cancelled || preferencesHydrationRunIdRef.current !== runId) {
          return;
        }

        const preferences = result.data;
        if (preferences) {
          skipNextKeywordResetRef.current = Boolean(preferences.keyword !== undefined);
          setFilterSiteId(preferences.filterSiteId);
          setKeyword(preferences.keyword ?? '');
          setDebouncedKeyword(preferences.keyword ?? '');
          setPage(preferences.page ?? 1);
          setPageSize(preferences.pageSize ?? 20);
        }
      } catch (error) {
        console.error('[BlacklistedTagsPage] 加载页面偏好失败:', error);
      } finally {
        if (!cancelled && preferencesHydrationRunIdRef.current === runId) {
          preferencesHydratingRef.current = false;
          setPreferencesHydrated(true);
          setPreferencesHydrationVersion(runId);
        }
      }
    };

    loadPreferences();
    loadSites();

    return () => {
      cancelled = true;
      if (preferencesHydrationRunIdRef.current === runId) {
        preferencesHydratingRef.current = false;
      }
    };
  }, [active, loadSites]);

  useEffect(() => {
    if (!active || !preferencesHydrated || preferencesHydratingRef.current) {
      return;
    }
    loadBlacklistedTags();
  }, [active, preferencesHydrated, preferencesHydrationVersion, loadBlacklistedTags]);

  useEffect(() => {
    if (!active || !preferencesHydrated || preferencesHydratingRef.current) {
      return;
    }

    let cancelled = false;
    const hydrationVersionAtEffect = preferencesHydrationVersion;

    const savePreferences = async () => {
      try {
        if (cancelled || preferencesHydratingRef.current || hydrationVersionAtEffect !== preferencesHydrationRunIdRef.current) {
          return;
        }

        await window.electronAPI.pagePreferences.blacklistedTags.save({
          filterSiteId,
          keyword,
          page,
          pageSize,
        });
      } catch (error) {
        console.error('[BlacklistedTagsPage] 保存页面偏好失败:', error);
      }
    };

    savePreferences();

    return () => {
      cancelled = true;
    };
  }, [active, preferencesHydrated, preferencesHydrationVersion, filterSiteId, keyword, page, pageSize]);

  // 添加单个黑名单标签
  const handleAdd = async (values: any) => {
    try {
      const result = await window.electronAPI.booru.addBlacklistedTag(
        values.tagName.trim(),
        values.siteId ?? null,
        values.reason || undefined
      );
      if (result.success) {
        message.success(`已添加黑名单: ${values.tagName}`);
        setAddModalVisible(false);
        form.resetFields();
        loadBlacklistedTags();
      } else {
        message.error('添加失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BlacklistedTagsPage] 添加黑名单标签失败:', error);
      message.error('添加黑名单标签失败');
    }
  };

  // 删除黑名单标签
  const handleDelete = async (id: number) => {
    try {
      const result = await window.electronAPI.booru.removeBlacklistedTag(id);
      if (result.success) {
        message.success('已移除黑名单标签');
        loadBlacklistedTags();
      } else {
        message.error('移除失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BlacklistedTagsPage] 删除黑名单标签失败:', error);
      message.error('删除失败');
    }
  };

  // 切换激活状态
  const handleToggle = async (id: number) => {
    try {
      const result = await window.electronAPI.booru.toggleBlacklistedTag(id);
      if (result.success) {
        loadBlacklistedTags();
      } else {
        message.error('切换状态失败: ' + result.error);
      }
    } catch (error) {
      console.error('[BlacklistedTagsPage] 切换黑名单标签状态失败:', error);
      message.error('切换状态失败');
    }
  };

  // 获取站点名称
  const getSiteName = (siteId: number | null) => {
    if (siteId === null) return '全局';
    const site = sites.find(s => s.id === siteId);
    return site ? site.name : `站点 #${siteId}`;
  };

  // 统计信息（服务端分页后使用 total，而非仅当前页）
  const totalCount = total;

  // 表格列定义
  const columns = [
    {
      title: '标签名',
      dataIndex: 'tagName',
      key: 'tagName',
      render: (tagName: string, record: BlacklistedTag) => (
        <Tag
          color={record.isActive ? 'red' : 'default'}
          style={{ fontSize: '14px', padding: '2px 8px' }}
        >
          <StopOutlined style={{ marginRight: 4 }} />
          {tagName.replace(/_/g, ' ')}
        </Tag>
      )
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 100,
      render: (isActive: boolean, record: BlacklistedTag) => (
        <Tooltip title={isActive ? '点击禁用' : '点击启用'}>
          <Switch
            checked={isActive}
            onChange={() => handleToggle(record.id)}
            checkedChildren={<CheckCircleOutlined />}
            unCheckedChildren={<CloseCircleOutlined />}
            size="small"
          />
        </Tooltip>
      )
    },
    {
      title: '站点',
      dataIndex: 'siteId',
      key: 'siteId',
      width: 120,
      render: (siteId: number | null) => (
        <Tag color={siteId === null ? 'purple' : 'blue'}>
          {getSiteName(siteId)}
        </Tag>
      )
    },
    {
      title: '原因',
      dataIndex: 'reason',
      key: 'reason',
      width: 200,
      render: (reason: string | undefined) => reason || '-'
    },
    {
      title: '添加时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (date: string) => new Date(date).toLocaleString('zh-CN')
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_: any, record: BlacklistedTag) => (
        <Popconfirm
          title="确定移除此黑名单标签？"
          onConfirm={() => handleDelete(record.id)}
          okText="确定"
          cancelText="取消"
        >
          <Button type="text" danger size="small" icon={<DeleteOutlined />} />
        </Popconfirm>
      )
    }
  ];

  return (
    <div style={{ padding: spacing.xl }}>
      {/* 顶部统计和操作 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing.lg
      }}>
        <div>
          <span style={{ color: colors.textSecondary, fontSize: fontSize.md }}>
            共 {totalCount} 个黑名单标签
          </span>
        </div>
        <Space>
          <Select
            style={{ width: 160 }}
            placeholder="筛选站点"
            allowClear
            value={filterSiteId ?? '__all__'}
            onChange={(value: string | number) => {
              setFilterSiteId(value === '__all__' ? undefined : value as number);
              setPage(1);
            }}
          >
            <Select.Option value="__all__">全部站点</Select.Option>
            {sites.map(site => (
              <Select.Option key={site.id} value={site.id}>{site.name}</Select.Option>
            ))}
          </Select>
          <Input
            placeholder="搜索黑名单标签"
            allowClear
            prefix={<SearchOutlined />}
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
            style={{ width: 240 }}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setAddModalVisible(true)}
          >
            添加
          </Button>
          <Button
            icon={<ImportOutlined />}
            onClick={() => setBatchAddModalOpen(true)}
          >
            批量添加
          </Button>
          <Button
            icon={<ExportOutlined />}
            onClick={async () => {
              try {
                const result = await window.electronAPI.booru.exportBlacklistedTags(filterSiteId);
                if (result.success && result.data) {
                  message.success(`已导出 ${result.data.count} 个黑名单标签`);
                } else if (result.error !== '取消导出') {
                  message.error('导出失败: ' + result.error);
                }
              } catch (error) {
                message.error('导出失败');
              }
            }}
          >
            导出
          </Button>
          <Button icon={<ImportOutlined />} onClick={() => setImportDialogOpen(true)}>
            导入
          </Button>
        </Space>
      </div>

      {/* 标签列表 */}
      {total === 0 && !loading && !debouncedKeyword && filterSiteId === undefined ? (
        <Card style={{ borderRadius: radius.md }}>
          <Empty
            description="暂无黑名单标签"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setAddModalVisible(true)}
            >
              添加黑名单标签
            </Button>
          </Empty>
        </Card>
      ) : (
        <Card style={{ borderRadius: radius.md }} styles={{ body: { padding: 0 } }}>
          <Table
            dataSource={blacklistedTags}
            columns={columns}
            rowKey="id"
            loading={loading}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: ['20', '50', '100'],
              onChange: (p, ps) => { setPage(p); setPageSize(ps); },
            }}
            size="middle"
          />
        </Card>
      )}

      {/* 添加黑名单标签弹窗（单个） */}
      <Modal
        title="添加黑名单标签"
        open={addModalVisible}
        closable
        maskClosable
        keyboard
        onCancel={() => {
          setAddModalVisible(false);
          form.resetFields();
        }}
        footer={null}
        width={500}
        forceRender
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleAdd}
          initialValues={{ siteId: undefined }}
        >
          <Form.Item
            name="tagName"
            label="标签名"
            rules={[{ required: true, message: '请输入标签名' }]}
          >
            <Input placeholder="输入标签名，如: ugly_tag" />
          </Form.Item>

          <Form.Item name="siteId" label="适用站点">
            <Select placeholder="全局（所有站点）" allowClear>
              {sites.map(site => (
                <Select.Option key={site.id} value={site.id}>{site.name}</Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item name="reason" label="原因（可选）">
            <Input placeholder="添加黑名单的原因" />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                添加
              </Button>
              <Button onClick={() => {
                setAddModalVisible(false);
                form.resetFields();
              }}>
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 批量添加黑名单标签弹窗（使用共享组件） */}
      <BatchTagAddModal
        open={batchAddModalOpen}
        title="批量添加黑名单"
        sites={sites}
        extraField={{
          name: 'reason',
          label: '原因（可选）',
          placeholder: '例如: 不喜欢',
        }}
        onCancel={() => setBatchAddModalOpen(false)}
        onSubmit={async (values) => {
          const result = await window.electronAPI.booru.addBlacklistedTags(
            values.tagNames,
            values.siteId,
            values.extra || undefined
          );
          if (result.success && result.data) {
            message.success(`已添加 ${result.data.added} 个标签，跳过 ${result.data.skipped} 个`);
            setBatchAddModalOpen(false);
            loadBlacklistedTags();
          } else {
            message.error('添加失败: ' + result.error);
            throw new Error(result.error || 'failed');
          }
        }}
      />

      {/* 从文件导入黑名单（两阶段：pickFile + commit） */}
      <ImportTagsDialog
        open={importDialogOpen}
        title="导入黑名单"
        sites={sites}
        onCancel={() => setImportDialogOpen(false)}
        onPickFile={() => window.electronAPI.booru.importBlacklistedTagsPickFile()}
        onCommit={(payload) => window.electronAPI.booru.importBlacklistedTagsCommit(payload)}
        onImported={(result) => {
          message.success(`已导入 ${result.imported} 个标签，跳过 ${result.skipped} 个`);
          setImportDialogOpen(false);
          loadBlacklistedTags();
        }}
      />
    </div>
  );
};
