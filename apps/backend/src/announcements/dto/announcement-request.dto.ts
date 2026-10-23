import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AnnouncementAudience, AnnouncementKind } from '@prisma/client';

/** Who an announcement is for (§287). */
export class AnnouncementAudienceDto {
  @IsEnum(AnnouncementKind)
  kind!: AnnouncementKind;

  @IsEnum(AnnouncementAudience)
  audience!: AnnouncementAudience;

  /** Customers in this district. */
  @IsOptional()
  @IsUUID()
  districtId?: string | null;

  /** Sellers of this category. */
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  /** One person. */
  @IsOptional()
  @IsUUID()
  userId?: string | null;

  /** One shop's team. */
  @IsOptional()
  @IsUUID()
  businessId?: string | null;
}

/** The announcement in one other language (§308.4). A field left out is said in English. */
export class AnnouncementWordsDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  body?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  linkLabel?: string;
}

export class AnnouncementTranslationsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AnnouncementWordsDto)
  rw?: AnnouncementWordsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AnnouncementWordsDto)
  fr?: AnnouncementWordsDto;
}

export class SaveAnnouncementDto extends AnnouncementAudienceDto {
  @IsString()
  @Length(3, 80)
  title!: string;

  @IsString()
  @Length(3, 1000)
  body!: string;

  /** A page inside the app it lands in: "/stories", "/shop/…". */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^\/[^\s]*$/, { message: 'A link is a page in the app, starting with "/".' })
  linkPath?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  linkLabel?: string | null;

  /** The same in Kinyarwanda and French; each person gets theirs (§308.4). */
  @IsOptional()
  @ValidateNested()
  @Type(() => AnnouncementTranslationsDto)
  translations?: AnnouncementTranslationsDto;

  @IsBoolean()
  sendPush!: boolean;

  @IsBoolean()
  sendEmail!: boolean;

  /** Also a strip across the top of the app — service notices only. */
  @IsBoolean()
  banner!: boolean;

  @IsOptional()
  @IsDateString()
  bannerUntil?: string | null;

  /** Also a card in the business app's For you until then — for sellers, everyone or one shop (§310). */
  @IsOptional()
  @IsDateString()
  forYouUntil?: string | null;
}

export class SendAnnouncementDto {
  /** Later, instead of now. */
  @IsOptional()
  @IsDateString()
  at?: string;

  /** For a large audience: the number of people, typed back as a check. */
  @IsOptional()
  @IsInt()
  @Min(0)
  confirmCount?: number;
}

export class BannerQueryDto {
  @IsIn(['customers', 'sellers'])
  for!: 'customers' | 'sellers';
}
