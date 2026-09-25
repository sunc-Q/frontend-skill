import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* 代码分割版：由 server/mock-api.mjs 静态服务，浏览器里跑真 HTTP 取数。
   保留 chunk 边界，用于 bundle-dynamic-imports / bundle-conditional / bundle-defer-third-party 的断言证据。 */
export default defineConfig({
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [react()],
  build: {
    outDir: 'dist-split',
    emptyOutDir: true,
    minify: 'esbuild',
    rollupOptions: { input: 'index.html' },
  },
});
