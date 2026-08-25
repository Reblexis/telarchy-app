import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: process.env.BASE_PATH || '/',
  build: {
    outDir: 'dist',
  },
  server: {
    host: '127.0.0.1',
    proxy: {
      // Match `/api/...` (with trailing slash) so SPA routes whose path
      // happens to start with the literal characters "/api" (e.g.
      // `/api-access`) keep resolving to the SPA. The production server
      // enforces the same boundary: only `/api/<segment>` is owned by the
      // API router; everything else falls through to the static SPA.
      '^/api/': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
});
