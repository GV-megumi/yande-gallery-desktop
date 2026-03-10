import { describe, it, expect } from 'vitest';

/**
 * imageService 纯逻辑测试
 * 提取 imageService.ts 中不依赖数据库/文件系统的纯计算逻辑进行测试：
 * 1. 标签字符串 → Tag 数组转换
 * 2. 分页 offset 计算
 * 3. 搜索词构造（LIKE 模式）
 * 4. 文件扩展名过滤
 * 5. 格式推断
 */

// ========= 等价实现：标签字符串 → Tag 数组 =========

interface Tag {
  id: number;
  name: string;
  createdAt: string;
}

/** 等价于 imageService 中 images.map 里的标签解析逻辑 */
function parseTags(tagsStr: string | undefined | null, createdAt: string): Tag[] {
  if (tagsStr && typeof tagsStr === 'string') {
    return tagsStr.split(',').map((tag: string) => ({
      id: 0,
      name: tag,
      createdAt,
    }));
  }
  return [];
}

// ========= 等价实现：分页 offset 计算 =========

function calcOffset(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

// ========= 等价实现：搜索词构造 =========

function buildSearchTerm(query: string): string {
  return `%${query}%`;
}

// ========= 等价实现：扩展名过滤 =========

function filterByExtension(
  files: string[],
  extensions: string[]
): string[] {
  return files.filter(file => {
    const dotIdx = file.lastIndexOf('.');
    if (dotIdx === -1) return false;
    const ext = file.substring(dotIdx).toLowerCase();
    return extensions.includes(ext);
  });
}

// ========= 等价实现：格式推断 =========

function inferFormat(filePath: string): string {
  const dotIdx = filePath.lastIndexOf('.');
  if (dotIdx === -1) return '';
  return filePath.substring(dotIdx + 1).toLowerCase();
}

// ========= 等价实现：文件夹路径提取 =========

function extractFolder(filepath: string, filename: string): string {
  // 等价于 SQL: SUBSTR(filepath, 1, LENGTH(filepath) - LENGTH(filename) - 1)
  return filepath.substring(0, filepath.length - filename.length - 1);
}

// ========= 测试 =========

describe('标签字符串解析', () => {
  const ts = '2024-01-01T00:00:00.000Z';

  it('正常逗号分隔标签应解析为数组', () => {
    const tags = parseTags('blue_eyes,blonde_hair,smile', ts);
    expect(tags).toHaveLength(3);
    expect(tags[0].name).toBe('blue_eyes');
    expect(tags[1].name).toBe('blonde_hair');
    expect(tags[2].name).toBe('smile');
  });

  it('每个 Tag 的 id 应为 0', () => {
    const tags = parseTags('tag1,tag2', ts);
    for (const tag of tags) {
      expect(tag.id).toBe(0);
    }
  });

  it('每个 Tag 的 createdAt 应与传入值一致', () => {
    const tags = parseTags('tag1', ts);
    expect(tags[0].createdAt).toBe(ts);
  });

  it('单个标签应解析为长度 1 的数组', () => {
    const tags = parseTags('solo', ts);
    expect(tags).toHaveLength(1);
    expect(tags[0].name).toBe('solo');
  });

  it('undefined 应返回空数组', () => {
    expect(parseTags(undefined, ts)).toEqual([]);
  });

  it('null 应返回空数组', () => {
    expect(parseTags(null, ts)).toEqual([]);
  });

  it('空字符串应返回空数组（split 后为 [""]）', () => {
    // 注意：imageService 中 '' 是 falsy，会走 else 分支返回 []
    const tags = parseTags('', ts);
    expect(tags).toEqual([]);
  });

  it('含空格的标签名应保留空格', () => {
    const tags = parseTags('tag 1,tag 2', ts);
    expect(tags[0].name).toBe('tag 1');
    expect(tags[1].name).toBe('tag 2');
  });
});

describe('分页 offset 计算', () => {
  it('第 1 页 offset 应为 0', () => {
    expect(calcOffset(1, 50)).toBe(0);
  });

  it('第 2 页 pageSize=50 offset 应为 50', () => {
    expect(calcOffset(2, 50)).toBe(50);
  });

  it('第 3 页 pageSize=20 offset 应为 40', () => {
    expect(calcOffset(3, 20)).toBe(40);
  });

  it('第 1 页 pageSize=1 offset 应为 0', () => {
    expect(calcOffset(1, 1)).toBe(0);
  });

  it('大页码应正确计算', () => {
    expect(calcOffset(100, 50)).toBe(4950);
  });
});

describe('搜索词构造', () => {
  it('应在两侧添加 % 通配符', () => {
    expect(buildSearchTerm('test')).toBe('%test%');
  });

  it('空查询应为 %%', () => {
    expect(buildSearchTerm('')).toBe('%%');
  });

  it('含特殊字符的查询应原样保留', () => {
    expect(buildSearchTerm('blue_eyes')).toBe('%blue_eyes%');
  });

  it('含空格的查询应原样保留', () => {
    expect(buildSearchTerm('cute girl')).toBe('%cute girl%');
  });
});

describe('文件扩展名过滤', () => {
  const defaultExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

  it('应保留匹配的扩展名', () => {
    const files = ['a.jpg', 'b.png', 'c.txt'];
    const result = filterByExtension(files, defaultExts);
    expect(result).toEqual(['a.jpg', 'b.png']);
  });

  it('大写扩展名应匹配（toLowerCase）', () => {
    const files = ['photo.JPG', 'image.PNG'];
    const result = filterByExtension(files, defaultExts);
    expect(result).toEqual(['photo.JPG', 'image.PNG']);
  });

  it('无扩展名的文件应被排除', () => {
    const files = ['README', 'Makefile'];
    const result = filterByExtension(files, defaultExts);
    expect(result).toEqual([]);
  });

  it('空文件列表应返回空数组', () => {
    const result = filterByExtension([], defaultExts);
    expect(result).toEqual([]);
  });

  it('webp 和 bmp 也应匹配', () => {
    const files = ['a.webp', 'b.bmp', 'c.svg'];
    const result = filterByExtension(files, defaultExts);
    expect(result).toEqual(['a.webp', 'b.bmp']);
  });

  it('带路径的文件名应正确提取扩展名', () => {
    const files = ['/home/user/photos/image.jpg', 'C:\\Users\\pic.png'];
    const result = filterByExtension(files, defaultExts);
    expect(result).toHaveLength(2);
  });
});

describe('格式推断', () => {
  it('jpg 文件应返回 jpg', () => {
    expect(inferFormat('photo.jpg')).toBe('jpg');
  });

  it('大写扩展名应转为小写', () => {
    expect(inferFormat('photo.PNG')).toBe('png');
  });

  it('无扩展名应返回空字符串', () => {
    expect(inferFormat('README')).toBe('');
  });

  it('多个点号应取最后一个', () => {
    expect(inferFormat('my.photo.backup.webp')).toBe('webp');
  });

  it('带路径的文件应正确提取', () => {
    expect(inferFormat('/path/to/image.gif')).toBe('gif');
  });
});

describe('文件夹路径提取', () => {
  it('应从 filepath 中去除文件名部分', () => {
    expect(extractFolder('/home/user/photos/image.jpg', 'image.jpg')).toBe('/home/user/photos');
  });

  it('Windows 路径应正确处理', () => {
    expect(extractFolder('C:\\Users\\pics\\photo.png', 'photo.png')).toBe('C:\\Users\\pics');
  });

  it('根目录文件应返回空字符串', () => {
    // filepath = '/a.jpg', filename = 'a.jpg' => substr(0, 5-5-1) = substr(0, -1) => ''
    expect(extractFolder('/a.jpg', 'a.jpg')).toBe('');
  });
});
