import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { NotificationCategory, NotificationChannel, PushDeviceKind } from '@prisma/client';

/** One channel of one kind, as the settings screen shows it (§287). */
export class ChannelChoiceDto {
  on!: boolean;
  /** Why it cannot be turned off; null when it can. */
  locked!: string | null;
}

export class CategorySettingDto {
  category!: NotificationCategory;
  title!: string;
  hint!: string;
  /** Null where this audience has no such channel. */
  email!: ChannelChoiceDto | null;
  push!: ChannelChoiceDto | null;
  /** A push of this kind waits out quiet hours. */
  canWait!: boolean;
  /** Marketing: off until the person says yes. */
  needsYes!: boolean;
}

export class QuietHoursDto {
  @IsBoolean()
  on!: boolean;
  /** Minutes after midnight, Kigali time. */
  @IsInt()
  @Min(0)
  @Max(1439)
  from!: number;
  @IsInt()
  @Min(0)
  @Max(1439)
  to!: number;
}

export class PushDeviceDto {
  id!: string;
  kind!: PushDeviceKind;
  label!: string | null;
  lastSeenAt!: string;
  createdAt!: string;
}

export class NotificationSettingsDto {
  audience!: 'CUSTOMER' | 'BUSINESS' | 'ADMIN';
  categories!: CategorySettingDto[];
  quietHours!: QuietHoursDto;
  /** Sellers: booking emails as one summary each morning. Null for everyone else. */
  bookingEmailDigest!: boolean | null;
  /** The words a yes to news and offers agrees to. */
  newsWording!: string;
  /** This person's phones and browsers that take pushes. */
  devices!: PushDeviceDto[];
  /** For a browser to subscribe with; null while web push is not set up. */
  webPushKey!: string | null;
}

export class ChoiceInputDto {
  @IsEnum(NotificationCategory)
  category!: NotificationCategory;
  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;
  @IsBoolean()
  on!: boolean;
}

export class UpdateNotificationSettingsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ChoiceInputDto)
  choices?: ChoiceInputDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => QuietHoursDto)
  quietHours?: QuietHoursDto;

  @IsOptional()
  @IsBoolean()
  bookingEmailDigest?: boolean;

  /** Which app the change was made in, kept with any yes or no to marketing. */
  @IsOptional()
  @IsIn(['customer-app', 'seller-app', 'admin-console'])
  source?: string;
}

export class RegisterDeviceDto {
  @IsEnum(PushDeviceKind)
  kind!: PushDeviceKind;
  /** The Expo push token, or the browser's push endpoint. */
  @IsString()
  @MaxLength(1000)
  token!: string;
  @IsOptional()
  @IsString()
  @MaxLength(200)
  p256dh?: string;
  @IsOptional()
  @IsString()
  @MaxLength(200)
  auth?: string;
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;
}

export class RegisterDeviceResultDto {
  registered!: boolean;
  reason!: string | null;
}

export class UnregisterDeviceDto {
  @IsString()
  @MaxLength(1000)
  token!: string;
}

export class UnregisterDeviceResultDto {
  removed!: boolean;
}
