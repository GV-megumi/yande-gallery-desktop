/**
 * 多语言系统入口
 * 提供 LocaleContext 和 useLocale hook
 */
import { createContext, useContext, useState, useCallback } from 'react';
import zhCN from './zh-CN';
import enUS from './en-US';
import type { LocaleMessages } from './zh-CN';

export type LocaleType = 'zh-CN' | 'en-US';

/** 语言包映射 */
const localeMap: Record<LocaleType, LocaleMessages> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

/** Ant Design locale 名称映射 */
export const antdLocaleMap: Record<LocaleType, string> = {
  'zh-CN': 'zhCN',
  'en-US': 'enUS',
};

/** 语言显示名称 */
export const localeNames: Record<LocaleType, string> = {
  'zh-CN': '中文',
  'en-US': 'English',
};

const STORAGE_KEY = 'app-locale';

/** 从 localStorage 读取保存的语言设置 */
function loadLocale(): LocaleType {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'zh-CN' || stored === 'en-US') {
      return stored;
    }
  } catch (e) {
    // localStorage 不可用
  }
  return 'zh-CN';
}

/** 语言上下文类型 */
interface LocaleContextValue {
  locale: LocaleType;
  messages: LocaleMessages;
  setLocale: (locale: LocaleType) => void;
  /** 带参数的消息格式化，替换 {key} 占位符 */
  t: (path: string, params?: Record<string, string | number>) => string;
}

/** 语言 Context */
export const LocaleContext = createContext<LocaleContextValue>({
  locale: 'zh-CN',
  messages: zhCN,
  setLocale: () => {},
  t: () => '',
});

/**
 * 语言 Provider 使用的 Hook
 * 在 main.tsx 中使用
 */
export function useLocaleProvider() {
  const [locale, setLocaleState] = useState<LocaleType>(loadLocale);

  const messages = localeMap[locale];

  const setLocale = useCallback((newLocale: LocaleType) => {
    console.log('[useLocale] 切换语言:', newLocale);
    setLocaleState(newLocale);
    try {
      localStorage.setItem(STORAGE_KEY, newLocale);
    } catch (e) {
      // localStorage 不可用
    }
  }, []);

  /** 通过路径获取翻译文本，支持参数替换 */
  const t = useCallback((path: string, params?: Record<string, string | number>): string => {
    const keys = path.split('.');
    let result: any = messages;
    for (const key of keys) {
      if (result && typeof result === 'object' && key in result) {
        result = result[key];
      } else {
        console.warn(`[i18n] 翻译 key 不存在: ${path}`);
        return path;
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
  }, [messages]);

  return { locale, messages, setLocale, t };
}

/**
 * 使用语言的 Hook
 * 在组件中使用
 */
export function useLocale() {
  return useContext(LocaleContext);
}

export type { LocaleMessages };
export { zhCN, enUS };
