import { app } from 'electron';
import { createRequire } from 'module';
import type { UpdateCheckResult } from '../../shared/types';

// 开发模式下 app.getVersion() 返回 Electron 版本，需从 package.json 读取应用版本
const require = createRequire(import.meta.url);
const appVersion: string = require('../../../package.json').version;

const REPO_OWNER = 'GV-megumi';
const REPO_NAME = 'yande-gallery-desktop';
const CACHE_TTL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 10 * 1000;

let cachedResult: UpdateCheckResult | null = null;
let cachedAt = 0;

/** 测试用：重置缓存 */
export function __resetCacheForTest(): void {
  cachedResult = null;
  cachedAt = 0;
}

/**
 * 比较两个版本字符串。
 * 返回 > 0 表示 a > b，< 0 表示 a < b，0 表示相等。
 * 只支持 数字.数字.数字[.数字...] 的形态。v 前缀会被去掉。
 * 位数不同时补零。
 */
export function compareSemver(a: string, b: string): number {
  const norm = (s: string) => s.replace(/^v/i, '').split('.').map(p => parseInt(p, 10) || 0);
  const aa = norm(a);
  const bb = norm(b);
  const len = Math.max(aa.length, bb.length);
  for (let i = 0; i < len; i++) {
    const ai = aa[i] ?? 0;
    const bi = bb[i] ?? 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

/**
 * 拉取 GitHub Releases 最新版本并与当前版本比较。
 * 60 秒内返回内存缓存结果。fetch 超时 10 秒（AbortController）。
 * 所有错误都被收敛到返回值的 error 字段，调用方无需 try/catch。
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const now = Date.now();
  if (cachedResult && (now - cachedAt) < CACHE_TTL_MS) {
    console.log('[updateService] 返回缓存的检查结果');
    return cachedResult;
  }

  const currentVersion = appVersion;
  const checkedAt = new Date().toISOString();
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=1`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'yande-gallery-desktop',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      const errorMsg = `GitHub API ${response.status}`;
      console.error('[updateService] 拉取 release 失败:', errorMsg);
      const result: UpdateCheckResult = {
        currentVersion,
        latestVersion: null,
        hasUpdate: false,
        releaseUrl: null,
        releaseName: null,
        publishedAt: null,
        error: errorMsg,
        checkedAt,
      };
      return result;
    }

    const releases = await response.json() as Array<{
      tag_name?: string;
      name?: string;
      html_url?: string;
      published_at?: string;
    }>;
    const json = releases[0];
    if (!json) {
      // 仓库没有任何 Release
      const result: UpdateCheckResult = {
        currentVersion,
        latestVersion: null,
        hasUpdate: false,
        releaseUrl: null,
        releaseName: null,
        publishedAt: null,
        error: null,
        checkedAt,
      };
      cachedResult = result;
      cachedAt = now;
      console.log('[updateService] 仓库暂无 Release');
      return result;
    }

    const latestVersion = json.tag_name ? json.tag_name.replace(/^v/i, '') : null;
    const hasUpdate = latestVersion ? compareSemver(latestVersion, currentVersion) > 0 : false;

    const result: UpdateCheckResult = {
      currentVersion,
      latestVersion,
      hasUpdate,
      releaseUrl: json.html_url ?? null,
      releaseName: json.name ?? null,
      publishedAt: json.published_at ?? null,
      error: null,
      checkedAt,
    };
    cachedResult = result;
    cachedAt = now;
    console.log('[updateService] 检查完成:', { latestVersion, hasUpdate });
    return result;
  } catch (error: any) {
    clearTimeout(timer);
    const errorMsg = error?.name === 'AbortError' ? '请求超时' : (error?.message || String(error));
    console.error('[updateService] 检查更新失败:', errorMsg);
    const result: UpdateCheckResult = {
      currentVersion,
      latestVersion: null,
      hasUpdate: false,
      releaseUrl: null,
      releaseName: null,
      publishedAt: null,
      error: errorMsg,
      checkedAt,
    };
    return result;
  }
}
