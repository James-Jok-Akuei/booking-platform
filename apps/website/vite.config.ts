import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The public site (§239): the landing page at the root domain.
 *
 * Its own small app, apart from the business app, so the first page a
 * visitor ever sees carries no sign-in code, no data library, nothing but
 * itself — it has to load in a blink on a phone in Kigali. Static files, no
 * server of its own, like the other web apps.
 *
 * `/api` is proxied in development so the live numbers (places taking
 * bookings) come from one origin; in production `VITE_API_URL` names the
 * backend, as in business-web.
 */
export default defineConfig(({ mode }) => {
  // Where the site lives, for the share picture's full address (§273). Unset
  // in development, where nothing reads it, so the tags fall back to "/og.jpg".
  const siteUrl = (loadEnv(mode, process.cwd(), 'VITE_').VITE_SITE_URL ?? '').replace(/\/$/, '');
  return {
    plugins: [
      react(),
      { name: 'site-url', transformIndexHtml: (html: string) => html.replaceAll('%SITE_URL%', siteUrl) },
    ],
    server: {
      port: 5175,
      proxy: {
        '/api': {
          target: 'http://localhost:4100',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  };
});
