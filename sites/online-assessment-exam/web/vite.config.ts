import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 产物用相对路径，便于 file:// 直接打开与内联成单文件预览版。
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: 100000,
    rollupOptions: { output: { entryFileNames: 'assets/app.js', chunkFileNames: 'assets/[name].js' } },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true } },
  },
});
