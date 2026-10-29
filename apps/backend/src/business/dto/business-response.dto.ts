import { BusinessStatus, MobileMoneyProvider, Prisma } from '@prisma/client';
import { KINDS_SELECT } from '../kinds';
import { NoExtraFields, Serialised } from '../../common/serialised';
import { CHOICE_GROUPS_SELECT, ServiceChoiceGroupDto } from './service-choices.dto';

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


/**
 * A service, and where it is offered.
 *
 * Price is per BRANCH since §72 — a price with no branch means nothing — so the
 * offers are part of the service rather than a number on it.
 */
export const SERVICE_INCLUDE = {
  locations: {
    select: {
      locationId: true,
      priceMinor: true,
      isOffered: true,
      location: { select: { id: true, name: true } },
    },
  },
  // Ordered here rather than in the client, so all three read them the same way
  // and the first one is the cover everywhere (§132).
  images: {
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, url: true, displayOrder: true },
  },
  // The questions a customer answers while booking (§300), in order.
  choiceGroups: CHOICE_GROUPS_SELECT,
} as const satisfies Prisma.ServiceInclude;

type ServicePayload = Serialised<
  Prisma.ServiceGetPayload<{ include: typeof SERVICE_INCLUDE }>
>;

export class ServiceOfferLocationDto {
  id!: string;
  name!: string;
}

/**
 * NOT `ServiceOfferDto` — that name is already taken by the request body in
 * `create-service.dto.ts`, and OpenAPI schema names are **global** (§128.7).
 * The generator silently kept the request shape, so the contract described an
 * offer with no `isOffered` and no `location`, and the business app's own
 * screens stopped compiling against it. Caught in seconds; invisible in a
 * hand-written client forever.
 */
export class ServiceOfferedAtDto {
  locationId!: string;
  /** Minor units of the service's currency. Formatted by the server's exponent (§56). */
  priceMinor!: number;
  /**
   * False means PAUSED at this branch, not withdrawn (§74). The row stays so the
   * price does, and turning it back on is one switch rather than retyping it.
   */
  isOffered!: boolean;
  location!: ServiceOfferLocationDto;
}

/** Just enough of a photo to draw it. The full row is on `ServiceImageDto`. */
export class ServiceImageRefDto {
  id!: string;
  url!: string;
  displayOrder!: number;
}

export class BusinessServiceDto implements ServicePayload {
  id!: string;
  businessId!: string;
  name!: string;
  /** The headline on the service's page (§185). */
  title!: string | null;
  description!: string | null;
  /** What to know before coming (§180). */
  instructions!: string | null;
  /** A sale, whole percent off every branch's price (§186). Null is none. */
  discountPercent!: number | null;
  /** The sale's last day, at UTC midnight; the date part is what counts. Null runs until turned off. */
  discountEndsOn!: string | null;
  durationMinutes!: number;
  currency!: string;
  /** A decimal STRING — "20", not 20 (§56). */
  depositPercentage!: string;
  /** False means RETIRED, never deleted (§74, §101). */
  isActive!: boolean;
  createdAt!: string;
  updatedAt!: string;
  locations!: ServiceOfferedAtDto[];

  /**
   * Photos, lowest `displayOrder` first, so the first is the cover (§132).
   * Empty until the business uploads any — a service without photos is normal,
   * not broken.
   */
  images!: ServiceImageRefDto[];

  /** The questions a customer answers while booking it (§300), in order. */
  choiceGroups!: ServiceChoiceGroupDto[];
  /** Whether the customer may write a short note (§300.5). */
  noteEnabled!: boolean;
  /** The words above the note box. Null: the ones written for the shop's kind. */
  notePrompt!: string | null;
  /** The final price is agreed at the shop after seeing the job; cards say "from" (§300.3). */
  priceConfirmedAtShop!: boolean;
}


