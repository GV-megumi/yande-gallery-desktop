import { useEffect, useMemo, useState } from 'react';
import type { BooruPost } from '../../shared/types';

type ToggleFavoriteResult = {
  success: boolean;
  isFavorited: boolean;
};

type DownloadResult = {
  success: boolean;
  error?: string;
};

type UpdatePosts = (updater: (posts: BooruPost[]) => BooruPost[]) => void;

type ActionMessage = {
  success: (content: string) => void;
  error: (content: string) => void;
};

interface CreateBooruPostActionsOptions {
  siteId: number | null;
  updatePosts: UpdatePosts;
  toggleLocalFavorite: (post: BooruPost) => Promise<ToggleFavoriteResult>;
  addToDownload: (postId: number, siteId: number) => Promise<DownloadResult>;
  serverFavorite: (siteId: number, postId: number) => Promise<unknown>;
  serverUnfavorite: (siteId: number, postId: number) => Promise<unknown>;
  message: ActionMessage;
}

interface BooruPostActionsState {
  selectedPost: BooruPost | null;
  detailOpen: boolean;
  serverFavorites: Set<number>;
}

interface BooruPostActions {
  selectedPost: BooruPost | null;
  detailOpen: boolean;
  serverFavorites: Set<number>;
  openDetails: (post: BooruPost) => void;
  closeDetails: () => void;
  toggleFavorite: (post: BooruPost) => Promise<void>;
  toggleServerFavorite: (post: BooruPost) => Promise<void>;
  download: (post: BooruPost) => Promise<void>;
  isServerFavorited: (post: BooruPost) => boolean;
}

export function createBooruPostActions(options: CreateBooruPostActionsOptions): BooruPostActions {
  const state: BooruPostActionsState = {
    selectedPost: null,
    detailOpen: false,
    serverFavorites: new Set<number>(),
  };

  const openDetails = (post: BooruPost) => {
    state.selectedPost = post;
    state.detailOpen = true;
  };

  const closeDetails = () => {
    state.selectedPost = null;
    state.detailOpen = false;
  };

  const toggleFavorite = async (post: BooruPost) => {
    const result = await options.toggleLocalFavorite(post);
    if (!result.success) {
      options.message.error('操作失败');
      return;
    }

    options.updatePosts(posts => posts.map(item => (
      item.postId === post.postId ? { ...item, isFavorited: result.isFavorited } : item
    )));
  };

  const isServerFavorited = (post: BooruPost) => state.serverFavorites.has(post.postId) || !!post.isLiked;

  const toggleServerFavorite = async (post: BooruPost) => {
    if (!options.siteId) return;

    const favored = isServerFavorited(post);
    try {
      if (favored) {
        await options.serverUnfavorite(options.siteId, post.postId);
        state.serverFavorites.delete(post.postId);
        options.updatePosts(posts => posts.map(item => (
          item.postId === post.postId ? { ...item, isLiked: false } : item
        )));
        options.message.success('已取消喜欢');
      } else {
        await options.serverFavorite(options.siteId, post.postId);
        state.serverFavorites.add(post.postId);
        options.updatePosts(posts => posts.map(item => (
          item.postId === post.postId ? { ...item, isLiked: true } : item
        )));
        options.message.success('已喜欢');
      }
      state.serverFavorites = new Set(state.serverFavorites);
    } catch {
      options.message.error('操作失败');
    }
  };

  const download = async (post: BooruPost) => {
    if (!options.siteId) return;

    try {
      const result = await options.addToDownload(post.postId, options.siteId);
      if (result.success) {
        options.message.success('已添加到下载队列');
      } else {
        options.message.error('下载失败: ' + result.error);
      }
    } catch {
      options.message.error('下载失败');
    }
  };

  return {
    get selectedPost() {
      return state.selectedPost;
    },
    get detailOpen() {
      return state.detailOpen;
    },
    get serverFavorites() {
      return state.serverFavorites;
    },
    openDetails,
    closeDetails,
    toggleFavorite,
    toggleServerFavorite,
    download,
    isServerFavorited,
  };
}

export function useBooruPostActions(options: CreateBooruPostActionsOptions): BooruPostActions {
  const [selectedPost, setSelectedPost] = useState<BooruPost | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [serverFavorites, setServerFavorites] = useState<Set<number>>(new Set());

  useEffect(() => {
    setServerFavorites(new Set());
  }, [options.siteId]);

  return useMemo(() => ({
    selectedPost,
    detailOpen,
    serverFavorites,
    openDetails: (post: BooruPost) => {
      setSelectedPost(post);
      setDetailOpen(true);
    },
    closeDetails: () => {
      setSelectedPost(null);
      setDetailOpen(false);
    },
    toggleFavorite: async (post: BooruPost) => {
      const result = await options.toggleLocalFavorite(post);
      if (!result.success) {
        options.message.error('操作失败');
        return;
      }

      options.updatePosts(posts => posts.map(item => (
        item.postId === post.postId ? { ...item, isFavorited: result.isFavorited } : item
      )));
    },
    toggleServerFavorite: async (post: BooruPost) => {
      if (!options.siteId) return;

      const favored = serverFavorites.has(post.postId) || !!post.isLiked;
      try {
        if (favored) {
          await options.serverUnfavorite(options.siteId, post.postId);
          setServerFavorites(prev => {
            const next = new Set(prev);
            next.delete(post.postId);
            return next;
          });
          options.updatePosts(posts => posts.map(item => (
            item.postId === post.postId ? { ...item, isLiked: false } : item
          )));
          options.message.success('已取消喜欢');
        } else {
          await options.serverFavorite(options.siteId, post.postId);
          setServerFavorites(prev => {
            const next = new Set(prev);
            next.add(post.postId);
            return next;
          });
          options.updatePosts(posts => posts.map(item => (
            item.postId === post.postId ? { ...item, isLiked: true } : item
          )));
          options.message.success('已喜欢');
        }
      } catch {
        options.message.error('操作失败');
      }
    },
    download: async (post: BooruPost) => {
      if (!options.siteId) return;

      try {
        const result = await options.addToDownload(post.postId, options.siteId);
        if (result.success) {
          options.message.success('已添加到下载队列');
        } else {
          options.message.error('下载失败: ' + result.error);
        }
      } catch {
        options.message.error('下载失败');
      }
    },
    isServerFavorited: (post: BooruPost) => serverFavorites.has(post.postId) || !!post.isLiked,
  }), [detailOpen, options, selectedPost, serverFavorites]);
}
