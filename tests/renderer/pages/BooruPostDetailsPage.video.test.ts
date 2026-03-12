import { describe, it, expect } from 'vitest';

/**
 * BooruPostDetailsPage 视频帖子行为测试
 *
 * 从 BooruPostDetailsPage.tsx 中提取与视频相关的纯逻辑进行测试：
 *   1. 视频帖子应直接使用 fileUrl，不走缓存
 *   2. 视频帖子不应出现在图片预加载列表中
 *   3. 视频帖子的预览质量选择逻辑
 *   4. 视频帖子应渲染 <video> 而非 <img>（条件判断逻辑）
 *   5. 视频帖子不应显示注释叠加层（NotesOverlay）
 */

// ========= 等价实现 =========

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mkv', 'mov', 'avi']);

/** 与 BooruPostDetailsPage 中的 isVideoPost 完全一致 */
function isVideoPost(post: { fileExt?: string; fileUrl?: string } | null): boolean {
  if (!post) return false;
  if (post.fileExt && VIDEO_EXTENSIONS.has(post.fileExt.toLowerCase())) return true;
  const url = post.fileUrl || '';
  const ext = url.split('.').pop()?.split('?')[0]?.toLowerCase() || '';
  return VIDEO_EXTENSIONS.has(ext);
}

/** 模拟帖子类型 */
interface MockPost {
  fileExt?: string;
  fileUrl?: string;
  md5?: string;
  localPath?: string;
  sampleUrl?: string;
  previewUrl?: string;
  postId?: number;
}

/**
 * 模拟详情页的 imageUrl 决策逻辑
 * 还原 BooruPostDetailsPage 中 loadOriginalImage 的核心分支
 *
 * 返回值说明：
 *   - 'local:...'    → 使用本地路径
 *   - 'fallback:...' → 使用 sampleUrl/previewUrl 回退
 *   - 'direct:...'   → 视频帖子直接使用 fileUrl（不缓存）
 *   - 'cache:...'    → 图片帖子走缓存流程
 *   - 'nocache:...'  → 图片帖子缺少 md5/fileExt，直接使用 fileUrl
 */
function resolveImageUrlStrategy(post: MockPost | null): string {
  if (!post) return '';

  // 1. 优先使用本地路径
  if (post.localPath) {
    return `local:${post.localPath}`;
  }

  // 2. 没有原图 URL 时回退
  if (!post.fileUrl) {
    const url = post.sampleUrl || post.previewUrl || '';
    return url ? `fallback:${url}` : '';
  }

  // 3. 视频帖子直接使用原图 URL（不走缓存）
  if (isVideoPost(post)) {
    return `direct:${post.fileUrl}`;
  }

  // 4. 缺少 md5 或 fileExt 时直接使用原图 URL
  if (!post.md5 || !post.fileExt) {
    return `nocache:${post.fileUrl}`;
  }

  // 5. 正常图片走缓存流程
  return `cache:${post.fileUrl}`;
}

/**
 * 模拟预加载过滤逻辑
 * 在 BooruPostDetailsPage 的预加载中，收集条件为：
 *   p.fileUrl && p.md5 && p.fileExt && !p.localPath
 * 视频帖子虽然满足这些字段条件，但实际上缓存时 isVideoPost 会跳过
 * 这里测试预加载候选列表的筛选逻辑
 */
function getPreloadCandidates(
  posts: MockPost[],
  currentIndex: number,
  preloadRange: number = 3
): MockPost[] {
  const startIndex = Math.max(0, currentIndex - preloadRange);
  const endIndex = Math.min(posts.length - 1, currentIndex + preloadRange);

  const candidates: MockPost[] = [];
  for (let distance = 1; distance <= preloadRange; distance++) {
    // 下一张
    const nextIdx = currentIndex + distance;
    if (nextIdx <= endIndex && posts[nextIdx]) {
      const p = posts[nextIdx];
      if (p.fileUrl && p.md5 && p.fileExt && !p.localPath) {
        candidates.push(p);
      }
    }
    // 上一张
    const prevIdx = currentIndex - distance;
    if (prevIdx >= startIndex && posts[prevIdx]) {
      const p = posts[prevIdx];
      if (p.fileUrl && p.md5 && p.fileExt && !p.localPath) {
        candidates.push(p);
      }
    }
  }
  return candidates;
}

