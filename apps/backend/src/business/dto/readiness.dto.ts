import { ApiProperty } from '@nestjs/swagger';
import { BusinessStatus } from '@prisma/client';
import { ADVICE_KEYS, type AdviceKey } from '../shop-advice';

const KEYS = ['name', 'type', 'phone', 'branch', 'hours', 'service', 'logo', 'payout'] as const;

/** One thing a shop needs, and whether it has it (§255). */
export class ReadinessItemDto {
  @ApiProperty({ enum: KEYS })
  key!: (typeof KEYS)[number];
  /** Whether the shop can be sent for review without it. */
  required!: boolean;
  done!: boolean;
}

/** One thing that would make the shop easier to book (§303), in the shop's words. */
export class AdviceItemDto {
  @ApiProperty({ enum: ADVICE_KEYS })
  key!: AdviceKey;
  done!: boolean;
  /** "Photos of Kimironko", "A description on 3 services". */
  title!: string;
  /** Why it matters, as the shop reads it. */
  why!: string;
}

/** What we advised when we approved the shop (§303). */
export class ApprovalAdviceDto {
  @ApiProperty({ enum: ADVICE_KEYS, isArray: true })
  keys!: AdviceKey[];
  /** The reviewer's own words, if they wrote any. */
  note!: string | null;
  /** When the shop was approved with it. */
  at!: string;
}

/**
 * How far a shop is from going live (§255): its checklist, whether it can send
 * itself for review now, and — for an administrator — what approving it would
 * still need.
 */
export class BusinessReadinessDto {
  status!: BusinessStatus;
  statusReason!: string | null;
  /** When it last sent itself for review; null while it is still setting up. */
  submittedAt!: string | null;
  /** What the last rejection said, kept after the shop sends itself back. */
  lastRejectionReason!: string | null;
  /** When the shop posted itself for customers (§268); null until it does. */
  publishedAt!: string | null;
  items!: ReadinessItemDto[];
  /** Every required item is done. */
  ready!: boolean;
  /** Ready, and not already waiting or decided — a rejected shop can send itself back. */
  canSubmit!: boolean;
  /** What an administrator cannot approve without; empty when it could go live. */
  @ApiProperty({ enum: KEYS, isArray: true })
  goLiveGaps!: Array<(typeof KEYS)[number]>;
  /** Approved, not yet posted, and still bookable — "Post my shop" can be pressed. */
  canPublish!: boolean;
  /** What would make it easier to book, done or not (§303). */
  advice!: AdviceItemDto[];
  /** What we advised on approval; null when nothing was. */
  @ApiProperty({ type: () => ApprovalAdviceDto, nullable: true })
  approvalAdvice!: ApprovalAdviceDto | null;
}
