import { describe, it, expect } from 'vitest';

/**
 * 视频格式检测逻辑测试
 *
 * 从 BooruPostDetailsPage 和 BooruImageCard 中提取的 isVideoPost 函数
 * 支持两种检测路径：
 *   1. 优先通过 fileExt 字段判断
 *   2. fileExt 不存在时，从 fileUrl 的扩展名回退判断
 */

// ========= 等价实现：VIDEO_EXTENSIONS 集合 =========

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mkv', 'mov', 'avi']);

// ========= 等价实现：isVideoPost（完整版，与 BooruPostDetailsPage 一致） =========

function isVideoPost(post: { fileExt?: string; fileUrl?: string } | null): boolean {
  if (!post) return false;
  // 优先通过 fileExt 判断
  if (post.fileExt && VIDEO_EXTENSIONS.has(post.fileExt.toLowerCase())) return true;
  // 回退：从 fileUrl 提取扩展名
  const url = post.fileUrl || '';
  const ext = url.split('.').pop()?.split('?')[0]?.toLowerCase() || '';
  return VIDEO_EXTENSIONS.has(ext);
}

// ========= 测试 =========

describe('VIDEO_EXTENSIONS 集合', () => {
  it('应包含所有预期的视频格式', () => {
    const expected = ['mp4', 'webm', 'mkv', 'mov', 'avi'];
    for (const ext of expected) {
      expect(VIDEO_EXTENSIONS.has(ext)).toBe(true);
    }
  });

  it('不应包含常见图片格式', () => {
    const imageFormats = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg'];
    for (const ext of imageFormats) {
      expect(VIDEO_EXTENSIONS.has(ext)).toBe(false);
    }
  });

  it('集合大小应为 5', () => {
    expect(VIDEO_EXTENSIONS.size).toBe(5);
  });
});

describe('isVideoPost - fileExt 检测', () => {
  it('fileExt 为 mp4 时应返回 true', () => {
    expect(isVideoPost({ fileExt: 'mp4' })).toBe(true);
  });

  it('fileExt 为 webm 时应返回 true', () => {
    expect(isVideoPost({ fileExt: 'webm' })).toBe(true);
  });

  it('fileExt 为 mkv 时应返回 true', () => {
    expect(isVideoPost({ fileExt: 'mkv' })).toBe(true);
  });

  it('fileExt 为 mov 时应返回 true', () => {
    expect(isVideoPost({ fileExt: 'mov' })).toBe(true);
  });

  it('fileExt 为 avi 时应返回 true', () => {
    expect(isVideoPost({ fileExt: 'avi' })).toBe(true);
  });

  it('fileExt 大写 MP4 时应返回 true（大小写不敏感）', () => {
    expect(isVideoPost({ fileExt: 'MP4' })).toBe(true);
  });

  it('fileExt 混合大小写 WebM 时应返回 true', () => {
    expect(isVideoPost({ fileExt: 'WebM' })).toBe(true);
  });

  it('fileExt 为 jpg 时应返回 false', () => {
    expect(isVideoPost({ fileExt: 'jpg' })).toBe(false);
  });

  it('fileExt 为 png 时应返回 false', () => {
    expect(isVideoPost({ fileExt: 'png' })).toBe(false);
  });

  it('fileExt 为 gif 时应返回 false', () => {
    expect(isVideoPost({ fileExt: 'gif' })).toBe(false);
  });

  it('fileExt 为 webp 时应返回 false', () => {
    expect(isVideoPost({ fileExt: 'webp' })).toBe(false);
  });

  it('fileExt 为 undefined 时应回退到 fileUrl 检测', () => {
    // fileExt 缺失，fileUrl 为视频 → 应返回 true
    expect(isVideoPost({ fileExt: undefined, fileUrl: 'https://example.com/video.mp4' })).toBe(true);
    // fileExt 缺失，fileUrl 为图片 → 应返回 false
    expect(isVideoPost({ fileExt: undefined, fileUrl: 'https://example.com/image.jpg' })).toBe(false);
  });

  it('fileExt 为空字符串时应回退到 fileUrl 检测', () => {
    // 空字符串是 falsy，应回退到 URL 检测
    expect(isVideoPost({ fileExt: '', fileUrl: 'https://example.com/video.webm' })).toBe(true);
    expect(isVideoPost({ fileExt: '', fileUrl: 'https://example.com/image.png' })).toBe(false);
  });
});

