import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BusinessMemberStatus,
  NotificationType,
  Prisma,
  ReporterType,
  TicketAuthorType,
  TicketCategory,
  TicketStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TICKET_SELECT } from './dto/ticket-response.dto';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { CreateTicketMessageDto } from './dto/create-ticket-message.dto';
import { ListAdminTicketsDto, ListTicketsDto } from './dto/list-tickets.dto';
import { BillingAdjustmentDto, UpdateTicketStatusDto } from './dto/update-ticket-status.dto';
import {
  TICKET_RESOLUTION_WINDOW_DAYS,
  TransitionActor,
  findTransition,
  isPastResolutionWindow,
} from './ticket-status';
import { MEMBERSHIP_SCOPE_SELECT, branchIn, scopeOf } from '../business/branch-scope';

/** Fields a reporter is allowed to see. Internal notes are excluded by query. */
// One select, shared with the DTO that describes its result (§128.5).
const REPORTER_TICKET_SELECT = TICKET_SELECT;

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- Creation ----------

  /**
   * An administrator writes first (§287): a conversation with one customer or
   * seller, held as a support ticket so they can reply and both sides keep the
   * record — not a one-way email that cannot be answered. Assigned to the
   * administrator who started it; the person is told the usual way.
   */
  async startByAdmin(adminId: string, dto: { userId: string; subject: string; body: string; category?: TicketCategory }) {
    const person = await this.prisma.user.findFirst({
      where: { id: dto.userId, closedAt: null, role: { in: [UserRole.CUSTOMER, UserRole.BUSINESS] } },
      select: { id: true, role: true },
    });
    if (!person) throw new NotFoundException('That person was not found, or their account is closed.');

    const reporterType = person.role === UserRole.BUSINESS ? ReporterType.BUSINESS : ReporterType.CUSTOMER;
    const businessId =
      reporterType === ReporterType.BUSINESS
        ? ((
            await this.prisma.businessMembership.findFirst({
              where: { userId: person.id, status: BusinessMemberStatus.ACTIVE },
              select: { businessProfileId: true },
            })
          )?.businessProfileId ?? null)
        : null;

    const ticket = await this.prisma.$transaction(async (tx) => {
      const [{ reference }] = await tx.$queryRaw<Array<{ reference: string }>>`
        SELECT 'TKT-' || LPAD(nextval('ticket_reference_seq')::text, 6, '0') AS reference
      `;
      return tx.ticket.create({
        data: {
          reference,
          reporterId: person.id,
          reporterType,
          businessId,
          category: dto.category ?? TicketCategory.OTHER,
          subject: dto.subject.trim(),
          status: TicketStatus.IN_PROGRESS,
          assignedAdminId: adminId,
          lastMessageAt: new Date(),
          messages: {
            create: { authorId: adminId, authorType: TicketAuthorType.ADMIN, body: dto.body, isInternal: false },
          },
        },
        select: { id: true, reference: true, subject: true, reporterId: true, assignedAdminId: true },
      });
    });

    await this.notifyOnMessage(ticket, true, false);
    this.logger.log(`Ticket ${ticket.reference} started by admin ${adminId} with ${person.id}.`);
    return { id: ticket.id, reference: ticket.reference };
  }

  /**
   * Raises a ticket.
   *
   * `reporterType` is derived from the authenticated role, never read from the
   * body — otherwise a customer could file as a business and gain visibility of
   * that business's queue.
   */
  async create(
    user: { userId: string; role: string },
    dto: CreateTicketDto,
    files?: Express.Multer.File[],
  ) {
    const reporterType =
      user.role === UserRole.BUSINESS ? ReporterType.BUSINESS : ReporterType.CUSTOMER;

    let businessId: string | null = null;
    if (reporterType === ReporterType.BUSINESS) {
      const membership = await this.prisma.businessMembership.findFirst({
        where: { userId: user.userId, status: BusinessMemberStatus.ACTIVE },
        select: { businessProfileId: true },
      });
      if (!membership) {
        throw new ForbiddenException(
          'This account is not an active member of any business.',
        );
      }
      businessId = membership.businessProfileId;
    }

    if (dto.appointmentId) {
      await this.assertPartyToAppointment(user.userId, reporterType, businessId, dto.appointmentId);
    }

    const ticket = await this.prisma.$transaction(async (tx) => {
      // nextval() inside the creating transaction. Atomic and never repeats,
      // unlike reading a count and adding one, which two concurrent creates
      // would both read identically.
      const [{ reference }] = await tx.$queryRaw<Array<{ reference: string }>>`
        SELECT 'TKT-' || LPAD(nextval('ticket_reference_seq')::text, 6, '0') AS reference
      `;

      const created = await tx.ticket.create({
        data: {
          reference,
          reporterId: user.userId,
          reporterType,
          businessId,
          appointmentId: dto.appointmentId ?? null,
          category: dto.category,
          subject: dto.subject,
          lastMessageAt: new Date(),
          messages: {
            create: {
              authorId: user.userId,
              authorType: TicketAuthorType.REPORTER,
              body: dto.body,
              isInternal: false,
            },
          },
        },
        select: REPORTER_TICKET_SELECT,
      });

      return created;
    });

    await this.attach(ticket.id, null, user.userId, files);

    await this.notifyAdmins(NotificationType.TICKET_CREATED, ticket.reference, ticket.subject);

    this.logger.log(
      `Ticket ${ticket.reference} raised by ${reporterType} ${user.userId} (${dto.category}).`,
    );

    return ticket;
  }

  /**
   * Confirms the reporter is genuinely a party to the appointment.
   *
   * In the service rather than only a guard, because a guard cannot see the
   * appointmentId in the body without duplicating this query — and this is the
   * check that stops someone attaching an unrelated booking to a dispute.
   */
  private async assertPartyToAppointment(
    userId: string,
    reporterType: ReporterType,
    businessId: string | null,
    appointmentId: string,
  ) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, customerId: true, location: { select: { businessId: true } } },
    });

    // 404 rather than 403, as everywhere else: confirming an appointment exists
    // but belongs to someone else is itself a leak.
    if (!appointment) throw new NotFoundException('Appointment not found.');

    const isParty =
      reporterType === ReporterType.CUSTOMER
        ? appointment.customerId === userId
        : appointment.location.businessId === businessId;

    if (!isParty) throw new NotFoundException('Appointment not found.');
  }

  /**
   * Stores every file on one ticket or message (§83).
   *
   * Sequential rather than `Promise.all`: the rows are read back in insert
   * order, so uploading in parallel would list a reporter's files in whatever
   * order the storage driver happened to finish them. Five files at 15MB is
   * also not a load worth racing.
   */
  private async attach(
    ticketId: string,
    ticketMessageId: string | null,
    uploadedById: string,
    files: Express.Multer.File[] | undefined,
  ) {
    for (const file of files ?? []) {
      // Same StorageService the gallery and chat use — R2 when configured, the
      // dev-only local fallback otherwise.
      const url = await this.storage.upload(file.buffer, file.mimetype, `tickets/${ticketId}`);
      await this.prisma.ticketAttachment.create({
        data: {
          ticketId,
          ticketMessageId,
          url,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          uploadedById,
        },
      });
    }
  }

  // ---------- Reads ----------

  /**
   * The set of tickets this caller may see.
   *
   * Scoping goes into the WHERE clause, so another tenant's ticket never
   * matches rather than being loaded and then rejected — the same structural
   * rule the rest of the codebase uses.
   */
  private async visibilityScope(user: {
    userId: string;
    role: string;
  }): Promise<Prisma.TicketWhereInput> {
    if (user.role === UserRole.ADMIN) return {};

    if (user.role === UserRole.BUSINESS) {
      const membership = await this.prisma.businessMembership.findFirst({
        where: { userId: user.userId, status: BusinessMemberStatus.ACTIVE },
        select: { businessProfileId: true, ...MEMBERSHIP_SCOPE_SELECT },
      });
      // A business member sees the whole business's queue, not only tickets
      // they personally raised — unless they look after some branches only
      // (§277): then their own tickets, and those about their branches' bookings.
      if (!membership) return { id: '__none__' };
      const only = branchIn(scopeOf(membership));
      return {
        businessId: membership.businessProfileId,
        ...(only ? { OR: [{ reporterId: user.userId }, { appointment: { locationId: only } }] } : {}),
      };
    }

    return { reporterId: user.userId };
  }

  async list(user: { userId: string; role: string }, query: ListTicketsDto) {
    // Not declared: the rows carry Dates, which TicketDto describes as strings.
    // The DTO is bound to TICKET_SELECT instead (§128.11).
    const scope = await this.visibilityScope(user);
    const where: Prisma.TicketWhereInput = {
      AND: [
        scope,
        query.status ? { status: query.status } : {},
        query.category ? { category: query.category } : {},
      ],
    };

    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;

    const [total, tickets] = await Promise.all([
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        take: limit,
        skip: offset,
        select: REPORTER_TICKET_SELECT,
      }),
    ]);

    return { total, limit, offset, tickets: tickets.map((t) => this.withLazyClosure(t)) };
  }

  /**
   * The admin queue: every ticket on the platform, unscoped by design.
   *
   * Because it applies no tenant scoping, `@Roles(ADMIN)` on the controller was
   * its ONLY protection — verified by removing that decorator, at which point
   * an ordinary customer's token returned another user's private ticket (§27.3).
   * Every other read in this project is guarded twice, and a method whose whole
   * purpose is to bypass scoping is the last one that should be the exception.
   *
   * The role is therefore re-asserted here, so a future controller that forgets
   * the decorator fails closed rather than leaking the table.
   */
  async listForAdmin(actor: { userId: string; role: string }, query: ListAdminTicketsDto) {
    // Not declared: the rows carry Dates, which TicketDto describes as strings.
    // The DTO is bound to TICKET_SELECT instead (§128.11).
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only administrators can list all tickets.');
    }

    const q = query.q?.trim();
    const where: Prisma.TicketWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.assignedAdminId ? { assignedAdminId: query.assignedAdminId } : {}),
      ...(q
        ? {
            OR: [
              { reference: { contains: q, mode: 'insensitive' } },
              { subject: { contains: q, mode: 'insensitive' } },
              { reporter: { email: { contains: q, mode: 'insensitive' } } },
              { businessProfile: { name: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;

    const [total, tickets] = await Promise.all([
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          ...REPORTER_TICKET_SELECT,
          // What an inbox is read by (§247): who wrote, which shop, who has
          // it, and the latest word — one message, not the conversation.
          reporter: { select: { email: true } },
          businessProfile: { select: { name: true, logoUrl: true } },
          assignedAdmin: { select: { email: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { body: true, authorType: true, isInternal: true, createdAt: true },
          },
        },
      }),
    ]);

    return {
      total,
      limit,
      offset,
      tickets: tickets.map(({ messages, ...t }) => ({
        ...this.withLazyClosure(t),
        latest: messages[0] ? { ...messages[0], body: messages[0].body.slice(0, 160) } : null,
      })),
    };
  }

  /**
   * One ticket as the console opens it (§247): the conversation, internal
   * notes included (findOne), plus who raised it, which shop, who has it, and
   * the booking it is about — a dispute's evidence, on the same screen.
   */
  async findOneForAdmin(actor: { userId: string; role: string }, ticketId: string) {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only administrators can open a ticket this way.');
    }
    const ticket = await this.findOne(actor, ticketId);
    const extra = await this.prisma.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      select: {
        reporter: { select: { email: true } },
        businessProfile: { select: { name: true, logoUrl: true } },
        assignedAdmin: { select: { email: true } },
        appointment: {
          select: {
            id: true,
            status: true,
            startTime: true,
            endTime: true,
            depositAmountMinor: true,
            currency: true,
            depositPaidAt: true,
            service: { select: { name: true } },
            location: { select: { name: true } },
          },
        },
      },
    });
    return { ...ticket, ...extra };
  }

  /**
   * One ticket with its messages.
   *
   * Internal notes are excluded by the QUERY for anyone who is not an admin —
   * `where: { isInternal: false }` — rather than filtered out of the result
   * afterwards. A filter applied late is one someone eventually forgets.
   */
  async findOne(user: { userId: string; role: string }, ticketId: string) {
    const scope = await this.visibilityScope(user);
    const isAdmin = user.role === UserRole.ADMIN;

    const ticket = await this.prisma.ticket.findFirst({
      where: { AND: [{ id: ticketId }, scope] },
      select: {
        ...REPORTER_TICKET_SELECT,
        messages: {
          where: isAdmin ? {} : { isInternal: false },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            body: true,
            authorType: true,
            createdAt: true,
            ...(isAdmin ? { isInternal: true } : {}),
            author: { select: { id: true, email: true, role: true } },
            attachments: {
              select: { id: true, url: true, mimeType: true, sizeBytes: true },
            },
          },
        },
        attachments: {
          where: { ticketMessageId: null },
          select: { id: true, url: true, mimeType: true, sizeBytes: true },
        },
      },
    });

    if (!ticket) throw new NotFoundException('Ticket not found.');

    return this.withLazyClosure(ticket);
  }

  /**
   * Presents a RESOLVED ticket that is past its window as CLOSED on read.
   *
   * A belt-and-braces companion to the daily sweep, not a replacement: it keeps
   * a read consistent with the rule in the gap between the window elapsing and
   * the next sweep. Persisting is left to the sweep so a read stays a read.
   */
  private withLazyClosure<T extends { status: TicketStatus; resolvedAt: Date | null }>(
    ticket: T,
  ): T {
    if (ticket.status === TicketStatus.RESOLVED && isPastResolutionWindow(ticket.resolvedAt)) {
      return { ...ticket, status: TicketStatus.CLOSED };
    }
    return ticket;
  }

  // ---------- Messages ----------

  async addMessage(
    user: { userId: string; role: string },
    ticketId: string,
    dto: CreateTicketMessageDto,
    files?: Express.Multer.File[],
  ) {
    const scope = await this.visibilityScope(user);
    const ticket = await this.prisma.ticket.findFirst({
      where: { AND: [{ id: ticketId }, scope] },
      select: {
        id: true,
        reference: true,
        subject: true,
        status: true,
        resolvedAt: true,
        reporterId: true,
        assignedAdminId: true,
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found.');

    const isAdmin = user.role === UserRole.ADMIN;
    const effectiveStatus = this.withLazyClosure(ticket).status;

    if (effectiveStatus === TicketStatus.CLOSED) {
      throw new BadRequestException(
        'This ticket is closed. Reopen it, or raise a new ticket, to continue.',
      );
    }

    // Only admins may write internal notes. A reporter setting the flag would
    // author something they could never see again.
    const isInternal = isAdmin ? (dto.isInternal ?? false) : false;
    if (!isAdmin && dto.isInternal) {
      throw new ForbiddenException('Only administrators can post internal notes.');
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.ticketMessage.create({
        data: {
          ticketId,
          authorId: user.userId,
          authorType: isAdmin ? TicketAuthorType.ADMIN : TicketAuthorType.REPORTER,
          body: dto.body,
          isInternal,
        },
        select: {
          id: true,
          body: true,
          authorType: true,
          isInternal: true,
          createdAt: true,
        },
      });

      // Any message bumps the queue ordering key, in the same transaction so a
      // list can never show a ticket as staler than its newest message.
      await tx.ticket.update({
        where: { id: ticketId },
        data: { lastMessageAt: created.createdAt },
      });

      return created;
    });

    await this.attach(ticketId, message.id, user.userId, files);

    await this.notifyOnMessage({ ...ticket, id: ticketId }, isAdmin, isInternal);

    return message;
  }

  // ---------- Transitions ----------

  /**
   * The single place a ticket's status changes.
   *
   * Every legal move is in TICKET_TRANSITIONS; anything absent throws. Keeping
   * one method means the reopen window, the resolution-note rule and the
   * actor checks cannot be bypassed by a second code path.
   */
  async transitionStatus(params: {
    ticketId: string;
    to: TicketStatus;
    actor: TransitionActor;
    actorUserId?: string;
    /** The acting user's real role, verified against `actor` below. */
    actorRole?: UserRole | string;
    resolutionNote?: string;
    billingAdjustment?: BillingAdjustmentDto;
  }) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: params.ticketId },
      select: {
        id: true,
        reference: true,
        subject: true,
        status: true,
        resolvedAt: true,
        reporterId: true,
        businessId: true,
        assignedAdminId: true,
        reopenCount: true,
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found.');

    // A ticket past its window behaves as CLOSED even before the sweep runs,
    // so the last legal move out of RESOLVED cannot be made late.
    const from = this.withLazyClosure(ticket).status;

    const rule = findTransition(from, params.to);
    if (!rule) {
      throw new BadRequestException(
        `A ticket cannot move from ${from} to ${params.to}.`,
      );
    }
    if (!rule.actors.includes(params.actor)) {
      throw new ForbiddenException(
        `${from} to ${params.to} is not a transition you can make.`,
      );
    }

    // The caller passes `actor` as a literal, so a claim of ADMIN has to be
    // checked against the acting user's real role rather than believed (§41).
    // Without this, any future caller could move a ticket as an administrator
    // simply by saying so.
    if (params.actor === 'ADMIN' && params.actorRole !== UserRole.ADMIN) {
      throw new ForbiddenException('Only administrators can make that transition.');
    }

    const data: Prisma.TicketUpdateInput = { status: params.to };

    if (params.to === TicketStatus.RESOLVED) {
      // A resolution the reporter cannot read is not a resolution.
      if (!params.resolutionNote?.trim()) {
        throw new BadRequestException(
          'A resolutionNote is required when resolving a ticket.',
        );
      }
      data.resolutionNote = params.resolutionNote.trim();
      data.resolvedAt = new Date();
    }

    if (params.to === TicketStatus.CLOSED) data.closedAt = new Date();

    if (from === TicketStatus.RESOLVED && params.to === TicketStatus.IN_PROGRESS) {
      data.reopenedAt = new Date();
      data.reopenCount = { increment: 1 };
      // Cleared so the next resolution has to state its own reasoning rather
      // than leaving the superseded one in place.
      data.resolvedAt = null;
    }

    if (params.to === TicketStatus.IN_PROGRESS && params.actor === 'ADMIN' && params.actorUserId) {
      data.assignedAdmin = { connect: { id: params.actorUserId } };
    }

    const updated = await this.prisma.ticket.update({
      where: { id: params.ticketId },
      data,
      select: REPORTER_TICKET_SELECT,
    });

    if (params.billingAdjustment) {
      await this.recordBillingAdjustment(
        ticket,
        params.actorUserId!,
        params.billingAdjustment,
      );
    }

    await this.notifications.notify({
      recipientId: ticket.reporterId,
      type: NotificationType.TICKET_STATUS_CHANGED,
      context: this.ticketContext(ticket.reference, ticket.subject, `Now ${params.to}.`),
      ref: { ticketId: params.ticketId, ticketReference: ticket.reference },
    });

    this.logger.log(
      `Ticket ${ticket.reference}: ${from} -> ${params.to} by ${params.actor}.`,
    );

    return updated;
  }

  /** Reporter-initiated reopen, with the window enforced. */
  async reopen(user: { userId: string; role: string }, ticketId: string) {
    const scope = await this.visibilityScope(user);
    const ticket = await this.prisma.ticket.findFirst({
      where: { AND: [{ id: ticketId }, scope] },
      select: { id: true, status: true, resolvedAt: true, reporterId: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found.');

    if (ticket.status !== TicketStatus.RESOLVED) {
      throw new BadRequestException(
        `Only a RESOLVED ticket can be reopened. This one is ${ticket.status}.`,
      );
    }
    if (isPastResolutionWindow(ticket.resolvedAt)) {
      throw new BadRequestException(
        `This ticket was resolved more than ${TICKET_RESOLUTION_WINDOW_DAYS} days ago and can no longer be reopened. Raise a new ticket instead.`,
      );
    }

    return this.transitionStatus({
      ticketId,
      to: TicketStatus.IN_PROGRESS,
      actor: 'REPORTER',
      actorUserId: user.userId,
    });
  }

  async assign(
    actor: { role: UserRole | string },
    ticketId: string,
    assignedAdminId: string,
  ) {
    this.assertAdmin(actor);

    const admin = await this.prisma.user.findFirst({
      where: { id: assignedAdminId, role: UserRole.ADMIN },
      select: { id: true },
    });
    if (!admin) throw new BadRequestException('That user is not an administrator.');

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found.');

    return this.prisma.ticket.update({
      where: { id: ticketId },
      data: { assignedAdminId },
      select: REPORTER_TICKET_SELECT,
    });
  }

  /** Admin-only ticket operations, asserted here as well as by the guard (§41). */
  private assertAdmin(actor: { role: UserRole | string }) {
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only an administrator can do that.');
    }
  }

  // ---------- Billing ----------

  /**
   * Records an adjustment an admin attached while resolving.
   *
   * IMPORTANT: this stores INTENT and nothing more. No money moves because a
   * row exists here. The platform fee is taken from the customer's deposit at
   * booking (§2, §16.3), so settling a FEE_REFUND means reversing that charge
   * at the payment provider — which nothing does yet. `settledAt` stays null
   * on every row by definition. See DECISIONS.md §25.
   *
   * Nothing about this adjustment is returned to the reporter or mentioned in
   * any notification, deliberately: telling someone they have been refunded
   * when no money has moved is worse than telling them nothing.
   */
  private async recordBillingAdjustment(
    ticket: { id: string; businessId: string | null; reference: string },
    createdById: string,
    dto: BillingAdjustmentDto,
  ) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: dto.appointmentId },
      select: { id: true, location: { select: { businessId: true } } },
    });
    if (!appointment) throw new NotFoundException('Appointment not found.');

    // The adjustment belongs to the business that ran the appointment, which
    // for a business-reported ticket must be the reporting business.
    const businessId = appointment.location.businessId;
    if (ticket.businessId && ticket.businessId !== businessId) {
      throw new BadRequestException(
        'That appointment belongs to a different business than this ticket.',
      );
    }

    const adjustment = await this.prisma.billingAdjustment.create({
      data: {
        businessId,
        appointmentId: dto.appointmentId,
        ticketId: ticket.id,
        type: dto.type,
        amount: dto.amount,
        reason: dto.reason,
        createdById,
      },
    });

    this.logger.warn(
      `Billing adjustment ${adjustment.id} (${dto.type} ${dto.amount}) recorded against ` +
        `appointment ${dto.appointmentId} for ticket ${ticket.reference}. ` +
        'UNSETTLED: nothing moves money against this row yet — it is a record of ' +
        'the decision only.',
    );

    return adjustment;
  }

  // ---------- Notifications ----------

  /** Ticket notifications carry no appointment, so the shared context is stubbed. */
  private ticketContext(reference: string, subject: string, detail?: string) {
    return {
      serviceName: reference,
      locationName: subject,
      businessName: 'Support',
      startTime: undefined as unknown as Date,
      reason: detail,
    };
  }

  private async notifyAdmins(type: NotificationType, reference: string, subject: string) {
    const admins = await this.prisma.user.findMany({
      where: { role: UserRole.ADMIN, closedAt: null },
      select: { id: true },
    });

    await Promise.all(
      admins.map((admin) =>
        this.notifications.notify({
          recipientId: admin.id,
          type,
          context: this.ticketContext(reference, subject),
          ref: { ticketReference: reference },
        }),
      ),
    );
  }

  private async notifyOnMessage(
    ticket: {
      id: string;
      reference: string;
      subject: string;
      reporterId: string;
      assignedAdminId: string | null;
    },
    fromAdmin: boolean,
    isInternal: boolean,
  ) {
    // An internal note is invisible to the reporter, so notifying them about it
    // would leak that it exists.
    if (isInternal) return;

    if (fromAdmin) {
      await this.notifications.notify({
        recipientId: ticket.reporterId,
        type: NotificationType.TICKET_MESSAGE,
        context: this.ticketContext(ticket.reference, ticket.subject),
        ref: { ticketId: ticket.id, ticketReference: ticket.reference },
      });
      return;
    }

    // From the reporter: the assigned admin, or the whole admin group when the
    // ticket is still unassigned and nobody owns it yet.
    if (ticket.assignedAdminId) {
      await this.notifications.notify({
        recipientId: ticket.assignedAdminId,
        type: NotificationType.TICKET_MESSAGE,
        context: this.ticketContext(ticket.reference, ticket.subject),
        ref: { ticketReference: ticket.reference },
      });
      return;
    }

    await this.notifyAdmins(NotificationType.TICKET_MESSAGE, ticket.reference, ticket.subject);
  }
}
