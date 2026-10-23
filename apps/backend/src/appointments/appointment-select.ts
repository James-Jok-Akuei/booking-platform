import { Prisma } from '@prisma/client';
import { SHOWN_ON_BOOKING } from '../support/support-kinds';

/**
 * The projections every appointment read uses, in one file (§128).
 *
 * Moved out of the service so the response DTOs can be type-checked against
 * them. A DTO that merely sits beside a query is the same hand-written guess the
 * clients were already making; one checked against `Prisma.AppointmentGetPayload`
 * of the actual select cannot drift from it without failing the build.
 */
export const APPOINTMENT_SELECT = {
  id: true,
  status: true,
  startTime: true,
  endTime: true,
  depositAmountMinor: true,
  platformFeeAmountMinor: true,
  businessAmountMinor: true,
  currency: true,
  servicePriceMinor: true,
  // How many, and the price of one (§136).
  quantity: true,
  unitPriceMinor: true,
  // The sale it was booked under, and the price before it (§186).
  discountPercent: true,
  listPriceMinor: true,
  // What the customer picked and wrote (§300) — never the health-related
  // answers, which are sealed in a column of their own and opened only by
  // the reads that name it (HEALTH_CHOICES_SELECT).
  choices: true,
  choicesPriceMinor: true,
  choicesMinutes: true,
  customerNote: true,
  choicesChangedAt: true,
  healthChoicesRemovedAt: true,
  depositPercentage: true,
  platformFeePercentage: true,
  paymentProviderReferenceId: true,
  paymentInitiatedAt: true,
  providerCurrency: true,
  providerAmountMinor: true,
  exchangeRateUsed: true,
  verifiedAt: true,
  /// Not the code — only that one was sent, and when (§53.2).
  verificationCodeSentAt: true,
  completedAt: true,
  cancelledAt: true,
  noShowAt: true,
  // Who called it off and why (§33). Exposed because the party that cancelled
  // is what decides the money outcome, and the customer reading the booking is
  // one of the two parties it decides it for.
  cancelledBy: true,
  cancelledByUserId: true,
  cancellationReason: true,
  cancellationTicketId: true,
  depositPaidAt: true,
  createdAt: true,
  location: { select: { id: true, name: true, address: true, businessId: true } },
  // NO priceMinor. The joined Service row carries the business's CURRENT price,
  // and a business may reprice at any time (§10) — selecting it here rendered
  // today's price as what a customer agreed to months ago, on every appointment
  // detail and list response. The price of record is the appointment's own
  // `servicePriceMinor` snapshot above (§30), which is null for appointments
  // booked before it existed. Null is the honest answer there; falling back to
  // the live price is the bug.
  //
  // The NAME stays joined deliberately: a renamed service makes the label drift,
  // which is cosmetic. A reprice makes the number wrong, which is not.
  service: {
    select: { id: true, name: true, durationMinutes: true, instructions: true },
  },
  customer: { select: { id: true, email: true } },
  // The deposit going back, when it does (§313) — never the number it goes
  // to: the shop reads this select too.
  refund: {
    select: { status: true, reason: true, amountMinor: true, currency: true, sentAt: true, doneAt: true },
  },
  // What our support team did on this booking, and when — never who (§297).
  supportActions: {
    where: { kind: { in: SHOWN_ON_BOOKING } },
    orderBy: { createdAt: 'asc' },
    select: { kind: true, createdAt: true },
  },
} as const;

/**
 * The customer's own view, which additionally carries the live arrival code
 * (§54.2).
 *
 * A SEPARATE projection rather than a field on the shared one that business and
 * admin reads remember to strip. The difference matters: with a shared
 * projection, forgetting to strip leaks the code, and every new read path is
 * another chance to forget. Here the shared projection cannot leak it at all,
 * and showing it takes naming this constant — which only the customer's own
 * detail read does.
 */
/**
 * The customer's own review of this appointment, when they have left one.
 *
 * On the CUSTOMER projections only, and that is the point. The screen has to
 * tell "you can review this" from "you already did", and nothing else could
 * answer it: the public listing carries no `customerId`, so an app cannot find
 * its own row in it (§111).
 *
 * Never joined onto the shared projection, because a business reading the same
 * appointment would then see a review an admin had HIDDEN — §93's whole point is
 * that hiding removes it from every listing, and a join here would quietly put
 * it back. The author is the one person who still sees their own: hiding it from
 * them would leave the app offering "write a review" on an appointment the
 * server answers with 409 "already reviewed", which is worse than saying
 * nothing. No `hiddenAt` is exposed either way — whether an author is told their
 * review was hidden is a moderation question this does not settle.
 */
export const OWN_REVIEW_SELECT = {
  review: {
    select: {
      id: true,
      rating: true,
      comment: true,
      createdAt: true,
      editedAt: true,
    },
  },
} as const;

/** The customer's own rows in a LISTING: no arrival code, which is detail-only. */
export const CUSTOMER_LIST_SELECT = {
  ...APPOINTMENT_SELECT,
  ...OWN_REVIEW_SELECT,
} as const;

/**
 * The sealed health-related answers (§300.6). Named only by the reads of the
 * two people they are for — the customer, and the shop's team for that
 * branch — which open them into `healthChoices` and drop this column.
 * Never by an admin read, an action's answer, an email or a notice.
 */
export const HEALTH_CHOICES_SELECT = { healthChoicesSealed: true } as const;

export const CUSTOMER_APPOINTMENT_SELECT = {
  ...APPOINTMENT_SELECT,
  ...OWN_REVIEW_SELECT,
  verificationCode: true,
} as const;
