import { AppointmentStatus, BusinessStatus } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LocationsService } from '../src/business/locations.service';
import { BusinessAccessService } from '../src/business/business-access.service';
import { CreateLocationDto, FIND_US_MAX } from '../src/business/dto/create-location.dto';
import { UpdateLocationDto } from '../src/business/dto/update-location.dto';
import { DiscoveryService } from '../src/discovery/discovery.service';
import { FavouritesService } from '../src/favourites/favourites.service';
import { BusinessModerationService } from '../src/business/business-moderation.service';
import { DocumentsService } from '../src/business/documents.service';
import { StorageService } from '../src/storage/storage.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { BOOKING_FACTS_SELECT, bookingFacts, bookingTicket } from '../src/mail/booking-email';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, createAppointment, createBusiness, createCustomer } from './setup/factories';

/**
 * How to find us (§318): the pin finds the building, the shop's own words
 * find the door. What matters: a blank box is stored as nothing, a long paste
 * is refused, and the words reach every place a customer is told where to
 * go — the shop page, and the booking's email while the visit is ahead.
 */
describe('How to find us (§318)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let locations: LocationsService;
  let discovery: DiscoveryService;
  let business: TestBusiness;

  const NOTE = '2nd floor of Kigali Heights, opposite the MTN shop. Ask the guard.';

  beforeAll(async () => {
    moduleRef = await createTestModule([
      LocationsService,
      BusinessAccessService,
      DiscoveryService,
      FavouritesService,
      BusinessModerationService,
      DocumentsService,
      { provide: StorageService, useValue: { privateStorageReady: () => false } },
      commonStubs.mail(),
      commonStubs.notifications(),
    ]);
    prisma = moduleRef.get(PrismaService);
    locations = moduleRef.get(LocationsService);
    discovery = moduleRef.get(DiscoveryService);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    business = await createBusiness(prisma, { status: BusinessStatus.APPROVED });
  });

  const create = (body: object) =>
    plainToInstance(CreateLocationDto, { name: 'Remera Branch', address: 'KG 11 Ave', latitude: -1.95, longitude: 30.1, ...body });

  it('trims what is written, and stores a blank box as nothing', async () => {
    const written = create({ findUs: `   ${NOTE}  ` });
    expect(await validate(written)).toHaveLength(0);
    expect(written.findUs).toBe(NOTE);

    const blank = create({ findUs: '   ' });
    expect(await validate(blank)).toHaveLength(0);
    expect(blank.findUs).toBeNull();
  });

  it(`refuses more than ${FIND_US_MAX} letters`, async () => {
    const long = create({ findUs: 'a'.repeat(FIND_US_MAX + 1) });
    expect((await validate(long)).map((e) => e.property)).toEqual(['findUs']);
    expect(await validate(create({ findUs: 'a'.repeat(FIND_US_MAX) }))).toHaveLength(0);
  });

  it('is saved with a new branch, changed with an edit, and taken away by emptying it', async () => {
    const branch = await locations.create(business.userId, create({ findUs: NOTE }));
    expect(branch.findUs).toBe(NOTE);

    const changed = await locations.update(business.userId, branch.id, plainToInstance(UpdateLocationDto, { findUs: 'Ground floor, the green door.' }));
    expect(changed.findUs).toBe('Ground floor, the green door.');

    // Editing anything else leaves it as it was.
    const renamed = await locations.update(business.userId, branch.id, plainToInstance(UpdateLocationDto, { name: 'Remera' }));
    expect(renamed.findUs).toBe('Ground floor, the green door.');

    const emptied = await locations.update(business.userId, branch.id, plainToInstance(UpdateLocationDto, { findUs: '' }));
    expect(emptied.findUs).toBeNull();
  });

  it('is on the shop page a customer reads, and in the shop review our team reads', async () => {
    await prisma.location.update({ where: { id: business.locationId }, data: { findUs: NOTE } });
    const shop = await discovery.findOne(business.locationId);
    expect(shop.findUs).toBe(NOTE);

    const review: any = await moduleRef.get(BusinessModerationService).findOne({ role: 'ADMIN' }, business.businessId);
    expect(review.locations[0].findUs).toBe(NOTE);
  });

  it('is on the customer’s booking email while the visit is ahead — never the shop’s copy, never after', async () => {
    await prisma.location.update({ where: { id: business.locationId }, data: { findUs: NOTE } });
    const customer = await createCustomer(prisma);
    const appointment = await createAppointment(prisma, { business, customerId: customer.userId, status: AppointmentStatus.BOOKED });
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id }, select: BOOKING_FACTS_SELECT });
    const facts = bookingFacts(row);
    expect(facts.findUs).toBe(NOTE);

    const forCustomer = bookingTicket(facts, { timeZone: 'Africa/Kigali', audience: 'CUSTOMER' });
    expect(forCustomer.html).toContain('How to find it');
    expect(forCustomer.html).toContain('opposite the MTN shop');
    expect(forCustomer.text).toContain(`How to find it: ${NOTE}`);

    const forShop = bookingTicket(facts, { timeZone: 'Africa/Kigali', audience: 'BUSINESS' });
    expect(forShop.html).not.toContain('How to find it');

    const done = bookingTicket({ ...facts, status: AppointmentStatus.COMPLETED }, { timeZone: 'Africa/Kigali', audience: 'CUSTOMER' });
    expect(done.text).not.toContain('How to find it');
  });

  it('is said in the reader’s language, with the shop’s words kept as written', () => {
    const facts = { ...bookingFactsFor(), findUs: 'Etage 2 <b>' };
    const rw = bookingTicket(facts, { timeZone: 'Africa/Kigali', audience: 'CUSTOMER', locale: 'rw' });
    expect(rw.text).toContain('Uko wahagera: Etage 2 <b>');
    // Escaped in the picture: a shop's words never become markup.
    expect(rw.html).toContain('Etage 2 &lt;b&gt;');
  });
});

function bookingFactsFor() {
  return {
    id: '3f2a1c9b-0000-4000-8000-000000000001',
    serviceName: 'Cut',
    photoUrl: null,
    quantity: 1,
    shopName: 'Kigali Barbers',
    shopLogoUrl: null,
    branchName: 'Remera',
    address: 'KG 11 Ave',
    latitude: -1.95,
    longitude: 30.1,
    findUs: null,
    startTime: new Date(Date.now() + 86_400_000),
    endTime: new Date(Date.now() + 90_000_000),
    timeZone: 'Africa/Kigali',
    depositMinor: 1000,
    priceMinor: 5000,
    currency: 'RWF',
    status: AppointmentStatus.BOOKED,
    depositPaid: true,
    choices: [],
    hasPrivateAnswers: false,
    note: null,
  };
}
