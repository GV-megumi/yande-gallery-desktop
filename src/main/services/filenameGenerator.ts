import path from 'path';

export interface FileNameTokens {
  id?: string | number;
  md5?: string;
  extension?: string;
  width?: number;
  height?: number;
  rating?: string;
  score?: number;
  site?: string;
  artist?: string;
  character?: string;
  copyright?: string;
  date?: string;
  tags?: string;
}

/**
 * 生成文件名
 * @param template 文件名模板，如 "{id}_{md5}.{extension}"
 * @param metadata 文件元数据
 */
export function generateFileName(
  template: string,
  metadata: FileNameTokens
): string {
  let result = template;

  // 替换所有标记
  const tokens: (keyof FileNameTokens)[] = [
    'id', 'md5', 'extension', 'width', 'height', 'rating', 'score',
    'site', 'artist', 'character', 'copyright', 'date', 'tags'
  ];

  for (const key of tokens) {
    const token = `{${key}}`;
    // 使用全局替换
    if (result.includes(token)) {
      const value = metadata[key];
      result = result.split(token).join(value !== undefined && value !== null ? String(value) : '');
    }
  }

  // 移除未替换的标记
  result = result.replace(/\{[^}]+\}/g, '');

  // 清理非法字符
  result = sanitizeFileName(result);

  return result;
}

/**
 * 清理文件名中的非法字符
 */
export function sanitizeFileName(fileName: string): string {
  // 替换 Windows/Linux 非法字符: < > : " / \ | ? *
  // 同时也替换控制字符
  // eslint-disable-next-line no-control-regex
  return fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
}
