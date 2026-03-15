import { BooruPost } from '../../shared/types';

export function toggleSelectedPost(current: Set<number>, postId: number): Set<number> {
  const next = new Set(current);
  if (next.has(postId)) {
    next.delete(postId);
  } else {
    next.add(postId);
  }
  return next;
}

export function getCommonPostTags(posts: BooruPost[]): string[] {
  if (posts.length === 0) {
    return [];
  }

  const [first, ...rest] = posts;
  const common = new Set(first.tags.split(/\s+/).filter(Boolean));
  for (const post of rest) {
    const tags = new Set(post.tags.split(/\s+/).filter(Boolean));
    for (const tag of [...common]) {
      if (!tags.has(tag)) {
        common.delete(tag);
      }
    }
  }
  return [...common].sort();
}
