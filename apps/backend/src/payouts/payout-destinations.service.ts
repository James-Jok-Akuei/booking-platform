import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BusinessMemberRole,
  BusinessMemberStatus,
  NotificationType,
  PayoutDestinationStatus,
  MobileMoneyProvider,
  PayoutVerificationMethod,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { maskMsisdn } from './msisdn';
import { CreatePayoutDestinationDto } from './dto/create-payout-destination.dto';
import {
  RejectPayoutDestinationDto,
  VerifyPayoutDestinationDto,
} from './dto/verify-payout-destination.dto';
import { ListPayoutDestinationsDto } from './dto/list-payout-destinations.dto';
import { numberPart, placesOf, shopMatching } from './payout-search';
import { MEMBERSHIP_SCOPE_SELECT, MONEY_READERS_ONLY, mayReadMoney, scopeOf } from '../business/branch-scope';
import { CountriesService, type CountryRow } from '../countries/countries.service';

/**
 * What a caller gets back about a destination.
 *
 * Declared explicitly rather than inferred through a `Record<string, unknown>`
 * spread (§51.4). The inferred version collapsed to `{ msisdnLast3: string }`,
 * so a caller could not reach the `id` it needs to then verify the row — the
 * demo seed had to re-query the database for an id it had just been handed.
 */
export interface PayoutDestinationView {
  id: string;
  businessId: string;
  provider: MobileMoneyProvider;
  status: PayoutDestinationStatus;
  submittedById: string;
  submittedAt: Date;
  verifiedById: string | null;
  verifiedAt: Date | null;
  verificationMethod: PayoutVerificationMethod | null;
  verificationNote: string | null;
  rejectionReason: string | null;
  createdAt: Date;
  /** Always present. The last three digits, safe to show anyone. */
  msisdnLast3: string;
  /** Present only for the OWNER; omitted entirely for everyone else (§48.5). */
  msisdn?: string;
}

/** Statuses that occupy the one live slot per business. */
export const LIVE_DESTINATION_STATUSES: PayoutDestinationStatus[] = [
  PayoutDestinationStatus.UNVERIFIED,
  PayoutDestinationStatus.VERIFIED,
  PayoutDestinationStatus.REJECTED,
];

const DESTINATION_SELECT = {
  id: true,
  businessId: true,
  msisdn: true,
  provider: true,
  status: true,
  submittedById: true,
  submittedAt: true,
  verifiedById: true,
  verifiedAt: true,
  verificationMethod: true,
  verificationNote: true,
  rejectionReason: true,
  createdAt: true,
} as const;

/** The row shape `DESTINATION_SELECT` produces. */
type DestinationRow = {
  id: string;
  businessId: string;
  msisdn: string;
  provider: MobileMoneyProvider;
  status: PayoutDestinationStatus;
  submittedById: string;
  submittedAt: Date;
  verifiedById: string | null;
  verifiedAt: Date | null;
  verificationMethod: PayoutVerificationMethod | null;
  verificationNote: string | null;
  rejectionReason: string | null;
  createdAt: Date;
};

/**
 * Where a business's payouts are sent, and the proof that it is really theirs
 * (§48).
 *
 * Verification is the module rather than a flag on it: sending money to an
 * unverified number is the only mistake here that an opposing ledger entry
 * cannot undo. Everything else in this system is correctable by appending.
 */
@Injectable()
export class PayoutDestinationsService {
  private readonly logger = new Logger(PayoutDestinationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly countries: CountriesService,
  ) {}

  // ---------- Business side ----------

  /**
   * Submits a number. Always creates an UNVERIFIED row; never edits one.
   *
   * The previous live row is SUPERSEDED in the same transaction, so the partial
   * unique index is satisfied at every instant and two simultaneous submissions
   * cannot both land.
   *
   * A VERIFIED row is superseded, not mutated: the record of where money was
   * actually sent has to survive the number changing, or a later dispute has
   * nothing to read.
   */
  async submit(
    userId: string,
    dto: CreatePayoutDestinationDto,
  ): Promise<PayoutDestinationView> {
    const membership = await this.requireOwner(userId);
    // A number in the shop's own country (§315), on one of its networks.
    const country = await this.countries.ofBusiness(membership.businessProfileId);
    const msisdn = this.assertValidMsisdn(dto.msisdn, country);
    if (dto.provider && !country.networks.includes(dto.provider)) {
      throw new BadRequestException(`${dto.provider} is not a mobile money network in ${country.name}.`);
    }
    // The network the number belongs to when the shop did not say (§58.1):
    // an Airtel number is Airtel's, not the column's default.
    const provider = dto.provider ?? this.countries.inferNetwork(country, msisdn) ?? undefined;

    const destination = await this.prisma.$transaction(async (tx) => {
      await tx.payoutDestination.updateMany({
        where: {
          businessId: membership.businessProfileId,
          status: { in: LIVE_DESTINATION_STATUSES },
        },
        data: { status: PayoutDestinationStatus.SUPERSEDED },
      });

      return tx.payoutDestination.create({
        data: {
          businessId: membership.businessProfileId,
          msisdn,
          provider,
          status: PayoutDestinationStatus.UNVERIFIED,
          submittedById: userId,
        },
        select: DESTINATION_SELECT,
      });
    });

    this.logger.log(
      `Payout destination ${destination.id} submitted for business ` +
        `${membership.businessProfileId} (${maskMsisdn(msisdn)}). Payouts are paused ` +
        'until an administrator verifies it.',
    );

    await this.notifyAdmins(membership.businessProfileId, msisdn);

    return this.forOwner(destination);
  }

