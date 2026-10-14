import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LegalService } from '../legal/legal.service';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import {
  BusinessMemberRole,
  BusinessMemberStatus,
  InvitationStatus,
  OtpPurpose,
  Prisma,
  UserRole,
} from '@prisma/client';
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
    private readonly legal: LegalService,
  ) {}

  // ---------- OTP request ----------

  /**
   * Issues a login code.
   *
   * `role` is a REGISTRATION detail, not an authentication one (§50.1):
   *
   *  - The email already exists  -> log in as whoever they are. The body's role
   *    is ignored, not compared. This is what makes an ADMIN able to sign in at
   *    all: the previous version rejected any email whose stored role differed
   *    from the body, and the body could never say ADMIN.
   *  - The email is new          -> a role is required, and still restricted to
   *    BUSINESS | CUSTOMER by the DTO, so admins remain impossible to
   *    self-register (§3).
   *
   * The intended role is carried on the OTP row rather than asked for again at
   * verify time.
   */
  async requestOtp(email: string, role?: UserRole): Promise<{ message: string }> {
    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    // Registration, not login. Checked BEFORE enforceRateLimits() for the
    // reason §11 recorded: OTP history is keyed by email alone, so rate-limiting
    // first answered "please wait 47s" to someone whose actual problem was a
    // missing role. The answer here does not change with time either.
    if (!existingUser && !role) {
      // An invited administrator is the one exception (§99). They have no
      // account and cannot ask for one: the DTO refuses a role of ADMIN from
      // any client, deliberately. The invitation is their authorisation, so
      // the code is issued on the strength of it.
      const invitedAsAdmin = await this.hasPendingAdminInvitation(normalizedEmail);
      if (!invitedAsAdmin) {
        throw new BadRequestException(
          'This email has no account yet. Send `role` as BUSINESS or CUSTOMER to ' +
            'create one.',
        );
      }
    }

    // A closed account cannot be signed into (§119.1).
    //
    // Belt and braces: closing moves the address to a reserved domain, so the
    // original email already finds no row and lands in the registration branch
    // above — which is intended, the address is released and they may sign up
    // again as somebody new. This is here for the closed address itself, and so
    // the rule is written down rather than left to emerge from a rename.
    if (existingUser?.closedAt) {
      throw new BadRequestException(
        'This account has been closed. Sign up again to start a new one.',
      );
    }

    // An existing user's role wins outright. A new user gets the requested one.
    const registrationRole = existingUser ? null : (role as UserRole);

    // Only now that we know this request could legitimately produce an OTP —
    // a new account, or an existing one under its correct role — does the
    // rate limit apply.
    await this.enforceRateLimits(normalizedEmail);

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
        registrationRole,
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

  /**
   * Exchanges a code for tokens.
   *
   * Takes no role. An existing user is logged in as themselves; a new one is
   * created with the role recorded on the OTP row when it was issued.
   */
  async verifyOtp(
    email: string,
    code: string,
  ): Promise<TokenPair & { user: { id: string; email: string; role: UserRole } }> {
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

    const wasRegistration = otp.registrationRole !== null;
    const user = await this.findOrCreateUser(normalizedEmail, otp.registrationRole);

    /**
     * A brand-new account accepts the published documents as it is created
     * (§126.1).
     *
     * Recorded HERE rather than left to the client to post afterwards. The
     * screen that registers somebody will not let them continue without ticking
     * the box, so the acknowledgement is real — but a record that depends on a
     * second request is a record that is missing whenever that request fails,
     * and this one exists precisely to be produced years later.
     *
     * Exact versions, by id. "They accepted the terms" is worth nothing without
     * saying which (§122.3).
     *
     * Never throws. An account that exists with no acceptance row is caught by
     * the prompt on next open; an account that failed to be created because a
     * consent row would not write is a person who cannot sign in at all.
     */
    if (wasRegistration) {
      await this.legal.acceptCurrentAtRegistration(user.id).catch(() => undefined);
    }

    const tokens = await this.issueTokenPair(user.id, user.email, user.role);
    return { ...tokens, user: { id: user.id, email: user.email, role: user.role } };
  }

  /**
   * `role` is null whenever the code was issued for an email that already had
   * an account — the caller is logging in, not registering.
   */
  private async findOrCreateUser(email: string, role: UserRole | null) {
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing) {
      // No role comparison. The code was issued to THIS account, and the caller
      // proved control of the mailbox — they log in as whoever they are (§50.1).
      // Comparing against a body value is what locked administrators out.
      if (existing.role === UserRole.BUSINESS) {
        await this.acceptInvitationForExistingUser(existing.id, email);
      }
      return existing;
    }

    // Registration.
    //
    // The administrator invitation is consulted FIRST, before the missing-role
    // guard below. An invited administrator's code is issued with NO role —
    // the request DTO refuses `ADMIN` from any client — so checking the role
    // first would reject the single case this exists for (§99).
    //
    // It also outranks whatever role was asked for: the
    // row was written by the primary administrator, and the request body was
    // not. Checked before the branches below so an invited address cannot be
    // turned into a customer by sending `role=CUSTOMER` first (§99).
    const adminInvitation = await this.findAcceptableAdminInvitation(email);
    if (adminInvitation) {
      return this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email, role: UserRole.ADMIN },
        });
        await tx.adminInvitation.update({
          where: { id: adminInvitation.id },
          data: { status: InvitationStatus.ACCEPTED },
        });
        this.logger.log(`${email} became an administrator via invitation.`);
        return user;
      });
    }

    // `requestOtp` refuses a code for an unknown email without a role unless
    // that address has an administrator invitation, which the branch above has
    // already consumed. So this cannot be null here — but a defensive throw
    // beats a non-null assertion on the field that decides what someone can do.
    if (!role) {
      throw new BadRequestException(
        'This code was issued for an account that no longer exists. Request a new one.',
      );
    }

    if (role !== UserRole.BUSINESS) {
      return this.prisma.user.create({ data: { email, role } });
    }

    // ---- Brand-new business account ----
    //
    // There is no separate "accept invitation" endpoint. Verifying an OTP as a
    // BUSINESS user IS acceptance: the invited person just logs in with the
    // address they were invited at. That avoids an accept-token flow, a second
    // email, and the dead-end state where someone has an account but has not
    // yet clicked accept.
    const invitation = await this.findAcceptableInvitation(email);

    if (invitation) {
      return this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { email, role } });
        await tx.businessMembership.create({
          data: {
            userId: user.id,
            businessProfileId: invitation.businessProfileId,
            role: invitation.role,
            ...(await this.invitedBranches(tx, invitation)),
          },
        });
        await tx.businessInvitation.update({
          where: { id: invitation.id },
          data: { status: InvitationStatus.ACCEPTED },
        });
        this.logger.log(
          `${email} joined business ${invitation.businessProfileId} as ${invitation.role} via invitation.`,
        );
        return user;
      });
    }

    // No invitation: this person is founding their own business, which is the
    // original pre-membership behaviour. They become its one and only OWNER.
    // The profile starts PENDING until an admin approves it, exactly as before.
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email, role } });
      const business = await tx.businessProfile.create({ data: {} });
      await tx.businessMembership.create({
        data: {
          userId: user.id,
          businessProfileId: business.id,
          role: BusinessMemberRole.OWNER,
        },
      });
      return user;
    });
  }

  /** Whether this address has been invited to administer the platform (§99). */
  private async hasPendingAdminInvitation(email: string): Promise<boolean> {
    const count = await this.prisma.adminInvitation.count({
      where: {
        email,
        status: InvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
    });
    return count > 0;
  }

  private async findAcceptableAdminInvitation(email: string) {
    return this.prisma.adminInvitation.findFirst({
      where: {
        email,
        status: InvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
  }

  /** A PENDING, unexpired invitation for this address, if there is one. */
  private async findAcceptableInvitation(email: string) {
    return this.prisma.businessInvitation.findFirst({
      where: {
        email,
        status: InvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, businessProfileId: true, role: true, allLocations: true, locationIds: true },
    });
  }

  /**
   * The branches the owner chose when inviting (§277), as membership data.
   * Only branches that are still the business's are copied — one removed
   * since the invitation was sent has nothing left to look after.
   */
  private async invitedBranches(
    tx: Prisma.TransactionClient,
    invitation: { businessProfileId: string; allLocations: boolean; locationIds: string[] },
  ) {
    if (invitation.allLocations) return { allLocations: true };
    const still = await tx.location.findMany({
      where: { id: { in: invitation.locationIds }, businessId: invitation.businessProfileId },
      select: { id: true },
    });
    return {
      allLocations: false,
      locations: { create: still.map((l) => ({ locationId: l.id })) },
    };
  }

  /**
   * Applies a pending invitation to someone who already has an account.
   *
   * Deliberately NEVER blocks the login. If the invitation cannot be applied —
   * because this person is already an active member somewhere — their login
   * still succeeds and the invitation is left pending for the inviting owner to
   * revoke.
   *
   * Rejecting the login instead would hand any stranger a lockout primitive:
   * invite the email of a business owner, and their next login fails on an
   * invitation they never asked for and cannot revoke. The check that actually
   * prevents this situation lives at invite time, where MembersService refuses
   * to create an invitation for an address that already belongs to a business.
   */
  private async acceptInvitationForExistingUser(
    userId: string,
    email: string,
  ): Promise<void> {
    const invitation = await this.findAcceptableInvitation(email);
    if (!invitation) return;

    // Only an ACTIVE membership blocks acceptance. REMOVED rows are history:
    // since the unique index is partial, they no longer reserve the person's
    // one slot, so someone who left a business is free to join another.
    const active = await this.prisma.businessMembership.findFirst({
      where: { userId, status: BusinessMemberStatus.ACTIVE },
      select: { id: true, businessProfileId: true },
    });

    if (active) {
      this.logger.warn(
        `Invitation ${invitation.id} for ${email} not applied: already an active member of business ${active.businessProfileId}. Login allowed; invitation left pending.`,
      );
      return;
    }

    // Is there already a row for this person in the inviting business? There is
    // at most one, guaranteed by the @@unique([userId, businessProfileId])
    // index, so re-hiring reactivates it instead of inserting a duplicate.
    const priorHere = await this.prisma.businessMembership.findUnique({
      where: {
        userId_businessProfileId: {
          userId,
          businessProfileId: invitation.businessProfileId,
        },
      },
      select: { id: true },
    });

    await this.prisma.$transaction(async (tx) => {
      const branches = await this.invitedBranches(tx, invitation);
      if (priorHere) {
        // Re-hired: the branches are this invitation's, not whatever they
        // looked after the last time (§277).
        await tx.membershipLocation.deleteMany({ where: { membershipId: priorHere.id } });
        await tx.businessMembership.update({
          where: { id: priorHere.id },
          data: { status: BusinessMemberStatus.ACTIVE, role: invitation.role, ...branches },
        });
      } else {
        await tx.businessMembership.create({
          data: { userId, businessProfileId: invitation.businessProfileId, role: invitation.role, ...branches },
        });
      }
      await tx.businessInvitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.ACCEPTED },
      });
    });

    this.logger.log(
      `${email} joined business ${invitation.businessProfileId} as ${invitation.role} (${priorHere ? 'reactivated' : 'new'} membership).`,
    );
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
