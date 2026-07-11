import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Radio, Space, Typography, Alert, Button } from 'antd';
import { colors, spacing, fontSize, radius } from '../styles/tokens';

/**
 * ScanCollisionModal
 *
 * Phase 7A 扫描入库的同名碰撞解决弹窗。
 *
 * 当 gallery.planScanFolder 返回 collisions（待入库文件夹与已有相册重名）时，
 * 让用户逐行选择：把该文件夹「合并到已有相册」还是「新建独立相册」。
 * 顶部提供「全部合并 / 全部新建」快捷动作；同时只读展示本次将新增的
 * newFolders 数量与因 alreadyBound/ignored/noImages 被跳过的 skipped 数量。
 *
 * 本组件只负责收集决议并通过 onConfirm 回调把它交给上层（SettingsPage）去调用
 * gallery.applyScanPlan，自身不直接触达 electronAPI，便于复用与测试。
 */

export interface ScanPlanNewFolder {
  folderPath: string;
  name: string;
}

export interface ScanPlanCollision {
  folderPath: string;
  name: string;
  existingGalleryId: number;
  existingGalleryName: string;
}

export interface ScanPlanSkipped {
  folderPath: string;
  name: string;
  reason: 'alreadyBound' | 'ignored' | 'noImages';
}

/** applyScanPlan 入参形状（不含 extensions，由上层补） */
export interface ScanResolution {
  create: Array<{ folderPath: string; name: string }>;
  merge: Array<{ folderPath: string; galleryId: number }>;
}

/** 每个碰撞行的用户选择：合并到已有相册 / 新建独立相册 */
type CollisionChoice = 'merge' | 'create';

/**
 * 纯函数：根据 newFolders 与每个碰撞行的选择，拼出 applyScanPlan 的 create/merge。
 * - newFolders 始终进入 create；
 * - 选择 create 的碰撞以原文件夹名进入 create（新建独立相册）；
 * - 选择 merge 的碰撞按 existingGalleryId 进入 merge。
 * 抽成可复用、可单测的纯逻辑，组件只负责把 UI 状态喂进来。
 */
export function buildScanResolution(
  newFolders: ScanPlanNewFolder[],
  collisions: ScanPlanCollision[],
  choices: Record<string, CollisionChoice>,
): ScanResolution {
  const create: ScanResolution['create'] = newFolders.map(f => ({ folderPath: f.folderPath, name: f.name }));
  const merge: ScanResolution['merge'] = [];
  for (const c of collisions) {
    const choice = choices[c.folderPath] ?? 'merge';
    if (choice === 'create') {
      create.push({ folderPath: c.folderPath, name: c.name });
    } else {
      merge.push({ folderPath: c.folderPath, galleryId: c.existingGalleryId });
    }
  }
  return { create, merge };
}

interface Props {
  open: boolean;
  newFolders: ScanPlanNewFolder[];
  collisions: ScanPlanCollision[];
  skipped: ScanPlanSkipped[];
  onCancel: () => void;
  onConfirm: (resolution: ScanResolution) => void | Promise<void>;
  confirming?: boolean;
}

const SKIP_REASON_LABEL: Record<ScanPlanSkipped['reason'], string> = {
  alreadyBound: '已绑定',
  ignored: '已忽略',
  noImages: '无图片',
};

export const ScanCollisionModal: React.FC<Props> = ({
  open,
  newFolders,
  collisions,
  skipped,
  onCancel,
  onConfirm,
  confirming = false,
}) => {
  // 每个碰撞行的选择，默认全部「合并到已有相册」（保守，不产生重复相册）
  const [choices, setChoices] = useState<Record<string, CollisionChoice>>({});

  // 打开或碰撞集合变化时，重置为默认全合并
  useEffect(() => {
    if (!open) return;
    const init: Record<string, CollisionChoice> = {};
    for (const c of collisions) init[c.folderPath] = 'merge';
    setChoices(init);
  }, [open, collisions]);

  const setAll = (choice: CollisionChoice) => {
    const next: Record<string, CollisionChoice> = {};
    for (const c of collisions) next[c.folderPath] = choice;
    setChoices(next);
  };

  const setOne = (folderPath: string, choice: CollisionChoice) => {
    setChoices(prev => ({ ...prev, [folderPath]: choice }));
  };

  const resolution = useMemo(
    () => buildScanResolution(newFolders, collisions, choices),
    [newFolders, collisions, choices],
  );

  const handleOk = async () => {
    await onConfirm(resolution);
  };

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      okText="确认"
      cancelText="取消"
      okButtonProps={{ loading: confirming }}
      confirmLoading={confirming}
      title="同名相册冲突"
      width={680}
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: spacing.md }}
        message={`本次将新增 ${newFolders.length} 个相册，跳过 ${skipped.length} 个；以下 ${collisions.length} 个文件夹与已有相册同名，请逐一选择处理方式。`}
      />

      {/* 顶部快捷动作 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.md }}>
        <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setAll('merge')}>全部合并</Button>
        <Typography.Text type="secondary">|</Typography.Text>
        <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setAll('create')}>全部新建</Button>
      </div>

      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
        {collisions.map(c => (
          <div
            key={c.folderPath}
            data-testid="collision-row"
            style={{
              padding: `${spacing.sm}px ${spacing.md}px`,
              marginBottom: spacing.sm,
              border: `1px solid ${colors.borderCard}`,
              borderRadius: radius.sm,
              background: colors.bgBase,
            }}
          >
            <div style={{ fontSize: fontSize.base, color: colors.textPrimary, fontWeight: 500 }}>{c.name}</div>
            <div style={{ fontSize: fontSize.sm, color: colors.textTertiary, marginBottom: spacing.xs, wordBreak: 'break-all' }}>
              {c.folderPath}
            </div>
            <Radio.Group
              value={choices[c.folderPath] ?? 'merge'}
              onChange={e => setOne(c.folderPath, e.target.value as CollisionChoice)}
            >
              <Space direction="vertical" size={2}>
                <Radio value="merge">{`合并到「${c.existingGalleryName}」`}</Radio>
                <Radio value="create">新建独立相册</Radio>
              </Space>
            </Radio.Group>
          </div>
        ))}
      </div>

      {skipped.length > 0 && (
        <div style={{ marginTop: spacing.md, fontSize: fontSize.sm, color: colors.textTertiary }}>
          已跳过 {skipped.length} 个：
          {skipped.map(s => `${s.name}（${SKIP_REASON_LABEL[s.reason]}）`).join('、')}
        </div>
      )}
    </Modal>
  );
};
