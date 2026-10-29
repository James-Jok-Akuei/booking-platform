import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LegalService } from '../legal/legal.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import {
  BusinessMemberRole,
  BusinessMemberStatus,
  InvitationStatus,
  NotificationCategory,
  NotificationType,
  OtpPurpose,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { JwtPayload } from './strategies/jwt.strategy';
import { RECENT_AUTH_MINUTES, SESSION_POLICY, sessionEndsAt } from './session-policy';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { checkTotp, openSecret, recoveryDigest } from './totp';
import { TOURS } from '../users/tours';
import { describeDevice, trimUserAgent } from './device';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales';
import { say } from '../i18n/say';
import { CountriesService } from '../countries/countries.service';
import { testMarkFor } from '../users/test-accounts';

/** The refusal the console answers by asking for the authenticator code (§298). */
export const TWO_STEP_REQUIRED = 'TWO_STEP_REQUIRED';

/**
 * What the sign-in refusals are, by name (§308): the apps tell them apart by
 * `code`, never by their words, which are said in the reader's language.
 */
export const SIGN_IN = {
  NO_ACCOUNT: 'NO_ACCOUNT',
  CLOSED: 'ACCOUNT_CLOSED',
  COOLDOWN: 'CODE_COOLDOWN',
  TOO_MANY_CODES: 'TOO_MANY_CODES',
  CODE_NOT_RIGHT: 'CODE_NOT_RIGHT',
  TOO_MANY_TRIES: 'TOO_MANY_TRIES',
  WRONG_APP: 'WRONG_APP',
} as const;

const codeNotRight = () =>
  new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code: SIGN_IN.CODE_NOT_RIGHT,
    message: 'Invalid or expired verification code.',
  });

/** Where a sign-in came from (§298): what its browser or app says, and its address. */
/** Which app is signing somebody in, so an account of another kind is told where it belongs (§308.6). */
export type SignInApp = 'business' | 'customer';

export interface SignInContext {
  /** The app asking; left out by older apps and the console. */
  app?: SignInApp;
  userAgent?: string | null;
  ip?: string | null;
  /** An administrator's authenticator code, or one of their recovery codes. */
  twoStepCode?: string | null;
}

const BCRYPT_ROUNDS = 10;

/** Said when a sign-in has reached the most it may last (§279). */
const SIGN_IN_ENDED = 'For your safety, this sign-in has ended. Please sign in again.';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  session: { idleMinutes: number; maxMinutes: number | null; endsAt: string | null };
}