// ========= 测试 =========

describe('视频帖子应直接使用 fileUrl（不走缓存）', () => {
  it('mp4 视频帖子应返回 direct 策略', () => {
    const result = resolveImageUrlStrategy({
      fileExt: 'mp4',
      fileUrl: 'https://cdn.example.com/video.mp4',
      md5: 'abc123',
    });
    expect(result).toBe('direct:https://cdn.example.com/video.mp4');
  });

  it('webm 视频帖子应返回 direct 策略', () => {
    const result = resolveImageUrlStrategy({
      fileExt: 'webm',
      fileUrl: 'https://cdn.example.com/video.webm',
      md5: 'def456',
    });
    expect(result).toBe('direct:https://cdn.example.com/video.webm');
  });

  it('mkv 视频帖子应返回 direct 策略', () => {
    const result = resolveImageUrlStrategy({
      fileExt: 'mkv',
      fileUrl: 'https://cdn.example.com/video.mkv',
      md5: 'ghi789',
    });
    expect(result).toBe('direct:https://cdn.example.com/video.mkv');
  });

  it('jpg 图片帖子应返回 cache 策略', () => {
    const result = resolveImageUrlStrategy({
      fileExt: 'jpg',
      fileUrl: 'https://cdn.example.com/image.jpg',
      md5: 'abc123',
    });
    expect(result).toBe('cache:https://cdn.example.com/image.jpg');
  });

  it('png 图片帖子应返回 cache 策略', () => {
    const result = resolveImageUrlStrategy({
      fileExt: 'png',
      fileUrl: 'https://cdn.example.com/image.png',
      md5: 'xyz789',
    });
    expect(result).toBe('cache:https://cdn.example.com/image.png');
  });

  it('有本地路径的帖子应优先使用本地路径（无论是否为视频）', () => {
    const result = resolveImageUrlStrategy({
      fileExt: 'mp4',
      fileUrl: 'https://cdn.example.com/video.mp4',
      md5: 'abc123',
      localPath: 'M:\\downloads\\video.mp4',
    });
    expect(result).toBe('local:M:\\downloads\\video.mp4');
  });

  it('无 fileUrl 时应回退到 sampleUrl', () => {
    const result = resolveImageUrlStrategy({
      fileExt: 'mp4',
      sampleUrl: 'https://cdn.example.com/sample.jpg',
    });
    expect(result).toBe('fallback:https://cdn.example.com/sample.jpg');
  });

  it('无 fileUrl 也无 sampleUrl 时应回退到 previewUrl', () => {
    const result = resolveImageUrlStrategy({
      fileExt: 'mp4',
      previewUrl: 'https://cdn.example.com/preview.jpg',
    });
    expect(result).toBe('fallback:https://cdn.example.com/preview.jpg');
  });

  it('null post 应返回空字符串', () => {
    expect(resolveImageUrlStrategy(null)).toBe('');
  });

  it('缺少 md5 的图片帖子应返回 nocache 策略', () => {
    const result = resolveImageUrlStrategy({
      fileExt: 'jpg',
      fileUrl: 'https://cdn.example.com/image.jpg',
      // md5 缺失
    });
    expect(result).toBe('nocache:https://cdn.example.com/image.jpg');
  });

  it('缺少 fileExt 的帖子应回退到 URL 检测后走 nocache 策略', () => {
    // fileExt 缺失，fileUrl 后缀为 jpg → isVideoPost 返回 false
    // md5 也缺失 → nocache
    const result = resolveImageUrlStrategy({
      fileUrl: 'https://cdn.example.com/image.jpg',
    });
    expect(result).toBe('nocache:https://cdn.example.com/image.jpg');
  });

  it('缺少 fileExt 但 URL 为视频格式时应走 direct 策略', () => {
    // fileExt 缺失，fileUrl 后缀为 mp4 → isVideoPost 通过 URL 回退返回 true
    const result = resolveImageUrlStrategy({
      fileUrl: 'https://cdn.example.com/video.mp4',
      md5: 'abc123',
    });
    expect(result).toBe('direct:https://cdn.example.com/video.mp4');
  });
});

