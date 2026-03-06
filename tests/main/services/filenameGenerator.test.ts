import { describe, it, expect } from 'vitest';
import {
  parseToken,
  findTokens,
  generateFileName,
  sanitizeFileName,
} from '../../../src/main/services/filenameGenerator';

describe('parseToken', () => {
  it('应解析不带选项的 token', () => {
    const result = parseToken('{id}');
    expect(result.token).toBe('id');
    expect(result.options).toEqual({});
  });

  it('应解析带 maxlength 选项的 token', () => {
    const result = parseToken('{md5:maxlength=8}');
    expect(result.token).toBe('md5');
    expect(result.options.maxlength).toBe(8);
  });

  it('应解析带多个选项的 token', () => {
    const result = parseToken('{tags:limit=5,delimiter=-,case=lower}');
    expect(result.token).toBe('tags');
    expect(result.options.limit).toBe(5);
    expect(result.options.delimiter).toBe('-');
    expect(result.options.case).toBe('lower');
  });

  it('应解析布尔选项', () => {
    const result = parseToken('{rating:single_letter=true}');
    expect(result.token).toBe('rating');
    expect(result.options.single_letter).toBe(true);
  });

  it('应解析 pad_left 选项', () => {
    const result = parseToken('{id:pad_left=8}');
    expect(result.token).toBe('id');
    expect(result.options.pad_left).toBe(8);
  });
});

describe('findTokens', () => {
  it('应找到模板中所有 token', () => {
    const tokens = findTokens('{id}_{md5:maxlength=8}.{extension}');
    expect(tokens).toHaveLength(3);
    expect(tokens[0].token).toBe('id');
    expect(tokens[1].token).toBe('md5');
    expect(tokens[2].token).toBe('extension');
  });

  it('无 token 时返回空数组', () => {
    const tokens = findTokens('plain_filename.jpg');
    expect(tokens).toHaveLength(0);
  });
});

describe('generateFileName', () => {
  const metadata = {
    id: 12345,
    md5: 'a1b2c3d4e5f6g7h8i9j0',
    extension: 'png',
    width: 1920,
    height: 1080,
    rating: 'safe',
    score: 100,
    site: 'yande',
    tags: 'girl blue_eyes long_hair school_uniform',
  };

  it('应生成基本文件名', () => {
    const result = generateFileName('{id}.{extension}', metadata);
    expect(result).toBe('12345.png');
  });

  it('应支持 md5 maxlength', () => {
    const result = generateFileName('{site}_{id}_{md5:maxlength=8}.{extension}', metadata);
    expect(result).toBe('yande_12345_a1b2c3d4.png');
  });

  it('应支持 tags limit', () => {
    const result = generateFileName('{tags:limit=2,delimiter=_}', metadata);
    expect(result).toBe('girl_blue_eyes');
  });

  it('应处理缺失的 token 值', () => {
    const result = generateFileName('{id}_{artist}.{extension}', metadata);
    expect(result).toBe('12345_.png');
  });

  it('应支持 id pad_left', () => {
    const result = generateFileName('{id:pad_left=8}.{extension}', metadata);
    expect(result).toBe('00012345.png');
  });

  it('应支持 rating single_letter', () => {
    const result = generateFileName('{id}_{rating:single_letter=true}.{extension}', metadata);
    expect(result).toBe('12345_s.png');
  });

  it('应支持 case 转换', () => {
    const result = generateFileName('{site:case=upper}_{id}.{extension}', metadata);
    expect(result).toBe('YANDE_12345.png');
  });

  it('应使用 tokenDefaults', () => {
    const defaults = { md5: { maxlength: 6 } };
    const result = generateFileName('{id}_{md5}.{extension}', metadata, defaults);
    expect(result).toBe('12345_a1b2c3.png');
  });

  it('模板选项应覆盖 tokenDefaults', () => {
    const defaults = { md5: { maxlength: 6 } };
    const result = generateFileName('{id}_{md5:maxlength=4}.{extension}', metadata, defaults);
    expect(result).toBe('12345_a1b2.png');
  });
});

describe('sanitizeFileName', () => {
  it('应替换非法字符', () => {
    const result = sanitizeFileName('file<name>:test.jpg');
    expect(result).toBe('file_name__test.jpg');
  });

  it('应 trim 空白', () => {
    const result = sanitizeFileName('  filename.jpg  ');
    expect(result).toBe('filename.jpg');
  });

  it('unsafe 模式保留非法字符', () => {
    const result = sanitizeFileName('file:name.jpg', true);
    expect(result).toBe('file:name.jpg');
  });

  it('应替换问号和星号', () => {
    const result = sanitizeFileName('file?name*.jpg');
    expect(result).toBe('file_name_.jpg');
  });
});
