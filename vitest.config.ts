import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    include: ['tests/**/*.{test,spec}.ts'],
    root: __dirname,
  },
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src'),
    },
  },
});
