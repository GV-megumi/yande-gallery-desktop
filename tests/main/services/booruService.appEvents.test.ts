import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = {};
const getMock = vi.fn();
const runMock = vi.fn();
const runWithChangesMock = vi.fn();
const emitBooruPostFavoriteChanged = vi.fn();
const emitBooruPostServerFavoriteChanged = vi.fn();
const emitBooruBlacklistTagsChanged = vi.fn();
const emitBooruSitesChanged = vi.fn();
const emitBooruFavoriteGroupsChanged = vi.fn();
const emitBooruSavedSearchesChanged = vi.fn();
const emitBooruSearchHistoryChanged = vi.fn();
const emitBooruPostDownloadStateChanged = vi.fn();
const emitBooruPostVoteChanged = vi.fn();
const votePostMock = vi.fn();

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
  },
}));

vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn(),
    readFile: vi.fn(),
  },
  stat: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('../../../src/main/services/database.js', () => ({
  getDatabase: vi.fn(async () => db),
  get: (...args: any[]) => getMock(...args),
  run: (...args: any[]) => runMock(...args),
  runWithChanges: (...args: any[]) => runWithChangesMock(...args),
  all: vi.fn(async () => []),
  runInTransaction: async (_db: any, fn: () => Promise<any>) => fn(),
}));

vi.mock('../../../src/main/services/config.js', () => ({
  getConfig: vi.fn(() => ({ downloads: { path: 'D:/downloads' } })),
  resolveConfigPath: (value: string) => value,
}));

vi.mock('../../../src/main/services/galleryService.js', () => ({
  createGallery: vi.fn(),
  getGallery: vi.fn(),
  updateGalleryStats: vi.fn(),
}));

vi.mock('../../../src/main/services/imageService.js', () => ({
  scanAndImportFolder: vi.fn(),
}));

vi.mock('../../../src/main/services/booruClientFactory.js', () => ({
  createBooruClient: vi.fn(() => ({
    votePost: votePostMock,
  })),
}));

vi.mock('../../../src/main/services/appEventPublisher.js', () => ({
  emitBooruPostFavoriteChanged,
  emitBooruPostServerFavoriteChanged,
  emitBooruBlacklistTagsChanged,
  emitBooruSitesChanged,
  emitBooruFavoriteGroupsChanged,
  emitBooruSavedSearchesChanged,
  emitBooruSearchHistoryChanged,
  emitBooruPostDownloadStateChanged,
  emitBooruPostVoteChanged,
}));

