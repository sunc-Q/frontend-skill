import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/* 单文件产物：lib-IIFE + inlineDynamicImports，供「双击打开」的三种风格预览页。
   file:// 下 fetch 不可用 → src/lib/api.ts 的 initTransport 自动切到 fixture 传输，
   资源层/Suspense/乐观更新走的是同一套代码，只有数据源不同。 */
export default defineConfig({
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [react(), viteSingleFile()],
  build: {
    lib: { entry: 'src/main.tsx', name: 'SoundIsleActivity', formats: ['iife'], fileName: () => 'soundisle.js' },
    rollupOptions: { output: { inlineDynamicImports: true, assetFileNames: 'soundisle.css' } },
    minify: 'esbuild',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
