import { defineConfig } from 'vite';
import { resolve } from 'path';

// VITE_ADMIN_TOKEN is read at build time. Set it in the deploy workflow via
// the same Wrangler secret that the API validates against — Vite embeds the
// value as a compile-time string in the bundle. In dev (no VITE_ADMIN_TOKEN),
// adminFetch omits the Authorization header and the API's dev-bypass path
// accepts the request.
const ADMIN_TOKEN = process.env.VITE_ADMIN_TOKEN || '';

export default defineConfig({
  define: {
    __ADMIN_TOKEN__: JSON.stringify(ADMIN_TOKEN),
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        investor: resolve(__dirname, 'investor.html'),
      },
    },
  },
});
