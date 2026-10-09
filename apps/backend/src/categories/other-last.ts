/**
 * Types in alphabetical order, with "Other" last (§266): every category ends
 * with an "Other" for a business that fits no named type, and alphabetically
 * it would sit in the middle of the list — "Dine-in, Other, Pick-up".
 */
export const otherLast = <T extends { name: string }>(types: T[]): T[] => [
  ...types.filter((t) => t.name !== 'Other'),
  ...types.filter((t) => t.name === 'Other'),
];
