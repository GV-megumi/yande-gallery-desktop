import { describe, expect, it } from 'vitest';
import { getDirectImplicationTags, resolveCanonicalTag } from '../../../src/renderer/utils/tagRelationships';

describe('tagRelationships helpers', () => {
  const relationships = {
    aliases: [
      { id: 1, antecedent_name: 'old_tag', consequent_name: 'new_tag', status: 'active' },
    ],
    implications: [
      { id: 2, antecedent_name: 'old_tag', consequent_name: 'blue_eyes', status: 'active' },
      { id: 3, antecedent_name: 'old_tag', consequent_name: 'solo', status: 'active' },
    ],
  };

  it('resolves direct aliases to canonical tags', () => {
    expect(resolveCanonicalTag('old_tag', relationships)).toBe('new_tag');
    expect(resolveCanonicalTag('girl', relationships)).toBe('girl');
  });

  it('collects direct implications for a tag', () => {
    expect(getDirectImplicationTags('old_tag', relationships)).toEqual(['blue_eyes', 'solo']);
  });
});
