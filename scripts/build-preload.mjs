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
 *
 * 用法：
 *   node scripts/build-preload.mjs           — 普通串行构建（CI / 生产）
 *   node scripts/build-preload.mjs --watch   — watch 模式：先全量构建，再并发 watch 两个入口
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const viteCli = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');

const isWatch = process.argv.includes('--watch');

/**
 * 调用 `vite build` 一次（非 watch），通过环境变量 PRELOAD_ENTRY 指定要构建的入口。
 * @param {string} entry - 'index' 或 'subwindow'
 * @param {{ noEmpty?: boolean }} [opts]
 */
function runViteBuild(entry, opts = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PRELOAD_ENTRY: entry,
      ...(opts.noEmpty ? { PRELOAD_NO_EMPTY: 'true' } : {}),
    };
    const child = spawn(process.execPath, [viteCli, 'build', '--config', 'vite.preload.config.ts'], {
      cwd: projectRoot,
      stdio: 'inherit',
      env,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`vite build (${entry}) 失败，退出码 ${code}`));
    });
  });
}

/**
 * 启动 `vite build --watch` 子进程，stdout/stderr 带前缀透传。
 * @param {string} entry - 'index' 或 'subwindow'
 * @returns {import('node:child_process').ChildProcess}
 */
function spawnViteWatch(entry) {
  const prefix = `[preload:${entry}]`;
  const env = {
    ...process.env,
    PRELOAD_ENTRY: entry,
    PRELOAD_NO_EMPTY: 'true',
  };
  const child = spawn(
    process.execPath,
    [viteCli, 'build', '--watch', '--config', 'vite.preload.config.ts'],
    {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    }
  );

  child.stdout.on('data', (data) => {
    const lines = String(data).split('\n');
    for (const line of lines) {
      if (line.trim()) process.stdout.write(`${prefix} ${line}\n`);
    }
  });
  child.stderr.on('data', (data) => {
    const lines = String(data).split('\n');
    for (const line of lines) {
      if (line.trim()) process.stderr.write(`${prefix} ${line}\n`);
    }
  });

  child.on('error', (err) => {
    console.error(`${prefix} 子进程错误:`, err);
  });
  child.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGINT' && signal !== 'SIGTERM' && code !== null) {
      console.error(`${prefix} 子进程退出，退出码 ${code}`);
    }
  });

  return child;
}

async function main() {
  if (isWatch) {
    // Watch 模式：先同步全量构建作为 baseline，再并发 watch 两个入口。
    console.log('[build-preload] watch 模式：先执行全量构建作为 baseline ...');
    console.log('[build-preload] 构建主窗口 preload (index) ...');
    await runViteBuild('index');
    console.log('[build-preload] 构建子窗口 preload (subwindow) ...');
    await runViteBuild('subwindow');
    console.log('[build-preload] baseline 构建完成，启动双入口 watch ...');

    const children = [spawnViteWatch('index'), spawnViteWatch('subwindow')];

    // 守卫：避免用户连按 Ctrl+C 时 shutdown 被调多次，
    // 导致 exit 监听器累积、process.exit 被多次调用。
    let shuttingDown = false;

    // 收到退出信号时，优雅关闭所有子进程
    const shutdown = (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`\n[build-preload] 收到 ${signal}，关闭子进程 ...`);
      for (const child of children) {
        try {
          // Windows 上 ChildProcess.kill 始终走 TerminateProcess 硬杀，
          // 无论传什么 signal 名都不会真的发送该信号；传 signal 反而会让
          // vite 没机会 flush watcher 状态。统一用无参 kill()（默认 SIGTERM），
          // 在 Unix 上仍能让子进程优雅退出，在 Windows 上等价硬杀。
          child.kill();
        } catch (_) {
          // 子进程可能已退出，忽略错误
        }
      }
      // 等待子进程退出后再退出主进程
      let exited = 0;
      for (const child of children) {
        child.on('exit', () => {
          exited++;
          if (exited === children.length) {
            process.exit(0);
          }
        });
      }
      // 超时保底：3 秒后强制退出
      setTimeout(() => process.exit(0), 3000).unref();
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } else {
    // 普通串行构建（CI / 生产）：按顺序构建，index 在先（clean 输出目录），subwindow 在后（保留 index 产物）。
    console.log('[build-preload] 构建主窗口 preload (index) ...');
    await runViteBuild('index');
    console.log('[build-preload] 构建轻量子窗口 preload (subwindow) ...');
    await runViteBuild('subwindow');
    console.log('[build-preload] 完成');
  }
}

main().catch((error) => {
  console.error('[build-preload] 构建失败:', error);
  process.exit(1);
});
