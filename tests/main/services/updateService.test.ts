import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkForUpdate, __resetCacheForTest, compareSemver } from '../../../src/main/services/updateService';

// mock app.getVersion
vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.1' },
}));

describe('compareSemver', () => {
  it('数字段比较', () => {
    expect(compareSemver('0.0.2', '0.0.1')).toBeGreaterThan(0);
    expect(compareSemver('0.1.0', '0.0.9')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareSemver('0.0.1', '0.0.1')).toBe(0);
    expect(compareSemver('0.0.1', '0.0.2')).toBeLessThan(0);
  });

  it('去掉 v 前缀', () => {
    expect(compareSemver('v0.0.2', '0.0.1')).toBeGreaterThan(0);
  });

  it('补齐位数', () => {
    expect(compareSemver('1.0', '1.0.0')).toBe(0);
  });
});

describe('checkForUpdate', () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch as any;
    mockFetch.mockReset();
    __resetCacheForTest();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('发现新版本', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v0.0.2',
        name: 'Release 0.0.2',
        html_url: 'https://github.com/GV-megumi/yande-gallery-desktop/releases/tag/v0.0.2',
        published_at: '2026-04-11T12:00:00Z',
      }),
    });
    const result = await checkForUpdate();
    expect(result.currentVersion).toBe('0.0.1');
    expect(result.latestVersion).toBe('0.0.2');
    expect(result.hasUpdate).toBe(true);
    expect(result.releaseUrl).toContain('releases/tag/v0.0.2');
    expect(result.error).toBeNull();
  });

  it('已是最新', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v0.0.1',
        name: 'Release 0.0.1',
        html_url: 'https://github.com/GV-megumi/yande-gallery-desktop/releases/tag/v0.0.1',
        published_at: '2026-04-01T12:00:00Z',
      }),
    });
    const result = await checkForUpdate();
    expect(result.hasUpdate).toBe(false);
    expect(result.latestVersion).toBe('0.0.1');
  });

  it('404 网络错误', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ message: 'Not Found' }),
    });
    const result = await checkForUpdate();
    expect(result.hasUpdate).toBe(false);
    expect(result.latestVersion).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('fetch 抛出异常', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ENETUNREACH'));
    const result = await checkForUpdate();
    expect(result.error).toContain('ENETUNREACH');
    expect(result.hasUpdate).toBe(false);
  });

  it('请求超时返回友好提示', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    mockFetch.mockRejectedValueOnce(abortError);
    const result = await checkForUpdate();
    expect(result.error).toBe('请求超时');
    expect(result.hasUpdate).toBe(false);
    expect(result.currentVersion).toBe('0.0.1');
    expect(result.checkedAt).toBeTruthy();
  });

  it('错误不缓存，下次重试会真的 fetch', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v0.0.2',
        name: 'Release 0.0.2',
        html_url: 'https://example.com',
        published_at: '2026-04-11T12:00:00Z',
      }),
    });

    const first = await checkForUpdate();
    expect(first.error).toBeTruthy();

    const second = await checkForUpdate();
    expect(second.error).toBeNull();
    expect(second.latestVersion).toBe('0.0.2');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('60 秒缓存：第二次不实际调 fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v0.0.2',
        name: 'Release 0.0.2',
        html_url: 'https://example.com',
        published_at: '2026-04-11T12:00:00Z',
      }),
    });
    await checkForUpdate();
    await checkForUpdate();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
