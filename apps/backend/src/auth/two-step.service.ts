import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { checkTotp, newRecoveryCodes, newTotpSecret, openSecret, otpauthUrl, recoveryDigest, sealSecret } from './totp';

/** The refusal the console answers by showing the setup (§298). */
export const TWO_STEP_SETUP_REQUIRED = 'TWO_STEP_SETUP_REQUIRED';

/**
 * Two-step sign-in for administrators (§298): after the emailed code, the six
 * digits from an authenticator app on their phone. An administrator can move
 * money and close accounts, and an email inbox is one password away from
 * someone else — so a second thing, in their pocket, is asked for too.
 *
 * Required for every administrator (`ADMIN_TWO_STEP_REQUIRED`, on unless
 * set to false; off in the tests). Until it is set up the console shows only
 * the setup; once it is, every sign-in asks for a code (AuthService).
 */
@Injectable()
export class TwoStepService {
  private readonly logger = new Logger(TwoStepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  /** Whether an administrator must have it before using the console. */
  required(): boolean {
    const set = String(this.config.get<string>('ADMIN_TWO_STEP_REQUIRED') ?? '').toLowerCase();
    if (set === 'true') return true;
    if (set === 'false') return false;
    return (this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV) !== 'test';
  }

  async status(user: AuthenticatedUser) {
    const me = await this.admin(user.userId);
    return {
      enabled: me.totpEnabledAt !== null,
      enabledAt: me.totpEnabledAt?.toISOString() ?? null,
      recoveryCodesLeft: me.totpRecovery.length,
      required: this.required(),
      /** This sign-in was made with the code. */
      thisSignIn: user.twoStep === true,
    };
  }

  /**
   * Begins setting it up — or moving it to a new phone: a new secret, kept
   * aside until its first code is typed, so a setup left half-way changes
   * nothing. Shown once, as a QR code and as letters to type.
   */
  async start(user: AuthenticatedUser) {
    const me = await this.admin(user.userId);
    const secret = newTotpSecret();
    await this.prisma.user.update({
      where: { id: me.id },
      data: { totpPendingSecret: sealSecret(secret, this.auth.sealKey()) },
    });
    return { secret: secret.match(/.{1,4}/g)!.join(' '), otpauthUrl: otpauthUrl(secret, me.email) };
  }

  /**
   * The first code from the app, which proves it was set up right. Turns it
   * on, gives ten recovery codes (shown once), signs out every other place —
   * they were signed in without it — and hands this one new tokens that say
   * it was made with the code.
   */
  async confirm(user: AuthenticatedUser, code: string) {
    const me = await this.admin(user.userId);
    if (!me.totpPendingSecret) throw new BadRequestException('Start the setup first — scan the code with your app.');
    const secret = openSecret(me.totpPendingSecret, this.auth.sealKey());
    const step = checkTotp(secret, code);
    if (step === null) {
      throw new BadRequestException(
        'That is not the code your app shows. Check the time on your phone is set automatically, and type the newest one.',
      );
    }

    const codes = newRecoveryCodes();
    await this.prisma.user.update({
      where: { id: me.id },
      data: {
        totpSecret: me.totpPendingSecret,
        totpPendingSecret: null,
        totpEnabledAt: new Date(),
        totpLastStep: step,
        totpRecovery: codes.map(recoveryDigest),
      },
    });

    const startedAt = user.authTime ? new Date(user.authTime * 1000) : new Date();
    const sessionId = user.sessionId ?? (await this.auth.startSession(me.id, { userAgent: null, ip: null }, true)).id;
    await this.auth.endSessions({ userId: me.id, id: { not: sessionId } }, me.id);
    await this.prisma.authSession.update({ where: { id: sessionId }, data: { twoStep: true } });
    const tokens = await this.auth.issueTokenPair(me.id, me.email, UserRole.ADMIN, startedAt, {
      sessionId,
      twoStep: true,
    });

    this.logger.warn(`Administrator ${me.id} turned on two-step sign-in.`);
    return { recoveryCodes: codes, tokens };
  }

  /** Ten new recovery codes; the old ones stop working. */
  async newRecoveryCodes(user: AuthenticatedUser) {
    const me = await this.admin(user.userId);
    if (!me.totpEnabledAt) throw new BadRequestException('Turn on two-step sign-in first.');
    const codes = newRecoveryCodes();
    await this.prisma.user.update({ where: { id: me.id }, data: { totpRecovery: codes.map(recoveryDigest) } });
    return { recoveryCodes: codes };
  }

  /**
   * For an administrator who lost their phone and their recovery codes: the
   * primary administrator turns it off, so they can set it up again at their
   * next sign-in. Every place they are signed in ends.
   */
  async reset(actor: AuthenticatedUser, targetId: string) {
    const me = await this.admin(actor.userId);
    if (!me.isPrimaryAdmin) throw new ForbiddenException('Only the primary administrator can do this.');
    if (targetId === me.id) throw new BadRequestException('Not your own — use Security to move it to a new phone.');
    const target = await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true, role: true } });
    if (!target || target.role !== UserRole.ADMIN) throw new NotFoundException('Administrator not found.');
    await this.prisma.user.update({
      where: { id: targetId },
      data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null, totpRecovery: [] },
    });
    await this.auth.endSessions({ userId: targetId }, targetId);
    this.logger.warn(`Two-step sign-in reset for administrator ${targetId} by ${me.id}.`);
    return { message: 'Turned off. They set it up again when they next sign in.' };
  }

  private async admin(userId: string) {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        isPrimaryAdmin: true,
        totpEnabledAt: true,
        totpPendingSecret: true,
        totpRecovery: true,
      },
    });
    if (!me || me.role !== UserRole.ADMIN) throw new ForbiddenException('Two-step sign-in is for administrators.');
    return me;
  }
}