/** An OTP row, as far as checking a typed code needs it. */
type CodeRow = { id: string; codeHash: string; expiresAt: Date; attempts: number; maxAttempts: number };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly legal: LegalService,
    private readonly countries: CountriesService,
    // Optional so the auth flow never depends on a notice being sent (§298).
    @Optional() private readonly notifications?: NotificationsService,
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
  async requestOtp(email: string, role?: UserRole, locale: Locale = DEFAULT_LOCALE): Promise<{ message: string }> {
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
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          code: SIGN_IN.NO_ACCOUNT,
          message: 'This email has no account yet. Send `role` as BUSINESS or CUSTOMER to create one.',
        });
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
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: SIGN_IN.CLOSED,
        message: 'This account has been closed. Sign up again to start a new one.',
      });
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

    // In the language of the app it was asked from (§308).
    await this.mail.sendOtpEmail(normalizedEmail, code, 'sign-in', locale);

    return { message: 'Verification code sent to your email.' };
  }

  private async enforceRateLimits(email: string, purpose: OtpPurpose = OtpPurpose.LOGIN): Promise<void> {
    const cooldownSeconds = Number(this.config.get('OTP_RESEND_COOLDOWN_SECONDS') ?? 60);
    const maxPerHour = Number(this.config.get('OTP_MAX_REQUESTS_PER_HOUR') ?? 5);

    const lastOtp = await this.prisma.otpCode.findFirst({
      where: { email, purpose },
      orderBy: { createdAt: 'desc' },
    });

    if (lastOtp) {
      const secondsSinceLast = (Date.now() - lastOtp.createdAt.getTime()) / 1000;
      if (secondsSinceLast < cooldownSeconds) {
        const waitSeconds = Math.ceil(cooldownSeconds - secondsSinceLast);
        // `waitSeconds` for the apps: the last code still works, and how long until another (§308 — never read from the words).
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          code: SIGN_IN.COOLDOWN,
          waitSeconds,
          message: `Please wait ${waitSeconds}s before requesting another code.`,
        });
      }
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const requestsInLastHour = await this.prisma.otpCode.count({
      where: { email, purpose, createdAt: { gte: oneHourAgo } },
    });

    if (requestsInLastHour >= maxPerHour) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: SIGN_IN.TOO_MANY_CODES,
        message: 'Too many verification code requests. Please try again later.',
      });
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
    context: SignInContext = {},
  ): Promise<TokenPair & { user: { id: string; email: string; role: UserRole } }> {
    const normalizedEmail = email.trim().toLowerCase();

    const otp = await this.prisma.otpCode.findFirst({
      where: { email: normalizedEmail, purpose: OtpPurpose.LOGIN, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    const checked = await this.checkCode(otp, code);
    // The right email code in the wrong app: said plainly before anything else
    // — before an administrator's authenticator step, and before any sign-in
    // is started — so nobody is signed in where their account does not belong.
    // Only once the code is right, so it tells nobody but the owner what kind
    // of account an email is.
    if (context.app) await this.refuseWrongApp(normalizedEmail, context.app, checked);
    // An administrator with an authenticator app types its code too (§298) —
    // asked for only once the email code is right, which stays usable until
    // both are. A wrong app code counts against the email code's tries.
    const twoStep = await this.secondStep(normalizedEmail, checked, context.twoStepCode);
    const used = await this.useUp(checked);

    const wasRegistration = used.registrationRole !== null;
    const user = await this.findOrCreateUser(normalizedEmail, used.registrationRole);

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

    const session = await this.startSession(user.id, context, twoStep);
    const tokens = await this.issueTokenPair(user.id, user.email, user.role, new Date(), {
      sessionId: session.id,
      twoStep,
    });
    if (!wasRegistration) await this.tellAboutNewSignIn(user.id, session.id, context);
    return { ...tokens, user: { id: user.id, email: user.email, role: user.role } };
  }

  /**
   * Refuses an account the asking app is not for (§308.6): the business app
   * is for sellers, the customer app for customers, and administrators have
   * their own console. The code is spent either way.
   */
  private async refuseWrongApp(email: string, app: SignInApp, otp: CodeRow) {
    const account = await this.prisma.user.findUnique({ where: { email }, select: { role: true } });
    if (!account) return;
    const belongs = app === 'business' ? account.role === UserRole.BUSINESS : account.role === UserRole.CUSTOMER;
    if (belongs) return;
    await this.useUp(otp);
    if (account.role === UserRole.ADMIN) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: SIGN_IN.WRONG_APP,
        accountKind: account.role,
        message: 'This is an administrator account. Administrators sign in to the admin console, not here.',
      });
    }
    if (app === 'business') {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: SIGN_IN.WRONG_APP,
        accountKind: account.role,
        message:
          'This email is a customer account. To sell on BwanguReservations, sign in with your business email, or use a new email to add your business.',
      });
    }
    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      code: SIGN_IN.WRONG_APP,
      accountKind: account.role,
      message:
        'This email is a business account. To book as a customer, sign in with a different email. Your shop is managed in the business app.',
    });
  }

  /**
   * The second step for an administrator who turned it on (§298): the six
   * digits from their authenticator app, or one of their recovery codes.
   * Nothing for anyone else. True when it was passed.
   */
  private async secondStep(email: string, otp: CodeRow, typed?: string | null): Promise<boolean> {
    const admin = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, totpEnabledAt: true, totpSecret: true, totpLastStep: true, totpRecovery: true },
    });
    if (!admin || admin.role !== UserRole.ADMIN || !admin.totpEnabledAt || !admin.totpSecret) return false;

    if (!typed?.trim()) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: TWO_STEP_REQUIRED,
        message: 'Now the 6-digit code from your authenticator app.',
      });
    }

    const wrong = async (message: string): Promise<never> => {
      await this.prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException(message);
    };

    // A recovery code: "xxxx-xxxx", used once.
    if (/[a-z]/i.test(typed)) {
      const digest = recoveryDigest(typed);
      if (!admin.totpRecovery.includes(digest)) return wrong('That recovery code does not work. Each one works only once.');
      await this.prisma.user.update({
        where: { id: admin.id },
        data: { totpRecovery: admin.totpRecovery.filter((d) => d !== digest) },
      });
      this.logger.warn(`Administrator ${admin.id} signed in with a recovery code.`);
      return true;
    }

    const step = checkTotp(openSecret(admin.totpSecret, this.sealKey()), typed);
    if (step === null) return wrong('That is not the code in your authenticator app. Type the one showing now.');
    // Each code once: a code seen over someone's shoulder is no good a second time.
    const claimed = await this.prisma.user.updateMany({
      where: { id: admin.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step },
    });
    if (claimed.count === 0) return wrong('That code was used already. Wait for the next one.');
    return true;
  }

  /** The key the authenticator secrets are sealed with — from the access key, nothing new to set. */
  sealKey(): string {
    return this.config.get<string>('JWT_ACCESS_SECRET') ?? '';
  }

  // ---------- Sessions (§298) ----------

  /** One sign-in on one phone or browser: what "where you are signed in" lists. */
  startSession(userId: string, context: SignInContext, twoStep: boolean) {
    return this.prisma.authSession.create({
      data: { userId, userAgent: trimUserAgent(context.userAgent), ip: context.ip?.slice(0, 64) ?? null, twoStep },
      select: { id: true },
    });
  }

  /**
   * Tells someone their account was signed in to on a phone or browser it has
   * not been used on before (§298) — by email, and by push to the phones
   * already signed in. Not on the first sign-in of a new account, and not for
   * a device it has been seen on: an alarm every time is one nobody reads.
   */
  private async tellAboutNewSignIn(userId: string, sessionId: string, context: SignInContext) {
    if (!this.notifications) return;
    try {
      const device = describeDevice(context.userAgent);
      const earlier = await this.prisma.authSession.findMany({
        where: { userId, id: { not: sessionId } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { userAgent: true },
      });
      // Nobody signed in before sessions were kept: no history to compare with yet.
      if (earlier.length === 0) return;
      if (earlier.some((s) => describeDevice(s.userAgent) === device)) return;
      await this.notifications.notify({
        recipientId: userId,
        type: NotificationType.NEW_SIGN_IN,
        context: {
          serviceName: device,
          locationName: '',
          businessName: '',
          startTime: new Date(),
          // Named again in the reader's own language (§308).
          userAgent: context.userAgent ?? null,
        },
        category: NotificationCategory.ACCOUNT,
      });
    } catch (error) {
      this.logger.error(`Could not send the new sign-in notice to ${userId}: ${String(error)}`);
    }
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
      // A new customer is shown around once, wherever they first sign in (§307).
      return this.prisma.user.create({
        // An address no real person holds is a test account (§316).
        data: { email, role, ...testMarkFor(email), ...(role === UserRole.CUSTOMER ? { toursDue: [TOURS.customer] } : {}) },
      });
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
        // A new team member is shown around too (§307), the parts they can use.
        const user = await tx.user.create({ data: { email, role, ...testMarkFor(email), toursDue: [TOURS.seller] } });
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
    // It is in the default country (§315) — the one the app is offered in.
    const country = await this.countries.defaultCountry();
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email, role, ...testMarkFor(email), toursDue: [TOURS.seller] } });
      // A test owner's shop is a test shop (§316).
      const business = await tx.businessProfile.create({ data: { countryCode: country.code, ...testMarkFor(email) } });
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

  /**
   * A new token pair for a sign-in that began at `sessionStartedAt` (§279).
   *
   * The refresh token lives as long as the app's idle time, so a sign-in left
   * unused ends by itself; neither token outlives the most a sign-in may last,
   * however it is used. Both carry `auth_time`, the moment the code was typed.
   */
  async issueTokenPair(
    userId: string,
    email: string,
    role: UserRole,
    sessionStartedAt: Date = new Date(),
    /** The sign-in it belongs to, and whether an authenticator code was typed for it (§298). */
    session: { sessionId?: string | null; twoStep?: boolean } = {},
  ): Promise<TokenPair> {
    const { idleMinutes, maxMinutes } = SESSION_POLICY[role];
    const endsAt = sessionEndsAt(role, sessionStartedAt);
    const secondsLeft = endsAt ? Math.floor((endsAt.getTime() - Date.now()) / 1000) : Infinity;
    if (secondsLeft <= 0) throw new UnauthorizedException(SIGN_IN_ENDED);

    const payload: JwtPayload = {
      sub: userId,
      email,
      role,
      auth_time: Math.floor(sessionStartedAt.getTime() / 1000),
      ...(session.sessionId ? { sid: session.sessionId } : {}),
      ...(session.twoStep ? { tsv: true } : {}),
    };

    const accessToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: Math.min(this.accessSeconds(), secondsLeft),
    });

    const refreshToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: Math.min(idleMinutes * 60, secondsLeft),
      // Two pairs issued in the same second would otherwise be the same token,
      // and the stored hash is unique.
      jwtid: crypto.randomUUID(),
    });

    const tokenHash = this.hashToken(refreshToken);
    const decoded = this.jwt.decode(refreshToken) as { exp: number };

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(decoded.exp * 1000),
        sessionStartedAt,
        sessionId: session.sessionId ?? null,
      },
    });

    return {
      accessToken,
      refreshToken,
      session: { idleMinutes, maxMinutes, endsAt: endsAt?.toISOString() ?? null },
    };
  }

  /** The access token's life, from `JWT_ACCESS_EXPIRES_IN` ("15m", "900", "1h"). */
  private accessSeconds(): number {
    const raw = String(this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m').trim();
    const match = /^(\d+)\s*([smhd]?)$/.exec(raw);
    if (!match) return 15 * 60;
    const unit = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[match[2] as '' | 's' | 'm' | 'h' | 'd'];
    return Number(match[1]) * unit;
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

    // Signed out from "where you are signed in", or everywhere (§298).
    if (stored.sessionId) {
      const session = await this.prisma.authSession.findUnique({
        where: { id: stored.sessionId },
        select: { endedAt: true },
      });
      if (!session || session.endedAt) throw new UnauthorizedException('This sign-in was ended. Please sign in again.');
    }

    // Rotate: revoke the old one, issue a brand new pair.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    // The same sign-in, continued: its start — and so its end — does not move
    // (§279). Past its end, it is over however recently it was used.
    const endsAt = sessionEndsAt(payload.role as UserRole, stored.sessionStartedAt);
    if (endsAt && endsAt <= new Date()) throw new UnauthorizedException(SIGN_IN_ENDED);

    if (stored.sessionId) {
      await this.prisma.authSession.update({ where: { id: stored.sessionId }, data: { lastUsedAt: new Date() } });
    }
    return this.issueTokenPair(payload.sub, payload.email, payload.role as UserRole, stored.sessionStartedAt, {
      sessionId: stored.sessionId,
      twoStep: payload.tsv === true,
    });
  }

  // ---------- Confirm it is you (§279) ----------

  /**
   * Emails a signed-in person a code to confirm a risky change — the payout
   * number, who works at the shop. A code of its own kind: it cannot sign
   * anybody in, and a sign-in code cannot be used here.
   */
  async requestStepUp(userId: string, locale: Locale = DEFAULT_LOCALE): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, closedAt: true },
    });
    if (!user || user.closedAt) throw new UnauthorizedException('Not signed in.');

    await this.enforceRateLimits(user.email, OtpPurpose.STEP_UP);

    const code = this.generateOtpCode();
    const expiresInMinutes = Number(this.config.get('OTP_EXPIRES_IN_MINUTES') ?? 10);
    await this.prisma.otpCode.create({
      data: {
        email: user.email,
        codeHash: await bcrypt.hash(code, BCRYPT_ROUNDS),
        purpose: OtpPurpose.STEP_UP,
        expiresAt: new Date(Date.now() + expiresInMinutes * 60 * 1000),
        maxAttempts: Number(this.config.get('OTP_MAX_ATTEMPTS') ?? 5),
        userId,
      },
    });

    await this.mail.sendOtpEmail(user.email, code, 'confirm', locale);
    return { message: `We emailed a code to ${user.email}.` };
  }

  /**
   * Checks the code, and answers with a short-lived pass the app sends as
   * `X-Step-Up` with the change. It is signed with a key of its own, so it can
   * never stand in for an access token, and it names the person it was given to.
   */
  async verifyStepUp(userId: string, code: string): Promise<{ stepUpToken: string; expiresAt: string }> {
    const otp = await this.prisma.otpCode.findFirst({
      where: { userId, purpose: OtpPurpose.STEP_UP, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    await this.consumeCode(otp, code);

    const seconds = RECENT_AUTH_MINUTES * 60;
    const stepUpToken = this.jwt.sign(
      { sub: userId, typ: 'step-up' },
      { secret: this.stepUpSecret(), expiresIn: seconds },
    );
    return { stepUpToken, expiresAt: new Date(Date.now() + seconds * 1000).toISOString() };
  }

  /**
   * Whether this person typed a code recently enough for a risky change
   * (§279): they signed in within the last few minutes, or they confirmed it
   * was them and sent the pass for it.
   */
  isRecentlyConfirmed(user: AuthenticatedUser, stepUpToken?: string): boolean {
    const window = RECENT_AUTH_MINUTES * 60 * 1000;
    if (user.authTime && Date.now() - user.authTime * 1000 <= window) return true;
    if (!stepUpToken) return false;
    try {
      const pass = this.jwt.verify<{ sub: string; typ: string }>(stepUpToken, { secret: this.stepUpSecret() });
      return pass.typ === 'step-up' && pass.sub === user.userId;
    } catch {
      return false;
    }
  }

  /** A key of its own for the pass, derived from the access key so there is nothing new to configure. */
  private stepUpSecret(): string {
    return crypto
      .createHmac('sha256', this.config.get<string>('JWT_ACCESS_SECRET') ?? '')
      .update('step-up')
      .digest('hex');
  }

  /**
   * Checks a typed code against its row and uses it up — the same rules for
   * signing in and for confirming: unknown or expired, too many tries, wrong.
   */
  private async consumeCode<T extends CodeRow>(otp: T | null, code: string): Promise<T> {
    return this.useUp(await this.checkCode(otp, code));
  }

  /** The checks alone, leaving the code usable — for a sign-in that has a second step (§298). */
  private async checkCode<T extends CodeRow>(otp: T | null, code: string): Promise<T> {
    if (!otp || otp.expiresAt < new Date()) throw codeNotRight();

    if (otp.attempts >= otp.maxAttempts) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: SIGN_IN.TOO_MANY_TRIES,
        message: 'Too many incorrect attempts. Please request a new code.',
      });
    }

    const isMatch = await bcrypt.compare(code, otp.codeHash);
    if (!isMatch) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw codeNotRight();
    }
    return otp;
  }

  /** Marks a checked code used, so it cannot be replayed. Only one request can. */
  private async useUp<T extends CodeRow>(otp: T): Promise<T> {
    const used = await this.prisma.otpCode.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (used.count === 0) throw codeNotRight();
    return otp;
  }

  async logout(refreshToken: string): Promise<{ message: string }> {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash }, select: { sessionId: true } });
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // The sign-in is over, so it leaves "where you are signed in" (§298).
    if (stored?.sessionId) await this.endSessions({ id: stored.sessionId });
    return { message: 'Logged out.' };
  }

  /** Where this person is signed in (§298): sign-ins not ended, with a token still alive. Newest use first. */
  async listSessions(user: AuthenticatedUser, locale: Locale = DEFAULT_LOCALE) {
    const now = new Date();
    const sessions = await this.prisma.authSession.findMany({
      where: { userId: user.userId, endedAt: null, refreshTokens: { some: { revokedAt: null, expiresAt: { gt: now } } } },
      orderBy: { lastUsedAt: 'desc' },
      take: 50,
      select: { id: true, userAgent: true, ip: true, createdAt: true, lastUsedAt: true, twoStep: true },
    });
    return sessions.map((s) => ({
      id: s.id,
      device: describeDevice(s.userAgent, locale),
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: s.id === user.sessionId,
      twoStep: s.twoStep,
    }));
  }

  async endOneSession(user: AuthenticatedUser, sessionId: string, locale: Locale = DEFAULT_LOCALE) {
    const ended = await this.endSessions({ id: sessionId, userId: user.userId });
    if (ended === 0) throw new BadRequestException('That sign-in has already ended.');
    return { message: say(locale, 'Signed out there.') };
  }

  async endOtherSessions(user: AuthenticatedUser) {
    // Tokens from before sessions were kept are ended too — unless this is one of them.
    const ended = await this.endSessions(
      { userId: user.userId, ...(user.sessionId ? { id: { not: user.sessionId } } : {}) },
      user.sessionId ? user.userId : undefined,
    );
    return { message: ended === 1 ? 'Signed out on 1 other place.' : `Signed out on ${ended} other places.` };
  }

  /**
   * Ends sign-ins (§298): the sessions named, and every refresh token they
   * have — and, when the filter is a whole person, their tokens from before
   * sessions were kept too. An access token already issued lasts out its
   * minutes; an administrator's is refused at once (RolesGuard).
   */
  async endSessions(where: Prisma.AuthSessionWhereInput, alsoLegacyOf?: string): Promise<number> {
    const now = new Date();
    const sessions = await this.prisma.authSession.findMany({ where: { ...where, endedAt: null }, select: { id: true } });
    const ids = sessions.map((s) => s.id);
    await this.prisma.$transaction([
      this.prisma.authSession.updateMany({ where: { id: { in: ids } }, data: { endedAt: now } }),
      this.prisma.refreshToken.updateMany({
        where: {
          revokedAt: null,
          OR: [{ sessionId: { in: ids } }, ...(alsoLegacyOf ? [{ userId: alsoLegacyOf, sessionId: null }] : [])],
        },
        data: { revokedAt: now },
      }),
    ]);
    return ids.length;
  }
}
