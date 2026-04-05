import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, existsSync } from 'node:fs';

const firebaseRc = existsSync('.firebaserc')
  ? (JSON.parse(readFileSync('.firebaserc', 'utf8')) as { projects?: { default?: string } })
  : {};
const emulatorProjectId = firebaseRc.projects?.default || 'telarchy-e0043';

export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH || '/',
  build: {
    outDir: 'dist',
  },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: `http://127.0.0.1:5001/${emulatorProjectId}/us-central1/api`,
        changeOrigin: true,
      },
    },
  },
});
