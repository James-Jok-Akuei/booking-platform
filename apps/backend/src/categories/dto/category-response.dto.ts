import { Prisma } from '@prisma/client';
import { NoExtraFields, Serialised } from '../../common/serialised';

/** One select, shared with the DTO describing its result (§128.5). */
export const PUBLIC_CATEGORY_SELECT = {
  id: true,
  name: true,
  icon: true,
  description: true,
  subcategories: {
    where: { isLive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  },
} as const satisfies Prisma.CategorySelect;

type PublicCategoryRow = Serialised<
  Prisma.CategoryGetPayload<{ select: typeof PUBLIC_CATEGORY_SELECT }>
>;

export class SubcategoryDto {
  id!: string;
  name!: string;
}

/**
 * A category a business may choose (§98).
 *
 * Only live ones, and only their live types. `isLive` is NOT published here:
 * everything in this list is live by construction, so a field saying so would
 * invite a client to filter again on something always true.
 *
 * Discovery is deliberately NOT filtered this way — a shop already in a
 * category that was switched off keeps its listing, because it did not make
 * that decision.
 */
export class CategoryDto implements PublicCategoryRow {
  id!: string;
  name!: string;
  /** An icon key or emoji for the apps. Never a URL. */
  icon!: string | null;
  description!: string | null;
  subcategories!: SubcategoryDto[];
}

export const __categoryDtoIsExact: NoExtraFields<CategoryDto, PublicCategoryRow> = true;

// ---------------------------------------------------------------------------
// The admin view (§128.33)
// ---------------------------------------------------------------------------

export class AdminSubcategoryDto {
  id!: string;
  name!: string;
  isLive!: boolean;
  /** Businesses already in it. Shown before anything is switched off. */
  businessCount!: number;

  /**
   * `isLive` ANDed with the parent's.
   *
   * Published rather than left for a client to work out, because a live type
   * under a hidden category is not reachable, and a console that showed it as
   * "on" would be telling an administrator the opposite of the truth (§100).
   */
  effectivelyLive!: boolean;
}

export class AdminCategoryDto {
  id!: string;
  name!: string;
  icon!: string | null;
  description!: string | null;
  isLive!: boolean;
  businessCount!: number;
  subcategories!: AdminSubcategoryDto[];
}

/** The bare row, as creating or renaming one answers. */
export class CategoryRecordDto {
  id!: string;
  name!: string;
  icon!: string | null;
  description!: string | null;
  isLive!: boolean;
}

export class SubcategoryRecordDto {
  id!: string;
  categoryId!: string;
  name!: string;
  isLive!: boolean;
}
