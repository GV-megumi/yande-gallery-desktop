import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RendererAppEvent } from '../../../src/shared/types';

const state = vi.hoisted(() => ({
  publish: vi.fn(),
  windows: [] as Array<{
    destroyed: boolean;
    webContents: { send: ReturnType<typeof vi.fn> };
    isDestroyed: () => boolean;
  }>,
}));

vi.mock('../../../src/main/api/events/eventHub.js', () => ({
  apiEventHub: { publish: state.publish },
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => state.windows,
  },
}));

describe('rendererEventBus API event bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    state.publish.mockReset();
    state.windows = [];
  });

  it('bridges favorite tag and bulk download events to API SSE channels', async () => {
    const live = {
      destroyed: false,
      webContents: { send: vi.fn() },
      isDestroyed() { return this.destroyed; },
    };
    state.windows = [live];
    const { emitBuiltRendererAppEvent } = await import('../../../src/main/services/rendererEventBus.js');

    emitBuiltRendererAppEvent({
      type: 'favorite-tags:changed',
      source: 'booruService',
      payload: { action: 'updated', favoriteTagId: 1 },
    });
    emitBuiltRendererAppEvent({
      type: 'bulk-download:sessions-changed',
      source: 'bulkDownloadService',
      payload: { sessionId: 's1', reason: 'created' },
    });

    expect(state.publish).toHaveBeenCalledWith(
      'favorite-tags',
      expect.objectContaining({ type: 'favorite-tags:changed' }),
    );
    expect(state.publish).toHaveBeenCalledWith(
      'downloads',
      expect.objectContaining({ type: 'bulk-download:sessions-changed' }),
    );
    await vi.waitFor(() => {
      expect(live.webContents.send).toHaveBeenCalledTimes(2);
    });
  });

  it('bridges new domain events through the shared API channel mapping', async () => {
    const live = {
      destroyed: false,
      webContents: { send: vi.fn() },
      isDestroyed() { return this.destroyed; },
    };
    state.windows = [live];
    const { emitBuiltRendererAppEvent } = await import('../../../src/main/services/rendererEventBus.js');

    emitBuiltRendererAppEvent({
      type: 'booru:post-favorite-changed',
      source: 'booruService',
      payload: { action: 'added', siteId: 1, postId: 101, isFavorited: true },
    });
    emitBuiltRendererAppEvent({
      type: 'bulk-download:records-changed',
      source: 'bulkDownloadService',
      payload: { action: 'statusChanged', sessionId: 's1', recordId: 1, status: 'completed' },
    });
    emitBuiltRendererAppEvent({
      type: 'config:changed',
      source: 'configService',
      payload: { version: 2, sections: ['apiService'] },
    });

    expect(state.publish).toHaveBeenCalledWith(
      'booru',
      expect.objectContaining({ type: 'booru:post-favorite-changed' }),
    );
    expect(state.publish).toHaveBeenCalledWith(
      'downloads',
      expect.objectContaining({ type: 'bulk-download:records-changed' }),
    );
    expect(state.publish).toHaveBeenCalledWith(
      'system',
      expect.objectContaining({ type: 'config:changed' }),
    );
    await vi.waitFor(() => {
      expect(live.webContents.send).toHaveBeenCalledTimes(3);
    });
  });

  it('redacts local path fields from gallery and thumbnail events before publishing to API SSE', async () => {
    const live = {
      destroyed: false,
      webContents: { send: vi.fn() },
      isDestroyed() { return this.destroyed; },
    };
    state.windows = [live];
    const { emitRendererAppEvent } = await import('../../../src/main/services/rendererEventBus.js');
    const galleryEvent: RendererAppEvent = {
      type: 'gallery:images-imported',
      version: 1,
      occurredAt: '2026-05-24T00:00:00.000Z',
      source: 'galleryService',
      payload: {
        folderPath: 'M:/private/gallery',
        galleryId: 7,
        imported: 2,
        skipped: 1,
        reason: 'scanAndImportFolder',
      },
    };
    const thumbnailEvent: RendererAppEvent = {
      type: 'thumbnail:generated',
      version: 1,
      occurredAt: '2026-05-24T00:00:01.000Z',
      source: 'thumbnailService',
      payload: {
        imagePath: 'M:/private/gallery/image.jpg',
        thumbnailPath: 'M:/private/cache/thumb.webp',
        success: true,
      },
    };

    emitRendererAppEvent(galleryEvent);
    emitRendererAppEvent(thumbnailEvent);

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(state.publish).toHaveBeenCalledWith('system', expect.objectContaining({
      type: 'gallery:images-imported',
      data: expect.objectContaining({
        payload: {
          galleryId: 7,
          imported: 2,
          skipped: 1,
          reason: 'scanAndImportFolder',
        },
      }),
    }));
    expect(state.publish).toHaveBeenCalledWith('system', expect.objectContaining({
      type: 'thumbnail:generated',
      data: expect.objectContaining({
        payload: {
          success: true,
        },
      }),
    }));
    const publishedPayloads = state.publish.mock.calls.map(call => JSON.stringify(call[1]));
    expect(publishedPayloads.join('\n')).not.toContain('M:/private');
    await vi.waitFor(() => {
      expect(live.webContents.send).toHaveBeenCalledWith('system:app-event', galleryEvent);
      expect(live.webContents.send).toHaveBeenCalledWith('system:app-event', thumbnailEvent);
    });
  });

  it('continues renderer window broadcast when API event publishing fails', async () => {
    const live = {
      destroyed: false,
      webContents: { send: vi.fn() },
      isDestroyed() { return this.destroyed; },
    };
    state.windows = [live];
    state.publish.mockImplementationOnce(() => {
      throw new Error('publish failed');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const event: RendererAppEvent = {
      type: 'bulk-download:sessions-changed',
      version: 1,
      occurredAt: '2026-05-24T00:00:00.000Z',
      source: 'bulkDownloadService',
      payload: { sessionId: 's1', reason: 'created' },
    };

    const { emitRendererAppEvent } = await import('../../../src/main/services/rendererEventBus.js');
    expect(() => emitRendererAppEvent(event)).not.toThrow();

    await vi.waitFor(() => {
      expect(live.webContents.send).toHaveBeenCalledWith('system:app-event', event);
      expect(warnSpy).toHaveBeenCalledWith(
        '[rendererEventBus] API event bridge publish failed:',
        event.type,
        'publish failed',
      );
    });
    warnSpy.mockRestore();
  });
});
