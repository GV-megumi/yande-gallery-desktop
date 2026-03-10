import { describe, it, expect } from 'vitest';
import {
  localPathToAppUrl,
  getBooruPreviewUrl,
  getBooruFileUrl,
} from '../../../src/renderer/utils/url';

// ========= localPathToAppUrl =========

describe('localPathToAppUrl', () => {
  it('应转换 Windows 路径', () => {
    const result = localPathToAppUrl('M:\\booru_u\\file.jpg');
    expect(result).toBe('app://m/booru_u/file.jpg');
  });

  it('应转换小写 Windows 盘符', () => {
    const result = localPathToAppUrl('c:\\Users\\test\\image.png');
    expect(result).toBe('app://c/Users/test/image.png');
  });

  it('应转换 Unix 路径', () => {
    const result = localPathToAppUrl('/home/user/file.jpg');
    expect(result).toBe('app:///home/user/file.jpg');
  });

  it('空字符串应返回空', () => {
    expect(localPathToAppUrl('')).toBe('');
  });

  it('null/undefined 应返回空', () => {
    expect(localPathToAppUrl(null as any)).toBe('');
    expect(localPathToAppUrl(undefined as any)).toBe('');
  });

  it('应 URL 编码特殊字符', () => {
    const result = localPathToAppUrl('M:\\images\\file name (1).jpg');
    expect(result).toContain('file%20name%20(1).jpg');
    expect(result).toMatch(/^app:\/\//);
  });

  it('应保留路径分隔符 /', () => {
    const result = localPathToAppUrl('M:\\a\\b\\c\\d.jpg');
    expect(result).toBe('app://m/a/b/c/d.jpg');
  });

  it('应处理已是正斜杠的路径', () => {
    const result = localPathToAppUrl('M:/booru/test.jpg');
    expect(result).toBe('app://m/booru/test.jpg');
  });

  it('应编码中文路径', () => {
    const result = localPathToAppUrl('M:\\图片\\测试.jpg');
    expect(result).toContain('app://m/');
    expect(result).toContain('.jpg');
  });
});

// ========= getBooruPreviewUrl =========

describe('getBooruPreviewUrl', () => {
  const fullPost = {
    fileUrl: 'https://cdn.example.com/original.jpg',
    sampleUrl: 'https://cdn.example.com/sample.jpg',
    previewUrl: 'https://cdn.example.com/preview.jpg',
    jpegUrl: 'https://cdn.example.com/jpeg.jpg',
    localPath: '',
  };

  it('null post 应返回空', () => {
    expect(getBooruPreviewUrl(null)).toBe('');
    expect(getBooruPreviewUrl(undefined)).toBe('');
  });

  it('空 post 应返回空', () => {
    expect(getBooruPreviewUrl({})).toBe('');
  });

  // --- quality: original ---

  it('original 质量应优先 fileUrl', () => {
    const result = getBooruPreviewUrl(fullPost, 'original');
    expect(result).toBe('https://cdn.example.com/original.jpg');
  });

  it('original 缺少 fileUrl 应回退到 jpegUrl', () => {
    const post = { ...fullPost, fileUrl: '' };
    const result = getBooruPreviewUrl(post, 'original');
    expect(result).toBe('https://cdn.example.com/jpeg.jpg');
  });

  // --- quality: high / sample ---

  it('high 质量应优先 sampleUrl', () => {
    const result = getBooruPreviewUrl(fullPost, 'high');
    expect(result).toBe('https://cdn.example.com/sample.jpg');
  });

  it('sample 质量应优先 sampleUrl', () => {
    const result = getBooruPreviewUrl(fullPost, 'sample');
    expect(result).toBe('https://cdn.example.com/sample.jpg');
  });

  // --- quality: low / preview ---

  it('low 质量应优先 previewUrl', () => {
    const result = getBooruPreviewUrl(fullPost, 'low');
    expect(result).toBe('https://cdn.example.com/preview.jpg');
  });

  it('preview 质量应优先 previewUrl', () => {
    const result = getBooruPreviewUrl(fullPost, 'preview');
    expect(result).toBe('https://cdn.example.com/preview.jpg');
  });

  // --- quality: auto / medium ---

  it('auto 质量应优先 sampleUrl', () => {
    const result = getBooruPreviewUrl(fullPost, 'auto');
    expect(result).toBe('https://cdn.example.com/sample.jpg');
  });

  it('medium 质量应优先 sampleUrl', () => {
    const result = getBooruPreviewUrl(fullPost, 'medium');
    expect(result).toBe('https://cdn.example.com/sample.jpg');
  });

  it('默认质量应为 auto', () => {
    const result = getBooruPreviewUrl(fullPost);
    expect(result).toBe('https://cdn.example.com/sample.jpg');
  });

  // --- 降级回退 ---

  it('只有 previewUrl 时所有质量都应返回它', () => {
    const post = { previewUrl: 'https://cdn.example.com/preview.jpg' };
    expect(getBooruPreviewUrl(post, 'original')).toBe('https://cdn.example.com/preview.jpg');
    expect(getBooruPreviewUrl(post, 'high')).toBe('https://cdn.example.com/preview.jpg');
    expect(getBooruPreviewUrl(post, 'auto')).toBe('https://cdn.example.com/preview.jpg');
  });

  it('只有 fileUrl 时应回退到它', () => {
    const post = { fileUrl: 'https://cdn.example.com/original.jpg' };
    expect(getBooruPreviewUrl(post, 'low')).toBe('https://cdn.example.com/original.jpg');
    expect(getBooruPreviewUrl(post, 'auto')).toBe('https://cdn.example.com/original.jpg');
  });

  // --- 本地路径优先 ---

  it('有 localPath 时应优先使用本地文件', () => {
    const post = { ...fullPost, localPath: 'M:\\downloads\\local.jpg' };
    const result = getBooruPreviewUrl(post);
    expect(result).toMatch(/^app:\/\//);
    expect(result).toContain('local.jpg');
  });

  // --- snake_case 字段兼容 ---

  it('应兼容 snake_case 字段名', () => {
    const post = {
      file_url: 'https://cdn.example.com/file.jpg',
      sample_url: 'https://cdn.example.com/sample.jpg',
      preview_url: 'https://cdn.example.com/preview.jpg',
    };
    expect(getBooruPreviewUrl(post, 'original')).toBe('https://cdn.example.com/file.jpg');
    expect(getBooruPreviewUrl(post, 'high')).toBe('https://cdn.example.com/sample.jpg');
    expect(getBooruPreviewUrl(post, 'low')).toBe('https://cdn.example.com/preview.jpg');
  });

  // --- yande.re 特殊处理 ---

  it('URL 含 %20 时应回退到 previewUrl', () => {
    const post = {
      sampleUrl: 'https://files.yande.re/sample/abc%20def%20ghi.jpg',
      previewUrl: 'https://files.yande.re/preview/abc123.jpg',
    };
    const result = getBooruPreviewUrl(post, 'auto');
    expect(result).toBe('https://files.yande.re/preview/abc123.jpg');
  });

  it('URL 含 %20 但无 previewUrl 时应保留原 URL', () => {
    const post = {
      sampleUrl: 'https://files.yande.re/sample/abc%20def.jpg',
    };
    const result = getBooruPreviewUrl(post, 'auto');
    // previewUrl 为空，回退逻辑不生效，使用原 URL
    expect(result).toBe('https://files.yande.re/sample/abc%20def.jpg');
  });
});

// ========= getBooruFileUrl =========

describe('getBooruFileUrl', () => {
  it('null post 应返回空', () => {
    expect(getBooruFileUrl(null)).toBe('');
    expect(getBooruFileUrl(undefined)).toBe('');
  });

  it('空 post 应返回空', () => {
    expect(getBooruFileUrl({})).toBe('');
  });

  it('已下载的帖子应返回本地路径', () => {
    const post = {
      downloaded: true,
      localPath: 'M:\\downloads\\image.jpg',
      file_url: 'https://cdn.example.com/original.jpg',
    };
    const result = getBooruFileUrl(post);
    expect(result).toMatch(/^app:\/\//);
    expect(result).toContain('image.jpg');
  });

  it('未下载应优先返回 file_url', () => {
    const post = {
      file_url: 'https://cdn.example.com/original.jpg',
      jpeg_url: 'https://cdn.example.com/jpeg.jpg',
      sample_url: 'https://cdn.example.com/sample.jpg',
    };
    const result = getBooruFileUrl(post);
    expect(result).toBe('https://cdn.example.com/original.jpg');
  });

  it('缺少 file_url 应回退到 jpeg_url', () => {
    const post = {
      jpeg_url: 'https://cdn.example.com/jpeg.jpg',
      sample_url: 'https://cdn.example.com/sample.jpg',
    };
    const result = getBooruFileUrl(post);
    expect(result).toBe('https://cdn.example.com/jpeg.jpg');
  });

  it('只有 sample_url 应回退到它', () => {
    const post = {
      sample_url: 'https://cdn.example.com/sample.jpg',
    };
    const result = getBooruFileUrl(post);
    expect(result).toBe('https://cdn.example.com/sample.jpg');
  });

  it('所有 URL 为空应返回空', () => {
    const post = { file_url: '', jpeg_url: '', sample_url: '' };
    const result = getBooruFileUrl(post);
    expect(result).toBe('');
  });

  it('空白 URL 应被跳过', () => {
    const post = {
      file_url: '   ',
      sample_url: 'https://cdn.example.com/sample.jpg',
    };
    const result = getBooruFileUrl(post);
    expect(result).toBe('https://cdn.example.com/sample.jpg');
  });

  it('本地路径（非 http）应转为 app:// URL', () => {
    const post = {
      file_url: 'M:\\local\\file.jpg',
    };
    const result = getBooruFileUrl(post);
    expect(result).toMatch(/^app:\/\//);
  });
});
