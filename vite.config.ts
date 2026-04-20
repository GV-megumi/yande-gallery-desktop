import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig({
  plugins: [react()],
  base: './',
  root: path.join(__dirname, 'src/renderer'),
  build: {
    outDir: path.join(__dirname, 'build/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.join(__dirname, 'src/renderer/index.html')
      },
      output: {
        manualChunks(id) {
          // React / antd / rc-* 的 ESM 与 CJS helper 在细粒度拆包时会形成跨 chunk
          // 循环依赖，生产包可能在 rc-util 读取 React.version 时拿到未初始化对象。
          // 发布包优先保证启动稳定，第三方依赖统一进入一个 vendor chunk。
          if (id.includes('node_modules')) return 'vendor';

          return undefined;
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src')
    }
  },
  server: {
    port: 5173,
    host: 'localhost'
  }
})
