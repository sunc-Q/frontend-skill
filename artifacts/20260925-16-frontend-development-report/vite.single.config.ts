import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 第二套构建：把某个主题的入口打成完全自包含的单文件页面（可直接双击打开，无需本地服务器）
const theme = process.env['THEME'] ?? 'editorial';
const root = import.meta.dirname;

export default defineConfig({
  root,
  plugins: [vue()],
  build: {
    outDir: resolve(root, '.single', theme),
    emptyOutDir: true,
    cssCodeSplit: false,
    target: 'es2020',
    rollupOptions: {
      input: resolve(root, `${theme}.html`),
      output: { inlineDynamicImports: true, entryFileNames: 'page.js', assetFileNames: 'page.[ext]' },
    },
  },
});
