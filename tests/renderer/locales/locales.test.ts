import { describe, it, expect } from 'vitest';
import zhCN from '../../../src/renderer/locales/zh-CN';
import enUS from '../../../src/renderer/locales/en-US';
import type { LocaleMessages } from '../../../src/renderer/locales/zh-CN';

/**
 * 多语言系统测试
 * 1. 语言包结构完整性（en-US 必须与 zh-CN key 完全对齐）
 * 2. t() 函数等价逻辑（路径查找 + 参数替换）
 * 3. 语言包值非空
 */

// ========= 辅助函数 =========

/** 递归收集所有 key 路径（如 "common.confirm"） */
function collectKeyPaths(obj: Record<string, any>, prefix = ''): string[] {
  const paths: string[] = [];
  for (const key of Object.keys(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      paths.push(...collectKeyPaths(obj[key], fullPath));
    } else {
      paths.push(fullPath);
    }
  }
  return paths;
}

/** t() 函数等价实现：从语言包中按路径取值，并替换 {param} 占位符 */
function t(messages: LocaleMessages, path: string, params?: Record<string, string | number>): string {
  const keys = path.split('.');
  let result: any = messages;
  for (const key of keys) {
    if (result && typeof result === 'object' && key in result) {
      result = result[key];
    } else {
      return path; // key 不存在，返回原路径
    }
  }
  if (typeof result !== 'string') {
    return path;
  }
  if (params) {
    return result.replace(/\{(\w+)\}/g, (_, key) => {
      return key in params ? String(params[key]) : `{${key}}`;
    });
  }
  return result;
}

// ========= 语言包结构完整性 =========

describe('语言包结构完整性', () => {
  const zhKeys = collectKeyPaths(zhCN);
  const enKeys = collectKeyPaths(enUS);

  it('zh-CN 应有大量翻译 key', () => {
    expect(zhKeys.length).toBeGreaterThan(100);
  });

  it('en-US 应有与 zh-CN 相同数量的 key', () => {
    expect(enKeys.length).toBe(zhKeys.length);
  });

  it('en-US 不应缺少 zh-CN 中的任何 key', () => {
    const missingInEn = zhKeys.filter(k => !enKeys.includes(k));
    expect(missingInEn).toEqual([]);
  });

  it('zh-CN 不应缺少 en-US 中的任何 key', () => {
    const missingInZh = enKeys.filter(k => !zhKeys.includes(k));
    expect(missingInZh).toEqual([]);
  });

  it('所有顶级 section 应在两种语言包中都存在', () => {
    const zhSections = Object.keys(zhCN);
    const enSections = Object.keys(enUS);
    expect(enSections.sort()).toEqual(zhSections.sort());
  });
});

// ========= 语言包值非空 =========

describe('语言包值非空', () => {
  const zhKeys = collectKeyPaths(zhCN);

  it('zh-CN 所有叶子值应为非空字符串', () => {
    for (const keyPath of zhKeys) {
      const value = t(zhCN, keyPath);
      expect(value).not.toBe('');
      expect(value).not.toBe(keyPath); // 如果返回 keyPath 说明取值失败
    }
  });

  it('en-US 所有叶子值应为非空字符串', () => {
    const enKeys = collectKeyPaths(enUS);
    for (const keyPath of enKeys) {
      const value = t(enUS, keyPath);
      expect(value).not.toBe('');
      expect(value).not.toBe(keyPath);
    }
  });
});

// ========= t() 函数逻辑 =========

describe('t() 路径查找', () => {
  it('应正确取到一级 key', () => {
    expect(t(zhCN, 'common.confirm')).toBe('确定');
    expect(t(enUS, 'common.confirm')).toBe('OK');
  });

  it('应正确取到二级 key', () => {
    expect(t(zhCN, 'download.status.pending')).toBe('等待中');
    expect(t(enUS, 'download.status.pending')).toBe('Pending');
  });

  it('不存在的 key 应返回原路径', () => {
    expect(t(zhCN, 'nonexistent.key')).toBe('nonexistent.key');
  });

  it('部分存在的路径应返回原路径', () => {
    expect(t(zhCN, 'common.notExist')).toBe('common.notExist');
  });

  it('空路径应返回空路径', () => {
    // 空字符串 split('.') 后是 ['']，查找 '' key 不存在
    expect(t(zhCN, '')).toBe('');
  });

  it('取到对象（非叶子）应返回原路径', () => {
    // 'common' 指向一个对象，不是字符串
    expect(t(zhCN, 'common')).toBe('common');
  });
});

describe('t() 参数替换', () => {
  it('应替换单个参数', () => {
    // gallery.totalImages = '共 {count} 张图片'
    const result = t(zhCN, 'gallery.totalImages', { count: 42 });
    expect(result).toBe('共 42 张图片');
  });

  it('应替换多个参数', () => {
    // settings.scanComplete = '扫描完成：创建图集 {created} 个，跳过 {skipped} 个，导入图片 {imported} 张'
    const result = t(zhCN, 'settings.scanComplete', { created: 5, skipped: 2, imported: 100 });
    expect(result).toContain('5');
    expect(result).toContain('2');
    expect(result).toContain('100');
  });

  it('缺少的参数应保留占位符', () => {
    const result = t(zhCN, 'gallery.totalImages', {});
    expect(result).toBe('共 {count} 张图片');
  });

  it('无参数模板不应被影响', () => {
    const result = t(zhCN, 'common.confirm', { extra: 'ignored' });
    expect(result).toBe('确定');
  });

  it('en-US 参数替换也应工作', () => {
    // booru.page = 'Page {page}'
    const result = t(enUS, 'booru.page', { page: 3 });
    expect(result).toBe('Page 3');
  });

  it('数字参数应正确转为字符串', () => {
    const result = t(zhCN, 'booru.totalPosts', { count: 0 });
    expect(result).toContain('0');
  });
});

// ========= 关键翻译内容 =========

describe('关键翻译内容', () => {
  it('app.title 两种语言应一致', () => {
    expect(zhCN.app.title).toBe('Yande Gallery');
    expect(enUS.app.title).toBe('Yande Gallery');
  });

  it('下载状态应有 5 种', () => {
    const zhStatuses = Object.keys(zhCN.download.status);
    const enStatuses = Object.keys(enUS.download.status);
    expect(zhStatuses).toHaveLength(5);
    expect(enStatuses).toHaveLength(5);
    expect(zhStatuses.sort()).toEqual(enStatuses.sort());
  });

  it('评分翻译应完整', () => {
    expect(zhCN.booru.safe).toBeTruthy();
    expect(zhCN.booru.questionable).toBeTruthy();
    expect(zhCN.booru.explicit).toBeTruthy();
    expect(enUS.booru.safe).toBeTruthy();
    expect(enUS.booru.questionable).toBeTruthy();
    expect(enUS.booru.explicit).toBeTruthy();
  });

  it('快捷键部分应包含导航和操作', () => {
    expect(zhCN.shortcuts.navigation).toBeTruthy();
    expect(zhCN.shortcuts.actions).toBeTruthy();
    expect(zhCN.shortcuts.interface).toBeTruthy();
    expect(enUS.shortcuts.navigation).toBeTruthy();
    expect(enUS.shortcuts.actions).toBeTruthy();
    expect(enUS.shortcuts.interface).toBeTruthy();
  });
});
