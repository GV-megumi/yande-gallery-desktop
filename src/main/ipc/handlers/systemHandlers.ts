import { dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import fs from 'fs/promises';
import axios from 'axios';
import { lookup } from 'node:dns/promises';
import { IPC_CHANNELS } from '../channels.js';
import { getProxyConfig } from '../../services/config.js';
import { createAppBackupData, isValidBackupData, restoreAppBackupData, summarizeBackupTables } from '../../services/backupService.js';
import * as updateService from '../../services/updateService.js';

function isIPv4Literal(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) {
    return false;
  }

  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function isDisallowedIPv4Target(hostname: string): boolean {
  if (!isIPv4Literal(hostname)) {
    return false;
  }

  const [first, second] = hostname.split('.').map(Number);

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function extractMappedIPv4FromIPv6(hostname: string): string | null {
  const normalized = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  const dottedMatch = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dottedMatch) {
    return dottedMatch[1];
  }

  const hexMatch = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hexMatch) {
    return null;
  }

  const first = parseInt(hexMatch[1], 16);
  const second = parseInt(hexMatch[2], 16);
  return [first >> 8, first & 0xff, second >> 8, second & 0xff].join('.');
}

function isDisallowedIPv6Target(hostname: string): boolean {
  const normalized = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  const mappedIPv4 = extractMappedIPv4FromIPv6(normalized);

  if (mappedIPv4 && isDisallowedIPv4Target(mappedIPv4)) {
    return true;
  }

  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
}

function isDisallowedExternalHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    return true;
  }

  return isDisallowedIPv4Target(normalized) || isDisallowedIPv6Target(normalized);
}

async function validateExternalUrl(input: unknown): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (typeof input !== 'string') {
    return { ok: false, error: '链接必须是字符串' };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: '链接不能为空' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: '链接格式无效' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: '仅允许打开 https 链接' };
  }

  if (!parsed.hostname) {
    return { ok: false, error: '链接缺少有效主机名' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: '不允许打开包含账号信息的外部链接' };
  }

  if (isDisallowedExternalHostname(parsed.hostname)) {
    return { ok: false, error: '不允许打开指向本地或内网的外部链接' };
  }

  try {
    const resolved = await lookup(parsed.hostname, { all: true, verbatim: true });
    const records = Array.isArray(resolved) ? resolved : [resolved];
    if (records.some((record) => isDisallowedExternalHostname(record.address))) {
      return { ok: false, error: '不允许打开指向本地或内网的外部链接' };
    }
  } catch {
    return { ok: false, error: '链接主机名解析失败' };
  }

  return { ok: true, url: parsed.toString() };
}

export function setupSystemHandlers() {
  // 选择文件夹
  ipcMain.handle(IPC_CHANNELS.SYSTEM_SELECT_FOLDER, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择图片文件夹'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, data: result.filePaths[0] };
    }

    return { success: false, error: 'No folder selected' };
  });

  // 打开外部链接
  ipcMain.handle(IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL, async (_, url: string) => {
    const validated = await validateExternalUrl(url);
    if (!validated.ok) {
      return { success: false, error: validated.error };
    }

    const { shell } = await import('electron');
    await shell.openExternal(validated.url);
    return { success: true };
  });

  // 在文件管理器中显示项目
  ipcMain.handle(IPC_CHANNELS.SYSTEM_SHOW_ITEM, async (_event: IpcMainInvokeEvent, filePath: string) => {
    try {
      const { shell } = await import('electron');
      shell.showItemInFolder(filePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 检查更新
  ipcMain.handle(IPC_CHANNELS.SYSTEM_CHECK_FOR_UPDATE, async () => {
    console.log('[IPC] 检查更新');
    try {
      const result = await updateService.checkForUpdate();
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] 检查更新失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SYSTEM_EXPORT_BACKUP, async () => {
    try {
      console.log('[IPC] 导出应用备份');
      const backupData = await createAppBackupData();
      const summary = summarizeBackupTables(backupData);
      const result = await dialog.showSaveDialog({
        title: '导出应用备份',
        defaultPath: `yande-gallery-backup-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON Backup', extensions: ['json'] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: '已取消导出' };
      }

      await fs.writeFile(result.filePath, JSON.stringify(backupData, null, 2), 'utf-8');
      return { success: true, data: { path: result.filePath, summary } };
    } catch (error) {
      console.error('[IPC] 导出应用备份失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SYSTEM_IMPORT_BACKUP, async (_event: IpcMainInvokeEvent, mode: 'merge' | 'replace' = 'merge') => {
    try {
      console.log('[IPC] 导入应用备份, mode:', mode);
      const result = await dialog.showOpenDialog({
        title: '导入应用备份',
        properties: ['openFile'],
        filters: [{ name: 'JSON Backup', extensions: ['json'] }],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '已取消导入' };
      }

      const filePath = result.filePaths[0];
      const content = await fs.readFile(filePath, 'utf-8');
      const backupData = JSON.parse(content);

      if (!isValidBackupData(backupData)) {
        throw new Error('备份文件格式无效');
      }

      const restoreResult = await restoreAppBackupData(backupData, { mode });
      return { success: true, data: { path: filePath, ...restoreResult } };
    } catch (error) {
      console.error('[IPC] 导入应用备份失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ===== 网络连接测试（从主进程发起，绕过CORS） =====
  ipcMain.handle(IPC_CHANNELS.NETWORK_TEST_BAIDU, async () => {
    console.log('[IPC] 测试百度连接（主进程）');
    const proxyConfig = getProxyConfig();
    console.log('[IPC] 当前代理配置:', proxyConfig ? `${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}` : '无');

    try {
      // 使用 axios 发起请求，支持代理
      const response = await axios.get('https://www.baidu.com', {
        proxy: proxyConfig,
        timeout: 10000,
        headers: {
          'User-Agent': 'YandeGalleryDesktop/1.0.0'
        }
      });

      console.log('[IPC] 百度连接成功，状态:', response.status);
      return { success: true, status: response.status };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] 百度连接失败:', errorMessage);
      if (axios.isAxiosError(error)) {
        console.error('[IPC] Axios错误详情:', error.code, error.message);
      }
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle(IPC_CHANNELS.NETWORK_TEST_GOOGLE, async () => {
    console.log('[IPC] 测试Google连接（主进程）');
    const proxyConfig = getProxyConfig();
    console.log('[IPC] 当前代理配置:', proxyConfig ? `${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}` : '无');

    try {
      // 使用 axios 发起请求，支持代理
      const response = await axios.get('https://www.google.com', {
        proxy: proxyConfig,
        timeout: 10000,
        headers: {
          'User-Agent': 'YandeGalleryDesktop/1.0.0'
        }
      });

      console.log('[IPC] Google连接成功，状态:', response.status);
      return { success: true, status: response.status };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[IPC] Google连接失败:', errorMessage);
      if (axios.isAxiosError(error)) {
        console.error('[IPC] Axios错误详情:', error.code, error.message);
      }
      return { success: false, error: errorMessage };
    }
  });
}
