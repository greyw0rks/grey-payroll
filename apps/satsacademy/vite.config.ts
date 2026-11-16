import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('../..', import.meta.url));
const dependencies = realpathSync(resolve(workspace, 'node_modules'));

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.SATS_ACADEMY_PORT || 4403),
    strictPort: true,
    fs: { allow: [workspace, dependencies] },
    proxy: { '/api': process.env.SATS_API_ORIGIN || 'http://127.0.0.1:4400' }
  },
  build: { outDir: 'dist', emptyOutDir: true },
  base: process.env.SATS_BUILD_BASE || '/'
});
