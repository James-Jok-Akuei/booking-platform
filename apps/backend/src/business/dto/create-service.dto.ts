import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_DISCOUNT_PERCENT, MIN_DISCOUNT_PERCENT } from '../discount';
import { MaxDecimalPlaces } from '../../common/validators/max-decimal-places.validator';
import { CHOICE_LIMITS } from '../service-choices';
import { ServiceChoiceGroupInputDto } from './service-choices.dto';

/** One branch's offer of a service, at that branch's price (§72). */
export class ServiceOfferDto {
  @IsUUID()
  locationId!: string;

  // Integer MINOR UNITS of the internal currency, never a float — see §10.3
  // and §56. Capped to catch the obvious "typed major units into a minor-unit
  // field" mistake.
  @IsInt({
    message:
      'priceMinor must be a whole number of minor units (e.g. cents), not a decimal amount',
  })
  @Min(0)
  @Max(100_000_000)
  priceMinor!: number;
}

/**
 * Words a shop may leave blank: an empty box is "nothing to say", stored as
 * null, so no client has to tell "" from nothing (§180).
 */
const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class CreateServiceDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  /**
   * The headline under the photos on the service's page (§185) — what makes
   * someone want it, in one line. The name above stays the short label.
   */
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(100)
  title?: string | null;

  /** What it is, in the shop's own words. Shown under "About this service". */
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  /**
   * What to know before coming (§180): arrive early, bring a towel, park at
   * the back. Short on purpose — it is read on a phone, the day before.
   */
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(600)
  instructions?: string | null;

  /**
   * A sale (§186): whole percent off every branch's price, 1–90. `null` ends
   * the sale; left out, it stays as it is.
   */
  @IsOptional()
  @IsInt({ message: 'discountPercent must be a whole number, like 20' })
  @Min(MIN_DISCOUNT_PERCENT)
  @Max(MAX_DISCOUNT_PERCENT)
  discountPercent?: number | null;

  /**
   * The LAST day the sale runs, as a date (YYYY-MM-DD) in the platform's time
   * zone; it can be booked all of that day. `null`: until it is turned off.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'discountEndsOn must be a date like 2026-10-31' })
  discountEndsOn?: string | null;

  /**
   * Where this service is offered, and for how much at each branch (§72).
   *
   * At least one: a service offered nowhere cannot be booked by anybody, and
   * creating one is almost always a mistake rather than an intention. A branch
   * can be removed later, which is the honest way to stop offering it there.
   */
  @IsArray()
  @ArrayMinSize(1, {
    message: 'Choose at least one branch for this service, with its price there.',
  })
  @ValidateNested({ each: true })
  @Type(() => ServiceOfferDto)
  offers!: ServiceOfferDto[];

  @IsInt()
  @Min(1)
  @Max(1440) // a single appointment cannot exceed one day
  durationMinutes!: number;

  /**
   * Share of the price the customer pays up front to hold the slot.
   *
   * The lower bound is NOT expressed here: it is the live platform fee from
   * PlatformSetting, which an admin can change at runtime, so validating it
   * needs a database read and happens in ServicesService.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @MaxDecimalPlaces(2)
  @Min(0)
  @Max(100)
  depositPercentage?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * The questions a customer answers while booking (§300), in order. On an
   * edit, left out means unchanged; sent, it is the whole list as it should
   * be — a question or answer sent with its `id` is kept, one left out is
   * removed. Bookings already made keep what was picked either way.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CHOICE_LIMITS.groups, {
    message: `A service can ask up to ${CHOICE_LIMITS.groups} questions.`,
  })
  @ValidateNested({ each: true })
  @Type(() => ServiceChoiceGroupInputDto)
  choiceGroups?: ServiceChoiceGroupInputDto[];

  /** Whether the customer may write a short note while booking (§300.5). */
  @IsOptional()
  @IsBoolean()
  noteEnabled?: boolean;

  /** The words above the note box; blank goes back to the ones for the shop's kind. */
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(CHOICE_LIMITS.notePrompt)
  notePrompt?: string | null;

  /**
   * The final price is agreed at the shop after seeing the job — a repair,
   * a party (§300.3). Cards say "from", and the deposit is on the price here.
   */
  @IsOptional()
  @IsBoolean()
  priceConfirmedAtShop?: boolean;
}
