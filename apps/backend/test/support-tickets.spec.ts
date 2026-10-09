import {
  BillingAdjustmentType,
  BusinessMemberRole,
  TicketCategory,
  TicketStatus,
  AppointmentStatus,
} from '@prisma/client';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { TicketsService } from '../src/tickets/tickets.service';
import { TicketsScheduler } from '../src/tickets/tickets.scheduler';
import { StorageService } from '../src/storage/storage.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TICKET_RESOLUTION_WINDOW_MS } from '../src/tickets/ticket-status';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import {
  TestBusiness,
  addMember,
  asUser,
  createAdmin,
  createAppointment,
  createBusiness,
  createCustomer,
} from './setup/factories';

describe('Support tickets (§24)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let tickets: TicketsService;
  let scheduler: TicketsScheduler;

  let admin: { userId: string; email: string };
  let alpha: TestBusiness;
  let beta: TestBusiness;
  let customerA: { userId: string; email: string };
  let customerB: { userId: string; email: string };

  beforeAll(async () => {
    moduleRef = await createTestModule([
      TicketsService,
      TicketsScheduler,
      StorageService,
      commonStubs.notifications(),
    ]);
    prisma = moduleRef.get(PrismaService);
    tickets = moduleRef.get(TicketsService);
    scheduler = moduleRef.get(TicketsScheduler);

    await resetDatabase(prisma);
    admin = await createAdmin(prisma);
    alpha = await createBusiness(prisma);
    beta = await createBusiness(prisma);
    customerA = await createCustomer(prisma);
    customerB = await createCustomer(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  const AS_ADMIN = () => asUser(admin.userId, 'ADMIN');
  const openTicket = (reporterId: string, role: string, subject = 'Something is wrong') =>
    tickets.create(asUser(reporterId, role), {
      category: TicketCategory.TECHNICAL_ISSUE,
      subject,
      body: 'Details of the problem.',
    });

  /** Drives a ticket to RESOLVED through the only legal path. */
  const resolveTicket = async (ticketId: string, note = 'Fixed on our side.') => {
    await tickets.transitionStatus({
      ticketId,
      to: TicketStatus.IN_PROGRESS,
      actor: 'ADMIN',
      actorUserId: admin.userId,
      actorRole: 'ADMIN',
    });
    return tickets.transitionStatus({
      ticketId,
      to: TicketStatus.RESOLVED,
      actor: 'ADMIN',
      actorUserId: admin.userId,
      actorRole: 'ADMIN',
      resolutionNote: note,
    });
  };

  describe('creation', () => {
    it('derives reporterType from the authenticated role, not the body', async () => {
      const asCustomer = await openTicket(customerA.userId, 'CUSTOMER');
      const asBusiness = await openTicket(alpha.userId, 'BUSINESS');

      expect(asCustomer.reporterType).toBe('CUSTOMER');
      expect(asCustomer.businessId).toBeNull();
      expect(asBusiness.reporterType).toBe('BUSINESS');
      expect(asBusiness.businessId).toBe(alpha.businessId);
    });

    it('mints a human-quotable reference', async () => {
      const ticket = await openTicket(customerA.userId, 'CUSTOMER');

      expect(ticket.reference).toMatch(/^TKT-\d{6}$/);
    });

    it('keeps reference unique under concurrent creation', async () => {
      const created = await Promise.all(
        Array.from({ length: 20 }, () => openTicket(customerA.userId, 'CUSTOMER')),
      );

      const references = created.map((t) => t.reference);
      expect(new Set(references).size).toBe(20);
    });

    it('rejects an appointmentId belonging to an unrelated party', async () => {
      // The appointment is customerB's, at business beta.
      const appointment = await createAppointment(prisma, {
        business: beta,
        customerId: customerB.userId,
        status: AppointmentStatus.BOOKED,
      });

      await expect(
        tickets.create(asUser(customerA.userId, 'CUSTOMER'), {
          category: TicketCategory.APPOINTMENT_DISPUTE,
          subject: 'Not my appointment',
          body: 'Attaching someone else’s booking.',
          appointmentId: appointment.id,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("rejects an unrelated business attaching another business's appointment", async () => {
      const appointment = await createAppointment(prisma, {
        business: beta,
        customerId: customerB.userId,
        status: AppointmentStatus.BOOKED,
      });

      await expect(
        tickets.create(asUser(alpha.userId, 'BUSINESS'), {
          category: TicketCategory.APPOINTMENT_DISPUTE,
          subject: 'Not our appointment',
          body: 'Attaching a rival’s booking.',
          appointmentId: appointment.id,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('accepts an appointmentId the reporter is genuinely a party to', async () => {
      const appointment = await createAppointment(prisma, {
        business: alpha,
        customerId: customerA.userId,
        status: AppointmentStatus.BOOKED,
      });

      const ticket = await tickets.create(asUser(customerA.userId, 'CUSTOMER'), {
        category: TicketCategory.APPOINTMENT_DISPUTE,
        subject: 'The stylist never arrived',
        body: 'Nobody was there.',
        appointmentId: appointment.id,
      });

      expect(ticket.appointmentId).toBe(appointment.id);
    });
  });

  describe('status transitions — every illegal move is rejected', () => {
    const ALL: TicketStatus[] = [
      TicketStatus.OPEN,
      TicketStatus.IN_PROGRESS,
      TicketStatus.RESOLVED,
      TicketStatus.CLOSED,
    ];
    // The only legal pairs, per the specification.
    const LEGAL = new Set([
      'OPEN>IN_PROGRESS',
      'IN_PROGRESS>RESOLVED',
      'RESOLVED>IN_PROGRESS',
      'RESOLVED>CLOSED',
    ]);

    /** Puts a fresh ticket into the requested state by legal moves only. */
    const ticketInState = async (state: TicketStatus) => {
      const t = await openTicket(customerA.userId, 'CUSTOMER');
      if (state === TicketStatus.OPEN) return t;
      await tickets.transitionStatus({
        ticketId: t.id,
        to: TicketStatus.IN_PROGRESS,
        actor: 'ADMIN',
        actorUserId: admin.userId,
        actorRole: 'ADMIN',
      });
      if (state === TicketStatus.IN_PROGRESS) return t;
      await tickets.transitionStatus({
        ticketId: t.id,
        to: TicketStatus.RESOLVED,
        actor: 'ADMIN',
        actorUserId: admin.userId,
        actorRole: 'ADMIN',
        resolutionNote: 'Done.',
      });
      if (state === TicketStatus.RESOLVED) return t;
      await tickets.transitionStatus({
        ticketId: t.id,
        to: TicketStatus.CLOSED,
        actor: 'ADMIN',
        actorUserId: admin.userId,
        actorRole: 'ADMIN',
      });
      return t;
    };

    const illegal: Array<[TicketStatus, TicketStatus]> = [];
    for (const from of ALL) {
      for (const to of ALL) {
        if (!LEGAL.has(`${from}>${to}`)) illegal.push([from, to]);
      }
    }

    it.each(illegal)('rejects %s -> %s', async (from, to) => {
      const ticket = await ticketInState(from);

      await expect(
        tickets.transitionStatus({
          ticketId: ticket.id,
          to,
          actor: 'ADMIN',
          actorUserId: admin.userId,
          actorRole: 'ADMIN',
          resolutionNote: 'note',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows OPEN -> IN_PROGRESS and assigns the acting admin', async () => {
      const ticket = await openTicket(customerA.userId, 'CUSTOMER');

      const moved = await tickets.transitionStatus({
        ticketId: ticket.id,
        to: TicketStatus.IN_PROGRESS,
        actor: 'ADMIN',
        actorUserId: admin.userId,
        actorRole: 'ADMIN',
      });

      expect(moved.status).toBe(TicketStatus.IN_PROGRESS);
      expect(moved.assignedAdminId).toBe(admin.userId);
    });

    it('rejects OPEN -> IN_PROGRESS by a reporter', async () => {
      const ticket = await openTicket(customerA.userId, 'CUSTOMER');

      await expect(
        tickets.transitionStatus({
          ticketId: ticket.id,
          to: TicketStatus.IN_PROGRESS,
          actor: 'REPORTER',
          actorUserId: customerA.userId,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects resolving without a resolutionNote', async () => {
      const ticket = await openTicket(customerA.userId, 'CUSTOMER');
      await tickets.transitionStatus({
        ticketId: ticket.id,
        to: TicketStatus.IN_PROGRESS,
        actor: 'ADMIN',
        actorUserId: admin.userId,
        actorRole: 'ADMIN',
      });

      await expect(
        tickets.transitionStatus({
          ticketId: ticket.id,
          to: TicketStatus.RESOLVED,
          actor: 'ADMIN',
          actorUserId: admin.userId,
          actorRole: 'ADMIN',
        }),
      ).rejects.toThrow(/resolutionNote is required/);
    });

    it('rejects a whitespace-only resolutionNote', async () => {
      const ticket = await openTicket(customerA.userId, 'CUSTOMER');
      await tickets.transitionStatus({
        ticketId: ticket.id,
        to: TicketStatus.IN_PROGRESS,
        actor: 'ADMIN',
        actorUserId: admin.userId,
        actorRole: 'ADMIN',
      });

      await expect(
        tickets.transitionStatus({
          ticketId: ticket.id,
          to: TicketStatus.RESOLVED,
          actor: 'ADMIN',
          actorUserId: admin.userId,
          actorRole: 'ADMIN',
          resolutionNote: '   ',
        }),
      ).rejects.toThrow(/resolutionNote is required/);
    });

    it('stores the resolutionNote and resolvedAt on a valid resolution', async () => {
      const ticket = await openTicket(customerA.userId, 'CUSTOMER');
      const resolved = await resolveTicket(ticket.id, 'Refunded the deposit.');

      expect(resolved.status).toBe(TicketStatus.RESOLVED);
      expect(resolved.resolutionNote).toBe('Refunded the deposit.');
      expect(resolved.resolvedAt).not.toBeNull();
    });

    it('CLOSED is terminal — every outbound transition is rejected', async () => {
      const ticket = await ticketInState(TicketStatus.CLOSED);

      for (const to of ALL) {
        await expect(
          tickets.transitionStatus({
            ticketId: ticket.id,
            to,
            actor: 'ADMIN',
            actorUserId: admin.userId,
            actorRole: 'ADMIN',
            resolutionNote: 'note',
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    });
  });

  describe('reopen window', () => {
    it('allows the reporter to reopen inside the window', async () => {
      const ticket = await openTicket(customerA.userId, 'CUSTOMER');
      await resolveTicket(ticket.id);

      const reopened = await tickets.reopen(asUser(customerA.userId, 'CUSTOMER'), ticket.id);

      expect(reopened.status).toBe(TicketStatus.IN_PROGRESS);
      expect(reopened.reopenCount).toBe(1);
      expect(reopened.reopenedAt).not.toBeNull();
    });

    it('rejects reopening after the 14-day window', async () => {
      const ticket = await openTicket(customerA.userId, 'CUSTOMER');
      await resolveTicket(ticket.id);

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { resolvedAt: new Date(Date.now() - TICKET_RESOLUTION_WINDOW_MS - 60_000) },
      });

      await expect(
        tickets.reopen(asUser(customerA.userId, 'CUSTOMER'), ticket.id),
      ).rejects.toThrow(/can no longer be reopened/);
    });

    it('rejects reopening a ticket that is not RESOLVED', async () => {
      const ticket = await openTicket(customerA.userId, 'CUSTOMER');

      await expect(
        tickets.reopen(asUser(customerA.userId, 'CUSTOMER'), ticket.id),
      ).rejects.toThrow(/Only a RESOLVED ticket can be reopened/);
    });

    it('counts repeated reopens', async () => {
      const ticket = await openTicket(customerA.userId, 'CUSTOMER');
      await resolveTicket(ticket.id);
      await tickets.reopen(asUser(customerA.userId, 'CUSTOMER'), ticket.id);
      await tickets.transitionStatus({
        ticketId: ticket.id,
        to: TicketStatus.RESOLVED,
        actor: 'ADMIN',
        actorUserId: admin.userId,
        actorRole: 'ADMIN',
        resolutionNote: 'Fixed again.',
      });

      const second = await tickets.reopen(asUser(customerA.userId, 'CUSTOMER'), ticket.id);

      expect(second.reopenCount).toBe(2);
    });
  });

  describe('auto-close', () => {
    it('closes RESOLVED tickets past the window and leaves fresh ones alone', async () => {
      const stale = await openTicket(customerA.userId, 'CUSTOMER', 'Stale');
      const fresh = await openTicket(customerA.userId, 'CUSTOMER', 'Fresh');
      await resolveTicket(stale.id);
      await resolveTicket(fresh.id);

      await prisma.ticket.update({
        where: { id: stale.id },
        data: { resolvedAt: new Date(Date.now() - TICKET_RESOLUTION_WINDOW_MS - 60_000) },
      });

      const closed = await scheduler.closeResolvedTickets();
      expect(closed).toBeGreaterThanOrEqual(1);

      const staleAfter = await prisma.ticket.findUniqueOrThrow({ where: { id: stale.id } });
      const freshAfter = await prisma.ticket.findUniqueOrThrow({ where: { id: fresh.id } });
      expect(staleAfter.status).toBe(TicketStatus.CLOSED);
      expect(staleAfter.closedAt).not.toBeNull();
      expect(freshAfter.status).toBe(TicketStatus.RESOLVED);
    });
  });

  describe('messages', () => {
    it('rejects a reporter message on a CLOSED ticket', async () => {
      const ticket = await openTicket(customerA.userId, 'CUSTOMER');
      await resolveTicket(ticket.id);
      await tickets.transitionStatus({
        ticketId: ticket.id,
        to: TicketStatus.CLOSED,
        actor: 'ADMIN',
        actorUserId: admin.userId,
        actorRole: 'ADMIN',
      });

      await expect(
        tickets.addMessage(asUser(customerA.userId, 'CUSTOMER'), ticket.id, {
          body: 'One more thing',
        }),
      ).rejects.toThrow(/This ticket is closed/);
    });

    it.each([TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED])(
      'allows a reporter message while %s',
      async (state) => {
        const ticket = await openTicket(customerA.userId, 'CUSTOMER');
        if (state !== TicketStatus.OPEN) {
          await tickets.transitionStatus({
            ticketId: ticket.id,
            to: TicketStatus.IN_PROGRESS,
            actor: 'ADMIN',
            actorUserId: admin.userId,
            actorRole: 'ADMIN',
          });
        }
        if (state === TicketStatus.RESOLVED) {
          await tickets.transitionStatus({
            ticketId: ticket.id,
            to: TicketStatus.RESOLVED,
            actor: 'ADMIN',
            actorUserId: admin.userId,
            actorRole: 'ADMIN',
            resolutionNote: 'Done.',
          });
        }

        const message = await tickets.addMessage(
          asUser(customerA.userId, 'CUSTOMER'),
          ticket.id,
          { body: 'A reply' },
        );

        expect(message.authorType).toBe('REPORTER');
      },
    );

    it('bumps lastMessageAt so the queue sorts by recency', async () => {
      const ticket = await openTicket(customerA.userId, 'CUSTOMER');
      const before = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });

      await new Promise((r) => setTimeout(r, 10));
      await tickets.addMessage(asUser(customerA.userId, 'CUSTOMER'), ticket.id, {
        body: 'Following up',
      });

      const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(after.lastMessageAt.getTime()).toBeGreaterThan(before.lastMessageAt.getTime());
    });

    it('refuses a reporter attempting to author an internal note', async () => {
      const ticket = await openTicket(customerA.userId, 'CUSTOMER');

      await expect(
        tickets.addMessage(asUser(customerA.userId, 'CUSTOMER'), ticket.id, {
          body: 'Sneaky',
          isInternal: true,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('internal notes are invisible to reporters', () => {
    let ticketId: string;

    beforeAll(async () => {
      const ticket = await openTicket(customerA.userId, 'CUSTOMER', 'Has internal notes');
      ticketId = ticket.id;
      await tickets.addMessage(AS_ADMIN(), ticketId, {
        body: 'PUBLIC-REPLY',
        isInternal: false,
      });
      await tickets.addMessage(AS_ADMIN(), ticketId, {
        body: 'SECRET-INTERNAL-NOTE',
        isInternal: true,
      });
    });

    it('the reporter detail view contains no internal note', async () => {
      const view = await tickets.findOne(asUser(customerA.userId, 'CUSTOMER'), ticketId);

      const bodies = (view as { messages: Array<{ body: string }> }).messages.map((m) => m.body);
      expect(bodies).toContain('PUBLIC-REPLY');
      expect(bodies).not.toContain('SECRET-INTERNAL-NOTE');
    });

    it('no reporter-facing message even carries an isInternal field', async () => {
      const view = await tickets.findOne(asUser(customerA.userId, 'CUSTOMER'), ticketId);

      const messages = (view as { messages: Array<Record<string, unknown>> }).messages;
      expect(messages.every((m) => !('isInternal' in m))).toBe(true);
    });

    it('the serialised reporter response contains the secret nowhere at all', async () => {
      const view = await tickets.findOne(asUser(customerA.userId, 'CUSTOMER'), ticketId);

      expect(JSON.stringify(view)).not.toContain('SECRET-INTERNAL-NOTE');
    });

    it('the admin view does include the internal note', async () => {
      const view = await tickets.findOne(AS_ADMIN(), ticketId);

      const bodies = (view as { messages: Array<{ body: string }> }).messages.map((m) => m.body);
      expect(bodies).toContain('SECRET-INTERNAL-NOTE');
    });
  });

  describe('visibility and cross-tenant isolation', () => {
    let alphaTicketId: string;
    let customerATicketId: string;

    beforeAll(async () => {
      const bizTicket = await openTicket(alpha.userId, 'BUSINESS', 'Alpha business issue');
      alphaTicketId = bizTicket.id;
      const custTicket = await openTicket(customerA.userId, 'CUSTOMER', 'Customer A issue');
      customerATicketId = custTicket.id;
    });

    it("customer B cannot read customer A's ticket", async () => {
      await expect(
        tickets.findOne(asUser(customerB.userId, 'CUSTOMER'), customerATicketId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("customer B cannot message customer A's ticket", async () => {
      await expect(
        tickets.addMessage(asUser(customerB.userId, 'CUSTOMER'), customerATicketId, {
          body: 'Not mine',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("customer B cannot reopen customer A's ticket", async () => {
      await expect(
        tickets.reopen(asUser(customerB.userId, 'CUSTOMER'), customerATicketId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("customer B's list excludes customer A's tickets", async () => {
      const list = await tickets.list(asUser(customerB.userId, 'CUSTOMER'), {});

      expect(list.tickets.every((t) => t.id !== customerATicketId)).toBe(true);
    });

    it("business B cannot read business A's ticket", async () => {
      await expect(
        tickets.findOne(asUser(beta.userId, 'BUSINESS'), alphaTicketId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("business B's list excludes business A's tickets", async () => {
      const list = await tickets.list(asUser(beta.userId, 'BUSINESS'), {});

      expect(list.tickets.every((t) => t.id !== alphaTicketId)).toBe(true);
    });

    it("a business member who did NOT create the ticket still sees their business's tickets", async () => {
      const colleague = await addMember(prisma, alpha.businessId, BusinessMemberRole.STAFF);

      const view = await tickets.findOne(asUser(colleague.userId, 'BUSINESS'), alphaTicketId);
      const list = await tickets.list(asUser(colleague.userId, 'BUSINESS'), {});

      expect(view.id).toBe(alphaTicketId);
      expect(list.tickets.some((t) => t.id === alphaTicketId)).toBe(true);
    });

    it('listForAdmin refuses a non-admin actor at the SERVICE layer', async () => {
      // The controller's @Roles(ADMIN) is not the only thing standing between a
      // customer and every ticket on the platform — verified in §27.3, where
      // removing that decorator leaked another user's ticket.
      await expect(
        tickets.listForAdmin(asUser(customerA.userId, 'CUSTOMER'), {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('listForAdmin refuses a business member too', async () => {
      await expect(
        tickets.listForAdmin(asUser(alpha.userId, 'BUSINESS'), {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('an admin sees tickets from every tenant', async () => {
      const list = await tickets.listForAdmin(AS_ADMIN(), {});
      const ids = list.tickets.map((t) => t.id);

      expect(ids).toContain(alphaTicketId);
      expect(ids).toContain(customerATicketId);
    });
  });

  describe('the console’s inbox (§247)', () => {
    it('lists each ticket with its reporter, its shop and the latest word', async () => {
      const ticket = await openTicket(alpha.userId, 'BUSINESS', 'Payout never arrived');
      const list = await tickets.listForAdmin(AS_ADMIN(), { limit: 100 });
      const row: any = list.tickets.find((t) => t.id === ticket.id);

      expect(row.reporter.email).toBe(alpha.email);
      expect(row.businessProfile).toHaveProperty('name');
      expect(row.assignedAdmin).toBeNull();
      expect(row.latest).toMatchObject({ body: 'Details of the problem.', authorType: 'REPORTER', isInternal: false });
      expect(row).not.toHaveProperty('messages');
    });

    it('finds a ticket by its reference, its subject or the reporter’s email', async () => {
      const ticket = await openTicket(customerA.userId, 'CUSTOMER', 'The app showed a strange price');
      const ids = async (q: string) => (await tickets.listForAdmin(AS_ADMIN(), { q, limit: 100 })).tickets.map((t) => t.id);

      expect(await ids(ticket.reference.toLowerCase())).toContain(ticket.id);
      expect(await ids('STRANGE PRICE')).toContain(ticket.id);
      expect(await ids(customerA.email)).toContain(ticket.id);
      expect(await ids('nothing-matches-this')).toEqual([]);
    });

    it('opens a ticket with the reporter and the booking it is about, for an admin only', async () => {
      const ticket = await openTicket(customerA.userId, 'CUSTOMER');
      const detail: any = await tickets.findOneForAdmin(AS_ADMIN(), ticket.id);
      expect(detail.reporter.email).toBe(customerA.email);
      expect(detail.appointment).toBeNull();
      expect(detail.messages.length).toBeGreaterThan(0);

      await expect(tickets.findOneForAdmin(asUser(customerA.userId, 'CUSTOMER'), ticket.id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('billing adjustments', () => {
    it('records a FEE_REFUND against the appointment when resolving', async () => {
      const appointment = await createAppointment(prisma, {
        business: alpha,
        customerId: customerA.userId,
        status: AppointmentStatus.COMPLETED,
        verified: true,
      });
      const ticket = await tickets.create(asUser(alpha.userId, 'BUSINESS'), {
        category: TicketCategory.APPOINTMENT_DISPUTE,
        subject: 'Customer never showed',
        body: 'Requesting a fee credit.',
        appointmentId: appointment.id,
      });
      await tickets.transitionStatus({
        ticketId: ticket.id,
        to: TicketStatus.IN_PROGRESS,
        actor: 'ADMIN',
        actorUserId: admin.userId,
        actorRole: 'ADMIN',
      });

      await tickets.transitionStatus({
        ticketId: ticket.id,
        to: TicketStatus.RESOLVED,
        actor: 'ADMIN',
        actorUserId: admin.userId,
        actorRole: 'ADMIN',
        resolutionNote: 'Credit granted.',
        billingAdjustment: {
          appointmentId: appointment.id,
          type: BillingAdjustmentType.FEE_REFUND,
          amount: 4.5,
          reason: 'Appointment did not take place.',
        },
      });

      const adjustment = await prisma.billingAdjustment.findFirstOrThrow({
        where: { ticketId: ticket.id },
      });
      expect(adjustment.type).toBe(BillingAdjustmentType.FEE_REFUND);
      expect(adjustment.amount.toString()).toBe('4.5');
      expect(adjustment.businessId).toBe(alpha.businessId);
      expect(adjustment.appointmentId).toBe(appointment.id);
    });

    it('leaves the adjustment UNSETTLED — no money has moved', async () => {
      const adjustments = await prisma.billingAdjustment.findMany();

      // Nothing settles these rows yet: a FEE_REFUND means reversing a charge
      // at the payment provider, which is not built. See DECISIONS.md §25.
      expect(adjustments.length).toBeGreaterThan(0);
      expect(adjustments.every((a) => a.settledAt === null)).toBe(true);
      expect(adjustments.every((a) => a.settlementRef === null)).toBe(true);
    });

    it('tells the reporter nothing that implies money has moved', async () => {
      const appointment = await createAppointment(prisma, {
        business: alpha,
        customerId: customerA.userId,
        status: AppointmentStatus.COMPLETED,
        verified: true,
      });
      const ticket = await tickets.create(asUser(customerA.userId, 'CUSTOMER'), {
        category: TicketCategory.APPOINTMENT_DISPUTE,
        subject: 'Business cancelled on me',
        body: 'They called it off.',
        appointmentId: appointment.id,
      });
      await tickets.transitionStatus({
        ticketId: ticket.id,
        to: TicketStatus.IN_PROGRESS,
        actor: 'ADMIN',
        actorUserId: admin.userId,
        actorRole: 'ADMIN',
      });

      const resolved = await tickets.transitionStatus({
        ticketId: ticket.id,
        to: TicketStatus.RESOLVED,
        actor: 'ADMIN',
        actorUserId: admin.userId,
        actorRole: 'ADMIN',
        resolutionNote: 'Approved for a fee refund.',
        billingAdjustment: {
          appointmentId: appointment.id,
          type: BillingAdjustmentType.FEE_REFUND,
          amount: 4.5,
          reason: 'Business cancelled.',
        },
      });

      // The adjustment is not part of any reporter-facing shape at all: not on
      // the transition response, and not on the detail view.
      const detail = await tickets.findOne(asUser(customerA.userId, 'CUSTOMER'), ticket.id);
      const serialised = JSON.stringify(resolved) + JSON.stringify(detail);

      expect(serialised).not.toContain('FEE_REFUND');
      expect(serialised).not.toContain('adjustment');
      expect(serialised).not.toContain('settledAt');
      // Only the admin's own note is surfaced, which is a decision, not a receipt.
      expect(resolved.resolutionNote).toBe('Approved for a fee refund.');
    });

    it("rejects an adjustment for another business's appointment", async () => {
      const foreign = await createAppointment(prisma, {
        business: beta,
        customerId: customerB.userId,
        status: AppointmentStatus.COMPLETED,
        verified: true,
      });
      const ticket = await openTicket(alpha.userId, 'BUSINESS', 'Wrong business');
      await tickets.transitionStatus({
        ticketId: ticket.id,
        to: TicketStatus.IN_PROGRESS,
        actor: 'ADMIN',
        actorUserId: admin.userId,
        actorRole: 'ADMIN',
      });

      await expect(
        tickets.transitionStatus({
          ticketId: ticket.id,
          to: TicketStatus.RESOLVED,
          actor: 'ADMIN',
          actorUserId: admin.userId,
          actorRole: 'ADMIN',
          resolutionNote: 'Attempting a cross-business credit.',
          billingAdjustment: {
            appointmentId: foreign.id,
            type: BillingAdjustmentType.FEE_REFUND,
            amount: 1,
            reason: 'Should not be allowed.',
          },
        }),
      ).rejects.toThrow(/different business/);
    });
  });

  describe('admin ticket operations assert the role in the service (§41)', () => {
    const NON_ADMINS = ['CUSTOMER', 'BUSINESS'];

    it.each(NON_ADMINS)('refuses a %s assigning a ticket', async (role) => {
      const ticket = await openTicket(customerA.userId, 'CUSTOMER');

      await expect(
        tickets.assign({ role }, ticket.id, admin.userId),
      ).rejects.toBeInstanceOf(ForbiddenException);

      const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(row.assignedAdminId).toBeNull();
    });

    it.each(NON_ADMINS)(
      'refuses a %s making an ADMIN transition, however it labels itself',
      async (role) => {
        const ticket = await openTicket(customerA.userId, 'CUSTOMER');

        await expect(
          tickets.transitionStatus({
            ticketId: ticket.id,
            to: TicketStatus.IN_PROGRESS,
            // The literal claim. Without the role check it would be believed.
            actor: 'ADMIN',
            actorUserId: customerA.userId,
            actorRole: role,
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);

        const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
        expect(row.status).toBe(TicketStatus.OPEN);
      },
    );

    it('still allows a genuine admin transition', async () => {
      const ticket = await openTicket(customerA.userId, 'CUSTOMER');

      const moved = await tickets.transitionStatus({
        ticketId: ticket.id,
        to: TicketStatus.IN_PROGRESS,
        actor: 'ADMIN',
        actorUserId: admin.userId,
        actorRole: 'ADMIN',
      });

      expect(moved.status).toBe(TicketStatus.IN_PROGRESS);
    });

    it('still allows the reporter to reopen — REPORTER is unaffected', async () => {
      const ticket = await openTicket(customerA.userId, 'CUSTOMER');
      await resolveTicket(ticket.id);

      const reopened = await tickets.reopen(
        asUser(customerA.userId, 'CUSTOMER'),
        ticket.id,
      );

      expect(reopened.status).toBe(TicketStatus.IN_PROGRESS);
    });
  });
});
