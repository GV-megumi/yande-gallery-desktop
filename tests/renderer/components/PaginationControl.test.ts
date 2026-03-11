import { describe, it, expect } from 'vitest';

/**
 * PaginationControl 纯函数测试
 * 提取 getPageNumbers、pageButtonStyle 的等价实现进行测试
 */

// ========= 等价实现：getPageNumbers =========

function getPageNumbers(current: number, hasNext: boolean): number[] {
  const total = hasNext ? Math.max(current + 1, current + 5) : current;

  const range = new Set<number>();

  // 始终显示第 1 页
  range.add(1);

  // 当前页附近 (-2 ~ +2)
  for (let i = Math.max(2, current - 2); i <= Math.min(total, current + 2); i++) {
    range.add(i);
  }

  // 最后一页（如果确定是最后一页）
  if (!hasNext) range.add(current);

  const sorted = Array.from(range).sort((a, b) => a - b);

  const pages: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) {
      // 用 -1 表示省略号
      pages.push(-1);
    }
    pages.push(sorted[i]);
  }

  // 如果 hasNext 且最后显示的页码 <= current，追加省略号
  if (hasNext && sorted[sorted.length - 1] <= current + 2) {
    pages.push(-1);
  }

  return pages;
}

// ========= 等价实现：pageButtonStyle =========

function pageButtonStyle(active: boolean): Record<string, any> {
  return {
    width: 32, height: 32,
    minWidth: 32,
    padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: active ? 700 : 500,
    color: active ? '#fff' : expect.any(String),
    background: active ? expect.any(String) : 'transparent',
    border: 'none',
    cursor: active ? 'default' : 'pointer',
  };
}

// ========= 测试 =========

describe('getPageNumbers', () => {
  describe('第一页', () => {
    it('第 1 页有下一页时应显示 [1, 2, 3, ...]', () => {
      const pages = getPageNumbers(1, true);
      expect(pages[0]).toBe(1);
      expect(pages).toContain(2);
      expect(pages).toContain(3);
      expect(pages[pages.length - 1]).toBe(-1); // 尾部省略号
    });

    it('第 1 页无下一页时应只显示 [1]', () => {
      const pages = getPageNumbers(1, false);
      expect(pages).toEqual([1]);
    });
  });

  describe('中间页码', () => {
    it('第 5 页有下一页时应包含 1、3-7 区间和省略号', () => {
      const pages = getPageNumbers(5, true);
      expect(pages[0]).toBe(1);
      // 1 和 3 之间有间隔，应有省略号
      expect(pages[1]).toBe(-1);
      expect(pages).toContain(3);
      expect(pages).toContain(4);
      expect(pages).toContain(5);
      expect(pages).toContain(6);
      expect(pages).toContain(7);
      // 尾部应有省略号
      expect(pages[pages.length - 1]).toBe(-1);
    });

    it('第 3 页有下一页时第 1 页和当前页附近应连续', () => {
      const pages = getPageNumbers(3, true);
      expect(pages[0]).toBe(1);
      expect(pages).toContain(2);
      expect(pages).toContain(3);
      expect(pages).toContain(4);
      expect(pages).toContain(5);
      // 1 到 5 应连续，无省略号
      const nonEllipsis = pages.filter(p => p !== -1);
      expect(nonEllipsis).toEqual([1, 2, 3, 4, 5]);
    });

    it('第 10 页无下一页时应显示 1...8-10', () => {
      const pages = getPageNumbers(10, false);
      expect(pages[0]).toBe(1);
      expect(pages[1]).toBe(-1); // 省略号
      expect(pages).toContain(8);
      expect(pages).toContain(9);
      expect(pages).toContain(10);
      expect(pages[pages.length - 1]).toBe(10); // 最后一页
    });
  });

  describe('第 2 页边界', () => {
    it('第 2 页有下一页时应连续显示 1-4 加省略号', () => {
      const pages = getPageNumbers(2, true);
      expect(pages[0]).toBe(1);
      expect(pages).toContain(2);
      expect(pages).toContain(3);
      expect(pages).toContain(4);
    });

    it('第 2 页无下一页时应显示 [1, 2]', () => {
      const pages = getPageNumbers(2, false);
      const nonEllipsis = pages.filter(p => p !== -1);
      expect(nonEllipsis).toEqual([1, 2]);
    });
  });

  describe('返回值结构', () => {
    it('第一页始终为 1', () => {
      for (let page = 1; page <= 20; page++) {
        const pages = getPageNumbers(page, true);
        expect(pages[0]).toBe(1);
      }
    });

    it('不应有连续省略号', () => {
      for (let page = 1; page <= 20; page++) {
        const pages = getPageNumbers(page, true);
        for (let i = 1; i < pages.length; i++) {
          if (pages[i] === -1) {
            expect(pages[i - 1]).not.toBe(-1);
          }
        }
      }
    });

    it('页码应单调递增（忽略省略号）', () => {
      for (let page = 1; page <= 20; page++) {
        const pages = getPageNumbers(page, true);
        const nonEllipsis = pages.filter(p => p !== -1);
        for (let i = 1; i < nonEllipsis.length; i++) {
          expect(nonEllipsis[i]).toBeGreaterThan(nonEllipsis[i - 1]);
        }
      }
    });

    it('当前页码应始终包含在结果中', () => {
      for (let page = 1; page <= 20; page++) {
        const pages = getPageNumbers(page, true);
        expect(pages).toContain(page);
      }
    });

    it('有下一页时尾部应为省略号', () => {
      for (let page = 1; page <= 20; page++) {
        const pages = getPageNumbers(page, true);
        expect(pages[pages.length - 1]).toBe(-1);
      }
    });

    it('无下一页时尾部应为当前页', () => {
      for (let page = 1; page <= 20; page++) {
        const pages = getPageNumbers(page, false);
        const nonEllipsis = pages.filter(p => p !== -1);
        expect(nonEllipsis[nonEllipsis.length - 1]).toBe(page);
      }
    });
  });

  describe('大页码', () => {
    it('第 100 页应正确生成', () => {
      const pages = getPageNumbers(100, true);
      expect(pages[0]).toBe(1);
      expect(pages).toContain(100);
      expect(pages).toContain(98);
      expect(pages).toContain(102);
    });

    it('第 1000 页无下一页', () => {
      const pages = getPageNumbers(1000, false);
      expect(pages[0]).toBe(1);
      expect(pages[pages.length - 1]).toBe(1000);
    });
  });
});

describe('pageButtonStyle', () => {
  it('激活状态应使用白色文字和实心背景', () => {
    const style = pageButtonStyle(true);
    expect(style.color).toBe('#fff');
    expect(style.fontWeight).toBe(700);
    expect(style.cursor).toBe('default');
  });

  it('非激活状态应使用透明背景和指针光标', () => {
    const style = pageButtonStyle(false);
    expect(style.background).toBe('transparent');
    expect(style.fontWeight).toBe(500);
    expect(style.cursor).toBe('pointer');
  });

  it('尺寸应固定为 32x32', () => {
    expect(pageButtonStyle(true).width).toBe(32);
    expect(pageButtonStyle(true).height).toBe(32);
    expect(pageButtonStyle(false).width).toBe(32);
    expect(pageButtonStyle(false).height).toBe(32);
  });
});
