import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { BusinessProfileService } from '../src/business/business-profile.service';
import { StorageService } from '../src/storage/storage.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, createBusiness } from './setup/factories';

/**
 * §88. A business can upload its own logo and cover.
 *
 * The profile DTO has always accepted `logoUrl` as a string, which assumed the
 * image was already hosted somewhere. These assert the bytes actually land and
 * that replacing one does not strand the old object.
 */
describe('Profile images (§88)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let profiles: BusinessProfileService;
  let business: TestBusiness;

  const uploaded: string[] = [];
  const removed: string[] = [];

  const storageStub = {
    upload: async (_buffer: Buffer, _mime: string, keyPrefix: string) => {
      const url = `https://cdn.test/${keyPrefix}/${uploaded.length + 1}.png`;
      uploaded.push(url);
      return url;
    },
    remove: async (url: string) => {
      removed.push(url);
    },
  };

  const file = (mimetype = 'image/png') =>
    ({ buffer: Buffer.from('x'), mimetype, size: 1 }) as Express.Multer.File;

  beforeAll(async () => {
    moduleRef = await createTestModule([
      BusinessProfileService,
      { provide: StorageService, useValue: storageStub },
      commonStubs.mail(),
      commonStubs.notifications(),
    ]);
    prisma = moduleRef.get(PrismaService);
    profiles = moduleRef.get(BusinessProfileService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    uploaded.length = 0;
    removed.length = 0;
    business = await createBusiness(prisma);
  });

  it('stores a logo and records it on the profile', async () => {
    const result = await profiles.setImage(business.businessId, 'logo', file());

    expect(result.logoUrl).toBe(uploaded[0]);
    expect(uploaded[0]).toContain(`businesses/${business.businessId}`);
    expect(result.coverImageUrl).toBeNull();
  });

  it('stores a cover without touching the logo', async () => {
    await profiles.setImage(business.businessId, 'logo', file());
    const result = await profiles.setImage(business.businessId, 'cover', file());

    expect(result.logoUrl).toBe(uploaded[0]);
    expect(result.coverImageUrl).toBe(uploaded[1]);
  });

  it('removes the previous image when one is replaced', async () => {
    const first = await profiles.setImage(business.businessId, 'logo', file());
    await profiles.setImage(business.businessId, 'logo', file());

    expect(removed).toEqual([first.logoUrl]);
  });

  it('removes nothing on the first upload', async () => {
    await profiles.setImage(business.businessId, 'logo', file());
    expect(removed).toEqual([]);
  });

  it('refuses an empty upload', async () => {
    await expect(
      profiles.setImage(business.businessId, 'logo', undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a business that does not exist', async () => {
    await expect(
      profiles.setImage(
        '00000000-0000-4000-8000-000000000000',
        'logo',
        file(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not write a URL when storage fails', async () => {
    const failing = {
      ...storageStub,
      upload: async () => {
        throw new Error('R2 is down');
      },
    };
    const service = new BusinessProfileService(prisma, failing as never, { notify: async () => null } as never);

    await expect(
      service.setImage(business.businessId, 'logo', file()),
    ).rejects.toThrow('R2 is down');

    const after = await prisma.businessProfile.findUnique({
      where: { id: business.businessId },
      select: { logoUrl: true },
    });
    expect(after?.logoUrl).toBeNull();
  });
});
