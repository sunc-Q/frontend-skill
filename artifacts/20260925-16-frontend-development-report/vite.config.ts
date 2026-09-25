import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        editorial: resolve(import.meta.dirname, 'editorial.html'),
        statement: resolve(import.meta.dirname, 'statement.html'),
        cyber: resolve(import.meta.dirname, 'cyber.html'),
      },
    },
  },
});
