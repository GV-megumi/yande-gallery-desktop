import React, { useMemo, useState } from 'react';
import { Modal, Select, Button, Alert, Space, Table } from 'antd';
import type {
  FavoriteTagImportRecord,
  BlacklistedTagImportRecord,
  ImportPickFileResult,
} from '../../shared/types';

/**
 * ImportTagsDialog
 *
 * 可复用的"从文件导入标签"对话框。收藏标签（FavoriteTags）和黑名单
 * 标签（BlacklistTags）都会用到，结构上都是两阶段：
 *
 *   A. pickSite - 先强制选择"兜底站点"（用于文件中未指定 siteId 的记录），
 *                 然后点"选择文件"触发 onPickFile（一般是 IPC 打开文件对话框）。
 *   B. preview  - 成功读取文件后，展示文件名 / 条数 / 预览表格，用户确认后
 *                 调用 onCommit 执行实际导入。
 *
 * 设计要点：
 *  - 泛型 <T extends AnyRecord> 让同一组件同时兼容收藏 / 黑名单两种记录类型。
 *  - 兜底 siteId：undefined 表示"未选择"（按钮禁用），null 表示"全局"，
 *    number 表示具体站点。这样才能区分"默认"和"用户确认的全局"。
 *  - Stage A / Stage B 通过 `stage` 状态切换，关闭对话框时 reset。
 *  - onPickFile / onCommit 都返回 { success, data, error } 形状，和 IPC
 *    调用的统一返回格式对齐，避免页面侧再做一层包装。
 */

type AnyRecord = FavoriteTagImportRecord | BlacklistedTagImportRecord;

export interface ImportTagsDialogProps<T extends AnyRecord = AnyRecord> {
  open: boolean;
  title: string;
  sites: Array<{ id: number; name: string }>;
  onCancel: () => void;
  onPickFile: () => Promise<{
    success: boolean;
    data?: ImportPickFileResult<T>;
    error?: string;
  }>;
  onCommit: (params: {
    records: T[];
    fallbackSiteId: number | null;
  }) => Promise<{
    success: boolean;
    data?: { imported: number; skipped: number };
    error?: string;
  }>;
  onImported: (result: { imported: number; skipped: number }) => void;
}

type Stage = 'pickSite' | 'preview';

export function ImportTagsDialog<T extends AnyRecord>({
  open,
  title,
  sites,
  onCancel,
  onPickFile,
  onCommit,
  onImported,
}: ImportTagsDialogProps<T>) {
  const [stage, setStage] = useState<Stage>('pickSite');
  // undefined = 未选择（按钮禁用），null = 全局，number = 具体站点
  const [fallbackSiteId, setFallbackSiteId] = useState<number | null | undefined>(undefined);
  const [fileName, setFileName] = useState<string>('');
  const [records, setRecords] = useState<T[]>([]);
  const [picking, setPicking] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStage('pickSite');
    setFallbackSiteId(undefined);
    setFileName('');
    setRecords([]);
    setError(null);
    setPicking(false);
    setCommitting(false);
  };

  const handleCancel = () => {
    if (committing) return;
    reset();
    onCancel();
  };

  const handlePickFile = async () => {
    setError(null);
    setPicking(true);
    try {
      const res = await onPickFile();
      if (!res.success) {
        setError(res.error || '选择文件失败');
        return;
      }
      if (!res.data || res.data.cancelled) {
        // 用户取消文件选择 —— 保持在阶段 A
        return;
      }
      setFileName(res.data.fileName || '');
      setRecords((res.data.records || []) as T[]);
      setStage('preview');
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setPicking(false);
    }
  };

  const handleCommit = async () => {
    setError(null);
    setCommitting(true);
    try {
      const res = await onCommit({
        records,
        fallbackSiteId: (fallbackSiteId ?? null) as number | null,
      });
      if (!res.success) {
        setError(res.error || '导入失败');
        return;
      }
      if (res.data) {
        onImported(res.data);
      }
      reset();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setCommitting(false);
    }
  };

  // 统计：文件里显式指定了 siteId 的条目 vs 需要使用兜底站点的条目
  const { withFileSiteId, usingFallback } = useMemo(() => {
    let a = 0;
    let b = 0;
    for (const r of records) {
      if (r.siteId !== undefined) a += 1;
      else b += 1;
    }
    return { withFileSiteId: a, usingFallback: b };
  }, [records]);

  const fallbackName =
    fallbackSiteId === null
      ? '全局'
      : sites.find(s => s.id === fallbackSiteId)?.name ?? '未选择';

  return (
    <Modal
      open={open}
      title={title}
      width={560}
      onCancel={handleCancel}
      footer={null}
      maskClosable={!committing}
      keyboard={!committing}
      destroyOnHidden
    >
      {error && (
        <Alert
          type="error"
          message={error}
          showIcon
          style={{ marginBottom: 12 }}
        />
      )}

      {stage === 'pickSite' && (
        <div>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="未指定 siteId 的记录将被分配到所选站点。文件中显式包含 siteId 的记录会保留其原值。"
          />
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 6 }}>兜底站点</label>
            <Select
              style={{ width: '100%' }}
              placeholder="必须选择"
              value={fallbackSiteId as any}
              onChange={v => setFallbackSiteId(v)}
              options={[
                { label: '全局', value: null },
                ...sites.map(s => ({ label: s.name, value: s.id })),
              ]}
            />
          </div>
          <Space style={{ marginTop: 8 }}>
            <Button onClick={handleCancel}>取消</Button>
            <Button
              type="primary"
              loading={picking}
              disabled={fallbackSiteId === undefined}
              onClick={handlePickFile}
            >
              选择文件
            </Button>
          </Space>
        </div>
      )}

      {stage === 'preview' && (
        <div>
          <Alert
            type="success"
            showIcon
            style={{ marginBottom: 12 }}
            message={`已读取文件 ${fileName}`}
            description={`将导入 ${records.length} 条标签（其中 ${withFileSiteId} 条来自文件自带 siteId，${usingFallback} 条使用兜底站点 "${fallbackName}"）`}
          />
          <div
            style={{
              maxHeight: 280,
              overflow: 'auto',
              border: '1px solid #f0f0f0',
              borderRadius: 4,
              marginBottom: 12,
            }}
          >
            <Table
              size="small"
              rowKey={(r: any, idx) => `${r.tagName}-${idx}`}
              pagination={false}
              dataSource={records.slice(0, 100) as any}
              columns={[
                { title: '标签', dataIndex: 'tagName', key: 'tagName' },
                {
                  title: '站点',
                  key: 'siteId',
                  render: (_, r: any) => {
                    const sid = r.siteId;
                    if (sid === undefined) {
                      return (
                        <span style={{ color: '#999' }}>
                          兜底: {fallbackName}
                        </span>
                      );
                    }
                    if (sid === null) return '全局';
                    return sites.find(s => s.id === sid)?.name ?? `#${sid}`;
                  },
                },
              ]}
            />
          </div>
          <Space>
            <Button onClick={() => setStage('pickSite')} disabled={committing}>
              返回
            </Button>
            <Button type="primary" loading={committing} onClick={handleCommit}>
              确认导入
            </Button>
          </Space>
        </div>
      )}
    </Modal>
  );
}
