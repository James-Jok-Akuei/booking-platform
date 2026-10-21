import { jest } from '@jest/globals';
import { AppointmentStatus, NotificationType } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../src/mail/mail.service';
import { BookingFacts } from '../src/mail/booking-email';
import { esc, renderEmail } from '../src/mail/email-kit';
import { noticeEmail, readBody, summaryEmail } from '../src/notifications/notification-email';
import { renderNotification } from '../src/notifications/notification-templates';
import { Audience } from '../src/notifications/notification-catalog';

/**
 * Every email in the platform's design (§292), drawn with sample data: none
 * leaves a gap ("undefined", "null", "NaN"), every person's words are escaped,
 * the plain-text part says what the picture says, and each has the line
 * inboxes show. With EMAIL_PREVIEW_DIR set, each is also written out as a
 * file to look at — `EMAIL_PREVIEW_DIR=/some/dir npx jest test/email-design`.
 */
const OUT = process.env.EMAIL_PREVIEW_DIR;
const BASE = process.env.EMAIL_PREVIEW_BASE ?? 'http://localhost:4100';
const PHOTO = process.env.EMAIL_PREVIEW_PHOTO ?? `${BASE}/uploads/sample.jpg`;
const LOGO = process.env.EMAIL_PREVIEW_LOGO ?? `${BASE}/uploads/logo.jpg`;
const TZ = 'Africa/Kigali';

