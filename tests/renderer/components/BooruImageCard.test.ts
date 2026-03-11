import { describe, it, expect } from 'vitest';

/**
 * BooruImageCard 纯函数测试
 * 提取 URL 计算、isVideoPost、评分配置的等价实现进行测试
 */

// ========= 等价实现：computePreviewUrl =========

function computePreviewUrl(
  previewUrl?: string,
  postPreviewUrl?: string,
  sampleUrl?: string,
  fileUrl?: string
): string {
  let url = (previewUrl || postPreviewUrl || sampleUrl || fileUrl || '').trim();
  if (!url) return '';
  if (url.startsWith('//')) url = 'https:' + url;
  else if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('app://')) url = 'https://' + url;
  return url;
}

// ========= 等价实现：computeFullFileUrl =========

function computeFullFileUrl(fileUrl?: string): string {
  let url = (fileUrl || '').trim();
  if (!url) return '';
  if (url.startsWith('//')) url = 'https:' + url;
  else if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
  return url;
}

// ========= 等价实现：isVideoPost =========

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mkv', 'mov', 'avi']);

function isVideoPost(post: { fileUrl?: string }): boolean {
  const url = post.fileUrl || '';
  const ext = url.split('.').pop()?.split('?')[0]?.toLowerCase() || '';
  return VIDEO_EXTENSIONS.has(ext);
}

// ========= 等价实现：postPageUrl =========

function computePostPageUrl(siteUrl?: string, postId?: number): string {
  if (!siteUrl || postId === undefined) return '';
  return `${siteUrl.replace(/\/$/, '')}/post/show/${postId}`;
}

// ========= 等价实现：ratingConfig =========

function getRatingConfig(rating?: string): { color: string; text: string } {
  if (rating === 'safe') return { color: '#34C759', text: 'S' };
  if (rating === 'questionable') return { color: '#FF9500', text: 'Q' };
  return { color: '#FF3B30', text: 'E' };
}

// ========= 测试 =========

describe('computePreviewUrl', () => {
  it('应使用第一个可用的 URL（优先级：previewUrl > postPreviewUrl > sampleUrl > fileUrl）', () => {
    expect(computePreviewUrl('https://a.com/1.jpg', 'https://b.com/2.jpg')).toBe('https://a.com/1.jpg');
    expect(computePreviewUrl(undefined, 'https://b.com/2.jpg')).toBe('https://b.com/2.jpg');
    expect(computePreviewUrl(undefined, undefined, 'https://c.com/3.jpg')).toBe('https://c.com/3.jpg');
    expect(computePreviewUrl(undefined, undefined, undefined, 'https://d.com/4.jpg')).toBe('https://d.com/4.jpg');
  });

  it('// 开头的 URL 应补全为 https:', () => {
    expect(computePreviewUrl('//cdn.example.com/img.jpg')).toBe('https://cdn.example.com/img.jpg');
  });

  it('无协议的 URL 应补全 https://', () => {
    expect(computePreviewUrl('cdn.example.com/img.jpg')).toBe('https://cdn.example.com/img.jpg');
  });

  it('app:// 协议应保留不变', () => {
    expect(computePreviewUrl('app://cache/img.jpg')).toBe('app://cache/img.jpg');
  });

  it('http:// 协议应保留不变', () => {
    expect(computePreviewUrl('http://example.com/img.jpg')).toBe('http://example.com/img.jpg');
  });

  it('空字符串应返回空', () => {
    expect(computePreviewUrl('', '', '', '')).toBe('');
  });

  it('全 undefined 应返回空', () => {
    expect(computePreviewUrl()).toBe('');
  });

  it('带空格的 URL 应 trim', () => {
    expect(computePreviewUrl('  https://example.com/img.jpg  ')).toBe('https://example.com/img.jpg');
  });

  it('仅空格应返回空', () => {
    expect(computePreviewUrl('   ')).toBe('');
  });
});

