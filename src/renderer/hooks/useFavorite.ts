/**
 * 收藏状态管理 Hook
 * 提取自 BooruPage、BooruTagSearchPage、BooruFavoritesPage 的重复收藏逻辑
 */

import { useState, useCallback } from 'react';
import { BooruPost } from '../../shared/types';

interface UseFavoriteOptions {
  /** 当前选中的站点 ID */
  siteId: number | null;
  /** 收藏切换成功后的回调 */
  onSuccess?: (postId: number, isFavorited: boolean) => void;
  /** 日志前缀 */
  logPrefix?: string;
}

interface UseFavoriteReturn {
  /** 收藏 ID 集合 */
  favorites: Set<number>;
  /** 设置收藏集合 */
  setFavorites: React.Dispatch<React.SetStateAction<Set<number>>>;
  /** 判断是否已收藏 */
  isFavorited: (post: BooruPost) => boolean;
  /** 切换收藏状态，返回操作结果 */
  toggleFavorite: (post: BooruPost) => Promise<{ success: boolean; isFavorited: boolean }>;
  /** 从 posts 数据中提取收藏状态 */
  loadFavoritesFromPosts: (posts: BooruPost[]) => void;
}

/**
 * 收藏状态管理 Hook
 *
 * 统一处理收藏的添加、移除和状态管理
 */
export function useFavorite({
  siteId,
  onSuccess,
  logPrefix = '[useFavorite]'
}: UseFavoriteOptions): UseFavoriteReturn {
  const [favorites, setFavorites] = useState<Set<number>>(new Set());

  /** 判断是否已收藏 */
  const isFavorited = useCallback((post: BooruPost): boolean => {
    return favorites.has(post.postId) || !!post.isFavorited;
  }, [favorites]);

  /** 切换收藏状态 */
  const toggleFavorite = useCallback(async (post: BooruPost): Promise<{ success: boolean; isFavorited: boolean }> => {
    const currentlyFavorited = favorites.has(post.postId) || !!post.isFavorited;
    console.log(`${logPrefix} 切换收藏状态:`, post.postId, '当前:', currentlyFavorited);

    if (!window.electronAPI || !siteId) {
      return { success: false, isFavorited: currentlyFavorited };
    }

    try {
      if (currentlyFavorited) {
        // 取消收藏
        const result = await window.electronAPI.booru.removeFavorite(post.postId);
        if (result.success) {
          console.log(`${logPrefix} 取消收藏成功:`, post.postId);
          setFavorites(prev => {
            const newSet = new Set(prev);
            newSet.delete(post.postId);
            return newSet;
          });
          onSuccess?.(post.postId, false);
          return { success: true, isFavorited: false };
        } else {
          console.error(`${logPrefix} 取消收藏失败:`, result.error);
          return { success: false, isFavorited: currentlyFavorited };
        }
      } else {
        // 添加收藏
        const result = await window.electronAPI.booru.addFavorite(post.postId, siteId, false);
        if (result.success) {
          console.log(`${logPrefix} 添加收藏成功:`, post.postId);
          setFavorites(prev => {
            const newSet = new Set(prev);
            newSet.add(post.postId);
            return newSet;
          });
          onSuccess?.(post.postId, true);
          return { success: true, isFavorited: true };
        } else {
          console.error(`${logPrefix} 添加收藏失败:`, result.error);
          return { success: false, isFavorited: currentlyFavorited };
        }
      }
    } catch (error) {
      console.error(`${logPrefix} 切换收藏失败:`, error);
      return { success: false, isFavorited: currentlyFavorited };
    }
  }, [favorites, siteId, logPrefix, onSuccess]);

  /** 从 posts 数据中提取收藏状态 */
  const loadFavoritesFromPosts = useCallback((posts: BooruPost[]) => {
    const favoriteIds = new Set<number>();
    posts.forEach(post => {
      if (post.isFavorited) {
        favoriteIds.add(post.postId);
      }
    });
    console.log(`${logPrefix} 收藏状态加载:`, favoriteIds.size, '个收藏');
    setFavorites(favoriteIds);
  }, [logPrefix]);

  return {
    favorites,
    setFavorites,
    isFavorited,
    toggleFavorite,
    loadFavoritesFromPosts
  };
}
