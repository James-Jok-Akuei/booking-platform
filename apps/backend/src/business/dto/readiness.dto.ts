import { ApiProperty } from '@nestjs/swagger';
import { BusinessStatus } from '@prisma/client';

const KEYS = ['name', 'type', 'phone', 'branch', 'hours', 'service', 'logo', 'payout'] as const;

/** One thing a shop needs, and whether it has it (§255). */
export class ReadinessItemDto {
  @ApiProperty({ enum: KEYS })
  key!: (typeof KEYS)[number];
  /** Whether the shop can be sent for review without it. */
  required!: boolean;
  done!: boolean;
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
  items!: ReadinessItemDto[];
  /** Every required item is done. */
  ready!: boolean;
  /** Ready, and not already waiting or decided — a rejected shop can send itself back. */
  canSubmit!: boolean;
  /** What an administrator cannot approve without; empty when it could go live. */
  @ApiProperty({ enum: KEYS, isArray: true })
  goLiveGaps!: Array<(typeof KEYS)[number]>;
}