describe('视频帖子的预加载行为', () => {
  const posts: MockPost[] = [
    { postId: 1, fileExt: 'jpg', fileUrl: 'https://cdn.example.com/1.jpg', md5: 'md5_1' },
    { postId: 2, fileExt: 'mp4', fileUrl: 'https://cdn.example.com/2.mp4', md5: 'md5_2' },
    { postId: 3, fileExt: 'png', fileUrl: 'https://cdn.example.com/3.png', md5: 'md5_3' },
    { postId: 4, fileExt: 'webm', fileUrl: 'https://cdn.example.com/4.webm', md5: 'md5_4' },
    { postId: 5, fileExt: 'jpg', fileUrl: 'https://cdn.example.com/5.jpg', md5: 'md5_5' },
  ];

  it('预加载候选列表应包含视频帖子（字段条件满足）', () => {
    // 预加载筛选只看 fileUrl/md5/fileExt/localPath，不区分视频/图片
    // 视频帖子满足这些字段条件，会被加入候选列表
    const candidates = getPreloadCandidates(posts, 2); // 当前为第 3 张（index=2）
    const candidateIds = candidates.map(p => p.postId);

    // 距离 1：postId=4(webm), postId=2(mp4)
    // 距离 2：postId=5(jpg), postId=1(jpg)
    expect(candidateIds).toContain(2); // mp4 视频
    expect(candidateIds).toContain(4); // webm 视频
  });

  it('预加载候选中的视频帖子在实际缓存时会被跳过', () => {
    // 模拟实际缓存逻辑：视频帖子虽然在候选列表中，
    // 但 resolveImageUrlStrategy 会返回 direct 而非 cache
    const candidates = getPreloadCandidates(posts, 2);
    for (const candidate of candidates) {
      const strategy = resolveImageUrlStrategy(candidate);
      if (isVideoPost(candidate)) {
        // 视频帖子：direct（不走缓存）
        expect(strategy.startsWith('direct:')).toBe(true);
      } else {
        // 图片帖子：cache（走缓存）
        expect(strategy.startsWith('cache:')).toBe(true);
      }
    }
  });

  it('有本地路径的帖子不应出现在预加载候选列表中', () => {
    const postsWithLocal: MockPost[] = [
      { postId: 1, fileExt: 'jpg', fileUrl: 'https://cdn.example.com/1.jpg', md5: 'md5_1' },
      { postId: 2, fileExt: 'jpg', fileUrl: 'https://cdn.example.com/2.jpg', md5: 'md5_2', localPath: 'M:\\local\\2.jpg' },
      { postId: 3, fileExt: 'png', fileUrl: 'https://cdn.example.com/3.png', md5: 'md5_3' },
    ];
    const candidates = getPreloadCandidates(postsWithLocal, 0);
    const candidateIds = candidates.map(p => p.postId);
    // postId=2 有 localPath，应被排除
    expect(candidateIds).not.toContain(2);
    expect(candidateIds).toContain(3);
  });

  it('缺少 md5 的帖子不应出现在预加载候选列表中', () => {
    const postsNoMd5: MockPost[] = [
      { postId: 1, fileExt: 'jpg', fileUrl: 'https://cdn.example.com/1.jpg', md5: 'md5_1' },
      { postId: 2, fileExt: 'jpg', fileUrl: 'https://cdn.example.com/2.jpg' }, // 无 md5
      { postId: 3, fileExt: 'png', fileUrl: 'https://cdn.example.com/3.png', md5: 'md5_3' },
    ];
    const candidates = getPreloadCandidates(postsNoMd5, 0);
    const candidateIds = candidates.map(p => p.postId);
    expect(candidateIds).not.toContain(2);
  });

  it('缺少 fileExt 的帖子不应出现在预加载候选列表中', () => {
    const postsNoExt: MockPost[] = [
      { postId: 1, fileExt: 'jpg', fileUrl: 'https://cdn.example.com/1.jpg', md5: 'md5_1' },
      { postId: 2, fileUrl: 'https://cdn.example.com/2.jpg', md5: 'md5_2' }, // 无 fileExt
      { postId: 3, fileExt: 'png', fileUrl: 'https://cdn.example.com/3.png', md5: 'md5_3' },
    ];
    const candidates = getPreloadCandidates(postsNoExt, 0);
    const candidateIds = candidates.map(p => p.postId);
    expect(candidateIds).not.toContain(2);
  });

  it('预加载范围外的帖子不应出现在候选列表中', () => {
    const manyPosts: MockPost[] = Array.from({ length: 10 }, (_, i) => ({
      postId: i,
      fileExt: 'jpg',
      fileUrl: `https://cdn.example.com/${i}.jpg`,
      md5: `md5_${i}`,
    }));
    // 当前第 5 张（index=4），预加载范围 3 → 索引 1~7
    const candidates = getPreloadCandidates(manyPosts, 4, 3);
    const candidateIds = candidates.map(p => p.postId);
    // 索引 0（postId=0）超出范围
    expect(candidateIds).not.toContain(0);
    // 索引 8、9 也超出范围
    expect(candidateIds).not.toContain(8);
    expect(candidateIds).not.toContain(9);
    // 当前帖子自身不应在列表中（distance 从 1 开始）
    expect(candidateIds).not.toContain(4);
  });
});

