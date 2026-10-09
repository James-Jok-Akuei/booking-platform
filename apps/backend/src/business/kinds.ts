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
    // What the business wrote, for a kind that is "Other" (§267).
    otherLabel: true,
  },
};

/** "Other", the type every category ends with (§266). */
export const OTHER = 'Other';

/** A write-in, tidied: trimmed, inner spaces single. */
export const tidyLabel = (label: string) => label.trim().replace(/\s+/g, ' ');
