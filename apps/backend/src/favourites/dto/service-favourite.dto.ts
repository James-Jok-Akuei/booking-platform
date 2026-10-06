import { IsUUID } from 'class-validator';
import { DiscoveredServiceDto } from '../../discovery/dto/discovery-response.dto';

export class SaveServiceFavouriteDto {
  @IsUUID()
  serviceId!: string;

  /** The branch it was saved at: the same service costs differently per branch. */
  @IsUUID()
  locationId!: string;
}

export class ServiceFavouriteStateDto {
  serviceId!: string;
  locationId!: string;
  saved!: boolean;
}

/** A saved service: the same card the home screen shows, plus when and whether it can be booked. */
export class SavedServiceDto extends DiscoveredServiceDto {
  savedAt!: string;
  /**
   * False while the branch is closed, the business paused or not approved, or
   * the service paused at this branch — all temporary, all kept and marked
   * (§120). A service RETIRED by the business is not kept at all: see
   * `SavedServicePageDto.removed`.
   */
  bookable!: boolean;
}

export class SavedServicePageDto {
  total!: number;
  services!: SavedServiceDto[];
  /**
   * How many saved services were found to be gone for good on this read —
   * retired by the business, or no longer sold at that branch at all — and
   * were taken off the list. Said once, so the customer knows why it is
   * shorter; zero the next time.
   */
  removed!: number;
}
