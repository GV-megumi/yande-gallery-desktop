import { describe, expect, it } from 'vitest';

function normalizeForRenderer(value: string, mode: 'dtext' | 'bbcode'): string {
  return mode === 'bbcode' ? value : value.replace(/~([\w:.-]+)/g, '{{$1}}');
}

describe('DTextRenderer normalization', () => {
  it('converts DText tag references to internal tag tokens', () => {
    expect(normalizeForRenderer('see ~blue_eyes', 'dtext')).toBe('see {{blue_eyes}}');
  });

  it('keeps bbcode input untouched', () => {
    expect(normalizeForRenderer('[b]bold[/b]', 'bbcode')).toBe('[b]bold[/b]');
  });

  it('keeps wiki links intact for downstream rendering', () => {
    expect(normalizeForRenderer('[[blue_eyes]]', 'dtext')).toBe('[[blue_eyes]]');
  });
});
