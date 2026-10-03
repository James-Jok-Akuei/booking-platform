import { NotFoundException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { ServiceDraftsService } from '../src/business/service-drafts.service';
import { BusinessAccessService } from '../src/business/business-access.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, createBusiness } from './setup/factories';

/**
 * Half-written services (§123).
 *
 * The design decision worth protecting is where they live: a SEPARATE table, not
 * a flag on `services`. A draft in that table would be one forgotten `where`
 * away from a customer seeing a service with no price — and §119 had just
 * finished widening a predicate because that filter was missed in two places.
 */
describe('Service drafts (§123)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let drafts: ServiceDraftsService;
  let shop: TestBusiness;
  let other: TestBusiness;

  beforeAll(async () => {
    moduleRef = await createTestModule([
      ServiceDraftsService,
      BusinessAccessService,
      commonStubs.mail(),
      commonStubs.notifications(),
      commonStubs.payments(),
    ]);
    prisma = moduleRef.get(PrismaService);
    drafts = moduleRef.get(ServiceDraftsService);
    await resetDatabase(prisma);
    shop = await createBusiness(prisma);
    other = await createBusiness(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await prisma.serviceDraft.deleteMany({});
  });

  it('starts empty, and that is legal', async () => {
    const draft = await drafts.create(shop.userId);

    // Nothing is validated. A draft exists BECAUSE it is incomplete, so applying
    // the service rules to it would defeat the point.
    expect(draft.name).toBeNull();
    expect(draft.durationMinutes).toBeNull();
    expect(draft.offers).toEqual([]);
  });

  it('keeps what was typed, a field at a time', async () => {
    const draft = await drafts.create(shop.userId);

    await drafts.update(shop.userId, draft.id, { name: 'Deep' });
    const mid = await drafts.update(shop.userId, draft.id, { name: 'Deep clean' });
    expect(mid.name).toBe('Deep clean');

    const withPrice = await drafts.update(shop.userId, draft.id, {
      durationMinutes: 90,
      offers: [{ locationId: shop.locationId, priceMinor: 15_000 }],
    });
    // An earlier field is not lost by a later save.
    expect(withPrice.name).toBe('Deep clean');
    expect(withPrice.offers).toEqual([
      { locationId: shop.locationId, priceMinor: 15_000 },
    ]);
  });

  it('never leaves the shop that wrote it', async () => {
    const draft = await drafts.create(shop.userId);

    // 404 rather than 403, scoped in the `where` rather than loaded and then
    // checked — the rule used everywhere else here.
    await expect(
      drafts.update(other.userId, draft.id, { name: 'stolen' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(drafts.discard(other.userId, draft.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await drafts.list(other.userId)).toHaveLength(0);
  });

  it('is the shop’s, not one person’s', async () => {
    const colleague = await prisma.businessMembership.findFirstOrThrow({
      where: { businessProfileId: shop.businessId },
      select: { userId: true },
    });
    await drafts.create(shop.userId);

    // A shop is a shared workspace (§21.3). Two people each holding invisible
    // half-finished services is how a service gets written twice.
    expect(await drafts.list(colleague.userId)).toHaveLength(1);
  });

  it('is really deleted when discarded, unlike almost everything here', async () => {
    const draft = await drafts.create(shop.userId);

    await drafts.discard(shop.userId, draft.id);

    // §75 and §101 established that this codebase retires rather than deletes.
    // A draft is the exception and it is worth saying why: no customer saw it,
    // no money moved because of it, and keeping every abandoned half-sentence
    // would turn the list into the mess it exists to prevent.
    expect(await prisma.serviceDraft.findUnique({ where: { id: draft.id } })).toBeNull();
    await expect(drafts.discard(shop.userId, draft.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lists the most recently touched first', async () => {
    const first = await drafts.create(shop.userId);
    const second = await drafts.create(shop.userId);
    await drafts.update(shop.userId, first.id, { name: 'Touched last' });

    expect((await drafts.list(shop.userId)).map((d) => d.id)).toEqual([
      first.id,
      second.id,
    ]);
  });
});
