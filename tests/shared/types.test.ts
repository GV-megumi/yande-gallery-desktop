import { describe, it, expect } from 'vitest';

describe('RendererAppEvent 事件契约', () => {
  const eventTypes = [
    'bulk-download:sessions-changed',
    'favorite-tag-download:created',
    'favorite-tags:changed',
    'gallery:images-imported',
    'gallery:galleries-changed',
  ];

  it('事件类型字符串应唯一', () => {
    expect(new Set(eventTypes).size).toBe(eventTypes.length);
  });

  it('事件 envelope 应包含 type/version/occurredAt/source/payload', () => {
    const event = {
      type: 'gallery:images-imported',
      version: 1,
      occurredAt: '2026-04-24T00:00:00.000Z',
      source: 'galleryService',
      payload: { folderPath: 'D:/x', imported: 1, skipped: 0, reason: 'syncGalleryFolder' },
    };

    expect(event).toEqual(expect.objectContaining({
      type: expect.any(String),
      version: 1,
      occurredAt: expect.any(String),
      source: expect.any(String),
      payload: expect.any(Object),
    }));
  });
});

/**
 * shared/types.ts 类型结构与数据验证测试
 * 测试类型的运行时数据完整性校验逻辑
 */

describe('BooruSite 数据验证', () => {
  // 模拟验证函数：检查 BooruSite 必填字段
  function validateBooruSite(site: Record<string, any>): string[] {
    const errors: string[] = [];
    if (!site.name || typeof site.name !== 'string') errors.push('name 必须是非空字符串');
    if (!site.url || typeof site.url !== 'string') errors.push('url 必须是非空字符串');
    if (!['moebooru', 'danbooru', 'gelbooru'].includes(site.type)) {
      errors.push('type 必须是 moebooru/danbooru/gelbooru 之一');
    }
    if (typeof site.favoriteSupport !== 'boolean') errors.push('favoriteSupport 必须是布尔值');
    if (typeof site.active !== 'boolean') errors.push('active 必须是布尔值');
    return errors;
  }

  it('完整的站点数据不应有错误', () => {
    const site = {
      id: 1, name: 'Yande.re', url: 'https://yande.re',
      type: 'moebooru', favoriteSupport: true, active: true,
      createdAt: '2024-01-01', updatedAt: '2024-01-01',
    };
    expect(validateBooruSite(site)).toEqual([]);
  });

  it('缺少 name 应报错', () => {
    const site = {
      id: 1, name: '', url: 'https://yande.re',
      type: 'moebooru', favoriteSupport: true, active: true,
    };
    expect(validateBooruSite(site)).toContain('name 必须是非空字符串');
  });

  it('无效的 type 应报错', () => {
    const site = {
      id: 1, name: 'Test', url: 'https://test.com',
      type: 'invalid', favoriteSupport: false, active: false,
    };
    expect(validateBooruSite(site)).toContain('type 必须是 moebooru/danbooru/gelbooru 之一');
  });

  it('三种合法的 type 值都应通过', () => {
    for (const type of ['moebooru', 'danbooru', 'gelbooru']) {
      const site = {
        id: 1, name: 'Test', url: 'https://test.com',
        type, favoriteSupport: false, active: false,
      };
      expect(validateBooruSite(site)).toEqual([]);
    }
  });
});

describe('BooruPost 数据验证', () => {
  function validateBooruPost(post: Record<string, any>): string[] {
    const errors: string[] = [];
    if (typeof post.postId !== 'number' || post.postId <= 0) errors.push('postId 必须是正整数');
    if (typeof post.siteId !== 'number' || post.siteId <= 0) errors.push('siteId 必须是正整数');
    if (!post.fileUrl || typeof post.fileUrl !== 'string') errors.push('fileUrl 必须是非空字符串');
    if (typeof post.tags !== 'string') errors.push('tags 必须是字符串');
    if (post.rating && !['safe', 'questionable', 'explicit'].includes(post.rating)) {
      errors.push('rating 必须是 safe/questionable/explicit 之一');
    }
    if (typeof post.downloaded !== 'boolean') errors.push('downloaded 必须是布尔值');
    return errors;
  }

  it('完整的帖子数据不应有错误', () => {
    const post = {
      id: 1, postId: 12345, siteId: 1,
      fileUrl: 'https://files.yande.re/image/abc.jpg',
      tags: 'girl blue_eyes', rating: 'safe',
      downloaded: false, isFavorited: false,
      createdAt: '2024-01-01', updatedAt: '2024-01-01',
    };
    expect(validateBooruPost(post)).toEqual([]);
  });

  it('postId 为 0 应报错', () => {
    const post = {
      postId: 0, siteId: 1, fileUrl: 'https://test.com/img.jpg',
      tags: '', downloaded: false,
    };
    expect(validateBooruPost(post)).toContain('postId 必须是正整数');
  });

  it('无效的 rating 应报错', () => {
    const post = {
      postId: 1, siteId: 1, fileUrl: 'https://test.com/img.jpg',
      tags: '', rating: 'nsfw', downloaded: false,
    };
    expect(validateBooruPost(post)).toContain('rating 必须是 safe/questionable/explicit 之一');
  });

  it('rating 为 undefined 时不应报错', () => {
    const post = {
      postId: 1, siteId: 1, fileUrl: 'https://test.com/img.jpg',
      tags: '', downloaded: false,
    };
    const errors = validateBooruPost(post);
    expect(errors).not.toContain('rating 必须是 safe/questionable/explicit 之一');
  });
});

