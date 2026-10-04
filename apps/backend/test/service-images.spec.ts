// In Jest's ESM mode `jest` is not a global — it has to be imported.
import { jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import {
  MAX_IMAGES_PER_SERVICE,
  ServiceImagesService,
} from '../src/business/service-images.service';
import { BusinessAccessService } from '../src/business/business-access.service';
import { StorageService } from '../src/storage/storage.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, createBusiness } from './setup/factories';

/**
 * Photos of a service (§132).
 *
 * The rules worth protecting are the cap, the scoping, and the ORDER of the two
 * — ownership is proved before the count is read, so a stranger probing a
 * service id cannot learn how full somebody else's gallery is.
 */
describe('Service images (§132)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let images: ServiceImagesService;
  let shop: TestBusiness;
  let other: TestBusiness;
  let serviceId: string;
  let otherServiceId: string;
  const uploaded: string[] = [];
  const removed: string[] = [];

  const file = (name = 'a.jpg') =>
    ({
      buffer: Buffer.from('not-really-a-jpeg'),
      mimetype: 'image/jpeg',
      originalname: name,
    }) as Express.Multer.File;

  const makeService = async (business: TestBusiness) => {
    const service = await prisma.service.create({
      data: {
        businessId: business.businessId,
        name: 'Haircut',
        durationMinutes: 30,
        currency: 'RWF',
      },
      select: { id: true },
    });
    return service.id;
  };

  beforeAll(async () => {
    moduleRef = await createTestModule([
      ServiceImagesService,
      BusinessAccessService,
      {
        provide: StorageService,
        useValue: {
          upload: jest.fn(async (_b: Buffer, _m: string, prefix: string) => {
            const url = `https://example.test/${prefix}/${uploaded.length}.jpg`;
            uploaded.push(url);
            return url;
          }),
          remove: jest.fn(async (url: string) => {
            removed.push(url);
          }),
        },
      },
      commonStubs.mail(),
      commonStubs.notifications(),
      commonStubs.payments(),
    ]);
    prisma = moduleRef.get(PrismaService);
    images = moduleRef.get(ServiceImagesService);

    await resetDatabase(prisma);
    shop = await createBusiness(prisma);
    other = await createBusiness(prisma);
    serviceId = await makeService(shop);
    otherServiceId = await makeService(other);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  it('stores a photo and appends it to the end', async () => {
    const first = await images.upload(shop.userId, serviceId, file('one.jpg'));
    const second = await images.upload(shop.userId, serviceId, file('two.jpg'));

    expect(first.displayOrder).toBe(0);
    expect(second.displayOrder).toBe(1);
    expect(first.url).toContain(`services/${serviceId}`);
  });

  it('reports how much room is left', async () => {
    const listing = await images.list(shop.userId, serviceId);

    expect(listing.count).toBe(2);
    expect(listing.limit).toBe(MAX_IMAGES_PER_SERVICE);
    expect(listing.remaining).toBe(MAX_IMAGES_PER_SERVICE - 2);
  });

  it(`refuses the ${MAX_IMAGES_PER_SERVICE + 1}th photo, naming the limit`, async () => {
    // Two are already there.
    for (let i = 2; i < MAX_IMAGES_PER_SERVICE; i += 1) {
      await images.upload(shop.userId, serviceId, file(`${i}.jpg`));
    }

    const full = await images.list(shop.userId, serviceId);
    expect(full.count).toBe(MAX_IMAGES_PER_SERVICE);
    expect(full.remaining).toBe(0);

    await expect(
      images.upload(shop.userId, serviceId, file('twelfth.jpg')),
    ).rejects.toThrow(BadRequestException);

    // The message carries the number, so a screen need not hardcode it.
    await expect(
      images.upload(shop.userId, serviceId, file('twelfth.jpg')),
    ).rejects.toThrow(String(MAX_IMAGES_PER_SERVICE));
  });

  it('does not store the file when the service is already full', async () => {
    const before = uploaded.length;

    await expect(
      images.upload(shop.userId, serviceId, file('nope.jpg')),
    ).rejects.toThrow(BadRequestException);

    // The cap is checked BEFORE the upload, so a refused photo leaves no
    // orphaned object behind in storage.
    expect(uploaded.length).toBe(before);
  });

  it("refuses to upload to another shop's service, as a 404", async () => {
    await expect(
      images.upload(shop.userId, otherServiceId, file('sneaky.jpg')),
    ).rejects.toThrow(NotFoundException);
  });

  it('a FULL foreign service still answers 404, not "full" (§132.1)', async () => {
    const theirs = await makeService(other);
    for (let i = 0; i < MAX_IMAGES_PER_SERVICE; i += 1) {
      await images.upload(other.userId, theirs, file(`t${i}.jpg`));
    }

    // The ordering is the point: ownership is proved BEFORE the count is read.
    // If the cap were checked first this would answer "already has the maximum
    // of 11 photos", which tells a competitor exactly how full it is.
    await expect(
      images.upload(shop.userId, theirs, file('probe.jpg')),
    ).rejects.toThrow(NotFoundException);
  });

  it("will not read another shop's photos", async () => {
    await expect(images.list(shop.userId, otherServiceId)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("will not delete another shop's photo even with the right id", async () => {
    const theirs = await images.upload(other.userId, otherServiceId, file('t.jpg'));

    // A real photo id, but reached through a service the caller does not own.
    await expect(
      images.remove(shop.userId, otherServiceId, theirs.id),
    ).rejects.toThrow(NotFoundException);

    // And still there afterwards.
    const listing = await images.list(other.userId, otherServiceId);
    expect(listing.images.map((i) => i.id)).toContain(theirs.id);
  });

  it('will not delete a photo through a service it does not belong to', async () => {
    const mine = await prisma.serviceMedia.findFirstOrThrow({ where: { serviceId } });
    const second = await makeService(shop);

    // Same owner, wrong service: scoped by serviceId as well as by id.
    await expect(images.remove(shop.userId, second, mine.id)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('deletes the row and the stored file, and frees a slot', async () => {
    const mine = await prisma.serviceMedia.findFirstOrThrow({
      where: { serviceId },
      orderBy: { displayOrder: 'desc' },
    });

    const result = await images.remove(shop.userId, serviceId, mine.id);
    expect(result.message).toBe('Photo deleted.');
    expect(removed).toContain(mine.url);

    const after = await images.list(shop.userId, serviceId);
    expect(after.count).toBe(MAX_IMAGES_PER_SERVICE - 1);
    expect(after.remaining).toBe(1);

    // And the freed slot is usable.
    await expect(
      images.upload(shop.userId, serviceId, file('again.jpg')),
    ).resolves.toBeDefined();
  });

  it('refuses a request with no file at all', async () => {
    await expect(
      images.upload(shop.userId, serviceId, undefined),
    ).rejects.toThrow(BadRequestException);
  });

  it('drops photos when the service is deleted', async () => {
    const temporary = await makeService(shop);
    await images.upload(shop.userId, temporary, file('bye.jpg'));

    await prisma.service.delete({ where: { id: temporary } });

    const left = await prisma.serviceMedia.count({ where: { serviceId: temporary } });
    expect(left).toBe(0);
  });
});
