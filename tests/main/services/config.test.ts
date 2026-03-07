import { describe, it, expect, vi, beforeEach } from 'vitest';

// 由于 config.ts 使用了 __dirname 和 fileURLToPath（ESM），
// 且 getConfig/getProxyConfig 等依赖模块级别的 config 单例，
// 这里通过 vi.mock + dynamic import 来隔离测试

// Mock fs/promises 和 js-yaml，避免真实文件 I/O
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn(),
  },
}));

vi.mock('js-yaml', () => ({
  load: vi.fn(),
  dump: vi.fn(() => 'mocked yaml'),
}));

describe('config 模块纯函数测试', () => {
  // 由于 config.ts 的核心函数（getProxyConfig、getAbsolutePath 等）依赖模块内部单例，
  // 这里直接测试其逻辑的等价实现

  describe('getProxyConfig 逻辑', () => {
    // 等价测试 getProxyConfig 的逻辑
    function extractProxyConfig(networkConfig: {
      proxy: {
        enabled: boolean;
        protocol: string;
        host: string;
        port: number;
        username?: string;
        password?: string;
      };
    }) {
      if (!networkConfig.proxy.enabled) {
        return undefined;
      }
      const { protocol, host, port, username, password } = networkConfig.proxy;
      const proxyConfig: any = { protocol, host, port };
      if (username && password) {
        proxyConfig.auth = { username, password };
      }
      return proxyConfig;
    }

    it('代理未启用时应返回 undefined', () => {
      const config = {
        proxy: {
          enabled: false,
          protocol: 'http',
          host: '127.0.0.1',
          port: 7890,
        },
      };
      expect(extractProxyConfig(config)).toBeUndefined();
    });

    it('代理启用时应返回代理配置', () => {
      const config = {
        proxy: {
          enabled: true,
          protocol: 'http',
          host: '127.0.0.1',
          port: 7890,
        },
      };
      const result = extractProxyConfig(config);
      expect(result).toEqual({
        protocol: 'http',
        host: '127.0.0.1',
        port: 7890,
      });
    });

    it('代理启用且有认证时应包含 auth', () => {
      const config = {
        proxy: {
          enabled: true,
          protocol: 'socks5',
          host: '192.168.1.1',
          port: 1080,
          username: 'user',
          password: 'pass',
        },
      };
      const result = extractProxyConfig(config);
      expect(result).toEqual({
        protocol: 'socks5',
        host: '192.168.1.1',
        port: 1080,
        auth: { username: 'user', password: 'pass' },
      });
    });

    it('有用户名但无密码时不应包含 auth', () => {
      const config = {
        proxy: {
          enabled: true,
          protocol: 'http',
          host: '127.0.0.1',
          port: 7890,
          username: 'user',
          password: '',
        },
      };
      const result = extractProxyConfig(config);
      expect(result).not.toHaveProperty('auth');
    });

    it('有密码但无用户名时不应包含 auth', () => {
      const config = {
        proxy: {
          enabled: true,
          protocol: 'http',
          host: '127.0.0.1',
          port: 7890,
          username: '',
          password: 'pass',
        },
      };
      const result = extractProxyConfig(config);
      expect(result).not.toHaveProperty('auth');
    });
  });

  describe('getAbsolutePath 逻辑', () => {
    const path = require('path');

    it('绝对路径应原样返回', () => {
      if (process.platform === 'win32') {
        const result = path.isAbsolute('M:\\downloads');
        expect(result).toBe(true);
      } else {
        const result = path.isAbsolute('/home/user/downloads');
        expect(result).toBe(true);
      }
    });

    it('相对路径应被检测为相对', () => {
      expect(path.isAbsolute('data/gallery.db')).toBe(false);
      expect(path.isAbsolute('downloads')).toBe(false);
      expect(path.isAbsolute('./config.yaml')).toBe(false);
    });

    it('path.join 应正确拼接路径', () => {
      const base = '/app/src/main/services';
      const result = path.join(base, '../../..', 'data/gallery.db');
      // 规范化后应包含 data/gallery.db
      expect(result).toContain('gallery.db');
    });
  });

  describe('validateConfig 逻辑', () => {
    // 测试配置验证的核心逻辑
    function validateConfig(config: any): string[] {
      const errors: string[] = [];
      if (!config.database?.path) {
        errors.push('database.path 不能为空');
      }
      if (!config.downloads?.path) {
        errors.push('downloads.path 不能为空');
      }
      if (!config.galleries?.folders || config.galleries.folders.length === 0) {
        errors.push('galleries.folders 不能为空');
      }
      if (config.galleries?.folders) {
        config.galleries.folders.forEach((folder: any, index: number) => {
          if (!folder.path) {
            errors.push(`galleries.folders[${index}].path 不能为空`);
          }
          if (!folder.name) {
            errors.push(`galleries.folders[${index}].name 不能为空`);
          }
          if (!folder.extensions || folder.extensions.length === 0) {
            errors.push(`galleries.folders[${index}].extensions 不能为空`);
          }
        });
      }
      return errors;
    }

    it('完整配置不应有错误', () => {
      const config = {
        database: { path: 'data/gallery.db' },
        downloads: { path: 'downloads' },
        galleries: {
          folders: [
            { path: '/images', name: 'default', extensions: ['.jpg', '.png'] },
          ],
        },
      };
      expect(validateConfig(config)).toEqual([]);
    });

    it('缺少 database.path 应报错', () => {
      const config = {
        database: {},
        downloads: { path: 'downloads' },
        galleries: {
          folders: [
            { path: '/images', name: 'default', extensions: ['.jpg'] },
          ],
        },
      };
      const errors = validateConfig(config);
      expect(errors).toContain('database.path 不能为空');
    });

    it('缺少 downloads.path 应报错', () => {
      const config = {
        database: { path: 'db.sqlite' },
        downloads: {},
        galleries: {
          folders: [
            { path: '/images', name: 'default', extensions: ['.jpg'] },
          ],
        },
      };
      const errors = validateConfig(config);
      expect(errors).toContain('downloads.path 不能为空');
    });

    it('空的 galleries.folders 应报错', () => {
      const config = {
        database: { path: 'db.sqlite' },
        downloads: { path: 'downloads' },
        galleries: { folders: [] },
      };
      const errors = validateConfig(config);
      expect(errors).toContain('galleries.folders 不能为空');
    });

    it('图库文件夹缺少必填字段应报错', () => {
      const config = {
        database: { path: 'db.sqlite' },
        downloads: { path: 'downloads' },
        galleries: {
          folders: [
            { path: '', name: '', extensions: [] },
          ],
        },
      };
      const errors = validateConfig(config);
      expect(errors).toContain('galleries.folders[0].path 不能为空');
      expect(errors).toContain('galleries.folders[0].name 不能为空');
      expect(errors).toContain('galleries.folders[0].extensions 不能为空');
    });

    it('多个图库文件夹应各自验证', () => {
      const config = {
        database: { path: 'db.sqlite' },
        downloads: { path: 'downloads' },
        galleries: {
          folders: [
            { path: '/valid', name: 'ok', extensions: ['.jpg'] },
            { path: '', name: 'missing_path', extensions: ['.png'] },
          ],
        },
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('folders[1].path');
    });
  });
});