describe('DownloadQueueItem 状态机验证', () => {
  const VALID_STATUSES = ['pending', 'downloading', 'completed', 'failed', 'paused'] as const;

  // 状态转换规则
  const VALID_TRANSITIONS: Record<string, string[]> = {
    pending: ['downloading', 'paused'],
    downloading: ['completed', 'failed', 'paused', 'pending'],
    completed: [],
    failed: ['pending'],
    paused: ['pending'],
  };

  function isValidTransition(from: string, to: string): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
  }

  it('pending -> downloading 应该合法', () => {
    expect(isValidTransition('pending', 'downloading')).toBe(true);
  });

  it('downloading -> completed 应该合法', () => {
    expect(isValidTransition('downloading', 'completed')).toBe(true);
  });

  it('downloading -> failed 应该合法', () => {
    expect(isValidTransition('downloading', 'failed')).toBe(true);
  });

  it('completed 状态不应有合法转换', () => {
    for (const status of VALID_STATUSES) {
      expect(isValidTransition('completed', status)).toBe(false);
    }
  });

  it('failed -> pending (重试) 应该合法', () => {
    expect(isValidTransition('failed', 'pending')).toBe(true);
  });

  it('paused -> pending (恢复) 应该合法', () => {
    expect(isValidTransition('paused', 'pending')).toBe(true);
  });

  it('pending -> completed 不应合法（跳过下载）', () => {
    expect(isValidTransition('pending', 'completed')).toBe(false);
  });

  it('进度值应在 0-100 之间', () => {
    function validateProgress(progress: number): boolean {
      return progress >= 0 && progress <= 100;
    }
    expect(validateProgress(0)).toBe(true);
    expect(validateProgress(50)).toBe(true);
    expect(validateProgress(100)).toBe(true);
    expect(validateProgress(-1)).toBe(false);
    expect(validateProgress(101)).toBe(false);
  });
});

describe('BulkDownloadSessionStatus 状态验证', () => {
  const VALID_SESSION_STATUSES = [
    'pending', 'dryRun', 'running', 'completed',
    'allSkipped', 'failed', 'paused', 'suspended', 'cancelled'
  ];

  it('应包含所有 9 种会话状态', () => {
    expect(VALID_SESSION_STATUSES).toHaveLength(9);
  });

  it('每种状态都应是唯一的', () => {
    const unique = new Set(VALID_SESSION_STATUSES);
    expect(unique.size).toBe(VALID_SESSION_STATUSES.length);
  });
});

describe('FavoriteTag 数据验证', () => {
  function validateFavoriteTag(tag: Record<string, any>): string[] {
    const errors: string[] = [];
    if (!tag.tagName || typeof tag.tagName !== 'string') errors.push('tagName 必须是非空字符串');
    if (!['tag', 'raw', 'list'].includes(tag.queryType)) {
      errors.push('queryType 必须是 tag/raw/list 之一');
    }
    if (typeof tag.sortOrder !== 'number') errors.push('sortOrder 必须是数字');
    if (tag.labels !== undefined && !Array.isArray(tag.labels)) errors.push('labels 必须是数组');
    return errors;
  }

  it('完整的收藏标签不应有错误', () => {
    const tag = {
      id: 1, siteId: 1, tagName: 'blue_eyes',
      queryType: 'tag', sortOrder: 0, createdAt: '2024-01-01',
    };
    expect(validateFavoriteTag(tag)).toEqual([]);
  });

  it('无效的 queryType 应报错', () => {
    const tag = {
      tagName: 'test', queryType: 'invalid', sortOrder: 0,
    };
    expect(validateFavoriteTag(tag)).toContain('queryType 必须是 tag/raw/list 之一');
  });

  it('siteId 为 null 时表示全局标签', () => {
    const tag = { id: 1, siteId: null, tagName: 'global_tag', queryType: 'tag', sortOrder: 0 };
    expect(tag.siteId).toBeNull();
    expect(validateFavoriteTag(tag)).toEqual([]);
  });

  it('labels 为数组时应通过验证', () => {
    const tag = {
      tagName: 'test', queryType: 'tag', sortOrder: 0,
      labels: ['group1', 'group2'],
    };
    expect(validateFavoriteTag(tag)).toEqual([]);
  });

  it('labels 不是数组时应报错', () => {
    const tag = {
      tagName: 'test', queryType: 'tag', sortOrder: 0,
      labels: 'not_array',
    };
    expect(validateFavoriteTag(tag)).toContain('labels 必须是数组');
  });
});

