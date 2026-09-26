import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const src = fileURLToPath(new URL('./src', import.meta.url));
const alias = {
  '@': src,
  '~types': `${src}/types`,
  '~components': `${src}/components`,
  '~features': `${src}/features`,
};

/**
 * Evidence build: same source, ES output, dynamic imports left alone. This is what makes the
 * skill's "lazy load heavy components" clause measurable — group L reads the real chunk graph
 * (entry size vs. the on-demand insights/post chunks) instead of trusting a code comment.
 */
export default defineConfig({
  /* Absolute base: the host page lives at /preview/split-host.html, so relative chunk URLs
     would resolve against /preview/ and 404. With this the preload map emits /dist-split/…. */
  base: '/dist-split/',
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': '"production"',
    __FD_ARM__: JSON.stringify({ virtual: true, memo: true, stableKey: true }),
  },
  resolve: { alias },
  build: {
    target: 'es2020',
    outDir: 'dist-split',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    rollupOptions: {
      input: `${src}/main.tsx`,
      output: {
        format: 'es',
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
      },
    },
  },
});
