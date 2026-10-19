/**
 * Browser protections for the three web apps (§298), as one Vite plugin.
 *
 * What it guards against, in plain words:
 * - **Another site showing ours inside a frame** and tricking a click
 *   ("clickjacking"): frame-ancestors 'none' and X-Frame-Options DENY.
 * - **A script slipped into a page** running as us: a Content Security Policy
 *   that lets scripts load only from our own files — no inline script, no
 *   other site's.
 * - **A file read as something it is not**: X-Content-Type-Options nosniff.
 * - **Our addresses leaking to other sites**: a strict Referrer-Policy.
 * - **A connection quietly downgraded from https**: HSTS (Strict-Transport-Security).
 * - **Features the apps never use** (camera, microphone, payment): off.
 *
 * In a build, the policy goes into every page as a <meta> tag — so it holds
 * on any host — and the full set, including what a <meta> cannot carry
 * (frame-ancestors, HSTS), is written to `_headers`, which Netlify and
 * Cloudflare Pages read as they serve the files. Another host is given the
 * same lines in its own settings. In development only the harmless headers
 * are sent: the policy would stop Vite's live reload.
 *
 * `apiUrl` is VITE_API_URL — the backend, when it lives on another address —
 * so the apps may talk to it and to its live socket.
 */
const GOOGLE_FONTS_CSS = 'https://fonts.googleapis.com';
const GOOGLE_FONTS_FILES = 'https://fonts.gstatic.com';

export function contentSecurityPolicy({ apiUrl, selfHostedFonts = false, frames = [] } = {}) {
  const api = apiUrl && /^https?:\/\//.test(apiUrl) ? new URL(apiUrl).origin : null;
  const socket = api ? api.replace(/^http/, 'ws') : null;
  return [
    "default-src 'self'",
    "script-src 'self'",
    // Styles set by the apps' own code, and the font's stylesheet until it is served by us (§299).
    `style-src 'self' 'unsafe-inline'${selfHostedFonts ? '' : ` ${GOOGLE_FONTS_CSS}`}`,
    `font-src 'self' data:${selfHostedFonts ? '' : ` ${GOOGLE_FONTS_FILES}`}`,
    // Photos come from storage on another address, map tiles from the map's.
    // (and from the API itself when it keeps them on its own disk).
    `img-src 'self' data: blob: https:${api ? ` ${api}` : ''}`,
    `media-src 'self' blob: https:${api ? ` ${api}` : ''}`,
    `connect-src 'self'${api ? ` ${api} ${socket}` : ''}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    // Only the map a shop's pin is shown on (the seller app), where it is used at all.
    `frame-src ${frames.length ? frames.join(' ') : "'none'"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

const HARMLESS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), payment=(), usb=(), geolocation=(self)',
};

/** The Vite plugin. `extraFiles` are written into the build next to the pages (security.txt). */
export function webSecurity({ apiUrl, selfHostedFonts = false, frames = [], extraFiles = {} } = {}) {
  const csp = contentSecurityPolicy({ apiUrl, selfHostedFonts, frames });
  const headers = {
    ...HARMLESS,
    'Content-Security-Policy': `${csp}; frame-ancestors 'none'; upgrade-insecure-requests`,
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
  const devHeaders = (_req, res, next) => {
    for (const [name, value] of Object.entries(HARMLESS)) res.setHeader(name, value);
    next();
  };
  return {
    name: 'web-security',
    configureServer(server) {
      server.middlewares.use(devHeaders);
    },
    configurePreviewServer(server) {
      server.middlewares.use(devHeaders);
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        // Only in a build: in development the policy would block Vite's own reload script.
        if (ctx.server) return html;
        return html.replace(
          /<head>/i,
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />\n    <meta name="referrer" content="strict-origin-when-cross-origin" />`,
        );
      },
    },
    generateBundle() {
      const lines = ['/*', ...Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`), ''];
      this.emitFile({ type: 'asset', fileName: '_headers', source: lines.join('\n') });
      for (const [fileName, source] of Object.entries(extraFiles)) {
        this.emitFile({ type: 'asset', fileName, source });
      }
    },
  };
}

/**
 * security.txt (RFC 9116): where someone who finds a weakness tells us,
 * instead of guessing or giving up. `expires` is a year ahead of the build,
 * as the standard asks, so it never claims to be current when it is not.
 */
export function securityTxt({ contact, siteUrl, policyUrl }) {
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  expires.setUTCHours(0, 0, 0, 0);
  return [
    `Contact: mailto:${contact}`,
    `Expires: ${expires.toISOString()}`,
    'Preferred-Languages: en, fr, rw',
    ...(siteUrl ? [`Canonical: ${siteUrl}/.well-known/security.txt`] : []),
    ...(policyUrl ? [`Policy: ${policyUrl}`] : []),
    '',
  ].join('\n');
}
