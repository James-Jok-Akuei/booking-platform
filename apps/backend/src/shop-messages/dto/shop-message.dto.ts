import { IsBoolean, IsOptional, IsString, IsUUID, Length } from 'class-validator';

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
  coverImageUrl!: string | null;
  /** The category's icon word, for a shop with no cover. */
  categoryIcon!: string | null;
}

/** Something new at a shop you follow (§288). */
export class FollowNewsDto {
  kind!: 'DISCOUNT' | 'NEW_SERVICE' | 'MESSAGE';
  title!: string;
  detail!: string | null;
  /** The service it is about, when it is about one. */
  serviceId!: string | null;
  at!: string;
}

export class FollowDto {
  business!: FollowShopDto;
  /** Where its page opens. Null when it has no open branch. */
  bookAt!: FollowPlaceDto | null;
  /** The district it is in, for the card. */
  district!: string | null;
  ratingAvg!: number | null;
  ratingCount!: number;
  followedAt!: string;
  /** Whether its offers come as notifications too — a separate yes. */
  offers!: boolean;
  /** A story up now. */
  hasStory!: boolean;
  news!: FollowNewsDto[];
}

export class FollowListDto {
  follows!: FollowDto[];
}

export class FollowStateDto {
  following!: boolean;
  offers!: boolean;
}

export class FollowRequestDto {
  /** Yes to this shop's offers as notifications as well. */
  @IsOptional()
  @IsBoolean()
  offers?: boolean;
}

export class FollowOffersDto {
  @IsBoolean()
  offers!: boolean;
}

export class ShopMessageDto {
  id!: string;
  title!: string;
  body!: string;
  location!: FollowPlaceDto | null;
  /** Followers told by notification (those who said yes to offers). */
  recipients!: number;
  /** Of those, who opened it. */
  read!: number;
  sentBy!: string | null;
  createdAt!: string;
}

export class ShopMessagesDto {
  followers!: number;
  /** Of those, who said yes to your offers as notifications; the rest see them in the app. */
  withOffers!: number;
  /** One message a week, so following stays worth it. */
  everyDays!: number;
  /** When the next one may go; null when it may go now. */
  nextAt!: string | null;
  messages!: ShopMessageDto[];
}
