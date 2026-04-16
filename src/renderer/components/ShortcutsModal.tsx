/**
 * 快捷键帮助弹窗组件
 * 显示所有可用的快捷键列表
 */
import React from 'react';
import { Modal, Typography, Tag, Button } from 'antd';
import { useLocale } from '../locales';
import { SHORTCUT_KEYS, formatShortcutKey } from '../hooks/useKeyboardShortcuts';
import { colors, spacing, fontSize } from '../styles/tokens';

interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

/** 快捷键行组件 */
const ShortcutRow: React.FC<{ label: string; shortcut: string; isLast?: boolean }> = ({ label, shortcut, isLast }) => (
  <div style={{
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${spacing.sm}px 0`,
    borderBottom: isLast ? 'none' : `0.5px solid ${colors.separator}`,
  }}>
    <span style={{ color: colors.textPrimary, fontSize: fontSize.base }}>{label}</span>
    <Tag
      style={{
        fontFamily: 'monospace',
        fontSize: fontSize.sm,
        padding: '2px 8px',
        margin: 0,
        background: colors.bgLight,
        border: `1px solid ${colors.borderLight}`,
        borderRadius: 6,
      }}
    >
      {formatShortcutKey(shortcut)}
    </Tag>
  </div>
);

/** 分组标题 */
const GroupTitle: React.FC<{ title: string }> = ({ title }) => (
  <div style={{
    fontSize: fontSize.sm,
    fontWeight: 600,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    padding: `${spacing.md}px 0 ${spacing.xs}px`,
    marginTop: spacing.sm,
  }}>
    {title}
  </div>
);

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ open, onClose }) => {
  const { t } = useLocale();

  return (
    <Modal
      title={t('shortcuts.title')}
      open={open}
      closable
      maskClosable
      keyboard
      onCancel={onClose}
      footer={<Button onClick={onClose}>{t('common.close')}</Button>}
      width={480}
    >
      {/* 导航 */}
      <GroupTitle title={t('shortcuts.navigation')} />
      <ShortcutRow label={t('shortcuts.prevImage')} shortcut={SHORTCUT_KEYS.PREV_IMAGE} />
      <ShortcutRow label={t('shortcuts.nextImage')} shortcut={SHORTCUT_KEYS.NEXT_IMAGE} />
      <ShortcutRow label={t('shortcuts.goBack')} shortcut={SHORTCUT_KEYS.GO_BACK} />
      <ShortcutRow label={t('shortcuts.prevPage')} shortcut={SHORTCUT_KEYS.PREV_PAGE} />
      <ShortcutRow label={t('shortcuts.nextPage')} shortcut={SHORTCUT_KEYS.NEXT_PAGE} isLast />

      {/* 操作 */}
      <GroupTitle title={t('shortcuts.actions')} />
      <ShortcutRow label={t('shortcuts.toggleFavorite')} shortcut={SHORTCUT_KEYS.TOGGLE_FAVORITE} />
      <ShortcutRow label={t('shortcuts.downloadImage')} shortcut={SHORTCUT_KEYS.DOWNLOAD} />
      <ShortcutRow label={t('shortcuts.openOriginal')} shortcut={SHORTCUT_KEYS.OPEN_ORIGINAL} isLast />

      {/* 界面 */}
      <GroupTitle title={t('shortcuts.interface')} />
      <ShortcutRow label={t('shortcuts.toggleTheme')} shortcut={SHORTCUT_KEYS.TOGGLE_THEME} />
      <ShortcutRow label={t('shortcuts.focusSearch')} shortcut={SHORTCUT_KEYS.FOCUS_SEARCH} />
      <ShortcutRow label={t('shortcuts.showShortcuts')} shortcut={SHORTCUT_KEYS.SHOW_SHORTCUTS} isLast />
    </Modal>
  );
};
