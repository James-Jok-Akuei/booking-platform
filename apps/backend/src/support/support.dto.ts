import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min, ValidateIf } from 'class-validator';
import { BusinessMemberRole, SupportActionKind, UserRole } from '@prisma/client';

/**
 * What every support action takes (§297): why, in a few words — the only
 * record of the decision — and the help request it answers, if there is one.
 */
export class SupportReasonDto {
  @IsString()
  @Length(5, 500)
  reason!: string;

  @IsOptional()
  @IsUUID()
  ticketId?: string;
}

/** Checking a customer in, or marking a booking done, for the shop. */
export class SupportCheckInDto extends SupportReasonDto {
  /** The customer's six digits, read out to us. Without it the reason says how we know they came. */
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'The arrival code is six digits.' })
  code?: string;
}

/** Cancelling on the shop's side: a refund when the deposit was paid. */
export class SupportCancelForShopDto extends SupportReasonDto {
  /** The operator's charge for sending the refund, in the settlement currency's minor units. Needed when a deposit was paid. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'gatewayChargeMinor must be a whole number of minor units.' })
  @Min(0)
  gatewayChargeMinor?: number;
}

/** Asking MTN about a payment: a reason is optional — it is only a question. */
export class SupportTicketOnlyDto {
  @IsOptional()
  @IsUUID()
  ticketId?: string;
}

/** Linking a help request to a booking after it was raised. */
export class SupportLinkTicketDto {
  /** The booking, or null to unlink. */
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  appointmentId!: string | null;
}

/** Handing a shop to a member of its team (§297). */
export class SupportTransferOwnershipDto extends SupportReasonDto {
  @IsUUID()
  membershipId!: string;
}

export class SupportHistoryQueryDto {
  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  @IsOptional()
  @IsUUID()
  businessId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  ticketId?: string;
}

export class SupportTicketRefDto {
  id!: string;
  reference!: string;
}

export class SupportActionDto {
  id!: string;
  kind!: SupportActionKind;
  reason!: string;
  createdAt!: string;
  appointmentId!: string | null;
  businessId!: string | null;
  userId!: string | null;
  /** What changed, as JSON text, for the record. */
  details!: string | null;
  /** The admin who did it, by email. */
  by!: string;
  ticket!: SupportTicketRefDto | null;
}

export class SupportHistoryDto {
  actions!: SupportActionDto[];
}

/** One message in a booking's conversation, read by support (§297). */
export class SupportMessageDto {
  id!: string;
  from!: 'customer' | 'shop';
  senderEmail!: string;
  body!: string | null;
  photoUrl!: string | null;
  createdAt!: string;
}

export class SupportConversationDto {
  /** Null when the booking has no conversation. */
  threadId!: string | null;
  messages!: SupportMessageDto[];
}

/** One private answer on a booking, as support reads it (§300.6). */
export class SupportPrivateAnswerDto {
  /** The question, by the shop's name for it. */
  group!: string;
  option!: string;
}

/** The private answers on a booking, read with a reason — the reading is written down (§300.6). */
export class SupportPrivateAnswersDto {
  /** Null when there were none, or they have been removed. */
  answers!: SupportPrivateAnswerDto[] | null;
  /** When they were removed, 30 days after the visit; null while kept. */
  removedAt!: string | null;
}

/** What asking MTN found (§297). */
export class SupportPaymentCheckDto {
  appointmentStatus!: string;
  paymentStatus!: 'NOT_STARTED' | 'PENDING' | 'SUCCESSFUL' | 'FAILED';
  failureReason!: string | null;
}

/** A plain answer: what was done. */
export class SupportDoneDto {
  message!: string;
}

/** Someone in a shop's team, as support sees them (§297). */
export class SupportShopMemberDto {
  id!: string;
  userId!: string;
  email!: string;
  role!: BusinessMemberRole;
  allLocations!: boolean;
  createdAt!: string;
}

/** An invitation not yet accepted. */
export class SupportShopInvitationDto {
  id!: string;
  email!: string;
  role!: BusinessMemberRole;
  expiresAt!: string;
  /** The week ran out — send it again for a new one. */
  expired!: boolean;
  createdAt!: string;
}

/** What support needs to help a shop: paused or not, its team, its waiting invitations. */
export class SupportShopDto {
  id!: string;
  pausedAt!: string | null;
  members!: SupportShopMemberDto[];
  invitations!: SupportShopInvitationDto[];
}

export class SupportPausedDto {
  message!: string;
  pausedAt!: string | null;
}

export class SupportMarketingDto {
  /** How many news choices (email or push) are on. */
  newsChoicesOn!: number;
  weeklyOffersEmail!: boolean;
  /** Shops they follow that may send them offers. */
  shopsSendingOffers!: number;
}

/** What support needs to help a person. */
export class SupportPersonDto {
  id!: string;
  role!: UserRole;
  closedAt!: string | null;
  /** Phones and browsers still signed in. */
  signedInSessions!: number;
  pushDevices!: number;
  marketing!: SupportMarketingDto;
}
