import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  AppointmentStatus,
  CancelledBy,
  LedgerEntryType,
  SupportActionKind,
  TicketAuthorType,
  TicketCategory,
  TicketStatus,
  UserRole,
  VerificationMethod,
} from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AvailabilityService } from '../src/availability/availability.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SupportLogService } from '../src/support/support-log.service';
import { commonStubs, createTestModule, mailStub, resetDatabase } from './setup/test-module';
import {
  KNOWN_VERIFICATION_CODE,
  TestBusiness,
  createAppointment,
  createBusiness,
  createCustomer,
} from './setup/factories';

/**
 * Support acting on a booking for the shop or the customer (§297): each act
 * needs a reason, does exactly what the shop's or the customer's own would,
 * is written to the support log and the help request it answers, and shows
 * on the booking — what and when, never who.
 */
describe('Support on a booking (§297)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let appointments: AppointmentsService;
  let ledger: LedgerService;
  let log: SupportLogService;
  let mail: ReturnType<typeof mailStub>;
  let shop: TestBusiness;
  let customerId: string;
  let adminId: string;

  const admin = () => ({ userId: adminId, role: UserRole.ADMIN });

  beforeAll(async () => {
    mail = mailStub();
    moduleRef = await createTestModule([
      AppointmentsService,
      AvailabilityService,
      { provide: (await import('../src/mail/mail.service')).MailService, useValue: mail },
      commonStubs.notifications(),
      commonStubs.payments(),
      commonStubs.chat(),
    ]);
    prisma = moduleRef.get(PrismaService);
    appointments = moduleRef.get(AppointmentsService);
    ledger = moduleRef.get(LedgerService);
    log = moduleRef.get(SupportLogService);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    shop = await createBusiness(prisma);
    customerId = (await createCustomer(prisma)).userId;
    adminId = (await prisma.user.create({ data: { email: `support.${Date.now()}@test.local`, role: UserRole.ADMIN } }))
      .id;
  });

  /** A booking with its deposit paid and in the ledger. */
  const paidBooking = async (status: AppointmentStatus = AppointmentStatus.BOOKED, startsInHours = 2) => {
    const a = await createAppointment(prisma, { business: shop, customerId, status, startsInHours });
    await prisma.$transaction(async (tx) => {
      await tx.appointment.update({ where: { id: a.id }, data: { depositPaidAt: new Date() } });
      await ledger.recordDepositReceived(tx, a.id);
    });
    return a;
  };

  const ticketAbout = (appointmentId: string, reporterId = customerId) =>
    prisma.ticket.create({
      data: {
        reference: `TKT-${Math.floor(Math.random() * 900000 + 100000)}`,
        reporterId,
        reporterType: reporterId === customerId ? 'CUSTOMER' : 'BUSINESS',
        appointmentId,
        businessId: shop.businessId,
        category: TicketCategory.APPOINTMENT_DISPUTE,
        subject: 'The app would not let us check in',
        status: TicketStatus.IN_PROGRESS,
      },
    });

  it('is for administrators only, and wants a reason', async () => {
    const a = await paidBooking();
    await expect(
      appointments.supportCheckIn({ userId: shop.userId, role: UserRole.BUSINESS }, a.id, { reason: 'trying it' }),
    ).rejects.toThrow(ForbiddenException);
    await expect(appointments.supportCheckIn(admin(), a.id, { reason: 'ok' })).rejects.toThrow(BadRequestException);
  });

  it('checks a customer in with their code — a wrong code is said plainly and locks nothing', async () => {
    const a = await paidBooking();
    await expect(
      appointments.supportCheckIn(admin(), a.id, { reason: 'Shop app crashed', code: '000000' }),
    ).rejects.toThrow(/not this booking's code/);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).verificationAttempts).toBe(0);

    await appointments.supportCheckIn(admin(), a.id, { reason: 'Shop app crashed', code: KNOWN_VERIFICATION_CODE });
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
    expect(row).toMatchObject({
      status: AppointmentStatus.IN_PROGRESS,
      verificationMethod: VerificationMethod.CODE,
      verifiedById: adminId,
    });
    // The shop sees the step on its booking: what and when, not who.
    const asShop = await appointments.findOne(shop.userId, a.id);
    expect(asShop.supportActions.map((s) => s.kind)).toEqual([SupportActionKind.CHECK_IN]);
    expect(JSON.stringify(asShop.supportActions)).not.toContain(adminId);
  });

  it('checks a customer in without the code after five wrong tries, saying how we know', async () => {
    const a = await paidBooking();
    await prisma.appointment.update({ where: { id: a.id }, data: { verificationAttempts: 5 } });
    await expect(appointments.supportCheckIn(admin(), a.id, { reason: 'Called' })).rejects.toThrow(/a sentence/);
    await appointments.supportCheckIn(admin(), a.id, {
      reason: 'Called the customer at the counter; shop phone broken',
    });
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.verificationMethod).toBe(VerificationMethod.MANUAL);
    expect(row.manualVerificationNote).toBe('By support: Called the customer at the counter; shop phone broken');
  });

  it('marks a booking done from expected — checked in, then done, and the money released', async () => {
    const a = await paidBooking();
    await appointments.supportComplete(admin(), a.id, {
      reason: 'It happened yesterday, app was down',
      code: KNOWN_VERIFICATION_CODE,
    });
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.status).toBe(AppointmentStatus.COMPLETED);
    const entries = await prisma.ledgerEntry.findMany({ where: { appointmentId: a.id } });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.availableAt !== null)).toBe(true);
    const kinds = (await log.history(admin(), { appointmentId: a.id })).actions.map((x) => x.kind).sort();
    expect(kinds).toEqual([SupportActionKind.CHECK_IN, SupportActionKind.COMPLETE].sort());
  });

  it('puts a wrong no-show right — done, and the money untouched', async () => {
    const a = await paidBooking(AppointmentStatus.BOOKED, -30);
    await appointments.noShow(shop.userId, a.id);
    const before = await prisma.ledgerEntry.findMany({ where: { appointmentId: a.id }, orderBy: { id: 'asc' } });

    await appointments.supportFixNoShow(admin(), a.id, { reason: 'Customer was there; shop forgot to check in' });
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
    expect(row).toMatchObject({ status: AppointmentStatus.COMPLETED, noShowAt: null });
    const after = await prisma.ledgerEntry.findMany({ where: { appointmentId: a.id }, orderBy: { id: 'asc' } });
    expect(after).toEqual(before);
  });

  it('cancels for a customer who asked us — a customer cancellation: nothing given back', async () => {
    const a = await paidBooking();
    await appointments.supportCancelForCustomer(admin(), a.id, { reason: 'Customer phoned, app error on cancel' });
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
    expect(row).toMatchObject({
      status: AppointmentStatus.CANCELLED,
      cancelledBy: CancelledBy.CUSTOMER,
      cancelledByUserId: adminId,
    });
    const refunds = await prisma.ledgerEntry.count({
      where: { appointmentId: a.id, type: LedgerEntryType.DEPOSIT_REFUND },
    });
    expect(refunds).toBe(0);
  });

  it('cancels on the shop side only where the rule allows — with the refund when paid', async () => {
    const live = await paidBooking();
    // No figure is needed now (§313): the operator's charge is added once the statement shows it.
    await appointments.reclassifyAsBusinessCancellation(admin(), live.id, { reason: 'Shop closed for a funeral' });
    expect(
      await prisma.ledgerEntry.count({ where: { appointmentId: live.id, type: LedgerEntryType.DEPOSIT_REFUND } }),
    ).toBe(1);
    // …and the deposit is owed back, to be sent (§313).
    expect(await prisma.refund.findUnique({ where: { appointmentId: live.id } })).toMatchObject({ reason: 'SHOP_CANCELLED' });

    const started = await paidBooking(AppointmentStatus.IN_PROGRESS);
    await expect(
      appointments.reclassifyAsBusinessCancellation(admin(), started.id, {
        reason: 'Changed their mind',
        gatewayChargeMinor: 0,
      }),
    ).rejects.toThrow(/already checked in/);

    const unpaid = await createAppointment(prisma, { business: shop, customerId, status: AppointmentStatus.CANCELLED });
    await prisma.appointment.update({ where: { id: unpaid.id }, data: { cancelledBy: CancelledBy.CUSTOMER } });
    await expect(
      appointments.reclassifyAsBusinessCancellation(admin(), unpaid.id, {
        reason: 'It was the shop',
        gatewayChargeMinor: 0,
      }),
    ).rejects.toThrow(/nothing to give back/);
  });

  it('sends a new code past the customer limit, but not twice in a minute', async () => {
    const a = await paidBooking();
    await prisma.appointment.update({
      where: { id: a.id },
      data: { verificationCodeSentCount: 5, verificationCodeSentAt: null },
    });
    const hashBefore = (await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).verificationCodeHash!;

    await appointments.supportResendCode(admin(), a.id, { reason: 'Their email was full' });
    const after = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.verificationCodeHash).not.toBe(hashBefore);
    expect(await bcrypt.compare(KNOWN_VERIFICATION_CODE, after.verificationCodeHash!)).toBe(false);
    expect(mail.sendAppointmentVerificationEmail).toHaveBeenCalled();

    await expect(appointments.supportResendCode(admin(), a.id, { reason: 'Again please' })).rejects.toThrow(
      /less than a minute/,
    );
  });

  it('reads the conversation, and the reading is written down and shown on the booking', async () => {
    const a = await paidBooking();
    const thread = await prisma.thread.create({
      data: { businessProfileId: shop.businessId, customerId, appointmentId: a.id },
    });
    await prisma.message.create({ data: { threadId: thread.id, senderId: customerId, body: 'Can I come at 3?' } });
    await prisma.message.create({ data: { threadId: thread.id, senderId: shop.userId, body: 'Yes, see you then.' } });

    const read = await appointments.supportReadMessages(admin(), a.id, { reason: 'Dispute over the time agreed' });
    expect(read.messages.map((m) => [m.from, m.body])).toEqual([
      ['customer', 'Can I come at 3?'],
      ['shop', 'Yes, see you then.'],
    ]);
    const asCustomer = await appointments.findOne(customerId, a.id);
    expect(asCustomer.supportActions.map((s) => s.kind)).toEqual([SupportActionKind.READ_MESSAGES]);
  });

  it('answers the help request it acts on, in plain words, and the log names it', async () => {
    const a = await paidBooking();
    const ticket = await ticketAbout(a.id, shop.userId);
    await appointments.supportCheckIn(admin(), a.id, {
      reason: 'Shop app froze',
      code: KNOWN_VERIFICATION_CODE,
      ticketId: ticket.id,
    });
    const reply = await prisma.ticketMessage.findFirstOrThrow({ where: { ticketId: ticket.id } });
    expect(reply).toMatchObject({ authorType: TicketAuthorType.ADMIN, authorId: adminId, isInternal: false });
    expect(reply.body).toMatch(/checked the customer in/);
    const [entry] = (await log.history(admin(), { ticketId: ticket.id })).actions;
    expect(entry.ticket).toEqual({ id: ticket.id, reference: ticket.reference });
  });

  it('publishes what support may do, row by row, as the actions enforce it', async () => {
    await paidBooking(AppointmentStatus.IN_PROGRESS);
    const page = await appointments.listForAdmin(admin(), {});
    expect(page.appointments[0].support).toEqual({
      checkIn: false,
      complete: true,
      fixNoShow: false,
      cancelForCustomer: false,
      cancelForShop: false,
      resendCode: false,
      checkPayment: false,
    });
  });
});