describe('booruService app events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    runMock.mockResolvedValue(undefined);
    runWithChangesMock.mockResolvedValue({ changes: 1 });
    votePostMock.mockResolvedValue(undefined);
  });

  it('emits a post favorite added event after inserting a favorite', async () => {
    getMock
      .mockResolvedValueOnce({ id: 10 })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: 22 });

    const { addToFavorites } = await import('../../../src/main/services/booruService.js');

    await expect(addToFavorites(101, 2)).resolves.toBe(22);

    expect(emitBooruPostFavoriteChanged).toHaveBeenCalledWith({
      action: 'added',
      siteId: 2,
      postId: 101,
      dbPostId: 10,
      favoriteId: 22,
      isFavorited: true,
      affectedCount: 1,
    });
  });

  it('repairs and emits when the favorite row already exists', async () => {
    getMock
      .mockResolvedValueOnce({ id: 10 })
      .mockResolvedValueOnce({ id: 22 });

    const { addToFavorites } = await import('../../../src/main/services/booruService.js');

    await expect(addToFavorites(101, 2)).resolves.toBe(22);

    expect(runWithChangesMock).toHaveBeenCalledWith(
      db,
      'UPDATE booru_posts SET isFavorited = 1 WHERE id = ? AND (isFavorited IS NULL OR isFavorited != 1)',
      [10],
    );
    expect(emitBooruPostFavoriteChanged).toHaveBeenCalledWith({
      action: 'repaired',
      siteId: 2,
      postId: 101,
      dbPostId: 10,
      favoriteId: 22,
      isFavorited: true,
      affectedCount: 1,
    });
  });

  it('does not emit repaired when the existing favorite needs no database repair', async () => {
    getMock
      .mockResolvedValueOnce({ id: 10 })
      .mockResolvedValueOnce({ id: 22 });
    runWithChangesMock.mockResolvedValueOnce({ changes: 0 });

    const { addToFavorites } = await import('../../../src/main/services/booruService.js');

    await expect(addToFavorites(101, 2)).resolves.toBe(22);

    expect(runWithChangesMock).toHaveBeenCalledWith(
      db,
      'UPDATE booru_posts SET isFavorited = 1 WHERE id = ? AND (isFavorited IS NULL OR isFavorited != 1)',
      [10],
    );
    expect(emitBooruPostFavoriteChanged).not.toHaveBeenCalled();
  });

  it('removes favorites only by post id and site id, then emits removed', async () => {
    getMock.mockResolvedValueOnce({ id: 10 });
    runWithChangesMock
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 1 });

    const { removeFromFavorites } = await import('../../../src/main/services/booruService.js');

    await removeFromFavorites(101, 2);

    expect(getMock).toHaveBeenCalledWith(
      db,
      'SELECT id FROM booru_posts WHERE postId = ? AND siteId = ?',
      [101, 2],
    );
    expect(emitBooruPostFavoriteChanged).toHaveBeenCalledWith({
      action: 'removed',
      siteId: 2,
      postId: 101,
      dbPostId: 10,
      isFavorited: false,
      affectedCount: 1,
    });
  });

  it('emits server favorite changes after the database write succeeds', async () => {
    runWithChangesMock.mockResolvedValueOnce({ changes: 1 });

    const { setPostLiked } = await import('../../../src/main/services/booruService.js');

    await setPostLiked(2, 101, true);

    expect(runWithChangesMock).toHaveBeenCalledWith(
      db,
      'UPDATE booru_posts SET isLiked = ? WHERE siteId = ? AND postId = ?',
      [1, 2, 101],
    );
    expect(emitBooruPostServerFavoriteChanged).toHaveBeenCalledWith({
      action: 'liked',
      siteId: 2,
      postId: 101,
      isLiked: true,
      affectedCount: 1,
    });
  });

  it('can silently sync server favorite state without broadcasting per-post events', async () => {
    runWithChangesMock.mockResolvedValueOnce({ changes: 1 });

    const { setPostLiked } = await import('../../../src/main/services/booruService.js');

    await setPostLiked(2, 101, true, { emit: false, action: 'synced' });

    expect(runWithChangesMock).toHaveBeenCalledWith(
      db,
      'UPDATE booru_posts SET isLiked = ? WHERE siteId = ? AND postId = ?',
      [1, 2, 101],
    );
    expect(emitBooruPostServerFavoriteChanged).not.toHaveBeenCalled();
  });

  it('aggregates server favorite sync into a single event with real changed post ids', async () => {
    runWithChangesMock
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 0 })
      .mockResolvedValueOnce({ changes: 1 });

    const { syncPostLikedStates } = await import('../../../src/main/services/booruService.js');

    await expect(syncPostLikedStates(2, [101, 102, 101, 103])).resolves.toBe(2);

    expect(runWithChangesMock).toHaveBeenCalledTimes(3);
    expect(emitBooruPostServerFavoriteChanged).toHaveBeenCalledTimes(1);
    expect(emitBooruPostServerFavoriteChanged).toHaveBeenCalledWith({
      action: 'synced',
      siteId: 2,
      postIds: [101, 103],
      isLiked: true,
      affectedCount: 2,
    });
  });

  it('emits a vote event from the service after the remote vote succeeds', async () => {
    getMock.mockResolvedValueOnce({
      id: 2,
      username: 'alice',
      passwordHash: 'secret',
    });

    const { votePost } = await import('../../../src/main/services/booruService.js');

    await expect(votePost(2, 101, 1)).resolves.toBeUndefined();

    expect(votePostMock).toHaveBeenCalledWith(101, 1);
    expect(emitBooruPostVoteChanged).toHaveBeenCalledWith({
      siteId: 2,
      postId: 101,
      vote: 1,
    });
  });

  it('does not swallow database errors from setPostLiked', async () => {
    const error = new Error('db failed');
    runWithChangesMock.mockRejectedValueOnce(error);

    const { setPostLiked } = await import('../../../src/main/services/booruService.js');

    await expect(setPostLiked(2, 101, false)).rejects.toThrow('db failed');
    expect(emitBooruPostServerFavoriteChanged).not.toHaveBeenCalled();
  });

  it('emits a single created blacklist event for single inserts', async () => {
    getMock.mockResolvedValueOnce({
      id: 5,
      siteId: 2,
      tagName: 'tag_a',
      isActive: 1,
      reason: null,
      createdAt: '2026-06-09T00:00:00.000Z',
      updatedAt: '2026-06-09T00:00:00.000Z',
    });

    const { addBlacklistedTag } = await import('../../../src/main/services/booruService.js');

    await addBlacklistedTag('tag_a', 2);

    expect(emitBooruBlacklistTagsChanged).toHaveBeenCalledTimes(1);
    expect(emitBooruBlacklistTagsChanged).toHaveBeenCalledWith({
      action: 'created',
      siteId: 2,
      blacklistTagId: 5,
      tagName: 'tag_a',
      isActive: true,
      affectedCount: 1,
    });
  });

  it('aggregates batch blacklist creation into one event', async () => {
    getMock
      .mockResolvedValueOnce({ id: 5, siteId: 2, tagName: 'tag_a', isActive: 1 })
      .mockResolvedValueOnce({ id: 6, siteId: 2, tagName: 'tag_b', isActive: 1 });

    const { addBlacklistedTags } = await import('../../../src/main/services/booruService.js');

    await expect(addBlacklistedTags('tag_a\ntag_b', 2)).resolves.toEqual({ added: 2, skipped: 0 });

    expect(emitBooruBlacklistTagsChanged).toHaveBeenCalledTimes(1);
    expect(emitBooruBlacklistTagsChanged).toHaveBeenCalledWith({
      action: 'batchCreated',
      siteId: 2,
      affectedCount: 2,
    });
  });

  it('aggregates blacklist import into one imported event', async () => {
    getMock
      .mockResolvedValueOnce({ id: 5, siteId: 2, tagName: 'tag_a', isActive: 1 })
      .mockResolvedValueOnce({ id: 6, siteId: 2, tagName: 'tag_b', isActive: 1 });

    const { importBlacklistedTagsCommit } = await import('../../../src/main/services/booruService.js');

    await expect(importBlacklistedTagsCommit({
      records: [{ tagName: 'tag_a' }, { tagName: 'tag_b' }],
      fallbackSiteId: 2,
    })).resolves.toEqual({ imported: 2, skipped: 0 });

    expect(emitBooruBlacklistTagsChanged).toHaveBeenCalledTimes(1);
    expect(emitBooruBlacklistTagsChanged).toHaveBeenCalledWith({
      action: 'imported',
      siteId: 2,
      affectedCount: 2,
    });
  });

  it('omits siteId from aggregated blacklist import events when imported records span multiple scopes', async () => {
    getMock
      .mockResolvedValueOnce({ id: 5, siteId: 2, tagName: 'tag_a', isActive: 1 })
      .mockResolvedValueOnce({ id: 6, siteId: null, tagName: 'tag_b', isActive: 1 });

    const { importBlacklistedTagsCommit } = await import('../../../src/main/services/booruService.js');

    await expect(importBlacklistedTagsCommit({
      records: [{ tagName: 'tag_a', siteId: 2 }, { tagName: 'tag_b', siteId: null }],
      fallbackSiteId: 2,
    })).resolves.toEqual({ imported: 2, skipped: 0 });

    expect(emitBooruBlacklistTagsChanged).toHaveBeenCalledTimes(1);
    expect(emitBooruBlacklistTagsChanged).toHaveBeenCalledWith({
      action: 'imported',
      affectedCount: 2,
    });
  });

  it('emits blacklist toggle update and delete events', async () => {
    getMock
      .mockResolvedValueOnce({ id: 5, siteId: 2, tagName: 'tag_a', isActive: 1 })
      .mockResolvedValueOnce({ id: 5, siteId: 2, tagName: 'tag_a', isActive: 0 })
      .mockResolvedValueOnce({ id: 5, siteId: 2, tagName: 'tag_b', isActive: 1 });
    runWithChangesMock.mockResolvedValue({ changes: 1 });

    const {
      toggleBlacklistedTag,
      updateBlacklistedTag,
      removeBlacklistedTag,
    } = await import('../../../src/main/services/booruService.js');

    await toggleBlacklistedTag(5);
    await updateBlacklistedTag(5, { tagName: 'tag_b', isActive: true });
    await removeBlacklistedTag(5);

    expect(emitBooruBlacklistTagsChanged).toHaveBeenNthCalledWith(1, {
      action: 'toggled',
      siteId: 2,
      blacklistTagId: 5,
      tagName: 'tag_a',
      isActive: false,
      affectedCount: 1,
    });
    expect(emitBooruBlacklistTagsChanged).toHaveBeenNthCalledWith(2, {
      action: 'updated',
      siteId: 2,
      blacklistTagId: 5,
      tagName: 'tag_b',
      isActive: true,
      affectedCount: 1,
    });
    expect(emitBooruBlacklistTagsChanged).toHaveBeenNthCalledWith(3, {
      action: 'deleted',
      siteId: 2,
      blacklistTagId: 5,
      tagName: 'tag_b',
      affectedCount: 1,
    });
  });

  it('emits site lifecycle and active-site events', async () => {
    getMock.mockResolvedValueOnce({ id: 12 });
    runWithChangesMock
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 1 });

    const {
      addBooruSite,
      updateBooruSite,
      deleteBooruSite,
      setActiveBooruSite,
    } = await import('../../../src/main/services/booruService.js');

    await addBooruSite({
      name: 'Site',
      url: 'https://example.test',
      type: 'moebooru',
      favoriteSupport: true,
      active: true,
    } as any);
    await updateBooruSite(12, { name: 'New Site', active: true } as any);
    await deleteBooruSite(12);
    await setActiveBooruSite(12);

    expect(emitBooruSitesChanged).toHaveBeenNthCalledWith(1, {
      action: 'created',
      siteId: 12,
      activeSiteId: 12,
      affectedCount: 1,
    });
    expect(emitBooruSitesChanged).toHaveBeenNthCalledWith(2, {
      action: 'activeChanged',
      siteId: 12,
      activeSiteId: 12,
      changedFields: ['name', 'active'],
      affectedCount: 1,
    });
    expect(emitBooruSitesChanged).toHaveBeenNthCalledWith(3, {
      action: 'deleted',
      siteId: 12,
      affectedCount: 1,
    });
    expect(emitBooruSitesChanged).toHaveBeenNthCalledWith(4, {
      action: 'activeChanged',
      siteId: 12,
      activeSiteId: 12,
      affectedCount: 1,
    });
  });

  it('emits saved-search and search-history events', async () => {
    getMock
      .mockResolvedValueOnce({ id: 31 })
      .mockResolvedValueOnce({ id: 31, siteId: 2 })
      .mockResolvedValueOnce({ id: 31, siteId: 2 });
    runWithChangesMock
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 2 });

    const {
      addSavedSearch,
      updateSavedSearch,
      deleteSavedSearch,
      addSearchHistory,
      clearSearchHistory,
    } = await import('../../../src/main/services/booruService.js');

    await addSavedSearch(2, 'search', 'tag_a');
    await updateSavedSearch(31, { name: 'renamed' });
    await deleteSavedSearch(31);
    await addSearchHistory(2, 'tag_a', 10);
    await clearSearchHistory(2);

    expect(emitBooruSavedSearchesChanged).toHaveBeenNthCalledWith(1, {
      action: 'created',
      siteId: 2,
      searchId: 31,
      affectedCount: 1,
    });
    expect(emitBooruSavedSearchesChanged).toHaveBeenNthCalledWith(2, {
      action: 'updated',
      siteId: 2,
      searchId: 31,
      affectedCount: 1,
    });
    expect(emitBooruSavedSearchesChanged).toHaveBeenNthCalledWith(3, {
      action: 'deleted',
      siteId: 2,
      searchId: 31,
      affectedCount: 1,
    });
    expect(emitBooruSearchHistoryChanged).toHaveBeenNthCalledWith(1, {
      action: 'created',
      siteId: 2,
      affectedCount: 1,
    });
    expect(emitBooruSearchHistoryChanged).toHaveBeenNthCalledWith(2, {
      action: 'cleared',
      siteId: 2,
      affectedCount: 2,
    });
  });

  it('emits favorite-group and favorite-moved events', async () => {
    getMock
      .mockResolvedValueOnce({ id: 7, siteId: 2, name: 'Group' })
      .mockResolvedValueOnce({ id: 7, siteId: 2 })
      .mockResolvedValueOnce({ id: 7, siteId: 2 })
      .mockResolvedValueOnce({ id: 7, siteId: 2 })
      .mockResolvedValueOnce({ id: 10, siteId: 2 })
      .mockResolvedValueOnce({ id: 22 });
    runWithChangesMock
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 1 });

    const {
      createFavoriteGroup,
      updateFavoriteGroup,
      deleteFavoriteGroup,
      moveFavoriteToGroup,
    } = await import('../../../src/main/services/booruService.js');

    await createFavoriteGroup('Group', 2, '#fff');
    await updateFavoriteGroup(7, { name: 'New Group' });
    await deleteFavoriteGroup(7);
    await moveFavoriteToGroup(2, 101, 7);

    expect(emitBooruFavoriteGroupsChanged).toHaveBeenNthCalledWith(1, {
      action: 'created',
      siteId: 2,
      groupId: 7,
      affectedCount: 1,
    });
    expect(emitBooruFavoriteGroupsChanged).toHaveBeenNthCalledWith(2, {
      action: 'updated',
      siteId: 2,
      groupId: 7,
      affectedCount: 1,
    });
    expect(emitBooruFavoriteGroupsChanged).toHaveBeenNthCalledWith(3, {
      action: 'deleted',
      siteId: 2,
      groupId: 7,
      affectedCount: 1,
    });
    expect(emitBooruFavoriteGroupsChanged).toHaveBeenNthCalledWith(4, {
      action: 'favoriteMoved',
      siteId: 2,
      groupId: 7,
      postId: 101,
      favoriteId: 22,
      affectedCount: 1,
    });
    expect(emitBooruPostFavoriteChanged).toHaveBeenCalledWith({
      action: 'moved',
      siteId: 2,
      postId: 101,
      dbPostId: 10,
      groupId: 7,
      favoriteId: 22,
      isFavorited: true,
      affectedCount: 1,
    });
    expect(getMock).toHaveBeenCalledWith(
      db,
      'SELECT id, siteId FROM booru_posts WHERE postId = ? AND siteId = ?',
      [101, 2],
    );
  });

  it('rejects moving a favorite into a group from another site', async () => {
    getMock.mockResolvedValueOnce({ id: 7, siteId: 3 });

    const { moveFavoriteToGroup } = await import('../../../src/main/services/booruService.js');

    await expect(moveFavoriteToGroup(2, 101, 7)).rejects.toThrow('收藏分组不属于当前站点');
    expect(runWithChangesMock).not.toHaveBeenCalled();
    expect(emitBooruFavoriteGroupsChanged).not.toHaveBeenCalled();
    expect(emitBooruPostFavoriteChanged).not.toHaveBeenCalled();
  });

  it('emits download queue and marked-downloaded events', async () => {
    getMock
      .mockResolvedValueOnce({ id: 10 })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: 40 })
      .mockResolvedValueOnce({ siteId: 2, postId: 101 })
      .mockResolvedValueOnce({ id: 10, siteId: 2, postId: 101, status: 'pending' })
      .mockResolvedValueOnce({ id: 10, siteId: 2, postId: 101, status: 'completed' });
    runWithChangesMock
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 3 });

    const {
      addToDownloadQueue,
      markPostAsDownloaded,
      removeFromDownloadQueue,
      clearDownloadRecords,
      deleteDownloadRecord,
    } = await import('../../../src/main/services/booruService.js');

    await addToDownloadQueue(101, 2);
    await markPostAsDownloaded(10, 'D:/x.jpg', 99);
    await removeFromDownloadQueue(40);
    await clearDownloadRecords('failed');
    await deleteDownloadRecord(40);

    expect(emitBooruPostDownloadStateChanged).toHaveBeenNthCalledWith(1, {
      action: 'queued',
      queueId: 40,
      siteId: 2,
      postId: 101,
      status: 'pending',
      affectedCount: 1,
    });
    expect(emitBooruPostDownloadStateChanged).toHaveBeenNthCalledWith(2, {
      action: 'markedDownloaded',
      siteId: 2,
      postId: 101,
      downloaded: true,
      localImageId: 99,
      affectedCount: 1,
    });
    expect(emitBooruPostDownloadStateChanged).toHaveBeenNthCalledWith(3, {
      action: 'removed',
      queueId: 40,
      siteId: 2,
      postId: 101,
      status: 'pending',
      affectedCount: 1,
    });
    expect(emitBooruPostDownloadStateChanged).toHaveBeenNthCalledWith(4, {
      action: 'cleared',
      status: 'failed',
      affectedCount: 3,
    });
    expect(emitBooruPostDownloadStateChanged).toHaveBeenNthCalledWith(5, {
      action: 'removed',
      queueId: 40,
      siteId: 2,
      postId: 101,
      status: 'completed',
      affectedCount: 1,
    });
  });
});
