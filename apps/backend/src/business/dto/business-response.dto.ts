import { Prisma } from '@prisma/client';
import { Serialised } from '../../common/serialised';

/**
 * What a business sees of its own branches and services (§128.5).
 *
 * Checked against the real query the same way `AppointmentDto` is, so the two
 * cannot drift: the include below is the one `LocationsService.findAll` uses,
 * and adding a relation to it without adding it here fails the build.
 */
export const LOCATION_INCLUDE = {
  hours: { orderBy: { dayOfWeek: 'asc' } },
  _count: { select: { media: true } },
  // So the branch screen can show where it is, and say when it has not been
  // set (§104).
  district: { include: { province: { select: { id: true, name: true } } } },
} as const satisfies Prisma.LocationInclude;

type LocationPayload = Serialised<
  Prisma.LocationGetPayload<{ include: typeof LOCATION_INCLUDE }>
>;

export class LocationHoursDto {
  id!: string;
  locationId!: string;
  /** 0 = Sunday, matching JavaScript rather than ISO (§12). */
  dayOfWeek!: number;
  openTime!: string;
  closeTime!: string;
  isClosed!: boolean;
  createdAt!: string;
  updatedAt!: string;
}

export class LocationProvinceDto {
  id!: string;
  name!: string;
}

export class LocationDistrictDto {
  id!: string;
  code!: string;
  name!: string;
  provinceId!: string;
  isLive!: boolean;
  createdAt!: string;
  updatedAt!: string;
  province!: LocationProvinceDto;
}

export class LocationMediaCountDto {
  media!: number;
}

export class BusinessLocationDto implements LocationPayload {
  id!: string;
  businessId!: string;
  name!: string;
  address!: string;

  /**
   * Required on create and nullable in the column (§43.2): rows made before that
   * rule genuinely have no position, and there is nothing honest to invent.
   */
  latitude!: number | null;
  longitude!: number | null;

  /** Overrides the business phone for this branch when set. */
  phone!: string | null;
  capacity!: number;

  /** A decimal STRING. Shown, never multiplied (§56). */
  ratingAvg!: string | null;
  ratingCount!: number;

  /** The cheapest service here, maintained on write (§44). */
  fromPriceMinor!: number | null;

  districtId!: string | null;
  /** Null until somebody says where it is; unfindable by place until then (§104). */
  district!: LocationDistrictDto | null;

  /** False means CLOSED, not deleted: history and bookings stay (§89). */
  isActive!: boolean;

  createdAt!: string;
  updatedAt!: string;

  hours!: LocationHoursDto[];
  _count!: LocationMediaCountDto;
}