const save = (name: string, html: string, text: string) => {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}.html`), html);
  fs.writeFileSync(path.join(OUT, `${name}.txt`), text);
};

const sound = (name: string, html: string, text: string) => {
  for (const gap of ['undefined', '>null<', 'NaN', '[object Object]']) {
    expect({ name, has: html.includes(gap) }).toEqual({ name, has: false });
    expect({ name, has: text.includes(gap.replace(/[<>]/g, '')) }).toEqual({ name, has: false });
  }
  expect(html).toContain('<!doctype html>');
  expect(html).toContain('BwanguReservations'.slice(0, 6));
};

const tomorrowAt = (h: number, m: number) => {
  const d = new Date(Date.now() + 86_400_000);
  // 11:15 in Kigali (UTC+2) is 09:15 UTC.
  d.setUTCHours(h - 2, m, 0, 0);
  return d;
};

const booking = (over: Partial<BookingFacts> = {}): BookingFacts => ({
  id: '3f2a1c9b-0000-4000-8000-000000000001',
  serviceName: 'Cut and beard',
  photoUrl: PHOTO,
  quantity: 1,
  shopName: 'Kigali Barbers',
  shopLogoUrl: LOGO,
  branchName: 'Nyarugenge Branch',
  address: 'KN 4 Ave, Nyarugenge',
  latitude: -1.9469,
  longitude: 30.0588,
  startTime: tomorrowAt(11, 15),
  endTime: tomorrowAt(12, 15),
  depositMinor: 4000,
  priceMinor: 20000,
  currency: 'RWF',
  status: AppointmentStatus.BOOKED,
  depositPaid: true,
  choices: [],
  hasPrivateAnswers: false,
  note: null,
  ...over,
});

describe('The emails, in the platform design (§292)', () => {
  let mail: MailService;
  const sent: Array<{ subject: string; html: string; text: string; icalEvent?: unknown; list?: unknown }> = [];

  beforeAll(() => {
    const config = new ConfigService({
      SMTP_FROM: 'BwanguReservations <no-reply@example.com>',
      APP_BASE_URL: BASE,
      PLATFORM_TIMEZONE: TZ,
      OTP_EXPIRES_IN_MINUTES: '10',
      NODE_ENV: 'test',
    });
    mail = new MailService(config);
    // The transport is replaced: what would have been sent is kept to look at.
    (mail as unknown as { transporter: { sendMail: (m: never) => Promise<void> } }).transporter = {
      sendMail: jest.fn(async (message: (typeof sent)[number]) => {
        sent.push(message);
      }) as never,
    };
  });

  const last = () => sent[sent.length - 1];

  it('draws the sign-in and confirm codes as six boxes, with the code in the subject and the preview', async () => {
    await mail.sendOtpEmail('ama@example.com', '553931');
    expect(last().subject).toBe('Your sign-in code: 553931');
    expect(last().html).toContain('>5<');
    expect(last().text).toContain('553931');
    sound('otp', last().html, last().text);
    save('01-sign-in-code', last().html, last().text);

    await mail.sendOtpEmail('ama@example.com', '300793', 'confirm');
    expect(last().subject).toBe('Confirm it is you: 300793');
    sound('confirm', last().html, last().text);
    save('02-confirm-code', last().html, last().text);
  });

  it('sends the arrival code with the booking as a ticket — held until paid, and a calendar event once it is', async () => {
    await mail.sendAppointmentVerificationEmail(
      'ama@example.com',
      '958116',
      booking({ status: AppointmentStatus.PENDING_PAYMENT, depositPaid: false }),
    );
    expect(last().subject).toContain('arrival code 958116');
    expect(last().html).toContain('Waiting for your deposit');
    expect(last().html).toContain('3F2A-1C9B');
    expect(last().html).toContain('RWF 16,000');
    expect(last().icalEvent).toBeUndefined();
    sound('arrival', last().html, last().text);
    save('03-arrival-code-held', last().html, last().text);

    await mail.sendAppointmentVerificationEmail('ama@example.com', '204117', booking());
    expect(last().html).toContain('Confirmed');
    expect(last().icalEvent).toBeDefined();
    expect(last().html).toContain('google.com/maps/dir');
    save('04-arrival-code-new', last().html, last().text);
  });

  it('puts what was chosen on the ticket — a private answer only as "in the app" (§300)', async () => {
    await mail.sendAppointmentVerificationEmail(
      'ama@example.com',
      '204117',
      booking({
        choices: ['Cut: Fade', 'Extras: Beard trim and line-up'],
        hasPrivateAnswers: true,
        note: 'Please keep the top a little longer.',
      }),
    );
    expect(last().html).toContain('Your choices');
    expect(last().html).toContain('Extras: Beard trim and line-up');
    expect(last().html).toContain('see them in the app');
    expect(last().html).toContain('Please keep the top a little longer.');
    expect(last().text).toContain('  Cut: Fade');
    // Never into the calendar invite, where anyone the event is shared with reads it.
    expect(JSON.stringify(last().icalEvent)).not.toContain('Fade');
    sound('choices', last().html, last().text);
    save('04b-arrival-code-choices', last().html, last().text);
  });

  it('draws the weekly picks as picture cards, with a working unsubscribe', async () => {
    await mail.sendOffersDigest('ama@example.com', {
      place: 'Gasabo',
      unsubscribeUrl: `${BASE}/offers/unsubscribe?t=abc`,
      services: [
        {
          name: 'Cut and beard',
          shop: 'Kigali Barbers',
          where: 'Nyarugenge',
          price: 'RWF 20,000',
          minutes: 60,
          imageUrl: PHOTO,
          rating: 4.8,
          away: null,
        },
        {
          name: 'Gel manicure',
          shop: 'Remera Nails',
          where: 'Gasabo',
          price: 'RWF 6,800',
          minutes: 45,
          imageUrl: LOGO,
          rating: 4.6,
          away: null,
          sale: { was: 'RWF 8,000', percent: 15 },
        },
        {
          name: 'Full-body massage',
          shop: 'Kimironko Spa',
          where: 'Gasabo',
          price: 'RWF 30,000',
          minutes: 90,
          imageUrl: null,
          rating: null,
          away: null,
        },
      ],
    });
    expect(last().html).toContain('Stop emails like this');
    expect(last().list).toBeDefined();
    sound('digest', last().html, last().text);
    save('05-weekly-picks', last().html, last().text);
  });

  it('lists a morning of bookings, each with its time', () => {
    const summary = summaryEmail({
      appUrl: 'http://localhost:5174',
      items: [
        { at: 'Mon 18:42', subject: 'New booking: Cut and beard, Tue 20 Oct, 11:15' },
        { at: 'Mon 18:44', subject: 'Confirmed: Cut and beard, Tue 20 Oct, 11:15' },
        { at: 'Mon 21:03', subject: 'Cancelled: Hot-towel shave, Wed 21 Oct, 09:00' },
      ],
    });
    expect(summary.subject).toBe('3 booking updates since yesterday');
    const { html, text } = renderEmail(summary.email, { assetBase: BASE, subject: summary.subject });
    sound('summary', html, text);
    expect(text).toContain('Mon 21:03');
    save('06-morning-summary', html, text);
  });

  it('takes its font from our own server, never Google’s (§299)', () => {
    const { email } = noticeEmail({
      type: NotificationType.TICKET_CREATED,
      audience: 'ADMIN',
      subject: 'A question',
      body: 'Someone asked something.',
      button: null,
      footer: { reason: 'Because.' },
      booking: null,
      arrivalCode: null,
      author: null,
      timeZone: TZ,
    });
    const { html } = renderEmail(email, { assetBase: BASE, subject: 'x' });
    expect(html).toContain(`${BASE}/email/fonts/plus-jakarta-sans-latin.woff2`);
    expect(html).not.toContain('googleapis');
    expect(html).not.toContain('gstatic');
  });

  it('escapes every word a person wrote', () => {
    const { email } = noticeEmail({
      type: NotificationType.NEW_MESSAGE,
      audience: 'CUSTOMER',
      subject: 'New message from <b>Shop</b>',
      body: 'Kigali Barbers sent you a message.\n\n"<script>alert(1)</script>"',
      button: null,
      footer: { reason: 'Because.' },
      booking: null,
      arrivalCode: null,
      author: null,
      timeZone: TZ,
    });
    const { html } = renderEmail(email, { assetBase: BASE, subject: 'x' });
    expect(html).not.toContain('<script>');
    expect(html).toContain(esc('<script>'));
    expect(html).not.toContain('<b>Shop</b>');
  });

  it('reads a notice into its parts: the lead, the details, the words in quotes, the rest', () => {
    const parts = readBody('Something happened.\n\nService: Cut\nWhen: Tomorrow\n\n"Hello there"\n\nWhat next.');
    expect(parts.facts).toEqual([
      { label: 'Service', value: 'Cut' },
      { label: 'When', value: 'Tomorrow' },
    ]);
    expect(parts.quotes).toEqual(['"Hello there"']);
    expect(parts.words).toEqual(['Something happened.', 'What next.']);
  });

  // Every notice, for each side that receives it.
  const NOTICES: Array<[NotificationType, Audience, Record<string, unknown>?]> = [
    [NotificationType.APPOINTMENT_BOOKED, 'BUSINESS'],
    [NotificationType.DEPOSIT_CONFIRMED, 'CUSTOMER'],
    [NotificationType.DEPOSIT_CONFIRMED, 'BUSINESS'],
    [NotificationType.APPOINTMENT_REMINDER, 'CUSTOMER'],
    [
      NotificationType.APPOINTMENT_CANCELLED,
      'CUSTOMER',
      { reason: 'Cancelled by the business. Reason: The barber is ill today.' },
    ],
    [NotificationType.APPOINTMENT_CANCELLED, 'BUSINESS', { reason: 'Cancelled by the customer.' }],
    [NotificationType.APPOINTMENT_NO_SHOW, 'CUSTOMER'],
    [NotificationType.DEPOSIT_FAILED, 'CUSTOMER', { reason: 'The payment was declined by MTN MoMo.' }],
    [NotificationType.APPOINTMENT_COMPLETED, 'CUSTOMER'],
    [
      NotificationType.NEW_MESSAGE,
      'CUSTOMER',
      { reason: 'Hi Ama — we can fit you in 30 minutes earlier if that helps?' },
    ],
    [NotificationType.NEW_MESSAGE, 'BUSINESS', { reason: 'Is parking available near the Nyarugenge branch?' }],
    [NotificationType.REVIEW_CREATED, 'BUSINESS', { rating: 5 }],
    [NotificationType.PAYOUT_SENT, 'BUSINESS', { depositAmountMinor: 5200, currency: 'RWF', reason: '2095403027' }],
    [
      NotificationType.PAYOUT_FAILED,
      'BUSINESS',
      { depositAmountMinor: 9400, currency: 'RWF', reason: 'The number is not registered for MoMo.' },
    ],
    [NotificationType.BUSINESS_APPROVED, 'BUSINESS'],
    // With advice from the reviewer (§303): a checklist, then their note.
    [
      NotificationType.BUSINESS_APPROVED,
      'BUSINESS',
      {
        advice: {
          // No cover, a branch with no photos, three services with no words.
          shop: {
            coverImageUrl: null,
            logoUrl: 'https://x/logo.png',
            description: 'We cut, shave and style in the heart of Kimironko, six days a week.',
            phone: '0788000000',
            subcategoryId: 'barber',
            locations: [
              { name: 'Kimironko', districtId: 'd', latitude: -1.9, longitude: 30.1, hours: [{}], _count: { media: 0 } },
            ],
            services: [1, 2, 3].map(() => ({ description: null, _count: { images: 1 }, locations: [{}] })),
            payoutDestinations: [{}],
          },
          keys: ['cover', 'gallery', 'service-words'],
          note: 'Your haircuts look great. A bright photo of the shop front would help people find you on the street.',
        },
      },
    ],
    [
      NotificationType.BUSINESS_SUSPENDED,
      'BUSINESS',
      { reason: 'Several customers reported the shop closed at booked times.' },
    ],
    [NotificationType.PAYOUT_DESTINATION_VERIFIED, 'BUSINESS'],
    [
      NotificationType.TICKET_STATUS_CHANGED,
      'CUSTOMER',
      { serviceName: 'TKT-1042', locationName: 'The shop was closed', reason: 'Now RESOLVED.' },
    ],
    [NotificationType.TICKET_CREATED, 'ADMIN', { serviceName: 'TKT-1042', locationName: 'The shop was closed' }],
    [
      NotificationType.PAYMENT_PROVIDER_MISCONFIGURED,
      'ADMIN',
      { reason: 'MTN said: the target environment is wrong.' },
    ],
    [
      NotificationType.ANNOUNCEMENT,
      'CUSTOMER',
      {
        serviceName: 'New places in Musanze',
        reason: 'Twelve new shops opened this month.\n\nOpen the app to see them.',
      },
    ],
    [
      NotificationType.SHOP_MESSAGE,
      'CUSTOMER',
      {
        serviceName: '15% off every haircut this week',
        reason: 'Book any haircut before Sunday and the discount is already applied.',
      },
    ],
    [NotificationType.BUSINESS_INVITATION, 'BUSINESS', { inviterEmail: 'owner@kigalibarbers.rw', role: 'MANAGER' }],
    // Support acted for them (§297): about a booking, and about the shop.
    [
      NotificationType.SUPPORT_UPDATE,
      'BUSINESS',
      {
        serviceName: 'Our support team checked a customer in',
        reason:
          'We checked the customer in for Cut and beard on Tue 20 Oct at 11:15, because it could not be done in the app. Mark it done when the service is finished, as usual.',
      },
    ],
    [
      NotificationType.SUPPORT_UPDATE,
      'BUSINESS',
      {
        serviceName: 'Our support team paused your shop',
        reason:
          'Customers cannot make new bookings while it is paused. Bookings already made still happen. You can open it again yourself in Your shop.\n\nReason: The owner asked us by phone while travelling.',
      },
    ],
  ];

  it.each(NOTICES.map(([type, audience, extra], i) => [i, type, audience, extra ?? {}] as const))(
    'draws notice %i: %s for %s',
    (i, type, audience, extra) => {
      const b = booking();
      const { subject, body } = renderNotification(type, {
        serviceName: b.serviceName,
        locationName: b.branchName,
        businessName: b.shopName,
        startTime: b.startTime,
        depositAmountMinor: b.depositMinor,
        currency: 'RWF',
        timeZone: TZ,
        audience,
        ...(extra as object),
      });
      const aboutBooking = ![
        'PAYOUT',
        'BUSINESS_',
        'TICKET',
        'ANNOUNCEMENT',
        'SHOP_',
        'NEW_MESSAGE',
        'REVIEW',
        'PAYMENT_',
      ].some((p) => type.startsWith(p)) &&
        // A shop paused by support is about the shop, not a booking.
        !String((extra as { serviceName?: string }).serviceName ?? '').includes('paused');
      const status =
        type === NotificationType.APPOINTMENT_CANCELLED
          ? AppointmentStatus.CANCELLED
          : type === NotificationType.APPOINTMENT_NO_SHOW
            ? AppointmentStatus.NO_SHOW
            : type === NotificationType.APPOINTMENT_COMPLETED
              ? AppointmentStatus.COMPLETED
              : type === NotificationType.APPOINTMENT_BOOKED || type === NotificationType.DEPOSIT_FAILED
                ? AppointmentStatus.PENDING_PAYMENT
                : AppointmentStatus.BOOKED;
      const app =
        audience === 'ADMIN' ? 'http://localhost:5173' : audience === 'BUSINESS' ? 'http://localhost:5174' : null;
      const { email, calendar } = noticeEmail({
        type,
        audience,
        subject,
        body,
        button: app ? { label: 'Open', url: `${app}/appointments` } : null,
        footer: {
          reason: 'You get emails about bookings because they are turned on.',
          manage: app
            ? { label: 'Change what we send', url: `${app}/notifications` }
            : { label: 'Change what we send in the app.' },
          unsubscribeUrl: `${BASE}/notifications/unsubscribe?u=1&c=2&t=3`,
        },
        booking: aboutBooking ? booking({ status, depositPaid: status !== AppointmentStatus.PENDING_PAYMENT }) : null,
        arrivalCode: audience === 'CUSTOMER' ? '204117' : null,
        author: type === NotificationType.SHOP_MESSAGE ? { name: 'Kigali Barbers', logoUrl: LOGO } : null,
        timeZone: TZ,
      });
      const { html, text } = renderEmail(email, { assetBase: BASE, subject });
      sound(`${type}-${audience}`, html, text);
      expect(email.preheader.length).toBeGreaterThan(10);
      if (type === NotificationType.DEPOSIT_CONFIRMED && audience === 'CUSTOMER') {
        expect(html).toContain('>2<');
        expect(calendar).toContain('BEGIN:VEVENT');
      }
      save(`${String(10 + Number(i))}-${type.toLowerCase()}-${audience.toLowerCase()}`, html, text);
    },
  );
});
