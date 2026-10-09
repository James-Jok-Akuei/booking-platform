import type { ReactNode } from 'react';

/**
 * The setup wizard's own icons (§262): duotone — a line drawing over a soft
 * fill of the same colour — so a step reads at a glance and looks drawn for
 * the app rather than taken from a set. All on a 24-unit grid, in
 * `currentColor`, so a badge's colour is the icon's.
 */
const FILL = 0.2;

const GLYPHS = {
  shop: (
    <>
      <path d="M3 9.4 4.7 4.65A1 1 0 0 1 5.64 4h12.72a1 1 0 0 1 .94.65L21 9.4a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0Z" fill="currentColor" fillOpacity={FILL} stroke="none" />
      <path d="M3 9.4 4.7 4.65A1 1 0 0 1 5.64 4h12.72a1 1 0 0 1 .94.65L21 9.4" />
      <path d="M3 9.4a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
      <path d="M5 12.2v7.3A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-7.3" />
      <path d="M10 21v-4.2a2 2 0 0 1 4 0V21" />
    </>
  ),
  branch: (
    <>
      <path d="M12 21.4s-7-6-7-11.4a7 7 0 0 1 14 0c0 5.4-7 11.4-7 11.4Z" fill="currentColor" fillOpacity={FILL} />
      <circle cx="12" cy="10" r="2.6" />
    </>
  ),
  service: (
    <>
      <path
        d="M3 12.2V4.6A1.6 1.6 0 0 1 4.6 3h7.6c.42 0 .83.17 1.13.47l7.2 7.2a1.6 1.6 0 0 1 0 2.26l-7.6 7.6a1.6 1.6 0 0 1-2.26 0l-7.2-7.2A1.6 1.6 0 0 1 3 12.2Z"
        fill="currentColor"
        fillOpacity={FILL}
      />
      <circle cx="7.9" cy="7.9" r="1.5" fill="currentColor" stroke="none" />
      <path d="m10.5 14.5 4-4" />
    </>
  ),
  paid: (
    <>
      <path d="M3.5 7.5v10A2.5 2.5 0 0 0 6 20h12.5a1.5 1.5 0 0 0 1.5-1.5V10a1.5 1.5 0 0 0-1.5-1.5H5.5a2 2 0 0 1-2-1Z" fill="currentColor" fillOpacity={FILL} />
      <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h11a1.5 1.5 0 0 1 1.5 1.5v2" />
      <circle cx="16" cy="14.2" r="1.35" fill="currentColor" stroke="none" />
    </>
  ),
  review: (
    <>
      <path d="M21.5 2.5 14.6 21a.6.6 0 0 1-1.1.05L10.6 13.4 2.95 10.5a.6.6 0 0 1 .05-1.1Z" fill="currentColor" fillOpacity={FILL} />
      <path d="M21.5 2.5 10.6 13.4" />
    </>
  ),
  shield: (
    <>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z" fill="currentColor" fillOpacity={FILL} />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  mail: (
    <>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" fill="currentColor" fillOpacity={FILL} />
      <path d="m3 7 7.94 5.4a1.9 1.9 0 0 0 2.12 0L21 7" />
    </>
  ),
  sparkle: (
    <>
      <path d="M11.02 3.62a1 1 0 0 1 1.96 0l.66 3.5a3 3 0 0 0 2.24 2.24l3.5.66a1 1 0 0 1 0 1.96l-3.5.66a3 3 0 0 0-2.24 2.24l-.66 3.5a1 1 0 0 1-1.96 0l-.66-3.5a3 3 0 0 0-2.24-2.24l-3.5-.66a1 1 0 0 1 0-1.96l3.5-.66a3 3 0 0 0 2.24-2.24Z" fill="currentColor" fillOpacity={FILL} />
      <path d="M19 2.5v3M20.5 4h-3M5 17.5v3M6.5 19h-3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity={FILL} />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  headset: (
    <>
      <path d="M4 13.5v-1a8 8 0 0 1 16 0v1" />
      <rect x="3" y="13" width="4.5" height="6.5" rx="2" fill="currentColor" fillOpacity={FILL} />
      <rect x="16.5" y="13" width="4.5" height="6.5" rx="2" fill="currentColor" fillOpacity={FILL} />
      <path d="M19 19.5c0 1.4-1.6 2-4 2h-1.5" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type GlyphName = keyof typeof GLYPHS;

export function StepGlyph({ name, size = 22, stroke = 1.75 }: { name: GlyphName; size?: number; stroke?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name]}
    </svg>
  );
}

/** A tick that draws itself when it appears. */
export function DrawnCheck({ size = 18, stroke = 2.8 }: { size?: number; stroke?: number }) {
  return (
    <svg className="drawn-check" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M5 12.5l4.4 4.4L19 7.4" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
    </svg>
  );
}
