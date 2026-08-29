import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { OtpPurpose, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { JwtPayload } from './strategies/jwt.strategy';

const BCRYPT_ROUNDS = 10;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ---------- OTP request ----------

  async requestOtp(email: string, role: UserRole): Promise<{ message: string }> {
    const normalizedEmail = email.trim().toLowerCase();

    await this.enforceRateLimits(normalizedEmail);

    // If the email is already registered under a different role, block it.
    // MVP rule: one email maps to exactly one role/account.
    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingUser && existingUser.role !== role) {
      throw new BadRequestException(
        `This email is already registered as a ${existingUser.role.toLowerCase()} account.`,
      );
    }

    const code = this.generateOtpCode();
    const codeHash = await bcrypt.hash(code, BCRYPT_ROUNDS);
    const expiresInMinutes = Number(this.config.get('OTP_EXPIRES_IN_MINUTES') ?? 10);
    const maxAttempts = Number(this.config.get('OTP_MAX_ATTEMPTS') ?? 5);

    await this.prisma.otpCode.create({
      data: {
        email: normalizedEmail,
        codeHash,
        purpose: OtpPurpose.LOGIN,
        expiresAt: new Date(Date.now() + expiresInMinutes * 60 * 1000),
        maxAttempts,
        userId: existingUser?.id,
      },
    });

    await this.mail.sendOtpEmail(normalizedEmail, code);

    return { message: 'Verification code sent to your email.' };
  }

  private async enforceRateLimits(email: string): Promise<void> {
    const cooldownSeconds = Number(this.config.get('OTP_RESEND_COOLDOWN_SECONDS') ?? 60);
    const maxPerHour = Number(this.config.get('OTP_MAX_REQUESTS_PER_HOUR') ?? 5);

    const lastOtp = await this.prisma.otpCode.findFirst({
      where: { email, purpose: OtpPurpose.LOGIN },
      orderBy: { createdAt: 'desc' },
    });

    if (lastOtp) {
      const secondsSinceLast = (Date.now() - lastOtp.createdAt.getTime()) / 1000;
      if (secondsSinceLast < cooldownSeconds) {
        throw new BadRequestException(
          `Please wait ${Math.ceil(cooldownSeconds - secondsSinceLast)}s before requesting another code.`,
        );
      }
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const requestsInLastHour = await this.prisma.otpCode.count({
      where: { email, purpose: OtpPurpose.LOGIN, createdAt: { gte: oneHourAgo } },
    });

    if (requestsInLastHour >= maxPerHour) {
      throw new BadRequestException('Too many verification code requests. Please try again later.');
    }
  }

  private generateOtpCode(): string {
    // Cryptographically random 6-digit code, zero-padded.
    return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  // ---------- OTP verification / login-signup ----------

  async verifyOtp(email: string, code: string, role: UserRole): Promise<TokenPair & { user: { id: string; email: string; role: UserRole } }> {
    const normalizedEmail = email.trim().toLowerCase();

    const otp = await this.prisma.otpCode.findFirst({
      where: { email: normalizedEmail, purpose: OtpPurpose.LOGIN, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp || otp.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired verification code.');
    }

    if (otp.attempts >= otp.maxAttempts) {
      throw new BadRequestException('Too many incorrect attempts. Please request a new code.');
    }

    const isMatch = await bcrypt.compare(code, otp.codeHash);
    if (!isMatch) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Invalid or expired verification code.');
    }

    // Mark OTP consumed so it can't be replayed.
    await this.prisma.otpCode.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });

    const user = await this.findOrCreateUser(normalizedEmail, role);

    const tokens = await this.issueTokenPair(user.id, user.email, user.role);
    return { ...tokens, user: { id: user.id, email: user.email, role: user.role } };
  }

  private async findOrCreateUser(email: string, role: UserRole) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.role !== role) {
        throw new BadRequestException(
          `This email is already registered as a ${existing.role.toLowerCase()} account.`,
        );
      }
      return existing;
    }

    return this.prisma.user.create({
      data: {
        email,
        role,
        // A brand-new business account gets its profile row immediately,
        // starting PENDING until admin approval and onboarding is completed
        // (see business-profile module).
        businessProfile:
          role === UserRole.BUSINESS ? { create: {} } : undefined,
      },
    });
  }

  // ---------- Token issuance / refresh / logout ----------

  private async issueTokenPair(userId: string, email: string, role: UserRole): Promise<TokenPair> {
    const payload: JwtPayload = { sub: userId, email, role };

    const accessToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.expiresIn('JWT_ACCESS_EXPIRES_IN', '15m'),
    });

    const refreshToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.expiresIn('JWT_REFRESH_EXPIRES_IN', '30d'),
    });

    const tokenHash = this.hashToken(refreshToken);
    const decoded = this.jwt.decode(refreshToken) as { exp: number };

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(decoded.exp * 1000),
      },
    });

    return { accessToken, refreshToken };
  }

  // @nestjs/jwt types `expiresIn` as `number | StringValue`, where StringValue is
  // a template literal type ('15m', '30d', ...). Env vars are plain `string |
  // undefined`, so they need a cast through the option type to satisfy it.
  private expiresIn(key: string, fallback: string): JwtSignOptions['expiresIn'] {
    return (this.config.get<string>(key) ?? fallback) as JwtSignOptions['expiresIn'];
  }

  private hashToken(token: string): string {
    // Refresh tokens are opaque-ish JWTs but we still never store them raw —
    // a plain SHA-256 digest is enough here since we're only using it for
    // exact-match lookup/revocation, not password-style verification.
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async refreshTokens(refreshToken: string): Promise<TokenPair> {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is no longer valid.');
    }

    // Rotate: revoke the old one, issue a brand new pair.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokenPair(payload.sub, payload.email, payload.role);
  }

  async logout(refreshToken: string): Promise<{ message: string }> {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: 'Logged out.' };
  }
}
