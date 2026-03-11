import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * useFavorite Hook 纯逻辑测试
 * 提取收藏逻辑的核心部分进行测试（不依赖 React Hooks）
 */

// ========= 等价实现：收藏逻辑 =========

interface Post {
  postId: number;
  isFavorited?: boolean;
}

interface FavoriteAPI {
  addFavorite: (postId: number, siteId: number, isServer: boolean) => Promise<{ success: boolean; error?: string }>;
  removeFavorite: (postId: number) => Promise<{ success: boolean; error?: string }>;
}

class FavoriteManager {
  private favorites = new Set<number>();
  private siteId: number | null;
  private api: FavoriteAPI | null;

  constructor(siteId: number | null, api: FavoriteAPI | null) {
    this.siteId = siteId;
    this.api = api;
  }

  isFavorited(post: Post): boolean {
    return this.favorites.has(post.postId) || !!post.isFavorited;
  }

  async toggleFavorite(post: Post): Promise<{ success: boolean; isFavorited: boolean }> {
    const currentlyFavorited = this.favorites.has(post.postId) || !!post.isFavorited;

    if (!this.api || !this.siteId) {
      return { success: false, isFavorited: currentlyFavorited };
    }

    try {
      if (currentlyFavorited) {
        const result = await this.api.removeFavorite(post.postId);
        if (result.success) {
          this.favorites.delete(post.postId);
          return { success: true, isFavorited: false };
        }
        return { success: false, isFavorited: currentlyFavorited };
      } else {
        const result = await this.api.addFavorite(post.postId, this.siteId, false);
        if (result.success) {
          this.favorites.add(post.postId);
          return { success: true, isFavorited: true };
        }
        return { success: false, isFavorited: currentlyFavorited };
      }
    } catch {
      return { success: false, isFavorited: currentlyFavorited };
    }
  }

  loadFavoritesFromPosts(posts: Post[]): void {
    this.favorites.clear();
    for (const post of posts) {
      if (post.isFavorited) {
        this.favorites.add(post.postId);
      }
    }
  }

  get favoriteSet(): Set<number> {
    return new Set(this.favorites);
  }
}

// ========= 测试 =========