  /**
   * The business's own view.
   *
   * Any ACTIVE member sees the STATUS — they need to know why payouts are
   * paused. Only the OWNER sees the full number: staff have no reason to know
   * where the money goes, and it is the owner who is accountable for it being
   * right.
   */
  async findForBusiness(userId: string) {
    const membership = await this.requireActiveMember(userId);
    // Where the money goes is part of the money (§277).
    if (!mayReadMoney(membership.role, scopeOf(membership))) throw new ForbiddenException(MONEY_READERS_ONLY);

    const destination = await this.prisma.payoutDestination.findFirst({
      where: {
        businessId: membership.businessProfileId,
        status: { in: LIVE_DESTINATION_STATUSES },
      },
      orderBy: { submittedAt: 'desc' },
      select: DESTINATION_SELECT,
    });

    if (!destination) {
      return {
        destination: null,
        payoutsPaused: true,
        note:
          'No payout destination has been submitted, so payouts are paused. ' +
          'Nothing is lost — the balance is held and goes out once a number is ' +
          'submitted and verified.',
      };
    }

    const isOwner = membership.role === BusinessMemberRole.OWNER;

    return {
      destination: isOwner
        ? this.forOwner(destination)
        : { ...this.publicFields(destination), msisdnLast3: maskMsisdn(destination.msisdn) },
      payoutsPaused: destination.status !== PayoutDestinationStatus.VERIFIED,
      note: this.statusNote(destination.status),
    };
  }

  // ---------- Admin side ----------

  async list(actor: { role: UserRole | string }, query: ListPayoutDestinationsDto) {
    this.assertAdmin(actor);

    const q = query.q?.trim();
    const digits = q ? numberPart(q) : null;
    const where: Prisma.PayoutDestinationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(q
        ? {
            OR: [
              // This row's own number; the shop's other numbers are rows of their own.
              ...(digits ? [{ msisdn: { contains: digits } }] : []),
              ...shopMatching(q, { numbers: false }).map((shop) => ({ businessProfile: shop })),
              { submittedBy: { email: { contains: q, mode: Prisma.QueryMode.insensitive } } },
            ],
          }
        : {}),
    };
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;

    const [total, destinations] = await Promise.all([
      this.prisma.payoutDestination.count({ where }),
      this.prisma.payoutDestination.findMany({
        where,
        // UNVERIFIED first, then oldest first within that: a queue that buries
        // the person who has waited longest is a queue nobody is served by.
        // Postgres sorts enum values by declaration order, and UNVERIFIED is
        // declared first for exactly this reason.
        orderBy: [{ status: 'asc' }, { submittedAt: 'asc' }],
        take: limit,
        skip: offset,
        select: {
          ...DESTINATION_SELECT,
          businessProfile: { select: { id: true, name: true, phone: true, logoUrl: true } },
          submittedBy: { select: { email: true } },
          verifiedBy: { select: { email: true } },
        },
      }),
    ]);

    // What replaced each SUPERSEDED row (§78).
    //
    // The history is the point of keeping these rows at all, and a superseded
    // number with no pointer forward makes an admin infer the successor from
    // timestamps — during a payment dispute, which is exactly when guessing is
    // worst. Resolved here rather than in the client because a status filter
    // means the successor is usually not on the same page.
    //
    // And what each row came after (§245): every business on the page, so a
    // changed number can be read beside the one it replaces.
    const businessesOnPage = [...new Set(destinations.map((d) => d.businessId))];

    const successors = businessesOnPage.length
      ? await this.prisma.payoutDestination.findMany({
          where: { businessId: { in: businessesOnPage } },
          orderBy: { submittedAt: 'asc' },
          select: {
            id: true,
            businessId: true,
            msisdn: true,
            status: true,
            submittedAt: true,
          },
        })
      : [];

