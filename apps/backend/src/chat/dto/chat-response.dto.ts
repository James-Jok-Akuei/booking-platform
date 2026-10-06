import { AppointmentStatus, Prisma, UserRole } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { NoExtraFields, Serialised } from '../../common/serialised';

// ---------------------------------------------------------------------------
// Messages (§128.29)
// ---------------------------------------------------------------------------

/** One select, shared by the listing and by sending (§128.5). */
export const MESSAGE_SELECT = {
  id: true,
  body: true,
  photoUrl: true,
  createdAt: true,
  sender: { select: { id: true, email: true, role: true } },
} as const satisfies Prisma.MessageSelect;

type MessageRow = Serialised<
  Prisma.MessageGetPayload<{ select: typeof MESSAGE_SELECT }>
>;

/**
 * Who wrote a message — and the one response in this API whose SHAPE depends on
 * who is asking (§112.1).
 *
 * `email` is omitted entirely for a CUSTOMER viewer. The address belongs to a
 * named member of staff, and a customer messaging a shop is talking to the
 * shop, not to a person whose work address they get to keep. A business or an
 * administrator sees it, because to them it answers "which of us replied".
 *
 * Optional rather than nullable, and optional rather than two schemas under a
 * `oneOf`: the discriminator is the VIEWER'S ROLE, which is not in the payload,
 * so a client could not tell the two variants apart from the response alone.
 */
export class MessageSenderDto {
  id!: string;
  role!: UserRole;

  /** Absent for a customer viewer. Present for business and admin viewers. */
  @ApiProperty({ required: false })
  email?: string;
}

export class ThreadMessageDto {
  id!: string;
  /** Null when the message is a photo with no caption. */
  body!: string | null;
  photoUrl!: string | null;
  createdAt!: string;
  sender!: MessageSenderDto;
}

/**
 * Bound to the select with `email` forced present, because that is the WIDEST
 * shape the row can take. The narrowing is a deliberate subtraction on top of
 * it, so this still catches a field dropped from the query (§128.17).
 */
export const __threadMessageDtoIsExact: NoExtraFields<
  ThreadMessageDto,
  MessageRow
> = true;

export class ThreadMessagePageDto {
  total!: number;
  limit!: number;
  offset!: number;
  /** Chronological: a conversation reads forwards. */
  messages!: ThreadMessageDto[];
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export class ThreadBusinessDto {
  id!: string;
  name!: string | null;
  logoUrl!: string | null;
}

export class ThreadCustomerDto {
  id!: string;
  email!: string;
}

/** Present only on a thread that came from a booking. */
export class ThreadAppointmentDto {
  id!: string;
  status!: AppointmentStatus;
  startTime!: string;
  serviceName!: string;
}

/**
 * Enough to draw a row in a list without fetching the messages.
 *
 * `preview` is the text, or `[photo]` for a photo with no caption — resolved
 * here rather than in three clients, so an empty row cannot read as a bug.
 */
export class ThreadLastMessageDto {
  preview!: string;
  hasPhoto!: boolean;
  senderId!: string;
  createdAt!: string;
}

/**
 * A conversation, as ONE PARTICIPANT sees it.
 *
 * `unreadCount` is the viewer's own and never counts their own messages, so the
 * same thread legitimately has a different count for each side.
 */
export class ThreadDto {
  id!: string;
  /** Whether it started from a booking or from a cold enquiry (§21.4). */
  kind!: 'APPOINTMENT' | 'INQUIRY';

  business!: ThreadBusinessDto;
  customer!: ThreadCustomerDto;
  appointment!: ThreadAppointmentDto | null;

  unreadCount!: number;
  /** Null on a thread nobody has written in yet. */
  lastMessage!: ThreadLastMessageDto | null;
  /** Null until the first message. Threads with none sort last. */
  lastMessageAt!: string | null;
  createdAt!: string;
}

export class ThreadPageDto {
  total!: number;
  limit!: number;
  offset!: number;
  threads!: ThreadDto[];
}

export class ThreadReadDto {
  message!: string;
  lastReadAt!: string;
}
