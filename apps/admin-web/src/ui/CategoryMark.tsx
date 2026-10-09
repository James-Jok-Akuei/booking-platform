import { ION, type IonName } from './ionicons';

/**
 * A category's colours as the customer app uses them (§133, §252), keyed on
 * the `icon` word an administrator sets; `name` is what its drawing shows
 * (§264, `LineArt`). The small mark below is kept for places too small for a
 * drawing. The
 * colours and glyphs are the customer app's, so what an administrator sees
 * here is what a customer sees on the home screen.
 */
export const CATEGORY_LOOKS: Record<string, { icon: IonName; from: string; to: string; tint: string; ink: string; name: string }> = {
  car: { icon: 'car-sport', from: '#DCE9FF', to: '#B9D2FF', tint: '#EAF1FF', ink: '#2456C7', name: 'Car' },
  sparkles: { icon: 'sparkles', from: '#FFE1EC', to: '#FFC2D6', tint: '#FFECF2', ink: '#D03A6E', name: 'Scissors and comb' },
  'calendar-star': { icon: 'calendar', from: '#EADFFF', to: '#D2BEFF', tint: '#F2EBFF', ink: '#6B3FD4', name: 'Glasses and confetti' },
  'heart-pulse': { icon: 'fitness', from: '#D8F5E6', to: '#B1E9CC', tint: '#E6F8EE', ink: '#0E8A4A', name: 'Heartbeat and sprout' },
  'home-tools': { icon: 'hammer', from: '#FFE9CF', to: '#FFD3A0', tint: '#FFF1DF', ink: '#B5630A', name: 'House and wrench' },
  paw: { icon: 'paw', from: '#FFE4D6', to: '#FFC9AE', tint: '#FFEEE5', ink: '#C4501B', name: 'Cat' },
  camera: { icon: 'camera', from: '#D9F1F7', to: '#B2E1EE', tint: '#E6F6FA', ink: '#0F7C97', name: 'Camera' },
  briefcase: { icon: 'briefcase', from: '#E3E6EE', to: '#C8CEDC', tint: '#EEF0F5', ink: '#3E4A66', name: 'Laptop and coffee' },
};

/** What a category with no mark, or one the apps do not know, looks like. */
export const FALLBACK_LOOK = { icon: 'storefront' as IonName, from: '#FFE6DC', to: '#FFCDB9', tint: '#FFEEE8', ink: '#F0532D', name: 'Shopfront' };

export const categoryLook = (icon: string | null | undefined) => (icon && CATEGORY_LOOKS[icon]) || FALLBACK_LOOK;

export function CategoryMark({ icon, size = 48, className = '' }: { icon: string | null | undefined; size?: number; className?: string }) {
  const look = categoryLook(icon);
  return (
    <span
      className={`category-mark ${className}`}
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
