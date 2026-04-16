/**
 * 分两次调用 vite 构建 preload：
 *   1. PRELOAD_ENTRY=index     → build/preload/index.js
 *   2. PRELOAD_ENTRY=subwindow → build/preload/subwindow.js
 *
 * 原因：sandboxed preload 只能 require 内置模块和 preload 文件本身，
 * 不能加载 rollup 多入口自动抽取出来的共享 chunk。
 * 所以每个入口必须独立构建成单文件 bundle（lib 模式 + inlineDynamicImports）。
 *
 * 跨平台在 package.json 里设 env 要 cross-env；为避免新增依赖，
 * 改用这份小 node 脚本显式分两步触发构建。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

/**
 * 调用 `vite build` 一次，通过环境变量 PRELOAD_ENTRY 指定要构建的入口。
 */
function runViteBuild(entry) {
  return new Promise((resolve, reject) => {
    // Windows 下 npx 是 .cmd 脚本，spawn 需要 shell:true 才能解析；
    // POSIX 下也可以用 shell:true（只是略慢）。统一打开避免平台分叉。
    const child = spawn('npx', ['vite', 'build', '--config', 'vite.preload.config.ts'], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: { ...process.env, PRELOAD_ENTRY: entry },
      shell: true,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`vite build (${entry}) 失败，退出码 ${code}`));
    });
  });
}

async function main() {
  // 按顺序串行构建：index 在先（clean 输出目录），subwindow 在后（保留 index 产物）。
  console.log('[build-preload] 构建主窗口 preload (index) ...');
  await runViteBuild('index');
  console.log('[build-preload] 构建轻量子窗口 preload (subwindow) ...');
  await runViteBuild('subwindow');
  console.log('[build-preload] 完成');
}

main().catch((error) => {
  console.error('[build-preload] 构建失败:', error);
  process.exit(1);
});
