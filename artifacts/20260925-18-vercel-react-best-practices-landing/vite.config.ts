import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [react(), viteSingleFile()],
  build: {
    lib: { entry: 'src/main.tsx', name: 'ShiguangLanding', formats: ['iife'], fileName: () => 'shiguang.js' },
    rollupOptions: { output: { inlineDynamicImports: true, assetFileNames: 'shiguang.css' } },
    minify: 'esbuild',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
