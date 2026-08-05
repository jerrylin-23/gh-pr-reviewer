/** Builds the Electron main process bundle (ESM, Node target). */
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist-electron',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    lib: {
      entry: 'electron/main.ts',
      formats: ['es'],
      fileName: () => 'main.js',
    },
    rollupOptions: {
      external: ['electron', /^node:/],
    },
  },
});
