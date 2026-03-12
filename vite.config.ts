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
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-antd': ['antd', '@ant-design/icons'],
          'vendor-dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/modifiers', '@dnd-kit/utilities'],
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
