import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* 代码分割版：不做 singlefile，保留真实 chunk 边界，
   用来量出「报价单明细 / 分析模块」在首包之外——即 bundle-conditional 与 bundle-defer-third-party 的可观测差异。 */
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
