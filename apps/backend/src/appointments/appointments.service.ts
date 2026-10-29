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
  NotificationCategory,
  RefundReason,
  SupportActionKind,
  UserRole,
  VerificationMethod,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import {
  APPOINTMENT_SELECT,
  CUSTOMER_APPOINTMENT_SELECT,
  CUSTOMER_LIST_SELECT,
  HEALTH_CHOICES_SELECT,
} from './appointment-select';
import { HealthChoices } from './health-choices';
import { MomoHealthService } from '../payments/momo-health.service';
import { RefundsService } from '../refunds/refunds.service';
import { CHOICE_GROUPS_SELECT } from '../business/dto/service-choices.dto';
import {
  CHOICES_EDITABLE_UNTIL_MINUTES,
  ChoicePick,
  isWish,
  resolvePicks,
  tidyNote,
} from '../business/service-choices';
import { UpdateBookingChoicesDto } from './dto/update-booking-choices.dto';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales';
import { DATE_TAGS, formatDateIn, asLocale, say } from '../i18n/say';

import { PrismaService } from '../prisma/prisma.service';
import { askHowItWent } from './how-it-went';
import { MailService } from '../mail/mail.service';
import { BOOKING_FACTS_SELECT, bookingFacts } from '../mail/booking-email';
import { PlatformSettingsService } from '../settings/platform-settings.service';
import { PaymentProviderRegistry } from '../payments/payment-provider.registry';
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
import { SupportActor, SupportLogService } from '../support/support-log.service';
import { SupportCancelForShopDto, SupportCheckInDto, SupportReasonDto } from '../support/support.dto';
import { CountriesService } from '../countries/countries.service';

/** What our support team did, in one reader's language (§297, §308). */
type SupportWords = (l: Locale) => { title: string; body: string };

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
 * A customer who cancels at least this long before the start gets the whole
 * deposit back (§313); later, or not coming, it is not refunded (Terms 6.2).
 * The apps keep a copy of the number to say the deadline; this one decides.
 */
export const FREE_CANCELLATION_HOURS = 24;

/** Whether a customer cancelling at `now` is in time for the deposit to come back (§313). */
export const cancelledInTime = (startTime: Date, now = new Date()) =>
  startTime.getTime() - now.getTime() >= FREE_CANCELLATION_HOURS * 3_600_000;



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

/**
 * What our support team may do on a booking now (§297) — one rule, used by
 * each action to refuse and by the console to offer, so the two never
 * disagree (§118).
 */
