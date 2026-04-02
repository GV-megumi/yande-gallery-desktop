import type { FavoriteTagDownloadDisplayStatus, FavoriteTagWithDownloadState } from './types';

/**
 * 从 FavoriteTagWithDownloadState 中推导当前应展示的下载状态
 */
export function getDisplayStatus(record: FavoriteTagWithDownloadState): FavoriteTagDownloadDisplayStatus {
  if (record.runtimeProgress?.status) {
    return record.runtimeProgress.status;
  }
  if (record.downloadBinding?.lastStatus) {
    return record.downloadBinding.lastStatus;
  }
  if (record.downloadBinding?.enabled) {
    return 'ready';
  }
  return 'notConfigured';
}

/**
 * 状态 -> Ant Design Tag color 映射
 */
export function getStatusColor(status: FavoriteTagDownloadDisplayStatus): string {
  switch (status) {
    case 'starting':
    case 'dryRun':
    case 'running':
    case 'pending':
      return 'processing';
    case 'ready':
    case 'completed':
    case 'allSkipped':
      return 'success';
    case 'paused':
    case 'suspended':
      return 'warning';
    case 'failed':
    case 'validationError':
    case 'taskCreateFailed':
    case 'sessionCreateFailed':
    case 'cancelled':
      return 'error';
    case 'notConfigured':
    default:
      return 'default';
  }
}

/**
 * 是否为错误/失败类状态
 */
export function isErrorStatus(status: FavoriteTagDownloadDisplayStatus): boolean {
  return status === 'failed'
    || status === 'validationError'
    || status === 'taskCreateFailed'
    || status === 'sessionCreateFailed';
}

/**
 * 是否为活跃（进行中）状态
 */
export function isActiveStatus(status: FavoriteTagDownloadDisplayStatus): boolean {
  return status === 'starting'
    || status === 'dryRun'
    || status === 'running'
    || status === 'pending';
}

/**
 * 是否为可重试状态（失败 / 已取消）
 */
export function isRetryableStatus(status: FavoriteTagDownloadDisplayStatus): boolean {
  return status === 'failed' || status === 'cancelled';
}

/**
 * 是否为终态（不再变化）
 */
export function isTerminalStatus(status: FavoriteTagDownloadDisplayStatus): boolean {
  return status === 'completed'
    || status === 'allSkipped'
    || status === 'failed'
    || status === 'cancelled';
}
