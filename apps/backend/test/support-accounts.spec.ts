import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  AppointmentStatus,
  BusinessMemberRole,
  BusinessMemberStatus,
  InvitationStatus,
  NotificationType,
  SupportActionKind,
  TicketCategory,
  TicketStatus,
  UserRole,
} from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { SupportAccountsController } from '../src/support/support-accounts.controller';
import { SupportAccountsService } from '../src/support/support-accounts.service';
import { RecentAuthGuard } from '../src/auth/guards/recent-auth.guard';
import { TicketsService } from '../src/tickets/tickets.service';
import { AccountService } from '../src/users/account.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, addMember, createAppointment, createBusiness, createCustomer } from './setup/factories';

/**
 * Support acting for a shop or a person (§297): the same change they could
 * make themselves, by the same rules, with a reason, a line in the log and a
 * notice to whoever it concerns.
 */
describe('Support for shops and people (§297)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let accounts: SupportAccountsService;
  let tickets: TicketsService;
  let notify: jest.Mock;
  let shop: TestBusiness;
  let customerId: string;
  let adminId: string;
  let primaryId: string;

  const admin = () => ({ userId: adminId, role: UserRole.ADMIN });
  const primary = () => ({ userId: primaryId, role: UserRole.ADMIN });
  const why = { reason: 'The owner asked us by phone.' };

  beforeAll(async () => {
    moduleRef = await createTestModule([
      SupportAccountsService,
      AccountService,
      TicketsService,
      { provide: StorageService, useValue: {} },
      commonStubs.notifications(),
    ]);
    prisma = moduleRef.get(PrismaService);
    accounts = moduleRef.get(SupportAccountsService);
    tickets = moduleRef.get(TicketsService);
    notify = moduleRef.get(NotificationsService).notify as jest.Mock;
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    notify.mockClear();
    shop = await createBusiness(prisma);
    customerId = (await createCustomer(prisma)).userId;
    adminId = (await prisma.user.create({ data: { email: `support.${Date.now()}@test.local`, role: UserRole.ADMIN } }))
      .id;
    primaryId = (
      await prisma.user.create({
        data: { email: `primary.${Date.now()}@test.local`, role: UserRole.ADMIN, isPrimaryAdmin: true },
      })
    ).id;
  });

  const logged = (kind: SupportActionKind) => prisma.supportAction.findMany({ where: { kind } });

  it('is for administrators only, and wants a reason', async () => {
    await expect(
      accounts.setPaused({ userId: shop.userId, role: UserRole.BUSINESS }, shop.businessId, true, why),
    ).rejects.toThrow(ForbiddenException);
    await expect(accounts.setPaused(admin(), shop.businessId, true, { reason: 'ok' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('pauses and opens a shop, by the shop’s own rules, and says so', async () => {
    const paused = await accounts.setPaused(admin(), shop.businessId, true, why);
    expect(paused.pausedAt).not.toBeNull();
    await expect(accounts.setPaused(admin(), shop.businessId, true, why)).rejects.toThrow('already paused');
    await accounts.setPaused(admin(), shop.businessId, false, why);
    const after = await prisma.businessProfile.findUniqueOrThrow({ where: { id: shop.businessId } });
    expect(after.pausedAt).toBeNull();
    expect(await logged(SupportActionKind.PAUSE_SHOP)).toHaveLength(1);
    expect(await logged(SupportActionKind.RESUME_SHOP)).toHaveLength(1);
  });

  it('writes a note into the help request it answers', async () => {
    const ticket = await prisma.ticket.create({
      data: {
        reference: 'TKT-900001',
        reporterId: shop.userId,
        reporterType: 'BUSINESS',
        businessId: shop.businessId,
        category: TicketCategory.ACCOUNT_ISSUE,
        subject: 'Please pause us, I cannot sign in',
        status: TicketStatus.IN_PROGRESS,
      },
    });
    await accounts.setPaused(admin(), shop.businessId, true, { ...why, ticketId: ticket.id });
    const notes = await prisma.ticketMessage.findMany({ where: { ticketId: ticket.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain('paused your shop');
  });

  it('sends an invitation again with a fresh week, and takes one back', async () => {
    const invitation = await prisma.businessInvitation.create({
      data: {
        businessProfileId: shop.businessId,
        email: 'new.barber@test.local',
        role: BusinessMemberRole.STAFF,
        invitedByUserId: shop.userId,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const view = await accounts.shop(admin(), shop.businessId);
    expect(view.invitations[0]).toMatchObject({ email: 'new.barber@test.local', expired: true });

    await accounts.resendInvitation(admin(), shop.businessId, invitation.id, why);
    const fresh = await prisma.businessInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(fresh.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
    const emailed = moduleRef.get(NotificationsService).notifyUnregisteredEmail as jest.Mock;
    expect(emailed).toHaveBeenCalledWith(expect.objectContaining({ email: 'new.barber@test.local' }));

    await accounts.revokeInvitation(admin(), shop.businessId, invitation.id, why);
    const gone = await prisma.businessInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(gone.status).toBe(InvitationStatus.REVOKED);
    await expect(accounts.resendInvitation(admin(), shop.businessId, invitation.id, why)).rejects.toThrow(
      'already revoked',
    );
  });

  it('takes someone out of a team, never the owner, and tells them', async () => {
    const staff = await addMember(prisma, shop.businessId, BusinessMemberRole.STAFF);
    const owner = await prisma.businessMembership.findFirstOrThrow({
      where: { businessProfileId: shop.businessId, role: BusinessMemberRole.OWNER },
    });
    await expect(accounts.removeMember(admin(), shop.businessId, owner.id, why)).rejects.toThrow('owner cannot');

    await accounts.removeMember(admin(), shop.businessId, staff.membershipId, why);
    const row = await prisma.businessMembership.findUniqueOrThrow({ where: { id: staff.membershipId } });
    expect(row.status).toBe(BusinessMemberStatus.REMOVED);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: staff.userId, type: NotificationType.SUPPORT_UPDATE }),
    );
  });

  it('hands a shop to a team member: the primary administrator only', async () => {
    const manager = await addMember(prisma, shop.businessId, BusinessMemberRole.MANAGER, [shop.locationId]);
    await expect(accounts.transferOwnership(admin(), shop.businessId, manager.membershipId, why)).rejects.toThrow(
      'primary administrator',
    );

    await accounts.transferOwnership(primary(), shop.businessId, manager.membershipId, why);
    const team = await prisma.businessMembership.findMany({
      where: { businessProfileId: shop.businessId },
      include: { locations: true },
    });
    const newOwner = team.find((m) => m.id === manager.membershipId)!;
    const oldOwner = team.find((m) => m.userId === shop.userId)!;
    // One owner, who looks after every branch; the old one stays, as a manager of every branch.
    expect(team.filter((m) => m.role === BusinessMemberRole.OWNER)).toHaveLength(1);
    expect(newOwner).toMatchObject({ role: BusinessMemberRole.OWNER, allLocations: true });
    expect(newOwner.locations).toHaveLength(0);
    expect(oldOwner).toMatchObject({ role: BusinessMemberRole.MANAGER, allLocations: true, status: 'ACTIVE' });
    const recipients = notify.mock.calls.map(([p]) => (p as { recipientId: string }).recipientId);
    expect(recipients).toEqual(expect.arrayContaining([manager.userId, shop.userId]));
    expect(await logged(SupportActionKind.TRANSFER_OWNERSHIP)).toHaveLength(1);
  });

  it('only hands a shop to someone already in its team', async () => {
    const leaver = await addMember(prisma, shop.businessId, BusinessMemberRole.STAFF);
    await prisma.businessMembership.update({
      where: { id: leaver.membershipId },
      data: { status: BusinessMemberStatus.REMOVED },
    });
    await expect(accounts.transferOwnership(primary(), shop.businessId, leaver.membershipId, why)).rejects.toThrow(
      'Only someone in the team',
    );
  });

  it('asks for a fresh code before handing a shop over or closing an account', () => {
    const guards = (name: keyof SupportAccountsController) =>
      (Reflect.getMetadata('__guards__', SupportAccountsController.prototype[name]) ?? []) as unknown[];
    expect(guards('transferOwnership')).toContain(RecentAuthGuard);
    expect(guards('closeAccount')).toContain(RecentAuthGuard);
    expect(guards('pause')).not.toContain(RecentAuthGuard);
  });

  it('signs a person out of every phone, and push to them stops', async () => {
    await prisma.refreshToken.createMany({
      data: [
        { userId: customerId, tokenHash: `a-${Date.now()}`, expiresAt: new Date(Date.now() + 86_400_000) },
        { userId: customerId, tokenHash: `b-${Date.now()}`, expiresAt: new Date(Date.now() + 86_400_000) },
      ],
    });
    await prisma.pushDevice.create({
      data: { userId: customerId, kind: 'EXPO', token: `ExponentPushToken[${Date.now()}]` },
    });
    expect((await accounts.person(admin(), customerId)).signedInSessions).toBe(2);

    const done = await accounts.signOutEverywhere(admin(), customerId, why);
    expect(done.message).toBe('Signed out of 2 places.');
    expect(await prisma.refreshToken.count({ where: { userId: customerId, revokedAt: null } })).toBe(0);
    expect(await prisma.pushDevice.count({ where: { userId: customerId } })).toBe(0);
  });

  it('stops every marketing message, and keeps each "no"', async () => {
    await prisma.user.update({ where: { id: customerId }, data: { offersOptInAt: new Date(), offersToken: 'tok' } });
    await prisma.notificationPreference.create({
      data: { userId: customerId, category: 'NEWS', channel: 'PUSH', enabled: true },
    });
    await prisma.shopFollow.create({ data: { userId: customerId, businessId: shop.businessId, offersAt: new Date() } });

    await accounts.stopMarketing(admin(), customerId, why);
    const person = await accounts.person(admin(), customerId);
    expect(person.marketing).toEqual({ newsChoicesOn: 0, weeklyOffersEmail: false, shopsSendingOffers: 0 });
    // Still following: only the offers stopped.
    expect(await prisma.shopFollow.count({ where: { userId: customerId } })).toBe(1);
    const noes = await prisma.consentRecord.findMany({ where: { userId: customerId, source: 'support' } });
    expect(noes.map((n) => n.purpose)).toEqual(expect.arrayContaining(['news.push', `shop:${shop.businessId}`]));
    expect(noes.every((n) => !n.granted)).toBe(true);
  });

  it('closes an account by the person’s own rules, telling them first', async () => {
    const booking = await createAppointment(prisma, {
      business: shop,
      customerId,
      status: AppointmentStatus.BOOKED,
      startsInHours: 24,
    });
    await expect(accounts.closeAccount(admin(), customerId, why)).rejects.toThrow(
      'They have 1 booking(s) still to come',
    );
    expect(notify).not.toHaveBeenCalled();

    await prisma.appointment.update({ where: { id: booking.id }, data: { status: AppointmentStatus.CANCELLED } });
    await accounts.closeAccount(admin(), customerId, why);
    const closed = await prisma.user.findUniqueOrThrow({ where: { id: customerId } });
    expect(closed.closedAt).not.toBeNull();
    expect(closed.email).toMatch(/@closed\.invalid$/);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ recipientId: customerId }));
    await expect(accounts.closeAccount(admin(), adminId, why)).rejects.toThrow(BadRequestException);
  });

  it('finds one shop’s or one person’s requests still being dealt with, to answer', async () => {
    const make = (reporterId: string, reporterType: 'CUSTOMER' | 'BUSINESS', status: TicketStatus, reference: string) =>
      prisma.ticket.create({
        data: {
          reference,
          reporterId,
          reporterType,
          businessId: reporterType === 'BUSINESS' ? shop.businessId : null,
          category: TicketCategory.OTHER,
          subject: reference,
          status,
        },
      });
    await make(customerId, 'CUSTOMER', TicketStatus.OPEN, 'TKT-910001');
    await make(customerId, 'CUSTOMER', TicketStatus.RESOLVED, 'TKT-910002');
    await make(shop.userId, 'BUSINESS', TicketStatus.IN_PROGRESS, 'TKT-910003');

    const theirs = await tickets.listForAdmin(admin(), { reporterId: customerId, open: 'true' });
    expect(theirs.tickets.map((t) => t.reference)).toEqual(['TKT-910001']);
    const shops = await tickets.listForAdmin(admin(), { businessId: shop.businessId, open: 'true' });
    expect(shops.tickets.map((t) => t.reference)).toEqual(['TKT-910003']);
  });

  it('ties a help request to the reporter’s own booking only', async () => {
    const mine = await createAppointment(prisma, { business: shop, customerId, status: AppointmentStatus.BOOKED });
    const other = await createCustomer(prisma);
    const theirs = await createAppointment(prisma, {
      business: shop,
      customerId: other.userId,
      status: AppointmentStatus.BOOKED,
    });
    const ticket = await prisma.ticket.create({
      data: {
        reference: 'TKT-900002',
        reporterId: customerId,
        reporterType: 'CUSTOMER',
        category: TicketCategory.APPOINTMENT_DISPUTE,
        subject: 'My booking at 3',
      },
    });
    await expect(tickets.linkBooking(admin(), ticket.id, theirs.id)).rejects.toThrow('not one of theirs');
    await tickets.linkBooking(admin(), ticket.id, mine.id);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).appointmentId).toBe(mine.id);
    await tickets.linkBooking(admin(), ticket.id, null);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).appointmentId).toBeNull();
    expect(await logged(SupportActionKind.LINK_TICKET)).toHaveLength(2);
  });
});
