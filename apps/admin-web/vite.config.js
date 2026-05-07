import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [react()],
  server: {
    port: 5171,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:7171',
        changeOrigin: true,
      },
      '/_health': {
        target: 'http://localhost:7171',
        changeOrigin: true,
      },
      '/_db': {
        target: 'http://localhost:7171',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
