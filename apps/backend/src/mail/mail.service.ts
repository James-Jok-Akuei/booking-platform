import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppointmentStatus } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales';
import { say } from '../i18n/say';
import { BookingFacts, bookingTicket, icsFile } from './booking-email';
import { Email, codeBoxes, notice, prose, renderEmail, serviceCards } from './email-kit';

/** "45 min", "1 h 30 min" — as a person says it, the same as the app (§163). */
const lengthOf = (minutes: number, l: Locale) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return say(l, '{m} min', { m });
  return m === 0 ? say(l, '{h} h', { h }) : say(l, '{h} h {m} min', { h, m });
};

/**
 * Sends the platform's email, every one in the same design (§292).
 *
 * The design lives in `email-kit.ts` and a booking's look in
 * `booking-email.ts`; this owns the transport, what each email says, and what
 * happens when a send fails — a sign-in code in development is logged rather
 * than lost, while a notice or the weekly email learns that it failed so it
 * can be tried again. Each is written in its reader's language (§308).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;
  /** Where the email's own pictures — the mark — are loaded from. */
  private readonly assetBase: string;

  constructor(private readonly config: ConfigService) {
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');

    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: Number(this.config.get<string>('SMTP_PORT')),
      secure: false,
      // Local dev uses Mailhog, which accepts unauthenticated SMTP and never
      // advertises AUTH. Passing empty credentials makes nodemailer attempt an
      // AUTH handshake anyway and fail, so only send auth when it's configured.
      ...(user ? { auth: { user, pass } } : {}),
    });
    this.assetBase = (this.config.get<string>('APP_BASE_URL') ?? 'http://localhost:4100').replace(/\/$/, '');
  }

  /** Whether an SMTP host is configured at all. */
  isConfigured(): boolean {
    const host = this.config.get<string>('SMTP_HOST');
    return Boolean(host && host.trim().length > 0);
  }


  /**
   * Any email, drawn in the platform's design and sent. Throws when the send
   * fails; the callers that must not fail catch it themselves.
   */
  async send(
    to: string,
    subject: string,
    email: Email,
    extras: { unsubscribeUrl?: string | null; calendar?: string | null } = {},
  ): Promise<void> {
    const { html, text } = renderEmail(email, { assetBase: this.assetBase, subject });
    if (this.config.get<string>('NODE_ENV') !== 'production') {
      this.logger.log(`[DEV] Email to ${to}: ${subject}`);
    }
    await this.transporter.sendMail({
      from: this.config.get<string>('SMTP_FROM'),
      to,
      subject,
      text,
      html,
      // A booking as an event the mail app offers to add (§292).
      ...(extras.calendar ? { icalEvent: { filename: 'booking.ics', method: 'PUBLISH', content: extras.calendar } } : {}),
      // nodemailer writes the List-* headers itself from `list` and drops a
      // hand-written one, so the address goes here and only the one-click
      // marker is a plain header — together they put a mail app's own
      // "unsubscribe" button on the email.
      ...(extras.unsubscribeUrl
        ? {
            list: {
              unsubscribe: { url: extras.unsubscribeUrl, comment: say(email.locale, 'Stop emails like this') },
            },
            headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
          }
        : {}),
    });
  }

  /**
   * A subject and some words, with nothing else known about them — still in
   * the platform's design. Throws on failure, like a notice: a caller that
   * records deliveries has to learn that it did not go.
   */
  async sendGenericEmail(email: string, subject: string, body: string, locale: Locale = DEFAULT_LOCALE): Promise<void> {
    await this.send(email, subject, {
      preheader: body.split('\n')[0] ?? subject,
      hero: { tone: 'info', badge: { kind: 'glyph', glyph: 'i' }, eyebrow: say(locale, 'A notice'), title: subject },
      blocks: [prose(body)],
      footer: { reason: say(locale, 'You get this because this address has an account with us.') },
      locale,
    });
  }

  /**
   * A notice that has been composed already (§287, §292): its words, its
   * look, why it came and how to stop it. Throws on failure — a delivery is
   * recorded and tried again.
   */
  async sendNotificationEmail(
    to: string,
    message: { subject: string; email: Email; unsubscribeUrl?: string | null; calendar?: string | null },
  ): Promise<void> {
    await this.send(to, message.subject, message.email, {
      unsubscribeUrl: message.unsubscribeUrl,
      calendar: message.calendar,
    });
  }

  /**
   * A six-digit code. `sign-in` to sign in or register; `confirm` to confirm
   * it is you before a risky change while signed in (§279) — said differently,
   * because a code arriving out of the blue for "a change" is exactly what
   * someone should notice.
   *
   * Six boxes on a dark top, the way the apps ask for it (§183, §292). The
   * code is in the subject and the inbox preview too: on most phones the
   * notification alone is then enough. In the language of the app it was
   * asked for from (§308).
   */
  async sendOtpEmail(
    email: string,
    code: string,
    kind: 'sign-in' | 'confirm' = 'sign-in',
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<void> {
    const l = locale;
    const minutes = Number(this.config.get<string>('OTP_EXPIRES_IN_MINUTES') ?? '10');
    const confirm = kind === 'confirm';
    const subject = confirm ? say(l, 'Confirm it is you: {code}', { code }) : say(l, 'Your sign-in code: {code}', { code });
    const works = say(l, '{minutes, plural, one {It works for # minute, and only once.} other {It works for # minutes, and only once.}}', {
      minutes,
    });

    // In development, don't hard-fail the signup/login flow if SMTP isn't
    // configured yet — log the code so you can keep testing the flow locally.
    if (this.config.get<string>('NODE_ENV') !== 'production') {
      this.logger.warn(`[DEV ONLY] OTP for ${email}: ${code}`);
    }

    try {
      await this.send(email, subject, {
        preheader: `${code} — ${works}`,
        hero: {
          tone: 'night',
          eyebrow: confirm ? say(l, 'Confirm it is you') : say(l, 'Sign-in code'),
          title: confirm ? say(l, 'Your code to confirm') : say(l, 'Here is your code'),
          lead: confirm
            ? say(
                l,
                'You are making an important change — your payment number, who works at the shop, or something that cannot be undone. Enter this code to confirm it is you.',
              )
            : say(l, 'Enter it in the app to sign in. If you are new here, the same code creates your account.'),
          inside: codeBoxes(code, { onDark: true, note: works }),
        },
        blocks: [
          confirm
            ? notice(
                'danger',
                say(
                  l,
                  'Someone may be using your account. Do not share this code with anyone: sign out on every device and write to us from Help.',
                ),
                say(l, 'Did not ask for this?'),
              )
            : notice(
                'info',
                say(l, 'You can ignore this email. Nobody can sign in without the code, and we will never ask you for it.'),
                say(l, 'Did not ask for this?'),
              ),
        ],
        footer: {
          reason: confirm
            ? say(l, 'You get this because a change was made while signed in to this account.')
            : say(l, 'You get this because someone asked to sign in with this email address.'),
        },
        locale: l,
      });
    } catch (err) {
      this.logger.error(`Failed to send OTP email to ${email}`, err as Error);
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw err;
      }
      // In dev, swallow the error since the code is already logged above.
    }
  }

  /**
   * The weekly "near you" email (§140). Sent only to people who asked for it.
   *
   * Unlike the OTP email this does NOT swallow a failure: the caller marks a
   * customer as written-to only when this returns, so a send that failed is
   * tried again next run instead of counting as this week's email.
   */
  async sendOffersDigest(
    email: string,
    digest: {
      place: string;
      /** Measured from the customer's exact spot rather than a district (§169). */
      nearSpot?: boolean;
      unsubscribeUrl: string;
      services: Array<{
        name: string;
        shop: string;
        where: string | null;
        price: string;
        minutes: number;
        imageUrl: string | null;
        rating: number | null;
        /** "3.4 km by road" from the customer's own spot, when they gave one (§169). */
        away: string | null;
        /** On sale (§186): the price before, crossed out, and how much off. */
        sale?: { was: string; percent: number } | null;
      }>;
      /** The customer's language (§308). */
      locale?: Locale;
    },
  ): Promise<void> {
    const l = digest.locale ?? DEFAULT_LOCALE;
    const place = digest.place;
    // From a district: "in Gasabo". From an exact spot: "near KG 11 Ave", or
    // just "around you" when the phone gave the place no name (§169). Whole
    // sentences, so each language puts the place where it belongs (§308).
    const anywhere = digest.nearSpot && place === 'you';
    const onSale = digest.services.filter((s) => s.sale).length;
    const lead = digest.nearSpot
      ? anywhere
        ? say(
            l,
            '{onSale, plural, =0 {What people around you are booking this week.} one {What people around you are booking this week — one of them is on sale.} other {What people around you are booking this week — # of them are on sale.}}',
            { onSale },
          )
        : say(
            l,
            '{onSale, plural, =0 {What people near {place} are booking this week.} one {What people near {place} are booking this week — one of them is on sale.} other {What people near {place} are booking this week — # of them are on sale.}}',
            { onSale, place },
          )
      : say(
          l,
          '{onSale, plural, =0 {What people in {place} are booking this week.} one {What people in {place} are booking this week — one of them is on sale.} other {What people in {place} are booking this week — # of them are on sale.}}',
          { onSale, place },
        );
    const subject = digest.nearSpot ? say(l, 'Popular near you') : say(l, 'Popular near you in {place}', { place });
    // The footer says which address this is for (§172), so a wrong one is
    // noticed — and says where to change it.
    const sentFor = anywhere ? say(l, 'your saved address') : place;

    await this.send(
      email,
      subject,
      {
        preheader: digest.services
          .slice(0, 3)
          .map((s) => s.name)
          .join(', ') + (digest.services.length > 3 ? ` ${say(l, 'and more')}` : ''),
        hero: {
          tone: 'accent',
          badge: { kind: 'glyph', glyph: '&#9733;' },
          eyebrow: say(l, 'This week'),
          title: digest.nearSpot ? say(l, 'Popular near you') : say(l, 'Popular in {place}', { place }),
          lead,
        },
        blocks: [
          serviceCards(
            digest.services.map((s) => ({
              photoUrl: s.imageUrl,
              name: s.name,
              shop: s.shop,
              facts: [s.away ?? s.where, lengthOf(s.minutes, l), s.rating !== null ? `★ ${s.rating.toFixed(1)}` : null]
                .filter(Boolean)
                .join(' · '),
              price: s.price,
              was: s.sale?.was ?? null,
              off: s.sale?.percent ?? null,
            })),
            l,
          ),
          prose(say(l, 'Open the app to book any of these — a deposit holds your time, and the rest is paid at the shop.')),
        ],
        footer: {
          reason: say(l, 'You get this because you turned on "Weekly offers by email" in the app, for {place}.', {
            place: sentFor,
          }),
          manage: { label: say(l, 'Change the address in the app, under Account.') },
          unsubscribeUrl: digest.unsubscribeUrl,
        },
        locale: l,
      },
      { unsubscribeUrl: digest.unsubscribeUrl },
    );
  }

  /**
   * A customer's arrival code, with the booking it is for (§53, §54, §292).
   *
   * Sent when the booking is made — while the deposit is still being paid —
   * and again whenever the customer asks for a new code. It says which: a
   * booking still waiting for its deposit is "held", and says so, rather
   * than "confirmed". Deliberately not a branch of the sign-in email: this
   * code lives until the appointment, not ten minutes, and says different
   * things.
   */
  async sendAppointmentVerificationEmail(
    email: string,
    code: string,
    booking: BookingFacts,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<void> {
    if (this.config.get<string>('NODE_ENV') !== 'production') {
      this.logger.warn(`[DEV ONLY] Appointment code for ${email}: ${code}`);
    }
    const l = locale;
    const held = booking.status === AppointmentStatus.PENDING_PAYMENT;
    const { shopName, serviceName } = booking;
    const subject = held
      ? say(l, 'Your booking at {shopName} — arrival code {code}', { shopName, code })
      : say(l, 'Your new arrival code for {serviceName}: {code}', { serviceName, code });

    try {
      await this.send(
        email,
        subject,
        {
          preheader: held
            ? say(l, 'Pay the deposit in the app to confirm it. Your arrival code is {code}.', { code })
            : say(l, 'Any earlier code no longer works. Your arrival code is {code}.', { code }),
          audience: 'CUSTOMER',
          hero: {
            tone: held ? 'accent' : 'ok',
            badge: held ? null : { kind: 'glyph', glyph: '&#10003;' },
            eyebrow: held ? say(l, 'Your booking') : say(l, 'A new arrival code'),
            title: held ? say(l, 'Your time is held') : say(l, 'Here is your new code'),
            lead: held
              ? say(l, 'Pay the deposit in the app to confirm your booking at {shopName}. The time is held for you for 5 minutes.', {
                  shopName,
                })
              : say(l, 'You asked for a new arrival code, so any earlier one no longer works.'),
          },
          blocks: [
            bookingTicket(booking, { timeZone: booking.timeZone, audience: 'CUSTOMER', locale: l }),
            codeBoxes(code, {
              label: say(l, 'Your arrival code'),
              note: say(
                l,
                'Give it to the shop when you arrive — they need it to start your appointment. Do not share it before.',
              ),
            }),
          ],
          footer: {
            reason: say(l, 'You get this because you booked with this email address.'),
            manage: { label: say(l, 'Your bookings are in the app, under Bookings.') },
          },
          locale: l,
        },
        { calendar: held ? null : icsFile(booking, l) },
      );
    } catch (err) {
      this.logger.error(`Failed to send appointment verification email to ${email}`, err as Error);
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw err;
      }
    }
  }
}
