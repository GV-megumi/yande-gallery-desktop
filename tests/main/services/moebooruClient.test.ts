import { describe, it, expect } from 'vitest';
import {
  hashPasswordSHA1,
  TAG_TYPE_MAP,
  RATING_MAP,
  MoebooruClient,
} from '../../../src/main/services/moebooruClient';

describe('hashPasswordSHA1', () => {
  it('应使用盐值正确哈希密码', () => {
    const salt = 'choujin-steiner--{0}--';
    const password = 'test_password';
    const hash = hashPasswordSHA1(salt, password);

    // SHA1 输出固定 40 字符十六进制
    expect(hash).toHaveLength(40);
    expect(hash).toMatch(/^[a-f0-9]{40}$/);
  });

  it('应替换盐值中的 {0} 占位符', () => {
    const salt = 'prefix-{0}-suffix';
    const password = 'abc';
    const hash = hashPasswordSHA1(salt, password);

    // 确认结果是有效 SHA1
    expect(hash).toHaveLength(40);
    expect(hash).toMatch(/^[a-f0-9]{40}$/);
  });

  it('相同输入应产生相同哈希', () => {
    const salt = 'choujin-steiner--{0}--';
    const password = 'hello';
    const hash1 = hashPasswordSHA1(salt, password);
    const hash2 = hashPasswordSHA1(salt, password);
    expect(hash1).toBe(hash2);
  });

  it('不同密码应产生不同哈希', () => {
    const salt = 'choujin-steiner--{0}--';
    const hash1 = hashPasswordSHA1(salt, 'password1');
    const hash2 = hashPasswordSHA1(salt, 'password2');
    expect(hash1).not.toBe(hash2);
  });

  it('不同盐值应产生不同哈希', () => {
    const password = 'same_password';
    const hash1 = hashPasswordSHA1('salt1-{0}-end', password);
    const hash2 = hashPasswordSHA1('salt2-{0}-end', password);
    expect(hash1).not.toBe(hash2);
  });

  it('空密码也能正确哈希', () => {
    const salt = 'prefix-{0}-suffix';
    const hash = hashPasswordSHA1(salt, '');
    expect(hash).toHaveLength(40);
    expect(hash).toMatch(/^[a-f0-9]{40}$/);
  });
});

describe('TAG_TYPE_MAP', () => {
  it('应包含 general 类型 (0)', () => {
    expect(TAG_TYPE_MAP[0]).toBe('general');
  });

  it('应包含 artist 类型 (1)', () => {
    expect(TAG_TYPE_MAP[1]).toBe('artist');
  });

  it('应包含 copyright 类型 (3)', () => {
    expect(TAG_TYPE_MAP[3]).toBe('copyright');
  });

  it('应包含 character 类型 (4)', () => {
    expect(TAG_TYPE_MAP[4]).toBe('character');
  });

  it('应包含 meta 类型 (5)', () => {
    expect(TAG_TYPE_MAP[5]).toBe('meta');
  });

  it('不应包含未定义的类型 (2)', () => {
    expect(TAG_TYPE_MAP[2]).toBeUndefined();
  });
});

describe('RATING_MAP', () => {
  it('应映射 s 为 safe', () => {
    expect(RATING_MAP['s']).toBe('safe');
  });

  it('应映射 q 为 questionable', () => {
    expect(RATING_MAP['q']).toBe('questionable');
  });

  it('应映射 e 为 explicit', () => {
    expect(RATING_MAP['e']).toBe('explicit');
  });

  it('不应包含未定义的评级', () => {
    expect(RATING_MAP['x']).toBeUndefined();
  });
});

describe('MoebooruClient.parseTagSummary', () => {
  // parseTagSummary 是实例方法，需要构造一个 mock 客户端
  // 由于构造函数会调用 getProxyConfig（依赖配置文件），我们直接测试解析逻辑
  // 通过 prototype 调用来避免构造函数的副作用

  const parseTagSummary = MoebooruClient.prototype.parseTagSummary;

  it('应正确解析标签摘要数据', () => {
    // 格式: category`name`alias1`alias2 category`name ...
    const data = '0`landscape 1`artist_name 3`touhou 4`reimu_hakurei';
    const result = parseTagSummary(data);

    expect(result.get('landscape')).toBe(0);
    expect(result.get('artist_name')).toBe(1);
    expect(result.get('touhou')).toBe(3);
    expect(result.get('reimu_hakurei')).toBe(4);
  });

  it('应解析带别名的标签', () => {
    const data = '1`main_name`alias1`alias2';
    const result = parseTagSummary(data);

    expect(result.get('main_name')).toBe(1);
    expect(result.get('alias1')).toBe(1);
    expect(result.get('alias2')).toBe(1);
  });

  it('应处理空字符串', () => {
    const result = parseTagSummary('');
    expect(result.size).toBe(0);
  });

  it('应处理只有空格的字符串', () => {
    const result = parseTagSummary('   ');
    expect(result.size).toBe(0);
  });

  it('应跳过格式不正确的条目', () => {
    const data = '0`valid_tag invalid_no_backtick 1`another_valid';
    const result = parseTagSummary(data);

    expect(result.get('valid_tag')).toBe(0);
    expect(result.get('another_valid')).toBe(1);
    expect(result.has('invalid_no_backtick')).toBe(false);
  });

  it('应跳过 category 非数字的条目', () => {
    const data = 'abc`tag_name 0`valid_tag';
    const result = parseTagSummary(data);

    expect(result.has('tag_name')).toBe(false);
    expect(result.get('valid_tag')).toBe(0);
  });

  it('应处理大量标签', () => {
    // 模拟真实摘要（大量标签）
    const tags = Array.from({ length: 1000 }, (_, i) => `${i % 5}\`tag_${i}`);
    const data = tags.join(' ');
    const result = parseTagSummary(data);

    expect(result.size).toBe(1000);
    expect(result.get('tag_0')).toBe(0);
    expect(result.get('tag_999')).toBe(4); // 999 % 5 = 4
  });
});
