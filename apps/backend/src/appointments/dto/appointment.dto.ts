import {
  AppointmentStatus,
  CancelledBy,
  LedgerEntryType,
  MobileMoneyProvider,
  Prisma,
  SupportActionKind,
  TicketStatus,
  VerificationMethod,
} from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { NoExtraFields, Serialised } from '../../common/serialised';
import {
  APPOINTMENT_SELECT,
  CUSTOMER_APPOINTMENT_SELECT,
  CUSTOMER_LIST_SELECT,
} from '../appointment-select';

/**
 * What an appointment looks like coming back (§128).
 *
 * The class exists so the generated contract DESCRIBES this response instead of
 * calling it `{ type: object }` — which is how §109 came to read four field
 * names wrong, §117 to miss three fields entirely, and §125 to spend an evening
 * on a picture that had uploaded perfectly.
 *
 * `implements` is the part that matters. It is checked against the Prisma
 * payload of the very `select` the service uses, so changing that select and not
 * this class fails the build. A DTO that merely sits beside a query is the same
 * hand-written guess the clients were already making, moved one directory.
 */
/**
 * Health-related answers (§300.6), opened from their sealed column by the
 * reads of the customer and the shop — present there, absent on the answer
 * to an action, and on every admin read.
 */
type HealthOnRead = { healthChoices?: AppointmentChoiceDto[] | null };

type AppointmentPayload = Serialised<
  Prisma.AppointmentGetPayload<{ select: typeof APPOINTMENT_SELECT }>
> &
  HealthOnRead;

/**
 * The nested shapes, as named classes.
 *
 * Inline object types compile perfectly and produce a NAMELESS schema the
 * generator then refuses — "1 schema(s) have no properties" — which is §60's
 * boot-time check doing its job. A client reading `AppointmentLocationDto` also
 * gets a name to import rather than an anonymous shape to retype.
 */
export class AppointmentLocationDto {
  id!: string;
  name!: string;
  address!: string;
  businessId!: string;
}

export class AppointmentServiceDto {
  id!: string;
  name!: string;
  /** The NAME only. The live price is deliberately not joined here (§30). */
  durationMinutes!: number;
  /** What to know before coming (§180) — live from the service, for the reservation. */
  instructions!: string | null;
}

export class AppointmentCustomerDto {
  id!: string;
  email!: string;
}

/**
 * One answer the customer picked (§300), as it was when booked — later
 * changes to the shop's questions never rewrite it.
 */
export class AppointmentChoiceDto {
  /** The question and answer ids then; they may no longer exist. */
  groupId!: string;
  optionId!: string;
  /** The question, by the shop's name for it — "Hair length". */
  group!: string;
  /** The answer — "Long". */
  option!: string;
  /** What it added to the booking's price, once (not per person). */
  priceMinor!: number;
  /** What it added to the booking's length. */
  extraMinutes!: number;
}

/** The customer's own review of this visit, when they left one (§111). */
/** A step our support team took on a booking (§297): what, and when — not who. */
export class AppointmentSupportStepDto {
  kind!: SupportActionKind;
  createdAt!: string;
}

export class AppointmentReviewDto {
  id!: string;
  rating!: number;
  comment!: string | null;
  createdAt!: string;
  editedAt!: string | null;
}

export class AppointmentDto implements AppointmentPayload {
  id!: string;
  status!: AppointmentStatus;
  startTime!: string;
  endTime!: string;

  /** Integer MINOR UNITS of `currency` — never cents unless that currency has two (§56). */
  depositAmountMinor!: number;
  platformFeeAmountMinor!: number;
  businessAmountMinor!: number;
  currency!: string;

  /**
   * The price agreed at booking, not today's. Null on appointments made before
   * that snapshot existed — and null is the honest answer there, because the
   * live price is a different number (§30).
   */
  servicePriceMinor!: number | null;
  /**
   * How many people it is for (§136, §189). `servicePriceMinor` above is the
   * price of ALL of them; `unitPriceMinor` is the price of one, null on the
   * same old rows.
   */
  quantity!: number;
  unitPriceMinor!: number | null;
  /**
   * The sale it was booked under (§186): percent off, and the WHOLE booking's
   * price before it. Both null when there was no sale. `servicePriceMinor`
   * above is already the price after it.
   */
  discountPercent!: number | null;
  listPriceMinor!: number | null;
  depositPercentage!: string | null;
  platformFeePercentage!: string | null;

