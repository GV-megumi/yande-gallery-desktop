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

          // antd 内部按子模块进一步拆分（顺序：更具体路径在前）
          // date-picker / calendar / time-picker（dayjs 依赖重）
          if (/node_modules[\\/]antd[\\/](es|lib)[\\/](date-picker|calendar|time-picker)[\\/]/.test(id)) {
            return 'vendor-antd-datepicker';
          }
          // form / input / select / upload 等表单组件
          if (/node_modules[\\/]antd[\\/](es|lib)[\\/](form|input|input-number|select|upload|checkbox|radio|switch|slider|cascader|auto-complete|tree-select|mentions)[\\/]/.test(id)) {
            return 'vendor-antd-form';
          }
          // table / tree / list / transfer 等大型数据展示组件
          if (/node_modules[\\/]antd[\\/](es|lib)[\\/](table|tree|list|transfer|virtual-list)[\\/]/.test(id)) {
            return 'vendor-antd-data';
          }
          // 其他 antd 核心（message / modal / button / tag / card / tabs 等通用组件）
          if (/node_modules[\\/]antd[\\/]/.test(id)) {
            return 'vendor-antd-core';
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
