import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Preload 在 sandboxed 模式下运行，Electron 只允许 require 内置模块和 preload 文件自身。
// 必须把 preload 打成单文件 bundle，把 IPC_CHANNELS 等跨文件依赖内联进来。
export default defineConfig({
  // Vite 会自动用 esbuild 处理 TS，不需要独立的 tsconfig（tsconfig.preload.json 只管 tsc 类型检查）。
  esbuild: {
    target: 'node22',
  },
  plugins: [
    // TS 源里 import 路径按 ESM 规范带 .js 扩展（如 '../main/ipc/channels.js'），
    // rollup 按字面量找 .js 文件找不到——把这类相对导入改写到同名 .ts 源文件。
    {
      name: 'ts-source-redirect',
      enforce: 'pre' as const,
      async resolveId(source, importer) {
        if (!importer || !source.startsWith('.') || !source.endsWith('.js')) {
          return null;
        }
        const absJs = path.resolve(path.dirname(importer), source);
        if (fs.existsSync(absJs)) {
          return null;
        }
        const absTs = absJs.replace(/\.js$/, '.ts');
        if (fs.existsSync(absTs)) {
          return absTs;
        }
        return null;
      },
    },
    // 根 package.json 是 "type": "module"，输出成 CJS 的 .js 会被当 ESM 加载报错。
    // 用一个本地 package.json 把 build/preload 覆盖为 commonjs。
    {
      name: 'write-preload-package-json',
      closeBundle() {
        const outDir = path.join(__dirname, 'build/preload');
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(
          path.join(outDir, 'package.json'),
          JSON.stringify({ type: 'commonjs' }, null, 2) + '\n'
        );
      },
    },
  ],
  build: {
    outDir: path.join(__dirname, 'build/preload'),
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: true,
    lib: {
      entry: path.join(__dirname, 'src/preload/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      // Electron 内置模块不 bundle，preload 运行时由 Electron 注入
      external: ['electron'],
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src'),
    },
    // TS 源里 import 路径带 .js 扩展（ESM 规范要求），rollup 默认按字面量找不到；
    // 让它也能解析到 .ts 源文件。
    extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'],
  },
});
