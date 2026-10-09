import { ION, type IonName } from '../shopfront/ionicons';

/**
 * A category as the customer app draws it (§133): its own pair of colours and
 * its Ionicons mark, keyed on the `icon` word an administrator sets. The same
 * table the shopfront preview (§208) and the console (§252) use, so a seller
 * choosing what kind of shop they are sees the tile customers will.
 */
const LOOKS: Record<string, { icon: IonName; from: string; to: string; ink: string }> = {
  car: { icon: 'car-sport', from: '#DCE9FF', to: '#B9D2FF', ink: '#2456C7' },
  sparkles: { icon: 'sparkles', from: '#FFE1EC', to: '#FFC2D6', ink: '#D03A6E' },
  'calendar-star': { icon: 'calendar', from: '#EADFFF', to: '#D2BEFF', ink: '#6B3FD4' },
  'heart-pulse': { icon: 'fitness', from: '#D8F5E6', to: '#B1E9CC', ink: '#0E8A4A' },
  'home-tools': { icon: 'hammer', from: '#FFE9CF', to: '#FFD3A0', ink: '#B5630A' },
  paw: { icon: 'paw', from: '#FFE4D6', to: '#FFC9AE', ink: '#C4501B' },
  camera: { icon: 'camera', from: '#D9F1F7', to: '#B2E1EE', ink: '#0F7C97' },
  briefcase: { icon: 'briefcase', from: '#E3E6EE', to: '#C8CEDC', ink: '#3E4A66' },
};
const FALLBACK = { icon: 'storefront' as IonName, from: '#FFE6DC', to: '#FFCDB9', ink: '#F0532D' };

export function CategoryMark({ icon, size = 44 }: { icon: string | null | undefined; size?: number }) {
  const look = (icon && LOOKS[icon]) || FALLBACK;
  return (
    <span
      className="category-mark"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.32),
        background: `linear-gradient(145deg, ${look.from}, ${look.to})`,
      }}
      aria-hidden="true"
    >
      <svg width={Math.round(size * 0.56)} height={Math.round(size * 0.56)} viewBox="0 6.5 512 512" fill={look.ink}>
        <path d={ION[look.icon]} />
      </svg>
    </span>
  );
}