  /**
   * What the customer picked (§300), in the order the shop asks: question,
   * answer, and what each added. Null when there was nothing to choose.
   * Health-related answers are never here — see `healthChoices`.
   */
  @ApiProperty({ type: () => [AppointmentChoiceDto], nullable: true })
  choices!: Prisma.JsonValue;
  /** What the answers added — already inside `servicePriceMinor` and `endTime` (§300). */
  choicesPriceMinor!: number;
  choicesMinutes!: number;
  /** The customer's note to the shop (§300.5). */
  customerNote!: string | null;
  /** When the customer last changed their wishes or note after booking (§300.7). */
  choicesChangedAt!: string | null;
  /** When the health-related answers were removed, 30 days after the visit (§300.6). */
  healthChoicesRemovedAt!: string | null;
  /**
   * Health-related answers (§300.6) — allergies, pregnancy, an injury. On
   * the customer's and the shop's READS only, one booking or a list; absent
   * on the answer to an action. Null: none were given. Show them in red to
   * the shop; never put them in an email, a notice or a calendar invite.
   */
  @ApiProperty({ required: false, type: () => [AppointmentChoiceDto], nullable: true })
  healthChoices?: AppointmentChoiceDto[] | null;

  paymentProviderReferenceId!: string | null;
  paymentInitiatedAt!: string | null;

  /** What the operator actually charged, and in what (§45). */
  providerCurrency!: string | null;
  providerAmountMinor!: number | null;
  exchangeRateUsed!: string | null;

  verifiedAt!: string | null;
  /** That a code was sent, and when. Never the code itself (§53.2). */
  verificationCodeSentAt!: string | null;
  completedAt!: string | null;
  cancelledAt!: string | null;
  noShowAt!: string | null;

  /** Which side called it off — it decides the money outcome (§33). */
  cancelledBy!: CancelledBy | null;
  cancelledByUserId!: string | null;
  cancellationReason!: string | null;
  cancellationTicketId!: string | null;

  depositPaidAt!: string | null;
  createdAt!: string;

  location!: AppointmentLocationDto;
  service!: AppointmentServiceDto;
  customer!: AppointmentCustomerDto;

  /** What our support team did on this booking, and when (§297). */
  supportActions!: AppointmentSupportStepDto[];
}

/**
 * The customer's own row, which additionally carries the review they left.
 *
 * Only on the customer's projections, because joining it onto the shared one
 * would hand a business a review an admin had hidden (§111.1).
 */
type CustomerAppointmentPayload = Serialised<
  Prisma.AppointmentGetPayload<{ select: typeof CUSTOMER_LIST_SELECT }>
> &
  HealthOnRead;

export class CustomerAppointmentDto
  extends AppointmentDto
  implements CustomerAppointmentPayload
{
  review!: AppointmentReviewDto | null;
}

/**
 * The customer's own DETAIL read, which additionally carries the arrival code.
 *
 * A third class rather than an optional field on the one above, because that is
 * what the server actually does: `CUSTOMER_APPOINTMENT_SELECT` names the code and
 * the list projection deliberately does not (§54.2). Annotating the detail
 * endpoint with the list shape was caught the moment a client derived from it —
 * `Property 'verificationCode' does not exist` — which is the whole point of
 * this exercise arriving three minutes after the machinery was built.
 */
type CustomerAppointmentDetailPayload = Serialised<
  Prisma.AppointmentGetPayload<{ select: typeof CUSTOMER_APPOINTMENT_SELECT }>
> &
  HealthOnRead;

export class CustomerAppointmentDetailDto
  extends CustomerAppointmentDto
  implements CustomerAppointmentDetailPayload
{
  /**
   * Shown while it can still be used, null once it cannot (§54.2). A spent code
   * is not a secret, but it is not information either — rendering it beside a
   * finished appointment invites somebody to read out a number that is refused.
   */
  verificationCode!: string | null;
}

/** One page of them. */
export class AppointmentPageDto {
  total!: number;
  limit!: number;
  offset!: number;
  appointments!: AppointmentDto[];
}

/**
 * `implements` alone never objected to a field the select had stopped
 * providing (§128.17). These close that side.
 */
export const __appointmentDtoIsExact: NoExtraFields<AppointmentDto, AppointmentPayload> = true;
export const __customerAppointmentDtoIsExact: NoExtraFields<CustomerAppointmentDto, CustomerAppointmentPayload> = true;
export const __customerAppointmentDetailDtoIsExact: NoExtraFields<CustomerAppointmentDetailDto, CustomerAppointmentDetailPayload> = true;

// ---------------------------------------------------------------------------
// The admin listing (§95, §128.38)
// ---------------------------------------------------------------------------

/**
 * An appointment as a MODERATOR reads it — flattened, with the names lifted out
 * of their relations and put beside each other.
 *
 * Deliberately not `AppointmentDto`: this view exists to answer "whose booking,
 * at which branch of which business, and can I still reclassify it", so a
 * console drawing one row should not have to walk three nested objects.
 */
