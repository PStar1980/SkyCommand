import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const envDir = fileURLToPath(new URL('../..', import.meta.url));

function resolveWebPort(mode) {
  const env = loadEnv(mode, envDir, '');
  const raw = String(process.env.SKYCOMMAND_WEB_PORT || env.SKYCOMMAND_WEB_PORT || '15171').trim();
  const port = Number.parseInt(raw, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`SKYCOMMAND_WEB_PORT must be a valid TCP port. Received: ${raw}`);
  }

  return port;
}

export default defineConfig(({ mode }) => ({
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir,
  plugins: [react()],
  server: {
    port: resolveWebPort(mode),
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
}));