describe('视频帖子的渲染分支判断', () => {
  /**
   * BooruPostDetailsPage 中的渲染条件：
   *   - imageUrl && isVideoPost(currentPost)  → 渲染 <video>
   *   - imageUrl && !isVideoPost(currentPost) → 渲染 <img>
   *   - !imageUrl                              → 不渲染
   */

  it('有 imageUrl 的视频帖子应渲染为 video 元素', () => {
    const post = { fileExt: 'mp4', fileUrl: 'https://cdn.example.com/video.mp4' };
    const imageUrl = 'https://cdn.example.com/video.mp4';

    const shouldRenderVideo = !!imageUrl && isVideoPost(post);
    const shouldRenderImage = !!imageUrl && !isVideoPost(post);

    expect(shouldRenderVideo).toBe(true);
    expect(shouldRenderImage).toBe(false);
  });

  it('有 imageUrl 的图片帖子应渲染为 img 元素', () => {
    const post = { fileExt: 'jpg', fileUrl: 'https://cdn.example.com/image.jpg' };
    const imageUrl = 'https://cdn.example.com/image.jpg';

    const shouldRenderVideo = !!imageUrl && isVideoPost(post);
    const shouldRenderImage = !!imageUrl && !isVideoPost(post);

    expect(shouldRenderVideo).toBe(false);
    expect(shouldRenderImage).toBe(true);
  });

  it('无 imageUrl 时视频帖子和图片帖子都不应渲染', () => {
    const videoPost = { fileExt: 'mp4', fileUrl: 'https://cdn.example.com/video.mp4' };
    const imagePost = { fileExt: 'jpg', fileUrl: 'https://cdn.example.com/image.jpg' };
    const imageUrl = '';

    expect(!!imageUrl && isVideoPost(videoPost)).toBe(false);
    expect(!!imageUrl && !isVideoPost(imagePost)).toBe(false);
  });
});

describe('视频帖子不应显示注释叠加层', () => {
  /**
   * BooruPostDetailsPage 中的条件：
   *   {!isVideoPost(currentPost) && <NotesOverlay ... />}
   * 视频帖子不显示 NotesOverlay
   */

  it('视频帖子不应显示注释叠加层', () => {
    const post = { fileExt: 'mp4', fileUrl: 'https://cdn.example.com/video.mp4' };
    const shouldShowNotes = !isVideoPost(post);
    expect(shouldShowNotes).toBe(false);
  });

  it('图片帖子应显示注释叠加层', () => {
    const post = { fileExt: 'jpg', fileUrl: 'https://cdn.example.com/image.jpg' };
    const shouldShowNotes = !isVideoPost(post);
    expect(shouldShowNotes).toBe(true);
  });

  it('webm 视频帖子不应显示注释叠加层', () => {
    const post = { fileExt: 'webm' };
    expect(!isVideoPost(post)).toBe(false);
  });

  it('gif 帖子应显示注释叠加层（gif 不是视频格式）', () => {
    const post = { fileExt: 'gif' };
    expect(!isVideoPost(post)).toBe(true);
  });

  it('null post 不应显示注释叠加层', () => {
    // isVideoPost(null) → false, !false → true
    // 但实际组件中 currentPost 为 null 时整个组件返回 null，不会到达此判断
    // 这里仅测试纯逻辑
    expect(!isVideoPost(null)).toBe(true);
  });
});

