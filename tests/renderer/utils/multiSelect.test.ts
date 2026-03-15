import { describe, expect, it } from 'vitest';
import { getCommonPostTags, toggleSelectedPost } from '../../../src/renderer/utils/multiSelect';

describe('toggleSelectedPost', () => {
  it('adds an unselected post id', () => {
    expect([...toggleSelectedPost(new Set<number>(), 1)]).toEqual([1]);
  });

  it('removes an already selected post id', () => {
    expect([...toggleSelectedPost(new Set([1, 2]), 1)]).toEqual([2]);
  });
});

describe('getCommonPostTags', () => {
  it('returns tags shared by all selected posts', () => {
    const common = getCommonPostTags([
      { tags: 'girl blue_eyes smile' } as any,
      { tags: 'girl blue_eyes dress' } as any,
      { tags: 'girl blue_eyes solo' } as any,
    ]);
    expect(common).toEqual(['blue_eyes', 'girl']);
  });

  it('returns empty when no posts are selected', () => {
    expect(getCommonPostTags([])).toEqual([]);
  });
});
