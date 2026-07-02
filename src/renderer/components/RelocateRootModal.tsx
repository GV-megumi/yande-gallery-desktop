import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Button, Input, Space, Alert, Table, Popconfirm, Tooltip, message } from 'antd';
import { FolderOpenOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { spacing, colors, fontSize } from '../styles/tokens';

/**
 * RelocateRootModal
 *
 * Phase 7A 跨机器迁移维护入口：当图库的物理文件随库一起搬到新位置后，
 * 把旧路径前缀整体改写为新前缀（无损、不重扫）。
 *
 * 流程：填写一条或多条 {oldPrefix → newPrefix} 映射 →「预览」拉取受影响的
 * (table,column) 计数、潜在路径碰撞与"仅大小写差异"提示 → 仅当无碰撞时才允许
 * 「应用」（带二次确认；大小写差异提示不阻断，仅建议用户统一大小写）。
 *
 * 本组件通过 props 注入 onPreview / onApply / onPickFolder，自身不直接触达
 * electronAPI，便于复用与测试；SettingsPage 负责把这些回调接到 gallery.* 与
 * system.selectFolder。
 */

export interface RelocateMapping {
  oldPrefix: string;
  newPrefix: string;
}

interface PreviewAffected {
  table: string;
  column: string;
  count: number;
}

interface PreviewCollision {
  table: string;
  column: string;
  path: string;
}

/** 非阻断提示：newPrefix 与库内既有路径前缀仅大小写不同（win32），建议统一大小写 */
interface PreviewWarning {
  table: string;
  column: string;
  newPrefix: string;
  existingPrefix: string;
  count: number;
}

interface PreviewResult {
  affected: PreviewAffected[];
  collisions: PreviewCollision[];
  /** 主进程 preview 一定返回该字段；标为可选是对旧调用方/测试注入的防御 */
  warnings?: PreviewWarning[];
}

interface Props {
  open: boolean;
  onCancel: () => void;
  onPreview: (mappings: RelocateMapping[]) => Promise<{ success: boolean; data?: PreviewResult; error?: string }>;
  onApply: (mappings: RelocateMapping[]) => Promise<{ success: boolean; data?: { affected: PreviewAffected[] }; error?: string }>;
  onPickFolder: () => Promise<string | undefined>;
}

/** 过滤出 old/new 都非空的有效映射（trim 后） */
function sanitizeMappings(rows: RelocateMapping[]): RelocateMapping[] {
  return rows
    .map(r => ({ oldPrefix: r.oldPrefix.trim(), newPrefix: r.newPrefix.trim() }))
    .filter(r => r.oldPrefix.length > 0 && r.newPrefix.length > 0);
}

export const RelocateRootModal: React.FC<Props> = ({ open, onCancel, onPreview, onApply, onPickFolder }) => {
  const [rows, setRows] = useState<RelocateMapping[]>([{ oldPrefix: '', newPrefix: '' }]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  // 预览所针对的映射快照（JSON）。一旦当前映射与之不同，预览结果作废，禁止应用。
  const [previewedSignature, setPreviewedSignature] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);

  // 打开时重置为初始单行
  useEffect(() => {
    if (!open) return;
    setRows([{ oldPrefix: '', newPrefix: '' }]);
    setPreview(null);
    setPreviewedSignature(null);
    setPreviewing(false);
    setApplying(false);
  }, [open]);

  const sanitized = useMemo(() => sanitizeMappings(rows), [rows]);
  const currentSignature = useMemo(() => JSON.stringify(sanitized), [sanitized]);

  // 预览结果是否仍对应当前映射
  const previewFresh = previewedSignature !== null && previewedSignature === currentSignature;
  const hasCollisions = (preview?.collisions.length ?? 0) > 0;
  // 仅大小写差异提示不阻断应用（canApply 不受其影响）
  const caseWarnings = preview?.warnings ?? [];
  const canApply = previewFresh && !hasCollisions && sanitized.length > 0 && !applying;

  const updateRow = (index: number, patch: Partial<RelocateMapping>) => {
    setRows(prev => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const addRow = () => setRows(prev => [...prev, { oldPrefix: '', newPrefix: '' }]);

  const removeRow = (index: number) => {
    setRows(prev => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const pickInto = async (index: number, field: 'oldPrefix' | 'newPrefix') => {
    const picked = await onPickFolder();
    if (picked) updateRow(index, { [field]: picked });
  };

  const handlePreview = async () => {
    if (sanitized.length === 0) {
      message.warning('请至少填写一条有效的路径映射');
      return;
    }
    setPreviewing(true);
    try {
      const res = await onPreview(sanitized);
      if (res.success && res.data) {
        setPreview(res.data);
        setPreviewedSignature(currentSignature);
      } else {
        setPreview(null);
        setPreviewedSignature(null);
        message.error(res.error || '预览失败');
      }
    } catch (err) {
      console.error('[RelocateRootModal] 预览失败:', err);
      setPreview(null);
      setPreviewedSignature(null);
      message.error('预览失败');
    } finally {
      setPreviewing(false);
    }
  };

  const handleApply = async () => {
    if (!canApply) return;
    setApplying(true);
    try {
      const res = await onApply(sanitized);
      if (res.success) {
        const total = (res.data?.affected ?? []).reduce((sum, a) => sum + a.count, 0);
        message.success(`已重定位：${total} 条路径`);
        onCancel();
      } else {
        message.error(res.error || '重定位失败');
      }
    } catch (err) {
      console.error('[RelocateRootModal] 应用失败:', err);
      message.error('重定位失败');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title="重定位根目录"
      width={720}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button onClick={handlePreview} loading={previewing}>预览</Button>
          {/* 应用是破坏性操作（改写数据库路径），二次确认 */}
          <Popconfirm
            title="确认重定位"
            description="该操作会改写数据库中的图库与图片路径，请确保物理文件已搬到新位置。"
            okText="继续重定位"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            disabled={!canApply}
            onConfirm={handleApply}
          >
            <Button type="primary" danger disabled={!canApply} loading={applying}>
              应用
            </Button>
          </Popconfirm>
        </Space>
      }
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: spacing.md }}
        message="跨机器迁移：文件随库一起搬到新位置后，把旧路径前缀整体改写为新前缀，无损、不重扫。"
      />

      <Space direction="vertical" size={spacing.sm} style={{ width: '100%' }}>
        {rows.map((row, index) => (
          <div key={index} style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
            <Input
              placeholder="旧路径前缀，例如 D:/old/pics"
              value={row.oldPrefix}
              onChange={e => updateRow(index, { oldPrefix: e.target.value })}
            />
            <Tooltip title="选择旧路径前缀">
              <Button icon={<FolderOpenOutlined />} onClick={() => void pickInto(index, 'oldPrefix')} />
            </Tooltip>
            <span style={{ color: colors.textTertiary }}>→</span>
            <Input
              placeholder="新路径前缀，例如 E:/new/pics"
              value={row.newPrefix}
              onChange={e => updateRow(index, { newPrefix: e.target.value })}
            />
            <Tooltip title="选择新路径前缀">
              <Button icon={<FolderOpenOutlined />} onClick={() => void pickInto(index, 'newPrefix')} />
            </Tooltip>
            <Tooltip title="删除该映射">
              <Button
                icon={<DeleteOutlined />}
                danger
                disabled={rows.length <= 1}
                onClick={() => removeRow(index)}
              />
            </Tooltip>
          </div>
        ))}
        <Button icon={<PlusOutlined />} type="dashed" onClick={addRow} style={{ width: '100%' }}>
          添加映射
        </Button>
      </Space>

      {preview && previewFresh && (
        <div style={{ marginTop: spacing.lg }}>
          <div style={{ fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: spacing.sm }}>
            预览结果（将影响以下路径）
          </div>
          <Table
            size="small"
            rowKey={r => `${r.table}.${r.column}`}
            pagination={false}
            dataSource={preview.affected}
            locale={{ emptyText: '无受影响路径' }}
            columns={[
              { title: '表', dataIndex: 'table', key: 'table' },
              { title: '列', dataIndex: 'column', key: 'column' },
              { title: '受影响条数', dataIndex: 'count', key: 'count' },
            ]}
          />
          {hasCollisions && (
            <Alert
              type="error"
              showIcon
              style={{ marginTop: spacing.md }}
              message="存在路径冲突，无法应用"
              description={
                <div>
                  改写后以下目标路径与现有记录冲突，请调整映射后重试：
                  <ul style={{ margin: `${spacing.xs}px 0 0`, paddingLeft: spacing.lg }}>
                    {preview.collisions.map((c, i) => (
                      <li key={i} style={{ wordBreak: 'break-all' }}>
                        {c.path}（{c.table}.{c.column}）
                      </li>
                    ))}
                  </ul>
                </div>
              }
            />
          )}
          {caseWarnings.length > 0 && (
            // 非阻断提示：Windows 文件系统不区分大小写，但库内路径匹配按字节精确比较；
            // 新前缀与既有路径仅大小写不同时，应用后同一物理目录会出现两种大小写形态
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: spacing.md }}
              message="库内存在与新前缀仅大小写不同的路径（不阻断应用）"
              description={
                <div>
                  建议把新前缀的大小写改成与库内既有路径一致，避免应用后同一物理目录出现两种大小写形态：
                  <ul style={{ margin: `${spacing.xs}px 0 0`, paddingLeft: spacing.lg }}>
                    {caseWarnings.map((w, i) => (
                      <li key={i} style={{ wordBreak: 'break-all' }}>
                        新前缀 {w.newPrefix} ↔ 既有 {w.existingPrefix}（{w.table}.{w.column}，{w.count} 行）
                      </li>
                    ))}
                  </ul>
                </div>
              }
            />
          )}
        </div>
      )}
    </Modal>
  );
};
