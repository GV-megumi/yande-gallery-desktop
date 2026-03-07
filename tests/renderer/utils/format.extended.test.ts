import { describe, it, expect } from 'vitest';
import { formatFileSize, formatDate, truncateText } from '../../../src/renderer/utils/format';

describe('formatFileSize - 扩展测试', () => {
  it('应处理负数', () => {
    // 负数输入不应崩溃
    const result = formatFileSize(-1);
    expect(typeof result).toBe('string');
  });

  it('应格式化精确的 KB', () => {
    expect(formatFileSize(2048)).toBe('2 KB');
  });

  it('应格式化精确的 MB', () => {
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5 MB');
  });

  it('应格式化小数 MB', () => {
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });

  it('应格式化 TB 级别（超出 sizes 数组范围）', () => {
    // 1 TB = 1024^4 bytes
    const result = formatFileSize(1024 * 1024 * 1024 * 1024);
    expect(typeof result).toBe('string');
  });

  it('应处理 1 字节', () => {
    expect(formatFileSize(1)).toBe('1 Bytes');
  });

  it('应处理接近 1KB 边界的值', () => {
    expect(formatFileSize(1023)).toBe('1023 Bytes');
  });
});

describe('formatDate', () => {
  it('应格式化 ISO 日期字符串', () => {
    const result = formatDate('2024-03-15T10:30:00Z');
    expect(typeof result).toBe('string');
    // 中文地区格式，应包含年月日
    expect(result).toMatch(/2024/);
  });

  it('应格式化简单日期字符串', () => {
    const result = formatDate('2024-01-01');
    expect(typeof result).toBe('string');
    expect(result).toMatch(/2024/);
  });

  it('应处理时间戳字符串', () => {
    const result = formatDate('2024-12-25T00:00:00.000Z');
    expect(typeof result).toBe('string');
    expect(result).toMatch(/2024/);
    expect(result).toMatch(/12/);
  });

  it('应处理无效日期', () => {
    // new Date('invalid') 会返回 Invalid Date
    const result = formatDate('not-a-date');
    expect(typeof result).toBe('string');
    // Invalid Date 的 toLocaleDateString 结果因地区而异
  });
});

describe('truncateText - 扩展测试', () => {
  it('应正确处理 maxLength 为 0', () => {
    expect(truncateText('hello', 0)).toBe('...');
  });

  it('应正确处理 maxLength 为 1', () => {
    expect(truncateText('hello', 1)).toBe('h...');
  });

  it('应正确处理中文文本', () => {
    expect(truncateText('你好世界测试', 3)).toBe('你好世...');
  });

  it('应正确处理 maxLength 大于文本长度', () => {
    expect(truncateText('hi', 100)).toBe('hi');
  });

  it('应处理 undefined-safe（输入合法时）', () => {
    expect(truncateText('', 0)).toBe('');
  });
});
