import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppointmentStatus } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { BookingFacts, bookingTicket, icsFile } from './booking-email';
import { Email, codeBoxes, notice, prose, renderEmail, serviceCards } from './email-kit';

/** "45 min", "1 h 30 min" — as a person says it, the same as the app (§163). */
const lengthOf = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
};

/**
 * Sends the platform's email, every one in the same design (§292).
 *
 * The design lives in `email-kit.ts` and a booking's look in
 * `booking-email.ts`; this owns the transport, what each email says, and what
 * happens when a send fails — a sign-in code in development is logged rather
 * than lost, while a notice or the weekly email learns that it failed so it
 * can be tried again.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;
  /** Where the email's own pictures — the mark — are loaded from. */
  private readonly assetBase: string;
  private readonly timeZone: string;

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
    this.timeZone = this.config.get<string>('PLATFORM_TIMEZONE') ?? 'Africa/Kigali';
  }

  /** Whether an SMTP host is configured at all. */
  isConfigured(): boolean {
    const host = this.config.get<string>('SMTP_HOST');
    return Boolean(host && host.trim().length > 0);
  }

  /** The platform's time zone, for anyone composing an email about a time. */
  get zone() {
    return this.timeZone;
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
            list: { unsubscribe: { url: extras.unsubscribeUrl, comment: 'Stop emails like this' } },
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
  async sendGenericEmail(email: string, subject: string, body: string): Promise<void> {
    await this.send(email, subject, {
      preheader: body.split('\n')[0] ?? subject,
      hero: { tone: 'info', badge: { kind: 'glyph', glyph: 'i' }, eyebrow: 'A notice', title: subject },
      blocks: [prose(body)],
      footer: { reason: `You get this because this address has an account with us.` },
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
   * notification alone is then enough.
   */
  async sendOtpEmail(email: string, code: string, kind: 'sign-in' | 'confirm' = 'sign-in'): Promise<void> {
    const minutes = this.config.get<string>('OTP_EXPIRES_IN_MINUTES') ?? '10';
    const confirm = kind === 'confirm';
    const subject = confirm ? `Confirm it is you: ${code}` : `Your sign-in code: ${code}`;

    // In development, don't hard-fail the signup/login flow if SMTP isn't
    // configured yet — log the code so you can keep testing the flow locally.
    if (this.config.get<string>('NODE_ENV') !== 'production') {
      this.logger.warn(`[DEV ONLY] OTP for ${email}: ${code}`);
    }

    try {
      await this.send(email, subject, {
        preheader: `${code} — it works for ${minutes} minutes, and only once.`,
        hero: {
          tone: 'night',
          eyebrow: confirm ? 'Confirm it is you' : 'Sign-in code',
          title: confirm ? 'Your code to confirm' : 'Here is your code',
          lead: confirm
            ? 'You are making an important change — your payment number, or who works at the shop. Enter this code to confirm it is you.'
            : 'Enter it in the app to sign in. If you are new here, the same code creates your account.',
          inside: codeBoxes(code, { onDark: true, note: `It works for ${minutes} minutes, and only once.` }),
        },
        blocks: [
          confirm
            ? notice(
                'danger',
                'Someone may be using your account. Do not share this code with anyone: sign out on every device and write to us from Help.',
                'Did not ask for this?',
              )
            : notice(
                'info',
                'You can ignore this email. Nobody can sign in without the code, and we will never ask you for it.',
                'Did not ask for this?',
              ),
        ],
        footer: {
          reason: confirm
            ? 'You get this because a change was made while signed in to this account.'
            : 'You get this because someone asked to sign in with this email address.',
        },
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
    },
  ): Promise<void> {
    // From a district: "in Gasabo". From an exact spot: "near KG 11 Ave", or
    // just "around you" when the phone gave the place no name (§169).
    const around = digest.nearSpot
      ? digest.place === 'you'
        ? 'around you'
        : `near ${digest.place}`
      : `in ${digest.place}`;
    const subject = digest.nearSpot ? 'Popular near you' : `Popular near you in ${digest.place}`;
    // The footer says which address this is for (§172), so a wrong one is
    // noticed — and says where to change it.
    const sentFor = digest.nearSpot && digest.place === 'you' ? 'your saved address' : digest.place;
    const onSale = digest.services.filter((s) => s.sale).length;

    await this.send(
      email,
      subject,
      {
        preheader: digest.services
          .slice(0, 3)
          .map((s) => s.name)
          .join(', ') + (digest.services.length > 3 ? ' and more' : ''),
        hero: {
          tone: 'accent',
          badge: { kind: 'glyph', glyph: '&#9733;' },
          eyebrow: 'This week',
          title: digest.nearSpot ? 'Popular near you' : `Popular in ${digest.place}`,
          lead:
            `What people ${around} are booking this week` +
            (onSale ? ` — ${onSale === 1 ? 'one of them is' : `${onSale} of them are`} on sale.` : '.'),
        },
        blocks: [
          serviceCards(
            digest.services.map((s) => ({
              photoUrl: s.imageUrl,
              name: s.name,
              shop: s.shop,
              facts: [s.away ?? s.where, lengthOf(s.minutes), s.rating !== null ? `★ ${s.rating.toFixed(1)}` : null]
                .filter(Boolean)
                .join(' · '),
              price: s.price,
              was: s.sale?.was ?? null,
              off: s.sale?.percent ?? null,
            })),
          ),
          prose('Open the app to book any of these — a deposit holds your time, and the rest is paid at the shop.'),
        ],
        footer: {
          reason: `You get this because you turned on "Weekly offers by email" in the app, for ${sentFor}.`,
          manage: { label: 'Change the address in the app, under Account.' },
          unsubscribeUrl: digest.unsubscribeUrl,
        },
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
  async sendAppointmentVerificationEmail(email: string, code: string, booking: BookingFacts): Promise<void> {
    if (this.config.get<string>('NODE_ENV') !== 'production') {
      this.logger.warn(`[DEV ONLY] Appointment code for ${email}: ${code}`);
    }
    const held = booking.status === AppointmentStatus.PENDING_PAYMENT;
    const subject = held
      ? `Your booking at ${booking.shopName} — arrival code ${code}`
      : `Your new arrival code for ${booking.serviceName}: ${code}`;

    try {
      await this.send(
        email,
        subject,
        {
          preheader: held
            ? `Pay the deposit in the app to confirm it. Your arrival code is ${code}.`
            : `Any earlier code no longer works. Your arrival code is ${code}.`,
          audience: 'CUSTOMER',
          hero: {
            tone: held ? 'accent' : 'ok',
            badge: held ? null : { kind: 'glyph', glyph: '&#10003;' },
            eyebrow: held ? 'Your booking' : 'A new arrival code',
            title: held ? 'Your time is held' : 'Here is your new code',
            lead: held
              ? `Pay the deposit in the app to confirm your booking at ${booking.shopName}. The time is held for you for 5 minutes.`
              : 'You asked for a new arrival code, so any earlier one no longer works.',
          },
          blocks: [
            bookingTicket(booking, { timeZone: this.timeZone, audience: 'CUSTOMER' }),
            codeBoxes(code, {
              label: 'Your arrival code',
              note: 'Give it to the shop when you arrive — they need it to start your appointment. Do not share it before.',
            }),
          ],
          footer: {
            reason: 'You get this because you booked with this email address.',
            manage: { label: 'Your bookings are in the app, under Bookings.' },
          },
        },
        { calendar: held ? null : icsFile(booking) },
      );
    } catch (err) {
      this.logger.error(`Failed to send appointment verification email to ${email}`, err as Error);
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw err;
      }
    }
  }
}
