/**
 * Google OAuth 认证服务
 * 负责 Google 账号的 OAuth 2.0 登录、token 管理和自动刷新
 *
 * 流程：
 *   1. 弹出 BrowserWindow 加载 Google 登录页
 *   2. 启动本地临时 HTTP Server 接收回调 code
 *   3. 用 code 换取 access_token + refresh_token
 *   4. token 持久化存储（electron-store）
 *   5. token 自动刷新（过期前刷新）
 */

import { BrowserWindow } from 'electron';
import http from 'http';
import axios from 'axios';
import { getConfig, getProxyConfig } from './config.js';

// ============= 类型定义 =============

export interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix 时间戳（毫秒）
  token_type: string;
  scope: string;
}

export interface GoogleAuthStatus {
  isLoggedIn: boolean;
  email?: string;
  expiresAt?: number;
}

// ============= OAuth 配置 =============

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

// 申请的 OAuth Scopes
const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  // 方案一：访问本应用自己创建的相册（新 OAuth client 可用）
  'https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata',
  // 方案二：Photos Picker API（新 OAuth client 可用，让用户选择照片）
  'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

// ============= Token 存储 =============

let store: any = null;
let cachedTokens: GoogleTokens | null = null;
let cachedEmail: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 获取 electron-store 实例（延迟初始化）
 */
async function getStore() {
  if (!store) {
    const ElectronStore = (await import('electron-store')).default;
    store = new ElectronStore({
      name: 'google-auth',
      encryptionKey: 'yande-gallery-google-auth',
    });
    console.log('[GoogleAuth] electron-store 初始化完成');
  }
  return store;
}

/**
 * 从持久化存储加载 tokens
 */
async function loadTokens(): Promise<GoogleTokens | null> {
  if (cachedTokens) return cachedTokens;

  const s = await getStore();
  const tokens = s.get('tokens') as GoogleTokens | undefined;
  if (tokens) {
    cachedTokens = tokens;
    cachedEmail = s.get('email') as string || null;
    console.log('[GoogleAuth] 从存储加载 tokens，过期时间:', new Date(tokens.expires_at).toLocaleString());
  }
  return tokens || null;
}

/**
 * 保存 tokens 到持久化存储
 */
async function saveTokens(tokens: GoogleTokens, email?: string): Promise<void> {
  const s = await getStore();
  s.set('tokens', tokens);
  if (email) {
    s.set('email', email);
    cachedEmail = email;
  }
  cachedTokens = tokens;
  console.log('[GoogleAuth] tokens 已保存，过期时间:', new Date(tokens.expires_at).toLocaleString());

  // 安排自动刷新
  scheduleRefresh(tokens);
}

/**
 * 清除存储的 tokens
 */
async function clearTokens(): Promise<void> {
  const s = await getStore();
  s.delete('tokens');
  s.delete('email');
  cachedTokens = null;
  cachedEmail = null;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  console.log('[GoogleAuth] tokens 已清除');
}

// ============= OAuth 流程 =============

/**
 * 获取 Google OAuth 凭据
 */
function getCredentials(): { clientId: string; clientSecret: string } {
  const config = getConfig() as any;
  const google = config.google;
  if (!google?.clientId || !google?.clientSecret) {
    throw new Error('Google OAuth 凭据未配置，请在 config.yaml 中设置 google.clientId 和 google.clientSecret');
  }
  return {
    clientId: google.clientId,
    clientSecret: google.clientSecret,
  };
}

/**
 * 启动本地 HTTP 服务器接收 OAuth 回调
 * 使用随机端口，授权完成后立即关闭
 */
function startCallbackServer(): Promise<{ server: http.Server; port: number; codePromise: Promise<string> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();

    // 创建一个 Promise 用于等待 code
    let resolveCode: (code: string) => void;
    let rejectCode: (error: Error) => void;
    const codePromise = new Promise<string>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    server.on('request', (req, res) => {
      const url = new URL(req.url || '/', `http://localhost`);

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        // 返回友好的 HTML 页面
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

        if (error) {
          res.end('<html><body><h2>授权失败</h2><p>您可以关闭此窗口。</p></body></html>');
          rejectCode(new Error(`OAuth 错误: ${error}`));
        } else if (code) {
          res.end('<html><body><h2>授权成功!</h2><p>您可以关闭此窗口。</p></body></html>');
          resolveCode(code);
        } else {
          res.end('<html><body><h2>未知错误</h2><p>未收到授权码。</p></body></html>');
          rejectCode(new Error('未收到授权码'));
        }
      }
    });

    // 监听随机端口
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('无法获取服务器端口'));
        return;
      }
      const port = addr.port;
      console.log('[GoogleAuth] 回调服务器启动，端口:', port);
      resolve({ server, port, codePromise });
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * 用授权码换取 tokens
 */
async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<GoogleTokens> {
  const { clientId, clientSecret } = getCredentials();
  const proxy = getProxyConfig();

  console.log('[GoogleAuth] 用授权码换取 tokens...');

  const response = await axios.post(GOOGLE_TOKEN_URL, new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    proxy,
  });

  const data = response.data;
  const tokens: GoogleTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    token_type: data.token_type,
    scope: data.scope,
  };

  console.log('[GoogleAuth] tokens 获取成功');
  return tokens;
}

/**
 * 获取用户邮箱信息
 */
async function fetchUserEmail(accessToken: string): Promise<string> {
  const proxy = getProxyConfig();

  try {
    const response = await axios.get(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      proxy,
    });
    return response.data.email || '';
  } catch (error) {
    console.warn('[GoogleAuth] 获取用户邮箱失败:', error);
    return '';
  }
}

