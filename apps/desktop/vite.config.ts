import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@grey/config': path.resolve(__dirname, '../../packages/config/src/index.ts'),
      '@grey/utils':  path.resolve(__dirname, '../../packages/utils/src/index.ts'),
    },
  },
  server: {
    port: 5173,
  },
})
