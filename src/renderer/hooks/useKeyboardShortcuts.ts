/**
 * 快捷键管理 Hook
 * 提供全局快捷键注册和管理功能
 */
import { useEffect, useCallback, useRef } from 'react';

/** 快捷键定义 */
export interface ShortcutDef {
  /** 快捷键组合，如 'ctrl+f', 'alt+left', 'escape' */
  key: string;
  /** 回调函数 */
  handler: () => void;
  /** 是否在输入框中也生效（默认 false） */
  enableInInput?: boolean;
  /** 描述（用于快捷键帮助面板） */
  description?: string;
}

/** 解析快捷键字符串为各部分 */
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

/** 检查键盘事件是否匹配快捷键定义 */
function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parsed = parseShortcut(shortcut);

  // 修饰键检查
  if (parsed.ctrl !== (event.ctrlKey || event.metaKey)) return false;
  if (parsed.shift !== event.shiftKey) return false;
  if (parsed.alt !== event.altKey) return false;

  // 主键检查
  const eventKey = event.key.toLowerCase();
  const parsedKey = parsed.key;

  // 特殊键映射
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

/** 检查当前焦点是否在输入元素上 */
function isInputFocused(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  const tagName = active.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true;
  if ((active as HTMLElement).isContentEditable) return true;
  return false;
}

/**
 * 全局快捷键 Hook
 * 注册一组快捷键，组件卸载时自动清理
 *
 * @param shortcuts 快捷键定义数组
 * @param enabled 是否启用（默认 true）
 */
export function useKeyboardShortcuts(shortcuts: ShortcutDef[], enabled = true) {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    if (!enabled) return;

    const handler = (event: KeyboardEvent) => {
      const inInput = isInputFocused();

      for (const shortcut of shortcutsRef.current) {
        // 如果在输入框中且该快捷键不允许在输入框中生效，跳过
        if (inInput && !shortcut.enableInInput) continue;

        if (matchesShortcut(event, shortcut.key)) {
          event.preventDefault();
          event.stopPropagation();
          shortcut.handler();
          return;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled]);
}

/**
 * 预定义的快捷键配置
 * 集中管理所有快捷键绑定
 */
export const SHORTCUT_KEYS = {
  // 导航
  PREV_IMAGE: 'left',
  NEXT_IMAGE: 'right',
  GO_BACK: 'esc',
  PREV_PAGE: 'alt+left',
  NEXT_PAGE: 'alt+right',

  // 操作
  TOGGLE_FAVORITE: 'f',
  DOWNLOAD: 'd',
  COPY_LINK: 'ctrl+c',
  OPEN_ORIGINAL: 'o',

  // 界面
  TOGGLE_THEME: 'ctrl+shift+t',
  OPEN_SETTINGS: 'ctrl+,',
  FOCUS_SEARCH: 'ctrl+f',
  SHOW_SHORTCUTS: 'shift+?',
} as const;

/**
 * 获取快捷键显示文本
 * 将内部格式转换为用户友好的显示文本
 */
export function formatShortcutKey(key: string): string {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

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
