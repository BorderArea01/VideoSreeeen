import { defineConfig } from 'vite';
export default defineConfig({
  root: 'client',
  base: './',
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 700 },
  server: { port: 5173 },
});
