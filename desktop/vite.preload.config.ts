/**
 * Builds the preload bundle.
 *
 * A sandboxed preload must be CommonJS, so this emits `preload.cjs` and never
 * clears the output directory the main bundle already wrote to.
 */
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist-electron',
    emptyOutDir: false,
    target: 'node20',
    minify: false,
    lib: {
      entry: 'electron/preload.ts',
      formats: ['cjs'],
      fileName: () => 'preload.cjs',
    },
    rollupOptions: {
      external: ['electron', /^node:/],
    },
  },
});
