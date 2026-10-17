import { LegalDocumentKind } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { LegalService } from '../src/legal/legal.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { createAdmin, createCustomer } from './setup/factories';

/**
 * Legal documents, written by an admin and versioned (§122).
 *
 * The rule everything here protects: **a published version is never edited.**
 * What somebody agreed to has to stay readable exactly as they read it, so a
 * change is a new version and the old one survives beside it.
 */
describe('Legal documents (§122)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let legal: LegalService;
  let admin: { userId: string; email: string };
  let customer: { userId: string; email: string };

  beforeAll(async () => {
    moduleRef = await createTestModule([
      LegalService,
      commonStubs.mail(),
      commonStubs.notifications(),
      commonStubs.payments(),
    ]);
    prisma = moduleRef.get(PrismaService);
    legal = moduleRef.get(LegalService);
    await resetDatabase(prisma);
    admin = await createAdmin(prisma);
    customer = await createCustomer(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await prisma.legalAcceptance.deleteMany({});
    await prisma.legalDocument.deleteMany({});
  });

  /** A published version of `kind`, with whatever text. */
  const publish = async (kind: LegalDocumentKind, body: string) => {
    const draft = await legal.startDraft(kind);
    await legal.updateDraft(draft.id, { body });
    return legal.publish(draft.id, admin.userId);
  };

  it('refuses to publish nothing', async () => {
    const draft = await legal.startDraft(LegalDocumentKind.TERMS_OF_USE);

    await expect(legal.publish(draft.id, admin.userId)).rejects.toThrow(
      /nothing written/,
    );
  });

  it('refuses to edit a published version', async () => {
    const published = await publish(LegalDocumentKind.TERMS_OF_USE, 'Be good.');

    // The whole point. Editing in place would rewrite the terms under everyone
    // who already agreed to them.
    await expect(
      legal.updateDraft(published.id, { body: 'Be evil.' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('starts the next version seeded with the last one', async () => {
    await publish(LegalDocumentKind.TERMS_OF_USE, 'Be good.');

    const next = await legal.startDraft(LegalDocumentKind.TERMS_OF_USE);

    // Retyping four thousand words to change a sentence is how mistakes get in.
    expect(next.version).toBe(2);
    expect(next.body).toBe('Be good.');
    expect(next.publishedAt).toBeNull();
  });

  it('gives back the draft already going, rather than a second one', async () => {
    const first = await legal.startDraft(LegalDocumentKind.PRIVACY_POLICY);
    const again = await legal.startDraft(LegalDocumentKind.PRIVACY_POLICY);

    expect(again.id).toBe(first.id);
    expect(
      await prisma.legalDocument.count({
        where: { kind: LegalDocumentKind.PRIVACY_POLICY },
      }),
    ).toBe(1);
  });

  it('two drafts of one kind cannot exist, whatever the service does', async () => {
    await legal.startDraft(LegalDocumentKind.TERMS_OF_USE);

    // The partial unique index, not the read-then-write above it: two admins
    // pressing "new version" together both pass that read.
    await expect(
      prisma.legalDocument.create({
        data: {
          kind: LegalDocumentKind.TERMS_OF_USE,
          version: 99,
          title: 'Sneaky',
          body: 'x',
        },
      }),
    ).rejects.toThrow();
  });

  it('shows only the newest published version, and never a draft', async () => {
    await publish(LegalDocumentKind.TERMS_OF_USE, 'Version one.');
    await publish(LegalDocumentKind.TERMS_OF_USE, 'Version two.');
    await legal.startDraft(LegalDocumentKind.TERMS_OF_USE); // v3, unpublished

    const current = await legal.currentOf(LegalDocumentKind.TERMS_OF_USE);

    expect(current.version).toBe(2);
    expect(current.body).toBe('Version two.');
    expect((await legal.published()).filter((d) => d.kind === 'TERMS_OF_USE')).toHaveLength(1);
  });

  describe('who agreed to what', () => {
    it('goes stale when a new version is published', async () => {
      const v1 = await publish(LegalDocumentKind.TERMS_OF_USE, 'Version one.');
      await legal.accept(customer.userId, v1.id);

      const before = await legal.statusFor(customer.userId);
      expect(before[0]).toMatchObject({ acceptedVersion: 1, needsAcceptance: false });

      await publish(LegalDocumentKind.TERMS_OF_USE, 'Version two.');

      // This is what versioning is FOR: the acceptance is still true, and it is
      // no longer current, and both facts survive.
      const after = await legal.statusFor(customer.userId);
      expect(after[0]).toMatchObject({
        version: 2,
        acceptedVersion: 1,
        needsAcceptance: true,
      });
    });

    it('accepting twice is accepting once', async () => {
      const v1 = await publish(LegalDocumentKind.TERMS_OF_USE, 'Be good.');

      await legal.accept(customer.userId, v1.id);
      await legal.accept(customer.userId, v1.id);

      expect(await prisma.legalAcceptance.count({ where: { userId: customer.userId } })).toBe(1);
    });

    it('refuses agreement to a draft', async () => {
      const draft = await legal.startDraft(LegalDocumentKind.TERMS_OF_USE);

      // Recording consent to words still being written, which is also why the
      // draft is editable at all.
      await expect(legal.accept(customer.userId, draft.id)).rejects.toThrow(
        /not been published/,
      );
    });

    it('keeps the OLDEST reading honest: the highest version wins, not the latest tap', async () => {
      const v1 = await publish(LegalDocumentKind.TERMS_OF_USE, 'One.');
      const v2 = await publish(LegalDocumentKind.TERMS_OF_USE, 'Two.');

      await legal.accept(customer.userId, v2.id);
      // Reading and agreeing to an old version afterwards must not demote them.
      await legal.accept(customer.userId, v1.id);

      const status = await legal.statusFor(customer.userId);
      expect(status[0]).toMatchObject({ acceptedVersion: 2, needsAcceptance: false });
    });

    it('blocks an action until the document is accepted (§126)', async () => {
      const v1 = await publish(LegalDocumentKind.SELLER_AGREEMENT, 'Trade fairly.');

      // A gate that lives only in a screen is a suggestion: the API is reachable
      // with curl, and the record of who agreed is the point of all of this.
      await expect(
        legal.requireAccepted(customer.userId, LegalDocumentKind.SELLER_AGREEMENT),
      ).rejects.toThrow(/read and accept/i);

      await legal.accept(customer.userId, v1.id);
      await expect(
        legal.requireAccepted(customer.userId, LegalDocumentKind.SELLER_AGREEMENT),
      ).resolves.toBeUndefined();
    });

    it('blocks again once a NEWER version is published', async () => {
      const v1 = await publish(LegalDocumentKind.SELLER_AGREEMENT, 'One.');
      await legal.accept(customer.userId, v1.id);
      await publish(LegalDocumentKind.SELLER_AGREEMENT, 'Two.');

      await expect(
        legal.requireAccepted(customer.userId, LegalDocumentKind.SELLER_AGREEMENT),
      ).rejects.toThrow(/version 2/);
    });

    it('says so with a code a screen can answer — by showing the document (§280)', async () => {
      await publish(LegalDocumentKind.SELLER_AGREEMENT, 'Trade fairly.');

      const refusal = await legal
        .requireAccepted(customer.userId, LegalDocumentKind.SELLER_AGREEMENT)
        .catch((error: { getStatus(): number; getResponse(): unknown }) => error);

      expect((refusal as { getStatus(): number }).getStatus()).toBe(403);
      expect((refusal as { getResponse(): unknown }).getResponse()).toMatchObject({ code: 'AGREEMENT_REQUIRED' });
    });

    it('blocks NOTHING while no version is published', async () => {
      // Refusing here would lock a business out of its own catalogue over a
      // document that does not exist.
      await expect(
        legal.requireAccepted(customer.userId, LegalDocumentKind.SELLER_AGREEMENT),
      ).resolves.toBeUndefined();
    });

    it('a new account accepts everything published at that moment', async () => {
      await publish(LegalDocumentKind.TERMS_OF_USE, 'Be good.');
      await publish(LegalDocumentKind.PRIVACY_POLICY, 'We keep little.');
      const newcomer = await createCustomer(prisma);

      await legal.acceptCurrentAtRegistration(newcomer.userId);

      const status = await legal.statusFor(newcomer.userId);
      expect(status).toHaveLength(2);
      expect(status.every((d) => !d.needsAcceptance)).toBe(true);
    });

    it('registering twice does not fail on a row already there', async () => {
      await publish(LegalDocumentKind.TERMS_OF_USE, 'Be good.');
      const newcomer = await createCustomer(prisma);

      await legal.acceptCurrentAtRegistration(newcomer.userId);
      // A retried verify must not blow up on the duplicate.
      await expect(
        legal.acceptCurrentAtRegistration(newcomer.userId),
      ).resolves.toBeUndefined();
    });

    it('a published document cannot be deleted once somebody agreed', async () => {
      const v1 = await publish(LegalDocumentKind.TERMS_OF_USE, 'Be good.');
      await legal.accept(customer.userId, v1.id);

      // onDelete: Restrict. The record of what they agreed to must not vanish
      // with the thing they agreed to.
      await expect(
        prisma.legalDocument.delete({ where: { id: v1.id } }),
      ).rejects.toThrow();
    });
  });
});
