import type { Server } from 'http';
import type { Socket } from 'net';
import type { ApiServiceConfig, ApiServiceStatus } from '../../shared/types.js';
import { getApiServiceConfig, saveConfig } from '../services/config.js';
import { apiEventHub } from './events/eventHub.js';
import { createApiLogRoutes } from './routes/apiLogRoutes.js';
import { createBooruRoutes } from './routes/booruRoutes.js';
import { createEventRoutes } from './routes/eventRoutes.js';
import { createGalleryRoutes } from './routes/galleryRoutes.js';
import { createGalleryWriteRoutes } from './routes/galleryWriteRoutes.js';
import { createServiceRoutes } from './routes/serviceRoutes.js';
import { createSyncRoutes } from './routes/syncRoutes.js';
import { generateApiKey } from './security.js';
import { createApiHttpServer } from './server.js';
import { emitApiServiceStatusChanged } from '../services/appEventPublisher.js';

let server: Server | null = null;
let status: ApiServiceStatus = {
  running: false,
  enabled: false,
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

function getBindAddress(mode: 'localhost' | 'lan'): string {
  return mode === 'localhost' ? '127.0.0.1' : '0.0.0.0';
}

function createRoutes() {
  return [
    ...createServiceRoutes({ getStatus: getApiServiceStatus }),
    ...createGalleryRoutes(),
    ...createGalleryWriteRoutes(),
    ...createBooruRoutes(),
    ...createApiLogRoutes(),
    ...createEventRoutes(apiEventHub),
    ...createSyncRoutes(),
  ];
}

export function getApiServiceStatus(): ApiServiceStatus {
  const config = getApiServiceConfig();
  if (preserveActiveRuntimeStatus && status.running) {
    return {
      ...status,
      enabled: config.enabled,
    };
  }

  return {
    ...status,
    enabled: config.enabled,
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
  if (!config.enabled) {
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
        enabled: true,
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

  const bindAddress = getBindAddress(serverConfig.mode);
  const nextServer = createApiHttpServer({ config: serverConfig, routes: createRoutes() });
  attachConnectionTracker(nextServer);

  try {
    await listenToServer(nextServer, serverConfig.port, bindAddress);
    server = nextServer;
    attachRuntimeErrorHandler(nextServer);
    preserveActiveRuntimeStatus = false;
    setApiServiceStatus({
      running: true,
      enabled: true,
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
      enabled: true,
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
