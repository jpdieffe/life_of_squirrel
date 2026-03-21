import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main:   'index.html',
        editor: 'editor.html',
      },
    },
  },
  // Ensure PeerJS globals are available
  define: {
    global: 'globalThis',
  },
})
