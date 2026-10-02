import { BadRequestException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { DiscoveryService } from '../src/discovery/discovery.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { createBusiness } from './setup/factories';

/**
 * §107. Distance orders the list; a radius narrows it.
 *
 * The distinction these exist to protect: knowing where somebody is should put
 * the nearest shop first, never hide the one across town. A filter is
 * something a customer asks for (§106.2), and a position is not a request to
 * be shown less.
 */
describe('Nearest (§107)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let discovery: DiscoveryService;

  /** Kigali city centre, roughly. */
  const CENTRE = { lat: -1.9536, lng: 30.0606 };

  beforeAll(async () => {
    moduleRef = await createTestModule([
      DiscoveryService,
      commonStubs.mail(),
      commonStubs.notifications(),
    ]);
    prisma = moduleRef.get(PrismaService);
    discovery = moduleRef.get(DiscoveryService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const at = async (lat: number, lng: number) => {
    const business = await createBusiness(prisma);
    await prisma.location.update({
      where: { id: business.locationId },
      data: { latitude: lat, longitude: lng },
    });
    return business.locationId;
  };

  it('orders by distance and keeps everything', async () => {
    const near = await at(-1.9540, 30.0610); // metres away
    const far = await at(-2.6000, 29.7400); // roughly Rusizi, ~80 km

    const result = await discovery.search({ sort: 'distance', ...CENTRE } as never);

    // Both present. The far one is still bookable, just further down.
    expect(result.total).toBe(2);
    expect(result.locations.map((l) => l.id)).toEqual([near, far]);
  });

  it('reports how far each one is', async () => {
    await at(-1.9540, 30.0610);

    const [row] = (await discovery.search({ sort: 'distance', ...CENTRE } as never))
      .locations;

    expect(row.distanceKm).toBeGreaterThan(0);
    expect(row.distanceKm).toBeLessThan(1);
  });

  it('a radius is what excludes — and only when asked for', async () => {
    await at(-1.9540, 30.0610);
    await at(-2.6000, 29.7400);

    const ordered = await discovery.search({ sort: 'distance', ...CENTRE } as never);
    expect(ordered.total).toBe(2);

    const narrowed = await discovery.search({
      sort: 'distance',
      ...CENTRE,
      radiusKm: 5,
    } as never);
    expect(narrowed.total).toBe(1);
  });

  it('puts a branch with no coordinates last rather than dropping it', async () => {
    const near = await at(-1.9540, 30.0610);
    const business = await createBusiness(prisma);
    await prisma.location.update({
      where: { id: business.locationId },
      data: { latitude: null, longitude: null },
    });

    const result = await discovery.search({ sort: 'distance', ...CENTRE } as never);

    // It cannot be measured, which is not a reason to hide it.
    expect(result.total).toBe(2);
    expect(result.locations[0].id).toBe(near);
    expect(result.locations[1].distanceKm).toBeUndefined();
  });

  it('carries no distance when no position was given', async () => {
    await at(-1.9540, 30.0610);
    const [row] = (await discovery.search({})).locations;
    expect(row.distanceKm).toBeUndefined();
  });

  describe('refusals', () => {
    it('refuses to sort by distance without a position', async () => {
      await expect(discovery.search({ sort: 'distance' } as never)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('refuses half a coordinate', async () => {
      await expect(discovery.search({ lat: CENTRE.lat } as never)).rejects.toThrow(
        /together/,
      );
    });

    it('refuses a radius around nothing', async () => {
      await expect(discovery.search({ radiusKm: 5 } as never)).rejects.toThrow(
        /radius around something/,
      );
    });
  });
});