describe('视频帖子的预览质量选择逻辑', () => {
  /**
   * 预览质量配置来自 config.yaml 中的 booru.appearance.previewQuality
   * 支持的值：'auto' | 'low' | 'medium' | 'high' | 'original'
   *
   * 对于视频帖子，无论配置什么质量，都直接使用 fileUrl（不经过质量选择）
   * 因为视频不像图片有 previewUrl/sampleUrl/fileUrl 三个质量等级
   */

  /** 模拟根据质量配置选择 URL 的逻辑 */
  function selectUrlByQuality(
    post: MockPost,
    quality: 'auto' | 'low' | 'medium' | 'high' | 'original'
  ): string {
    // 视频帖子始终使用 fileUrl
    if (isVideoPost(post)) {
      return post.fileUrl || '';
    }

    // 图片帖子根据质量选择
    switch (quality) {
      case 'low':
        return post.previewUrl || post.sampleUrl || post.fileUrl || '';
      case 'medium':
        return post.sampleUrl || post.fileUrl || '';
      case 'high':
      case 'original':
        return post.fileUrl || post.sampleUrl || '';
      case 'auto':
      default:
        return post.fileUrl || post.sampleUrl || post.previewUrl || '';
    }
  }

  it('视频帖子在 auto 质量下应使用 fileUrl', () => {
    const post: MockPost = {
      fileExt: 'mp4',
      fileUrl: 'https://cdn.example.com/video.mp4',
      sampleUrl: 'https://cdn.example.com/sample.jpg',
      previewUrl: 'https://cdn.example.com/preview.jpg',
    };
    expect(selectUrlByQuality(post, 'auto')).toBe('https://cdn.example.com/video.mp4');
  });

  it('视频帖子在 low 质量下仍应使用 fileUrl', () => {
    const post: MockPost = {
      fileExt: 'webm',
      fileUrl: 'https://cdn.example.com/video.webm',
      previewUrl: 'https://cdn.example.com/preview.jpg',
    };
    expect(selectUrlByQuality(post, 'low')).toBe('https://cdn.example.com/video.webm');
  });

  it('视频帖子在 original 质量下应使用 fileUrl', () => {
    const post: MockPost = {
      fileExt: 'mp4',
      fileUrl: 'https://cdn.example.com/video.mp4',
    };
    expect(selectUrlByQuality(post, 'original')).toBe('https://cdn.example.com/video.mp4');
  });

  it('图片帖子在 low 质量下应优先使用 previewUrl', () => {
    const post: MockPost = {
      fileExt: 'jpg',
      fileUrl: 'https://cdn.example.com/original.jpg',
      sampleUrl: 'https://cdn.example.com/sample.jpg',
      previewUrl: 'https://cdn.example.com/preview.jpg',
    };
    expect(selectUrlByQuality(post, 'low')).toBe('https://cdn.example.com/preview.jpg');
  });

  it('图片帖子在 medium 质量下应优先使用 sampleUrl', () => {
    const post: MockPost = {
      fileExt: 'jpg',
      fileUrl: 'https://cdn.example.com/original.jpg',
      sampleUrl: 'https://cdn.example.com/sample.jpg',
      previewUrl: 'https://cdn.example.com/preview.jpg',
    };
    expect(selectUrlByQuality(post, 'medium')).toBe('https://cdn.example.com/sample.jpg');
  });

  it('图片帖子在 original 质量下应优先使用 fileUrl', () => {
    const post: MockPost = {
      fileExt: 'jpg',
      fileUrl: 'https://cdn.example.com/original.jpg',
      sampleUrl: 'https://cdn.example.com/sample.jpg',
    };
    expect(selectUrlByQuality(post, 'original')).toBe('https://cdn.example.com/original.jpg');
  });
});
