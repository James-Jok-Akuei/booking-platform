import { Icon } from './Icon';

/**
 * Five stars for a rating, with halves (§192) — 3.5 is three and a half, not
 * four. The half is a filled star clipped to its left side, laid over an
 * empty one.
 */
export function Stars({ value, size = 15 }: { value: number; size?: number }) {
  const rounded = Math.round(value * 2) / 2;
  return (
    <span className="stars" aria-label={`${value.toFixed(1)} out of 5`} role="img">
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = rounded >= n ? 1 : rounded >= n - 0.5 ? 0.5 : 0;
        return (
          <span key={n} className="star" style={{ width: size, height: size }}>
            <Icon name="star" size={size} stroke={1.6} />
            {fill > 0 && (
              <span className="star-fill" style={{ width: `${fill * 100}%` }}>
                <Icon name="star" size={size} stroke={1.6} filled />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}
