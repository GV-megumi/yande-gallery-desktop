import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../../src/main/ipc/channels.js';

const handlers = new Map<string, (...args: any[]) => unknown>();
const removeFromFavorites = vi.fn();
const setActiveBooruSite = vi.fn();
const moveFavoriteToGroup = vi.fn();
const votePost = vi.fn();

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  dialog: {
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
}));

vi.mock('../../../src/main/services/booruService.js', () => ({
  moveFavoriteToGroup,
  removeFromFavorites,
  setActiveBooruSite,
  votePost,
}));

vi.mock('../../../src/main/services/moebooruClient.js', () => ({
  hashPasswordSHA1: vi.fn(),
}));

vi.mock('../../../src/main/services/downloadManager.js', () => ({
  downloadManager: {},
}));

vi.mock('../../../src/main/services/imageCacheService.js', () => ({}));

vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(),
  all: vi.fn(),
  run: vi.fn(),
  runInTransaction: vi.fn(),
}));

vi.mock('../../../src/main/services/imageMetadataService.js', () => ({
  getImageMetadata: vi.fn(),
}));

describe('booru domain event IPC handlers', () => {
  beforeEach(async () => {
    handlers.clear();
    removeFromFavorites.mockReset();
    removeFromFavorites.mockResolvedValue(undefined);
    moveFavoriteToGroup.mockReset();
    moveFavoriteToGroup.mockResolvedValue(undefined);
    setActiveBooruSite.mockReset();
    setActiveBooruSite.mockResolvedValue(undefined);
    votePost.mockReset();
    votePost.mockResolvedValue(undefined);
    vi.resetModules();

    const { setupBooruHandlers } = await import('../../../src/main/ipc/handlers/booruHandlers.js');
    setupBooruHandlers();
  });

  it('passes postId siteId and syncToServer to remove favorite service boundary', async () => {
    const handler = handlers.get(IPC_CHANNELS.BOORU_REMOVE_FAVORITE);
    expect(handler).toBeDefined();

    await expect(handler!({}, 101, 2, true)).resolves.toEqual({ success: true });

    expect(removeFromFavorites).toHaveBeenCalledWith(101, 2);
  });

  it('uses the service boundary for active site changes', async () => {
    const handler = handlers.get(IPC_CHANNELS.BOORU_SET_ACTIVE_SITE);
    expect(handler).toBeDefined();

    await expect(handler!({}, 7)).resolves.toEqual({ success: true });

    expect(setActiveBooruSite).toHaveBeenCalledWith(7);
  });

  it('passes siteId through when moving a favorite to a group', async () => {
    const handler = handlers.get(IPC_CHANNELS.BOORU_MOVE_FAVORITE_TO_GROUP);
    expect(handler).toBeDefined();

    await expect(handler!({}, 101, 2, 7)).resolves.toEqual({ success: true });

    expect(moveFavoriteToGroup).toHaveBeenCalledWith(2, 101, 7);
  });

  it('uses the service boundary for post vote', async () => {
    const handler = handlers.get(IPC_CHANNELS.BOORU_VOTE_POST);
    expect(handler).toBeDefined();

    await expect(handler!({}, 2, 101, 1)).resolves.toEqual({ success: true });

    expect(votePost).toHaveBeenCalledWith(2, 101, 1);
  });
});
