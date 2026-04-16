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
          if (!id.includes('node_modules')) return undefined;

          // React 核心
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return 'vendor-react';
          }

          // antd 核心 UI（不含 icons）
          if (/node_modules[\\/]antd[\\/]/.test(id)) {
            return 'vendor-antd-core';
          }
          // antd 图标
          if (/node_modules[\\/]@ant-design[\\/]icons[\\/]/.test(id)) {
            return 'vendor-antd-icons';
          }
          // antd 子模块生态（cssinjs、colors、hooks 等）
          if (/node_modules[\\/]@ant-design[\\/]/.test(id)) {
            return 'vendor-antd-misc';
          }
          // rc-* (antd 底层组件)
          if (/node_modules[\\/]rc-[\w-]+[\\/]/.test(id)) {
            return 'vendor-antd-rc';
          }

          // dnd-kit
          if (/node_modules[\\/]@dnd-kit[\\/]/.test(id)) {
            return 'vendor-dnd';
          }

          return undefined; // 其他走默认
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
