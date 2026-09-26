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

// ABLATION CONTROL: identical source, __FD_MEMO__ = false, so every field component is
// an unmemoised function with inline handlers. check-dom mounts this bundle next to the
// shipped one and compares (a) rendered DOM bytes and (b) renders-per-keystroke.
// The clause under test: "Use useCallback for event handlers passed to children" +
// "React.memo: Expensive components".
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"', __FD_MEMO__: 'false' },
  resolve: { alias },
  build: {
    target: 'es2020',
    outDir: 'dist-plain',
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
