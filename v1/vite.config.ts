import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// En développement, Vite sert l'interface et relaie /api vers le serveur Node (npm start).
const API = process.env.API_URL || 'http://127.0.0.1:8787';
// Numéro de version affiché dans l'en-tête et comparé à la dernière version publiée (mise à jour).
const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  server: { port: 5173, proxy: { '/api': API } },
  build: { outDir: 'dist', chunkSizeWarningLimit: 3000 },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'desktop/**/*.test.mjs'],
  },
});
