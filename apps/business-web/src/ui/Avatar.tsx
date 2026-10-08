/**
 * A round picture, or a person's initials on a soft colour of their own (§190).
 *
 * Customers reach a business as an email address only, so most avatars here
 * are initials. The colour comes from the text, so the same customer is the
 * same colour on every screen and in every visit — something to recognise
 * them by before the name is read.
 */
const TINTS = [
  ['#FFE6DC', '#C2410C'],
  ['#E3EEFF', '#2456C7'],
  ['#E5F6EC', '#0E7A43'],
  ['#FFF1D6', '#A35F00'],
  ['#F1E8FF', '#6D3FC9'],
  ['#E1F5F5', '#0F766E'],
  ['#FDE7F1', '#BE185D'],
  ['#ECEEF2', '#3F4652'],
] as const;

const hash = (text: string) => {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
};

/** "demo-deng@example.com" → "DD"; "Kigali Barbers" → "KB". */
export const initialsOf = (text: string) => {
  const name = text.includes('@') ? text.split('@')[0] : text;
  const parts = name
    .replace(/[._\-+]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export function Avatar({
  label,
  src,
  size = 36,
  className = '',
}: {
  /** An email or a name: what the initials and the colour are made from. */
  label: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const [bg, fg] = TINTS[hash(label.toLowerCase()) % TINTS.length];
  return (
    <span
      className={`avatar ${className}`}
      style={{
        width: size,
        height: size,
        background: src ? undefined : bg,
        color: fg,
        fontSize: Math.max(10, Math.round(size * 0.36)),
      }}
      title={label}
      aria-hidden="true"
    >
      {src ? <img src={src} alt="" /> : initialsOf(label)}
    </span>
  );
}
