import { AnnouncementAudience, AnnouncementKind, AnnouncementStatus } from '@prisma/client';

export class AnnouncementPlaceDto {
  id!: string;
  name!: string;
}

/** How many it reaches, and how (§287). */
export class AnnouncementReachDto {
  /** People it will be in the notifications of. */
  people!: number;
  /** Of those, how many get a push (a phone or browser, and pushes on). */
  push!: number;
  /** Of those, how many get an email. */
  email!: number;
  /** In the audience but left out: said no to news, or the account is closed. */
  left!: number;
  /** Above this, sending asks for the number typed back. */
  confirmAbove!: number;
}

export class AnnouncementStatsDto {
  recipients!: number;
  read!: number;
  pushSent!: number;
  pushFailed!: number;
  emailSent!: number;
  emailFailed!: number;
  /** Turned off, waiting for the morning, or a weekly limit. */
  skipped!: number;
  /** Still waiting to go (quiet hours). */
  waiting!: number;
}

export class AnnouncementDto {
  id!: string;
  kind!: AnnouncementKind;
  audience!: AnnouncementAudience;
  district!: AnnouncementPlaceDto | null;
  category!: AnnouncementPlaceDto | null;
  user!: { id: string; email: string; displayName: string | null } | null;
  business!: AnnouncementPlaceDto | null;
  title!: string;
  body!: string;
  linkPath!: string | null;
  linkLabel!: string | null;
  sendPush!: boolean;
  sendEmail!: boolean;
  banner!: boolean;
  bannerUntil!: string | null;
  status!: AnnouncementStatus;
  scheduledFor!: string | null;
  sentAt!: string | null;
  recipients!: number;
  createdBy!: string | null;
  sentBy!: string | null;
  createdAt!: string;
  /** Only on one announcement, not the list. */
  stats!: AnnouncementStatsDto | null;
}

export class AnnouncementListDto {
  announcements!: AnnouncementDto[];
}

export class BannerDto {
  id!: string;
  title!: string;
  body!: string;
  linkPath!: string | null;
  linkLabel!: string | null;
  until!: string;
}

export class BannersDto {
  banners!: BannerDto[];
}
