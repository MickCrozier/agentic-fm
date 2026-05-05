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
      // Proxy AI/settings endpoints to the webviewer server.
      // /api/layout-xml and /api/context are handled locally by apiMiddleware.
      '/api/chat':               'http://localhost:8080',
      '/api/settings':           'http://localhost:8080',
      '/api/custom-instructions':'http://localhost:8080',
      '/api/clipboard':          'http://localhost:8080',
    },
  },
  build: {
    target: 'es2022',
  },
});
