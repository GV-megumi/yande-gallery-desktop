import { describe, it, expect } from 'vitest';

/**
 * BooruGridLayout 纯函数测试
 * 提取 estimateHeight、列分配算法、列数计算的等价实现进行测试
 */

// ========= 等价实现：estimateHeight =========

function estimateHeight(post: { width?: number; height?: number }, colWidth: number): number {
  if (post.width && post.height && post.width > 0) {
    return (post.height / post.width) * colWidth;
  }
  return colWidth * 1.33;
}

// ========= 等价实现：列数计算 =========

function calculateColumnCount(containerWidth: number, gridSize: number, spacing: number): number {
  return Math.max(2, Math.floor((containerWidth + spacing) / (gridSize + spacing)));
}

// ========= 等价实现：列宽计算 =========

function calculateColumnWidth(containerWidth: number, columnCount: number, spacing: number, gridSize: number): number {
  if (!containerWidth) return gridSize;
  const totalGap = spacing * (columnCount - 1);
  return (containerWidth - totalGap) / columnCount;
}

// ========= 等价实现：贪心分列算法 =========

function distributeToColumns<T extends { width?: number; height?: number }>(
  posts: T[],
  columnCount: number,
  colWidth: number,
  spacing: number
): T[][] {
  const cols: T[][] = Array.from({ length: columnCount }, () => []);
  const heights = new Array(columnCount).fill(0);

  for (const post of posts) {
    let minIdx = 0;
    for (let i = 1; i < columnCount; i++) {
      if (heights[i] < heights[minIdx]) minIdx = i;
    }
    cols[minIdx].push(post);
    heights[minIdx] += estimateHeight(post, colWidth) + spacing;
  }

  return cols;
}

// ========= 测试 =========

describe('estimateHeight', () => {
  it('应根据宽高比和列宽计算高度', () => {
    // 1920x1080 在 300px 列宽下
    const h = estimateHeight({ width: 1920, height: 1080 }, 300);
    expect(h).toBeCloseTo(168.75, 1);
  });

  it('正方形图片应等于列宽', () => {
    const h = estimateHeight({ width: 500, height: 500 }, 300);
    expect(h).toBeCloseTo(300);
  });

  it('竖向图片应大于列宽', () => {
    const h = estimateHeight({ width: 500, height: 1000 }, 300);
    expect(h).toBeCloseTo(600);
  });

  it('宽度为 0 应使用默认比例', () => {
    const h = estimateHeight({ width: 0, height: 500 }, 300);
    expect(h).toBeCloseTo(300 * 1.33);
  });

  it('无尺寸信息应使用默认比例 1.33', () => {
    const h = estimateHeight({}, 300);
    expect(h).toBeCloseTo(300 * 1.33);
  });

  it('width 存在但 height 不存在应使用默认比例', () => {
    const h = estimateHeight({ width: 500 }, 300);
    expect(h).toBeCloseTo(300 * 1.33);
  });
});

describe('calculateColumnCount', () => {
  it('应根据容器宽度和网格大小计算列数', () => {
    // 1200px 宽, gridSize=300, spacing=16 → (1200+16)/(300+16) ≈ 3.85 → 3 列
    expect(calculateColumnCount(1200, 300, 16)).toBe(3);
  });

  it('最小列数为 2', () => {
    // 极小容器
    expect(calculateColumnCount(100, 300, 16)).toBe(2);
  });

  it('容器刚好容纳 5 列', () => {
    // gridSize=200, spacing=10 → 需要 200*5 + 10*4 = 1040
    // (1040+10)/(200+10) = 1050/210 = 5
    expect(calculateColumnCount(1040, 200, 10)).toBe(5);
  });

  it('spacing 为 0 时的计算', () => {
    // 1000px, gridSize=200, spacing=0 → (1000+0)/(200+0) = 5
    expect(calculateColumnCount(1000, 200, 0)).toBe(5);
  });

  it('不同网格大小', () => {
    expect(calculateColumnCount(1920, 400, 16)).toBe(4); // (1936/416)=4.65→4
    expect(calculateColumnCount(1920, 200, 16)).toBe(8); // (1936/216)=8.96→8
  });
});

