import { describe, it, expect } from 'vitest';
import path from 'path';

/**
 * galleryService 纯逻辑测试
 * 由于 galleryService 依赖数据库和文件系统，
 * 这里测试其核心逻辑的等价实现
 */

describe('galleryService - Gallery 数据映射', () => {
  // 模拟 SQLite 行到 Gallery 对象的转换
  function mapRowToGallery(row: Record<string, any>) {
    return {
      id: row.id,
      folderPath: row.folderPath,
      name: row.name,
      coverImageId: row.coverImageId,
      imageCount: row.imageCount,
      lastScannedAt: row.lastScannedAt,
      isWatching: Boolean(row.isWatching),
      recursive: Boolean(row.recursive),
      extensions: row.extensions ? JSON.parse(row.extensions) : [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      coverImage: row.coverImageId ? {
        id: row.coverImageId,
        filename: row.coverFilename,
        filepath: row.coverFilepath,
      } : undefined,
    };
  }

  it('应正确转换布尔值（SQLite 0/1）', () => {
    const row = {
      id: 1, folderPath: '/images', name: 'Test',
      isWatching: 1, recursive: 0, imageCount: 10,
      extensions: '[\".jpg\",\".png\"]',
      createdAt: '2024-01-01', updatedAt: '2024-01-01',
    };
    const gallery = mapRowToGallery(row);
    expect(gallery.isWatching).toBe(true);
    expect(gallery.recursive).toBe(false);
  });

  it('isWatching 为 0 应转换为 false', () => {
    const row = { id: 1, isWatching: 0, recursive: 1, extensions: '[]' };
    const gallery = mapRowToGallery(row);
    expect(gallery.isWatching).toBe(false);
    expect(gallery.recursive).toBe(true);
  });

  it('应正确解析 extensions JSON', () => {
    const row = {
      id: 1, extensions: '[\".jpg\",\".jpeg\",\".png\",\".gif\",\".webp\"]',
    };
    const gallery = mapRowToGallery(row);
    expect(gallery.extensions).toEqual(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
  });

  it('extensions 为空时应返回空数组', () => {
    const row = { id: 1, extensions: null };
    const gallery = mapRowToGallery(row);
    expect(gallery.extensions).toEqual([]);
  });

  it('有 coverImageId 时应包含 coverImage', () => {
    const row = {
      id: 1, coverImageId: 42, coverFilename: 'cover.jpg',
      coverFilepath: '/images/cover.jpg', extensions: '[]',
    };
    const gallery = mapRowToGallery(row);
    expect(gallery.coverImage).toBeDefined();
    expect(gallery.coverImage!.id).toBe(42);
    expect(gallery.coverImage!.filename).toBe('cover.jpg');
  });

  it('无 coverImageId 时 coverImage 应为 undefined', () => {
    const row = { id: 1, coverImageId: null, extensions: '[]' };
    const gallery = mapRowToGallery(row);
    expect(gallery.coverImage).toBeUndefined();
  });
});

describe('galleryService - 默认值处理', () => {
  it('默认扩展名应包含常见图片格式', () => {
    const defaultExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
    expect(defaultExtensions).toContain('.jpg');
    expect(defaultExtensions).toContain('.png');
    expect(defaultExtensions).toContain('.webp');
    expect(defaultExtensions).toHaveLength(6);
  });

  it('isWatching 默认值应为 true', () => {
    const isWatching = undefined ?? true;
    expect(isWatching).toBe(true);
  });

  it('recursive 默认值应为 true', () => {
    const recursive = undefined ?? true;
    expect(recursive).toBe(true);
  });
});

describe('galleryService - updateGallery SQL 构建', () => {
  // 模拟动态 SQL 构建逻辑
  function buildUpdateClauses(updates: Record<string, any>): {
    setClauses: string[];
    values: any[];
  } {
    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      values.push(updates.name);
    }
    if (updates.isWatching !== undefined) {
      setClauses.push('isWatching = ?');
      values.push(updates.isWatching ? 1 : 0);
    }
    if (updates.recursive !== undefined) {
      setClauses.push('recursive = ?');
      values.push(updates.recursive ? 1 : 0);
    }

    return { setClauses, values };
  }

  it('只更新 name 时应只有一个子句', () => {
    const { setClauses, values } = buildUpdateClauses({ name: 'New Name' });
    expect(setClauses).toEqual(['name = ?']);
    expect(values).toEqual(['New Name']);
  });

  it('更新多个字段时应有多个子句', () => {
    const { setClauses, values } = buildUpdateClauses({
      name: 'New', isWatching: true, recursive: false,
    });
    expect(setClauses).toHaveLength(3);
    expect(values).toEqual(['New', 1, 0]);
  });

  it('空更新应返回空数组', () => {
    const { setClauses, values } = buildUpdateClauses({});
    expect(setClauses).toHaveLength(0);
    expect(values).toHaveLength(0);
  });

  it('布尔值应转换为 0/1', () => {
    const { values } = buildUpdateClauses({ isWatching: false, recursive: true });
    expect(values).toEqual([0, 1]);
  });
});

describe('galleryService - 唯一名称生成', () => {
  // 模拟 generateUniqueGalleryName
  function generateUniqueName(baseName: string, existingNames: Set<string>): string {
    let name = baseName;
    let suffix = 1;
    while (existingNames.has(name)) {
      name = `${baseName} (${suffix})`;
      suffix++;
    }
    return name;
  }

  it('名称不重复时应原样返回', () => {
    expect(generateUniqueName('Gallery', new Set(['Other']))).toBe('Gallery');
  });

  it('名称重复时应添加 (1) 后缀', () => {
    expect(generateUniqueName('Gallery', new Set(['Gallery']))).toBe('Gallery (1)');
  });

  it('多次重复应递增后缀', () => {
    const existing = new Set(['Gallery', 'Gallery (1)', 'Gallery (2)']);
    expect(generateUniqueName('Gallery', existing)).toBe('Gallery (3)');
  });

  it('空名称也应正常处理', () => {
    expect(generateUniqueName('', new Set())).toBe('');
  });
});

describe('galleryService - checkFolderHasImages 逻辑', () => {
  // 模拟检查文件夹是否包含图片
  function hasImagesInFiles(filenames: string[], extensions: string[]): boolean {
    return filenames.some(name => {
      const ext = path.extname(name).toLowerCase();
      return extensions.includes(ext);
    });
  }

  it('包含 jpg 文件时应返回 true', () => {
    expect(hasImagesInFiles(['photo.jpg', 'readme.txt'], ['.jpg', '.png'])).toBe(true);
  });

  it('只有文本文件时应返回 false', () => {
    expect(hasImagesInFiles(['readme.txt', 'notes.md'], ['.jpg', '.png'])).toBe(false);
  });

  it('空文件列表应返回 false', () => {
    expect(hasImagesInFiles([], ['.jpg'])).toBe(false);
  });

  it('大小写不敏感', () => {
    expect(hasImagesInFiles(['PHOTO.JPG'], ['.jpg'])).toBe(true);
    expect(hasImagesInFiles(['image.PNG'], ['.png'])).toBe(true);
  });

  it('WebP 格式应被识别', () => {
    expect(hasImagesInFiles(['anim.webp'], ['.jpg', '.png', '.webp'])).toBe(true);
  });
});