// ============= Token 刷新 =============

/**
 * 安排自动刷新 token（过期前 5 分钟刷新）
 */
function scheduleRefresh(tokens: GoogleTokens): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }

  const msUntilExpiry = tokens.expires_at - Date.now();
  // 提前 5 分钟刷新，但不少于 10 秒
  const refreshIn = Math.max(msUntilExpiry - 5 * 60 * 1000, 10 * 1000);

  console.log('[GoogleAuth] 安排 token 刷新，距离刷新:', Math.round(refreshIn / 1000), '秒');

  refreshTimer = setTimeout(async () => {
    try {
      await refreshAccessToken();
    } catch (error) {
      console.error('[GoogleAuth] 自动刷新 token 失败:', error);
    }
  }, refreshIn);
}

/**
 * 刷新 access_token
 */
async function refreshAccessToken(): Promise<GoogleTokens> {
  const tokens = await loadTokens();
  if (!tokens?.refresh_token) {
    throw new Error('没有 refresh_token，需要重新登录');
  }

  const { clientId, clientSecret } = getCredentials();
  const proxy = getProxyConfig();

  console.log('[GoogleAuth] 刷新 access_token...');

  const response = await axios.post(GOOGLE_TOKEN_URL, new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: tokens.refresh_token,
    grant_type: 'refresh_token',
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    proxy,
  });

  const data = response.data;
  const newTokens: GoogleTokens = {
    access_token: data.access_token,
    refresh_token: tokens.refresh_token, // refresh_token 不会每次都返回
    expires_at: Date.now() + data.expires_in * 1000,
    token_type: data.token_type || tokens.token_type,
    scope: data.scope || tokens.scope,
  };

  await saveTokens(newTokens);
  console.log('[GoogleAuth] access_token 刷新成功');
  return newTokens;
}

// ============= 公开 API =============

/**
 * Google OAuth 登录
 * 弹出 BrowserWindow 让用户授权
 */
export async function googleLogin(): Promise<{ success: boolean; email?: string; error?: string }> {
  try {
    const { clientId } = getCredentials();

    // 1. 启动回调服务器
    const { server, port, codePromise } = await startCallbackServer();
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    // 2. 构建授权 URL
    const authUrl = new URL(GOOGLE_AUTH_URL);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', SCOPES);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent'); // 强制显示同意页面，确保获取 refresh_token

    console.log('[GoogleAuth] 打开授权窗口...');

    // 3. 弹出登录窗口
    const authWindow = new BrowserWindow({
      width: 600,
      height: 700,
      title: 'Google 登录',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    authWindow.loadURL(authUrl.toString());

    // 窗口关闭时清理
    let windowClosed = false;
    authWindow.on('closed', () => {
      windowClosed = true;
    });

    try {
      // 4. 等待授权码（或窗口关闭）
      const code = await Promise.race([
        codePromise,
        new Promise<never>((_, reject) => {
          authWindow.on('closed', () => reject(new Error('用户关闭了授权窗口')));
        }),
      ]);

      // 5. 关闭窗口
      if (!windowClosed) {
        authWindow.close();
      }

      // 6. 换取 tokens
      const tokens = await exchangeCodeForTokens(code, redirectUri);

      // 7. 获取用户邮箱
      const email = await fetchUserEmail(tokens.access_token);

      // 8. 保存
      await saveTokens(tokens, email);

      console.log('[GoogleAuth] 登录成功，邮箱:', email);
      return { success: true, email };
    } finally {
      // 确保关闭回调服务器
      server.close();
      if (!windowClosed) {
        try { authWindow.close(); } catch { /* 可能已关闭 */ }
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[GoogleAuth] 登录失败:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * 退出登录
 */
export async function googleLogout(): Promise<{ success: boolean }> {
  await clearTokens();
  console.log('[GoogleAuth] 已退出登录');
  return { success: true };
}

/**
 * 获取登录状态
 */
export async function getGoogleAuthStatus(): Promise<GoogleAuthStatus> {
  const tokens = await loadTokens();
  if (!tokens) {
    return { isLoggedIn: false };
  }

  // 检查 token 是否过期
  const isExpired = tokens.expires_at < Date.now();
  if (isExpired && tokens.refresh_token) {
    try {
      await refreshAccessToken();
      return {
        isLoggedIn: true,
        email: cachedEmail || undefined,
        expiresAt: cachedTokens?.expires_at,
      };
    } catch {
      return { isLoggedIn: false };
    }
  }

  return {
    isLoggedIn: !isExpired,
    email: cachedEmail || undefined,
    expiresAt: tokens.expires_at,
  };
}

/**
 * 获取有效的 access_token（自动刷新过期的 token）
 * 供其他 Google 服务调用
 */
export async function getAccessToken(): Promise<string> {
  let tokens = await loadTokens();
  if (!tokens) {
    throw new Error('未登录 Google 账号');
  }

  // 如果 token 快过期（剩余不到 2 分钟），刷新
  if (tokens.expires_at - Date.now() < 2 * 60 * 1000) {
    tokens = await refreshAccessToken();
  }

  console.log('[GoogleAuth] getAccessToken, scope:', tokens.scope);
  return tokens.access_token;
}

/**
 * 初始化认证服务（应用启动时调用）
 * 如果有已保存的 tokens，安排自动刷新
 */
export async function initGoogleAuth(): Promise<void> {
  const tokens = await loadTokens();
  if (tokens) {
    console.log('[GoogleAuth] 发现已保存的 tokens，安排自动刷新');
    scheduleRefresh(tokens);
  }
}
