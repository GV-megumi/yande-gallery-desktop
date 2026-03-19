import { describe, it, expect } from 'vitest';
import { IPC_CHANNELS } from '../../../src/main/ipc/channels';

type MockBooruService = {
  getFavoriteTagsWithDownloadState: (siteId?: number | null) => Promise<unknown>;
  getFavoriteTagDownloadBinding: (favoriteTagId: number) => Promise<unknown>;
  upsertFavoriteTagDownloadBinding: (input: unknown) => Promise<unknown>;
  deleteFavoriteTagDownloadBinding: (favoriteTagId: number) => Promise<void>;
  startFavoriteTagBulkDownload: (favoriteTagId: number) => Promise<unknown>;
};

function createFavoriteTagDownloadHandlers(booruService: MockBooruService) {
  return {
    [IPC_CHANNELS.BOORU_GET_FAVORITE_TAGS_WITH_DOWNLOAD_STATE]: async (siteId?: number | null) => {
      try {
        const data = await booruService.getFavoriteTagsWithDownloadState(siteId);
        return { success: true, data };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    [IPC_CHANNELS.BOORU_GET_FAVORITE_TAG_DOWNLOAD_BINDING]: async (favoriteTagId: number) => {
      try {
        const data = await booruService.getFavoriteTagDownloadBinding(favoriteTagId);
        return { success: true, data };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    [IPC_CHANNELS.BOORU_UPSERT_FAVORITE_TAG_DOWNLOAD_BINDING]: async (input: unknown) => {
      try {
        const data = await booruService.upsertFavoriteTagDownloadBinding(input);
        return { success: true, data };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    [IPC_CHANNELS.BOORU_REMOVE_FAVORITE_TAG_DOWNLOAD_BINDING]: async (favoriteTagId: number) => {
      try {
        await booruService.deleteFavoriteTagDownloadBinding(favoriteTagId);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    [IPC_CHANNELS.BOORU_START_FAVORITE_TAG_BULK_DOWNLOAD]: async (favoriteTagId: number) => {
      try {
        const data = await booruService.startFavoriteTagBulkDownload(favoriteTagId);
        return { success: true, data };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

describe('handlers - favorite tag download IPC behavior', () => {
  it('应通过 BOORU_GET_FAVORITE_TAGS_WITH_DOWNLOAD_STATE 返回成功结果', async () => {
    const handlers = createFavoriteTagDownloadHandlers({
      getFavoriteTagsWithDownloadState: async (siteId) => [{ id: 1, siteId }],
      getFavoriteTagDownloadBinding: async () => null,
      upsertFavoriteTagDownloadBinding: async () => null,
      deleteFavoriteTagDownloadBinding: async () => undefined,
      startFavoriteTagBulkDownload: async () => ({ taskId: 'task-1', sessionId: 'session-1' }),
    });

    await expect(handlers[IPC_CHANNELS.BOORU_GET_FAVORITE_TAGS_WITH_DOWNLOAD_STATE](2)).resolves.toEqual({
      success: true,
      data: [{ id: 1, siteId: 2 }],
    });
  });

  it('应通过 BOORU_GET_FAVORITE_TAG_DOWNLOAD_BINDING 返回绑定数据', async () => {
    const handlers = createFavoriteTagDownloadHandlers({
      getFavoriteTagsWithDownloadState: async () => [],
      getFavoriteTagDownloadBinding: async (favoriteTagId) => ({ favoriteTagId, downloadPath: 'D:/downloads' }),
      upsertFavoriteTagDownloadBinding: async () => null,
      deleteFavoriteTagDownloadBinding: async () => undefined,
      startFavoriteTagBulkDownload: async () => ({ taskId: 'task-1', sessionId: 'session-1' }),
    });

    await expect(handlers[IPC_CHANNELS.BOORU_GET_FAVORITE_TAG_DOWNLOAD_BINDING](5)).resolves.toEqual({
      success: true,
      data: { favoriteTagId: 5, downloadPath: 'D:/downloads' },
    });
  });

  it('应通过 BOORU_UPSERT_FAVORITE_TAG_DOWNLOAD_BINDING 返回保存结果', async () => {
    const input = { favoriteTagId: 7, downloadPath: 'D:/downloads/a' };
    const handlers = createFavoriteTagDownloadHandlers({
      getFavoriteTagsWithDownloadState: async () => [],
      getFavoriteTagDownloadBinding: async () => null,
      upsertFavoriteTagDownloadBinding: async (payload) => payload,
      deleteFavoriteTagDownloadBinding: async () => undefined,
      startFavoriteTagBulkDownload: async () => ({ taskId: 'task-1', sessionId: 'session-1' }),
    });

    await expect(handlers[IPC_CHANNELS.BOORU_UPSERT_FAVORITE_TAG_DOWNLOAD_BINDING](input)).resolves.toEqual({
      success: true,
      data: input,
    });
  });

  it('应通过 BOORU_REMOVE_FAVORITE_TAG_DOWNLOAD_BINDING 返回成功', async () => {
    let deletedId: number | null = null;
    const handlers = createFavoriteTagDownloadHandlers({
      getFavoriteTagsWithDownloadState: async () => [],
      getFavoriteTagDownloadBinding: async () => null,
      upsertFavoriteTagDownloadBinding: async () => null,
      deleteFavoriteTagDownloadBinding: async (favoriteTagId) => {
        deletedId = favoriteTagId;
      },
      startFavoriteTagBulkDownload: async () => ({ taskId: 'task-1', sessionId: 'session-1' }),
    });

    await expect(handlers[IPC_CHANNELS.BOORU_REMOVE_FAVORITE_TAG_DOWNLOAD_BINDING](9)).resolves.toEqual({ success: true });
    expect(deletedId).toBe(9);
  });

  it('应通过 BOORU_START_FAVORITE_TAG_BULK_DOWNLOAD 返回 taskId/sessionId', async () => {
    const handlers = createFavoriteTagDownloadHandlers({
      getFavoriteTagsWithDownloadState: async () => [],
      getFavoriteTagDownloadBinding: async () => null,
      upsertFavoriteTagDownloadBinding: async () => null,
      deleteFavoriteTagDownloadBinding: async () => undefined,
      startFavoriteTagBulkDownload: async (favoriteTagId) => ({
        taskId: `task-${favoriteTagId}`,
        sessionId: `session-${favoriteTagId}`,
      }),
    });

    await expect(handlers[IPC_CHANNELS.BOORU_START_FAVORITE_TAG_BULK_DOWNLOAD](11)).resolves.toEqual({
      success: true,
      data: { taskId: 'task-11', sessionId: 'session-11' },
    });
  });

  it('服务抛错时应返回 success=false 和 error', async () => {
    const handlers = createFavoriteTagDownloadHandlers({
      getFavoriteTagsWithDownloadState: async () => {
        throw new Error('boom');
      },
      getFavoriteTagDownloadBinding: async () => null,
      upsertFavoriteTagDownloadBinding: async () => null,
      deleteFavoriteTagDownloadBinding: async () => undefined,
      startFavoriteTagBulkDownload: async () => ({ taskId: 'task-1', sessionId: 'session-1' }),
    });

    await expect(handlers[IPC_CHANNELS.BOORU_GET_FAVORITE_TAGS_WITH_DOWNLOAD_STATE](1)).resolves.toEqual({
      success: false,
      error: 'boom',
    });
  });
});
