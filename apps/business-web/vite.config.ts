import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Static build, no server of its own.
 *
 * The admin app is an internal tool behind a login, so there is nothing for SSR
 * or SEO to buy — and a framework with a server would mean a second thing to
 * deploy and a second place for secrets to live. This compiles to files.
 *
 * `/api` is proxied in development so the browser talks to one origin and CORS
 * never enters the picture locally. In production the app is served from
 * wherever it is deployed and `VITE_API_URL` points at the real backend, which
 * is the point at which `enableCors()` has to be tightened (§4).
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
