import { MediaStatus, MediaType, Prisma } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { NoExtraFields, Serialised } from '../../common/serialised';
import { BusinessServiceDto } from './business-response.dto';

// ---------------------------------------------------------------------------
// Service drafts (§123)
// ---------------------------------------------------------------------------

/** One select, shared with the DTO describing its result (§128.5). */
export const SERVICE_DRAFT_SELECT = {
  id: true,
  name: true,
  description: true,
  durationMinutes: true,
  depositPercentage: true,
  offers: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, email: true } },
} as const satisfies Prisma.ServiceDraftSelect;

type ServiceDraftRow = Serialised<
  Prisma.ServiceDraftGetPayload<{ select: typeof SERVICE_DRAFT_SELECT }>
>;

export class ServiceDraftAuthorDto {
  id!: string;
  email!: string;
}

export class ServiceDraftOfferDto {
  locationId!: string;
  priceMinor!: number;
}

/**
 * A service somebody started and has not finished.
 *
 * EVERY FIELD IS NULLABLE except the identifiers, and deliberately so: a draft
 * exists BECAUSE it is incomplete. Nothing here is validated — the service
 * rules apply when it is turned into a real service, which is a separate act.
 */
export class ServiceDraftDto implements ServiceDraftRow {
  id!: string;
  name!: string | null;
  description!: string | null;
  durationMinutes!: number | null;
  /** A decimal string, like every other percentage here (§128.20). */
  depositPercentage!: string | null;

  /**
   * Stored as JSON rather than rows, because a half-filled price list has no
   * referential integrity to keep: a draft may name a branch that is closed by
   * the time anybody finishes it.
   */
  @ApiProperty({ type: () => [ServiceDraftOfferDto] })
  offers!: Prisma.JsonValue;

  createdBy!: ServiceDraftAuthorDto;
  createdAt!: string;
  updatedAt!: string;
}

export const __serviceDraftDtoIsExact: NoExtraFields<
  ServiceDraftDto,
  ServiceDraftRow
> = true;

// ---------------------------------------------------------------------------
// Gallery (§88)
// ---------------------------------------------------------------------------

type LocationMediaRow = Serialised<Prisma.LocationMediaGetPayload<object>>;

/**
 * One photo, as its OWNER sees it.
 *
 * `status` is on the row because this is the management view: the owner sees
 * PENDING and REJECTED photos too. Customer-facing endpoints filter to
 * APPROVED, which is why the field has to be published rather than assumed.
 */
export class GalleryPhotoDto implements LocationMediaRow {
  id!: string;
  locationId!: string;
  type!: MediaType;
  url!: string;
  status!: MediaStatus;
  displayOrder!: number;
  createdAt!: string;
}

export const __galleryPhotoDtoIsExact: NoExtraFields<
  GalleryPhotoDto,
  LocationMediaRow
> = true;

/** The gallery, with the room left in it — so a screen can disable its own button. */
export class GalleryDto {
  photos!: GalleryPhotoDto[];
  count!: number;
  limit!: number;
  remaining!: number;
}

// ---------------------------------------------------------------------------
// Narrow answers to narrow changes
// ---------------------------------------------------------------------------

/**
 * What changing capacity answers with.
 *
 * Its OWN shape, not a whole location (§128.25). The business app typed this as
 * a full `Location`, which promised hours, a district and a media count that
 * this response has never carried.
 */
export class LocationCapacityDto {
  id!: string;
  name!: string;
  capacity!: number;
  updatedAt!: string;
}

/** Whether the shop is taking new bookings (§119.3). */
export class BusinessPauseStateDto {
  id!: string;
  name!: string | null;
  /** Null when open. Set when paused — bookings already made still happen. */
  pausedAt!: string | null;
}

// ---------------------------------------------------------------------------
// Services going on and off sale
// ---------------------------------------------------------------------------

type ServiceRow = Serialised<Prisma.ServiceGetPayload<object>>;

/** The bare service row, with no branches joined — what retiring one answers. */
export class ServiceDto implements ServiceRow {
  id!: string;
  businessId!: string;
  name!: string;
  description!: string | null;
  durationMinutes!: number;
  currency!: string;
  /** A decimal string (§128.20). */
  depositPercentage!: string;
  /** False once retired. The row is kept so past appointments still resolve. */
  isActive!: boolean;
  createdAt!: string;
  updatedAt!: string;
}

export const __serviceDtoIsExact: NoExtraFields<ServiceDto, ServiceRow> = true;

export class DeactivatedServiceDto {
  message!: string;
  service!: ServiceDto;
}

/**
 * Turning a service on or off, at one branch or everywhere.
 *
 * `offeredAtCount` is the point: pausing the LAST branch means nobody can book
 * the service at all, and the message says so. A screen that showed only
 * `isOffered` could not tell the two cases apart.
 */
export class ServiceOfferedResultDto {
  message!: string;
  isOffered!: boolean;
  offeredAtCount!: number;
  service!: BusinessServiceDto;
}
