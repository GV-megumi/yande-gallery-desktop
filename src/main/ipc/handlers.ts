import { setupBooruHandlers } from './handlers/booruHandlers.js';
import { setupBulkDownloadHandlers } from './handlers/bulkDownloadHandlers.js';
import { setupConfigHandlers } from './handlers/configHandlers.js';
import { setupGalleryHandlers } from './handlers/galleryHandlers.js';
import { setupSystemHandlers } from './handlers/systemHandlers.js';

let ipcHandlersRegistered = false;

export function setupIPC() {
  if (ipcHandlersRegistered) {
    console.warn('[IPC] setupIPC() 重复调用，已跳过重复注册');
    return;
  }

  ipcHandlersRegistered = true;
  setupGalleryHandlers();
  setupConfigHandlers();
  setupSystemHandlers();
  setupBooruHandlers();
  setupBulkDownloadHandlers();
}
