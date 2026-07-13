import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import yaml from '@modyfi/vite-plugin-yaml'
import path from 'path'

export default defineConfig({
  base: process.env.PATH_PREFIX ? `${process.env.PATH_PREFIX}/` : '/',
  plugins: [react(), tailwindcss(), yaml()],
  resolve: {
    alias: {
      '@': '/src',
      '@config': path.resolve(__dirname, 'config.yml'),
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // 把近 2MB 的运动数据 activities.json 单独拆成 data chunk，
          // 主包 index.js 保持小巧，且无需运行时 fetch（兼容 file://、子路径等任意部署）
          if (id.includes('activities.json')) return 'data'
          if (!id.includes('node_modules')) return
          // pnpm 布局下真实路径形如 .../.pnpm/<pkg>@<ver>/node_modules/<pkg>/...
          // 因此用包名子串匹配，并用 [\\/] 兼容 Windows 反斜杠
          if (
            id.includes('recharts') ||
            id.includes('d3-') ||
            id.includes('victory') ||
            id.includes('react-smooth')
          ) {
            return 'charts'
          }
          if (id.includes('mapbox-gl') || id.includes('@mapbox')) return 'mapbox'
          if (id.includes('lucide-react')) return 'icons'
          if (id.includes('html-to-image')) return 'vendor'
          if (id.match(/[\\/]react(-dom)?[\\/]/) || id.includes('scheduler')) return 'react-vendor'
          return 'vendor'
        },
      },
    },
  },
})
