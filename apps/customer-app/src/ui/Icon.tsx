import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';

export type IconName = keyof typeof Ionicons.glyphMap;

/** One icon family for the whole app, so nothing looks borrowed. */
export function Icon({
  name,
  size = 20,
  color = theme.ink,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return <Ionicons name={name} size={size} color={color} />;
}

/**
 * A picture and a colour for each category (§133).
 *
 * Keyed on the `icon` an administrator sets, which is a word and not a file.
 * Each gets its own pair of colours as well, because nothing ships an image per
 * category or guarantees a shop has uploaded a photo — and a card with no
 * picture should look deliberate, not empty. A salon with no cover is a soft
 * rose tile with a sparkle on it, never a grey box.
 */
const LOOKS: Record<string, { icon: IconName; from: string; to: string; tint: string; ink: string }> = {
  car: { icon: 'car-sport', from: '#DCE9FF', to: '#B9D2FF', tint: '#EAF1FF', ink: '#2456C7' },
  sparkles: { icon: 'sparkles', from: '#FFE1EC', to: '#FFC2D6', tint: '#FFECF2', ink: '#D03A6E' },
  'calendar-star': { icon: 'calendar', from: '#EADFFF', to: '#D2BEFF', tint: '#F2EBFF', ink: '#6B3FD4' },
  'heart-pulse': { icon: 'fitness', from: '#D8F5E6', to: '#B1E9CC', tint: '#E6F8EE', ink: '#0E8A4A' },
  'home-tools': { icon: 'hammer', from: '#FFE9CF', to: '#FFD3A0', tint: '#FFF1DF', ink: '#B5630A' },
  paw: { icon: 'paw', from: '#FFE4D6', to: '#FFC9AE', tint: '#FFEEE5', ink: '#C4501B' },
  camera: { icon: 'camera', from: '#D9F1F7', to: '#B2E1EE', tint: '#E6F6FA', ink: '#0F7C97' },
  briefcase: { icon: 'briefcase', from: '#E3E6EE', to: '#C8CEDC', tint: '#EEF0F5', ink: '#3E4A66' },
  utensils: { icon: 'restaurant', from: '#FFECD2', to: '#FFD9A8', tint: '#FFF4E4', ink: '#B8620B' },
  ticket: { icon: 'ticket', from: '#FFF2C7', to: '#FFE08A', tint: '#FFF8DF', ink: '#9A6B00' },
  people: { icon: 'people', from: '#D7F5EC', to: '#B3EAD9', tint: '#E7F8F2', ink: '#0F7F63' },
  dumbbell: { icon: 'barbell', from: '#DCEFFF', to: '#B8DCFF', tint: '#EAF5FF', ink: '#1D6FB8' },
  stethoscope: { icon: 'medkit', from: '#FFE1DE', to: '#FFC4BE', tint: '#FFEDEB', ink: '#C2392B' },
  bed: { icon: 'bed', from: '#EFE4FF', to: '#DCC8FF', tint: '#F5EEFF', ink: '#7445C9' },
  mountain: { icon: 'trail-sign', from: '#E0F2D6', to: '#C4E5B2', tint: '#ECF7E6', ink: '#3F7A28' },
  shirt: { icon: 'shirt', from: '#FCE1F3', to: '#F5C3E6', tint: '#FDEEF8', ink: '#B03A86' },
};

const FALLBACK = {
  icon: 'storefront' as IconName,
  from: '#FFE6DC',
  to: '#FFCDB9',
  tint: theme.accentSoft,
  ink: theme.accent,
};

export const lookFor = (icon: string | null | undefined) =>
  (icon && LOOKS[icon]) || FALLBACK;
