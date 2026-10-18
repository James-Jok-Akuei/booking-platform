/**
 * Stories as each side sees them (§285).
 */

export class StoryPlaceDto {
  id!: string;
  name!: string;
}

/** One of the shop's own stories, as the seller app shows it. */
export class BusinessStoryDto {
  id!: string;
  imageUrl!: string;
  caption!: string | null;
  /** The branch it is about; null for the whole shop. */
  location!: StoryPlaceDto | null;
  /** Who posted it. */
  postedBy!: string | null;
  views!: number;
  createdAt!: string;
  expiresAt!: string;
  /** Taken down by an administrator, and why. */
  removedAt!: string | null;
  removedReason!: string | null;
}

export class MyStoriesDto {
  /** The last two days', newest first: live ones, and those that ended. */
  stories!: BusinessStoryDto[];
  /** Posted in the last 24 hours, against `dailyLimit`. */
  postedToday!: number;
  dailyLimit!: number;
}

/** One story in the customers' feed. */
export class FeedStoryDto {
  id!: string;
  imageUrl!: string;
  caption!: string | null;
  createdAt!: string;
  expiresAt!: string;
  /** Where its "Book" button leads: its branch, or the shop's first. */
  bookAt!: StoryPlaceDto;
}

export class StoryShopBusinessDto {
  id!: string;
  name!: string;
  logoUrl!: string | null;
}

/** One shop's live stories, in the order they were posted. */
export class StoryShopDto {
  business!: StoryShopBusinessDto;
  stories!: FeedStoryDto[];
}

export class StoryFeedDto {
  /** Shops with a live story, the most recently updated first. */
  shops!: StoryShopDto[];
}

export class StoryReportDto {
  reason!: string;
  createdAt!: string;
}

/** A story as an administrator sees it. */
export class AdminStoryDto {
  id!: string;
  imageUrl!: string;
  caption!: string | null;
  business!: StoryShopBusinessDto;
  location!: StoryPlaceDto | null;
  views!: number;
  createdAt!: string;
  expiresAt!: string;
  removedAt!: string | null;
  removedReason!: string | null;
  reportCount!: number;
  /** The latest few reasons people gave. */
  reports!: StoryReportDto[];
}

export class AdminStoriesDto {
  stories!: AdminStoryDto[];
  /** How many are waiting: reported and still up. */
  reported!: number;
  live!: number;
}
