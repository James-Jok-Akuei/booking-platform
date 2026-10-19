import { TestingModule } from '@nestjs/testing';
import { PayoutStatus, UserRole } from '@prisma/client';
import { PayoutsService } from '../src/payouts/payouts.service';
import { PayoutDestinationsService } from '../src/payouts/payout-destinations.service';
import { numberPart } from '../src/payouts/payout-search';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, asUser, createAdmin, createBusiness } from './setup/factories';

/**
 * Searching the money pages (§289): payouts and payout numbers found by a
 * shop's name, where it is, or a number typed the way people type them.
 */
describe('Searching payouts and payout numbers (§289)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let payouts: PayoutsService;
  let destinations: PayoutDestinationsService;
  let admin: ReturnType<typeof asUser>;
  let remera: TestBusiness;
  let musanze: TestBusiness;

  beforeAll(async () => {
    moduleRef = await createTestModule([PayoutsService, PayoutDestinationsService, commonStubs.notifications()]);
    prisma = moduleRef.get(PrismaService);
    payouts = moduleRef.get(PayoutsService);
    destinations = moduleRef.get(PayoutDestinationsService);
    await resetDatabase(prisma);
    const a = await createAdmin(prisma);
    admin = asUser(a.userId, UserRole.ADMIN);

    const gasabo = await prisma.district.findFirstOrThrow({ where: { name: 'Gasabo' } });
    const north = await prisma.district.findFirstOrThrow({ where: { name: 'Musanze' } });

    remera = await createBusiness(prisma);
    await prisma.businessProfile.update({
      where: { id: remera.businessId },
      data: { name: 'Remera Nails', phone: '+250788111222' },
    });
    await prisma.location.update({
      where: { id: remera.locationId },
      data: { name: 'Remera Studio', address: 'KG 17 Ave', districtId: gasabo.id },
    });
    await prisma.payoutDestination.updateMany({
      where: { businessId: remera.businessId },
      data: { msisdn: '+250788100004' },
    });

    musanze = await createBusiness(prisma);
    await prisma.businessProfile.update({ where: { id: musanze.businessId }, data: { name: 'Volcano Cuts' } });
    await prisma.location.update({ where: { id: musanze.locationId }, data: { districtId: north.id } });
    await prisma.payoutDestination.updateMany({
      where: { businessId: musanze.businessId },
      data: { msisdn: '+250722300400' },
    });

    for (const shop of [remera, musanze]) {
      await prisma.payout.create({
        data: {
          businessId: shop.businessId,
          amountMinor: 1000,
          currency: 'RWF',
          settlementCurrency: 'RWF',
          settlementAmountMinor: 1000,
          status: PayoutStatus.PAID,
          reference: shop === remera ? 'MP-4823019937' : 'MP-0000000001',
          runAt: new Date(),
          paidAt: new Date(),
        },
      });
    }
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  const shopsIn = async (q: string) => (await payouts.list(admin, { q })).payouts.map((p) => p.businessId);
  const numbersFor = async (q: string) => (await destinations.list(admin, { q })).destinations.map((d) => d.businessId);

  it('reads a number however it was typed', () => {
    expect(numberPart('0788 100 004')).toBe('788100004');
    expect(numberPart('+250 788 100 004')).toBe('250788100004');
    expect(numberPart('100 004')).toBe('100004');
    expect(numberPart('07')).toBeNull();
    expect(numberPart('Remera')).toBeNull();
  });

  it('finds payouts by shop name, branch, street, district and province', async () => {
    expect(await shopsIn('remera nails')).toEqual([remera.businessId]);
    expect(await shopsIn('Studio')).toEqual([remera.businessId]);
    expect(await shopsIn('kg 17')).toEqual([remera.businessId]);
    expect(await shopsIn('gasabo')).toEqual([remera.businessId]);
    expect(await shopsIn('Northern')).toEqual([musanze.businessId]);
  });

  it('finds payouts by payout number in any form, the shop phone, an email or the reference', async () => {
    expect(await shopsIn('0788 100 004')).toEqual([remera.businessId]);
    expect(await shopsIn('+250722300400')).toEqual([musanze.businessId]);
    expect(await shopsIn('111 222')).toEqual([remera.businessId]);
    expect(await shopsIn(remera.email.toUpperCase())).toEqual([remera.businessId]);
    expect(await shopsIn('4823019937')).toEqual([remera.businessId]);
  });

  it('keeps the tab, says where each shop is, and finds nothing without error', async () => {
    expect((await payouts.list(admin, { q: 'remera', status: PayoutStatus.PENDING })).total).toBe(0);
    const [row] = (await payouts.list(admin, { q: 'remera' })).payouts;
    expect(row.places).toEqual(['Gasabo']);
    expect((await payouts.list(admin, { q: 'nowhere at all' })).payouts).toEqual([]);
  });

  it('finds payout numbers by the number, the shop, the place or who gave it', async () => {
    expect(await numbersFor('0722 300 400')).toEqual([musanze.businessId]);
    expect(await numbersFor('volcano')).toEqual([musanze.businessId]);
    expect(await numbersFor('Musanze')).toEqual([musanze.businessId]);
    expect(await numbersFor(remera.email)).toEqual([remera.businessId]);
    const [row] = (await destinations.list(admin, { q: 'remera' })).destinations;
    expect(row.places).toEqual(['Gasabo']);
  });
});
