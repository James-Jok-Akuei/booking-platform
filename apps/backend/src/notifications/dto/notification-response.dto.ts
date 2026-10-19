import { NotificationCategory, NotificationType, Prisma } from '@prisma/client';
import { NoExtraFields, Serialised } from '../../common/serialised';

/** One select, shared with the DTO describing its result (§128.5). */
export const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  category: true,
  subject: true,
  body: true,
  appointmentId: true,
  link: true,
  readAt: true,
  createdAt: true,
} as const satisfies Prisma.NotificationSelect;

type NotificationRow = Serialised<
  Prisma.NotificationGetPayload<{ select: typeof NOTIFICATION_SELECT }>
>;

/**
 * One item in somebody's inbox.
 *
 * `subject` and `body` are rendered WHEN THE NOTIFICATION IS CREATED, not when
 * it is read, so the wording is whatever was true at the time. A booking
 * cancelled afterwards does not rewrite the message that announced it.
 */
export class NotificationDto implements NotificationRow {
  id!: string;
  type!: NotificationType;
  /** What it is about, for choosing what you get (§287). */
  category!: NotificationCategory;

  subject!: string;
  body!: string;

  /** What it is about, when it is about a booking. */
  appointmentId!: string | null;
  /** Where it opens, in the recipient's own app — the same place a push and an email lead (§287). */
  link!: string | null;

  /** Null until read. The only field this inbox lets anyone change. */
  readAt!: string | null;
  createdAt!: string;
}

export const __notificationDtoIsExact: NoExtraFields<
  NotificationDto,
  NotificationRow
> = true;

export class NotificationPageDto {
  total!: number;
  /** Over the WHOLE inbox, not the page — it drives a badge, not a list. */
  unread!: number;
  limit!: number;
  offset!: number;
  notifications!: NotificationDto[];
}

/**
 * Marking the whole inbox read. `updated` is a COUNT.
 *
 * Its sibling below has an `updated` that is a boolean, which is a wart: one
 * field name, two types, on two endpoints a client calls from the same screen.
 * Both are now in the contract and visibly different, which is the point of
 * describing them — renaming either is a breaking change made for tidiness
 * (§128.12).
 */
export class MarkAllReadDto {
  message!: string;
  updated!: number;
}

/** Marking one notification read. `updated` is a BOOLEAN — see above. */
export class MarkReadDto {
  message!: string;
  updated!: boolean;
}

/** One notification taken off the list (§159). */
export class DismissedDto {
  id!: string;
  dismissed!: boolean;
}

export class DismissedManyDto {
  dismissed!: number;
  /** Which ones, so an undo can put exactly these back (§162). */
  ids!: string[];
}

export class RestoredManyDto {
  restored!: number;
}

export class ReadManyDto {
  updated!: number;
}
