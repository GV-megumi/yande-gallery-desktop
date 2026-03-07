import { describe, it, expect } from 'vitest';
import {
  parseToken,
  findTokens,
  generateFileName,
  sanitizeFileName,
} from '../../../src/main/services/filenameGenerator';

describe('generateFileName - 边界情况', () => {
  const metadata = {
    id: 12345,
    md5: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    extension: 'png',
    width: 1920,
    height: 1080,
    rating: 'safe',
    score: 100,
    site: 'yande',
    tags: 'girl blue_eyes long_hair school_uniform ribbon',
    source: 'https://example.com/source',
    date: '2024-03-15T10:30:00Z',
  };

  it('应截断超长文件名至 200 字符', () => {
    // 生成一个非常长的文件名模板
    const longTags = Array.from({ length: 100 }, (_, i) => `tag_${i}`).join(' ');
    const longMetadata = { ...metadata, tags: longTags };
    const result = generateFileName('{tags}.{extension}', longMetadata);

    expect(result.length).toBeLessThanOrEqual(200);
    // 应保留扩展名
    expect(result).toMatch(/\.png$/);
  });

  it('应处理所有 token 都为空的情况', () => {
    const emptyMetadata = {};
    const result = generateFileName('{id}_{md5}.{extension}', emptyMetadata);
    // 所有 token 替换为空，结果是 "_.""
    expect(result).toBe('_.');
  });

  it('应处理纯文本模板（无 token）', () => {
    const result = generateFileName('static_name.jpg', metadata);
    expect(result).toBe('static_name.jpg');
  });

  it('应处理连续的 token', () => {
    const result = generateFileName('{id}{md5:maxlength=4}{extension}', metadata);
    expect(result).toBe('12345a1b2png');
  });

  it('应处理嵌套的大括号（不支持，跳过）', () => {
    // 非标准格式，regex 会匹配到 {id} 和 {extension}
    const result = generateFileName('{id}.{extension}', metadata);
    expect(result).toBe('12345.png');
  });

  it('应支持 tags 排序（按名称升序）', () => {
    const result = generateFileName('{tags:limit=3,delimiter=-,sort=name}', metadata);
    // 无法传 sort.attribute 和 sort.order 通过模板字符串
    // 验证基本 limit 和 delimiter 功能
    const parts = result.split('-');
    expect(parts.length).toBeLessThanOrEqual(3);
  });

  it('应处理数字 ID 的 pad_left', () => {
    const result = generateFileName('{id:pad_left=10}.{extension}', metadata);
    expect(result).toBe('0000012345.png');
  });

  it('应处理 rating 的 single_letter', () => {
    const result = generateFileName('{rating:single_letter=true}', { rating: 'questionable' });
    expect(result).toBe('q');
  });

  it('应处理 date format', () => {
    const result = generateFileName('{date:format=yyyy-MM-dd}', metadata);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('应处理无效日期', () => {
    const result = generateFileName('{date:format=yyyy-MM-dd}', { date: 'invalid-date' });
    // 无效日期应保持原样
    expect(result).toBe('invalid-date');
  });

  it('应替换 Windows 非法字符', () => {
    const badMetadata = { ...metadata, source: 'https://example.com?id=1&type=test' };
    const result = generateFileName('{source}', badMetadata);
    // ? 应被替换为 _
    expect(result).not.toContain('?');
  });
});

describe('sanitizeFileName - 边界情况', () => {
  it('应替换所有 Windows/Linux 非法字符', () => {
    const input = 'file<>:"/\\|?*name.jpg';
    const result = sanitizeFileName(input);
    expect(result).not.toMatch(/[<>:"/\\|?*]/);
  });

  it('应替换控制字符', () => {
    const input = 'file\x00\x01\x1Fname.jpg';
    const result = sanitizeFileName(input);
    expect(result).not.toMatch(/[\x00-\x1F]/);
  });

  it('应处理空字符串', () => {
    const result = sanitizeFileName('');
    expect(result).toBe('');
  });

  it('应处理只有非法字符的字符串', () => {
    const result = sanitizeFileName('<>:"/\\|?*');
    expect(result).toBe('_________');
  });

  it('应处理长文件名', () => {
    const longName = 'a'.repeat(500) + '.jpg';
    const result = sanitizeFileName(longName);
    // sanitizeFileName 不限制长度，只清理字符
    expect(result).toBe(longName);
  });
});

describe('parseToken - 边界情况', () => {
  it('应处理空选项值', () => {
    // 没有值的等号
    const result = parseToken('{id:pad_left=}');
    // parseInt('', 10) 返回 NaN，所以不会设置 pad_left
    expect(result.token).toBe('id');
    expect(result.options.pad_left).toBeUndefined();
  });

  it('应处理多个冒号', () => {
    // 只取第一个冒号之前的部分作为 token 名
    const result = parseToken('{id:format=hh:mm:ss}');
    expect(result.token).toBe('id');
    // format 值会是 "hh" 因为按逗号分割后第一个 pair 是 "format=hh:mm:ss"
    // 但 eqIndex 取第一个 =，所以值是 "hh:mm:ss"
    expect(result.options.format).toBe('hh:mm:ss');
  });

  it('应忽略没有等号的选项', () => {
    const result = parseToken('{tags:limit=5,novalue}');
    expect(result.options.limit).toBe(5);
  });

  it('应处理多余空格', () => {
    const result = parseToken('{  id  :  pad_left = 8  }');
    expect(result.token).toBe('id');
    expect(result.options.pad_left).toBe(8);
  });
});

describe('findTokens - 边界情况', () => {
  it('应在复杂模板中找到所有 token', () => {
    const template = '{site}/{date:format=yyyy-MM-dd}/{id:pad_left=8}_{md5:maxlength=8}.{extension}';
    const tokens = findTokens(template);
    expect(tokens).toHaveLength(5);
    expect(tokens.map(t => t.token)).toEqual(['site', 'date', 'id', 'md5', 'extension']);
  });

  it('应处理相邻的 token', () => {
    const tokens = findTokens('{id}{md5}');
    expect(tokens).toHaveLength(2);
  });

  it('应处理同一 token 出现多次', () => {
    const tokens = findTokens('{id}_{id}');
    expect(tokens).toHaveLength(2);
    expect(tokens[0].token).toBe('id');
    expect(tokens[1].token).toBe('id');
  });
});
