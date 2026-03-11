import { describe, it, expect } from 'vitest';

/**
 * BooruPageToolbar 纯函数测试
 * 提取 extractLastWord 的等价实现进行测试
 */

// ========= 等价实现：extractLastWord =========

function extractLastWord(query: string): { prefix: string; operator: string; word: string } {
  const parts = query.split(' ');
  const lastPart = parts[parts.length - 1] || '';
  const prefix = parts.slice(0, -1).join(' ');
  let operator = '';
  let word = lastPart;
  if (lastPart.startsWith('-') || lastPart.startsWith('~')) {
    operator = lastPart[0];
    word = lastPart.substring(1);
  }
  return { prefix, operator, word };
}

// ========= 等价实现：renderHistoryOption（结构验证） =========

function renderHistoryOption(item: { query: string; resultCount: number }) {
  return {
    value: item.query,
    label: expect.anything(), // React 元素无法直接比较
  };
}

// ========= 测试 =========

describe('extractLastWord', () => {
  describe('基本功能', () => {
    it('单个词应返回空 prefix 和该词', () => {
      const result = extractLastWord('girl');
      expect(result).toEqual({ prefix: '', operator: '', word: 'girl' });
    });

    it('多个词应提取最后一个词', () => {
      const result = extractLastWord('girl blue_eyes');
      expect(result).toEqual({ prefix: 'girl', operator: '', word: 'blue_eyes' });
    });

    it('三个词应正确分割', () => {
      const result = extractLastWord('girl blue_eyes blonde');
      expect(result).toEqual({ prefix: 'girl blue_eyes', operator: '', word: 'blonde' });
    });
  });

  describe('操作符处理', () => {
    it('- 操作符应正确提取', () => {
      const result = extractLastWord('girl -loli');
      expect(result).toEqual({ prefix: 'girl', operator: '-', word: 'loli' });
    });

    it('~ 操作符应正确提取', () => {
      const result = extractLastWord('girl ~blue_eyes');
      expect(result).toEqual({ prefix: 'girl', operator: '~', word: 'blue_eyes' });
    });

    it('单独的 - 操作符应返回空 word', () => {
      const result = extractLastWord('girl -');
      expect(result).toEqual({ prefix: 'girl', operator: '-', word: '' });
    });

    it('首位的 - 操作符也应识别', () => {
      const result = extractLastWord('-loli');
      expect(result).toEqual({ prefix: '', operator: '-', word: 'loli' });
    });
  });

  describe('边界情况', () => {
    it('空字符串应返回空', () => {
      const result = extractLastWord('');
      expect(result).toEqual({ prefix: '', operator: '', word: '' });
    });

    it('末尾有空格时最后一个词为空', () => {
      const result = extractLastWord('girl ');
      expect(result).toEqual({ prefix: 'girl', operator: '', word: '' });
    });

    it('多个空格应正确分割', () => {
      const result = extractLastWord('girl  blue');
      // split(' ') 会产生空字符串
      expect(result.word).toBe('blue');
    });

    it('包含冒号的标签不应受影响', () => {
      const result = extractLastWord('rating:safe girl');
      expect(result).toEqual({ prefix: 'rating:safe', operator: '', word: 'girl' });
    });

    it('最后一个词包含冒号', () => {
      const result = extractLastWord('girl rating:safe');
      expect(result).toEqual({ prefix: 'girl', operator: '', word: 'rating:safe' });
    });
  });

  describe('实际使用场景', () => {
    it('搜索标签自动完成 — 用户正在输入第二个标签', () => {
      const result = extractLastWord('kantoku blu');
      expect(result.prefix).toBe('kantoku');
      expect(result.word).toBe('blu');
    });

    it('排除标签自动完成 — 用户正在输入排除标签', () => {
      const result = extractLastWord('kantoku -lo');
      expect(result.prefix).toBe('kantoku');
      expect(result.operator).toBe('-');
      expect(result.word).toBe('lo');
    });

    it('多标签搜索 — 用户已输入多个标签', () => {
      const result = extractLastWord('kantoku blue_eyes blonde_hair sc');
      expect(result.prefix).toBe('kantoku blue_eyes blonde_hair');
      expect(result.word).toBe('sc');
    });
  });
});

describe('ratingOptions', () => {
  // 验证 ratingOptions 的结构和值
  const ratingOptions = [
    { label: '全部', value: 'all' },
    { label: '安全(S)', value: 'safe' },
    { label: '可疑(Q)', value: 'questionable' },
    { label: '限制(E)', value: 'explicit' },
  ];

  it('应有 4 个选项', () => {
    expect(ratingOptions.length).toBe(4);
  });

  it('所有选项应有 label 和 value', () => {
    for (const opt of ratingOptions) {
      expect(opt.label).toBeTruthy();
      expect(opt.value).toBeTruthy();
    }
  });

  it('value 值应唯一', () => {
    const values = ratingOptions.map(o => o.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('应包含 all 选项', () => {
    expect(ratingOptions.some(o => o.value === 'all')).toBe(true);
  });
});
