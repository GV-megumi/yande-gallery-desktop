import { describe, expect, it } from 'vitest';
import {
  fingerprintApiKey,
  generateApiKey,
  isAllowedApiSourceIp,
  isAuthorizedBearer,
  isLoopbackAddress,
  parseBearerToken,
} from '../../../src/main/api/security.js';

describe('api security helpers', () => {
  it.each([
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    '192.168.0.1',
    '192.168.255.255',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
  ])('allows localhost and private source IP %s', (sourceIp) => {
    expect(isAllowedApiSourceIp(sourceIp)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '172.32.0.1',
    '100.64.0.1',
  ])('rejects public or non-private source IP %s', (sourceIp) => {
    expect(isAllowedApiSourceIp(sourceIp)).toBe(false);
  });

  // agent 面 mode=localhost 请求级兜底（app.enabled 强制 0.0.0.0 绑定后的「仅本机」承诺载体）
  it.each([
    '127.0.0.1',
    '127.8.8.8',
    '::1',
    '::ffff:127.0.0.1',
  ])('treats %s as loopback', (sourceIp) => {
    expect(isLoopbackAddress(sourceIp)).toBe(true);
  });

  it.each([
    '192.168.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '8.8.8.8',
    '',
    undefined,
  ])('does not treat %s as loopback', (sourceIp) => {
    expect(isLoopbackAddress(sourceIp)).toBe(false);
  });

  it('parses only exact Bearer authorization headers', () => {
    expect(parseBearerToken('Bearer abc')).toBe('abc');
    expect(parseBearerToken('Bearer ')).toBeNull();
    expect(parseBearerToken('Bearer  abc')).toBeNull();
    expect(parseBearerToken('Bearer abc ')).toBeNull();
    expect(parseBearerToken('bearer abc')).toBeNull();
    expect(parseBearerToken('Basic abc')).toBeNull();
    expect(parseBearerToken(['Bearer abc'])).toBeNull();
  });

  it('authorizes complete Bearer headers by exact token equality and requires a configured key', () => {
    expect(isAuthorizedBearer('Bearer abc', 'abc')).toBe(true);
    expect(isAuthorizedBearer('Bearer abc', 'ABC')).toBe(false);
    expect(isAuthorizedBearer('bearer abc', 'abc')).toBe(false);
    expect(isAuthorizedBearer('abc', 'abc')).toBe(false);
    expect(isAuthorizedBearer('Bearer abc', '')).toBe(false);
  });

  it('generates a non-empty random API key with sufficient length', () => {
    const firstKey = generateApiKey();
    const secondKey = generateApiKey();

    expect(firstKey.length).toBeGreaterThanOrEqual(32);
    expect(secondKey.length).toBeGreaterThanOrEqual(32);
    expect(firstKey).not.toBe(secondKey);
  });

  it('fingerprints API keys without exposing the original value', () => {
    expect(fingerprintApiKey('')).toBe('api_empty');
    expect(fingerprintApiKey('secret-key')).toMatch(/^api_[0-9a-f]{12}$/);
  });
});
