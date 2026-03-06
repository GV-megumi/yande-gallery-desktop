/**
 * 统一状态标签组件
 * 提取自 BulkDownloadSessionCard、BulkDownloadSessionDetail、BooruDownloadPage 的重复逻辑
 */

import React from 'react';
import { Tag } from 'antd';

/** 预定义的状态映射 */
const STATUS_PRESETS: Record<string, { color: string; text: string }> = {
  // 通用状态
  pending: { color: 'default', text: '等待中' },
  downloading: { color: 'processing', text: '下载中' },
  running: { color: 'processing', text: '下载中' },
  dryRun: { color: 'processing', text: '扫描中' },
  paused: { color: 'warning', text: '已暂停' },
  suspended: { color: 'warning', text: '已暂停' },
  completed: { color: 'success', text: '已完成' },
  failed: { color: 'error', text: '失败' },
  cancelled: { color: 'default', text: '已取消' },
  allSkipped: { color: 'default', text: '全部跳过' }
};

interface StatusTagProps {
  /** 状态值 */
  status: string;
  /** 自定义状态映射（覆盖预设） */
  statusMap?: Record<string, { color: string; text: string }>;
  /** 自定义样式 */
  style?: React.CSSProperties;
}

/**
 * 统一状态标签组件
 * 使用预定义颜色和文本映射，支持自定义覆盖
 */
export const StatusTag: React.FC<StatusTagProps> = React.memo(({
  status,
  statusMap,
  style
}) => {
  // 优先使用自定义映射，然后使用预设
  const info = statusMap?.[status] || STATUS_PRESETS[status] || { color: 'default', text: status };
  return <Tag color={info.color} style={style}>{info.text}</Tag>;
});

StatusTag.displayName = 'StatusTag';

/** 导出预设供外部使用 */
export { STATUS_PRESETS };
