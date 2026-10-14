import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  CancelledBy,
  BusinessMemberRole,
  BusinessMemberStatus,
  Prisma,
  MobileMoneyProvider,
  UserRole,
  VerificationMethod,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import {
  APPOINTMENT_SELECT,
  CUSTOMER_APPOINTMENT_SELECT,
  CUSTOMER_LIST_SELECT,
} from './appointment-select';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { PlatformSettingsService } from '../settings/platform-settings.service';
import { PaymentProviderRegistry } from '../payments/payment-provider.registry';
import { inferOperator } from '../payments/operator-routing';
import {
  INTERNAL_CURRENCY,
  convertMinorUnits,
} from '../payments/currency';
import { zonedWallTimeToInstant } from '../availability/time.util';
import { AvailabilityService } from '../availability/availability.service';
import { computeAppointmentAmounts } from './appointment-pricing';
import { liveDiscount, platformToday, priceFor } from '../business/discount';
import { assertQuantityAllowed } from './quantity';
import { NotificationsService } from '../notifications/notifications.service';
import { ChatService } from '../chat/chat.service';
import { LedgerService } from '../ledger/ledger.service';
import { isPubliclyBookable } from '../business/business-status';
import {
  ApproxSettlementMap,
  RateContext,
  approxSettlementMap,
} from '../payments/approx-settlement';
import { NotificationType } from '@prisma/client';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import {
  AppointmentOrder,
  ListAppointmentsDto,
} from './dto/list-appointments.dto';
import {
  CancelAppointmentDto,
  ReclassifyCancellationDto,
} from './dto/cancel-appointment.dto';
import { ListAdminAppointmentsDto } from './dto/list-admin-appointments.dto';
import {
  InitiateDepositPaymentResponseDto,
  PaymentStatusResponseDto,
} from './dto/payment-status.dto';
import { MEMBERSHIP_SCOPE_SELECT, branchIn, scopeOf, seesBranch } from '../business/branch-scope';

const BCRYPT_ROUNDS = 10;

/** Wrong-code attempts before the code is locked, mirroring OTP handling. */
export const MAX_VERIFICATION_ATTEMPTS = 5;

/**
 * Minimum gap between two sends of an arrival code (§54.1).
 *
 * The resend endpoint emails a customer on demand, so without a floor it is a
 * mail-bomb aimed at whoever booked. A minute is long enough to make that
 * useless and short enough that a customer whose first email genuinely failed
 * is not left waiting.
 */
export const RESEND_COOLDOWN_MS = 60_000;

/**
 * Total codes that may be emailed for one appointment, including the first.
 *
 * A ceiling as well as a cooldown, because a cooldown alone only slows an abuse
 * down. Five is well past the point where resending is the problem: a customer
 * who has burned five codes is not going to be helped by a sixth, they need the
 * manual path (§54.3).
 */
export const MAX_VERIFICATION_CODE_SENDS = 5;



/**
 * What the console's list of bookings reads for each row (§95, §249): the
 * booking, its money and its steps, who booked, the shop, the branch, the
 * service and its first photo, and whether it was reviewed.
 */
const ADMIN_APPOINTMENT_SELECT = {
  id: true,
  status: true,
  startTime: true,
  endTime: true,
  createdAt: true,
  quantity: true,
  currency: true,
  servicePriceMinor: true,
  depositAmountMinor: true,
  platformFeeAmountMinor: true,
  businessAmountMinor: true,
  depositPaidAt: true,
  verifiedAt: true,
  verificationMethod: true,
  completedAt: true,
  noShowAt: true,
  cancelledAt: true,
  cancelledBy: true,
  cancellationReason: true,
  cancellationTicketId: true,
  customer: { select: { id: true, email: true, displayName: true } },
  service: {
    select: {
      name: true,
      images: { orderBy: { displayOrder: 'asc' }, take: 1, select: { url: true } },
    },
  },
  location: {
    select: {
      id: true,
      name: true,
      address: true,
      phone: true,
      businessId: true,
      business: { select: { name: true, logoUrl: true, phone: true } },
    },
  },
  review: { select: { rating: true } },
  _count: { select: { tickets: true } },
} satisfies Prisma.AppointmentSelect;

type AdminAppointmentRow = Prisma.AppointmentGetPayload<{ select: typeof ADMIN_APPOINTMENT_SELECT }>;

