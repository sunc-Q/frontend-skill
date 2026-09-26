import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const src = fileURLToPath(new URL('./src', import.meta.url));

// frontend-development "Import Aliases Quick Reference": @/, ~types, ~components, ~features
export const alias = {
  '@': src,
  '~types': `${src}/types`,
  '~components': `${src}/components`,
  '~features': `${src}/features`,
};

// One IIFE bundle per arm; scripts/build-inline.mjs injects it into the three style
// shells so the shipped <script> blocks stay byte-identical across styles.
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"', __FD_MEMO__: 'true' },
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
