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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/mapbox-gl/') || id.includes('@mapbox')) return 'mapbox'
          if (id.includes('/recharts/') || id.includes('/d3-') || id.includes('/victory')) return 'charts'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react-vendor'
          return 'vendor'
        },
      },
    },
  },
})
