/**
 * Saved places, as the list screen reads them (§120).
 *
 * Built rather than selected — `bookable` collapses three separate reasons a
 * customer cannot book into one field, because to them they mean the same thing
 * and two of the three are nobody's business. So the service declares this as
 * its return type (§128.4).
 */
export class SavedPlaceDistrictDto {
  id!: string;
  name!: string;
  provinceName!: string;
}

export class SavedPlaceBusinessDto {
  id!: string;
  name!: string | null;
  logoUrl!: string | null;
}

export class SavedPlaceDto {
  savedAt!: string;
  id!: string;
  name!: string;
  address!: string;
  ratingAvg!: number | null;
  ratingCount!: number;
  fromPriceMinor!: number | null;
  district!: SavedPlaceDistrictDto | null;
  business!: SavedPlaceBusinessDto;
  /**
   * Whether it can be booked right now. ONE field, not three: the branch
   * closing, the shop pausing and approval going are the same thing to a
   * customer (§120.1).
   */
  bookable!: boolean;
}

export class SavedPlacePageDto {
  total!: number;
  favourites!: SavedPlaceDto[];
}

/** What saving or unsaving answers with. */
export class FavouriteStateDto {
  locationId!: string;
  saved!: boolean;
}
