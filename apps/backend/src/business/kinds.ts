/**
 * Every kind of place a business is (§265), the main one first — selected the
 * same way wherever a business is shown, so the profile, discovery, the
 * shopfront and saved services all hand the apps one shape.
 */
export const KINDS_SELECT = {
  orderBy: { position: 'asc' as const },
  select: {
    category: { select: { id: true, name: true, icon: true } },
    subcategory: { select: { id: true, name: true } },
  },
};
