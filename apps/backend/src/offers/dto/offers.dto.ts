import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/** The district a customer calls home, as much of it as a screen shows. */
export class OffersDistrictDto {
  id!: string;
  name!: string;
  provinceName!: string;
}

/**
 * Whether this customer has asked for emails about services near them (§140).
 */
export class OffersPreferenceDto {
  /** True only after they turned it on themselves. */
  optedIn!: boolean;
  /** When they agreed; null when they have not. */
  optedInAt!: string | null;
  /** Where "near" is measured from. Kept when they opt out, so opting back in is one tap. */
  district!: OffersDistrictDto | null;
}

export class UpdateOffersPreferenceDto {
  /** Turning it on needs a district, here or already saved. */
  @IsBoolean()
  optedIn!: boolean;

  /** A live district. Send `null` to forget it. */
  @IsOptional()
  @IsUUID()
  districtId?: string | null;
}
