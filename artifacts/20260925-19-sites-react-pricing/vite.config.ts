import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/* 单文件产物：lib-IIFE + inlineDynamicImports，用来做「双击就能打开」的三种风格预览页。
   代价是所有动态 chunk 被并回主包 —— bundle-conditional 的可观测差异改由 vite.split.config.ts 验证。 */
export default defineConfig({
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [react(), viteSingleFile()],
  build: {
    lib: { entry: 'src/main.tsx', name: 'SongtaPricing', formats: ['iife'], fileName: () => 'songta.js' },
    rollupOptions: { output: { inlineDynamicImports: true, assetFileNames: 'songta.css' } },
    minify: 'esbuild',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
