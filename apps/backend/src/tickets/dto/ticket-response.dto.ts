import {
  AppointmentStatus,
  Prisma,
  TicketAuthorType,
  TicketCategory,
  ReporterType,
  TicketStatus,
  UserRole,
} from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { NoExtraFields, Serialised } from '../../common/serialised';

/**
 * One select, shared by creating, listing and every status change (§128.5).
 *
 * Deliberately WITHOUT messages: the listing draws a queue, and loading every
 * conversation to draw a row is how a support queue becomes slow enough that
 * nobody opens it.
 */
export const TICKET_SELECT = {
  id: true,
  reference: true,
  reporterId: true,
  reporterType: true,
  businessId: true,
  appointmentId: true,
  category: true,
  subject: true,
  status: true,
  assignedAdminId: true,
  resolutionNote: true,
  resolvedAt: true,
  closedAt: true,
  reopenedAt: true,
  reopenCount: true,
  lastMessageAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.TicketSelect;

type TicketRow = Serialised<
  Prisma.TicketGetPayload<{ select: typeof TICKET_SELECT }>
>;

/**
 * A support ticket.
 *
 * `status` may read CLOSED on a row the database still has as RESOLVED: closure
 * is LAZY, computed when the resolution window has passed rather than written
 * by a job. So this field is the authoritative one for a screen, and the
 * database's own value is not.
 */
export class TicketDto implements TicketRow {
  id!: string;
  /** The human-quotable handle. What a reporter reads out on the phone. */
  reference!: string;

  reporterId!: string;
  /** Derived from the authenticated role, never from the request body. */
  reporterType!: ReporterType;

  businessId!: string | null;
  appointmentId!: string | null;

  category!: TicketCategory;
  subject!: string;
  status!: TicketStatus;

  assignedAdminId!: string | null;
  resolutionNote!: string | null;

  resolvedAt!: string | null;
  closedAt!: string | null;
  reopenedAt!: string | null;
  /** How many times it has come back. A reopened ticket is a signal, not a retry. */
  reopenCount!: number;

  /** Non-null: set at creation, bumped by every message. */
  lastMessageAt!: string;
  createdAt!: string;
  updatedAt!: string;
}

export const __ticketDtoIsExact: NoExtraFields<TicketDto, TicketRow> = true;

export class TicketPageDto {
  total!: number;
  limit!: number;
  offset!: number;
  tickets!: TicketDto[];
}

export class TicketAttachmentDto {
  id!: string;
  url!: string;
  mimeType!: string;
  sizeBytes!: number;
}

export class TicketMessageAuthorDto {
  id!: string;
  email!: string;
  role!: UserRole;
}

/**
 * One message on a ticket — the second response whose shape depends on the
 * VIEWER rather than on the data (§112.1, §128.29).
 *
 * `isInternal` is present only for an administrator, and internal messages are
 * filtered out of a reporter's view entirely. They are support's working-out
 * about a person, not a record of what that person was told — which is why the
 * data export leaves them out too (§119.2).
 */
export class TicketMessageDto {
  id!: string;
  body!: string;
  authorType!: TicketAuthorType;
  createdAt!: string;
  author!: TicketMessageAuthorDto;
  attachments!: TicketAttachmentDto[];

  /** Present for an administrator only. A reporter never sees one at all. */
  @ApiProperty({ required: false })
  isInternal?: boolean;
}

/** One ticket with its conversation, as the caller is allowed to see it. */
export class TicketDetailDto extends TicketDto {
  messages!: TicketMessageDto[];
  /** Files attached to the ticket itself rather than to any one message. */
  attachments!: TicketAttachmentDto[];
}

/**
 * The echo after posting a message.
 *
 * Narrower than `TicketMessageDto` on purpose, and not aligned with it: the
 * attachments are stored AFTER the message's transaction commits, so selecting
 * them here would reliably return an empty list and read as a failed upload.
 */
export class PostedTicketMessageDto {
  id!: string;
  body!: string;
  authorType!: TicketAuthorType;
  isInternal!: boolean;
  createdAt!: string;
}

// ---------------------------------------------------------------------------
// The console's inbox (§247)
// ---------------------------------------------------------------------------

export class TicketPersonDto {
  email!: string;
}

export class TicketShopDto {
  name!: string | null;
  logoUrl!: string | null;
}

/** The newest message on a ticket, cut short — enough to read a queue by. */
export class TicketLatestDto {
  /** At most 160 characters. */
  body!: string;
  authorType!: TicketAuthorType;
  isInternal!: boolean;
  createdAt!: string;
}

/** A ticket as the console's inbox lists it: who, which shop, the latest word. */
export class AdminTicketDto extends TicketDto {
  reporter!: TicketPersonDto;
  businessProfile!: TicketShopDto | null;
  assignedAdmin!: TicketPersonDto | null;
  latest!: TicketLatestDto | null;
}

export class AdminTicketPageDto {
  total!: number;
  limit!: number;
  offset!: number;
  tickets!: AdminTicketDto[];
}

export class TicketAppointmentServiceDto {
  name!: string;
}

/** The booking a ticket is about, when it is about one — a dispute's evidence. */
export class TicketAppointmentDto {
  id!: string;
  status!: AppointmentStatus;
  startTime!: string;
  endTime!: string;
  depositAmountMinor!: number;
  currency!: string;
  depositPaidAt!: string | null;
  service!: TicketAppointmentServiceDto;
  location!: TicketAppointmentServiceDto;
}

export class AdminTicketDetailDto extends TicketDetailDto {
  reporter!: TicketPersonDto;
  businessProfile!: TicketShopDto | null;
  assignedAdmin!: TicketPersonDto | null;
  appointment!: TicketAppointmentDto | null;
}
