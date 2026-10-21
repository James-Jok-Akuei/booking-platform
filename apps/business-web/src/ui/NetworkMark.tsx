import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
/**
 * The mobile money network a number belongs to, as its own mark (§219) — the
 * MTN oval on MTN yellow, Airtel's wordmark on Airtel red — so a seller sees
 * at a glance where their money goes, the way a card shows its Visa logo.
 * They identify the network the money moves through and nothing more.
 *
 * Drawn as vectors from the networks' published flat logos, so they are sharp
 * at every size and need no file.
 */
export type Network = 'MTN_MOMO' | 'AIRTEL_MONEY';

export const NETWORK_NAME: Record<Network, string> = {
  get MTN_MOMO() { return t`MTN MoMo`; },
  get AIRTEL_MONEY() { return t`Airtel Money`; },
};

/**
 * The network a number most likely belongs to, by its prefix — the same table
 * as the server's `operator-routing.ts` (§58.1): Rwanda's 078/079 are MTN,
 * 072/073 Airtel. Unknown numbers return null rather than a guess.
 */
export function networkOf(number: string): Network | null {
  const digits = number.replace(/\D/g, '');
  const national = digits.startsWith('250') ? digits.slice(3) : digits.startsWith('0') ? digits.slice(1) : null;
  if (!national || national.length < 2) return null;
  const prefix = national.slice(0, 2);
  if (prefix === '78' || prefix === '79') return 'MTN_MOMO';
  if (prefix === '72' || prefix === '73') return 'AIRTEL_MONEY';
  return null;
}

export function NetworkMark({
  network,
  size = 40,
  shape = 'square',
  className = '',
}: {
  network: Network;
  /** Height in pixels; a wide mark is 1.6 times as wide. */
  size?: number;
  shape?: 'square' | 'wide';
  className?: string;
}) {
  const wide = shape === 'wide';
  const w = wide ? 64 : 48;
  const h = wide ? 40 : 48;
  const name = NETWORK_NAME[network];
  return (
    <svg
      className={`network-mark ${className}`}
      width={wide ? Math.round(size * 1.6) : size}
      height={size}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={name}
    >
      <title>{name}</title>
      {network === 'MTN_MOMO' ? (
        <>
          <rect width={w} height={h} rx={wide ? 9 : 12} fill="#FFCB05" />
          <ellipse
            cx={w / 2}
            cy={h / 2}
            rx={wide ? 25 : 18.5}
            ry={wide ? 13.5 : 11.5}
            fill="none"
            stroke="#000"
            strokeWidth={wide ? 2.8 : 2.5}
          />
          <text
            x={w / 2}
            y={h / 2 + (wide ? 4.6 : 3.9)}
            textAnchor="middle"
            fontFamily="'Plus Jakarta Sans', Arial, sans-serif"
            fontWeight={800}
            fontSize={wide ? 13 : 11}
            letterSpacing={0.2}
            fill="#000"
          >
            <Trans>MTN</Trans>
          </text>
        </>
      ) : (
        <>
          <rect width={w} height={h} rx={wide ? 9 : 12} fill="#E40000" />
          <text
            x={w / 2}
            y={h / 2 + (wide ? 5 : 4.2)}
            textAnchor="middle"
            fontFamily="'Plus Jakarta Sans', Arial, sans-serif"
            fontWeight={800}
            fontSize={wide ? 15 : 12}
            letterSpacing={-0.3}
            fill="#fff"
          >
            <Trans>airtel</Trans>
          </text>
        </>
      )}
    </svg>
  );
}
