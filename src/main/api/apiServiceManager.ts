import type { Server } from 'http';
import type { Socket } from 'net';
import type { ApiServiceConfig, ApiServiceStatus } from '../../shared/types.js';
import { getApiServiceConfig, saveConfig } from '../services/config.js';
import { apiEventHub, type ApiEventHub } from './events/eventHub.js';
import { createApiLogRoutes } from './routes/apiLogRoutes.js';
import { createBooruRoutes } from './routes/booruRoutes.js';
import { createAppEventRoutes, createEventRoutes } from './routes/eventRoutes.js';
import { createGalleryRoutes, createImageBinaryRoutes } from './routes/galleryRoutes.js';
import { createGalleryWriteRoutes } from './routes/galleryWriteRoutes.js';
import { createAppServiceRoutes, createServiceRoutes } from './routes/serviceRoutes.js';
import { createSyncRoutes } from './routes/syncRoutes.js';
import { remapToAppNamespace } from './appNamespace.js';
import { generateApiKey } from './security.js';
import { createApiHttpServer } from './server.js';
import type { ApiRoute } from './types.js';
import { emitApiServiceStatusChanged } from '../services/appEventPublisher.js';

let server: Server | null = null;
let status: ApiServiceStatus = {
  running: false,
  enabled: false,
  appEnabled: false,
  mode: 'localhost',
  port: 38947,
  bindAddress: null,
  baseUrl: null,
  startedAt: null,
  lastError: null,
};
let lifecycleQueue: Promise<unknown> = Promise.resolve();
const runtimeErrorHandlers = new WeakMap<Server, (error: Error) => void>();
const connectionTrackers = new WeakMap<Server, {
  sockets: Set<Socket>;
  onConnection: (socket: Socket) => void;
}>();
const SERVER_CLOSE_TIMEOUT_MS = 3000;
type ApiServiceKeySaveInput = { apiService: { apiKey: string } };
type SaveApiServiceKey = (config: ApiServiceKeySaveInput) => ReturnType<typeof saveConfig>;
let preserveActiveRuntimeStatus = false;

type EnsureApiKeyResult =
  | { success: true; config: ApiServiceConfig }
  | { success: false; error: string };

function getBindAddress(config: Pick<ApiServiceConfig, 'mode' | 'app'>): string {
  // 手机连接即意味着局域网可达（spec §6）：app 面开启时强制 0.0.0.0，
  // mode 仅决定 agent-only 场景的监听面；应用层私网 IP 白名单恒在兜底。
  if (config.app.enabled) {
    return '0.0.0.0';
  }
  return config.mode === 'localhost' ? '127.0.0.1' : '0.0.0.0';
}

/**
 * 双面路由装配（纯函数）：唯一的装配真值，endpointCoverage 测试直接消费本函数，
 * createRoutes 接线漂移（如漏挂 remap 组）会立刻被测试暴露。
 */
export function assembleApiRoutes(
  statusProvider: { getStatus: () => ApiServiceStatus },
  eventHub: Pick<ApiEventHub, 'subscribe'>,
): ApiRoute[] {
  const imageBinaryRoutes = createImageBinaryRoutes();

  return [
    // Agent 面 /api/v1/*：设计文档 11 键细化权限（spec §3.2）
    ...createServiceRoutes(statusProvider),
    ...createGalleryRoutes(),
    ...imageBinaryRoutes,
    ...createBooruRoutes(),
    ...createApiLogRoutes(),
    ...createEventRoutes(eventHub),
    // 手机面 /api/app/v1/*：「允许手机端连接」一门制（spec §3.1）；
    // service 路由用手机面专版（info 不透出 agent 专属 mode/permissions），不走 remap
    ...createAppServiceRoutes(statusProvider),
    ...remapToAppNamespace(imageBinaryRoutes),
    ...createSyncRoutes(),
    ...createGalleryWriteRoutes(),
    ...createAppEventRoutes(eventHub),
  ];
}

function createRoutes() {
  return assembleApiRoutes({ getStatus: getApiServiceStatus }, apiEventHub);
}

