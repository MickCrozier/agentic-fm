import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { apiMiddleware } from './server/api';

export default defineConfig({
  plugins: [
    preact(),
    tailwindcss(),
    apiMiddleware(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    host: true,
    port: 8081,
    strictPort: true,
    proxy: {
      // /api/chat, /api/settings, /api/custom-instructions handled locally by apiMiddleware.
      '/api/clipboard': 'http://host.docker.internal:8765',
    },
  },
  build: {
    target: 'es2022',
  },
});
