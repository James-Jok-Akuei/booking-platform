/**
 * The mark (§239): a white tile with a "b" for Bwangu and a check for a
 * reservation made — the dark of the ink, the orange of the brand. Drawn,
 * so it is sharp at every size and needs no file.
 */
export function Logo({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 136 136" aria-hidden="true" focusable="false">
      <rect width="136" height="136" rx="32" fill="#ffffff" />
      <g transform="translate(20 20) scale(0.8)" fill="none" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M30 18 C28 40 27 62 29 88 C31 100 40 106 50 104 C66 100 74 86 70 70 C66 58 50 54 36 64" stroke="#1f2a1f" />
        <path d="M72 70 L82 82 L106 46" stroke="#fd7511" />
      </g>
    </svg>
  );
}

/** The name, as it is written: one word, the second half in the brand's orange. */
export function Wordmark() {
  return (
    <span className="wordmark">
      Bwangu<b>Reservations</b>
    </span>
  );
}
