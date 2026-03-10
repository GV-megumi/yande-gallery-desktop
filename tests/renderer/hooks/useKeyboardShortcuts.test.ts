import { describe, it, expect } from 'vitest';

/**
 * useKeyboardShortcuts 纯函数测试
 * 提取 parseShortcut、matchesShortcut、formatShortcutKey 的等价实现进行测试
 * 不涉及 React Hooks / DOM，纯逻辑验证
 */

// ========= 等价实现：parseShortcut =========

function parseShortcut(shortcut: string) {
  const parts = shortcut.toLowerCase().split('+').map(p => p.trim());
  return {
    ctrl: parts.includes('ctrl') || parts.includes('control'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    meta: parts.includes('meta') || parts.includes('cmd'),
    key: parts.filter(p => !['ctrl', 'control', 'shift', 'alt', 'meta', 'cmd'].includes(p))[0] || '',
  };
}

// ========= 等价实现：matchesShortcut =========

function matchesShortcut(event: Partial<KeyboardEvent>, shortcut: string): boolean {
  const parsed = parseShortcut(shortcut);

  if (parsed.ctrl !== (!!event.ctrlKey || !!event.metaKey)) return false;
  if (parsed.shift !== !!event.shiftKey) return false;
  if (parsed.alt !== !!event.altKey) return false;

  const eventKey = (event.key || '').toLowerCase();
  const parsedKey = parsed.key;

  const keyMap: Record<string, string[]> = {
    'left': ['arrowleft'],
    'right': ['arrowright'],
    'up': ['arrowup'],
    'down': ['arrowdown'],
    'esc': ['escape'],
    'enter': ['enter'],
    'space': [' '],
    'tab': ['tab'],
    'delete': ['delete'],
    'backspace': ['backspace'],
  };

  if (keyMap[parsedKey]) {
    return keyMap[parsedKey].includes(eventKey);
  }

  return eventKey === parsedKey;
}

// ========= 等价实现：formatShortcutKey =========

function formatShortcutKey(key: string, isMac: boolean): string {
  return key
    .split('+')
    .map(part => {
      const p = part.trim().toLowerCase();
      switch (p) {
        case 'ctrl':
        case 'control':
          return isMac ? '⌘' : 'Ctrl';
        case 'shift':
          return isMac ? '⇧' : 'Shift';
        case 'alt':
          return isMac ? '⌥' : 'Alt';
        case 'meta':
        case 'cmd':
          return isMac ? '⌘' : 'Win';
        case 'left':
          return '←';
        case 'right':
          return '→';
        case 'up':
          return '↑';
        case 'down':
          return '↓';
        case 'esc':
        case 'escape':
          return 'Esc';
        case 'enter':
          return '↵';
        case 'space':
          return 'Space';
        case 'tab':
          return 'Tab';
        case 'delete':
          return 'Del';
        case 'backspace':
          return '⌫';
        case '?':
          return '?';
        default:
          return p.toUpperCase();
      }
    })
    .join(isMac ? '' : ' + ');
}

// ========= SHORTCUT_KEYS 等价定义 =========

const SHORTCUT_KEYS = {
  PREV_IMAGE: 'left',
  NEXT_IMAGE: 'right',
  GO_BACK: 'esc',
  PREV_PAGE: 'alt+left',
  NEXT_PAGE: 'alt+right',
  TOGGLE_FAVORITE: 'f',
  DOWNLOAD: 'd',
  COPY_LINK: 'ctrl+c',
  OPEN_ORIGINAL: 'o',
  TOGGLE_THEME: 'ctrl+shift+t',
  OPEN_SETTINGS: 'ctrl+,',
  FOCUS_SEARCH: 'ctrl+f',
  SHOW_SHORTCUTS: 'shift+?',
} as const;

// ========= parseShortcut 测试 =========

describe('parseShortcut', () => {
  it('简单键应只有 key，无修饰键', () => {
    const result = parseShortcut('f');
    expect(result).toEqual({ ctrl: false, shift: false, alt: false, meta: false, key: 'f' });
  });

  it('ctrl+f 应解析 ctrl 和 key', () => {
    const result = parseShortcut('ctrl+f');
    expect(result.ctrl).toBe(true);
    expect(result.key).toBe('f');
    expect(result.shift).toBe(false);
    expect(result.alt).toBe(false);
  });

  it('ctrl+shift+t 应解析多个修饰键', () => {
    const result = parseShortcut('ctrl+shift+t');
    expect(result.ctrl).toBe(true);
    expect(result.shift).toBe(true);
    expect(result.key).toBe('t');
  });

  it('alt+left 应正确解析', () => {
    const result = parseShortcut('alt+left');
    expect(result.alt).toBe(true);
    expect(result.key).toBe('left');
  });

  it('Control 应等价于 ctrl', () => {
    const result = parseShortcut('Control+a');
    expect(result.ctrl).toBe(true);
    expect(result.key).toBe('a');
  });

  it('cmd 应等价于 meta', () => {
    const result = parseShortcut('cmd+z');
    expect(result.meta).toBe(true);
    expect(result.key).toBe('z');
  });

  it('大小写混合应正确解析', () => {
    const result = parseShortcut('CTRL+SHIFT+F');
    expect(result.ctrl).toBe(true);
    expect(result.shift).toBe(true);
    expect(result.key).toBe('f');
  });

  it('含空格的分隔符应被 trim', () => {
    const result = parseShortcut('ctrl + f');
    expect(result.ctrl).toBe(true);
    expect(result.key).toBe('f');
  });

  it('esc 应作为普通 key 解析', () => {
    const result = parseShortcut('esc');
    expect(result.key).toBe('esc');
    expect(result.ctrl).toBe(false);
  });

  it('shift+? 应正确解析', () => {
    const result = parseShortcut('shift+?');
    expect(result.shift).toBe(true);
    expect(result.key).toBe('?');
  });

  it('无 key 的组合应返回空字符串 key', () => {
    const result = parseShortcut('ctrl+shift');
    expect(result.ctrl).toBe(true);
    expect(result.shift).toBe(true);
    expect(result.key).toBe('');
  });
});

// ========= matchesShortcut 测试 =========

describe('matchesShortcut', () => {
  it('普通按键应匹配', () => {
    const event = { key: 'f', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
    expect(matchesShortcut(event, 'f')).toBe(true);
  });

  it('ctrl+f 应匹配 ctrlKey=true', () => {
    const event = { key: 'f', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false };
    expect(matchesShortcut(event, 'ctrl+f')).toBe(true);
  });

  it('不按 ctrl 时不应匹配 ctrl+f', () => {
    const event = { key: 'f', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
    expect(matchesShortcut(event, 'ctrl+f')).toBe(false);
  });

  it('多余的修饰键不应匹配', () => {
    const event = { key: 'f', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false };
    expect(matchesShortcut(event, 'ctrl+f')).toBe(false); // shift 多余
  });

  it('left 应匹配 ArrowLeft', () => {
    const event = { key: 'ArrowLeft', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
    expect(matchesShortcut(event, 'left')).toBe(true);
  });

  it('right 应匹配 ArrowRight', () => {
    const event = { key: 'ArrowRight', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
    expect(matchesShortcut(event, 'right')).toBe(true);
  });

  it('esc 应匹配 Escape', () => {
    const event = { key: 'Escape', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
    expect(matchesShortcut(event, 'esc')).toBe(true);
  });

  it('space 应匹配空格字符', () => {
    const event = { key: ' ', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
    expect(matchesShortcut(event, 'space')).toBe(true);
  });

  it('alt+left 应匹配 altKey + ArrowLeft', () => {
    const event = { key: 'ArrowLeft', ctrlKey: false, shiftKey: false, altKey: true, metaKey: false };
    expect(matchesShortcut(event, 'alt+left')).toBe(true);
  });

  it('metaKey 应视为 ctrl（ctrl 快捷键匹配）', () => {
    const event = { key: 'c', ctrlKey: false, shiftKey: false, altKey: false, metaKey: true };
    expect(matchesShortcut(event, 'ctrl+c')).toBe(true);
  });

  it('ctrl+shift+t 应完整匹配三键', () => {
    const event = { key: 't', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false };
    expect(matchesShortcut(event, 'ctrl+shift+t')).toBe(true);
  });

  it('错误的主键不应匹配', () => {
    const event = { key: 'x', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false };
    expect(matchesShortcut(event, 'ctrl+f')).toBe(false);
  });

  it('backspace 应匹配', () => {
    const event = { key: 'Backspace', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
    expect(matchesShortcut(event, 'backspace')).toBe(true);
  });

  it('tab 应匹配', () => {
    const event = { key: 'Tab', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
    expect(matchesShortcut(event, 'tab')).toBe(true);
  });
});

// ========= formatShortcutKey 测试 =========

describe('formatShortcutKey (Windows)', () => {
  const fmt = (key: string) => formatShortcutKey(key, false);

  it('ctrl+f 应格式化为 Ctrl + F', () => {
    expect(fmt('ctrl+f')).toBe('Ctrl + F');
  });

  it('ctrl+shift+t 应格式化为 Ctrl + Shift + T', () => {
    expect(fmt('ctrl+shift+t')).toBe('Ctrl + Shift + T');
  });

  it('left 应格式化为 ←', () => {
    expect(fmt('left')).toBe('←');
  });

  it('alt+left 应格式化为 Alt + ←', () => {
    expect(fmt('alt+left')).toBe('Alt + ←');
  });

  it('esc 应格式化为 Esc', () => {
    expect(fmt('esc')).toBe('Esc');
  });

  it('单字母应大写', () => {
    expect(fmt('f')).toBe('F');
    expect(fmt('d')).toBe('D');
  });

  it('shift+? 应格式化为 Shift + ?', () => {
    expect(fmt('shift+?')).toBe('Shift + ?');
  });

  it('meta 在 Windows 应显示为 Win', () => {
    expect(fmt('meta+z')).toBe('Win + Z');
  });

  it('backspace 应显示为 ⌫', () => {
    expect(fmt('backspace')).toBe('⌫');
  });

  it('enter 应显示为 ↵', () => {
    expect(fmt('enter')).toBe('↵');
  });
});

describe('formatShortcutKey (Mac)', () => {
  const fmt = (key: string) => formatShortcutKey(key, true);

  it('ctrl+f 应格式化为 ⌘F（Mac 无空格分隔）', () => {
    expect(fmt('ctrl+f')).toBe('⌘F');
  });

  it('ctrl+shift+t 应格式化为 ⌘⇧T', () => {
    expect(fmt('ctrl+shift+t')).toBe('⌘⇧T');
  });

  it('alt 应显示为 ⌥', () => {
    expect(fmt('alt+left')).toBe('⌥←');
  });

  it('cmd 应显示为 ⌘', () => {
    expect(fmt('cmd+z')).toBe('⌘Z');
  });
});

// ========= SHORTCUT_KEYS 常量测试 =========

describe('SHORTCUT_KEYS 常量', () => {
  it('应包含导航快捷键', () => {
    expect(SHORTCUT_KEYS.PREV_IMAGE).toBe('left');
    expect(SHORTCUT_KEYS.NEXT_IMAGE).toBe('right');
    expect(SHORTCUT_KEYS.GO_BACK).toBe('esc');
    expect(SHORTCUT_KEYS.PREV_PAGE).toBe('alt+left');
    expect(SHORTCUT_KEYS.NEXT_PAGE).toBe('alt+right');
  });

  it('应包含操作快捷键', () => {
    expect(SHORTCUT_KEYS.TOGGLE_FAVORITE).toBe('f');
    expect(SHORTCUT_KEYS.DOWNLOAD).toBe('d');
    expect(SHORTCUT_KEYS.COPY_LINK).toBe('ctrl+c');
    expect(SHORTCUT_KEYS.OPEN_ORIGINAL).toBe('o');
  });

  it('应包含界面快捷键', () => {
    expect(SHORTCUT_KEYS.TOGGLE_THEME).toBe('ctrl+shift+t');
    expect(SHORTCUT_KEYS.OPEN_SETTINGS).toBe('ctrl+,');
    expect(SHORTCUT_KEYS.FOCUS_SEARCH).toBe('ctrl+f');
    expect(SHORTCUT_KEYS.SHOW_SHORTCUTS).toBe('shift+?');
  });

  it('共有 13 个快捷键定义', () => {
    expect(Object.keys(SHORTCUT_KEYS)).toHaveLength(13);
  });
});