export function getApiServiceStatus(): ApiServiceStatus {
  const config = getApiServiceConfig();
  if (preserveActiveRuntimeStatus && status.running) {
    return {
      ...status,
      enabled: config.enabled,
      appEnabled: config.app.enabled,
    };
  }

  return {
    ...status,
    enabled: config.enabled,
    appEnabled: config.app.enabled,
    mode: config.mode,
    port: config.port,
  };
}

function setApiServiceStatus(nextStatus: ApiServiceStatus): ApiServiceStatus {
  status = nextStatus;
  emitApiServiceStatusChanged(status);
  return status;
}

function enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const queued = lifecycleQueue.then(operation, operation);
  lifecycleQueue = queued.catch(() => undefined);
  return queued;
}

function removeServerListener(targetServer: Server, event: string, handler: (...args: any[]) => void): void {
  if ('off' in targetServer && typeof targetServer.off === 'function') {
    targetServer.off(event, handler);
    return;
  }

  if ('removeListener' in targetServer && typeof targetServer.removeListener === 'function') {
    targetServer.removeListener(event, handler);
  }
}

function removeServerErrorListener(targetServer: Server, handler: (error: Error) => void): void {
  removeServerListener(targetServer, 'error', handler as (...args: any[]) => void);
}

function detachRuntimeErrorHandler(targetServer: Server): void {
  const handler = runtimeErrorHandlers.get(targetServer);
  if (!handler) {
    return;
  }

  removeServerErrorListener(targetServer, handler);
  runtimeErrorHandlers.delete(targetServer);
}

function attachConnectionTracker(targetServer: Server): void {
  if (typeof targetServer.on !== 'function') {
    return;
  }

  const sockets = new Set<Socket>();
  const onConnection = (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  };

  connectionTrackers.set(targetServer, { sockets, onConnection });
  targetServer.on('connection', onConnection);
}

function detachConnectionTracker(targetServer: Server): void {
  const tracker = connectionTrackers.get(targetServer);
  if (!tracker) {
    return;
  }

  removeServerListener(targetServer, 'connection', tracker.onConnection as (...args: any[]) => void);
  connectionTrackers.delete(targetServer);
}

function forceCloseServerConnections(targetServer: Server): void {
  if (typeof targetServer.closeAllConnections === 'function') {
    targetServer.closeAllConnections();
  }

  const tracker = connectionTrackers.get(targetServer);
  if (!tracker) {
    return;
  }

  for (const socket of tracker.sockets) {
    socket.destroy();
  }
}

