import { jest } from '@jest/globals';
import { TestingModule } from '@nestjs/testing';
import { RoutingService, straightLineKm } from '../src/routing/routing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestModule, resetDatabase } from './setup/test-module';
import { createBusiness } from './setup/factories';

/**
 * Road distance to a branch (§157). What matters: a routing service that is
 * slow or down never fails the customer — the straight line answers, marked
 * as such — and the same question is not asked of it twice in ten minutes.
 */
describe('Road distance to a branch (§157)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let routing: RoutingService;
  const realFetch = global.fetch;
  const fetchMock = jest.fn<typeof fetch>();

  beforeAll(async () => {
    moduleRef = await createTestModule([RoutingService]);
    prisma = moduleRef.get(PrismaService);
    routing = moduleRef.get(RoutingService);
    await resetDatabase(prisma);
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(async () => {
    global.fetch = realFetch;
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  beforeEach(() => fetchMock.mockReset());

  /** A branch with a pin on it — the factory's has none. */
  const pinned = async () => {
    const business = await createBusiness(prisma);
    await prisma.location.update({
      where: { id: business.locationId },
      data: { latitude: -1.9403, longitude: 30.1274 },
    });
    return business;
  };

  const osrm = (metres: number, seconds: number) =>
    new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: metres, duration: seconds }] }), {
      status: 200,
    });

  it('measures the straight line the same way the search does', () => {
    // Nyarugenge to Kimironko, about seven kilometres.
    const km = straightLineKm({ lat: -1.9441, lng: 30.0619 }, { lat: -1.9403, lng: 30.1274 });
    expect(km).toBeGreaterThan(7);
    expect(km).toBeLessThan(7.6);
  });

  it('answers with the road and a driving time when the service answers', async () => {
    const business = await pinned();
    fetchMock.mockResolvedValueOnce(osrm(11_280, 17 * 60 + 20));

    const route = await routing.toLocation(business.locationId, { lat: -1.9441, lng: 30.0619 });

    expect(route).toEqual({ distanceKm: 11.28, minutes: 17, by: 'road' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/route/v1/driving/30.0619,-1.9441;');
  });

  it('falls back to the straight line, with no time, when the service does not', async () => {
    const business = await pinned();
    fetchMock.mockRejectedValueOnce(new Error('timeout'));

    const route = await routing.toLocation(business.locationId, { lat: -1.95, lng: 30.1 });

    expect(route.by).toBe('line');
    expect(route.minutes).toBeNull();
    expect(route.distanceKm).toBeGreaterThan(0);
  });

  it('asks the service once for the same start and branch', async () => {
    const business = await pinned();
    fetchMock.mockResolvedValue(osrm(5000, 600));

    await routing.toLocation(business.locationId, { lat: -1.9500, lng: 30.1000 });
    await routing.toLocation(business.locationId, { lat: -1.9501, lng: 30.1001 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('404s for a branch that is closed or has no pin', async () => {
    const business = await createBusiness(prisma);
    await prisma.location.update({
      where: { id: business.locationId },
      data: { latitude: null, longitude: null },
    });
    await expect(
      routing.toLocation(business.locationId, { lat: -1.95, lng: 30.1 }),
    ).rejects.toThrow(/not found/);
  });
});
