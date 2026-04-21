import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    root: __dirname,
    // 部分 renderer 渲染测试在并发 98 个 test file 时会受 jsdom/React 渲染
    // 耗时影响偶发超时，将默认 5s 提到 30s 减少环境抖动导致的误报。
    testTimeout: 30000,
    setupFiles: ['tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src'),
    },
    // 优先解析 .ts 文件，避免被同名 .js 文件干扰
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
});
