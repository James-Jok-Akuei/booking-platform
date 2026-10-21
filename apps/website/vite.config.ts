import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
// Browser protections, and where to report a weakness (§298).
import { securityTxt, webSecurity } from '../../scripts/web-security.mjs';
// A page per language, for search (§308.7).
import { languagePages } from './plugins/language-pages';

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
  const vite = loadEnv(mode, process.cwd(), 'VITE_');
  const siteUrl = (vite.VITE_SITE_URL ?? '').replace(/\/$/, '');
  // The address people already write to (links.ts), for a weakness too.
  const contact = vite.VITE_SECURITY_EMAIL || vite.VITE_CONTACT_EMAIL || 'jokditakeerleek@gmail.com';
  return {
    plugins: [
      // Every sentence through Lingui (§308).
      react({ babel: { plugins: ['@lingui/babel-plugin-lingui-macro'] } }),
      { name: 'site-url', transformIndexHtml: (html: string) => html.replaceAll('%SITE_URL%', siteUrl) },
      languagePages(siteUrl),
      webSecurity({
        apiUrl: vite.VITE_API_URL,
        selfHostedFonts: true,
        extraFiles: { '.well-known/security.txt': securityTxt({ contact, siteUrl }) },
      }),
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
