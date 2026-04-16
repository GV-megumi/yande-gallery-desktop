import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Preload 在 sandboxed 模式下运行，Electron 只允许 require 内置模块和 preload 文件自身，
// 不支持加载 split 出来的共享 chunk。必须把每个 preload 打成单文件 bundle，
// 把 IPC_CHANNELS、createXxxApi 工厂等跨文件依赖完整内联进去。
//
// 本项目有两个 preload 入口（主窗口 index / 轻量子窗口 subwindow），两个入口要同时
// 满足"每个都是单文件"的约束。Rollup 多入口模式默认会把共享模块抽成 shared chunk，
// 与此冲突。解决方案：用 PRELOAD_ENTRY 环境变量选择一个入口，按 lib 模式单入口构建，
// 在 npm script 里运行两次（见 package.json 的 build:preload）。
const ENTRY_KEY = (process.env.PRELOAD_ENTRY || 'index') as 'index' | 'subwindow';
const ENTRY_SOURCE: Record<'index' | 'subwindow', string> = {
  index: path.join(__dirname, 'src/preload/index.ts'),
  subwindow: path.join(__dirname, 'src/preload/subwindow-index.ts'),
};
const ENTRY_FILE: Record<'index' | 'subwindow', string> = {
  index: 'index.js',
  subwindow: 'subwindow.js',
};

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
    // emptyOutDir 只能在第一次构建（index）时清空输出目录；
    // 第二次构建（subwindow）必须保留第一次的产物，否则会被清空。
    emptyOutDir: ENTRY_KEY === 'index',
    target: 'node22',
    minify: false,
    sourcemap: true,
    lib: {
      entry: ENTRY_SOURCE[ENTRY_KEY],
      formats: ['cjs'],
      fileName: () => ENTRY_FILE[ENTRY_KEY],
    },
    rollupOptions: {
      // Electron 内置模块不 bundle，preload 运行时由 Electron 注入
      external: ['electron'],
      output: {
        // lib 单入口 + inlineDynamicImports=true 保证所有依赖被内联到当前入口。
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
