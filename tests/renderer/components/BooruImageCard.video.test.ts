import { describe, it, expect } from 'vitest';

/**
 * BooruImageCard 视频帖子显示逻辑测试
 *
 * 从 BooruImageCard.tsx 中提取视频相关的纯逻辑进行测试：
 *   1. 视频格式标签（徽章）文本生成
 *   2. 视频帖子的预览 URL 处理（视频帖子仍然使用图片预览）
 *   3. 视频帖子不应走图片缓存路径（卡片本身不做缓存，但检测逻辑影响详情页行为）
 */

// ========= 等价实现：视频检测 =========

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mkv', 'mov', 'avi']);

/** BooruImageCard 中的 isVideoPost 实现（接受非 null 的 post） */
function isVideoPost(post: { fileExt?: string; fileUrl?: string }): boolean {
  if (post.fileExt && VIDEO_EXTENSIONS.has(post.fileExt.toLowerCase())) return true;
  const url = post.fileUrl || '';
  const ext = url.split('.').pop()?.split('?')[0]?.toLowerCase() || '';
  return VIDEO_EXTENSIONS.has(ext);
}

// ========= 等价实现：视频格式徽章文本 =========

/**
 * 获取视频格式徽章显示文本
 * 对应 BooruImageCard 中的 {(post.fileExt || 'VIDEO').toUpperCase()}
 */
function getVideoBadgeText(fileExt?: string): string {
  return (fileExt || 'VIDEO').toUpperCase();
}

// ========= 等价实现：预览 URL 计算 =========

/**
 * 与 BooruImageCard 的 computedPreviewUrl 逻辑一致
 * 视频帖子和图片帖子在卡片上共用同一套预览 URL 逻辑
 * （卡片始终显示缩略图，不区分视频/图片）
 */
function computePreviewUrl(
  previewUrl?: string,
  postPreviewUrl?: string,
  sampleUrl?: string,
  fileUrl?: string
): string {
  let url = (previewUrl || postPreviewUrl || sampleUrl || fileUrl || '').trim();
  if (!url) return '';
  if (url.startsWith('//')) url = 'https:' + url;
  else if (
    !url.startsWith('http://') &&
    !url.startsWith('https://') &&
    !url.startsWith('app://')
  ) {
    url = 'https://' + url;
  }
  return url;
}

// ========= 测试 =========

describe('视频格式徽章文本', () => {
  it('fileExt 为 mp4 时应显示 MP4', () => {
    expect(getVideoBadgeText('mp4')).toBe('MP4');
  });

  it('fileExt 为 webm 时应显示 WEBM', () => {
    expect(getVideoBadgeText('webm')).toBe('WEBM');
  });

  it('fileExt 为 mkv 时应显示 MKV', () => {
    expect(getVideoBadgeText('mkv')).toBe('MKV');
  });

  it('fileExt 为 mov 时应显示 MOV', () => {
    expect(getVideoBadgeText('mov')).toBe('MOV');
  });

  it('fileExt 为 avi 时应显示 AVI', () => {
    expect(getVideoBadgeText('avi')).toBe('AVI');
  });

  it('fileExt 为混合大小写 Mp4 时应显示 MP4', () => {
    expect(getVideoBadgeText('Mp4')).toBe('MP4');
  });

  it('fileExt 为 undefined 时应显示默认值 VIDEO', () => {
    expect(getVideoBadgeText(undefined)).toBe('VIDEO');
  });

  it('fileExt 为空字符串时应显示默认值 VIDEO', () => {
    // 空字符串是 falsy，('' || 'VIDEO') 结果为 'VIDEO'
    expect(getVideoBadgeText('')).toBe('VIDEO');
  });
});

