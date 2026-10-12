import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  base: '/admin/',
  build: {
    // Nested under `admin/` so the files on disk match the public `/admin/*`
    // paths that reach this service (services receive the original path).
    outDir: 'dist/admin',
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@meruveda/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: 5174,
  },
})
