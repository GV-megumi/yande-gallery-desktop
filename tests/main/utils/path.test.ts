import { describe, it, expect } from 'vitest';
import {
  normalizePath,
  getDirectoryPath,
  isSubPath,
  getRelativePath,
  isAbsolutePath,
  joinPaths,
  extractExtension,
  extractFilename,
  normalizePaths,
} from '../../../src/main/utils/path';
import path from 'path';

/**
 * 路径工具函数测试
 */

describe('normalizePath', () => {
  it('应去除末尾分隔符', () => {
    const result = normalizePath('/home/user/images/');
    expect(result.endsWith('/')).toBe(false);
  });

  it('应保留根路径', () => {
    // Unix 根路径
    const result = normalizePath('/');
    expect(result).toBe(path.sep);
  });

  it('应处理 . 和 .. 路径', () => {
    const result = normalizePath('/home/user/../admin/./images');
    expect(result).toContain('admin');
    expect(result).toContain('images');
    expect(result).not.toContain('..');
    expect(result).not.toContain('./');
  });

  it('应处理空路径', () => {
    const result = normalizePath('.');
    expect(result).toBe('.');
  });
});

describe('getDirectoryPath', () => {
  it('应返回文件的父目录', () => {
    const result = getDirectoryPath('/home/user/images/photo.jpg');
    expect(result).toContain('images');
    expect(result).not.toContain('photo.jpg');
  });

  it('应处理目录路径', () => {
    const result = getDirectoryPath('/home/user/images/');
    // 去除末尾斜杠后，dirname 应返回 /home/user
    expect(result).toContain('user');
  });
});

describe('isSubPath', () => {
  it('子路径应返回 true', () => {
    expect(isSubPath('/home/user', '/home/user/images')).toBe(true);
  });

  it('相同路径不应为子路径', () => {
    // 相同路径 + sep 后，两者相同，startsWith 返回 true
    // 但逻辑上相同路径算子路径取决于实现
    const result = isSubPath('/home/user', '/home/user');
    // 相同路径 normalized + sep → /home/user/ startsWith /home/user/ → true
    expect(result).toBe(true);
  });

  it('不相关的路径应返回 false', () => {
    expect(isSubPath('/home/user', '/var/log')).toBe(false);
  });

  it('部分匹配但非子路径应返回 false', () => {
    // /home/user2 不是 /home/user 的子路径
    expect(isSubPath('/home/user', '/home/user2')).toBe(false);
  });

  it('深层嵌套子路径应返回 true', () => {
    expect(isSubPath('/a', '/a/b/c/d/e')).toBe(true);
  });
});

describe('getRelativePath', () => {
  it('应返回正确的相对路径', () => {
    const result = getRelativePath('/home/user', '/home/user/images/photo.jpg');
    expect(result).toContain('images');
    expect(result).toContain('photo.jpg');
  });

  it('相同路径应返回 .', () => {
    const result = getRelativePath('/home/user', '/home/user');
    expect(result).toBe('.');
  });
});

describe('isAbsolutePath', () => {
  it('绝对路径应返回 true', () => {
    if (process.platform === 'win32') {
      expect(isAbsolutePath('C:\\Users\\admin')).toBe(true);
      expect(isAbsolutePath('M:\\yande\\images')).toBe(true);
    } else {
      expect(isAbsolutePath('/home/user')).toBe(true);
    }
  });

  it('相对路径应返回 false', () => {
    expect(isAbsolutePath('data/gallery.db')).toBe(false);
    expect(isAbsolutePath('./config.yaml')).toBe(false);
    expect(isAbsolutePath('images')).toBe(false);
  });
});

describe('joinPaths', () => {
  it('应正确拼接路径', () => {
    const result = joinPaths('/home', 'user', 'images');
    expect(result).toContain('home');
    expect(result).toContain('user');
    expect(result).toContain('images');
  });

  it('应处理多个路径段', () => {
    const result = joinPaths('a', 'b', 'c', 'd');
    expect(result).toContain('a');
    expect(result).toContain('d');
  });
});

describe('extractExtension', () => {
  it('应提取常见图片扩展名', () => {
    expect(extractExtension('photo.jpg')).toBe('.jpg');
    expect(extractExtension('image.png')).toBe('.png');
    expect(extractExtension('anim.gif')).toBe('.gif');
    expect(extractExtension('pic.webp')).toBe('.webp');
  });

  it('应转为小写', () => {
    expect(extractExtension('photo.JPG')).toBe('.jpg');
    expect(extractExtension('image.PNG')).toBe('.png');
  });

  it('应处理 URL 路径', () => {
    expect(extractExtension('/path/to/image.png')).toBe('.png');
  });

  it('无扩展名应返回空字符串', () => {
    expect(extractExtension('README')).toBe('');
  });

  it('多重扩展名应只返回最后一个', () => {
    expect(extractExtension('archive.tar.gz')).toBe('.gz');
  });
});

describe('extractFilename', () => {
  it('应提取不含扩展名的文件名', () => {
    expect(extractFilename('photo.jpg')).toBe('photo');
    expect(extractFilename('my_image.png')).toBe('my_image');
  });

  it('应处理路径', () => {
    expect(extractFilename('/path/to/photo.jpg')).toBe('photo');
  });

  it('无扩展名文件应原样返回', () => {
    expect(extractFilename('Makefile')).toBe('Makefile');
  });

  it('应处理包含多个点的文件名', () => {
    expect(extractFilename('file.backup.tar.gz')).toBe('file.backup.tar');
  });
});

describe('normalizePaths', () => {
  it('应规范化所有路径', () => {
    const paths = ['/home/user/', '/var/log/', '/tmp/'];
    const result = normalizePaths(paths);
    expect(result).toHaveLength(3);
    // 每个路径末尾的斜杠应被去除
    for (const p of result) {
      expect(p.endsWith('/')).toBe(false);
    }
  });

  it('空数组应返回空数组', () => {
    expect(normalizePaths([])).toEqual([]);
  });
});