describe('FavoriteTagDownloadBinding 数据验证', () => {
  function validateFavoriteTagDownloadBinding(binding: Record<string, any>): string[] {
    const errors: string[] = [];
    if (typeof binding.favoriteTagId !== 'number' || binding.favoriteTagId <= 0) errors.push('favoriteTagId 必须是正整数');
    if (binding.galleryId !== null && binding.galleryId !== undefined && (typeof binding.galleryId !== 'number' || binding.galleryId <= 0)) {
      errors.push('galleryId 必须是正整数或 null');
    }
    if (!binding.downloadPath || typeof binding.downloadPath !== 'string') errors.push('downloadPath 必须是非空字符串');
    if (typeof binding.enabled !== 'boolean') errors.push('enabled 必须是布尔值');
    if (binding.lastTaskId !== undefined && binding.lastTaskId !== null && typeof binding.lastTaskId !== 'string') errors.push('lastTaskId 必须是字符串或 null');
    if (binding.lastSessionId !== undefined && binding.lastSessionId !== null && typeof binding.lastSessionId !== 'string') errors.push('lastSessionId 必须是字符串或 null');
    if (binding.blacklistedTags !== undefined && binding.blacklistedTags !== null && !Array.isArray(binding.blacklistedTags)) {
      errors.push('blacklistedTags 必须是数组或 null');
    }
    return errors;
  }

  it('完整绑定配置应通过验证', () => {
    const binding = {
      id: 1,
      favoriteTagId: 1,
      galleryId: 2,
      downloadPath: 'D:/downloads/tag',
      enabled: true,
      lastTaskId: 'task-1',
      lastSessionId: 'session-1',
      blacklistedTags: ['tag_a', 'tag_b'],
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    };
    expect(validateFavoriteTagDownloadBinding(binding)).toEqual([]);
  });

  it('galleryId 可为 null', () => {
    const binding = {
      favoriteTagId: 1,
      galleryId: null,
      downloadPath: 'D:/downloads/tag',
      enabled: true,
    };
    expect(validateFavoriteTagDownloadBinding(binding)).toEqual([]);
  });

  it('autoCreateGallery 和 autoSyncGalleryAfterDownload 应允许布尔值', () => {
    const binding = {
      favoriteTagId: 1,
      galleryId: null,
      downloadPath: 'D:/downloads/tag',
      enabled: true,
      autoCreateGallery: true,
      autoSyncGalleryAfterDownload: false,
    };
    expect(validateFavoriteTagDownloadBinding(binding)).toEqual([]);
  });

  it('lastTaskId 和 lastSessionId 应保持字符串语义', () => {
    const binding = {
      favoriteTagId: 1,
      galleryId: null,
      downloadPath: 'D:/downloads/tag',
      enabled: true,
      lastTaskId: 123,
      lastSessionId: 456,
    };
    expect(validateFavoriteTagDownloadBinding(binding)).toContain('lastTaskId 必须是字符串或 null');
    expect(validateFavoriteTagDownloadBinding(binding)).toContain('lastSessionId 必须是字符串或 null');
  });
});

describe('BulkDownloadSession 来源字段验证', () => {
  function validateBulkDownloadSessionOrigin(session: Record<string, any>): string[] {
    const errors: string[] = [];
    if (session.originType !== undefined && session.originType !== 'favoriteTag') {
      errors.push('originType 必须是 favoriteTag 或 undefined');
    }
    if (session.originId !== undefined && session.originId !== null && (typeof session.originId !== 'number' || session.originId <= 0)) {
      errors.push('originId 必须是正整数或 undefined');
    }
    return errors;
  }

  it('favoriteTag 来源元数据应通过验证', () => {
    expect(validateBulkDownloadSessionOrigin({ originType: 'favoriteTag', originId: 3 })).toEqual([]);
  });

  it('未知 originType 应报错', () => {
    expect(validateBulkDownloadSessionOrigin({ originType: 'manual', originId: 3 })).toContain('originType 必须是 favoriteTag 或 undefined');
  });
});

describe('ApiResponse 结构验证', () => {
  function isValidApiResponse(response: Record<string, any>): boolean {
    if (typeof response.success !== 'boolean') return false;
    if (response.success && response.error) return false; // success=true 时不应有 error
    if (!response.success && !response.error && !response.message) return false; // 失败时应有错误信息
    return true;
  }

  it('成功响应应合法', () => {
    expect(isValidApiResponse({ success: true, data: [1, 2, 3] })).toBe(true);
  });

  it('失败响应带 error 应合法', () => {
    expect(isValidApiResponse({ success: false, error: 'Something failed' })).toBe(true);
  });

  it('失败响应带 message 应合法', () => {
    expect(isValidApiResponse({ success: false, message: 'Not found' })).toBe(true);
  });

  it('成功但带 error 应不合法', () => {
    expect(isValidApiResponse({ success: true, error: 'oops' })).toBe(false);
  });

  it('失败但无错误信息应不合法', () => {
    expect(isValidApiResponse({ success: false })).toBe(false);
  });
});
