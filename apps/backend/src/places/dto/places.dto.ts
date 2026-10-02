import { IsBoolean, IsString, IsUUID, Length, Matches } from 'class-validator';

export class CreateDistrictDto {
  @IsUUID()
  provinceId!: string;

  @IsString()
  @Length(2, 60)
  name!: string;

  /**
   * A stable handle for seeds, tests and support queries. Uppercase so it
   * cannot be confused with the display name, which may be reworded.
   */
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/, {
    message: 'code must be uppercase letters, digits or underscores, e.g. MUSANZE.',
  })
  code!: string;
}

export class UpdateDistrictDto {
  @IsString()
  @Length(2, 60)
  name!: string;
}

export class SetDistrictLiveDto {
  @IsBoolean()
  isLive!: boolean;
}
