import { TestingModule } from '@nestjs/testing';
import { DiscoveryService } from '../src/discovery/discovery.service';
import { LocationsService } from '../src/business/locations.service';
import { BusinessAccessService } from '../src/business/business-access.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { createBusiness } from './setup/factories';

/**
 * §104. Provinces and districts.
 *
 * The place lives on the LOCATION, which is what lets one business be in two
 * provinces — the thing that was actually asked for. These assert that, and
 * that a branch which has not said where it is stays out of a place filter
 * rather than appearing in all of them.
 */
describe('Places (§104)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let discovery: DiscoveryService;
  let locations: LocationsService;

  const districtByCode = (code: string) =>
    prisma.district.findUniqueOrThrow({ where: { code }, include: { province: true } });

  beforeAll(async () => {
    moduleRef = await createTestModule([
      DiscoveryService,
      LocationsService,
      BusinessAccessService,
      commonStubs.mail(),
      commonStubs.notifications(),
    ]);
    prisma = moduleRef.get(PrismaService);
    discovery = moduleRef.get(DiscoveryService);
    locations = moduleRef.get(LocationsService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('seeds five provinces and thirty districts', async () => {
    // Reference data lives in a migration, not a demo seed, so a fresh
    // deployment has it — a place filter against an empty table matches
    // nothing and looks like a broken search.
    expect(await prisma.province.count()).toBe(5);
    expect(await prisma.district.count()).toBe(30);

    const kigali = await prisma.province.findUniqueOrThrow({
      where: { code: 'KIGALI' },
      include: { districts: true },
    });
    expect(kigali.districts.map((d) => d.name).sort()).toEqual([
      'Gasabo',
      'Kicukiro',
      'Nyarugenge',
    ]);
  });

  it('puts one business in two provinces, through its branches', async () => {
    const business = await createBusiness(prisma);
    const gasabo = await districtByCode('GASABO');
    const musanze = await districtByCode('MUSANZE');

    await prisma.location.update({
      where: { id: business.locationId },
      data: { districtId: gasabo.id },
    });
    const second = await prisma.location.create({
      data: {
        businessId: business.businessId,
        name: 'Musanze Branch',
        address: 'Musanze',
        latitude: -1.5,
        longitude: 29.6,
        districtId: musanze.id,
      },
    });

    const inKigali = await discovery.search({ provinceId: gasabo.provinceId });
    const inNorth = await discovery.search({ provinceId: musanze.provinceId });

    expect(inKigali.locations.map((l) => l.id)).toEqual([business.locationId]);
    expect(inNorth.locations.map((l) => l.id)).toEqual([second.id]);
  });

  it('filters by district, which is the unit that discriminates in Kigali', async () => {
    const a = await createBusiness(prisma);
    const b = await createBusiness(prisma);
    const gasabo = await districtByCode('GASABO');
    const kicukiro = await districtByCode('KICUKIRO');

    await prisma.location.update({
      where: { id: a.locationId },
      data: { districtId: gasabo.id },
    });
    await prisma.location.update({
      where: { id: b.locationId },
      data: { districtId: kicukiro.id },
    });

    // Both are in the same province, so only the district tells them apart.
    const byProvince = await discovery.search({ provinceId: gasabo.provinceId });
    expect(byProvince.total).toBe(2);

    const byDistrict = await discovery.search({ districtId: gasabo.id });
    expect(byDistrict.locations.map((l) => l.id)).toEqual([a.locationId]);
  });

  it('lets the narrower filter win when both are sent', async () => {
    const business = await createBusiness(prisma);
    const gasabo = await districtByCode('GASABO');
    await prisma.location.update({
      where: { id: business.locationId },
      data: { districtId: gasabo.id },
    });

    const kicukiro = await districtByCode('KICUKIRO');
    const result = await discovery.search({
      provinceId: gasabo.provinceId,
      districtId: kicukiro.id,
    });

    // District wins, so a Gasabo branch is excluded rather than the two being
    // ANDed into a contradiction nobody can read.
    expect(result.total).toBe(0);
  });

  it('leaves a branch with no district out of every place filter', async () => {
    const business = await createBusiness(prisma);
    const gasabo = await districtByCode('GASABO');

    // Visible when nothing is filtered…
    expect((await discovery.search({})).total).toBe(1);
    // …and absent once a place is asked for, because it has not said where it is.
    expect((await discovery.search({ provinceId: gasabo.provinceId })).total).toBe(0);
    expect(business.locationId).toBeTruthy();
  });

  it('carries the place back on each result', async () => {
    const business = await createBusiness(prisma);
    const gasabo = await districtByCode('GASABO');
    await prisma.location.update({
      where: { id: business.locationId },
      data: { districtId: gasabo.id },
    });

    const [row] = (await discovery.search({})).locations;
    expect(row.district).toEqual({
      id: gasabo.id,
      name: 'Gasabo',
      provinceId: gasabo.provinceId,
      provinceName: 'City of Kigali',
    });
  });

  it('a business can set its branch district', async () => {
    const business = await createBusiness(prisma);
    const musanze = await districtByCode('MUSANZE');

    await locations.update(business.userId, business.locationId, {
      districtId: musanze.id,
    });

    const mine = await locations.findAll(business.userId);
    expect(mine[0].district?.name).toBe('Musanze');
    expect(mine[0].district?.province.name).toBe('Northern Province');
  });
});
