import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// En développement, Vite sert l'interface et relaie /api vers le serveur Node (npm start).
const API = process.env.API_URL || 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': API } },
  build: { outDir: 'dist', chunkSizeWarningLimit: 3000 },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
