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

// Evidence build: keeps the real chunk boundaries created by React.lazy() so the
// skill's "Lazy load heavy components" clause can be measured instead of asserted.
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  resolve: { alias },
  build: {
    target: 'es2020',
    outDir: 'dist-split',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: `${src}/main.tsx`,
      output: {
        format: 'es',
        entryFileNames: 'assets/main.js',
        chunkFileNames: 'assets/[name].js',
      },
    },
  },
});
