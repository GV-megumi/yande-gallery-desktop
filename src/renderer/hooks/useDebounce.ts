/**
 * 防抖 Hook
 * 延迟更新值，避免高频触发搜索等操作
 */

import { useState, useEffect } from 'react';

/**
 * 返回一个防抖后的值
 * @param value 原始值
 * @param delay 延迟时间（毫秒），默认 300ms
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