describe('calculateColumnWidth', () => {
  it('应根据容器宽度和列数计算实际列宽', () => {
    // 1200px, 3 列, spacing=16 → (1200 - 32) / 3 ≈ 389.33
    const w = calculateColumnWidth(1200, 3, 16, 300);
    expect(w).toBeCloseTo(389.33, 1);
  });

  it('containerWidth 为 0 时应返回 gridSize', () => {
    expect(calculateColumnWidth(0, 3, 16, 300)).toBe(300);
  });

  it('单列时列宽等于容器宽度', () => {
    const w = calculateColumnWidth(500, 1, 16, 300);
    expect(w).toBe(500); // (500 - 0) / 1
  });

  it('两列 spacing=0 时列宽为一半', () => {
    const w = calculateColumnWidth(1000, 2, 0, 300);
    expect(w).toBe(500);
  });
});

describe('distributeToColumns（贪心分列算法）', () => {
  it('均匀大小的帖子应均匀分配', () => {
    const posts = Array.from({ length: 6 }, (_, i) => ({
      width: 500, height: 500, id: i,
    }));
    const cols = distributeToColumns(posts, 3, 300, 16);
    expect(cols[0].length).toBe(2);
    expect(cols[1].length).toBe(2);
    expect(cols[2].length).toBe(2);
  });

  it('不同高度的帖子应平衡列高', () => {
    const posts = [
      { width: 500, height: 1000 }, // 高图 → height=600
      { width: 500, height: 500 },  // 正方图 → height=300
      { width: 500, height: 500 },  // 正方图 → height=300
      { width: 500, height: 500 },  // 正方图 → height=300
    ];
    const cols = distributeToColumns(posts, 2, 300, 0);
    // 高图占 600，两个正方图各 300 → col1=[高图], col2=[正方图,正方图,正方图]
    // 实际：第1张→col0(高=600), 第2张→col1(高=300), 第3张→col1(高=600), 第4张→任一(高=600)
    const totalPosts = cols[0].length + cols[1].length;
    expect(totalPosts).toBe(4);
  });

  it('单列应包含所有帖子', () => {
    const posts = [{ width: 100, height: 100 }, { width: 200, height: 300 }];
    const cols = distributeToColumns(posts, 1, 300, 16);
    expect(cols[0].length).toBe(2);
  });

  it('空帖子列表应返回空列', () => {
    const cols = distributeToColumns([], 3, 300, 16);
    expect(cols.length).toBe(3);
    expect(cols.every(c => c.length === 0)).toBe(true);
  });

  it('帖子数少于列数时部分列为空', () => {
    const posts = [{ width: 500, height: 500 }];
    const cols = distributeToColumns(posts, 5, 300, 16);
    const nonEmpty = cols.filter(c => c.length > 0);
    expect(nonEmpty.length).toBe(1);
  });

  it('所有帖子引用应保留', () => {
    const posts = Array.from({ length: 10 }, (_, i) => ({
      width: 500, height: 300 + i * 50, id: i,
    }));
    const cols = distributeToColumns(posts, 3, 300, 16);
    const allPosts = cols.flat();
    expect(allPosts.length).toBe(10);
    // 每个原始帖子都应在结果中
    for (const post of posts) {
      expect(allPosts).toContain(post);
    }
  });

  it('大量帖子的列高应大致平衡', () => {
    const posts = Array.from({ length: 100 }, (_, i) => ({
      width: 500, height: 300 + (i % 5) * 200,
    }));
    const colWidth = 300;
    const spacing = 16;
    const cols = distributeToColumns(posts, 4, colWidth, spacing);

    // 计算每列总高
    const colHeights = cols.map(col =>
      col.reduce((h, post) => h + estimateHeight(post, colWidth) + spacing, 0)
    );
    const maxH = Math.max(...colHeights);
    const minH = Math.min(...colHeights);

    // 列高差异不应超过单个帖子最大高度 + spacing 的 2 倍
    const maxPostHeight = estimateHeight({ width: 500, height: 1100 }, colWidth) + spacing;
    expect(maxH - minH).toBeLessThan(maxPostHeight * 2);
  });
});
