import { NotificationType } from '@prisma/client';
import { CATALOGS } from '../src/i18n/catalogs';
import { say, sayError } from '../src/i18n/say';
import { renderEmail } from '../src/mail/email-kit';
import { noticeEmail, readBody } from '../src/notifications/notification-email';
import { renderNotification } from '../src/notifications/notification-templates';
import { NotificationsService } from '../src/notifications/notifications.service';
import { TaxonomyNamesService } from '../src/categories/taxonomy-names.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { E2eContext, createE2eApp, request } from './setup/e2e-app';
import { resetDatabase } from './setup/test-module';
import { createAdmin, createCustomer } from './setup/factories';

/**
 * What the server says, in the reader's language (§308): its notices and
 * emails in each person's chosen language, its refusals in the language the
 * app asks in, and English wherever a sentence is not translated yet. The
 * translations here are stand-ins put in for the test — the real ones come
 * from translators, through src/i18n/locales/*.po.
 */
describe('The server, in the reader’s language (§308)', () => {
  let ctx: E2eContext;
  let prisma: PrismaService;
  const before = CATALOGS.fr;

  const FRENCH: Record<string, string> = {
    'Cancelled: {serviceName}, {short}': 'Annulé : {serviceName}, {short}',
    'This booking has been cancelled.': 'Cette réservation a été annulée.',
    'Service: {serviceName}': 'Service : {serviceName}',
    'Where: {locationName}': 'Lieu : {locationName}',
    'When: {when}': 'Quand : {when}',
    '{day} at {time}': '{day} à {time}',
    'Booking cancelled': 'Réservation annulée',
    'Bookings and payments': 'Réservations et paiements',
    'Always emailed — it is the record of your booking.': 'Toujours par e-mail — c’est la trace de votre réservation.',
    'Please wait {value0}s before requesting another code.': 'Veuillez patienter {value0} s avant de demander un autre code.',
    '{count, plural, one {Photos on # service} other {Photos on # services}}':
      '{count, plural, one {Des photos sur # service} other {Des photos sur # services}}',
    // A seeded type's name, as translators give it (§308.3).
    'Test Barbershop': 'Salon de barbier (test)',
  };

  beforeAll(async () => {
    CATALOGS.fr = FRENCH;
    ctx = await createE2eApp();
    prisma = ctx.prisma;
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    CATALOGS.fr = before;
    await resetDatabase(prisma);
    await ctx.close();
  });

  // Tuesday 20 October 2026, 11:15 in Kigali.
  const startTime = new Date('2026-10-20T09:15:00Z');
  const cancelled = (locale?: 'en' | 'fr' | 'rw') =>
    renderNotification(NotificationType.APPOINTMENT_CANCELLED, {
      serviceName: 'Coupe',
      locationName: 'Kimironko',
      businessName: 'Salon A',
      startTime,
      timeZone: 'Africa/Kigali',
      audience: 'BUSINESS',
      locale,
    });

  it('says a translated sentence in the language asked, and English where there is none yet', () => {
    expect(say('fr', 'Bookings and payments')).toBe('Réservations et paiements');
    expect(say('rw', 'Bookings and payments')).toBe('Bookings and payments');
    expect(say('fr', 'Not translated yet.')).toBe('Not translated yet.');
    expect(say(undefined, 'Bookings and payments')).toBe('Bookings and payments');
    // Each language's own plurals, from one message.
    const photos = '{count, plural, one {Photos on # service} other {Photos on # services}}';
    expect(say('fr', photos, { count: 1 })).toBe('Des photos sur 1 service');
    expect(say('en', photos, { count: 3 })).toBe('Photos on 3 services');
  });

  it('says a refusal written whole, and one with values in it, in the language asked', () => {
    expect(sayError('fr', 'Always emailed — it is the record of your booking.')).toBe(
      'Toujours par e-mail — c’est la trace de votre réservation.',
    );
    expect(sayError('fr', 'Please wait 42s before requesting another code.')).toBe(
      'Veuillez patienter 42 s avant de demander un autre code.',
    );
    expect(sayError('en', 'Please wait 42s before requesting another code.')).toBe(
      'Please wait 42s before requesting another code.',
    );
    expect(sayError('fr', 'Something nobody translated.')).toBe('Something nobody translated.');
  });

  it('writes a notice in the reader’s language, dates included — and as before in English', () => {
    const french = cancelled('fr');
    expect(french.subject.startsWith('Annulé : Coupe, ')).toBe(true);
    expect(french.body).toContain('Cette réservation a été annulée.');
    expect(french.body).toContain('Quand : mardi 20 octobre à 11:15');
    // What is not translated yet stays English, never blank.
    expect(french.body).toContain('The time is free for someone else.');

    const english = cancelled();
    expect(english.subject).toBe('Cancelled: Coupe, Tue 20 Oct, 11:15');
    expect(english.body).toContain('When: Tuesday 20 October at 11:15');
  });

  it('reads the notice’s details back in any language, and draws its email in it', () => {
    const french = cancelled('fr');
    expect(readBody('Service : Coupe\nLieu : Kimironko').facts).toEqual([
      { label: 'Service', value: 'Coupe' },
      { label: 'Lieu', value: 'Kimironko' },
    ]);
    const { email } = noticeEmail({
      type: NotificationType.APPOINTMENT_CANCELLED,
      audience: 'BUSINESS',
      subject: french.subject,
      body: french.body,
      button: null,
      footer: { reason: 'x' },
      booking: null,
      arrivalCode: null,
      author: null,
      timeZone: 'Africa/Kigali',
      locale: 'fr',
    });
    expect(email.hero.eyebrow).toBe('Réservation annulée');
    const { html, text } = renderEmail(email, { assetBase: 'http://localhost:4100', subject: french.subject });
    expect(html).toContain('<html lang="fr"');
    // The details as a card, not as sentences.
    expect(text).toContain('Kimironko');
    expect(email.hero.lead).toBe('Cette réservation a été annulée. The time is free for someone else.');
  });

  it('writes each person’s notice in their own language', async () => {
    const french = await createCustomer(prisma);
    const english = await createCustomer(prisma);
    await prisma.user.update({ where: { id: french.userId }, data: { locale: 'fr' } });
    const notifications = ctx.app.get(NotificationsService);
    const context = { serviceName: 'Coupe', locationName: 'Kimironko', businessName: 'Salon A', startTime };
    for (const person of [french, english]) {
      await notifications.notify({ recipientId: person.userId, type: NotificationType.APPOINTMENT_CANCELLED, context });
    }
    const subjectOf = async (userId: string) =>
      (await prisma.notification.findFirstOrThrow({ where: { recipientId: userId } })).subject;
    expect(await subjectOf(french.userId)).toMatch(/^Annulé : Coupe, /);
    expect(await subjectOf(english.userId)).toBe('Cancelled: Coupe, Tue 20 Oct, 11:15');
  });

  it('says category and type names in the language asked: the console’s words first, then the translators’, then English', async () => {
    const category = await prisma.category.create({
      data: {
        name: 'Test Beauty',
        description: 'Hair, nails and spa days.',
        translations: { fr: { name: 'Beauté (test)', description: 'Cheveux, ongles et spa.' } },
        subcategories: { create: [{ name: 'Test Barbershop' }, { name: 'Test Nails' }] },
      },
    });
    ctx.app.get(TaxonomyNamesService).forget();
    const fr = { 'Accept-Language': 'fr' };

    const list = (await request(ctx.url, '/categories', { headers: fr })).body as unknown as Array<{
      id: string;
      name: string;
      description: string;
      subcategories: Array<{ name: string }>;
    }>;
    const mine = list.find((c) => c.id === category.id)!;
    expect(mine.name).toBe('Beauté (test)');
    expect(mine.description).toBe('Cheveux, ongles et spa.');
    expect(mine.subcategories.map((s) => s.name).sort()).toEqual(['Salon de barbier (test)', 'Test Nails']);

    // In English, and in a language with nothing typed, the names are as they are.
    const english = (await request(ctx.url, '/categories')).body as unknown as Array<{ id: string; name: string }>;
    expect(english.find((c) => c.id === category.id)!.name).toBe('Test Beauty');
    const rw = (await request(ctx.url, '/categories', { headers: { 'Accept-Language': 'rw' } })).body as unknown as Array<{
      id: string;
      name: string;
    }>;
    expect(rw.find((c) => c.id === category.id)!.name).toBe('Test Beauty');

    // Sent without an id, under "subcategory": found by its name.
    const names = ctx.app.get(TaxonomyNamesService);
    const nested = await names.localise({ business: { subcategory: { name: 'Test Barbershop' } } }, 'fr');
    expect(nested.business.subcategory.name).toBe('Salon de barbier (test)');
    // A shop called like a type is a shop, not a type.
    const shop = await names.localise({ business: { name: 'Test Barbershop' } }, 'fr');
    expect(shop.business.name).toBe('Test Barbershop');
  });

  it('sends an announcement typed in two languages to each person in theirs, and shows its banner in the app’s', async () => {
    const admin = await createAdmin(prisma);
    const adminToken = ctx.token(admin.userId, admin.email, 'ADMIN');
    const french = await createCustomer(prisma);
    await prisma.user.update({ where: { id: french.userId }, data: { locale: 'fr' } });
    const english = await createCustomer(prisma);
    const draft = {
      kind: 'SERVICE',
      audience: 'ONE_PERSON',
      title: 'MTN MoMo is slow this morning',
      body: 'Payments may take a few minutes to confirm.',
      translations: { fr: { title: 'MTN MoMo est lent ce matin', body: 'Les paiements peuvent prendre quelques minutes.' } },
      sendPush: false,
      sendEmail: false,
      banner: false,
    };
    for (const person of [french, english]) {
      const created = await request(ctx.url, '/admin/announcements', {
        method: 'POST',
        token: adminToken,
        body: { ...draft, userId: person.userId },
      });
      expect(created.status).toBe(201);
      expect(created.body.translations).toEqual(draft.translations);
      const sent = await request(ctx.url, `/admin/announcements/${created.body.id as string}/send`, {
        method: 'POST',
        token: adminToken,
        body: {},
      });
      expect(sent.status).toBe(200);
    }
    const said = async (userId: string) => {
      for (let i = 0; i < 50; i++) {
        const n = await prisma.notification.findFirst({ where: { recipientId: userId, type: NotificationType.ANNOUNCEMENT } });
        if (n) return n;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('not sent');
    };
    expect((await said(french.userId)).subject).toBe('MTN MoMo est lent ce matin');
    expect((await said(french.userId)).body).toBe('Les paiements peuvent prendre quelques minutes.');
    expect((await said(english.userId)).subject).toBe('MTN MoMo is slow this morning');
  });

  it('answers the settings and their refusals in the language the app asks in', async () => {
    const customer = await createCustomer(prisma);
    const token = ctx.token(customer.userId, customer.email, 'CUSTOMER');
    const fr = { 'Accept-Language': 'fr-RW,fr;q=0.9' };

    const settings = await request(ctx.url, '/notifications/settings', { token, headers: fr });
    const bookings = (settings.body.categories as Array<{ category: string; title: string; email: { locked: string } }>)
      .find((c) => c.category === 'BOOKINGS')!;
    expect(bookings.title).toBe('Réservations et paiements');
    expect(bookings.email.locked).toBe('Toujours par e-mail — c’est la trace de votre réservation.');

    const off = { choices: [{ category: 'BOOKINGS', channel: 'EMAIL', on: false }] };
    const refused = await request(ctx.url, '/notifications/settings', { method: 'PATCH', token, body: off, headers: fr });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe('Toujours par e-mail — c’est la trace de votre réservation.');

    // Without asking, everything is as it was.
    const plain = await request(ctx.url, '/notifications/settings', { method: 'PATCH', token, body: off });
    expect(plain.status).toBe(400);
    expect(plain.body.message).toBe('Always emailed — it is the record of your booking.');
  });
});
