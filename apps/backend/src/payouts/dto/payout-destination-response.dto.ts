import {
  MobileMoneyProvider,
  PayoutDestinationStatus,
  PayoutVerificationMethod,
} from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { NoExtraFields, Serialised } from '../../common/serialised';
import type { PayoutDestinationView } from '../payout-destinations.service';

/**
 * Where a business's money is sent (§48) — the FOURTH response in this API
 * whose shape depends on the viewer (§128.29, §128.34).
 *
 * `msisdnLast3` is always present and safe to show anyone. The full `msisdn` is
 * present ONLY for the OWNER (§48.5): a staff member can see that a number is
 * on file and verified without being shown the number itself.
 */
export class PayoutDestinationDto implements Serialised<PayoutDestinationView> {
  id!: string;
  businessId!: string;
  provider!: MobileMoneyProvider;
  status!: PayoutDestinationStatus;

  submittedById!: string;
  submittedAt!: string;

  /** Null until an administrator has checked it. */
  verifiedById!: string | null;
  verifiedAt!: string | null;
  verificationMethod!: PayoutVerificationMethod | null;
  verificationNote!: string | null;
  rejectionReason!: string | null;

  createdAt!: string;

  /** The last three digits. Always present. */
  msisdnLast3!: string;

  /** The full number. Present for the OWNER only. */
  @ApiProperty({ required: false })
  msisdn?: string;
}

export const __payoutDestinationDtoIsExact: NoExtraFields<
  PayoutDestinationDto,
  Serialised<PayoutDestinationView>
> = true;

/**
 * The business's own view, with WHY payouts are or are not moving.
 *
 * `note` is a sentence rather than a code, because the honest answer to "where
 * is my money" is a paragraph: nothing is lost, the balance is held, and it goes
 * out once a number is verified.
 */
export class BusinessPayoutDestinationDto {
  /** Null when nothing has ever been submitted. */
  destination!: PayoutDestinationDto | null;
  payoutsPaused!: boolean;
  note!: string;
}

/** The replacement that superseded this one, when a business has submitted again. */
export class ReplacedByDto {
  id!: string;
  msisdn!: string;
  status!: PayoutDestinationStatus;
  submittedAt!: string;
}

/**
 * An administrator's view. The full number is always present — verifying one is
 * the whole job — and so is whatever replaced it.
 */
export class DestinationBusinessDto {
  id!: string;
  name!: string | null;
  phone!: string | null;
}

export class AdminPayoutDestinationDto {
  id!: string;
  businessId!: string;

  /**
   * Who is being paid, by name and number.
   *
   * On the row because verifying a destination means phoning the business to
   * check the number, and an admin should not have to look the business up in
   * another screen to do it.
   */
  businessProfile!: DestinationBusinessDto;
  msisdn!: string;
  provider!: MobileMoneyProvider;
  status!: PayoutDestinationStatus;

  submittedById!: string;
  submittedAt!: string;
  verifiedById!: string | null;
  verifiedAt!: string | null;
  verificationMethod!: PayoutVerificationMethod | null;
  verificationNote!: string | null;
  rejectionReason!: string | null;
  createdAt!: string;

  /** Null when this is the latest one for its business. */
  replacedBy!: ReplacedByDto | null;
}

export class AdminPayoutDestinationPageDto {
  total!: number;
  limit!: number;
  offset!: number;
  destinations!: AdminPayoutDestinationDto[];
}
