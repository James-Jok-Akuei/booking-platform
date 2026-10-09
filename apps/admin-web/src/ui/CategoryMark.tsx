/**
 * Each category's colours as the customer app uses them (§133, §252), keyed
 * on the `icon` word an administrator sets, and `name` — what its fine-line
 * drawing shows (§264, §266; the drawing itself is `LineArt`). In the order
 * the drawing picker offers them, the general shop first.
 */
export const CATEGORY_LOOKS: Record<string, { from: string; to: string; tint: string; ink: string; name: string }> = {
  store: { from: '#FFE6DC', to: '#FFCDB9', tint: '#FFEEE8', ink: '#F0532D', name: 'General shop' },
  sparkles: { from: '#FFE1EC', to: '#FFC2D6', tint: '#FFECF2', ink: '#D03A6E', name: 'Scissors and comb' },
  'heart-pulse': { from: '#D8F5E6', to: '#B1E9CC', tint: '#E6F8EE', ink: '#0E8A4A', name: 'Heartbeat and sprout' },
  stethoscope: { from: '#FFE1DE', to: '#FFC4BE', tint: '#FFEDEB', ink: '#C2392B', name: 'Cross and stethoscope' },
  dumbbell: { from: '#DCEFFF', to: '#B8DCFF', tint: '#EAF5FF', ink: '#1D6FB8', name: 'Dumbbell and ball' },
  utensils: { from: '#FFECD2', to: '#FFD9A8', tint: '#FFF4E4', ink: '#B8620B', name: 'Plate and cutlery' },
  ticket: { from: '#FFF2C7', to: '#FFE08A', tint: '#FFF8DF', ink: '#9A6B00', name: 'Ticket and popcorn' },
  people: { from: '#D7F5EC', to: '#B3EAD9', tint: '#E7F8F2', ink: '#0F7F63', name: 'A group, arms up' },
  mountain: { from: '#E0F2D6', to: '#C4E5B2', tint: '#ECF7E6', ink: '#3F7A28', name: 'Mountains and flag' },
  bed: { from: '#EFE4FF', to: '#DCC8FF', tint: '#F5EEFF', ink: '#7445C9', name: 'Bed and moon' },
  briefcase: { from: '#E3E6EE', to: '#C8CEDC', tint: '#EEF0F5', ink: '#3E4A66', name: 'Laptop and coffee' },
  car: { from: '#DCE9FF', to: '#B9D2FF', tint: '#EAF1FF', ink: '#2456C7', name: 'Car' },
  shirt: { from: '#FCE1F3', to: '#F5C3E6', tint: '#FDEEF8', ink: '#B03A86', name: 'Shirt and tape measure' },
  'home-tools': { from: '#FFE9CF', to: '#FFD3A0', tint: '#FFF1DF', ink: '#B5630A', name: 'House and wrench' },
  paw: { from: '#FFE4D6', to: '#FFC9AE', tint: '#FFEEE5', ink: '#C4501B', name: 'Cat' },
  camera: { from: '#D9F1F7', to: '#B2E1EE', tint: '#E6F6FA', ink: '#0F7C97', name: 'Camera' },
  'calendar-star': { from: '#EADFFF', to: '#D2BEFF', tint: '#F2EBFF', ink: '#6B3FD4', name: 'Glasses and confetti' },
};

/** What a category with no drawing, or one the apps do not know, looks like: a general shop. */
export const FALLBACK_LOOK = CATEGORY_LOOKS.store;

export const categoryLook = (icon: string | null | undefined) => (icon && CATEGORY_LOOKS[icon]) || FALLBACK_LOOK;
