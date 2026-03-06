import { describe, it, expect } from 'vitest';
import { formatFileSize, truncateText } from '../../../src/renderer/utils/format';

describe('formatFileSize', () => {
  it('应格式化 0 字节', () => {
    expect(formatFileSize(0)).toBe('0 Bytes');
  });

  it('应格式化字节', () => {
    expect(formatFileSize(500)).toBe('500 Bytes');
  });

  it('应格式化 KB', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('应格式化 MB', () => {
    expect(formatFileSize(1048576)).toBe('1 MB');
    expect(formatFileSize(1572864)).toBe('1.5 MB');
  });

  it('应格式化 GB', () => {
    expect(formatFileSize(1073741824)).toBe('1 GB');
  });
});

describe('truncateText', () => {
  it('短文本不截断', () => {
    expect(truncateText('hello', 10)).toBe('hello');
  });

  it('等长文本不截断', () => {
    expect(truncateText('hello', 5)).toBe('hello');
  });

  it('超长文本截断并加省略号', () => {
    expect(truncateText('hello world', 5)).toBe('hello...');
  });

  it('空字符串返回空', () => {
    expect(truncateText('', 10)).toBe('');
  });
});
