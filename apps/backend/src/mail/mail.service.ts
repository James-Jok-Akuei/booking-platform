import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/** "45 min", "1 h 30 min" — as a person says it, the same as the app (§163). */
const lengthOf = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

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
  }

  /** Whether an SMTP host is configured at all. */
  isConfigured(): boolean {
    const host = this.config.get<string>('SMTP_HOST');
    return Boolean(host && host.trim().length > 0);
  }

  /**
   * Sends an arbitrary subject/body.
   *
   * Used by the notifications module, which renders its own copy. Unlike the
   * two methods below it does NOT swallow failures: a notification's delivery
   * result is recorded on its row and retried, so the caller has to learn that
   * the send failed.
   */
  async sendGenericEmail(email: string, subject: string, body: string): Promise<void> {
    const from = this.config.get<string>('SMTP_FROM');

    if (this.config.get<string>('NODE_ENV') !== 'production') {
      this.logger.log(`[DEV] Email to ${email}: ${subject}`);
    }

    await this.transporter.sendMail({
      from,
      to: email,
      subject,
      text: body,
      html: body
        .split('\n\n')
        .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br/>')}</p>`)
        .join(''),
    });
  }

  async sendOtpEmail(email: string, code: string): Promise<void> {
    const from = this.config.get<string>('SMTP_FROM');

    // In development, don't hard-fail the signup/login flow if SMTP isn't
    // configured yet — log the code so you can keep testing the flow locally.
    if (this.config.get<string>('NODE_ENV') !== 'production') {
      this.logger.warn(`[DEV ONLY] OTP for ${email}: ${code}`);
    }

    try {
      await this.transporter.sendMail({
        from,
        to: email,
        subject: 'Your verification code',
        text: `Your verification code is ${code}. It expires in ${this.config.get(
          'OTP_EXPIRES_IN_MINUTES',
        )} minutes. Do not share this code with anyone.`,
        html: `<p>Your verification code is <strong>${code}</strong>.</p><p>It expires in ${this.config.get(
          'OTP_EXPIRES_IN_MINUTES',
        )} minutes. Do not share this code with anyone.</p>`,
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
   *
   * Built from tables and inline styles because that is what email clients
   * draw; the plain-text part says the same thing for the ones that draw
   * nothing. The unsubscribe link is in the body AND in the List-Unsubscribe
   * header, which is what puts a mail app's own "unsubscribe" button on it.
   */
  async sendOffersDigest(
    email: string,
    digest: {
      place: string;
      unsubscribeUrl: string;
      services: Array<{
        name: string;
        shop: string;
        where: string | null;
        price: string;
        minutes: number;
        imageUrl: string | null;
        rating: number | null;
      }>;
    },
  ): Promise<void> {
    const from = this.config.get<string>('SMTP_FROM');
    const subject = `Popular near you in ${digest.place}`;

    if (this.config.get<string>('NODE_ENV') !== 'production') {
      this.logger.log(`[DEV] Offers email to ${email}: ${subject}`);
    }

    const esc = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const rows = digest.services
      .map((service) => {
        const facts = [
          service.shop,
          service.where,
          `${lengthOf(service.minutes)}`,
          service.rating !== null ? `★ ${service.rating.toFixed(1)}` : null,
        ]
          .filter((fact): fact is string => Boolean(fact))
          .map(esc)
          .join(' · ');
        const picture = service.imageUrl
          ? `<img src="${esc(service.imageUrl)}" width="84" height="84" alt="" style="display:block;width:84px;height:84px;border-radius:14px;object-fit:cover">`
          : '<div style="width:84px;height:84px;border-radius:14px;background:#FFEEE8"></div>';
        return (
          '<tr><td style="padding:0 0 12px">' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:18px"><tr>' +
          `<td width="84" style="padding:12px">${picture}</td>` +
          '<td style="padding:12px 14px 12px 2px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">' +
          `<div style="font-size:16px;font-weight:700;color:#15171C">${esc(service.name)}</div>` +
          `<div style="font-size:13px;color:#8B909B;padding:3px 0 7px">${facts}</div>` +
          `<div style="font-size:16px;font-weight:800;color:#F0532D">${esc(service.price)}</div>` +
          '</td></tr></table></td></tr>'
        );
      })
      .join('');

    const html =
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
      '<body style="margin:0;background:#F6F4F0">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F4F0"><tr><td align="center" style="padding:28px 14px">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px">' +
      '<tr><td style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:0 4px 18px">' +
      `<div style="font-size:24px;font-weight:800;color:#15171C;letter-spacing:-0.4px">Popular near you</div>` +
      `<div style="font-size:15px;color:#4B505B;padding-top:6px">What people in ${esc(digest.place)} are booking this week.</div>` +
      '</td></tr>' +
      rows +
      '<tr><td align="center" style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:10px 4px 0">' +
      '<div style="font-size:15px;font-weight:700;color:#15171C">Open the app to book any of these.</div>' +
      '<div style="font-size:12px;line-height:1.6;color:#8B909B;padding-top:18px">' +
      'You get this because you turned on "Offers near me" in the app.<br>' +
      `<a href="${esc(digest.unsubscribeUrl)}" style="color:#8B909B">Unsubscribe</a>` +
      '</div></td></tr></table></td></tr></table></body></html>';

    const text =
      `Popular near you — what people in ${digest.place} are booking this week.\n\n` +
      digest.services
        .map(
          (service) =>
            `${service.name} — ${service.price}\n${service.shop}${service.where ? `, ${service.where}` : ''} · ${lengthOf(service.minutes)}`,
        )
        .join('\n\n') +
      '\n\nOpen the app to book any of these.\n\n' +
      `You get this because you turned on "Offers near me" in the app. Unsubscribe: ${digest.unsubscribeUrl}`;

    await this.transporter.sendMail({
      from,
      to: email,
      subject,
      text,
      html,
      // nodemailer writes the List-* headers itself from `list` and drops a
      // hand-written one, so the address goes here and only the one-click
      // marker is a plain header.
      list: { unsubscribe: { url: digest.unsubscribeUrl, comment: 'Unsubscribe' } },
      headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
  }

  /**
   * Sends a customer their appointment arrival code.
   *
   * Deliberately NOT an extra branch inside sendOtpEmail: this code has a
   * different lifetime (until the appointment happens, not ten minutes), a
   * different audience, and different copy. Folding it in would mean one method
   * whose subject line and expiry text depend on a flag, which is how the login
   * email eventually ends up telling someone about a haircut.
   */
  async sendAppointmentVerificationEmail(
    email: string,
    code: string,
    details: { serviceName: string; locationName: string; startTime: Date },
  ): Promise<void> {
    const from = this.config.get<string>('SMTP_FROM');
    const when = details.startTime.toISOString();

    if (this.config.get<string>('NODE_ENV') !== 'production') {
      this.logger.warn(`[DEV ONLY] Appointment code for ${email}: ${code}`);
    }

    const text =
      `Your booking for ${details.serviceName} at ${details.locationName} is confirmed for ${when}.\n\n` +
      `Your arrival code is ${code}.\n\n` +
      'Give this code to the business when you arrive. They cannot complete your appointment without it, ' +
      'so do not share it with anyone beforehand.';

    try {
      await this.transporter.sendMail({
        from,
        to: email,
        subject: `Your arrival code for ${details.serviceName}`,
        text,
        html:
          `<p>Your booking for <strong>${details.serviceName}</strong> at ` +
          `<strong>${details.locationName}</strong> is confirmed for ${when}.</p>` +
          `<p>Your arrival code is <strong>${code}</strong>.</p>` +
          '<p>Give this code to the business when you arrive. They cannot complete your ' +
          'appointment without it, so do not share it with anyone beforehand.</p>',
      });
    } catch (err) {
      this.logger.error(
        `Failed to send appointment verification email to ${email}`,
        err as Error,
      );
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw err;
      }
    }
  }
}
