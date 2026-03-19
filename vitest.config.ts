import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    root: __dirname,
  },
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src'),
    },
    // 优先解析 .ts 文件，避免被同名 .js 文件干扰
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
});