export const PROFILE_SELECT = {
  id: true,
  name: true,
  description: true,
  phone: true,
  logoUrl: true,
  coverImageUrl: true,
  status: true,
  // The business's own view of its status. A suspended business must be able
  // to see that it is suspended and why (§42.5) — discovering it from a
  // customer who cannot book is the worst possible way to find out.
  statusReason: true,
  statusChangedAt: true,
  // Whether the business paused ITSELF (§119.3), which is a different thing
  // from `status` and has to be visible beside it — a shop that cannot see it
  // is paused would read an empty calendar as the platform being broken.
  pausedAt: true,
  // Whether it has posted itself for customers yet (§268).
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true, icon: true } },
  subcategory: { select: { id: true, name: true } },
  // Every kind it is (§265), the main one first.
  kinds: KINDS_SELECT,
  // Its country (§315): the clock, money, phone numbers and networks its app speaks of.
  country: {
    select: { code: true, name: true, callingCode: true, currency: true, timeZone: true, locales: true, networks: true, phoneExample: true },
  },
} as const;

type ProfilePayload = Serialised<
  Prisma.BusinessProfileGetPayload<{ select: typeof PROFILE_SELECT }>
>;

export class BusinessCategoryDto {
  id!: string;
  name!: string;
  icon!: string | null;
}

export class BusinessSubcategoryDto {
  id!: string;
  name!: string;
}

/** The country a shop is in (§315), as its own app needs it. */
export class ShopCountryDto {
  /** ISO 3166-1 alpha-2: "RW". */
  code!: string;
  name!: string;
  /** Digits only: "250". */
  callingCode!: string;
  /** ISO 4217: "RWF". */
  currency!: string;
  /** IANA zone: "Africa/Kigali" — the shop's clock. */
  timeZone!: string;
  /** The app languages offered there, the usual one first. */
  locales!: string[];
  networks!: MobileMoneyProvider[];
  /** A mobile number as people there write it: "+250 788 123 456". */
  phoneExample!: string;
}

/** One kind of place the business is: a type, and the category it is in (§265). */
export class BusinessKindDto {
  category!: BusinessCategoryDto;
  subcategory!: BusinessSubcategoryDto;
  /** What the business wrote when this kind is "Other" (§267); null otherwise. */
  otherLabel!: string | null;
}

/** The shopfront, as the business itself sees it. */
export class BusinessProfileDto implements ProfilePayload {
  id!: string;
  name!: string | null;
  description!: string | null;
  phone!: string | null;

  /** Uploaded, never a linked URL (§88). */
  logoUrl!: string | null;
  coverImageUrl!: string | null;

  /**
   * What an ADMIN decided. Separate from `pausedAt`, which is what the business
   * did.
   *
   * The enum, not `string`. Declaring it loosely compiled and would have handed
   * every client "any text at all" where the server only ever sends four values
   * — which is how a screen ends up with a branch for a status that cannot
   * happen, and none for one that can.
   */
  status!: BusinessStatus;
  /** Why it is in that status — a suspended shop must be able to read it (§42.5). */
  statusReason!: string | null;
  statusChangedAt!: string | null;

  /** Set while the business has paused ITSELF (§119.3). */
  pausedAt!: string | null;
  /** When it posted itself for customers (§268); null until it has. */
  publishedAt!: string | null;

  createdAt!: string;
  updatedAt!: string;
  /** Its MAIN kind — the first of `kinds` (§265). */
  category!: BusinessCategoryDto | null;
  subcategory!: BusinessSubcategoryDto | null;
  /** Every kind of place it is, the main one first (§265). */
  kinds!: BusinessKindDto[];
  /** The country it is in (§315). */
  country!: ShopCountryDto;
}

/**
 * `implements` alone never objected to a field the select had stopped
 * providing (§128.17). These close that side.
 */
export const __businessLocationDtoIsExact: NoExtraFields<BusinessLocationDto, LocationPayload> = true;
export const __businessServiceDtoIsExact: NoExtraFields<BusinessServiceDto, ServicePayload> = true;
export const __businessProfileDtoIsExact: NoExtraFields<BusinessProfileDto, ProfilePayload> = true;
