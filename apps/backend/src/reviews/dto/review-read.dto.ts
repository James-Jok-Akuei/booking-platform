import { ApiProperty } from '@nestjs/swagger';

/**
 * Who wrote a review — the THIRD response in this API whose shape depends on
 * the viewer (§112.1, §128.29, §128.34).
 *
 * `displayName` is always present and never null: a review with no attribution
 * at all is what the platform showed before §31, and it read as broken. A
 * customer who set no name is shown as "Anonymous" — rendered here, never
 * stored.
 *
 * `customer` carries the identity, and is present ONLY for a viewer entitled to
 * it: the counterparty business and administrators. An anonymous reader gets
 * the byline and nothing else. The nested object is always REBUILT rather than
 * passed through, so a field somebody later adds to the shared select cannot
 * leak through this route.
 */
export class ReviewAuthorDto {
  id!: string;
  email!: string;
}

export class ReviewDto {
  id!: string;
  rating!: number;
  comment!: string | null;
  /** Null until edited. An edited review says so rather than changing silently. */
  editedAt!: string | null;

  /** The business's public reply, if it has made one. */
  responseText!: string | null;
  responseAt!: string | null;
  responseEditedAt!: string | null;

  createdAt!: string;
  locationId!: string;
  businessId!: string;

  /** The byline. "Anonymous" when no name is set — never null. */
  displayName!: string;

  /** Present for the counterparty business and administrators only. */
  @ApiProperty({ required: false, type: () => ReviewAuthorDto })
  customer?: ReviewAuthorDto;
}

/**
 * A location's reviews, with its rating.
 *
 * `ratingAvg` and `ratingCount` come straight from the denormalised columns —
 * never an `AVG()` on a read path (§30.2).
 */
export class LocationReviewsDto {
  locationId!: string;
  /** Null when nothing has been reviewed yet. Not zero: zero is a rating. */
  ratingAvg!: number | null;
  ratingCount!: number;

  total!: number;
  limit!: number;
  offset!: number;
  reviews!: ReviewDto[];
}

// ---------------------------------------------------------------------------
// Moderation (§128.34)
// ---------------------------------------------------------------------------

/**
 * A review as a MODERATOR reads it — flattened, and with the identity always
 * present.
 *
 * Deliberately not `ReviewDto`: this view exists to answer "who wrote this,
 * about which branch of which business, and who hid it", so the names are
 * lifted out of their relations and put beside each other. A console that had
 * to walk three nested objects to draw one row would be drawing it wrong.
 */
export class AdminReviewDto {
  id!: string;
  rating!: number;
  comment!: string | null;
  editedAt!: string | null;

  responseText!: string | null;
  responseAt!: string | null;
  createdAt!: string;

  /** Null when visible. Set together with the reason, never alone. */
  hiddenAt!: string | null;
  hiddenReason!: string | null;
  /** Which administrator hid it. Null when it is visible. */
  hiddenByEmail!: string | null;

  locationId!: string;
  locationName!: string;
  businessId!: string;
  businessName!: string | null;

  customerId!: string;
  customerEmail!: string;
  /** "Anonymous" when no name is set — never null. */
  displayName!: string;
}

export class AdminReviewPageDto {
  total!: number;
  limit!: number;
  offset!: number;
  /** Across the whole platform, not this page — the number worth watching. */
  hiddenCount!: number;
  reviews!: AdminReviewDto[];
}