describe('FavoriteManager（useFavorite 等价逻辑）', () => {
  let mockAPI: FavoriteAPI;

  beforeEach(() => {
    mockAPI = {
      addFavorite: vi.fn().mockResolvedValue({ success: true }),
      removeFavorite: vi.fn().mockResolvedValue({ success: true }),
    };
  });

  describe('isFavorited', () => {
    it('在 favorites Set 中的帖子应返回 true', () => {
      const manager = new FavoriteManager(1, mockAPI);
      manager.loadFavoritesFromPosts([{ postId: 100, isFavorited: true }]);
      expect(manager.isFavorited({ postId: 100 })).toBe(true);
    });

    it('post.isFavorited 为 true 时应返回 true', () => {
      const manager = new FavoriteManager(1, mockAPI);
      expect(manager.isFavorited({ postId: 100, isFavorited: true })).toBe(true);
    });

    it('既不在 Set 中也无 isFavorited 标记时应返回 false', () => {
      const manager = new FavoriteManager(1, mockAPI);
      expect(manager.isFavorited({ postId: 100 })).toBe(false);
    });

    it('isFavorited 为 false 且不在 Set 中应返回 false', () => {
      const manager = new FavoriteManager(1, mockAPI);
      expect(manager.isFavorited({ postId: 100, isFavorited: false })).toBe(false);
    });
  });

  describe('toggleFavorite — 添加收藏', () => {
    it('未收藏时应调用 addFavorite 并更新状态', async () => {
      const manager = new FavoriteManager(1, mockAPI);
      const result = await manager.toggleFavorite({ postId: 100 });

      expect(result).toEqual({ success: true, isFavorited: true });
      expect(mockAPI.addFavorite).toHaveBeenCalledWith(100, 1, false);
      expect(manager.isFavorited({ postId: 100 })).toBe(true);
    });

    it('addFavorite 失败时不应更新状态', async () => {
      (mockAPI.addFavorite as any).mockResolvedValueOnce({ success: false, error: 'Server error' });
      const manager = new FavoriteManager(1, mockAPI);
      const result = await manager.toggleFavorite({ postId: 100 });

      expect(result).toEqual({ success: false, isFavorited: false });
      expect(manager.isFavorited({ postId: 100 })).toBe(false);
    });
  });

  describe('toggleFavorite — 取消收藏', () => {
    it('已收藏时应调用 removeFavorite 并更新状态', async () => {
      const manager = new FavoriteManager(1, mockAPI);
      manager.loadFavoritesFromPosts([{ postId: 100, isFavorited: true }]);

      const result = await manager.toggleFavorite({ postId: 100 });

      expect(result).toEqual({ success: true, isFavorited: false });
      expect(mockAPI.removeFavorite).toHaveBeenCalledWith(100);
      expect(manager.isFavorited({ postId: 100 })).toBe(false);
    });

    it('removeFavorite 失败时不应更新状态', async () => {
      (mockAPI.removeFavorite as any).mockResolvedValueOnce({ success: false, error: 'Server error' });
      const manager = new FavoriteManager(1, mockAPI);
      manager.loadFavoritesFromPosts([{ postId: 100, isFavorited: true }]);

      const result = await manager.toggleFavorite({ postId: 100 });

      expect(result).toEqual({ success: false, isFavorited: true });
      expect(manager.isFavorited({ postId: 100 })).toBe(true);
    });
  });

  describe('toggleFavorite — 错误处理', () => {
    it('API 抛出异常时应返回失败', async () => {
      (mockAPI.addFavorite as any).mockRejectedValueOnce(new Error('Network error'));
      const manager = new FavoriteManager(1, mockAPI);
      const result = await manager.toggleFavorite({ postId: 100 });

      expect(result).toEqual({ success: false, isFavorited: false });
    });

    it('无 API 时应返回失败', async () => {
      const manager = new FavoriteManager(1, null);
      const result = await manager.toggleFavorite({ postId: 100 });

      expect(result).toEqual({ success: false, isFavorited: false });
    });

    it('无 siteId 时应返回失败', async () => {
      const manager = new FavoriteManager(null, mockAPI);
      const result = await manager.toggleFavorite({ postId: 100 });

      expect(result).toEqual({ success: false, isFavorited: false });
    });
  });

  describe('loadFavoritesFromPosts', () => {
    it('应从帖子列表中提取已收藏的帖子 ID', () => {
      const manager = new FavoriteManager(1, mockAPI);
      manager.loadFavoritesFromPosts([
        { postId: 1, isFavorited: true },
        { postId: 2, isFavorited: false },
        { postId: 3, isFavorited: true },
        { postId: 4 },
      ]);

      expect(manager.favoriteSet.size).toBe(2);
      expect(manager.isFavorited({ postId: 1 })).toBe(true);
      expect(manager.isFavorited({ postId: 2 })).toBe(false);
      expect(manager.isFavorited({ postId: 3 })).toBe(true);
    });

    it('空帖子列表应清空收藏', () => {
      const manager = new FavoriteManager(1, mockAPI);
      manager.loadFavoritesFromPosts([{ postId: 1, isFavorited: true }]);
      expect(manager.favoriteSet.size).toBe(1);

      manager.loadFavoritesFromPosts([]);
      expect(manager.favoriteSet.size).toBe(0);
    });

    it('应覆盖之前的收藏状态', () => {
      const manager = new FavoriteManager(1, mockAPI);
      manager.loadFavoritesFromPosts([{ postId: 1, isFavorited: true }]);
      manager.loadFavoritesFromPosts([{ postId: 2, isFavorited: true }]);

      expect(manager.isFavorited({ postId: 1 })).toBe(false);
      expect(manager.isFavorited({ postId: 2 })).toBe(true);
    });
  });

  describe('连续操作', () => {
    it('添加后取消应恢复原状', async () => {
      const manager = new FavoriteManager(1, mockAPI);

      // 添加收藏
      await manager.toggleFavorite({ postId: 100 });
      expect(manager.isFavorited({ postId: 100 })).toBe(true);

      // 取消收藏
      await manager.toggleFavorite({ postId: 100 });
      expect(manager.isFavorited({ postId: 100 })).toBe(false);
    });

    it('多个帖子独立操作', async () => {
      const manager = new FavoriteManager(1, mockAPI);

      await manager.toggleFavorite({ postId: 1 });
      await manager.toggleFavorite({ postId: 2 });
      await manager.toggleFavorite({ postId: 3 });

      expect(manager.isFavorited({ postId: 1 })).toBe(true);
      expect(manager.isFavorited({ postId: 2 })).toBe(true);
      expect(manager.isFavorited({ postId: 3 })).toBe(true);

      await manager.toggleFavorite({ postId: 2 });
      expect(manager.isFavorited({ postId: 1 })).toBe(true);
      expect(manager.isFavorited({ postId: 2 })).toBe(false);
      expect(manager.isFavorited({ postId: 3 })).toBe(true);
    });
  });
});