describe('isVideoPost - fileUrl 回退检测', () => {
  it('URL 以 .mp4 结尾应返回 true', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/video.mp4' })).toBe(true);
  });

  it('URL 以 .webm 结尾应返回 true', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/video.webm' })).toBe(true);
  });

  it('URL 以 .mkv 结尾应返回 true', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/video.mkv' })).toBe(true);
  });

  it('URL 以 .mov 结尾应返回 true', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/video.mov' })).toBe(true);
  });

  it('URL 以 .avi 结尾应返回 true', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/video.avi' })).toBe(true);
  });

  it('URL 以 .jpg 结尾应返回 false', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/image.jpg' })).toBe(false);
  });

  it('URL 以 .png 结尾应返回 false', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/image.png' })).toBe(false);
  });

  it('URL 带查询参数 .mp4?quality=high 应正确提取扩展名并返回 true', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/video.mp4?quality=high' })).toBe(true);
  });

  it('URL 带查询参数 .jpg?v=2 应返回 false', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/image.jpg?v=2' })).toBe(false);
  });

  it('URL 带多个查询参数应正确提取扩展名', () => {
    expect(isVideoPost({ fileUrl: 'https://cdn.example.com/media/clip.webm?token=abc&expire=123' })).toBe(true);
  });

  it('URL 大写扩展名 .MP4 应返回 true（大小写不敏感）', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/video.MP4' })).toBe(true);
  });

  it('URL 混合大小写 .WebM 应返回 true', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/video.WebM' })).toBe(true);
  });

  it('空 URL 应返回 false', () => {
    expect(isVideoPost({ fileUrl: '' })).toBe(false);
  });

  it('undefined URL 应返回 false', () => {
    expect(isVideoPost({ fileUrl: undefined })).toBe(false);
  });

  it('无扩展名的 URL 应返回 false', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/file' })).toBe(false);
  });

  it('路径中有点但最后无扩展名的 URL 应返回 false', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/path.to/file' })).toBe(false);
  });
});

describe('isVideoPost - null 和边界值', () => {
  it('null post 应返回 false', () => {
    expect(isVideoPost(null)).toBe(false);
  });

  it('空对象 {} 应返回 false', () => {
    expect(isVideoPost({})).toBe(false);
  });

  it('fileExt 和 fileUrl 都缺失应返回 false', () => {
    expect(isVideoPost({ fileExt: undefined, fileUrl: undefined })).toBe(false);
  });

  it('fileExt 和 fileUrl 都为空字符串应返回 false', () => {
    expect(isVideoPost({ fileExt: '', fileUrl: '' })).toBe(false);
  });

  it('fileExt 优先级高于 fileUrl（fileExt 为视频，fileUrl 为图片）', () => {
    // fileExt 判定为视频，应立即返回 true，不再检查 fileUrl
    expect(isVideoPost({ fileExt: 'mp4', fileUrl: 'https://example.com/image.jpg' })).toBe(true);
  });

  it('fileExt 为图片格式时应继续检查 fileUrl', () => {
    // fileExt 为 jpg（非视频），不满足第一个条件
    // 但 fileUrl 后缀为 mp4（这种情况不太合理但逻辑上会回退检查 URL）
    expect(isVideoPost({ fileExt: 'jpg', fileUrl: 'https://example.com/video.mp4' })).toBe(true);
  });
});
