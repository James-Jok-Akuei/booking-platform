import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TestingModule } from '@nestjs/testing';
import { StorageService } from '../src/storage/storage.service';
import { AccountService } from '../src/users/account.service';
import { SetDisplayNameDto } from '../src/users/dto/set-display-name.dto';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestModule, resetDatabase } from './setup/test-module';
import { createCustomer } from './setup/factories';

/**
 * The review name, changed from the account (§144).
 *
 * Two things matter: Anonymous is `null` and never the word, and a name set
 * here obeys the same rules as one set through a review — it is the same field.
 */
describe('The name on your reviews, set from the account (§144)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let account: AccountService;

  beforeAll(async () => {
    moduleRef = await createTestModule([AccountService, StorageService]);
    prisma = moduleRef.get(PrismaService);
    account = moduleRef.get(AccountService);
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  const check = async (body: unknown) => {
    const dto = plainToInstance(SetDisplayNameDto, body);
    return { dto, errors: await validate(dto as object) };
  };

  it('saves a name, and null turns it back to Anonymous', async () => {
    const customer = await createCustomer(prisma);

    expect(await account.setDisplayName(customer.userId, 'Aline')).toEqual({
      id: customer.userId,
      displayName: 'Aline',
    });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: customer.userId } })).displayName,
    ).toBe('Aline');

    await account.setDisplayName(customer.userId, null);
    // Null, not the word (§31.2).
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: customer.userId } })).displayName,
    ).toBeNull();
  });

  it('will not rename a closed account', async () => {
    const customer = await createCustomer(prisma);
    await prisma.user.update({ where: { id: customer.userId }, data: { closedAt: new Date() } });
    await expect(account.setDisplayName(customer.userId, 'Ghost')).rejects.toThrow(/not found/);
  });

  describe('what may be sent', () => {
    it('accepts null, and a name — trimmed', async () => {
      expect((await check({ displayName: null })).errors).toHaveLength(0);
      const { dto, errors } = await check({ displayName: '  Aline  ' });
      expect(errors).toHaveLength(0);
      expect(dto.displayName).toBe('Aline');
    });

    it('refuses nothing at all, a name too short, and a link', async () => {
      expect((await check({})).errors.length).toBeGreaterThan(0);
      expect((await check({ displayName: 'A' })).errors.length).toBeGreaterThan(0);
      expect((await check({ displayName: 'mysite.com' })).errors.length).toBeGreaterThan(0);
      expect((await check({ displayName: 42 })).errors.length).toBeGreaterThan(0);
    });
  });
});