    const withHistory = destinations.map((destination) => {
      const earlier = successors.filter(
        (candidate) =>
          candidate.businessId === destination.businessId &&
          candidate.submittedAt < destination.submittedAt,
      );
      const before = earlier[earlier.length - 1];
      const replaces = before
        ? { id: before.id, msisdn: before.msisdn, status: before.status, submittedAt: before.submittedAt }
        : null;

      if (destination.status !== PayoutDestinationStatus.SUPERSEDED) {
        return { ...destination, replacedBy: null, replaces };
      }

      // The next submission for that business. Submissions are strictly
      // ordered, so "the next one" is unambiguous.
      const next = successors.find(
        (candidate) =>
          candidate.businessId === destination.businessId &&
          candidate.submittedAt > destination.submittedAt,
      );

      return {
        ...destination,
        replaces,
        replacedBy: next
          ? {
              id: next.id,
              msisdn: next.msisdn,
              status: next.status,
              submittedAt: next.submittedAt,
            }
          : null,
      };
    });

    const places = await placesOf(this.prisma, businessesOnPage);
    return {
      total,
      limit,
      offset,
      destinations: withHistory.map((row) => ({ ...row, places: places.get(row.businessId) ?? [] })),
    };
  }

  async verify(
    actor: { userId: string; role: UserRole | string },
    destinationId: string,
    dto: VerifyPayoutDestinationDto,
  ): Promise<PayoutDestinationView> {
    this.assertAdmin(actor);
    const destination = await this.requireDestination(destinationId);

    if (destination.status !== PayoutDestinationStatus.UNVERIFIED) {
      throw new BadRequestException(
        `Only an UNVERIFIED destination can be verified. This one is ${destination.status}.`,
      );
    }

    const updated = await this.prisma.payoutDestination.update({
      where: { id: destinationId },
      data: {
        status: PayoutDestinationStatus.VERIFIED,
        verifiedById: actor.userId,
        verifiedAt: new Date(),
        // Recorded, not implied. An OTP path later writes OTP with
        // verifiedById null, and neither row has to be reinterpreted (§48.1).
        verificationMethod: PayoutVerificationMethod.ADMIN,
        verificationNote: dto.verificationNote.trim(),
      },
      select: DESTINATION_SELECT,
    });

    this.logger.warn(
      `Payout destination ${destinationId} (${maskMsisdn(destination.msisdn)}) VERIFIED by ` +
        `admin ${actor.userId}: ${dto.verificationNote.trim()}. Money may now be sent here.`,
    );

    await this.notifyBusiness(
      destination.businessId,
      NotificationType.PAYOUT_DESTINATION_VERIFIED,
      undefined,
    );

    return this.forOwner(updated);
  }

  async reject(
    actor: { userId: string; role: UserRole | string },
    destinationId: string,
    dto: RejectPayoutDestinationDto,
  ): Promise<PayoutDestinationView> {
    this.assertAdmin(actor);
    const destination = await this.requireDestination(destinationId);

    if (destination.status !== PayoutDestinationStatus.UNVERIFIED) {
      throw new BadRequestException(
        `Only an UNVERIFIED destination can be rejected. This one is ${destination.status}.`,
      );
    }

    const updated = await this.prisma.payoutDestination.update({
      where: { id: destinationId },
      data: {
        status: PayoutDestinationStatus.REJECTED,
        rejectionReason: dto.reason.trim(),
        verifiedById: actor.userId,
        verifiedAt: new Date(),
      },
      select: DESTINATION_SELECT,
    });

    this.logger.warn(
      `Payout destination ${destinationId} REJECTED by admin ${actor.userId}: ${dto.reason.trim()}`,
    );

    await this.notifyBusiness(
      destination.businessId,
      NotificationType.PAYOUT_DESTINATION_REJECTED,
      dto.reason.trim(),
    );

    return this.forOwner(updated);
  }

  // ---------- Used by the payout run and the export ----------

  /** The VERIFIED destination for each of the given businesses, if any. */
  async verifiedFor(businessIds: string[]) {
    if (businessIds.length === 0) return new Map<string, { id: string; msisdn: string; provider: string }>();

    const rows = await this.prisma.payoutDestination.findMany({
      where: {
        businessId: { in: businessIds },
        status: PayoutDestinationStatus.VERIFIED,
      },
      select: { id: true, businessId: true, msisdn: true, provider: true },
    });

    return new Map(
      rows.map((row) => [
        row.businessId,
        { id: row.id, msisdn: row.msisdn, provider: row.provider },
      ]),
    );
  }

  // ---------- Internals ----------

  /**
   * A mobile number in the shop's country (§315): its calling code, then as
   * many digits as its mobiles have. Payouts are sent through that country's
   * networks, and a number anywhere else cannot receive them.
   */
  private assertValidMsisdn(raw: string, country: CountryRow) {
    const msisdn = raw.replace(/\s+/g, '');
    if (!msisdn.startsWith(`+${country.callingCode}`) || !this.countries.isMobileIn(country, msisdn)) {
      throw new BadRequestException(
        `msisdn must be a ${country.name} mobile number, like ${country.phoneExample}. Payouts are sent ` +
          'through a local mobile-money provider, and a number outside that country cannot receive them.',
      );
    }
    return msisdn;
  }

  private statusNote(status: PayoutDestinationStatus) {
    switch (status) {
      case PayoutDestinationStatus.VERIFIED:
        return 'Verified. Payouts go to this number.';
      case PayoutDestinationStatus.UNVERIFIED:
        return (
          'Awaiting verification by an administrator. Payouts are paused until ' +
          'then — nothing is lost, the balance is held and goes out once it is ' +
          'verified.'
        );
      case PayoutDestinationStatus.REJECTED:
        return (
          'This number was not accepted. Payouts are paused until a new one is ' +
          'submitted and verified. Nothing has been written off.'
        );
      default:
        return 'Superseded by a later submission.';
    }
  }

  /** Everything except the number itself. */
  private publicFields(destination: DestinationRow): Omit<PayoutDestinationView, 'msisdn'> {
    return {
      id: destination.id,
      businessId: destination.businessId,
      provider: destination.provider,
      status: destination.status,
      submittedById: destination.submittedById,
      submittedAt: destination.submittedAt,
      verifiedById: destination.verifiedById,
      verifiedAt: destination.verifiedAt,
      verificationMethod: destination.verificationMethod,
      verificationNote: destination.verificationNote,
      rejectionReason: destination.rejectionReason,
      createdAt: destination.createdAt,
      msisdnLast3: maskMsisdn(destination.msisdn),
    };
  }

  private forOwner(destination: DestinationRow): PayoutDestinationView {
    return { ...this.publicFields(destination), msisdn: destination.msisdn };
  }

  private async requireDestination(id: string) {
    const destination = await this.prisma.payoutDestination.findUnique({
      where: { id },
      select: { ...DESTINATION_SELECT },
    });
    if (!destination) throw new NotFoundException('Payout destination not found.');
    return destination;
  }

  /** Any ACTIVE member; used for the read. */
  private async requireActiveMember(userId: string) {
    const membership = await this.prisma.businessMembership.findFirst({
      where: { userId, status: BusinessMemberStatus.ACTIVE },
      select: { businessProfileId: true, ...MEMBERSHIP_SCOPE_SELECT },
    });
    if (!membership) {
      throw new ForbiddenException(
        'This account is not an active member of any business.',
      );
    }
    return membership;
  }

  /**
   * OWNER only, for the write.
   *
   * Redirecting where a business's money is sent is a bigger privilege than
   * running the shop day to day — a MANAGER can change prices and hours, but
   * not who gets paid.
   */
  async requireOwner(userId: string) {
    const membership = await this.requireActiveMember(userId);
    if (membership.role !== BusinessMemberRole.OWNER) {
      throw new ForbiddenException(
        'Only the business owner can set the payout destination.',
      );
    }
    return membership;
  }

  /** Admin-only, asserted here as well as by the guard (§27.1, §41). */
  private assertAdmin(actor: { role: UserRole | string }) {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only an administrator can do that.');
    }
  }

  private async notifyAdmins(businessId: string, msisdn: string) {
    const admins = await this.prisma.user.findMany({
      where: { role: UserRole.ADMIN, closedAt: null },
      select: { id: true },
    });

    await Promise.all(
      admins.map((admin) =>
        this.notifications.notify({
          recipientId: admin.id,
          type: NotificationType.PAYOUT_DESTINATION_SUBMITTED,
          context: {
            serviceName: 'Payout destination',
            locationName: 'a business',
            businessName: 'a business',
            startTime: undefined as unknown as Date,
            // Masked even to admins in the notification body: the full number
            // belongs in the admin queue behind a login, not in an email.
            reason: `Business ${businessId} submitted ${maskMsisdn(msisdn)} for verification.`,
          },
        }),
      ),
    );
  }

  private async notifyBusiness(
    businessId: string,
    type: NotificationType,
    reason?: string,
  ) {
    await this.notifications.notifyBusiness({
      businessId,
      type,
      // Where the money goes is for those who may see the money (§277).
      moneyOnly: true,
      context: {
        serviceName: 'Payout destination',
        locationName: 'your business',
        businessName: 'your business',
        startTime: undefined as unknown as Date,
        reason,
      },
    });
  }
}
