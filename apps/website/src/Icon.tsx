import type { ReactNode } from 'react';

/** The few line icons this site needs, drawn as the apps' are (§190). */
const PATHS = {
  play: <path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z" />,
  phone: (
    <>
      <rect width="13" height="20" x="5.5" y="2" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </>
  ),
  store: (
    <>
      <path d="M3 9.5 4.6 4.6A1 1 0 0 1 5.6 4h12.8a1 1 0 0 1 1 .6L21 9.5" />
      <path d="M3 9.5a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
      <path d="M5 12v8h14v-8M10 20v-5h4v5" />
    </>
  ),
  message: <path d="M21 12a8 8 0 0 1-11.6 7.2L4 21l1.8-5.4A8 8 0 1 1 21 12z" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  banknote: (
    <>
      <rect width="20" height="12" x="2" y="6" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </>
  ),
  ticket: (
    <>
      <path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-6z" />
      <path d="M13 5v2M13 11v2M13 17v2" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, stroke = 1.8, filled = false }: { name: IconName; size?: number; stroke?: number; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