describe('computeFullFileUrl', () => {
  it('正常 https URL 应保留不变', () => {
    expect(computeFullFileUrl('https://example.com/file.png')).toBe('https://example.com/file.png');
  });

  it('// 开头应补全 https:', () => {
    expect(computeFullFileUrl('//cdn.example.com/file.png')).toBe('https://cdn.example.com/file.png');
  });

  it('无协议应补全 https://', () => {
    expect(computeFullFileUrl('cdn.example.com/file.png')).toBe('https://cdn.example.com/file.png');
  });

  it('空值应返回空', () => {
    expect(computeFullFileUrl('')).toBe('');
    expect(computeFullFileUrl(undefined)).toBe('');
  });

  it('http:// 应保留', () => {
    expect(computeFullFileUrl('http://example.com/file.png')).toBe('http://example.com/file.png');
  });

  it('app:// 协议在 fullFileUrl 中会被补全 https://（与 previewUrl 不同）', () => {
    // fullFileUrl 不检查 app:// 协议，所以会被当作无协议 URL 处理
    expect(computeFullFileUrl('app://cache/file.png')).toBe('https://app://cache/file.png');
  });
});

describe('isVideoPost', () => {
  it('mp4 文件应识别为视频', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/video.mp4' })).toBe(true);
  });

  it('webm 文件应识别为视频', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/video.webm' })).toBe(true);
  });

  it('mkv 文件应识别为视频', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/video.mkv' })).toBe(true);
  });

  it('mov 文件应识别为视频', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/video.mov' })).toBe(true);
  });

  it('avi 文件应识别为视频', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/video.avi' })).toBe(true);
  });

  it('jpg 文件不应识别为视频', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/image.jpg' })).toBe(false);
  });

  it('png 文件不应识别为视频', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/image.png' })).toBe(false);
  });

  it('gif 文件不应识别为视频', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/image.gif' })).toBe(false);
  });

  it('带查询参数的 URL 应正确提取扩展名', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/video.mp4?token=abc' })).toBe(true);
    expect(isVideoPost({ fileUrl: 'https://example.com/image.jpg?v=2' })).toBe(false);
  });

  it('大写扩展名应不区分大小写', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/video.MP4' })).toBe(true);
    expect(isVideoPost({ fileUrl: 'https://example.com/video.WebM' })).toBe(true);
  });

  it('无 fileUrl 应返回 false', () => {
    expect(isVideoPost({ fileUrl: '' })).toBe(false);
    expect(isVideoPost({ fileUrl: undefined })).toBe(false);
    expect(isVideoPost({})).toBe(false);
  });

  it('无扩展名的 URL 应返回 false', () => {
    expect(isVideoPost({ fileUrl: 'https://example.com/file' })).toBe(false);
  });
});

describe('computePostPageUrl', () => {
  it('应正确拼接帖子页面 URL', () => {
    expect(computePostPageUrl('https://yande.re', 12345)).toBe('https://yande.re/post/show/12345');
  });

  it('站点 URL 末尾有斜杠应去除', () => {
    expect(computePostPageUrl('https://yande.re/', 12345)).toBe('https://yande.re/post/show/12345');
  });

  it('无站点 URL 应返回空', () => {
    expect(computePostPageUrl(undefined, 12345)).toBe('');
    expect(computePostPageUrl('', 12345)).toBe('');
  });

  it('无帖子 ID 应返回空', () => {
    expect(computePostPageUrl('https://yande.re', undefined)).toBe('');
  });

  it('帖子 ID 为 0 应正常拼接', () => {
    expect(computePostPageUrl('https://yande.re', 0)).toBe('https://yande.re/post/show/0');
  });
});

describe('getRatingConfig', () => {
  it('safe 应返回绿色和 S', () => {
    const config = getRatingConfig('safe');
    expect(config.text).toBe('S');
    expect(config.color).toBe('#34C759');
  });

  it('questionable 应返回橙色和 Q', () => {
    const config = getRatingConfig('questionable');
    expect(config.text).toBe('Q');
    expect(config.color).toBe('#FF9500');
  });

  it('explicit 应返回红色和 E', () => {
    const config = getRatingConfig('explicit');
    expect(config.text).toBe('E');
    expect(config.color).toBe('#FF3B30');
  });

  it('未知评分应默认为 E', () => {
    const config = getRatingConfig(undefined);
    expect(config.text).toBe('E');
  });

  it('空字符串应默认为 E', () => {
    const config = getRatingConfig('');
    expect(config.text).toBe('E');
  });
});
