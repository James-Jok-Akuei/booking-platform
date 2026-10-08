import { AppointmentStatus, BusinessStatus } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ServicesService } from '../src/business/services.service';
import { CreateServiceDto } from '../src/business/dto/create-service.dto';
import { UpdateServiceDto } from '../src/business/dto/update-service.dto';
import { LegalService } from '../src/legal/legal.service';
import { LocationsService } from '../src/business/locations.service';
import { BusinessAccessService } from '../src/business/business-access.service';
import { DiscoveryService } from '../src/discovery/discovery.service';
import { FavouritesService } from '../src/favourites/favourites.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CUSTOMER_APPOINTMENT_SELECT } from '../src/appointments/appointment-select';
import { createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, createAppointment, createBusiness, createCustomer } from './setup/factories';

/**
 * What a service says about itself (§180): a description, and what to know
 * before coming. What matters: both reach every place a customer reads them —
 * the shopfront before booking and the reservation after — a blank box is
 * stored as nothing rather than as "", and a runaway paste is refused.
 */
describe('Service title, description and instructions (§180, §185)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let services: ServicesService;
  let discovery: DiscoveryService;
  let business: TestBusiness;

  beforeAll(async () => {
    moduleRef = await createTestModule([
      ServicesService,
      LegalService,
      LocationsService,
      BusinessAccessService,
      DiscoveryService,
      FavouritesService,
    ]);
    prisma = moduleRef.get(PrismaService);
    services = moduleRef.get(ServicesService);
    discovery = moduleRef.get(DiscoveryService);
    await resetDatabase(prisma);
    await moduleRef.get(PlatformSettingsService).setPlatformFeePercentage(10, { role: 'ADMIN' });
    business = await createBusiness(prisma, { status: BusinessStatus.APPROVED, priceMinor: 4500 });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  const dto = (body: object) => plainToInstance(CreateServiceDto, body);

  it('stores a blank as nothing, and trims what is written', async () => {
    const tidy = dto({
      name: 'Haircut',
      title: '  Sharp fades, clean line-ups  ',
      description: '   ',
      instructions: '  Come ten minutes early.  ',
      durationMinutes: 30,
      depositPercentage: 20,
      offers: [{ locationId: business.locationId, priceMinor: 7000 }],
    });
    expect(await validate(tidy)).toHaveLength(0);
    expect(tidy.title).toBe('Sharp fades, clean line-ups');
    expect(tidy.description).toBeNull();
    expect(tidy.instructions).toBe('Come ten minutes early.');
  });

  it('keeps a title to one line on a phone: 100 characters', async () => {
    const base = { name: 'Haircut', durationMinutes: 30, depositPercentage: 20, offers: [] };
    expect((await validate(dto({ ...base, title: 'x'.repeat(101) }))).some((e) => e.property === 'title')).toBe(true);
    expect((await validate(dto({ ...base, title: 'x'.repeat(100) }))).some((e) => e.property === 'title')).toBe(false);
    expect(
      (await validate(plainToInstance(UpdateServiceDto, { title: 'x'.repeat(101) }))).some(
        (e) => e.property === 'title',
      ),
    ).toBe(true);
  });

  it('refuses instructions longer than a phone screen wants, and keeps a description longer', async () => {
    const long = dto({ name: 'Haircut', instructions: 'x'.repeat(601), durationMinutes: 30, depositPercentage: 20, offers: [] });
    expect((await validate(long)).some((e) => e.property === 'instructions')).toBe(true);

    const fine = dto({ name: 'Haircut', instructions: 'x'.repeat(600), description: 'y'.repeat(2000), durationMinutes: 30, depositPercentage: 20, offers: [] });
    expect((await validate(fine)).filter((e) => e.property === 'instructions' || e.property === 'description')).toHaveLength(0);

    const patch = plainToInstance(UpdateServiceDto, { instructions: 'x'.repeat(601) });
    expect((await validate(patch)).some((e) => e.property === 'instructions')).toBe(true);
  });

  it('reaches the shopfront, and the reservation that books it', async () => {
    const created = await services.create(business.userId, {
      name: 'Hot-towel shave',
      title: 'The closest shave in Kigali',
      description: 'A straight-razor shave with hot towels.',
      instructions: 'Come with a clean face and ten minutes to spare.',
      durationMinutes: 30,
      depositPercentage: 20,
      offers: [{ locationId: business.locationId, priceMinor: 7000 }],
    });
    expect(created.title).toBe('The closest shave in Kigali');
    expect(created.description).toBe('A straight-razor shave with hot towels.');
    expect(created.instructions).toBe('Come with a clean face and ten minutes to spare.');

    // The fixture's own service, written to after the fact: an edit at the
    // shop reaches a booking already made, because the reservation reads
    // the service live.
    await services.update(business.userId, business.serviceId, {
      title: '  Sharp fades, clean line-ups ',
      description: 'A classic cut.',
      instructions: 'Parking is at the back.\nAsk for Jean at the desk.',
    });

    // Before booking: the customer's view of the shop.
    const shop: any = await discovery.findOne(business.locationId);
    const listed = shop.services.find((s: any) => s.id === business.serviceId);
    expect(listed.title).toBe('Sharp fades, clean line-ups');
    expect(listed.description).toBe('A classic cut.');
    expect(listed.instructions).toBe('Parking is at the back.\nAsk for Jean at the desk.');

    // After booking: the reservation.
    const customer = await createCustomer(prisma);
    const appointment = await createAppointment(prisma, {
      business,
      customerId: customer.userId,
      status: AppointmentStatus.BOOKED,
    });
    const seen = await prisma.appointment.findUniqueOrThrow({
      where: { id: appointment.id },
      select: CUSTOMER_APPOINTMENT_SELECT,
    });
    expect(seen.service.instructions).toContain('Parking is at the back.');

    // Cleared at the shop: gone from the reservation too, as nothing, not "".
    await services.update(business.userId, business.serviceId, { instructions: '' });
    const again = await prisma.appointment.findUniqueOrThrow({
      where: { id: appointment.id },
      select: CUSTOMER_APPOINTMENT_SELECT,
    });
    expect(again.service.instructions).toBeNull();
  });
});
