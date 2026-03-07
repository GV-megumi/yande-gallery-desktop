import { describe, it, expect } from 'vitest';
import path from 'path';

/**
 * imageCacheService 的纯逻辑测试
 * 由于该服务依赖 fs、axios、config 等外部模块，
 * 这里抽取核心算法逻辑进行独立测试
 */

describe('imageCacheService - 缓存路径计算', () => {
  // getCachePath 的逻辑：使用 MD5 前两位作为子目录
  function getCachePath(cacheDir: string, md5: string, extension: string): string {
    const subDir = md5.substring(0, 2);
    return path.join(cacheDir, subDir, `${md5}.${extension}`);
  }

  it('应使用 MD5 前两位作为子目录', () => {
    const result = getCachePath('/data/cache', 'a1b2c3d4e5f6', 'png');
    expect(result).toContain(path.join('a1', 'a1b2c3d4e5f6.png'));
  });

  it('应正确拼接扩展名', () => {
    const result = getCachePath('/data/cache', 'ff00aabb', 'jpg');
    expect(result).toContain('ff00aabb.jpg');
    expect(result).toContain(path.join('ff', 'ff00aabb.jpg'));
  });

  it('不同 MD5 应生成不同子目录', () => {
    const path1 = getCachePath('/data/cache', 'ab123456', 'png');
    const path2 = getCachePath('/data/cache', 'cd789012', 'png');
    expect(path1).not.toBe(path2);
    expect(path1).toContain(`${path.sep}ab${path.sep}`);
    expect(path2).toContain(`${path.sep}cd${path.sep}`);
  });

  it('相同 MD5 前缀应分到同一子目录', () => {
    const path1 = getCachePath('/data/cache', 'aa111111', 'png');
    const path2 = getCachePath('/data/cache', 'aa222222', 'jpg');
    const dir1 = path.dirname(path1);
    const dir2 = path.dirname(path2);
    expect(dir1).toBe(dir2);
  });
});

describe('imageCacheService - URL 转换逻辑 (getCachedImageUrl)', () => {
  // Windows 路径转换为 app:// URL 的逻辑
  function convertToAppUrl(cachePath: string, platform: string, cwd: string): string {
    if (platform === 'win32') {
      const match = cachePath.match(/^([A-Z]):\\(.+)$/i);
      if (match) {
        const driveLetter = match[1].toLowerCase();
        const pathPart = match[2].replace(/\\/g, '/');
        return `app://${driveLetter}/${pathPart}`;
      }
    }
    // Unix 路径或其他格式
    const relativePath = path.relative(cwd, cachePath);
    const normalizedPath = relativePath.replace(/\\/g, '/');
    return `app://${normalizedPath}`;
  }

  it('应将 Windows 路径转换为 app:// URL', () => {
    const result = convertToAppUrl(
      'M:\\yande\\data\\cache\\87\\874a52b2.png',
      'win32',
      'M:\\yande'
    );
    expect(result).toBe('app://m/yande/data/cache/87/874a52b2.png');
  });

  it('应将驱动器字母转为小写', () => {
    const result = convertToAppUrl(
      'C:\\Users\\data\\file.jpg',
      'win32',
      'C:\\Users'
    );
    expect(result).toMatch(/^app:\/\/c\//);
  });

  it('应将反斜杠转为正斜杠', () => {
    const result = convertToAppUrl(
      'D:\\path\\to\\file.png',
      'win32',
      'D:\\path'
    );
    expect(result).not.toContain('\\');
  });

  it('Linux 路径应使用相对路径', () => {
    const result = convertToAppUrl(
      '/home/user/app/data/cache/ab/file.png',
      'linux',
      '/home/user/app'
    );
    expect(result).toBe('app://data/cache/ab/file.png');
  });

  it('不同驱动器字母应正确处理', () => {
    const resultD = convertToAppUrl('D:\\cache\\file.png', 'win32', 'D:\\');
    const resultE = convertToAppUrl('E:\\cache\\file.png', 'win32', 'E:\\');
    expect(resultD).toMatch(/^app:\/\/d\//);
    expect(resultE).toMatch(/^app:\/\/e\//);
  });
});

describe('imageCacheService - 缓存大小计算', () => {
  it('应正确将字节转换为 MB', () => {
    const bytes = 1024 * 1024 * 500; // 500 MB
    const mb = bytes / (1024 * 1024);
    expect(mb).toBe(500);
  });

  it('0 字节应返回 0 MB', () => {
    const mb = 0 / (1024 * 1024);
    expect(mb).toBe(0);
  });

  it('小于 1MB 应返回小数', () => {
    const bytes = 512 * 1024; // 0.5 MB
    const mb = bytes / (1024 * 1024);
    expect(mb).toBe(0.5);
  });
});

describe('imageCacheService - LRU 缓存清理逻辑', () => {
  interface MockFile {
    path: string;
    mtime: number;
    size: number;
  }

  // 模拟 LRU 清理算法：按修改时间排序，逐个删除最旧的文件
  function selectFilesToDelete(
    files: MockFile[],
    totalSize: number,
    targetBytes: number
  ): MockFile[] {
    if (totalSize <= targetBytes) return [];

    // 按修改时间排序（最旧的在前）
    const sorted = [...files].sort((a, b) => a.mtime - b.mtime);
    const toDelete: MockFile[] = [];
    let deletedSize = 0;

    for (const file of sorted) {
      if (totalSize - deletedSize <= targetBytes) break;
      toDelete.push(file);
      deletedSize += file.size;
    }

    return toDelete;
  }

  it('缓存未超限时不应删除任何文件', () => {
    const files: MockFile[] = [
      { path: '/a.jpg', mtime: 100, size: 1000 },
      { path: '/b.jpg', mtime: 200, size: 1000 },
    ];
    const result = selectFilesToDelete(files, 2000, 5000);
    expect(result).toHaveLength(0);
  });

  it('应优先删除最旧的文件', () => {
    const files: MockFile[] = [
      { path: '/new.jpg', mtime: 300, size: 1000 },
      { path: '/old.jpg', mtime: 100, size: 1000 },
      { path: '/mid.jpg', mtime: 200, size: 1000 },
    ];
    const result = selectFilesToDelete(files, 3000, 1500);
    // 需要删除 1500 字节，应先删最旧的 /old.jpg (1000)，再删 /mid.jpg (1000)
    expect(result).toHaveLength(2);
    expect(result[0].path).toBe('/old.jpg');
    expect(result[1].path).toBe('/mid.jpg');
  });

  it('应在达到目标大小后停止删除', () => {
    const files: MockFile[] = [
      { path: '/a.jpg', mtime: 100, size: 500 },
      { path: '/b.jpg', mtime: 200, size: 500 },
      { path: '/c.jpg', mtime: 300, size: 500 },
    ];
    // 总大小 1500，目标 1000，需要删除 500 字节
    const result = selectFilesToDelete(files, 1500, 1000);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('/a.jpg');
  });

  it('空文件列表不应崩溃', () => {
    const result = selectFilesToDelete([], 0, 1000);
    expect(result).toHaveLength(0);
  });

  it('所有文件都很旧时应全部删除（如果需要）', () => {
    const files: MockFile[] = [
      { path: '/a.jpg', mtime: 1, size: 1000 },
      { path: '/b.jpg', mtime: 2, size: 1000 },
    ];
    // 总大小 2000，目标 0
    const result = selectFilesToDelete(files, 2000, 0);
    expect(result).toHaveLength(2);
  });
});
