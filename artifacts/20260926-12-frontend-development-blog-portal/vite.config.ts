import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const src = fileURLToPath(new URL('./src', import.meta.url));

/** frontend-development "Import Aliases Quick Reference": @/, ~types, ~components, ~features. */
export const alias = {
  '@': src,
  '~types': `${src}/types`,
  '~components': `${src}/components`,
  '~features': `${src}/features`,
};

/**
 * Main build: one IIFE with every dynamic import inlined, so scripts/build-inline.mjs can drop the
 * bundle into three self-contained pages that open over file://. The same source is also built by
 * vite.split.config.ts (real chunk boundaries) and vite.ablation.config.ts (rule-off arms); the
 * three style pages therefore share a byte-identical <script> and differ only in CSS.
 */
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': '"production"',
    __FD_ARM__: JSON.stringify({ virtual: true, memo: true, stableKey: true }),
  },
  resolve: { alias },
  build: {
    target: 'es2020',
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: `${src}/main.tsx`,
      output: {
        format: 'iife',
        entryFileNames: 'assets/main.js',
        chunkFileNames: 'assets/[name].js',
        inlineDynamicImports: true,
      },
    },
  },
});