export class AdminAppointmentDto {
  id!: string;
  status!: AppointmentStatus;
  startTime!: string;
  endTime!: string;
  /** When it was booked. */
  createdAt!: string;
  /** People booked together (§186). */
  quantity!: number;

  currency!: string;
  /** The full price when booked; null on bookings older than the snapshot. */
  servicePriceMinor!: number | null;
  depositAmountMinor!: number;
  platformFeeAmountMinor!: number;
  businessAmountMinor!: number;
  /** Derived from `depositPaidAt`, so a console need not know the column. */
  depositPaid!: boolean;
  depositPaidAt!: string | null;

  /** The steps it went through (§249). */
  verifiedAt!: string | null;
  verificationMethod!: VerificationMethod | null;
  completedAt!: string | null;
  noShowAt!: string | null;

  cancelledAt!: string | null;
  cancelledBy!: CancelledBy | null;
  cancellationReason!: string | null;
  /** The support ticket a reclassification was recorded against, if any. */
  cancellationTicketId!: string | null;

  customerId!: string;
  customerEmail!: string;
  customerDisplayName!: string | null;
  serviceName!: string;
  /** The service's first photo, for the row (§249). */
  serviceImageUrl!: string | null;
  locationId!: string;
  locationName!: string;
  businessId!: string;
  businessName!: string | null;
  businessLogoUrl!: string | null;

  /** The stars the customer gave it, when they reviewed it. */
  reviewRating!: number | null;
  /** Support tickets raised about it. */
  ticketCount!: number;

  /**
   * Whether reclassifying would do anything at all.
   *
   * Mirrors the PATCH exactly: a COMPLETED appointment and one already blamed
   * on the business are both refused, and with no deposit taken there is
   * nothing to refund. Published so the console can stop offering an action the
   * server will decline (§118).
   */
  canReclassify!: boolean;

  /** What our support team may do on it now (§297) — the rule each action enforces. */
  support!: AdminAppointmentSupportDto;
}

export class AdminAppointmentSupportDto {
  checkIn!: boolean;
  complete!: boolean;
  fixNoShow!: boolean;
  cancelForCustomer!: boolean;
  cancelForShop!: boolean;
  resendCode!: boolean;
  checkPayment!: boolean;
}

export class AdminAppointmentPageDto {
  total!: number;
  limit!: number;
  offset!: number;
  appointments!: AdminAppointmentDto[];
}

export class AdminAppointmentTicketDto {
  id!: string;
  reference!: string;
  subject!: string;
  status!: TicketStatus;
  createdAt!: string;
}

/** A line the ledger wrote for the booking: what moved, which way, when (§25). */
export class AdminAppointmentLedgerDto {
  id!: string;
  type!: LedgerEntryType;
  /** Signed: what the shop gains is positive, what it gives up negative. */
  amountMinor!: number;
  currency!: string;
  createdAt!: string;
  /** Set once the line has been paid out to the shop. */
  payoutId!: string | null;
}

export class AdminAppointmentReviewDto {
  id!: string;
  rating!: number;
  comment!: string | null;
  hiddenAt!: string | null;
  createdAt!: string;
}

/**
 * One booking, with everything a dispute turns on (§249): the price it was
 * booked at, the payment and its operator, who checked the customer in and
 * how, who cancelled, the ledger's lines, the review and the tickets.
 */
export class AdminAppointmentDetailDto extends AdminAppointmentDto {
  /**
   * What the customer picked (§300), as booked — never the private answers,
   * which are read only through support, with a reason (§300.6).
   */
  @ApiProperty({ type: () => [AppointmentChoiceDto], nullable: true })
  choices!: Prisma.JsonValue;
  choicesPriceMinor!: number;
  choicesMinutes!: number;
  customerNote!: string | null;
  choicesChangedAt!: string | null;
  /** Whether the booking holds private answers — not what they are. */
  hasHealthChoices!: boolean;
  healthChoicesRemovedAt!: string | null;
  unitPriceMinor!: number | null;
  discountPercent!: number | null;
  listPriceMinor!: number | null;
  locationAddress!: string;
  /** The branch's own number, else the shop's. */
  shopPhone!: string | null;

  paymentProvider!: MobileMoneyProvider | null;
  paymentProviderReferenceId!: string | null;
  paymentInitiatedAt!: string | null;
  providerCurrency!: string | null;
  providerAmountMinor!: number | null;
  exchangeRateUsed!: number | null;

  verifiedByEmail!: string | null;
  manualVerificationNote!: string | null;

  cancelledByEmail!: string | null;
  cancellationTicketReference!: string | null;

  tickets!: AdminAppointmentTicketDto[];
  ledger!: AdminAppointmentLedgerDto[];
  review!: AdminAppointmentReviewDto | null;
}
