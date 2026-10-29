import { ApiProperty } from '@nestjs/swagger';
import { MobileMoneyProvider } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { MaxDecimalPlaces } from '../../common/validators/max-decimal-places.validator';

/** A country as the apps read it (§315): what they need to speak to someone there. */
export class CountryDto {
  /** ISO 3166-1 alpha-2: "RW". */
  code!: string;
  /** In English; the apps name it in the reader's language. */
  name!: string;
  /** Digits only: "250". */
  callingCode!: string;
  /** ISO 4217: "RWF". */
  currency!: string;
  /** IANA zone: "Africa/Kigali" — the clock its shops keep. */
  timeZone!: string;
  /** The app languages offered there, the usual one first. */
  locales!: string[];
  networks!: MobileMoneyProvider[];
  /** A mobile number as people there write it: "+250 788 123 456". */
  phoneExample!: string;
  /** How many digits a mobile number has after the calling code. */
  mobileDigits!: number;
  /**
   * The network a mobile number most likely belongs to, by the two digits
   * after the calling code: { "78": "MTN_MOMO", "72": "AIRTEL_MONEY" }. A
   * guess the person can always change (§58.1); a prefix not listed is not
   * guessed at all.
   */
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string', enum: ['MTN_MOMO', 'AIRTEL_MONEY'] } })
  networkPrefixes!: Record<string, MobileMoneyProvider>;
  /** The country a visitor who has not chosen one is in. */
  isDefault!: boolean;
}

export class CountryCheckDto {
  @ApiProperty({ enum: ['pack', 'currency', 'clock', 'phone', 'networks', 'languages', 'places'] })
  key!: 'pack' | 'currency' | 'clock' | 'phone' | 'networks' | 'languages' | 'places';
  ok!: boolean;
  /** In plain words, for the console. */
  words!: string;
}

/** A country as the console reads it: its settings, its shops, and whether it could be switched on. */
export class AdminCountryDto extends CountryDto {
  isLive!: boolean;
  liveSince!: string | null;
  /** The country's own fee, or null when it takes the platform's. Two decimals, as a string. */
  platformFeePercentage!: string | null;
  /** The fee its bookings are charged now: its own, or the platform's. */
  effectiveFeePercentage!: string;
  /** Shops there, and how many customers can find. */
  shops!: number;
  liveShops!: number;
  /** Districts there customers can pick. */
  places!: number;
  /** Everything it needs to be on; all `ok` for a country that can be switched on. */
  checks!: CountryCheckDto[];
}

/** The console's change to a country: its own fee (null takes the platform's), or whether it is live. */
export class UpdateCountryDto {
  /**
   * The country's own fee, two decimals, 0–100; null to take the platform's.
   * Like the platform fee, it may not be raised above any active service's
   * deposit there (§55-style check in `PlatformSettingsService`).
   */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @Type(() => Number)
  @IsNumber()
  @MaxDecimalPlaces(2)
  @Min(0)
  @Max(100)
  @ApiProperty({ type: Number, nullable: true, required: false })
  platformFeePercentage?: number | null;

  @IsOptional()
  @IsBoolean()
  isLive?: boolean;
}
