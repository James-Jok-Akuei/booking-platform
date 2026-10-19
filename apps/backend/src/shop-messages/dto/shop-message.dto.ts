import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class SendShopMessageDto {
  @IsString()
  @Length(3, 60)
  title!: string;

  @IsString()
  @Length(3, 300)
  body!: string;

  /** The branch it is about: its Book opens there. Left out, the shop's first. */
  @IsOptional()
  @IsUUID()
  locationId?: string;
}

export class FollowPlaceDto {
  id!: string;
  name!: string;
}

export class FollowShopDto {
  id!: string;
  name!: string;
  logoUrl!: string | null;
}

export class FollowDto {
  business!: FollowShopDto;
  /** Where its page opens. Null when it has no open branch. */
  bookAt!: FollowPlaceDto | null;
  followedAt!: string;
}

export class FollowListDto {
  follows!: FollowDto[];
}

export class FollowStateDto {
  following!: boolean;
}

export class ShopMessageDto {
  id!: string;
  title!: string;
  body!: string;
  location!: FollowPlaceDto | null;
  /** Followers it was sent to. */
  recipients!: number;
  /** Of those, who opened it. */
  read!: number;
  sentBy!: string | null;
  createdAt!: string;
}

export class ShopMessagesDto {
  followers!: number;
  /** One message a week, so following stays worth it. */
  everyDays!: number;
  /** When the next one may go; null when it may go now. */
  nextAt!: string | null;
  messages!: ShopMessageDto[];
}
