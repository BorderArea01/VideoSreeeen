import { defineConfig } from 'vite';
export default defineConfig({
  root: 'client',
  envDir: '..',
  base: './',
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 700 },
  server: { port: 5173 },
});
