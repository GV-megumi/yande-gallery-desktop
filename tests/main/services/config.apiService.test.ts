import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ConfigSaveInput } from '../../../src/main/services/config.js';

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

const defaultApiServiceConfig = {
  enabled: false,
  mode: 'localhost',
  port: 38947,
  apiKey: '',
  app: {
    enabled: false,
  },
  permissions: {
    galleryRead: true,
    imageRead: true,
    imageBinary: false,
    booruRead: true,
    booruWrite: false,
    favoriteTagsRead: true,
    favoriteTagsWrite: false,
    downloadsRead: true,
    downloadsControl: false,
    eventsSubscribe: false,
    apiLogsRead: false,
  },
  logs: {
    enabled: false,
    visibleInUi: false,
    retentionDays: 14,
    maxEntries: 1000,
  },
};

describe('apiService config defaults', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.CONFIG_DIR = 'M:/test-config-root';
    dotenvMocks.config.mockReturnValue({ parsed: {} });
  });

  afterEach(() => {
    delete process.env.CONFIG_DIR;
  });

  it('loadConfig fills conservative apiService defaults into getConfig and redacted renderer-safe config', async () => {
    const configModule = await import('../../../src/main/services/config.js');

    mockedYaml.load.mockReturnValueOnce({});

    await configModule.initPaths();
    await configModule.loadConfig('M:/test-config-root/config.yaml');

    expect(configModule.getConfig().apiService).toEqual(defaultApiServiceConfig);
    const { apiKey: _apiKey, ...safeDefaults } = defaultApiServiceConfig;
    expect(configModule.toRendererSafeConfig(configModule.getConfig()).apiService).toEqual({
      ...safeDefaults,
      hasApiKey: false,
    });
  });

  it('redacts apiService.apiKey from renderer-safe config while preserving save input patch support', async () => {
    const configModule = await import('../../../src/main/services/config.js');

    mockedYaml.load.mockReturnValueOnce({
      apiService: {
        enabled: true,
        apiKey: 'real-secret-key',
        permissions: { imageBinary: true },
      },
    });

    await configModule.initPaths();
    await configModule.loadConfig('M:/test-config-root/config.yaml');

    const safeConfig = configModule.toRendererSafeConfig(configModule.getConfig());

    expect(safeConfig.apiService).toEqual(expect.objectContaining({
      enabled: true,
      hasApiKey: true,
      permissions: expect.objectContaining({ imageBinary: true }),
    }));
    expect(safeConfig.apiService).not.toHaveProperty('apiKey');

    const patch = {
      apiService: {
        enabled: false,
        logs: { enabled: true },
      },
    } satisfies ConfigSaveInput;
    await expect(configModule.saveConfig(patch, 'M:/test-config-root/config.yaml')).resolves.toEqual({ success: true });
    expect(configModule.getConfig().apiService).toEqual(expect.objectContaining({
      enabled: false,
      apiKey: 'real-secret-key',
      logs: expect.objectContaining({ enabled: true }),
    }));
  });

  it('saveConfig deep-merges apiService permissions and logs with current config and defaults', async () => {
    const configModule = await import('../../../src/main/services/config.js');

    mockedYaml.load.mockReturnValueOnce({
      apiService: {
        enabled: true,
        mode: 'lan',
        port: 38948,
        apiKey: 'existing-key',
        permissions: {
          booruWrite: true,
        },
        logs: {
          maxEntries: 55,
        },
      },
    });

    await configModule.initPaths();
    await configModule.loadConfig('M:/test-config-root/config.yaml');

    const patch = {
      apiService: {
        permissions: {
          imageBinary: true,
        },
        logs: {
          enabled: true,
        },
      },
    } satisfies ConfigSaveInput;

    const result = await configModule.saveConfig(patch, 'M:/test-config-root/config.yaml');

    expect(result).toEqual({ success: true });
    expect(configModule.getConfig().apiService).toEqual({
      ...defaultApiServiceConfig,
      enabled: true,
      mode: 'lan',
      port: 38948,
      apiKey: 'existing-key',
      permissions: {
        ...defaultApiServiceConfig.permissions,
        imageBinary: true,
        booruWrite: true,
      },
      logs: {
        ...defaultApiServiceConfig.logs,
        enabled: true,
        maxEntries: 55,
      },
    });
  });

  it('getApiServiceConfig normalizes malformed legacy apiService scalar values conservatively', async () => {
    const configModule = await import('../../../src/main/services/config.js');

    mockedYaml.load.mockReturnValueOnce({
      apiService: {
        enabled: 'yes',
        mode: 'public',
        port: 70000,
        apiKey: 123,
        permissions: {
          galleryRead: 'true',
          booruWrite: true,
          downloadsControl: 1,
        },
        logs: {
          enabled: 'true',
          visibleInUi: true,
          retentionDays: 0,
          maxEntries: 'many',
        },
      },
    });

    await configModule.initPaths();
    await configModule.loadConfig('M:/test-config-root/config.yaml');

    const expected = {
      ...defaultApiServiceConfig,
      apiKey: '',
      permissions: {
        ...defaultApiServiceConfig.permissions,
        booruWrite: true,
      },
      logs: {
        ...defaultApiServiceConfig.logs,
        visibleInUi: true,
      },
    };

    expect(configModule.getConfig().apiService).toEqual(expected);
    expect(configModule.getApiServiceConfig()).toEqual(expected);
  });

  it('迁移：旧配置 enabled+lan+写权限齐备时推导 app.enabled=true，且输出剔除旧键（spec §5）', async () => {
    const configModule = await import('../../../src/main/services/config.js');

    mockedYaml.load.mockReturnValueOnce({
      apiService: {
        enabled: true,
        mode: 'lan',
        permissions: { imageWrite: true, galleryRead: true },
      },
    });

    await configModule.initPaths();
    await configModule.loadConfig('M:/test-config-root/config.yaml');

    const apiService = configModule.getConfig().apiService!;
    expect(apiService.app).toEqual({ enabled: true });
    expect(apiService.permissions).not.toHaveProperty('imageWrite');
    expect(apiService.permissions).not.toHaveProperty('galleryWrite');
  });

  it('迁移：旧配置仅 galleryWrite 开启（无 imageWrite、无 app 块）时同样推导 app.enabled=true（钉住 || 两侧对称性，spec §5）', async () => {
    const configModule = await import('../../../src/main/services/config.js');

    mockedYaml.load.mockReturnValueOnce({
      apiService: {
        enabled: true,
        mode: 'lan',
        permissions: { galleryWrite: true },
      },
    });

    await configModule.initPaths();
    await configModule.loadConfig('M:/test-config-root/config.yaml');

    const apiService = configModule.getConfig().apiService!;
    expect(apiService.app).toEqual({ enabled: true });
    expect(apiService.permissions).not.toHaveProperty('imageWrite');
    expect(apiService.permissions).not.toHaveProperty('galleryWrite');
  });

  it('迁移：旧配置服务关闭（enabled=false）时写权限不推导 app.enabled——不得把用户关掉的服务静默拉起', async () => {
    const configModule = await import('../../../src/main/services/config.js');

    mockedYaml.load.mockReturnValueOnce({
      apiService: {
        enabled: false,
        mode: 'lan',
        permissions: { imageWrite: true, galleryWrite: true },
      },
    });

    await configModule.initPaths();
    await configModule.loadConfig('M:/test-config-root/config.yaml');

    expect(configModule.getConfig().apiService!.app).toEqual({ enabled: false });
  });

  it('迁移：旧配置仅本机监听（mode=localhost）时写权限不推导 app.enabled——手机本就连不上，不得强制局域网绑定', async () => {
    const configModule = await import('../../../src/main/services/config.js');

    mockedYaml.load.mockReturnValueOnce({
      apiService: {
        enabled: true,
        mode: 'localhost',
        permissions: { imageWrite: true, galleryWrite: true },
      },
    });

    await configModule.initPaths();
    await configModule.loadConfig('M:/test-config-root/config.yaml');

    expect(configModule.getConfig().apiService!.app).toEqual({ enabled: false });
  });

  it('迁移：旧配置未开写权限时 app.enabled 默认 false', async () => {
    const configModule = await import('../../../src/main/services/config.js');

    mockedYaml.load.mockReturnValueOnce({
      apiService: {
        enabled: true,
        mode: 'lan',
        permissions: { galleryRead: true, imageWrite: false },
      },
    });

    await configModule.initPaths();
    await configModule.loadConfig('M:/test-config-root/config.yaml');

    expect(configModule.getConfig().apiService!.app).toEqual({ enabled: false });
  });

  it('迁移：显式 app.enabled=false 不被旧写权限信号覆盖', async () => {
    const configModule = await import('../../../src/main/services/config.js');

    mockedYaml.load.mockReturnValueOnce({
      apiService: {
        enabled: true,
        mode: 'lan',
        app: { enabled: false },
        permissions: { imageWrite: true, galleryWrite: true },
      },
    });

    await configModule.initPaths();
    await configModule.loadConfig('M:/test-config-root/config.yaml');

    expect(configModule.getConfig().apiService!.app).toEqual({ enabled: false });
  });
});
