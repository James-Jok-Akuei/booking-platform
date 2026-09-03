import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BusinessMemberRole,
  BusinessMemberStatus,
  NotificationType,
  PayoutDestinationStatus,
  PayoutProvider,
  PayoutVerificationMethod,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DEFAULT_MSISDN_COUNTRY_PREFIX, maskMsisdn } from './msisdn';
import { CreatePayoutDestinationDto } from './dto/create-payout-destination.dto';
import {
  RejectPayoutDestinationDto,
  VerifyPayoutDestinationDto,
} from './dto/verify-payout-destination.dto';
import { ListPayoutDestinationsDto } from './dto/list-payout-destinations.dto';

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
  provider: PayoutProvider;
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
  provider: PayoutProvider;
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
  private readonly countryPrefix: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    config: ConfigService,
  ) {
    // Configurable, not hardcoded. The same reasoning as PLATFORM_TIMEZONE
    // (§12): a country baked into a constant is a redeploy the first time the
    // platform crosses a border, and it would be found by a business unable to
    // submit a perfectly valid number.
    this.countryPrefix =
      config.get<string>('PAYOUT_MSISDN_COUNTRY_PREFIX') ?? DEFAULT_MSISDN_COUNTRY_PREFIX;
  }

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
    const msisdn = this.assertValidMsisdn(dto.msisdn);

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
          provider: dto.provider ?? undefined,
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

    const where: Prisma.PayoutDestinationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
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
          businessProfile: { select: { id: true, name: true, phone: true } },
        },
      }),
    ]);

    return { total, limit, offset, destinations };
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

  private assertValidMsisdn(raw: string) {
    const msisdn = raw.replace(/\s+/g, '');
    if (!msisdn.startsWith(this.countryPrefix)) {
      throw new BadRequestException(
        `msisdn must be a ${this.countryPrefix} number. Payouts are sent through a ` +
          'local mobile-money provider, and a number outside that country cannot ' +
          'receive them.',
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
      select: { businessProfileId: true, role: true },
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
  private async requireOwner(userId: string) {
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
      where: { role: UserRole.ADMIN },
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
