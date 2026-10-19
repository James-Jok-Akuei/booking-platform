import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
// Browser protections — framing, scripts, sniffing, referrers (§298).
import { webSecurity } from '../../scripts/web-security.mjs';

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
export default defineConfig(({ mode }) => ({
  plugins: [react(), webSecurity({ apiUrl: loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL, selfHostedFonts: true })],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4100',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // The live bell's socket (§287): socket.io's handshake is at a fixed
      // path, so it cannot go through `/api`.
      '/socket.io': {
        target: 'http://localhost:4100',
        changeOrigin: true,
        ws: true,
      },
    },
  },
}));