describe('视频帖子的卡片显示条件', () => {
  it('视频帖子应显示播放图标（isVideoPost 为 true 且图片已加载）', () => {
    // 模拟判断条件：isVideoPost(post) && imageLoaded && !imageError
    const post = { fileExt: 'mp4', fileUrl: 'https://example.com/video.mp4' };
    const imageLoaded = true;
    const imageError = false;

    const shouldShowPlayIcon = isVideoPost(post) && imageLoaded && !imageError;
    expect(shouldShowPlayIcon).toBe(true);
  });

  it('视频帖子图片未加载时不应显示播放图标', () => {
    const post = { fileExt: 'mp4' };
    const imageLoaded = false;
    const imageError = false;

    const shouldShowPlayIcon = isVideoPost(post) && imageLoaded && !imageError;
    expect(shouldShowPlayIcon).toBe(false);
  });

  it('视频帖子图片加载失败时不应显示播放图标', () => {
    const post = { fileExt: 'webm' };
    const imageLoaded = true;
    const imageError = true;

    const shouldShowPlayIcon = isVideoPost(post) && imageLoaded && !imageError;
    expect(shouldShowPlayIcon).toBe(false);
  });

  it('图片帖子不应显示播放图标', () => {
    const post = { fileExt: 'jpg' };
    const imageLoaded = true;
    const imageError = false;

    const shouldShowPlayIcon = isVideoPost(post) && imageLoaded && !imageError;
    expect(shouldShowPlayIcon).toBe(false);
  });

  it('视频帖子应始终显示格式徽章（不依赖加载状态）', () => {
    // 格式徽章的显示条件：isVideoPost(post)，不依赖 imageLoaded
    const post = { fileExt: 'mp4' };
    const shouldShowBadge = isVideoPost(post);
    expect(shouldShowBadge).toBe(true);
  });

  it('图片帖子不应显示格式徽章', () => {
    const post = { fileExt: 'png' };
    const shouldShowBadge = isVideoPost(post);
    expect(shouldShowBadge).toBe(false);
  });
});

describe('视频帖子的预览 URL 处理', () => {
  it('视频帖子在卡片中仍使用图片预览 URL（previewUrl 优先）', () => {
    // BooruImageCard 的预览始终用缩略图，不管是不是视频
    const url = computePreviewUrl(
      'https://cdn.example.com/preview/video_thumb.jpg',
      undefined,
      undefined,
      'https://cdn.example.com/video.mp4'
    );
    expect(url).toBe('https://cdn.example.com/preview/video_thumb.jpg');
  });

  it('视频帖子无 previewUrl 时回退到 sampleUrl', () => {
    const url = computePreviewUrl(
      undefined,
      undefined,
      'https://cdn.example.com/sample/video_sample.jpg',
      'https://cdn.example.com/video.mp4'
    );
    expect(url).toBe('https://cdn.example.com/sample/video_sample.jpg');
  });

  it('视频帖子无预览图时最终回退到 fileUrl（直接用视频地址）', () => {
    const url = computePreviewUrl(
      undefined,
      undefined,
      undefined,
      'https://cdn.example.com/video.mp4'
    );
    expect(url).toBe('https://cdn.example.com/video.mp4');
  });

  it('视频帖子所有 URL 均为空时返回空字符串', () => {
    const url = computePreviewUrl(undefined, undefined, undefined, undefined);
    expect(url).toBe('');
  });
});

describe('视频帖子不应走图片缓存路径', () => {
  /**
   * 在 BooruImageCard 中，卡片本身不做缓存逻辑（缓存在详情页处理）
   * 但 isVideoPost 的结果决定了详情页是否走缓存
   * 这里验证视频检测结果的正确性，确保不会误判
   */

  it('mp4 文件应被正确识别为视频（跳过缓存）', () => {
    expect(isVideoPost({ fileExt: 'mp4', fileUrl: 'https://cdn.example.com/video.mp4' })).toBe(true);
  });

  it('webm 文件应被正确识别为视频（跳过缓存）', () => {
    expect(isVideoPost({ fileExt: 'webm', fileUrl: 'https://cdn.example.com/video.webm' })).toBe(true);
  });

  it('jpg 文件不应被识别为视频（走正常缓存流程）', () => {
    expect(isVideoPost({ fileExt: 'jpg', fileUrl: 'https://cdn.example.com/image.jpg' })).toBe(false);
  });

  it('png 文件不应被识别为视频（走正常缓存流程）', () => {
    expect(isVideoPost({ fileExt: 'png', fileUrl: 'https://cdn.example.com/image.png' })).toBe(false);
  });

  it('gif 文件不应被识别为视频（走正常缓存流程）', () => {
    expect(isVideoPost({ fileExt: 'gif', fileUrl: 'https://cdn.example.com/image.gif' })).toBe(false);
  });
});
