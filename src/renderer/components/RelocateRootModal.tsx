import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Button, Input, Space, Alert, Table, Popconfirm, Collapse, Tag, Tooltip, message } from 'antd';
import { FolderOpenOutlined, PlusOutlined, DeleteOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { spacing, colors, fontSize } from '../styles/tokens';

/**
 * RelocateRootModal
 *
 * Phase 7A 跨机器迁移维护入口：当图库的物理文件随库一起搬到新位置后，
 * 把旧路径前缀整体改写为新前缀（无损、不重扫）。
 *
 * 交互（用户反馈后重做）：
 * 1. 主体是「丢失文件夹修复清单」——打开时自动检测磁盘上已不存在的绑定文件夹，
 *    逐项列出（旧路径只读 + 小字标注归属相册），右侧为每项选择新位置；
 *    换机后旧路径在本机选不到，所以左侧不需要任何输入/选择。
 * 2. 推断传播：给一项选完新位置后，其余同根项按公共前缀自动推断新位置
 *    （标「推断」，可改可清）——整库搬迁场景选一次即可全部填好。
 * 3. 「应用」只提交已选择新位置的项；未选的项原样保留，下次再处理。
 *    应用内置预检：未预览/预览过期时先自动预检，发现路径冲突则中止并展示明细。
 * 4. 手动前缀映射保留在「高级」折叠区（无丢失项时自动展开，作为唯一工具）。
 *
 * 本组件通过 props 注入 onPreview / onApply / onPickFolder / onLoadMissingFolders，
 * 自身不直接触达 electronAPI，便于复用与测试；SettingsPage 负责接线。
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

/** 丢失文件夹修复清单的一行 */
interface MissingItem {
  galleryId: number;
  galleryName: string;
  oldPath: string;
  /** 用户已选（或推断出）的新位置；空串 = 未选择，应用时跳过该项 */
  newPath: string;
  /** true = 值来自推断传播而非用户手选；手选会覆盖推断，推断不覆盖手选 */
  inferred: boolean;
}

interface Props {
  open: boolean;
  onCancel: () => void;
  onPreview: (mappings: RelocateMapping[]) => Promise<{ success: boolean; data?: PreviewResult; error?: string }>;
  onApply: (mappings: RelocateMapping[]) => Promise<{ success: boolean; data?: { affected: PreviewAffected[] }; error?: string }>;
  /** 新位置一律经系统目录选择器选取（保证磁盘上存在），不提供自由文本输入 */
  onPickFolder: () => Promise<string | undefined>;
  /**
   * 可选：加载磁盘上已不存在的绑定文件夹（gallery.getMissingGalleryFolders）。
   * 提供后弹窗打开时自动生成修复清单；未提供/失败/为空时仅展示高级前缀映射。
   */
  onLoadMissingFolders?: () => Promise<Array<{ galleryId: number; folderPath: string; galleryName?: string }>>;
}

/** 过滤出 old/new 都非空的有效映射（trim 后） */
function sanitizeMappings(rows: RelocateMapping[]): RelocateMapping[] {
  return rows
    .map(r => ({ oldPrefix: r.oldPrefix.trim(), newPrefix: r.newPrefix.trim() }))
    .filter(r => r.oldPrefix.length > 0 && r.newPrefix.length > 0);
}

/**
 * 路径的绝对前缀形态：UNC（`\\server\share`）返回双分隔符、POSIX 绝对路径返回单分隔符、
 * Windows 盘符路径返回空串（盘符本身保留在分段首段里）；相对路径返回 null。
 */
function absolutePrefixOf(p: string, sep: string): string | null {
  if (/^[\\/]{2}/.test(p)) return sep + sep;
  if (/^[\\/]/.test(p)) return sep;
  if (/^[a-zA-Z]:/.test(p)) return '';
  return null;
}

/**
 * 推断传播：用户把 pickedOld 重定位到 pickedNew 后，推断另一条丢失路径 otherOld 的新位置。
 *
 * 取 pickedOld 与 pickedNew 的段级最长公共后缀（大小写不敏感，win32 语义），
 * 剩余部分即隐含的前缀映射 oldRoot → newRoot；otherOld 若以 oldRoot 开头，
 * 则新位置 = newRoot + 其余段。推断不出（不同根/无公共后缀）返回 null。
 *
 * 例：pickedOld=D:\pics\a, pickedNew=E:\newpics\a ⇒ 映射 D:\pics → E:\newpics，
 *     otherOld=D:\pics\b ⇒ E:\newpics\b。
 *
 * 分段用的 split 会吞掉 UNC（\\NAS\share）与 POSIX（/mnt）的前导分隔符，重组时必须
 * 按 pickedNew 的绝对前缀形态回贴——否则 NAS 场景推断出 `NAS\share\b` 这种相对形态坏值，
 * 应用后会把垃圾前缀写进库内 5 张表的路径列。pickedNew 若是相对路径（系统目录对话框
 * 不会返回，防御性拦截）直接拒绝推断，让用户手选。
 */
function inferNewPath(pickedOld: string, pickedNew: string, otherOld: string): string | null {
  const sep = pickedNew.includes('\\') ? '\\' : '/';
  const newPrefix = absolutePrefixOf(pickedNew, sep);
  if (newPrefix === null) return null;
  const po = pickedOld.split(/[\\/]+/).filter(Boolean);
  const pn = pickedNew.split(/[\\/]+/).filter(Boolean);
  const oo = otherOld.split(/[\\/]+/).filter(Boolean);

  // 段级最长公共后缀；两侧各保留至少一段作为根（盘符也算一段）
  let suffix = 0;
  while (
    suffix < po.length - 1 &&
    suffix < pn.length - 1 &&
    po[po.length - 1 - suffix].toLowerCase() === pn[pn.length - 1 - suffix].toLowerCase()
  ) {
    suffix++;
  }

  const oldRoot = po.slice(0, po.length - suffix);
  const newRoot = pn.slice(0, pn.length - suffix);
  if (oldRoot.length === 0 || newRoot.length === 0) return null;
  if (oo.length < oldRoot.length) return null;
  for (let i = 0; i < oldRoot.length; i++) {
    if (oo[i].toLowerCase() !== oldRoot[i].toLowerCase()) return null;
  }

  return newPrefix + [...newRoot, ...oo.slice(oldRoot.length)].join(sep);
}

export const RelocateRootModal: React.FC<Props> = ({ open, onCancel, onPreview, onApply, onPickFolder, onLoadMissingFolders }) => {
  // 丢失文件夹修复清单（主交互）
  const [missingItems, setMissingItems] = useState<MissingItem[]>([]);
  const [missingLoaded, setMissingLoaded] = useState(false);
  // 高级：手动前缀映射（折叠区）
  const [advancedRows, setAdvancedRows] = useState<RelocateMapping[]>([{ oldPrefix: '', newPrefix: '' }]);
  const [advancedOpen, setAdvancedOpen] = useState<string[]>([]);

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  // 预览所针对的映射快照（JSON）。一旦当前映射与之不同，预览结果作废（应用会自动重新预检）。
  const [previewedSignature, setPreviewedSignature] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);

  // 调用方通常传内联箭头函数（每次渲染新引用），经 ref 消引用避免打开期间反复重拉
  const loadMissingRef = useRef(onLoadMissingFolders);
  loadMissingRef.current = onLoadMissingFolders;

  // 打开时重置状态并加载丢失文件夹清单
  useEffect(() => {
    if (!open) return;
    setMissingItems([]);
    setMissingLoaded(false);
    setAdvancedRows([{ oldPrefix: '', newPrefix: '' }]);
    setAdvancedOpen([]);
    setPreview(null);
    setPreviewedSignature(null);
    setPreviewing(false);
    setApplying(false);

    const load = loadMissingRef.current;
    if (!load) {
      setMissingLoaded(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await load();
        if (cancelled) return;
        // getMissingGalleryFolders 直接返回裸数组（非 {success} 包裹），可能 throw → 兜底为空
        const items = (Array.isArray(rows) ? rows : [])
          .filter(r => Boolean(r?.folderPath))
          .map(r => ({
            galleryId: r.galleryId,
            galleryName: r.galleryName ?? '',
            oldPath: r.folderPath,
            newPath: '',
            inferred: false,
          }))
          .sort((a, b) => a.oldPath.localeCompare(b.oldPath));
        setMissingItems(items);
      } catch (err) {
        console.warn('[RelocateRootModal] 加载丢失文件夹清单失败:', err);
      } finally {
        if (!cancelled) setMissingLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // 无丢失项时高级前缀映射是唯一工具，自动展开
  useEffect(() => {
    if (open && missingLoaded && missingItems.length === 0) {
      setAdvancedOpen(['advanced']);
    }
  }, [open, missingLoaded, missingItems.length]);

  // 应用/预览的映射 = 修复清单中已选新位置的项 + 高级区有效映射
  const mappings = useMemo(() => {
    const fromMissing = missingItems
      .filter(it => it.newPath.trim().length > 0)
      .map(it => ({ oldPrefix: it.oldPath, newPrefix: it.newPath.trim() }));
    return [...fromMissing, ...sanitizeMappings(advancedRows)];
  }, [missingItems, advancedRows]);
  const currentSignature = useMemo(() => JSON.stringify(mappings), [mappings]);

  // 预览结果是否仍对应当前映射
  const previewFresh = previewedSignature !== null && previewedSignature === currentSignature;
  const hasCollisions = (preview?.collisions.length ?? 0) > 0;
  // 仅大小写差异提示不阻断应用（canApply 不受其影响）
  const caseWarnings = preview?.warnings ?? [];
  // 有映射即可应用（应用内置预检）；仅当"新鲜预览已知有碰撞"时禁用
  const canApply = mappings.length > 0 && !applying && !(previewFresh && hasCollisions);

  // ---- 修复清单交互 ----

  const pickNewLocation = async (index: number) => {
    const picked = await onPickFolder();
    if (!picked) return;
    setMissingItems(prev => {
      const target = prev[index];
      if (!target) return prev;
      return prev.map((it, i) => {
        if (i === index) return { ...it, newPath: picked, inferred: false };
        // 推断传播：只填空值或此前推断的行，绝不覆盖用户手选
        if (it.newPath && !it.inferred) return it;
        const inferredPath = inferNewPath(target.oldPath, picked, it.oldPath);
        return inferredPath ? { ...it, newPath: inferredPath, inferred: true } : it;
      });
    });
  };

  const clearNewLocation = (index: number) => {
    setMissingItems(prev => prev.map((it, i) => (i === index ? { ...it, newPath: '', inferred: false } : it)));
  };

  // ---- 高级前缀映射交互 ----

  const updateAdvancedRow = (index: number, patch: Partial<RelocateMapping>) => {
    setAdvancedRows(prev => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const addAdvancedRow = () => setAdvancedRows(prev => [...prev, { oldPrefix: '', newPrefix: '' }]);

  const removeAdvancedRow = (index: number) => {
    setAdvancedRows(prev => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const pickIntoAdvanced = async (index: number, field: 'oldPrefix' | 'newPrefix') => {
    const picked = await onPickFolder();
    if (picked) updateAdvancedRow(index, { [field]: picked });
  };

  // ---- 预览 / 应用 ----

  const runPreview = async (): Promise<PreviewResult | null> => {
    const res = await onPreview(mappings);
    if (res.success && res.data) {
      setPreview(res.data);
      setPreviewedSignature(currentSignature);
      return res.data;
    }
    setPreview(null);
    setPreviewedSignature(null);
    message.error(res.error || '预览失败');
    return null;
  };

  const handlePreview = async () => {
    if (mappings.length === 0) {
      message.warning('请先为丢失文件夹选择新位置（或填写高级映射）');
      return;
    }
    setPreviewing(true);
    try {
      await runPreview();
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
      // 内置预检：未预览或预览已过期时先自动预检一次，兑现"预览说无冲突则应用必成功"
      let previewData = previewFresh ? preview : null;
      if (!previewData) {
        previewData = await runPreview();
        if (!previewData) return;
        if (previewData.collisions.length > 0) {
          message.error('存在路径冲突，未执行重定位，请查看冲突明细');
          return;
        }
      }
      const res = await onApply(mappings);
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

  const advancedEditor = (
    <Space direction="vertical" size={spacing.sm} style={{ width: '100%' }}>
      <div style={{ fontSize: fontSize.sm, color: colors.textSecondary }}>
        按前缀批量改写：库内所有以「旧前缀」开头的路径整体替换为「新前缀」（含未丢失的路径）。
      </div>
      {advancedRows.map((row, index) => (
        <div key={index} style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
          <Input
            placeholder="旧路径前缀，例如 D:/old/pics"
            value={row.oldPrefix}
            onChange={e => updateAdvancedRow(index, { oldPrefix: e.target.value })}
          />
          <Tooltip title="选择旧路径前缀">
            <Button icon={<FolderOpenOutlined />} onClick={() => void pickIntoAdvanced(index, 'oldPrefix')} />
          </Tooltip>
          <span style={{ color: colors.textTertiary }}>→</span>
          <Input
            placeholder="新路径前缀，例如 E:/new/pics"
            value={row.newPrefix}
            onChange={e => updateAdvancedRow(index, { newPrefix: e.target.value })}
          />
          <Tooltip title="选择新路径前缀">
            <Button icon={<FolderOpenOutlined />} onClick={() => void pickIntoAdvanced(index, 'newPrefix')} />
          </Tooltip>
          <Tooltip title="删除该映射">
            <Button
              icon={<DeleteOutlined />}
              danger
              disabled={advancedRows.length <= 1}
              onClick={() => removeAdvancedRow(index)}
            />
          </Tooltip>
        </div>
      ))}
      <Button icon={<PlusOutlined />} type="dashed" onClick={addAdvancedRow} style={{ width: '100%' }}>
        添加映射
      </Button>
    </Space>
  );

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title="重定位根目录"
      width={760}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button onClick={handlePreview} loading={previewing}>预览</Button>
          {/* 应用是破坏性操作（改写数据库路径），二次确认；只提交已选择新位置的项 */}
          <Popconfirm
            title="确认重定位"
            description="该操作会改写数据库中的图库与图片路径（仅已选择新位置的项），请确保物理文件已搬到新位置。"
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
        message="跨机器迁移：文件随库一起搬到新位置后，为丢失的文件夹选择新位置，路径无损改写、不重扫。"
      />

      {missingItems.length > 0 && (
        <div style={{ marginBottom: spacing.md }}>
          <div style={{ fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: spacing.sm }}>
            检测到 {missingItems.length} 个丢失的绑定文件夹（磁盘上不存在），为它们选择新位置；
            选完一项后同根的其它项会自动推断，可修改或清除：
          </div>
          <Space direction="vertical" size={spacing.xs} style={{ width: '100%' }}>
            {missingItems.map((item, index) => (
              <div
                key={item.oldPath}
                style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: colors.danger, wordBreak: 'break-all', fontSize: fontSize.sm }}>
                    {item.oldPath}
                  </div>
                  <div style={{ color: colors.textTertiary, fontSize: fontSize.xs }}>
                    相册：{item.galleryName || '未知'}
                  </div>
                </div>
                <span style={{ color: colors.textTertiary }}>→</span>
                <Input
                  readOnly
                  value={item.newPath}
                  placeholder="未选择新位置（应用时跳过）"
                  style={{ flex: 1 }}
                  suffix={item.inferred ? <Tag color="blue" style={{ marginRight: 0 }}>推断</Tag> : undefined}
                />
                <Tooltip title="选择新位置">
                  <Button aria-label="选择新位置" icon={<FolderOpenOutlined />} onClick={() => void pickNewLocation(index)} />
                </Tooltip>
                <Tooltip title="清除">
                  <Button
                    aria-label="清除"
                    icon={<CloseCircleOutlined />}
                    disabled={!item.newPath}
                    onClick={() => clearNewLocation(index)}
                  />
                </Tooltip>
              </div>
            ))}
          </Space>
        </div>
      )}

      {missingLoaded && missingItems.length === 0 && (
        <div style={{ fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: spacing.md }}>
          未检测到丢失的绑定文件夹；如需按前缀批量改写路径，使用下方高级映射。
        </div>
      )}

      <Collapse
        ghost
        activeKey={advancedOpen}
        onChange={keys => setAdvancedOpen(Array.isArray(keys) ? (keys as string[]) : [keys as string])}
        items={[{ key: 'advanced', label: '高级：手动前缀映射（可选）', children: advancedEditor }]}
      />

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
