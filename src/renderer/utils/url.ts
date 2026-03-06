/**
 * URL 工具函数
 * 统一管理本地路径转换和 Booru 图片 URL 选择逻辑
 * 合并自 GalleryPage、BooruPage、BooruDownloadPage、BooruFavoritesPage、ImageGrid 中的重复实现
 */

/**
 * 将本地文件路径转换为 app:// 协议 URL
 * 例如: M:\booru_u\file.jpg -> app://m/booru_u/file.jpg
 * 例如: /home/user/file.jpg -> app:///home/user/file.jpg
 */
export function localPathToAppUrl(filePath: string): string {
  if (!filePath) return '';

  // 反斜杠转正斜杠
  let normalizedPath = filePath.replace(/\\/g, '/');

  // 处理 Windows 盘符路径 (例如: M:/path -> m/path)
  if (/^[A-Za-z]:/.test(normalizedPath)) {
    normalizedPath = normalizedPath.charAt(0).toLowerCase() + normalizedPath.substring(2);
  }

  // 对路径的每个部分进行 URL 编码，但保留 /
  const encodedPath = normalizedPath
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');

  return `app://${encodedPath}`;
}

/** 预览质量选项（兼容 BooruPage 的 original/high/medium/low/auto） */
export type PreviewQuality = 'original' | 'high' | 'medium' | 'low' | 'auto' | 'sample' | 'preview';

/**
 * 获取 Booru 图片预览 URL
 * 根据质量偏好选择最合适的 URL，带降级回退链
 * 合并自 BooruPage、BooruFavoritesPage、BooruTagSearchPage、BooruImageCard 的 getPreviewUrl
 *
 * URL 选择策略（参考 Boorusama）：
 * - preview -> previewUrl（缩略图，基于 MD5 路径，最可靠）
 * - sample  -> sampleUrl（样本图）
 * - original -> fileUrl（原图）
 *
 * yande.re 特殊处理：file_url 和 sample_url 可能包含标签导致 307 重定向，
 * preview_url 使用基于 MD5 的简单路径格式，更稳定
 *
 * @param post Booru 图片对象（需包含 fileUrl/sampleUrl/previewUrl/localPath 字段）
 * @param quality 预览质量偏好
 * @returns 图片 URL（远程 URL 或 app:// 本地 URL）
 */
export function getBooruPreviewUrl(post: any, quality: PreviewQuality = 'auto'): string {
  if (!post) return '';

  // 已下载的本地文件优先
  if (post.localPath) {
    const localUrl = localPathToAppUrl(post.localPath);
    if (localUrl) return localUrl;
  }

  // 统一质量映射：将各种格式归一化为 URL 优先级链
  // 字段名兼容 BooruPost 类型（camelCase）和 API 返回（snake_case）
  const fileUrl = post.fileUrl || post.file_url || '';
  const sampleUrl = post.sampleUrl || post.sample_url || '';
  const previewUrl = post.previewUrl || post.preview_url || '';
  const jpegUrl = post.jpegUrl || post.jpeg_url || '';

  let url = '';

  if (quality === 'original') {
    url = fileUrl || jpegUrl || sampleUrl || previewUrl;
  } else if (quality === 'high' || quality === 'sample') {
    url = sampleUrl || jpegUrl || previewUrl || fileUrl;
  } else if (quality === 'low' || quality === 'preview') {
    url = previewUrl || sampleUrl || jpegUrl || fileUrl;
  } else {
    // auto / medium：优先 sampleUrl
    url = sampleUrl || previewUrl || jpegUrl || fileUrl;
  }

  // yande.re 特殊处理：URL 包含 %20（标签编码）可能导致 307 重定向
  // 回退到 previewUrl（基于 MD5 的简单路径，不含标签）
  if (url && (url.includes('%20') || url.includes('yande.re%20'))) {
    if (previewUrl) {
      console.warn('[url] URL 包含标签可能导致 307，回退到 previewUrl');
      url = previewUrl;
    }
  }

  if (!url || !url.trim()) {
    return '';
  }

  // 远程 URL 直接返回，本地路径转 app://
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return localPathToAppUrl(url);
}

/**
 * 获取 Booru 图片完整分辨率 URL
 */
export function getBooruFileUrl(post: any): string {
  if (!post) return '';

  if (post.downloaded && post.localPath) {
    return localPathToAppUrl(post.localPath);
  }

  // 完整图优先级：file_url > jpeg_url > sample_url
  for (const key of ['file_url', 'jpeg_url', 'sample_url']) {
    const url = post[key];
    if (url && typeof url === 'string' && url.trim()) {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
      }
      return localPathToAppUrl(url);
    }
  }

  return '';
}
