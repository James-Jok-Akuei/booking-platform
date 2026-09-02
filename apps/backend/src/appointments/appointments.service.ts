import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  BusinessMemberStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { PlatformSettingsService } from '../settings/platform-settings.service';
import {
  PAYMENT_PROVIDER,
  PaymentProvider,
} from '../payments/payment-provider.interface';
import {
  INTERNAL_CURRENCY,
  convertUsdCentsToProviderCents,
} from '../payments/currency';
import { AvailabilityService } from '../availability/availability.service';
import { computeAppointmentAmounts } from './appointment-pricing';
import { NotificationsService } from '../notifications/notifications.service';
import { ChatService } from '../chat/chat.service';
import { NotificationType } from '@prisma/client';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { ListAppointmentsDto } from './dto/list-appointments.dto';

const BCRYPT_ROUNDS = 10;

/** Wrong-code attempts before the code is locked, mirroring OTP handling. */
export const MAX_VERIFICATION_ATTEMPTS = 5;

const APPOINTMENT_SELECT = {
  id: true,
  status: true,
  startTime: true,
  endTime: true,
  depositAmountCents: true,
  platformFeeAmountCents: true,
  businessAmountCents: true,
  currency: true,
  paymentProviderReferenceId: true,
  paymentInitiatedAt: true,
  providerCurrency: true,
  providerCurrencyAmountCents: true,
  exchangeRateUsed: true,
  verifiedAt: true,
  completedAt: true,
  cancelledAt: true,
  noShowAt: true,
  createdAt: true,
  location: { select: { id: true, name: true, address: true, businessId: true } },
  service: { select: { id: true, name: true, priceCents: true, durationMinutes: true } },
  customer: { select: { id: true, email: true } },
} as const;

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly settings: PlatformSettingsService,
    private readonly availability: AvailabilityService,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
    private readonly notifications: NotificationsService,
    private readonly chat: ChatService,
  ) {}

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
        depositAmountCents: true,
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
        depositAmountCents: appointment.depositAmountCents,
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
    const startTime = new Date(dto.startTime);
    if (Number.isNaN(startTime.getTime())) {
      throw new BadRequestException('startTime is not a valid date-time.');
    }

    const service = await this.prisma.service.findUnique({
      where: { id: dto.serviceId },
      select: {
        id: true,
        businessId: true,
        isActive: true,
        priceCents: true,
        durationMinutes: true,
        depositPercentage: true,
        name: true,
      },
    });
    if (!service) throw new NotFoundException('Service not found.');

    const location = await this.prisma.location.findUnique({
      where: { id: dto.locationId },
      select: { id: true, businessId: true, name: true, address: true },
    });
    if (!location) throw new NotFoundException('Location not found.');

    // Services belong to a business and are shared across its locations
    // (DECISIONS.md §10.2), so the pairing must be checked explicitly —
    // otherwise a customer could book one business's service at another's shop.
    if (service.businessId !== location.businessId) {
      throw new BadRequestException(
        'That service is not offered at this location.',
      );
    }
    if (!service.isActive) {
      throw new BadRequestException('That service is no longer available.');
    }

    // endTime is derived, never taken from the client.
    const endTime = new Date(startTime.getTime() + service.durationMinutes * 60_000);

    // Read live, at this instant: the fee an admin sets later must not change
    // what this customer agreed to.
    const platformFeePercentage = await this.settings.getPlatformFeePercentage();
    const amounts = computeAppointmentAmounts(
      service.priceCents,
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
      await this.assertSlotBookable(dto.locationId, startTime, service.durationMinutes);

      return tx.appointment.create({
        data: {
          locationId: dto.locationId,
          serviceId: dto.serviceId,
          customerId,
          startTime,
          endTime,
          status: AppointmentStatus.PENDING_PAYMENT,
          ...amounts,
          verificationCodeHash,
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
      `Appointment ${appointment.id} created PENDING_PAYMENT: deposit=${amounts.depositAmountCents}c ` +
        `(fee=${amounts.platformFeeAmountCents}c, business=${amounts.businessAmountCents}c) ` +
        `at ${platformFeePercentage.toFixed(2)}% platform fee.`,
    );

    return appointment;
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
  ) {
    const { slots, localStart } = await this.availability.getBookableStartTimes(
      locationId,
      startTime,
      durationMinutes,
    );

    if (!slots.includes(localStart)) {
      throw new BadRequestException(
        `That time is not available. Requested ${localStart}; check GET /locations/${locationId}/availability for open slots.`,
      );
    }
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
  ) {
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
    // Everything upstream is USD cents; the provider charges in whatever
    // `providerCurrency` says. This is the ONLY point where the two meet.
    const { providerCurrency, rate, updatedAt } = await this.settings.getExchangeRate();

    if (!rate) {
      // Deliberately fatal. Guessing a rate, or sending the raw USD figure as
      // though it were the provider's currency, would charge the customer a
      // silently wrong amount — and it would look like a successful payment.
      // Refusing loudly is the only acceptable behaviour for a money bug.
      this.logger.error(
        `Deposit initiation blocked for appointment ${appointmentId}: no USD->${providerCurrency} exchange rate configured.`,
      );
      throw new BadRequestException(
        'Exchange rate not configured. Deposit payments cannot be taken until an administrator sets the ' +
          `${INTERNAL_CURRENCY} to ${providerCurrency} exchange rate.`,
      );
    }

    const providerAmountCents = convertUsdCentsToProviderCents(
      appointment.depositAmountCents,
      rate,
    );

    // A rate small enough to round a real deposit down to zero would have the
    // provider collect nothing while the appointment booked normally.
    if (providerAmountCents <= 0) {
      this.logger.error(
        `Deposit initiation blocked for appointment ${appointmentId}: ${appointment.depositAmountCents} ` +
          `${INTERNAL_CURRENCY} cents converts to ${providerAmountCents} ${providerCurrency} cents at rate ${rate.toFixed(8)}.`,
      );
      throw new BadRequestException(
        'The configured exchange rate converts this deposit to zero. Check the rate before taking payments.',
      );
    }

    this.logger.log(
      `Converting deposit for appointment ${appointmentId}: ` +
        `${appointment.depositAmountCents} ${INTERNAL_CURRENCY} cents x ${rate.toFixed(8)} = ` +
        `${providerAmountCents} ${providerCurrency} cents` +
        (updatedAt ? ` (rate set ${updatedAt.toISOString()})` : ''),
    );

    const result = await this.payments.initiatePayment({
      phoneNumber,
      amountCents: providerAmountCents,
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
      throw new BadRequestException(
        `Could not start the payment: ${result.failureReason ?? 'the payment provider rejected the request.'} Please try again.`,
      );
    }

    await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        paymentProviderReferenceId: result.providerReferenceId,
        paymentInitiatedAt: new Date(),
        // Recorded alongside the USD amounts, never instead of them: a
        // provider statement that disagrees with our ledger can only be
        // explained if both figures and the rate between them survive.
        providerCurrency,
        providerCurrencyAmountCents: providerAmountCents,
        exchangeRateUsed: rate,
      },
    });

    this.logger.log(
      `Deposit payment initiated for appointment ${appointmentId}: provider=${this.payments.name} ` +
        `reference=${result.providerReferenceId} charged=${providerAmountCents}c ${providerCurrency} ` +
        `(internal ${appointment.depositAmountCents}c ${INTERNAL_CURRENCY})`,
    );

    return {
      appointmentId,
      status: appointment.status,
      paymentStatus: 'PENDING' as const,
      providerReferenceId: result.providerReferenceId,
      // Both sides returned, so a client never has to infer which currency a
      // bare amount was in.
      depositAmountCents: appointment.depositAmountCents,
      currency: appointment.currency,
      providerCurrencyAmountCents: providerAmountCents,
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
  async getPaymentStatus(userId: string, appointmentId: string) {
    const appointment = await this.requireParticipantAppointment(userId, appointmentId);

    const full = await this.prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      select: {
        id: true,
        status: true,
        depositAmountCents: true,
        paymentProviderReferenceId: true,
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

    const result = await this.payments.checkPaymentStatus(full.paymentProviderReferenceId);
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
      const { count } = await this.prisma.appointment.updateMany({
        where: {
          id: appointmentId,
          status: AppointmentStatus.PENDING_PAYMENT,
          paymentProviderReferenceId: providerReferenceId,
        },
        data: { status: AppointmentStatus.BOOKED },
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

    this.logger.log(`Appointment ${appointmentId} verified -> IN_PROGRESS.`);

    return this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: AppointmentStatus.IN_PROGRESS,
        verifiedAt: new Date(),
      },
      select: APPOINTMENT_SELECT,
    });
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

    return this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.COMPLETED, completedAt: new Date() },
      select: APPOINTMENT_SELECT,
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

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.NO_SHOW, noShowAt: new Date() },
      select: APPOINTMENT_SELECT,
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
  async cancel(userId: string, appointmentId: string) {
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

    this.logger.log(`Appointment ${appointmentId} -> CANCELLED.`);

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.CANCELLED, cancelledAt: new Date() },
      select: APPOINTMENT_SELECT,
    });

    await this.notifyBothParties(
      appointmentId,
      NotificationType.APPOINTMENT_CANCELLED,
      appointment.customerId === userId
        ? 'Cancelled by the customer.'
        : 'Cancelled by the business.',
    );

    return updated;
  }

  // ---------- Reads ----------

  async findOne(userId: string, appointmentId: string) {
    await this.requireParticipantAppointment(userId, appointmentId);
    return this.prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      select: APPOINTMENT_SELECT,
    });
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
        select: { businessProfileId: true },
      });
      if (!membership) {
        throw new ForbiddenException(
          'This account is not an active member of any business.',
        );
      }
      where.location = { businessId: membership.businessProfileId };
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

    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;

    const [total, appointments] = await Promise.all([
      this.prisma.appointment.count({ where }),
      this.prisma.appointment.findMany({
        where,
        orderBy: { startTime: 'desc' },
        take: limit,
        skip: offset,
        select: APPOINTMENT_SELECT,
      }),
    ]);

    return { total, limit, offset, appointments };
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
      select: { businessProfileId: true },
    });
    if (!membership) {
      throw new ForbiddenException(
        'This account is not an active member of any business.',
      );
    }

    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        location: { businessId: membership.businessProfileId },
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
        location: { select: { businessId: true } },
      },
    });
    if (!appointment) throw new NotFoundException('Appointment not found.');

    if (appointment.customerId === userId) return appointment;

    const member = await this.prisma.businessMembership.count({
      where: {
        userId,
        businessProfileId: appointment.location.businessId,
        status: BusinessMemberStatus.ACTIVE,
      },
    });
    if (member === 0) throw new NotFoundException('Appointment not found.');

    return appointment;
  }
}