const toAdminAppointment = (appointment: AdminAppointmentRow) => ({
  id: appointment.id,
  status: appointment.status,
  startTime: appointment.startTime,
  endTime: appointment.endTime,
  createdAt: appointment.createdAt,
  quantity: appointment.quantity,
  currency: appointment.currency,
  servicePriceMinor: appointment.servicePriceMinor,
  depositAmountMinor: appointment.depositAmountMinor,
  platformFeeAmountMinor: appointment.platformFeeAmountMinor,
  businessAmountMinor: appointment.businessAmountMinor,
  depositPaid: appointment.depositPaidAt !== null,
  depositPaidAt: appointment.depositPaidAt,
  verifiedAt: appointment.verifiedAt,
  verificationMethod: appointment.verificationMethod,
  completedAt: appointment.completedAt,
  noShowAt: appointment.noShowAt,
  cancelledAt: appointment.cancelledAt,
  cancelledBy: appointment.cancelledBy,
  cancellationReason: appointment.cancellationReason,
  cancellationTicketId: appointment.cancellationTicketId,
  customerId: appointment.customer.id,
  customerEmail: appointment.customer.email,
  customerDisplayName: appointment.customer.displayName,
  serviceName: appointment.service.name,
  serviceImageUrl: appointment.service.images[0]?.url ?? null,
  locationId: appointment.location.id,
  locationName: appointment.location.name,
  businessId: appointment.location.businessId,
  businessName: appointment.location.business.name,
  businessLogoUrl: appointment.location.business.logoUrl,
  reviewRating: appointment.review?.rating ?? null,
  ticketCount: appointment._count.tickets,
  /**
   * Whether reclassifying would do anything. Mirrors the PATCH exactly:
   * a COMPLETED appointment and one already blamed on the business are
   * both refused, and with no deposit taken there is nothing to refund.
   */
  canReclassify:
    appointment.status === AppointmentStatus.CANCELLED &&
    appointment.cancelledBy !== CancelledBy.BUSINESS &&
    appointment.depositPaidAt !== null,
});

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly settings: PlatformSettingsService,
    private readonly availability: AvailabilityService,
    private readonly payments: PaymentProviderRegistry,
    private readonly notifications: NotificationsService,
    private readonly chat: ChatService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Turns a submitted `startTime` into an instant (§103).
   *
   * A string carrying a zone — `...Z` or `...+02:00` — is already an instant
   * and is trusted. A **zone-less** one is a wall-clock time, and the only
   * sensible reading of it is the shop's own clock: it is what availability
   * returned, and what the customer tapped.
   *
   * `new Date()` alone read it as the SERVER's local time, which was right
   * here only because this machine is set to Africa/Kigali. On a host in UTC —
   * which is to say every deployment — the same request would have stored
   * 10:00 UTC for a 10:00 Kigali slot and put every booking two hours late.
   * Found by sending exactly what the app sends.
   */
  private resolveStartTime(raw: string): Date {
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw.trim());

    if (hasZone) {
      const instant = new Date(raw);
      if (Number.isNaN(instant.getTime())) {
        throw new BadRequestException('startTime is not a valid date-time.');
      }
      return instant;
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
      raw.trim(),
    );
    if (!match) {
      throw new BadRequestException('startTime is not a valid date-time.');
    }

    const [, year, month, day, hour, minute] = match;
    const calendarDate = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day)),
    );
    // The same helper availability uses, so the two cannot disagree — it also
    // handles the hour that does not exist on a DST boundary.
    return zonedWallTimeToInstant(
      calendarDate,
      Number(hour) * 60 + Number(minute),
      this.availability.platformTimeZone,
    );
  }

  /**
   * Loads everything the notification templates need for one appointment.
   *
   * One helper rather than widening each call site's select, so adding a field
   * to a template does not mean hunting through five queries.
   */
  private async notificationContext(appointmentId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        startTime: true,
        customerId: true,
        depositAmountMinor: true,
        currency: true,
        service: { select: { name: true } },
        location: {
          select: { id: true, name: true, businessId: true, business: { select: { name: true } } },
        },
      },
    });
    if (!appointment) return null;

    return {
      appointmentId: appointment.id,
      customerId: appointment.customerId,
      businessId: appointment.location.businessId,
      context: {
        serviceName: appointment.service.name,
        locationName: appointment.location.name,
        businessName: appointment.location.business.name ?? 'the business',
        startTime: appointment.startTime,
        depositAmountMinor: appointment.depositAmountMinor,
        currency: appointment.currency,
      },
    };
  }

  /** Tells both sides about the same event. Public so the expiry sweep reuses it. */
  async notifyBothParties(
    appointmentId: string,
    type: NotificationType,
    reason?: string,
  ) {
    const loaded = await this.notificationContext(appointmentId);
    if (!loaded) return;
    const context = { ...loaded.context, reason };

    await Promise.all([
      this.notifications.notify({
        recipientId: loaded.customerId,
        type,
        context,
        appointmentId,
      }),
      this.notifications.notifyBusiness({
        businessId: loaded.businessId,
        type,
        context,
        appointmentId,
      }),
    ]);
  }

  // ---------- Booking ----------

  /**
   * Books an appointment, in PENDING_PAYMENT.
   *
   * The whole thing runs inside a transaction guarded by a Postgres advisory
   * lock on the location. Without it, two customers checking the last slot at
   * the same moment would both see it free and both insert — the classic
   * check-then-act race. The lock serialises bookings per location, so the
   * second caller's capacity check runs after the first has committed.
   */
  async create(customerId: string, dto: CreateAppointmentDto) {
    const startTime = this.resolveStartTime(dto.startTime);

    const service = await this.prisma.service.findUnique({
      where: { id: dto.serviceId },
      select: {
        id: true,
        businessId: true,
        isActive: true,
        durationMinutes: true,
        depositPercentage: true,
        name: true,
        // A sale the shop is running (§186), applied to this branch's price.
        discountPercent: true,
        discountEndsOn: true,
        // The offer AT THIS BRANCH, which is where the price lives (§72). A
        // service with no row here is not sold at this location, however much
        // it belongs to the same business.
        locations: {
          where: { locationId: dto.locationId, isOffered: true },
          select: { priceMinor: true },
        },
      },
    });
    if (!service) throw new NotFoundException('Service not found.');

    const location = await this.prisma.location.findUnique({
      where: { id: dto.locationId },
      select: {
        id: true,
        businessId: true,
        name: true,
        address: true,
        isActive: true,
        capacity: true,
        business: { select: { status: true, pausedAt: true, publishedAt: true } },
      },
    });
    if (!location) throw new NotFoundException('Location not found.');

    // A closed branch takes no new bookings (§89). 404 rather than a message,
    // for the same reason the status check below is a 404: to a customer, a
    // branch that is not open does not exist.
    if (!location.isActive) {
      throw new NotFoundException('Location not found.');
    }

    // Booking was the one public surface that never checked this (§42.1).
    // Availability, reviews and chat all hid a non-APPROVED business, but a
    // customer holding a location id could still book with one that was
    // suspended, rejected, or had never been approved at all.
    //
    // 404, not 403: the same rule used everywhere. A business that is not
    // public does not exist as far as a customer is concerned, and saying
    // "this business is suspended" would leak a moderation decision.
    if (!isPubliclyBookable(location.business)) {
      throw new NotFoundException('Location not found.');
    }

    // A service is offered at CHOSEN branches, at each branch's price (§72).
    // The business check stays as the outer guard — it keeps one business's
    // service from being booked at another's shop — and the offer row is what
    // decides whether this particular branch sells it.
    if (service.businessId !== location.businessId || service.locations.length === 0) {
      throw new BadRequestException(
        'That service is not offered at this location.',
      );
    }

    // Exactly one row, by the unique index on (serviceId, locationId).
    const offer = service.locations[0];
    if (!service.isActive) {
      throw new BadRequestException('That service is no longer available.');
    }

    // How many people (§189): each takes one of the branch's places, all at
    // once, for the service's own length. No more than the branch has.
    const quantity = dto.quantity ?? 1;
    assertQuantityAllowed(quantity, location.capacity);

    // endTime is derived, never taken from the client.
    const endTime = new Date(startTime.getTime() + service.durationMinutes * 60_000);

    // One unit's price as the customer was shown it: after the sale, if one
    // is on today (§186). The sale is taken off ONE and then multiplied, so
    // the card's price times three is exactly what three cost.
    const sale = liveDiscount(service, platformToday(this.availability.platformTimeZone));
    const unit = priceFor(offer.priceMinor, sale);

    // The price of the whole booking. Multiplied BEFORE the percentages are
    // applied, so the deposit of three is the deposit on the total rather than
    // three separately rounded deposits that can differ from it by a unit.
    // The deposit and the platform fee are both shares of THIS — the price
    // after the sale — so the fee still fits inside the deposit (§40).
    const totalPriceMinor = unit.priceMinor * quantity;

    // Read live, at this instant: the fee an admin sets later must not change
    // what this customer agreed to.
    const platformFeePercentage = await this.settings.getPlatformFeePercentage();
    const amounts = computeAppointmentAmounts(
      totalPriceMinor,
      service.depositPercentage,
      platformFeePercentage,
    );

    const code = this.generateVerificationCode();
    const verificationCodeHash = await bcrypt.hash(code, BCRYPT_ROUNDS);

    const appointment = await this.prisma.$transaction(async (tx) => {
      // Serialise concurrent bookings for this location. Released automatically
      // when the transaction ends, either way.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dto.locationId}))`;

      // Re-check availability inside the lock. The client's view may be stale
      // or fabricated, so the server never trusts it.
      await this.assertSlotBookable(
        dto.locationId,
        startTime,
        service.durationMinutes,
        quantity,
      );

      return tx.appointment.create({
        data: {
          locationId: dto.locationId,
          serviceId: dto.serviceId,
          customerId,
          startTime,
          endTime,
          status: AppointmentStatus.PENDING_PAYMENT,
          ...amounts,
          // The inputs those amounts came from, recorded alongside them. Same
          // values, same transaction — this changes no arithmetic.
          // The WHOLE booking's price (§136); one unit's is beside it.
          servicePriceMinor: totalPriceMinor,
          unitPriceMinor: unit.priceMinor,
          // What it was before the sale, and how much off (§186).
          discountPercent: unit.discount?.percent ?? null,
          listPriceMinor: unit.discount ? unit.discount.listPriceMinor * quantity : null,
          quantity,
          capacityUnits: quantity,
          depositPercentage: service.depositPercentage,
          platformFeePercentage,
          // Both written from the same generated value, in the same statement:
          // the hash is what `verify()` compares against, the plaintext is what
          // the customer's own app displays (§54.2). One of the only two places
          // a code is ever issued — the other is `resendVerificationCode`.
          // Said explicitly, not defaulted. The column used to default to
          // "USD" in the schema, which silently mislabelled every amount in
          // any deployment not denominated in dollars (§66.3).
          currency: INTERNAL_CURRENCY,
          verificationCodeHash,
          verificationCode: code,
        },
        select: APPOINTMENT_SELECT,
      });
    });

    const customer = await this.prisma.user.findUniqueOrThrow({
      where: { id: customerId },
      select: { email: true },
    });
    await this.mail.sendAppointmentVerificationEmail(customer.email, code, {
      serviceName: service.name,
      locationName: location.name,
      startTime,
    });

    // Recorded AFTER the send, so it means "an email went out" rather than "we
    // intended to send one" (§53.2). A timestamp, never the code.
    //
    // The response is rebuilt from this update rather than from the row read
    // inside the transaction, which predates the send and would report null —
    // a flag saying "no code was sent" on the very response that sent one.
    const withCodeSent = await this.prisma.appointment.update({
      where: { id: appointment.id },
      data: { verificationCodeSentAt: new Date() },
      select: APPOINTMENT_SELECT,
    });

    // Every booking gets a conversation, created here rather than as a
    // separate customer action — a booking should always have somewhere to
    // talk without anyone having to set that up.
    await this.chat.createAppointmentThread({
      appointmentId: appointment.id,
      customerId,
      businessProfileId: location.businessId,
    });

    // The business learns about the booking immediately, while it is still
    // unpaid — a held slot they cannot see is worse than one they can.
    const loaded = await this.notificationContext(appointment.id);
    if (loaded) {
      await this.notifications.notifyBusiness({
        businessId: loaded.businessId,
        type: NotificationType.APPOINTMENT_BOOKED,
        context: loaded.context,
        appointmentId: appointment.id,
      });
    }

    this.logger.log(
      `Appointment ${appointment.id} created PENDING_PAYMENT: deposit=${amounts.depositAmountMinor}c ` +
        `(fee=${amounts.platformFeeAmountMinor}c, business=${amounts.businessAmountMinor}c) ` +
        `at ${platformFeePercentage.toFixed(2)}% platform fee.`,
    );

    // Always a customer: only @Roles(CUSTOMER) reaches this route.
    return this.withApproxSettlement(withCodeSent, await this.rateContext());
  }

  /**
   * Confirms the requested window is genuinely bookable.
   *
   * Delegates to AvailabilityService rather than reimplementing the rules, so
   * opening hours, schedule exceptions, time blocks, capacity and the
   * fits-before-closing rule are all applied exactly as the customer-facing
   * availability endpoint applies them. Anything else would let the two drift.
   */
  private async assertSlotBookable(
    locationId: string,
    startTime: Date,
    durationMinutes: number,
    capacityUnits = 1,
  ) {
    const { slots, localStart } = await this.availability.getBookableStartTimes(
      locationId,
      startTime,
      durationMinutes,
      capacityUnits,
    );

    if (!slots.includes(localStart)) {
      throw new BadRequestException(
        `That time is not available. Requested ${localStart}; check GET /locations/${locationId}/availability for open slots.`,
      );
    }
  }

  /**
   * The provider that issued an appointment's payment reference (§57.2).
   *
   * Falls back to the single configured provider only when the column is null,
   * which means the row predates §57 — and those rows all belong to MTN, since
   * it was the only implementation that ever existed. The migration backfilled
   * them, so this path should be unreachable; it exists so a row written by
   * something other than `initiateDepositPayment` cannot crash the poller.
   */
  private providerFor(appointment: { paymentProvider: MobileMoneyProvider | null }) {
    return appointment.paymentProvider
      ? this.payments.require(appointment.paymentProvider)
      : this.payments.requireOnlyOne();
  }

  private generateVerificationCode(): string {
    return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  // ---------- Lifecycle ----------

  /**
   * Starts collecting the deposit through the configured payment provider.
   *
   * Replaces the temporary `mark-deposit-paid` seam, which flipped the status
   * with no money involved. The appointment deliberately STAYS in
   * PENDING_PAYMENT: the provider has only been asked to prompt the customer's
   * handset, and an accepted request is not a completed payment. Only
   * confirmed success moves it to BOOKED, and that confirmation arrives from
   * the polling job or from a `payment-status` read.
   *
   * Re-initiating is allowed while an attempt is in flight only if the previous
   * reference has been cleared by a failure; otherwise the existing attempt is
   * returned, so a customer double-tapping does not trigger two charges.
   */
  async initiateDepositPayment(
    customerId: string,
    appointmentId: string,
    phoneNumber: string,
    chosenProvider?: MobileMoneyProvider,
  ): Promise<InitiateDepositPaymentResponseDto> {
    const appointment = await this.requireCustomerAppointment(customerId, appointmentId);

    if (appointment.status !== AppointmentStatus.PENDING_PAYMENT) {
      throw new BadRequestException(
        `A deposit can only be paid while an appointment is PENDING_PAYMENT. This one is ${appointment.status}.`,
      );
    }

    // An attempt is already outstanding — do not start a second one. Two
    // request-to-pay calls for one appointment means two prompts on the
    // customer's phone and, if they approve both, two debits for one booking.
    if (appointment.paymentProviderReferenceId) {
      throw new BadRequestException(
        'A payment for this appointment is already in progress. Approve the prompt on your phone, ' +
          'or wait for it to time out before trying again.',
      );
    }

    // ---- Convert the internal USD deposit into the provider's currency ----
    //
    // Everything upstream is in the internal currency's minor units; the provider charges in whatever
    // `providerCurrency` says. This is the ONLY point where the two meet.
    const { providerCurrency, rate, updatedAt } = await this.settings.getExchangeRate();

    if (!rate) {
      // Deliberately fatal. Guessing a rate, or sending the raw USD figure as
      // though it were the provider's currency, would charge the customer a
      // silently wrong amount — and it would look like a successful payment.
      // Refusing loudly is the only acceptable behaviour for a money bug.
      this.logger.error(
        `Deposit initiation blocked for appointment ${appointmentId}: no ${INTERNAL_CURRENCY}->${providerCurrency} exchange rate configured.`,
      );
      throw new BadRequestException(
        'Exchange rate not configured. Deposit payments cannot be taken until an administrator sets the ' +
          `${INTERNAL_CURRENCY} to ${providerCurrency} exchange rate.`,
      );
    }

    // Exponent-aware since §55.2: both currencies' decimal places are applied
    // on the way through, so an internal currency with two of them and a
    // provider currency with none convert correctly rather than by a factor of
    // 100.
    const providerAmountMinor = convertMinorUnits(
      appointment.depositAmountMinor,
      INTERNAL_CURRENCY,
      providerCurrency,
      rate,
    );

    // A rate small enough to round a real deposit down to zero would have the
    // provider collect nothing while the appointment booked normally.
    if (providerAmountMinor <= 0) {
      this.logger.error(
        `Deposit initiation blocked for appointment ${appointmentId}: ${appointment.depositAmountMinor} ` +
          `${INTERNAL_CURRENCY} minor converts to ${providerAmountMinor} ${providerCurrency} minor at rate ${rate.toFixed(8)}.`,
      );
      throw new BadRequestException(
        'The configured exchange rate converts this deposit to zero. Check the rate before taking payments.',
      );
    }

    this.logger.log(
      `Converting deposit for appointment ${appointmentId}: ` +
        `${appointment.depositAmountMinor} ${INTERNAL_CURRENCY} minor x ${rate.toFixed(8)} = ` +
        `${providerAmountMinor} ${providerCurrency} minor` +
        (updatedAt ? ` (rate set ${updatedAt.toISOString()})` : ''),
    );

    // Which operator takes this payment, in order of authority (§58.1):
    //
    //   1. what the customer explicitly chose — they know their own network,
    //      and a ported number makes them the only reliable source;
    //   2. what their prefix implies, which is right for most numbers;
    //   3. the single configured operator, when neither of the above applies.
    //
    // `require` throws a 503 naming what IS accepted if the chosen operator is
    // not available here — better than silently collecting on another network,
    // which charges the wrong SIM and fails in a way nobody can explain.
    const chosen = chosenProvider ?? inferOperator(phoneNumber);
    const provider = chosen
      ? this.payments.require(chosen)
      : this.payments.requireOnlyOne();

    const result = await provider.initiatePayment({
      phoneNumber,
      amountMinor: providerAmountMinor,
      currency: providerCurrency,
      // Our own id, so the provider's records reconcile against ours.
      externalReferenceId: appointment.id,
      payerMessage: 'Appointment deposit',
      payeeNote: `Deposit for appointment ${appointment.id}`,
    });

    if (result.status === 'FAILED') {
      this.logger.error(
        `Deposit initiation failed for appointment ${appointmentId}: ${result.failureReason ?? 'unknown reason'}`,
      );

      // A CONFIGURATION failure is the platform's fault and will not fix itself
      // (§52.2). The customer gets a plain, honest message; the admins get told,
      // because until now nobody was — the cause lived only in a server log a
      // support agent could not see, and every deposit was failing.
      if (result.failureKind === 'CONFIGURATION') {
        await this.notifyAdminsOfProviderMisconfiguration(
          appointmentId,
          result.failureReason,
        );
        throw new ServiceUnavailableException(
          'Payments are temporarily unavailable. You have NOT been charged, and ' +
            'your booking is still held — please try again shortly. Our team has ' +
            'been notified.',
        );
      }

      throw new BadRequestException(
        `Could not start the payment: ${result.failureReason ?? 'the payment provider rejected the request.'} ` +
          'You have not been charged. Please try again.',
      );
    }

    await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        // Recorded WITH the reference, never separately: a reference whose
        // operator is unknown cannot be polled, so the two are one fact (§57.2).
        paymentProvider: provider.key,
        paymentProviderReferenceId: result.providerReferenceId,
        paymentInitiatedAt: new Date(),
        // Recorded alongside the USD amounts, never instead of them: a
        // provider statement that disagrees with our ledger can only be
        // explained if both figures and the rate between them survive.
        providerCurrency,
        providerAmountMinor: providerAmountMinor,
        exchangeRateUsed: rate,
      },
    });

    this.logger.log(
      `Deposit payment initiated for appointment ${appointmentId}: provider=${provider.key} ` +
        `reference=${result.providerReferenceId} charged=${providerAmountMinor} ${providerCurrency} minor ` +
        `(internal ${appointment.depositAmountMinor} ${INTERNAL_CURRENCY} minor)`,
    );

    return {
      appointmentId,
      status: appointment.status,
      paymentStatus: 'PENDING' as const,
      providerReferenceId: result.providerReferenceId,
      // Both sides returned, so a client never has to infer which currency a
      // bare amount was in.
      depositAmountMinor: appointment.depositAmountMinor,
      currency: appointment.currency,
      providerAmountMinor: providerAmountMinor,
      providerCurrency,
      exchangeRateUsed: rate.toFixed(8),
      message:
        'Approve the payment prompt on your phone. This appointment is held until the deposit is confirmed.',
    };
  }

  /**
   * Where this appointment's deposit has got to.
   *
   * Queries the provider directly rather than reporting the last polled value,
   * so a frontend polling this gets an answer as soon as the provider has one
   * instead of waiting for the background job's next cycle. Any resulting
   * transition is applied here too, so the two paths cannot disagree.
   */
  async getPaymentStatus(
    userId: string,
    appointmentId: string,
  ): Promise<PaymentStatusResponseDto> {
    const appointment = await this.requireParticipantAppointment(userId, appointmentId);

    const full = await this.prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      select: {
        id: true,
        status: true,
        depositAmountMinor: true,
        paymentProviderReferenceId: true,
        paymentProvider: true,
        paymentInitiatedAt: true,
      },
    });

    if (full.status !== AppointmentStatus.PENDING_PAYMENT) {
      // Terminal as far as payment is concerned: BOOKED and beyond means the
      // deposit landed; CANCELLED means it never will.
      return {
        appointmentId,
        appointmentStatus: full.status,
        paymentStatus:
          full.status === AppointmentStatus.CANCELLED
            ? ('FAILED' as const)
            : ('SUCCESSFUL' as const),
        providerReferenceId: full.paymentProviderReferenceId,
      };
    }

    if (!full.paymentProviderReferenceId) {
      return {
        appointmentId,
        appointmentStatus: full.status,
        paymentStatus: 'NOT_STARTED' as const,
        providerReferenceId: null,
      };
    }

    // The operator that ISSUED this reference, not whichever is configured now.
    // Asking the wrong one returns "no such transaction", which reads exactly
    // like a genuine failure and would cancel a paid booking (§57.2).
    const result = await this.providerFor(full).checkPaymentStatus(
      full.paymentProviderReferenceId,
    );
    const applied = await this.applyPaymentResult(
      appointmentId,
      full.paymentProviderReferenceId,
      result.status,
      result.failureReason,
    );

    return {
      appointmentId,
      appointmentStatus: applied,
      paymentStatus: result.status,
      providerReferenceId:
        result.status === 'FAILED' ? null : full.paymentProviderReferenceId,
      failureReason: result.failureReason,
    };
  }

  /**
   * Applies a provider outcome to an appointment, and returns its status after.
   *
   * The single place a payment result changes an appointment, shared by the
   * polling job and the on-demand status read so the two can never implement
   * subtly different rules.
   *
   * The update is conditional on the appointment still being PENDING_PAYMENT
   * with this same reference, so if the poll and a status read race, the loser
   * updates nothing rather than overwriting the winner.
   */
  async applyPaymentResult(
    appointmentId: string,
    providerReferenceId: string,
    status: 'PENDING' | 'SUCCESSFUL' | 'FAILED',
    failureReason?: string,
  ): Promise<AppointmentStatus> {
    if (status === 'PENDING') {
      return AppointmentStatus.PENDING_PAYMENT;
    }

    if (status === 'SUCCESSFUL') {
      // One transaction: the status change, the paid-at stamp and the two
      // ledger entries commit together or not at all. A confirmed deposit that
      // failed to reach the ledger is money the platform holds and cannot
      // account for.
      const count = await this.prisma.$transaction(async (tx) => {
        const result = await tx.appointment.updateMany({
          where: {
            id: appointmentId,
            status: AppointmentStatus.PENDING_PAYMENT,
            paymentProviderReferenceId: providerReferenceId,
          },
          // depositPaidAt is written here and nowhere else, and is never
          // cleared. Status alone cannot answer "was this ever paid?" once a
          // later transition has moved the row on (§33).
          data: { status: AppointmentStatus.BOOKED, depositPaidAt: new Date() },
        });

        // The conditional update above is also what makes the ledger write
        // exactly-once: a second confirmation for an appointment already BOOKED
        // matches no rows, so no entries are appended (§34.4).
        if (result.count > 0) {
          await this.ledger.recordDepositReceived(tx, appointmentId);
        }
        return result.count;
      });

      if (count > 0) {
        this.logger.log(
          `Deposit confirmed for appointment ${appointmentId} (reference ${providerReferenceId}) -> BOOKED.`,
        );
        // Guarded by count > 0, so a racing poll and status-read cannot both
        // announce the same confirmation.
        await this.notifyBothParties(appointmentId, NotificationType.DEPOSIT_CONFIRMED);
      }
      return AppointmentStatus.BOOKED;
    }

    // FAILED: clear the reference so the customer can start a fresh attempt.
    // The failed reference is not retryable at the provider, so keeping it
    // would strand the appointment in PENDING_PAYMENT until it expired.
    const { count } = await this.prisma.appointment.updateMany({
      where: {
        id: appointmentId,
        status: AppointmentStatus.PENDING_PAYMENT,
        paymentProviderReferenceId: providerReferenceId,
      },
      data: { paymentProviderReferenceId: null, paymentInitiatedAt: null },
    });
    if (count > 0) {
      this.logger.warn(
        `Deposit failed for appointment ${appointmentId} (reference ${providerReferenceId}): ` +
          `${failureReason ?? 'no reason given'}. Reference cleared; the customer may retry.`,
      );
      // Only the customer: a failed attempt is theirs to retry, and the
      // business has nothing to act on until it succeeds.
      const loaded = await this.notificationContext(appointmentId);
      if (loaded) {
        await this.notifications.notify({
          recipientId: loaded.customerId,
          type: NotificationType.DEPOSIT_FAILED,
          context: { ...loaded.context, reason: failureReason },
          appointmentId,
        });
      }
    }
    return AppointmentStatus.PENDING_PAYMENT;
  }

  /**
   * Verifies the customer's arrival code, moving BOOKED -> IN_PROGRESS.
   *
   * This is the gate that makes COMPLETED mean something: the business cannot
   * mark work done without the customer having handed over a code that was
   * emailed only to them.
   */
  async verify(userId: string, appointmentId: string, code: string) {
    const appointment = await this.requireBusinessAppointment(userId, appointmentId);

    if (appointment.status !== AppointmentStatus.BOOKED) {
      throw new BadRequestException(
        `Only a BOOKED appointment can be verified. This one is ${appointment.status}.`,
      );
    }
    if (!appointment.verificationCodeHash) {
      throw new BadRequestException('This appointment has no verification code.');
    }
    if (appointment.verificationAttempts >= MAX_VERIFICATION_ATTEMPTS) {
      throw new BadRequestException(
        'Too many incorrect attempts. Contact support to verify this appointment.',
      );
    }

    const matches = await bcrypt.compare(code, appointment.verificationCodeHash);
    if (!matches) {
      const updated = await this.prisma.appointment.update({
        where: { id: appointmentId },
        data: { verificationAttempts: { increment: 1 } },
        select: { verificationAttempts: true },
      });
      const remaining = MAX_VERIFICATION_ATTEMPTS - updated.verificationAttempts;
      throw new BadRequestException(
        remaining > 0
          ? `Incorrect verification code. ${remaining} attempt(s) remaining.`
          : 'Incorrect verification code. No attempts remaining.',
      );
    }

    this.logger.log(`Appointment ${appointmentId} verified by code -> IN_PROGRESS.`);

    return this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: AppointmentStatus.IN_PROGRESS,
        verifiedAt: new Date(),
        // Recorded on the code path too, not only on the manual one (§54.3).
        // If only manual verifications carried a method, CODE would be encoded
        // as "null", and null already means "verified before §54 existed".
        // Those are different facts and a reader must be able to tell them
        // apart.
        verificationMethod: VerificationMethod.CODE,
        verifiedById: userId,
      },
      select: APPOINTMENT_SELECT,
    });
  }

  /**
   * Emails the customer a FRESH arrival code, retiring the previous one (§54.1).
   *
   * Customer-triggered, on their own appointment. The business cannot ask for
   * one: a code the business could summon is a code the business controls, and
   * the whole point of it is that only the customer has it.
   *
   * The new code REPLACES the old rather than joining it. Two live codes double
   * the guessing surface and, worse, make "the code did not work" unanswerable
   * — nobody can tell whether the customer read out a stale one. Replacement is
   * structural here: `verificationCodeHash` is overwritten, so the previous
   * code stops matching the moment this succeeds.
   *
   * Attempts reset to zero, because they were spent against a code that no
   * longer exists. Carrying them over would let a stranger's typos lock a
   * customer out of every future code as well as the one they got wrong.
   */
  async resendVerificationCode(customerId: string, appointmentId: string) {
    const appointment = await this.requireCustomerAppointment(customerId, appointmentId);

    if (!this.codeIsLive(appointment.status, appointment.verifiedAt)) {
      throw new BadRequestException(
        appointment.verifiedAt
          ? 'This appointment has already been verified, so its code is spent.'
          : `An arrival code is only useful while the appointment is live. This one is ${appointment.status}.`,
      );
    }

    if (appointment.verificationCodeSentCount >= MAX_VERIFICATION_CODE_SENDS) {
      throw new BadRequestException(
        `A code has already been sent ${appointment.verificationCodeSentCount} times for this appointment. ` +
          'Ask the business to verify you in person instead.',
      );
    }

    const sentAt = appointment.verificationCodeSentAt;
    if (sentAt && Date.now() - sentAt.getTime() < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil(
        (RESEND_COOLDOWN_MS - (Date.now() - sentAt.getTime())) / 1000,
      );
      throw new BadRequestException(
        `A code was just sent. Try again in ${wait} second(s), and check your spam folder.`,
      );
    }

    const context = await this.prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      select: {
        startTime: true,
        service: { select: { name: true } },
        location: { select: { name: true } },
        customer: { select: { email: true } },
      },
    });

    const code = this.generateVerificationCode();
    const verificationCodeHash = await bcrypt.hash(code, BCRYPT_ROUNDS);

    // Written BEFORE the send. The opposite order would leave a window where an
    // email is in flight carrying a code the database has never heard of, and
    // that code would fail verification through no fault of the customer.
    await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        verificationCodeHash,
        verificationCode: code,
        verificationAttempts: 0,
        verificationCodeSentCount: { increment: 1 },
      },
    });

    await this.mail.sendAppointmentVerificationEmail(context.customer.email, code, {
      serviceName: context.service.name,
      locationName: context.location.name,
      startTime: context.startTime,
    });

    // Stamped after the send, so it keeps meaning "an email went out" (§53.2) —
    // which is also what the cooldown above must measure from. A failed send
    // therefore does not start the clock, and the customer may retry at once.
    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { verificationCodeSentAt: new Date() },
      select: CUSTOMER_APPOINTMENT_SELECT,
    });

    this.logger.log(
      `Arrival code resent for appointment ${appointmentId} ` +
        `(send ${appointment.verificationCodeSentCount + 1} of ${MAX_VERIFICATION_CODE_SENDS}).`,
    );

    return this.withApproxSettlement(updated, await this.rateContext());
  }

  /**
   * Verifies an arrival WITHOUT the code, on the business's assertion (§54.3).
   *
   * This is a deliberate hole in §16.2, which says completion must never rest
   * on "the business says so". It exists because the alternative is worse: a
   * customer standing at the counter with a flat phone and no email cannot be
   * served, and the business cannot be paid for work it is about to do.
   *
   * What makes it acceptable is not that it is hard to do — it is not — but
   * that it is IMPOSSIBLE TO DO INVISIBLY. Every manual verification records
   * the method, the individual who performed it, and what the customer recalled,
   * and notifies every admin as it happens. A business that verifies manually
   * once a month is unremarkable; one that does it for half its bookings is
   * visible in a single query, which is the control.
   *
   * The note is NOT checked against the appointment, and that is not laziness.
   * Every fact a server could check here — the service, the time, the price —
   * is already on the business's own screen, so checking them would confirm
   * that the business can read, not that the customer is present. A validated
   * challenge would look like a second code while proving nothing, which is
   * worse than an honest attestation.
   */
  async verifyManually(userId: string, appointmentId: string, note: string) {
    const appointment = await this.requireBusinessAppointment(userId, appointmentId);

    if (appointment.status !== AppointmentStatus.BOOKED) {
      throw new BadRequestException(
        `Only a BOOKED appointment can be verified. This one is ${appointment.status}.`,
      );
    }

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: AppointmentStatus.IN_PROGRESS,
        verifiedAt: new Date(),
        verificationMethod: VerificationMethod.MANUAL,
        verifiedById: userId,
        manualVerificationNote: note,
      },
      select: APPOINTMENT_SELECT,
    });

    this.logger.warn(
      `Appointment ${appointmentId} verified MANUALLY by user ${userId} -> IN_PROGRESS.`,
    );

    await this.notifyAdminsOfManualVerification(appointmentId, userId, note);

    return updated;
  }

  /**
   * Tells every admin that an arrival was verified without a code.
   *
   * Undebounced, like §52's misconfiguration alert and for the same reason: the
   * event is rare by design, and if it ever becomes noisy then the noise is
   * itself what an admin needs to know.
   *
   * Raised after the verification is committed, and never allowed to undo it
   * (§20.3) — a failing mail server must not strand a customer mid-appointment.
   */
  private async notifyAdminsOfManualVerification(
    appointmentId: string,
    actorId: string,
    note: string,
  ) {
    try {
      const loaded = await this.notificationContext(appointmentId);
      if (!loaded) return;

      const admins = await this.prisma.user.findMany({
        where: { role: UserRole.ADMIN },
        select: { id: true },
      });

      await Promise.all(
        admins.map((admin) =>
          this.notifications.notify({
            recipientId: admin.id,
            type: NotificationType.APPOINTMENT_MANUALLY_VERIFIED,
            context: {
              ...loaded.context,
              reason: `Verified without a code by user ${actorId}. Customer recalled: ${note}`,
            },
            appointmentId,
          }),
        ),
      );
    } catch (error) {
      this.logger.error(
        `Failed to notify admins of manual verification on ${appointmentId}: ` +
          `${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Whether an arrival code can still be used.
   *
   * One predicate, used by both the resend endpoint and the customer's read, so
   * the code a customer can see is exactly the code they can ask to be resent.
   * Two conditions expressed separately would eventually disagree, and the
   * disagreement would read as a bug in whichever one the customer hit first.
   */
  private codeIsLive(status: AppointmentStatus, verifiedAt: Date | null): boolean {
    if (verifiedAt) return false;
    return (
      status === AppointmentStatus.PENDING_PAYMENT ||
      status === AppointmentStatus.BOOKED
    );
  }

  /**
   * IN_PROGRESS -> COMPLETED. Deliberately has no bypass.
   *
   * Completing from BOOKED is rejected: without verification there is nothing
   * distinguishing "the customer came and was served" from "the business says
   * so". Since completion is what the business's earnings hang on, that
   * distinction has to be enforced rather than trusted.
   */
  async complete(userId: string, appointmentId: string) {
    const appointment = await this.requireBusinessAppointment(userId, appointmentId);

    if (appointment.status !== AppointmentStatus.IN_PROGRESS) {
      throw new BadRequestException(
        appointment.status === AppointmentStatus.BOOKED
          ? 'This appointment has not been verified yet. Enter the customer’s verification code first — an appointment cannot be completed without it.'
          : `Only an IN_PROGRESS appointment can be completed. This one is ${appointment.status}.`,
      );
    }

    this.logger.log(`Appointment ${appointmentId} -> COMPLETED.`);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: AppointmentStatus.COMPLETED, completedAt: new Date() },
        select: APPOINTMENT_SELECT,
      });
      // Resolving the appointment is what makes its money payable, so the two
      // happen together (§34.3).
      await this.ledger.releaseOnResolution(tx, appointmentId);
      return updated;
    });
  }

  /**
   * BOOKED -> NO_SHOW. Only from BOOKED: once a code has been verified the
   * customer demonstrably arrived, so no-show is no longer an available claim.
   */
  async noShow(userId: string, appointmentId: string) {
    const appointment = await this.requireBusinessAppointment(userId, appointmentId);

    if (appointment.status !== AppointmentStatus.BOOKED) {
      throw new BadRequestException(
        appointment.status === AppointmentStatus.IN_PROGRESS
          ? 'This appointment was already verified, so it cannot be marked a no-show.'
          : `Only a BOOKED appointment can be marked as a no-show. This one is ${appointment.status}.`,
      );
    }

    this.logger.log(`Appointment ${appointmentId} -> NO_SHOW.`);

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: AppointmentStatus.NO_SHOW, noShowAt: new Date() },
        select: APPOINTMENT_SELECT,
      });
      // A forfeited deposit is the business's to keep, payable a week after the
      // appointment WOULD have ended — it never reaches COMPLETED, so there is
      // no completion date to count from (§34.3).
      await this.ledger.releaseOnResolution(tx, appointmentId);
      return row;
    });

    // The customer is told, because a forfeited deposit should never be a
    // silent charge they discover later.
    const loaded = await this.notificationContext(appointmentId);
    if (loaded) {
      await this.notifications.notify({
        recipientId: loaded.customerId,
        type: NotificationType.APPOINTMENT_NO_SHOW,
        context: loaded.context,
        appointmentId,
      });
    }

    return updated;
  }

  /**
   * PENDING_PAYMENT or BOOKED -> CANCELLED, by either side.
   *
   * Not permitted from IN_PROGRESS: the service is already under way, so the
   * honest outcomes are COMPLETED or a dispute, not cancellation.
   *
   * Per DECISIONS.md §2 the deposit is non-refundable on cancellation; nothing
   * here moves money, and the refund/forfeit posting belongs to the Payments
   * module.
   */
  async cancel(
    userId: string,
    appointmentId: string,
    dto: CancelAppointmentDto = {},
  ) {
    const appointment = await this.requireParticipantAppointment(userId, appointmentId);

    const cancellable: AppointmentStatus[] = [
      AppointmentStatus.PENDING_PAYMENT,
      AppointmentStatus.BOOKED,
    ];
    if (!cancellable.includes(appointment.status)) {
      throw new BadRequestException(
        `Only a PENDING_PAYMENT or BOOKED appointment can be cancelled. This one is ${appointment.status}.`,
      );
    }

    // requireParticipantAppointment has already established that the caller is
    // one of the two parties, so this is the whole question. Derived once and
    // then PERSISTED — before §33 it was derived here, spent on a notification
    // sentence, and thrown away, which is why the refund policy could not be
    // applied to any row.
    const cancelledBy =
      appointment.customerId === userId ? CancelledBy.CUSTOMER : CancelledBy.BUSINESS;

    // A business cancelling refunds the customer and pays the refund's charge
    // (§25): the owner's or a manager's decision, not the front desk's (§277).
    if (cancelledBy === CancelledBy.BUSINESS && appointment.memberRole === BusinessMemberRole.STAFF) {
      throw new ForbiddenException(
        'Only the owner or a manager can cancel a booking — cancelling refunds the customer. Ask one of them.',
      );
    }

    if (cancelledBy === CancelledBy.BUSINESS && !dto.reason) {
      throw new BadRequestException(
        'A reason is required when a business cancels an appointment.',
      );
    }

    // A business cancelling a PAID appointment owes a refund, and the gateway's
    // charge on that refund is theirs to bear (§25). It has to be supplied:
    // nothing in the integration reports it, and guessing it from a percentage
    // would put a figure in the ledger the provider's statement disagrees with.
    const owesRefund =
      cancelledBy === CancelledBy.BUSINESS && appointment.depositPaidAt !== null;
    if (owesRefund && dto.gatewayChargeMinor === undefined) {
      throw new BadRequestException(
        'gatewayChargeMinor is required when a business cancels an appointment ' +
          'whose deposit was paid. It is the gateway\'s charge on the refund, in ' +
          'minor units of the settlement currency, and it is borne by the business.',
      );
    }

    this.logger.log(
      `Appointment ${appointmentId} -> CANCELLED by ${cancelledBy} (user ${userId}).`,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          status: AppointmentStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy,
          cancelledByUserId: userId,
          cancellationReason: dto.reason ?? null,
        },
        select: APPOINTMENT_SELECT,
      });
      if (owesRefund) {
        // The refund and the cancellation commit together. A cancellation whose
        // refund failed to record would leave the platform holding money it has
        // told a customer it gave back.
        await this.ledger.recordBusinessCancellationRefund(
          tx,
          appointmentId,
          dto.gatewayChargeMinor!,
        );
      } else {
        // A CUSTOMER cancellation releases the existing entries: the deposit is
        // not refunded (§2), so the business keeps its share. An unpaid business
        // cancellation has no entries to do anything with.
        await this.ledger.releaseOnResolution(tx, appointmentId);
      }
      return row;
    });

    // Read back from the row rather than recomputed, so the sentence the
    // customer is sent and the value the refund module will read can never
    // disagree.
    await this.notifyBothParties(
      appointmentId,
      NotificationType.APPOINTMENT_CANCELLED,
      updated.cancelledBy === CancelledBy.CUSTOMER
        ? 'Cancelled by the customer.'
        : `Cancelled by the business.${updated.cancellationReason ? ` Reason: ${updated.cancellationReason}` : ''}`,
    );

    // Shared route: the caller may be either party, so the figure follows who
    // is actually reading it, not which endpoint they used.
    if (appointment.customerId !== userId) return updated;

    return this.withApproxSettlement(updated, await this.rateContext());
  }

  /**
   * An admin resolving a dispute in the customer's favour.
   *
   * Reclassifies the appointment as business-cancelled and runs the SAME refund
   * path a self-service business cancellation runs — deliberately the same
   * call, not a second implementation. Two refund paths drift, and the one that
   * drifts is the one used rarely, under pressure, in a dispute.
   *
   * `cancelledBy` becomes BUSINESS while `cancelledByUserId` stays the admin who
   * acted, which is exactly the divergence §33.2 kept the two columns apart for.
   */
  /**
   * Appointments, for an admin (§95).
   *
   * There was no admin listing at all: `reclassifyAsBusinessCancellation` took
   * an id nothing produced, so the one action on this surface could not be
   * navigated to.
   *
   * Every row carries `canReclassify` rather than leaving the client to work
   * the rule out. The three conditions — cancelled, not already blamed on the
   * business, deposit actually taken — are the same ones the PATCH enforces,
   * and a client deriving them independently would eventually disagree with it.
   */
  async listForAdmin(
    actor: { role: UserRole | string },
    query: ListAdminAppointmentsDto,
  ) {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only an administrator can list appointments.');
    }

    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    const find = query.q?.trim();
    // A reservation number is the first eight hex characters of the id,
    // shown as "3F2A-1C9B" (§213) — what a customer quotes in a dispute.
    const number = find && /^(no\.?\s*)?[0-9a-f]{4}-?[0-9a-f]{4}$/i.test(find)
      ? find.replace(/^no\.?\s*/i, '').replace('-', '').toLowerCase()
      : null;
    const contains = find ? { contains: find, mode: Prisma.QueryMode.insensitive } : undefined;

    const where: Prisma.AppointmentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.cancelledBy ? { cancelledBy: query.cancelledBy } : {}),
      ...(query.businessId ? { location: { businessId: query.businessId } } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.reclassifiable === 'true'
        ? {
            status: AppointmentStatus.CANCELLED,
            cancelledBy: { not: CancelledBy.BUSINESS },
            depositPaidAt: { not: null },
          }
        : {}),
      ...(contains
        ? {
            OR: [
              ...(number ? [{ id: { startsWith: number } }] : []),
              { customer: { email: contains } },
              { customer: { displayName: contains } },
              { service: { name: contains } },
              { location: { name: contains } },
              { location: { business: { name: contains } } },
            ],
          }
        : {}),
    };

    const [total, appointments] = await Promise.all([
      this.prisma.appointment.count({ where }),
      this.prisma.appointment.findMany({
        where,
        orderBy: [{ startTime: query.sort === AppointmentOrder.SOONEST ? 'asc' : 'desc' }, { id: 'asc' }],
        take: limit,
        skip: offset,
        select: ADMIN_APPOINTMENT_SELECT,
      }),
    ]);

    return {
      total,
      limit,
      offset,
      appointments: appointments.map(toAdminAppointment),
    };
  }

  /**
   * One booking, with everything a dispute turns on (§249): how it was paid
   * and through which operator, who checked the customer in and how, who
   * cancelled and why, the money the ledger moved for it, its review, and the
   * tickets raised about it.
   */
  async findOneForAdmin(actor: { role: UserRole | string }, appointmentId: string) {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only an administrator can read this appointment.');
    }
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        ...ADMIN_APPOINTMENT_SELECT,
        unitPriceMinor: true,
        discountPercent: true,
        listPriceMinor: true,
        paymentProvider: true,
        paymentProviderReferenceId: true,
        paymentInitiatedAt: true,
        providerCurrency: true,
        providerAmountMinor: true,
        exchangeRateUsed: true,
        verifiedBy: { select: { email: true } },
        manualVerificationNote: true,
        cancelledByUser: { select: { email: true } },
        cancellationTicket: { select: { id: true, reference: true } },
        tickets: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, reference: true, subject: true, status: true, createdAt: true },
        },
        ledgerEntries: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, type: true, amountMinor: true, currency: true, createdAt: true, payoutId: true },
        },
        review: { select: { id: true, rating: true, comment: true, hiddenAt: true, createdAt: true } },
      },
    });
    if (!appointment) throw new NotFoundException('Appointment not found.');

    const {
      verifiedBy,
      cancelledByUser,
      cancellationTicket,
      tickets,
      ledgerEntries,
      review,
      exchangeRateUsed,
      ...rest
    } = appointment;
    return {
      ...toAdminAppointment({ ...rest, review }),
      unitPriceMinor: rest.unitPriceMinor,
      discountPercent: rest.discountPercent,
      listPriceMinor: rest.listPriceMinor,
      locationAddress: rest.location.address,
      // The branch's own number when it has one, else the shop's (§5).
      shopPhone: rest.location.phone ?? rest.location.business.phone,
      paymentProvider: rest.paymentProvider,
      paymentProviderReferenceId: rest.paymentProviderReferenceId,
      paymentInitiatedAt: rest.paymentInitiatedAt,
      providerCurrency: rest.providerCurrency,
      providerAmountMinor: rest.providerAmountMinor,
      exchangeRateUsed: exchangeRateUsed === null ? null : Number(exchangeRateUsed),
      verifiedByEmail: verifiedBy?.email ?? null,
      manualVerificationNote: rest.manualVerificationNote,
      cancelledByEmail: cancelledByUser?.email ?? null,
      cancellationTicketReference: cancellationTicket?.reference ?? null,
      tickets,
      ledger: ledgerEntries,
      review,
    };
  }

  async reclassifyAsBusinessCancellation(
    actor: { userId: string; role: UserRole | string },
    appointmentId: string,
    dto: ReclassifyCancellationDto,
  ) {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Only an administrator can reclassify a cancellation.',
      );
    }

    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, status: true, cancelledBy: true, depositPaidAt: true },
    });
    if (!appointment) throw new NotFoundException('Appointment not found.');

    if (appointment.cancelledBy === CancelledBy.BUSINESS) {
      throw new BadRequestException(
        'This appointment is already recorded as a business cancellation.',
      );
    }
    if (appointment.status === AppointmentStatus.COMPLETED) {
      throw new BadRequestException(
        'A completed appointment cannot be reclassified as cancelled.',
      );
    }

    if (dto.ticketId) {
      const ticket = await this.prisma.ticket.count({ where: { id: dto.ticketId } });
      if (ticket === 0) throw new NotFoundException('Ticket not found.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          status: AppointmentStatus.CANCELLED,
          cancelledAt: appointment.status === AppointmentStatus.CANCELLED
            ? undefined
            : new Date(),
          cancelledBy: CancelledBy.BUSINESS,
          // Who ACTED. The party who bears it is the business, above.
          cancelledByUserId: actor.userId,
          cancellationReason: dto.reason,
          cancellationTicketId: dto.ticketId ?? null,
        },
        select: APPOINTMENT_SELECT,
      });

      if (appointment.depositPaidAt) {
        await this.ledger.recordBusinessCancellationRefund(
          tx,
          appointmentId,
          dto.gatewayChargeMinor,
        );
      }

      return row;
    });

    this.logger.warn(
      `Appointment ${appointmentId} reclassified as a BUSINESS cancellation by admin ` +
        `${actor.userId}${dto.ticketId ? ` on ticket ${dto.ticketId}` : ''}: ${dto.reason}`,
    );

    await this.notifyBothParties(
      appointmentId,
      NotificationType.APPOINTMENT_CANCELLED,
      `Reclassified by support as a business cancellation. Reason: ${dto.reason}`,
    );

    return updated;
  }

  /**
   * Tells every admin the platform cannot take payments.
   *
   * Deliberately not rate-limited or debounced: a configuration failure means
   * EVERY deposit is failing, and the cost of a duplicate email is nothing
   * beside the cost of nobody noticing. If it ever becomes noisy, that noise is
   * itself the signal.
   */
  private async notifyAdminsOfProviderMisconfiguration(
    appointmentId: string,
    reason?: string,
  ) {
    const admins = await this.prisma.user.findMany({
      where: { role: UserRole.ADMIN },
      select: { id: true },
    });

    await Promise.all(
      admins.map((admin) =>
        this.notifications.notify({
          recipientId: admin.id,
          type: NotificationType.PAYMENT_PROVIDER_MISCONFIGURED,
          context: {
            serviceName: 'Payments',
            locationName: 'the platform',
            businessName: 'the platform',
            startTime: undefined as unknown as Date,
            reason: `${reason ?? 'No reason given.'} (appointment ${appointmentId})`,
          },
        }),
      ),
    );
  }

  // ---------- Approximate local-currency figures (§39) ----------

  /**
   * The rate for THIS request, read once.
   *
   * Once per response, never once per item: a listing whose two services were
   * converted at different rates would be indefensible to anyone comparing
   * them, and it would happen exactly when the rate changed mid-request.
   *
   * Returns null when no rate is configured, which is the signal to omit the
   * figure entirely rather than show a zero or a placeholder.
   */
  private async rateContext(): Promise<RateContext | null> {
    // A STALE rate still converts. Staleness is an admin problem, surfaced to
    // admins (§37), and must not degrade what a customer sees. An UNSET rate
    // returns null, which omits the figure entirely — and reads quietly,
    // because this runs on every customer read (§39.2).
    return this.settings.getExchangeRateForDisplay();
  }

  /**
   * Attaches the indicative figures to one appointment response.
   *
   * Every USD amount on the response gets one, including the fee split. Picking
   * a subset would leave a client converting the rest itself, which is the
   * thing this exists to prevent. `providerAmountMinor` is deliberately
   * absent: it is already in the provider's currency and converting it again
   * would be nonsense.
   */
  private withApproxSettlement<
    T extends {
      servicePriceMinor?: number | null;
      depositAmountMinor?: number | null;
      platformFeeAmountMinor?: number | null;
      businessAmountMinor?: number | null;
    },
  >(appointment: T, context: RateContext | null): T & { approxSettlement?: ApproxSettlementMap } {
    if (!context) return appointment;

    return {
      ...appointment,
      approxSettlement: approxSettlementMap(
        {
          servicePriceMinor: appointment.servicePriceMinor,
          depositAmountMinor: appointment.depositAmountMinor,
          platformFeeAmountMinor: appointment.platformFeeAmountMinor,
          businessAmountMinor: appointment.businessAmountMinor,
        },
        context,
      ),
    };
  }

  // ---------- Reads ----------

  async findOne(userId: string, appointmentId: string) {
    const scope = await this.requireParticipantAppointment(userId, appointmentId);

    // Two branches with two projections, rather than one projection trimmed
    // afterwards. Only the customer's branch names the select that carries the
    // arrival code (§54.2), so the business branch cannot leak it by omission.
    //
    // The approximate local figure splits the same way. A business prices in
    // USD and is paid against USD, so an indicative pound figure in their view
    // would invite them to reconcile a payout against a number that means
    // nothing (§39.3).
    if (scope.customerId !== userId) {
      return this.prisma.appointment.findUniqueOrThrow({
        where: { id: appointmentId },
        select: APPOINTMENT_SELECT,
      });
    }

    const appointment = await this.prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      select: CUSTOMER_APPOINTMENT_SELECT,
    });

    return this.withApproxSettlement(
      {
        ...appointment,
        // Shown while it can still be used, null once it cannot. A spent code
        // is not a secret worth keeping, but it is not information either, and
        // rendering it next to a completed appointment invites a customer to
        // read out a number that will be refused.
        verificationCode: this.codeIsLive(appointment.status, appointment.verifiedAt)
          ? appointment.verificationCode
          : null,
      },
      await this.rateContext(),
    );
  }

  /**
   * Lists appointments the caller is entitled to see: a customer's own, or
   * every appointment across the business the caller is an active member of.
   */
  async findAll(userId: string, role: UserRole, query: ListAppointmentsDto) {
    const where: Prisma.AppointmentWhereInput = {};

    // Explicitly enumerated rather than "customer, else business". A string
    // compared against a literal falls through on any unexpected value, and
    // here the fall-through led to the WIDER scope — a whole business's
    // appointments. Anything that is not one of these two is refused.
    if (role === UserRole.CUSTOMER) {
      where.customerId = userId;
    } else if (role === UserRole.BUSINESS) {
      const membership = await this.prisma.businessMembership.findFirst({
        where: { userId, status: BusinessMemberStatus.ACTIVE },
        select: { businessProfileId: true, ...MEMBERSHIP_SCOPE_SELECT },
      });
      if (!membership) {
        throw new ForbiddenException(
          'This account is not an active member of any business.',
        );
      }
      where.location = { businessId: membership.businessProfileId };
      // Only the branches they look after (§277).
      const only = branchIn(scopeOf(membership));
      if (only) where.locationId = only;
    } else {
      throw new ForbiddenException(
        'This account type cannot list appointments.',
      );
    }

    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.startTime = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lt: new Date(query.to) } : {}),
      };
    }
    // Alongside the scope above, never instead of it (§213): a branch that is
    // not theirs narrows to nothing rather than widening (§277).
    if (query.locationId) {
      where.locationId = where.locationId
        ? { in: (where.locationId as { in: string[] }).in.filter((id) => id === query.locationId) }
        : query.locationId;
    }
    const find = query.q?.trim();
    if (find) {
      const contains = { contains: find, mode: Prisma.QueryMode.insensitive };
      // A reservation number is the first eight hex characters of the id,
      // shown as "3F2A-1C9B" (customer app, §213).
      const number = /^[0-9a-f]{4}-?[0-9a-f]{4}$/i.test(find)
        ? find.replace('-', '').toLowerCase()
        : null;
      where.OR = [
        { customer: { email: contains } },
        { service: { name: contains } },
        { location: { name: contains } },
        ...(number ? [{ id: { startsWith: number } }] : []),
      ];
    }

    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;

    const [total, appointments] = await Promise.all([
      this.prisma.appointment.count({ where }),
      this.prisma.appointment.findMany({
        where,
        orderBy: {
          startTime: query.sort === AppointmentOrder.SOONEST ? 'asc' : 'desc',
        },
        take: limit,
        skip: offset,
        // The customer's own rows carry their own review, so the list can say
        // "leave a review" or "you rated this" without a second request per row.
        select:
          role === UserRole.CUSTOMER ? CUSTOMER_LIST_SELECT : APPOINTMENT_SELECT,
      }),
    ]);

    // One rate read for the whole page, applied to every item.
    const context =
      role === UserRole.CUSTOMER ? await this.rateContext() : null;

    return {
      total,
      limit,
      offset,
      appointments: appointments.map((a) => this.withApproxSettlement(a, context)),
    };
  }

  // ---------- Access helpers ----------
  //
  // Same structural rule as the rest of the codebase: scope the query by the
  // caller, so someone else's appointment simply matches no row and 404s rather
  // than being loaded and then checked.

  private async requireCustomerAppointment(customerId: string, appointmentId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, customerId },
    });
    if (!appointment) throw new NotFoundException('Appointment not found.');
    return appointment;
  }

  private async requireBusinessAppointment(userId: string, appointmentId: string) {
    const membership = await this.prisma.businessMembership.findFirst({
      where: { userId, status: BusinessMemberStatus.ACTIVE },
      select: { businessProfileId: true, ...MEMBERSHIP_SCOPE_SELECT },
    });
    if (!membership) {
      throw new ForbiddenException(
        'This account is not an active member of any business.',
      );
    }

    // A booking at a branch that is not theirs is not found (§277).
    const only = branchIn(scopeOf(membership));
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        location: { businessId: membership.businessProfileId },
        ...(only ? { locationId: only } : {}),
      },
    });
    if (!appointment) throw new NotFoundException('Appointment not found.');
    return appointment;
  }

  /** Either the customer who booked it, or an active member of its business. */
  private async requireParticipantAppointment(userId: string, appointmentId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        status: true,
        customerId: true,
        // Needed by cancel(): whether a refund is owed turns on it.
        depositPaidAt: true,
        locationId: true,
        location: { select: { businessId: true } },
      },
    });
    if (!appointment) throw new NotFoundException('Appointment not found.');

    if (appointment.customerId === userId) return { ...appointment, memberRole: null };

    const member = await this.prisma.businessMembership.findFirst({
      where: {
        userId,
        businessProfileId: appointment.location.businessId,
        status: BusinessMemberStatus.ACTIVE,
      },
      select: MEMBERSHIP_SCOPE_SELECT,
    });
    // Not a member, or a member of another branch (§277): not found either way.
    if (!member || !seesBranch(scopeOf(member), appointment.locationId)) {
      throw new NotFoundException('Appointment not found.');
    }

    return { ...appointment, memberRole: member.role };
  }
}
