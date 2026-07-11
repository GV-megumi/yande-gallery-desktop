import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  emitBuiltRendererAppEvent: vi.fn(),
}));

vi.mock('../../../src/main/services/rendererEventBus.js', () => ({
  emitBuiltRendererAppEvent: state.emitBuiltRendererAppEvent,
}));

/**
 * thumbnail:generated 事件的 error 收窄契约：该事件经 API 事件桥落 system 频道、
 * 手机面可订阅，而 fs/sharp 原始错误串常含本地绝对路径（sanitizeApiEventPayload
 * 只按键名剥离、不处理字符串值）——事件里的 error 必须只发类别文案，不发原文。
 * 调用方返回值不受影响（主进程内诊断仍拿原文）。
 */
describe('thumbnailService - thumbnail:generated 事件 error 收窄', () => {
  let tmpDir: string;

  beforeEach(() => {
    state.emitBuiltRendererAppEvent.mockReset();
  });

  afterAll(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('原图缺失：事件 error 为「原图不存在」类别，不含原始路径', async () => {
    const { generateThumbnail } = await import('../../../src/main/services/thumbnailService.js');

    const secretPath = path.join(os.tmpdir(), 'secret-folder-not-exist', 'img.jpg');
    // force=true 直走内部实现并同步 emit；fs.access 先行失败，不触及 config
    const result = await generateThumbnail(secretPath, true);

    expect(result.success).toBe(false);
    expect(result.missing).toBe(true);
    // 调用方返回值保留原文，事件载荷必须收窄
    expect(result.error).toContain(secretPath);

    expect(state.emitBuiltRendererAppEvent).toHaveBeenCalledTimes(1);
    const event = state.emitBuiltRendererAppEvent.mock.calls[0][0];
    expect(event.type).toBe('thumbnail:generated');
    expect(event.payload).toMatchObject({
      success: false,
      missing: true,
      error: '原图不存在',
    });
    expect(event.payload.thumbnailPath).toBeUndefined();
  });

  it('生成异常：事件 error 为「生成失败」类别，不透传底层异常原文', async () => {
    const { generateThumbnail } = await import('../../../src/main/services/thumbnailService.js');

    // 真实临时文件通过 fs.access 预检，随后在 getConfig()（本测试未初始化配置）抛错，
    // 走通用异常分支——底层异常原文（含「loadConfig」提示）不得进事件
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'thumb-events-'));
    const realFile = path.join(tmpDir, 'real.jpg');
    await writeFile(realFile, 'stub');

    const result = await generateThumbnail(realFile, true);

    expect(result.success).toBe(false);
    expect(result.error).toContain('配置尚未加载');

    expect(state.emitBuiltRendererAppEvent).toHaveBeenCalledTimes(1);
    const event = state.emitBuiltRendererAppEvent.mock.calls[0][0];
    expect(event.payload.success).toBe(false);
    expect(event.payload.error).toBe('生成失败');
    expect(String(event.payload.error)).not.toContain('配置尚未加载');
  });
});
