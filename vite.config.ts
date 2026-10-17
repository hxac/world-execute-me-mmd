import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    watch: {
      ignored: ['**/.*.tmpdir/**', '**/.captures/**', '**/.npm-cache/**', '**/.tmp/**', '**/dist/**'],
    },
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
});
