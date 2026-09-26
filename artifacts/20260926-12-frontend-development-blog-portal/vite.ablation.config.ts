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

export type ArmName = 'nomemo' | 'novirtual' | 'unstablekey';

const ARMS: Record<ArmName, { virtual: boolean; memo: boolean; stableKey: boolean }> = {
  nomemo: { virtual: true, memo: false, stableKey: true },
  novirtual: { virtual: false, memo: true, stableKey: true },
  unstablekey: { virtual: true, memo: true, stableKey: false },
};

/**
 * Ablation build: the source is untouched, only the compile-time constant flips.
 * `FD_ARM=nomemo node_modules/.bin/vite build -c vite.ablation.config.ts` → dist-nomemo/.
 * Same pipeline, same minifier, same dependency graph, so the only difference in the measured
 * numbers is the clause itself — which is what group N (DOM rows / renders per keystroke) and
 * group G (requests per navigation) are reported from.
 */
const name = (process.env['FD_ARM'] ?? 'nomemo') as ArmName;
if (!(name in ARMS)) {
  throw new Error(`vite.ablation: unknown FD_ARM "${name}" — expected ${Object.keys(ARMS).join('|')}`);
}

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': '"production"',
    __FD_ARM__: JSON.stringify(ARMS[name]),
  },
  resolve: { alias },
  build: {
    target: 'es2020',
    outDir: `dist-${name}`,
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
