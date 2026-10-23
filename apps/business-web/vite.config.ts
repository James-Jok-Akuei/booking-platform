import { networkInterfaces } from 'node:os';
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
/**
 * This computer's address on the Wi-Fi, for the app QR code while developing
 * (§309): a phone scanning it opens the customer app in Expo Go, as the
 * terminal's QR does. Read when the dev server starts, so a new address is
 * picked up by itself; private addresses only, Wi-Fi (en0) first.
 */
function wifiAddress(): string | null {
  const all = Object.entries(networkInterfaces()).flatMap(([name, list]) => (list ?? []).map((a) => ({ name, ...a })));
  const usable = all.filter((a) => a.family === 'IPv4' && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address));
  return (usable.find((a) => a.name === 'en0') ?? usable[0])?.address ?? null;
}

export default defineConfig(({ mode, command }) => ({
  define: { __WIFI_ADDRESS__: JSON.stringify(command === 'serve' ? wifiAddress() : null) },
  // Every sentence goes through the translations (§308).
  plugins: [react({ babel: { plugins: ['@lingui/babel-plugin-lingui-macro'] } }), webSecurity({ apiUrl: loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL, selfHostedFonts: true, frames: ['https://www.openstreetmap.org'] })],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:4100',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // Chat's websocket, which cannot go through `/api`: that rule rewrites
      // the path away, and socket.io serves its handshake at a fixed
      // `/socket.io` regardless of namespace. `ws: true` is what makes the
      // proxy upgrade the connection rather than answer the poll and stop.
      '/socket.io': {
        target: 'http://localhost:4100',
        changeOrigin: true,
        ws: true,
      },
    },
  },
}));
