import { describe, expect, it } from 'vitest';

import { canOpenWikiTitleQuery } from '../../../src/renderer/utils/booruQuery';

describe('canOpenWikiTitleQuery', () => {
  it('单个普通标签应允许打开 Wiki', () => {
    expect(canOpenWikiTitleQuery('touhou')).toBe(true);
    expect(canOpenWikiTitleQuery('hakurei_reimu')).toBe(true);
  });

  it('包含空格的复合查询不应允许打开 Wiki', () => {
    expect(canOpenWikiTitleQuery('touhou rating:s')).toBe(false);
    expect(canOpenWikiTitleQuery('blue_eyes long_hair')).toBe(false);
  });

  it('meta tag 查询不应允许打开 Wiki', () => {
    expect(canOpenWikiTitleQuery('rating:s')).toBe(false);
    expect(canOpenWikiTitleQuery('score:>10')).toBe(false);
  });

  it('排除标签和空值不应允许打开 Wiki', () => {
    expect(canOpenWikiTitleQuery('-touhou')).toBe(false);
    expect(canOpenWikiTitleQuery('~touhou')).toBe(false);
    expect(canOpenWikiTitleQuery('   ')).toBe(false);
  });
});