async function closeServerWithTimeout(targetServer: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      forceCloseServerConnections(targetServer);
      resolve();
    }, SERVER_CLOSE_TIMEOUT_MS);
    if (typeof timeout.unref === 'function') {
      timeout.unref();
    }

    targetServer.close((error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function attachRuntimeErrorHandler(activeServer: Server): void {
  const handler = (error: Error) => {
    if (server !== activeServer) {
      return;
    }

    server = null;
    preserveActiveRuntimeStatus = false;
    detachRuntimeErrorHandler(activeServer);
    detachConnectionTracker(activeServer);
    setApiServiceStatus({
      ...getApiServiceStatus(),
      running: false,
      bindAddress: null,
      baseUrl: null,
      startedAt: null,
      lastError: error instanceof Error ? error.message : String(error),
    });
  };

  runtimeErrorHandlers.set(activeServer, handler);
  activeServer.on('error', handler);
}

async function stopNow(): Promise<void> {
  if (!server) {
    preserveActiveRuntimeStatus = false;
    setApiServiceStatus({ ...getApiServiceStatus(), running: false, bindAddress: null, baseUrl: null, startedAt: null });
    return;
  }

  const closing = server;
  const activeStatus = status;
  try {
    apiEventHub.closeAll();
    await closeServerWithTimeout(closing);
  } catch (error) {
    if (server !== closing) {
      preserveActiveRuntimeStatus = false;
      setApiServiceStatus({
        ...getApiServiceStatus(),
        running: false,
        bindAddress: null,
        baseUrl: null,
        startedAt: null,
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    preserveActiveRuntimeStatus = true;
    setApiServiceStatus({
      ...activeStatus,
      running: true,
      lastError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  if (server === closing) {
    server = null;
  }
  detachRuntimeErrorHandler(closing);
  detachConnectionTracker(closing);
  preserveActiveRuntimeStatus = false;
  setApiServiceStatus({ ...getApiServiceStatus(), running: false, bindAddress: null, baseUrl: null, startedAt: null });
}

export async function stopApiService(): Promise<void> {
  return enqueueLifecycle(stopNow);
}

async function listenToServer(nextServer: Server, port: number, bindAddress: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      removeServerErrorListener(nextServer, onError);
      reject(error);
    };
    const onListening = () => {
      removeServerErrorListener(nextServer, onError);
      resolve();
    };

    nextServer.once('error', onError);
    nextServer.listen(port, bindAddress, onListening);
  });
}

async function generateAndPersistMissingApiKey(config: ApiServiceConfig): Promise<EnsureApiKeyResult> {
  try {
    const apiKey = generateApiKey();
    const result = await (saveConfig as unknown as SaveApiServiceKey)({ apiService: { apiKey } });
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to save generated API key' };
    }

    return {
      success: true,
      config: {
        ...config,
        apiKey,
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function syncNow(): Promise<ApiServiceStatus> {
  const config = getApiServiceConfig();
  if (!config.enabled && !config.app.enabled) {
    // 任一消费者开启即运行（spec §6）：agent 面 enabled 与手机面 app.enabled 是并集关系。
    await stopNow();
    return getApiServiceStatus();
  }

  await stopNow();
  let serverConfig = config;
  if (!config.apiKey.trim()) {
    const apiKeyResult = await generateAndPersistMissingApiKey(config);
    if (!apiKeyResult.success) {
      setApiServiceStatus({
        running: false,
        enabled: config.enabled,
        appEnabled: config.app.enabled,
        mode: config.mode,
        port: config.port,
        bindAddress: null,
        baseUrl: null,
        startedAt: null,
        lastError: apiKeyResult.error,
      });
      return status;
    }
    serverConfig = apiKeyResult.config;
  }

  const bindAddress = getBindAddress(serverConfig);
  // 路由装配可能抛错（如 remapToAppNamespace 的命名空间护栏）：此时旧服务器已停，
  // 必须把错误记进 status.lastError 而不是让 rejection 逃逸——否则设置页只见「未运行」无原因，
  // 启动路径上还会变成 whenReady 里的未处理异常。
  let nextServer: Server;
  try {
    nextServer = createApiHttpServer({ config: serverConfig, routes: createRoutes() });
  } catch (error) {
    setApiServiceStatus({
      running: false,
      enabled: serverConfig.enabled,
      appEnabled: serverConfig.app.enabled,
      mode: serverConfig.mode,
      port: serverConfig.port,
      bindAddress: null,
      baseUrl: null,
      startedAt: null,
      lastError: error instanceof Error ? error.message : String(error),
    });
    return status;
  }
  attachConnectionTracker(nextServer);

  try {
    await listenToServer(nextServer, serverConfig.port, bindAddress);
    server = nextServer;
    attachRuntimeErrorHandler(nextServer);
    preserveActiveRuntimeStatus = false;
    setApiServiceStatus({
      running: true,
      enabled: serverConfig.enabled,
      appEnabled: serverConfig.app.enabled,
      mode: serverConfig.mode,
      port: serverConfig.port,
      bindAddress,
      baseUrl: `http://${bindAddress === '0.0.0.0' ? '127.0.0.1' : bindAddress}:${serverConfig.port}`,
      startedAt: new Date().toISOString(),
      lastError: null,
    });
  } catch (error) {
    detachConnectionTracker(nextServer);
    setApiServiceStatus({
      running: false,
      enabled: serverConfig.enabled,
      appEnabled: serverConfig.app.enabled,
      mode: serverConfig.mode,
      port: serverConfig.port,
      bindAddress,
      baseUrl: null,
      startedAt: null,
      lastError: error instanceof Error ? error.message : String(error),
    });
  }

  return status;
}

export async function syncApiServiceFromConfig(): Promise<ApiServiceStatus> {
  return enqueueLifecycle(syncNow);
}

export async function generateAndSaveApiKey(): Promise<{
  success: boolean;
  data?: { apiKey: string };
  error?: string;
}> {
  try {
    const apiKey = generateApiKey();
    const result = await (saveConfig as unknown as SaveApiServiceKey)({ apiService: { apiKey } });
    if (!result.success) {
      return result;
    }

    return { success: true, data: { apiKey } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