export function supportOptions(a: {
  status: AppointmentStatus;
  cancelledBy: CancelledBy | null;
  depositPaidAt: Date | null;
  verifiedAt: Date | null;
}) {
  const live = a.status === AppointmentStatus.PENDING_PAYMENT || a.status === AppointmentStatus.BOOKED;
  return {
    checkIn: a.status === AppointmentStatus.BOOKED,
    complete: a.status === AppointmentStatus.BOOKED || a.status === AppointmentStatus.IN_PROGRESS,
    fixNoShow: a.status === AppointmentStatus.NO_SHOW,
    cancelForCustomer: live,
    // On the shop's side: a booking still to come; a no-show the shop caused;
    // or a cancellation that was really the shop's, when a deposit was paid.
    cancelForShop:
      live ||
      a.status === AppointmentStatus.NO_SHOW ||
      (a.status === AppointmentStatus.CANCELLED && a.cancelledBy !== CancelledBy.BUSINESS && a.depositPaidAt !== null),
    resendCode: live && !a.verifiedAt,
    checkPayment: a.status === AppointmentStatus.PENDING_PAYMENT,
  };
}

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
  /** What support may do on it now (§297). */
  support: supportOptions(appointment),
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
    private readonly support: SupportLogService,
    private readonly health: HealthChoices,
    private readonly momo: MomoHealthService,
    private readonly refunds: RefundsService,
    private readonly countries: CountriesService,
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
   *
   * `timeZone` is the shop's country's clock (§315), the one its slots are in.
   */
  private resolveStartTime(raw: string, timeZone: string): Date {
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
    return zonedWallTimeToInstant(calendarDate, Number(hour) * 60 + Number(minute), timeZone);
  }

  /**
   * Loads everything the notification templates need for one appointment.
   *
   * One helper rather than widening each call site's select, so adding a field
   * to a template does not mean hunting through five queries.
   */
  async notificationContext(appointmentId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        startTime: true,
        customerId: true,
        depositAmountMinor: true,
        currency: true,
        depositPaidAt: true,
        refund: { select: { id: true } },
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
        // Whether any money changed hands: a booking cancelled before its
        // deposit was paid has nothing to refund or keep (§292).
        depositPaid: Boolean(appointment.depositPaidAt),
        // Whether the deposit goes back (§313): said in each side's message.
        refunded: Boolean(appointment.refund),
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
        // What the customer answers while booking (§300), and whether a note is taken.
        choiceGroups: CHOICE_GROUPS_SELECT,
        noteEnabled: true,
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
        business: { select: { status: true, pausedAt: true, publishedAt: true, countryCode: true } },
      },
    });
    if (!location) throw new NotFoundException('Location not found.');

    // The time asked for, on the shop's own clock (§315) — the clock its slots are in.
    const timeZone = await this.countries.zoneOf(location.business.countryCode);
    const startTime = this.resolveStartTime(dto.startTime, timeZone);

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

    // What was picked (§300), checked against the service's questions as they
    // are now, and what it adds. A note only where the service takes one —
    // refused rather than dropped, because the customer wrote it for the shop.
    const choices = resolvePicks(service.choiceGroups, dto.optionIds ?? []);
    const note = tidyNote(dto.note);
    if (note && !service.noteEnabled) {
      throw new BadRequestException(
        'This service no longer takes a note. Remove yours, and send it in a message after booking.',
      );
    }

    // endTime is derived, never taken from the client — the service's length
    // and the answers' extra minutes (§300.4).
    const durationMinutes = service.durationMinutes + choices.minutes;
    const endTime = new Date(startTime.getTime() + durationMinutes * 60_000);

    // One unit's price as the customer was shown it: after the sale, if one
    // is on today (§186). The sale is taken off ONE and then multiplied, so
    // the card's price times three is exactly what three cost.
    const sale = liveDiscount(service, platformToday(timeZone), timeZone);
    const unit = priceFor(offer.priceMinor, sale);

    // The price of the whole booking. Multiplied BEFORE the percentages are
    // applied, so the deposit of three is the deposit on the total rather than
    // three separately rounded deposits that can differ from it by a unit.
    // The deposit and the platform fee are both shares of THIS — the price
    // after the sale — so the fee still fits inside the deposit (§40).
    //
    // The answers are added after that, once per booking (§300.3): long hair
    // costs the same extra whether one person comes or three, and a sale is
    // on the service's own price, never on what the answers add.
    const totalPriceMinor = unit.priceMinor * quantity + choices.priceMinor;
    if (totalPriceMinor < 0) {
      throw new BadRequestException(
        'With these answers the price would be below nothing. Please pick other answers, or ask the shop.',
      );
    }

    // Read live, at this instant: the fee an admin sets later must not change
    // what this customer agreed to. The shop's country's fee (§315).
    const platformFeePercentage = await this.settings.getPlatformFeePercentage(location.business.countryCode);
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
        durationMinutes,
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
          listPriceMinor: unit.discount
            ? unit.discount.listPriceMinor * quantity + choices.priceMinor
            : null,
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
          // What was picked, copied as it is now (§300): a shop changing its
          // questions later never rewrites this booking.
          ...(choices.picks.length > 0 ? { choices: choices.picks as unknown as Prisma.InputJsonValue } : {}),
          choicesPriceMinor: choices.priceMinor,
          choicesMinutes: choices.minutes,
          healthChoicesSealed: this.health.seal(choices.healthPicks),
          customerNote: note,
        },
        select: APPOINTMENT_SELECT,
      });
    });

    const customer = await this.prisma.user.findUniqueOrThrow({
      where: { id: customerId },
      select: { email: true, locale: true },
    });
    // The whole booking, so the email can show it as a ticket (§292).
    const booked = await this.prisma.appointment.findUniqueOrThrow({
      where: { id: appointment.id },
      select: BOOKING_FACTS_SELECT,
    });
    await this.mail.sendAppointmentVerificationEmail(customer.email, code, bookingFacts(booked), asLocale(customer.locale));

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
   * Changing wishes after booking (§300.7), until 2 hours before.
   *
   * Only the questions whose answers change neither the price nor the time
   * — "no salt", a quiet room, allergies — read as the service asks them now,
   * and the note. Every other answer stays exactly as booked: the deposit was
   * worked out from it, and the request to pay may already be on the phone.
   * So the price, the deposit and the length never move here.
   *
   * The shop is told that something changed, never what — a health answer
   * may be among them, and the booking shows it.
   */
  async changeChoices(customerId: string, appointmentId: string, dto: UpdateBookingChoicesDto) {
    await this.requireCustomerAppointment(customerId, appointmentId);
    const booking = await this.prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      select: {
        status: true,
        startTime: true,
        choices: true,
        customerNote: true,
        healthChoicesSealed: true,
        service: { select: { noteEnabled: true, choiceGroups: CHOICE_GROUPS_SELECT } },
      },
    });

    if (booking.status !== AppointmentStatus.PENDING_PAYMENT && booking.status !== AppointmentStatus.BOOKED) {
      throw new BadRequestException('This booking can no longer be changed.');
    }
    if (booking.startTime.getTime() - Date.now() < CHOICES_EDITABLE_UNTIL_MINUTES * 60_000) {
      throw new BadRequestException(
        'Wishes can be changed until 2 hours before. Send the shop a message instead.',
      );
    }

    const groups = booking.service.choiceGroups;
    const wishes = groups.filter(isWish);
    const wishIds = new Set(wishes.map((group) => group.id));
    const asBooked = (booking.choices as unknown as ChoicePick[] | null) ?? [];
    const healthAsBooked = this.health.open(booking.healthChoicesSealed) ?? [];

    // An answer to a question that changes the price or the time stays as booked.
    const fixed = new Set(groups.filter((group) => !wishIds.has(group.id)).flatMap((g) => g.options.map((o) => o.id)));
    if (dto.optionIds.some((id) => fixed.has(id))) {
      throw new BadRequestException(
        'Answers that change the price or the time can’t be changed after booking. Message the shop if you need to.',
      );
    }

    const kept = asBooked.filter((pick) => !wishIds.has(pick.groupId));
    const keptHealth = healthAsBooked.filter((pick) => !wishIds.has(pick.groupId));
    const before = new Set([...asBooked, ...healthAsBooked].map((pick) => pick.optionId));
    const now = resolvePicks(wishes, dto.optionIds, {
      alsoPicked: kept.map((pick) => pick.optionId),
      stillPicked: before,
    });

    // In the order the shop asks now; answers to questions since removed last.
    const order = new Map(groups.map((group, index) => [group.id, index]));
    const inOrder = (picks: ChoicePick[]) =>
      picks
        .map((pick, index) => ({ pick, index }))
        .sort((a, b) => (order.get(a.pick.groupId) ?? groups.length) - (order.get(b.pick.groupId) ?? groups.length) || a.index - b.index)
        .map(({ pick }) => pick);
    const choices = inOrder([...kept, ...now.picks]);
    const healthChoices = inOrder([...keptHealth, ...now.healthPicks]);

    let note = booking.customerNote;
    if (dto.note !== undefined) {
      note = tidyNote(dto.note);
      if (note && note !== booking.customerNote && !booking.service.noteEnabled) {
        throw new BadRequestException('This service no longer takes a note. Send the shop a message instead.');
      }
    }

    const ids = (picks: ChoicePick[]) => picks.map((pick) => pick.optionId).sort().join(',');
    const changed =
      ids(choices) !== ids(asBooked) || ids(healthChoices) !== ids(healthAsBooked) || note !== booking.customerNote;
    if (!changed) return this.findOne(customerId, appointmentId);

    await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        choices: choices.length > 0 ? (choices as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        healthChoicesSealed: this.health.seal(healthChoices),
        customerNote: note,
        choicesChangedAt: new Date(),
      },
    });

    const loaded = await this.notificationContext(appointmentId);
    if (loaded) {
      await this.notifications.notifyBusiness({
        businessId: loaded.businessId,
        type: NotificationType.BOOKING_CHOICES_CHANGED,
        context: loaded.context,
        appointmentId,
      });
    }
    return this.findOne(customerId, appointmentId);
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
  private async providerFor(appointment: { paymentProvider: MobileMoneyProvider | null; locationId: string }) {
    // The connection for the shop's country (§315): another country's keys never saw this reference.
    const country = await this.countries.ofLocation(appointment.locationId);
    return appointment.paymentProvider
      ? this.payments.require(appointment.paymentProvider, country)
      : this.payments.requireOnlyOne(country);
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

    // The shop's country's mobile money (§315): a Rwandan shop is paid from a
    // Rwandan number, through a network that works there.
    const country = await this.countries.ofLocation(appointment.locationId);
    if (!this.countries.isMobileIn(country, phoneNumber)) {
      throw new BadRequestException(
        `Pay with a mobile money number in ${country.name}, like ${country.phoneExample}. You have not been charged.`,
      );
    }
    if (chosenProvider && !country.networks.includes(chosenProvider)) {
      throw new BadRequestException(`${chosenProvider} is not a mobile money network in ${country.name}. You have not been charged.`);
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
    const chosen = chosenProvider ?? this.countries.inferNetwork(country, phoneNumber);
    const provider = chosen
      ? this.payments.require(chosen, country)
      : this.payments.requireOnlyOne(country);

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
      // The operator not answering, or payments down — what shops and customers are told about (§310).
      if (result.failureKind === 'TRANSIENT' || result.failureKind === 'CONFIGURATION') this.momo.record('unreachable');

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

      // The operator not answering (§282): said in words a customer can act
      // on, not as the operator's own error — and as 503, because it is.
      if (result.failureKind === 'TRANSIENT') {
        throw new ServiceUnavailableException(
          'MTN MoMo is not answering right now, so the payment could not start. You have NOT been ' +
            'charged, and your booking is still held for a few minutes — please try again shortly.',
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
        // Where a refund goes back to, if one is ever owed (§313).
        paymentPhoneNumber: phoneNumber.replace(/\D/g, ''),
        paymentInitiatedAt: new Date(),
        // Recorded alongside the USD amounts, never instead of them: a
        // provider statement that disagrees with our ledger can only be
        // explained if both figures and the rate between them survive.
        providerCurrency,
        providerAmountMinor: providerAmountMinor,
        exchangeRateUsed: rate,
      },
    });

    this.momo.record('started');
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
        locationId: true,
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

    const { result, applied } = await this.askOperator(appointmentId, {
      paymentProviderReferenceId: full.paymentProviderReferenceId,
      paymentProvider: full.paymentProvider,
      locationId: full.locationId,
    });

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
   * Asks the operator about a deposit now, and applies what it says (§57.2).
   * Shared by the parties' status read and support's "ask MTN" (§297).
   */
  private async askOperator(
    appointmentId: string,
    full: { paymentProviderReferenceId: string; paymentProvider: MobileMoneyProvider | null; locationId: string },
  ) {
    // The operator that ISSUED this reference, not whichever is configured now.
    // Asking the wrong one returns "no such transaction", which reads exactly
    // like a genuine failure and would cancel a paid booking (§57.2).
    const result = await (await this.providerFor(full)).checkPaymentStatus(full.paymentProviderReferenceId);
    const applied = await this.applyPaymentResult(
      appointmentId,
      full.paymentProviderReferenceId,
      result.status,
      result.failureReason,
    );
    return { result, applied };
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
        this.momo.record('paid');
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
      this.momo.record('failed');
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

    await this.issueFreshCode(appointmentId);
    const updated = await this.prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      select: CUSTOMER_APPOINTMENT_SELECT,
    });

    this.logger.log(
      `Arrival code resent for appointment ${appointmentId} ` +
        `(send ${appointment.verificationCodeSentCount + 1} of ${MAX_VERIFICATION_CODE_SENDS}).`,
    );

    return this.withApproxSettlement(updated, await this.rateContext());
  }

  /**
   * A new arrival code, emailed to the customer; the old one stops working
   * (§54.1). Shared by the customer's own "send it again" and support's (§297).
   */
  private async issueFreshCode(appointmentId: string) {
    const context = await this.prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      select: { ...BOOKING_FACTS_SELECT, customer: { select: { email: true, locale: true } } },
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

    await this.mail.sendAppointmentVerificationEmail(
      context.customer.email,
      code,
      bookingFacts(context),
      asLocale(context.customer.locale),
    );

    // Stamped after the send, so it keeps meaning "an email went out" (§53.2) —
    // which is also what the cooldown must measure from. A failed send
    // therefore does not start the clock, and the customer may retry at once.
    await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { verificationCodeSentAt: new Date() },
    });
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
        where: { role: UserRole.ADMIN, closedAt: null },
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

    const completed = await this.prisma.$transaction(async (tx) => {
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
    // "How was it?" (§287).
    await askHowItWent(this.prisma, this.notifications, appointmentId);
    return completed;
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
    // Not before its time is over (§313): a customer may arrive late, in the
    // middle of their slot, and be served. A no-show marked early took a
    // deposit for a visit that could still have happened.
    if (appointment.endTime.getTime() > Date.now()) {
      throw new BadRequestException(
        'A no-show can be marked only once the booking’s time has ended. Until then the customer may still come — check them in when they do.',
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

    // A customer cancels until the start (§313). After it, not coming is a
    // missed booking — the money is the same, and the record stays true.
    if (
      cancelledBy === CancelledBy.CUSTOMER &&
      appointment.status === AppointmentStatus.BOOKED &&
      appointment.startTime.getTime() <= Date.now()
    ) {
      throw new BadRequestException(
        'Your booking’s time has started, so it can no longer be cancelled. If you cannot come, write to the shop from the booking.',
      );
    }

    // A business cancelling a PAID appointment owes a refund, and the gateway's
    // charge on that refund is theirs to bear (§25). ~~It has to be supplied~~
    // — the shop's own app never could, so every paid cancellation from it
    // was refused (§313). Now: whatever the shop's team typed, or nothing; the
    // operator's real charge, once the refund is sent and the statement shows
    // it, is added by our team as an adjustment.
    const owesRefund =
      cancelledBy === CancelledBy.BUSINESS && appointment.depositPaidAt !== null;
    // A customer who cancels at least 24 hours before gets it all back (§313).
    const inTime =
      cancelledBy === CancelledBy.CUSTOMER &&
      appointment.depositPaidAt !== null &&
      cancelledInTime(appointment.startTime);

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
          dto.gatewayChargeMinor ?? 0,
        );
        await this.refunds.owe(tx, appointmentId, RefundReason.SHOP_CANCELLED);
      } else if (inTime) {
        await this.ledger.recordCustomerRefund(tx, appointmentId);
        await this.refunds.owe(tx, appointmentId, RefundReason.CANCELLED_IN_TIME);
      } else {
        // A CUSTOMER cancellation releases the existing entries: the deposit is
        // not refunded (§2), so the business keeps its share. An unpaid business
        // cancellation has no entries to do anything with.
        await this.ledger.releaseOnResolution(tx, appointmentId);
      }
      return row;
    });

    // On its way at once, not at the next minute's run (§313).
    if (owesRefund || inTime) void this.refunds.sendDue().catch(() => undefined);

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
        // What was chosen (§300). The sealed column only to say there IS
        // something private — it is opened by support, with a reason.
        choices: true,
        choicesPriceMinor: true,
        choicesMinutes: true,
        customerNote: true,
        choicesChangedAt: true,
        healthChoicesSealed: true,
        healthChoicesRemovedAt: true,
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
      healthChoicesSealed,
      ...rest
    } = appointment;
    return {
      ...toAdminAppointment({ ...rest, review }),
      choices: rest.choices,
      choicesPriceMinor: rest.choicesPriceMinor,
      choicesMinutes: rest.choicesMinutes,
      customerNote: rest.customerNote,
      choicesChangedAt: rest.choicesChangedAt,
      hasHealthChoices: healthChoicesSealed !== null,
      healthChoicesRemovedAt: rest.healthChoicesRemovedAt,
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

  /**
   * Cancelling on the shop's side, by support (§36.4, §297) — the refund §25
   * requires when a deposit was paid, through the same ledger call a shop's
   * own cancellation makes.
   *
   * From a booking still to come (the shop asked us to, or cannot sign in), a
   * no-show the shop caused (it was closed), or a cancellation that was really
   * the shop's. Refused from IN_PROGRESS (the service has started), COMPLETED,
   * one already on the shop, and an unpaid cancellation (nothing to give back)
   * — the rule `supportOptions` publishes (§297 closed the gap where the route
   * took more than the console offered).
   */
  async reclassifyAsBusinessCancellation(
    actor: { userId: string; role: UserRole | string },
    appointmentId: string,
    dto: ReclassifyCancellationDto | SupportCancelForShopDto,
  ) {
    this.support.check(actor, dto);
    const ticket = await this.support.ticket(dto.ticketId);

    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, status: true, cancelledBy: true, depositPaidAt: true, verifiedAt: true },
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
    if (!supportOptions(appointment).cancelForShop) {
      throw new BadRequestException(
        appointment.status === AppointmentStatus.IN_PROGRESS
          ? 'The customer is already checked in. Mark it done, or answer the dispute another way.'
          : 'This cancellation had no paid deposit, so there is nothing to give back.',
      );
    }

    const wasLive =
      appointment.status === AppointmentStatus.PENDING_PAYMENT || appointment.status === AppointmentStatus.BOOKED;
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
        // A customer's in-time cancellation already gave it back (§313): it
        // is now the shop's, and the shop carries the operator's charge.
        const refunded = await tx.refund.findUnique({ where: { appointmentId }, select: { id: true } });
        if (!refunded) {
          await this.ledger.recordBusinessCancellationRefund(tx, appointmentId, dto.gatewayChargeMinor ?? 0);
          await this.refunds.owe(tx, appointmentId, RefundReason.SHOP_CANCELLED);
        }
      } else {
        await this.ledger.releaseOnResolution(tx, appointmentId);
      }

      await this.support.record(
        actor,
        {
          kind: SupportActionKind.CANCEL_FOR_SHOP,
          reason: dto.reason,
          appointmentId,
          ticketId: ticket?.id,
          details: { from: appointment.status, refunded: Boolean(appointment.depositPaidAt) },
          ticketNote: (l) =>
            appointment.depositPaidAt
              ? say(l, 'We cancelled this booking on the shop’s side. The customer gets their whole deposit back.')
              : say(l, 'We cancelled this booking on the shop’s side. No deposit had been paid.'),
        },
        tx,
      );
      return row;
    });

    if (appointment.depositPaidAt) void this.refunds.sendDue().catch(() => undefined);

    this.logger.warn(
      `Appointment ${appointmentId} reclassified as a BUSINESS cancellation by admin ` +
        `${actor.userId}${dto.ticketId ? ` on ticket ${dto.ticketId}` : ''}: ${dto.reason}`,
    );

    await this.notifyBothParties(
      appointmentId,
      NotificationType.APPOINTMENT_CANCELLED,
      wasLive
        ? `Cancelled by support for the shop. Reason: ${dto.reason}`
        : `Reclassified by support as a business cancellation. Reason: ${dto.reason}`,
    );

    return updated;
  }

  // ---------- Support, on someone's behalf (§297) ----------

  /** "Tuesday 20 October at 11:15", as the shop and the customer know the time: on the shop's clock (§315). */
  private spokenTime(at: Date, l: Locale, zone: string) {
    const day = formatDateIn(l, at, { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '');
    const time = new Intl.DateTimeFormat(DATE_TAGS[l], { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(at);
    return say(l, '{day} at {time}', { day, time });
  }

  /** The booking, as support's actions need it. */
  private async forSupport(appointmentId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        status: true,
        customerId: true,
        startTime: true,
        verificationCodeHash: true,
        verifiedAt: true,
        verificationCodeSentAt: true,
        depositPaidAt: true,
        cancelledBy: true,
        paymentProviderReferenceId: true,
        paymentProvider: true,
        locationId: true,
        service: { select: { name: true } },
        location: { select: { businessId: true, business: { select: { name: true, countryCode: true } } } },
      },
    });
    if (!appointment) throw new NotFoundException('Appointment not found.');
    // The shop's clock (§315), for saying the booking's time to either side.
    return { ...appointment, timeZone: await this.countries.zoneOf(appointment.location.business.countryCode) };
  }

  /**
   * Tells the shop and the customer what support did (§297), in the words
   * given — each side its own. The person whose help request it answers has
   * a reply in it already, so they are not told twice.
   */
  private async tellAboutSupport(
    appointmentId: string,
    words: { customer?: SupportWords; shop?: SupportWords },
    ticket: { reporterId: string } | null,
  ) {
    const loaded = await this.notificationContext(appointmentId);
    if (!loaded) return;
    const except = ticket?.reporterId ?? null;
    // Written out for each reader in their own language (§308).
    const told = (said: SupportWords) => {
      const english = said(DEFAULT_LOCALE);
      return {
        ...loaded.context,
        serviceName: english.title,
        reason: english.body,
        compose: (l: Locale) => {
          const { title, body } = said(l);
          return { subject: title, body };
        },
      };
    };
    if (words.customer && loaded.customerId !== except) {
      await this.notifications.notify({
        recipientId: loaded.customerId,
        type: NotificationType.SUPPORT_UPDATE,
        context: told(words.customer),
        appointmentId,
        category: NotificationCategory.BOOKINGS,
        link: `/booking/${appointmentId}`,
      });
    }
    if (words.shop) {
      await this.notifications.notifyBusiness({
        businessId: loaded.businessId,
        type: NotificationType.SUPPORT_UPDATE,
        context: told(words.shop),
        appointmentId,
        category: NotificationCategory.BOOKINGS,
        link: `/appointments?tab=all&open=${appointmentId}`,
        except,
      });
    }
  }

  /**
   * Checks a customer in for the shop (§297): when the shop's app failed, or
   * five wrong codes locked it. With the customer's code, read out to us; or
   * without it, the reason saying how we know they are there — recorded as a
   * manual check-in, like a shop's own (§54.3). Attempts do not count here:
   * a wrong code is said plainly and nothing is locked.
   */
  async supportCheckIn(actor: SupportActor, appointmentId: string, dto: SupportCheckInDto) {
    this.support.check(actor, dto);
    const ticket = await this.support.ticket(dto.ticketId);
    const appointment = await this.forSupport(appointmentId);
    if (!supportOptions(appointment).checkIn) {
      throw new BadRequestException(`Only a booking that is expected can be checked in. This one is ${appointment.status}.`);
    }
    const updated = await this.checkInBySupport(actor, appointment, dto, ticket?.id ?? null);
    await this.tellAboutSupport(
      appointmentId,
      {
        shop: (l) => ({
          title: say(l, 'Our support team checked a customer in'),
          body: say(
            l,
            'We checked the customer in for {serviceName} on {when}, because it could not be done in the app. Mark it done when the service is finished, as usual.',
            { serviceName: appointment.service.name, when: this.spokenTime(appointment.startTime, l, appointment.timeZone) },
          ),
        }),
        customer: (l) => ({
          title: say(l, 'You are checked in'),
          body: appointment.location.business.name
            ? say(l, 'Our support team checked you in at {shop} for {serviceName}.', {
                shop: appointment.location.business.name,
                serviceName: appointment.service.name,
              })
            : say(l, 'Our support team checked you in for {serviceName}.', { serviceName: appointment.service.name }),
        }),
      },
      ticket,
    );
    return updated;
  }

  /** The check-in itself, with the code or without, written down. */
  private async checkInBySupport(
    actor: SupportActor,
    appointment: { id: string; verificationCodeHash: string | null; service: { name: string } },
    dto: SupportCheckInDto,
    ticketId: string | null,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    if (dto.code) {
      if (!appointment.verificationCodeHash || !(await bcrypt.compare(dto.code, appointment.verificationCodeHash))) {
        throw new BadRequestException(
          "That is not this booking's code. Ask the customer to read it from their booking in the app — or check them in without it, saying how you know they came.",
        );
      }
    } else if (dto.reason.trim().length < 10) {
      throw new BadRequestException('Without the code, say how you know the customer came — a sentence at least.');
    }
    const updated = await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        status: AppointmentStatus.IN_PROGRESS,
        verifiedAt: new Date(),
        verificationMethod: dto.code ? VerificationMethod.CODE : VerificationMethod.MANUAL,
        verifiedById: actor.userId,
        ...(dto.code ? {} : { manualVerificationNote: `By support: ${dto.reason.trim()}` }),
      },
      select: APPOINTMENT_SELECT,
    });
    await this.support.record(
      actor,
      {
        kind: SupportActionKind.CHECK_IN,
        reason: dto.reason,
        appointmentId: appointment.id,
        ticketId,
        details: { withCode: Boolean(dto.code) },
        ticketNote: (l) => say(l, 'We checked the customer in for {serviceName}.', { serviceName: appointment.service.name }),
      },
      tx,
    );
    return updated;
  }

  /**
   * Marks a booking done for the shop (§297) — after the visit, when the app
   * failed on the day. From BOOKED it checks the customer in first, with the
   * code or the reason, then marks it done: the money becomes the shop's as
   * a shop's own "done" makes it, and the customer is asked how it was.
   */
  async supportComplete(actor: SupportActor, appointmentId: string, dto: SupportCheckInDto) {
    this.support.check(actor, dto);
    const ticket = await this.support.ticket(dto.ticketId);
    const appointment = await this.forSupport(appointmentId);
    if (!supportOptions(appointment).complete) {
      throw new BadRequestException(`Only a booking that is expected or in progress can be marked done. This one is ${appointment.status}.`);
    }
    const completed = await this.prisma.$transaction(async (tx) => {
      if (appointment.status === AppointmentStatus.BOOKED) {
        await this.checkInBySupport(actor, appointment, dto, ticket?.id ?? null, tx);
      }
      const row = await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: AppointmentStatus.COMPLETED, completedAt: new Date() },
        select: APPOINTMENT_SELECT,
      });
      await this.ledger.releaseOnResolution(tx, appointmentId);
      await this.support.record(
        actor,
        {
          kind: SupportActionKind.COMPLETE,
          reason: dto.reason,
          appointmentId,
          ticketId: ticket?.id,
          ticketNote: (l) =>
            say(l, 'We marked {serviceName} as done. The shop is paid for it as usual.', {
              serviceName: appointment.service.name,
            }),
        },
        tx,
      );
      return row;
    });
    await askHowItWent(this.prisma, this.notifications, appointmentId);
    await this.tellAboutSupport(
      appointmentId,
      {
        shop: (l) => ({
          title: say(l, 'Our support team marked a booking done'),
          body: say(
            l,
            'We marked {serviceName} on {when} as done, because it could not be done in the app. Your share of the deposit is paid to you as usual.',
            { serviceName: appointment.service.name, when: this.spokenTime(appointment.startTime, l, appointment.timeZone) },
          ),
        }),
      },
      ticket,
    );
    return completed;
  }

  /**
   * Puts right a booking wrongly marked as missed (§297): the customer came,
   * but nobody checked them in, and it became a no-show by itself (§20) or by
   * the shop's mistake. It becomes done: the customer's record is right again
   * and they can review the visit. The money does not move — a no-show's
   * deposit was already the shop's, as a done booking's is.
   */
  async supportFixNoShow(actor: SupportActor, appointmentId: string, dto: SupportReasonDto) {
    this.support.check(actor, dto);
    const ticket = await this.support.ticket(dto.ticketId);
    const appointment = await this.forSupport(appointmentId);
    if (!supportOptions(appointment).fixNoShow) {
      throw new BadRequestException(`Only a booking marked as missed can be put right this way. This one is ${appointment.status}.`);
    }
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          status: AppointmentStatus.COMPLETED,
          completedAt: now,
          noShowAt: null,
          verifiedAt: now,
          verificationMethod: VerificationMethod.MANUAL,
          verifiedById: actor.userId,
          manualVerificationNote: `By support, after the visit: ${dto.reason.trim()}`,
        },
        select: APPOINTMENT_SELECT,
      });
      await this.support.record(
        actor,
        {
          kind: SupportActionKind.FIX_NO_SHOW,
          reason: dto.reason,
          appointmentId,
          ticketId: ticket?.id,
          details: { from: AppointmentStatus.NO_SHOW, to: AppointmentStatus.COMPLETED },
          ticketNote: (l) =>
            say(l, 'We corrected {serviceName}: it was marked as missed, but the customer came. It now counts as done.', {
              serviceName: appointment.service.name,
            }),
        },
        tx,
      );
      return row;
    });
    await askHowItWent(this.prisma, this.notifications, appointmentId);
    await this.tellAboutSupport(
      appointmentId,
      {
        customer: (l) => ({
          title: say(l, 'Your booking is corrected'),
          body: appointment.location.business.name
            ? say(
                l,
                'Your visit to {shop} for {serviceName} was marked as missed, but you came. Our support team corrected it: it now counts as done, and you can leave a review.',
                { shop: appointment.location.business.name, serviceName: appointment.service.name },
              )
            : say(
                l,
                'Your visit for {serviceName} was marked as missed, but you came. Our support team corrected it: it now counts as done, and you can leave a review.',
                { serviceName: appointment.service.name },
              ),
        }),
        shop: (l) => ({
          title: say(l, 'Our support team corrected a missed booking'),
          body: say(
            l,
            '{serviceName} on {when} was marked as missed, but the customer came. It now counts as done. Nothing changes in your money.',
            { serviceName: appointment.service.name, when: this.spokenTime(appointment.startTime, l, appointment.timeZone) },
          ),
        }),
      },
      ticket,
    );
    return updated;
  }

  /**
   * Cancels for a customer who asked us to (§297) — their app would not let
   * them. A customer's cancellation in every way: at least 24 hours before,
   * the deposit goes back (§313); later, it is not given back (§2), and the
   * shop keeps its share.
   */
  async supportCancelForCustomer(actor: SupportActor, appointmentId: string, dto: SupportReasonDto) {
    this.support.check(actor, dto);
    const ticket = await this.support.ticket(dto.ticketId);
    const appointment = await this.forSupport(appointmentId);
    if (!supportOptions(appointment).cancelForCustomer) {
      throw new BadRequestException(`Only a booking still to come can be cancelled. This one is ${appointment.status}.`);
    }
    const inTime = appointment.depositPaidAt !== null && cancelledInTime(appointment.startTime);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          status: AppointmentStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: CancelledBy.CUSTOMER,
          cancelledByUserId: actor.userId,
          cancellationReason: dto.reason,
          cancellationTicketId: ticket?.id ?? null,
        },
        select: APPOINTMENT_SELECT,
      });
      if (inTime) {
        await this.ledger.recordCustomerRefund(tx, appointmentId);
        await this.refunds.owe(tx, appointmentId, RefundReason.CANCELLED_IN_TIME);
      } else {
        await this.ledger.releaseOnResolution(tx, appointmentId);
      }
      await this.support.record(
        actor,
        {
          kind: SupportActionKind.CANCEL_FOR_CUSTOMER,
          reason: dto.reason,
          appointmentId,
          ticketId: ticket?.id,
          ticketNote: (l) =>
            inTime
              ? say(l, 'We cancelled your booking, as you asked. It was more than 24 hours before, so your whole deposit comes back to you.')
              : appointment.depositPaidAt
                ? say(l, 'We cancelled your booking, as you asked. As agreed when you booked, the deposit is not given back.')
                : say(l, 'We cancelled your booking, as you asked. No deposit had been paid.'),
        },
        tx,
      );
      return row;
    });
    if (inTime) void this.refunds.sendDue().catch(() => undefined);
    await this.notifyBothParties(appointmentId, NotificationType.APPOINTMENT_CANCELLED, 'Cancelled by support for the customer.');
    return updated;
  }

  /**
   * Emails the customer a new arrival code (§297) — theirs did not arrive, or
   * was lost. The old one stops working. The code is never shown to us. The
   * five-send limit a customer has does not apply; the minute between sends does.
   */
  async supportResendCode(actor: SupportActor, appointmentId: string, dto: SupportReasonDto) {
    this.support.check(actor, dto);
    const ticket = await this.support.ticket(dto.ticketId);
    const appointment = await this.forSupport(appointmentId);
    if (!supportOptions(appointment).resendCode) {
      throw new BadRequestException(
        appointment.verifiedAt
          ? 'The customer is already checked in, so the code is spent.'
          : `A code is only useful while the booking is still to come. This one is ${appointment.status}.`,
      );
    }
    const sentAt = appointment.verificationCodeSentAt;
    if (sentAt && Date.now() - sentAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new BadRequestException('A code was sent less than a minute ago. Ask them to check their spam folder first.');
    }
    await this.issueFreshCode(appointmentId);
    await this.support.record(actor, {
      kind: SupportActionKind.RESEND_CODE,
      reason: dto.reason,
      appointmentId,
      ticketId: ticket?.id,
      ticketNote: (l) => say(l, 'We emailed you a new arrival code. The old one no longer works.'),
    });
    return { message: 'A new arrival code is on its way to the customer. The old one no longer works.' };
  }

  /**
   * Asks MTN about a deposit now (§297) — "I paid but it says unpaid". What
   * MTN answers is applied exactly as the app's own check applies it: paid
   * confirms the booking, failed frees the customer to try again.
   */
  async supportCheckPayment(actor: SupportActor, appointmentId: string, ticketId?: string) {
    const input = { reason: 'Asked MTN about the deposit', ticketId };
    this.support.check(actor, input);
    const ticket = await this.support.ticket(ticketId);
    const appointment = await this.forSupport(appointmentId);
    if (!appointment.paymentProviderReferenceId) {
      return {
        appointmentStatus: appointment.status,
        paymentStatus: appointment.depositPaidAt ? ('SUCCESSFUL' as const) : ('NOT_STARTED' as const),
        failureReason: null,
      };
    }
    if (appointment.status !== AppointmentStatus.PENDING_PAYMENT) {
      return {
        appointmentStatus: appointment.status,
        paymentStatus: appointment.depositPaidAt ? ('SUCCESSFUL' as const) : ('FAILED' as const),
        failureReason: null,
      };
    }
    const { result, applied } = await this.askOperator(appointmentId, {
      paymentProviderReferenceId: appointment.paymentProviderReferenceId,
      paymentProvider: appointment.paymentProvider,
      locationId: appointment.locationId,
    });
    await this.support.record(actor, {
      kind: SupportActionKind.CHECK_PAYMENT,
      reason: input.reason,
      appointmentId,
      ticketId: ticket?.id,
      details: { answer: result.status },
      ticketNote:
        result.status === 'SUCCESSFUL'
          ? (l) => say(l, 'We checked with MTN: your deposit went through, and the booking is confirmed.')
          : result.status === 'FAILED'
            ? (l) => say(l, 'We checked with MTN: the deposit did not go through. You can try paying again from the booking.')
            : null,
    });
    return { appointmentStatus: applied, paymentStatus: result.status, failureReason: result.failureReason ?? null };
  }

  /**
   * A booking's conversation, read by support to answer a question about it
   * (§297, and the privacy policy says so). Read-only, and every reading is
   * written down with its reason — and shown on the booking to both sides.
   */
  async supportReadMessages(actor: SupportActor, appointmentId: string, dto: SupportReasonDto) {
    this.support.check(actor, dto);
    const ticket = await this.support.ticket(dto.ticketId);
    const appointment = await this.forSupport(appointmentId);
    const thread = await this.prisma.thread.findUnique({
      where: { appointmentId },
      select: {
        id: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 500,
          select: { id: true, body: true, photoUrl: true, createdAt: true, senderId: true, sender: { select: { email: true } } },
        },
      },
    });
    await this.support.record(actor, {
      kind: SupportActionKind.READ_MESSAGES,
      reason: dto.reason,
      appointmentId,
      ticketId: ticket?.id,
      details: { messages: thread?.messages.length ?? 0 },
    });
    return {
      threadId: thread?.id ?? null,
      messages: (thread?.messages ?? []).map((m) => ({
        id: m.id,
        from: m.senderId === appointment.customerId ? ('customer' as const) : ('shop' as const),
        senderEmail: m.sender.email,
        body: m.body,
        photoUrl: m.photoUrl,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  /**
   * The private answers on a booking (§300.6) — allergies, a health matter —
   * read by support with a reason, when a customer or a shop asks for help
   * with them. Written down, and said on the booking (what and when, not
   * who), like reading the conversation.
   */
  async supportReadHealthChoices(actor: SupportActor, appointmentId: string, dto: SupportReasonDto) {
    this.support.check(actor, dto);
    const ticket = await this.support.ticket(dto.ticketId);
    await this.forSupport(appointmentId);
    const booking = await this.prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      select: { healthChoicesSealed: true, healthChoicesRemovedAt: true },
    });
    const answers = this.health.open(booking.healthChoicesSealed);
    await this.support.record(actor, {
      kind: SupportActionKind.READ_HEALTH_CHOICES,
      reason: dto.reason,
      appointmentId,
      ticketId: ticket?.id,
      details: { answers: answers?.length ?? 0 },
    });
    return {
      answers: answers?.map((pick) => ({ group: pick.group, option: pick.option })) ?? null,
      removedAt: booking.healthChoicesRemovedAt?.toISOString() ?? null,
    };
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
      where: { role: UserRole.ADMIN, closedAt: null },
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

  /**
   * The health-related answers opened, for the customer's or the shop's own
   * read (§300.6), and the sealed column dropped so it never leaves.
   */
  private withHealthChoices<T extends { healthChoicesSealed: string | null }>(row: T) {
    const { healthChoicesSealed, ...rest } = row;
    return { ...rest, healthChoices: this.health.open(healthChoicesSealed) };
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
      return this.withHealthChoices(
        await this.prisma.appointment.findUniqueOrThrow({
          where: { id: appointmentId },
          select: { ...APPOINTMENT_SELECT, ...HEALTH_CHOICES_SELECT },
        }),
      );
    }

    const appointment = this.withHealthChoices(
      await this.prisma.appointment.findUniqueOrThrow({
        where: { id: appointmentId },
        select: { ...CUSTOMER_APPOINTMENT_SELECT, ...HEALTH_CHOICES_SELECT },
      }),
    );

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
          role === UserRole.CUSTOMER
            ? { ...CUSTOMER_LIST_SELECT, ...HEALTH_CHOICES_SELECT }
            : { ...APPOINTMENT_SELECT, ...HEALTH_CHOICES_SELECT },
      }),
    ]);

    // One rate read for the whole page, applied to every item.
    const context =
      role === UserRole.CUSTOMER ? await this.rateContext() : null;

    return {
      total,
      limit,
      offset,
      appointments: appointments.map((a) => this.withApproxSettlement(this.withHealthChoices(a), context)),
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
        // Needed by cancel(): whether a refund is owed turns on it, and on how
        // long before the start a customer cancels (§313).
        depositPaidAt: true,
        startTime: true,
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
