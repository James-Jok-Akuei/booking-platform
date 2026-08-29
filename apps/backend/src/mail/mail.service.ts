import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

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
}
