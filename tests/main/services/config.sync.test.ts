import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 骨架克隆 config.apiService.test.ts：mock fs/promises、js-yaml、dotenv，
// 每个用例 vi.resetModules() 后动态 import 全新的 config 模块，走 initPaths/loadConfig。
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn(),
  },
}));

vi.mock('js-yaml', () => ({
  load: vi.fn(),
  dump: vi.fn(() => 'mocked yaml'),
}));

const dotenvMocks = vi.hoisted(() => ({
  config: vi.fn(),
}));

vi.mock('dotenv', () => ({
  default: {
    config: dotenvMocks.config,
  },
  config: dotenvMocks.config,
}));

const mockedYaml = vi.mocked(await import('js-yaml'));

describe('sync 配置节（serverId / dataVersion）', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.CONFIG_DIR = 'M:/test-config-root';
    dotenvMocks.config.mockReturnValue({ parsed: {} });
  });

  afterEach(() => {
    delete process.env.CONFIG_DIR;
  });

  it('loadConfig 默认填充 sync 节 { serverId: "", dataVersion: 1 }', async () => {
    const config = await import('../../../src/main/services/config.js');

    mockedYaml.load.mockReturnValueOnce({});

    await config.initPaths();
    await config.loadConfig('M:/test-config-root/config.yaml');

    expect(config.getConfig().sync).toEqual({ serverId: '', dataVersion: 1 });
  });

  it('ensureSyncServerId 懒生成并持久化 UUID，二次调用返回同值', async () => {
    const config = await import('../../../src/main/services/config.js');

    mockedYaml.load.mockReturnValueOnce({});

    await config.initPaths();
    await config.loadConfig('M:/test-config-root/config.yaml');

    const first = await config.ensureSyncServerId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    // 已持久化进内存态
    expect(config.getConfig().sync.serverId).toBe(first);
    // 二次调用不再重新生成，返回同一值
    expect(await config.ensureSyncServerId()).toBe(first);
  });

  it('bumpSyncDataVersion 自增 dataVersion', async () => {
    const config = await import('../../../src/main/services/config.js');

    mockedYaml.load.mockReturnValueOnce({});

    await config.initPaths();
    await config.loadConfig('M:/test-config-root/config.yaml');

    const before = config.getConfig().sync.dataVersion;
    await config.bumpSyncDataVersion();
    expect(config.getConfig().sync.dataVersion).toBe(before + 1);
  });
});
