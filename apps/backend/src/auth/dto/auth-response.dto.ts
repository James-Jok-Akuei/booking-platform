import { UserRole } from '@prisma/client';

/**
 * The account behind a freshly issued token pair.
 *
 * Deliberately minimal: everything else about the caller comes from
 * `GET /users/me`, so there is one place that describes a person and one place
 * that hands out tokens.
 */
export class AuthenticatedUserDto {
  id!: string;
  email!: string;
  role!: UserRole;
}

/**
 * A token pair.
 *
 * The refresh token is returned in the BODY rather than set as a cookie: the
 * customer app is React Native, where there is no cookie jar, and one transport
 * for all three clients beats two code paths (§7).
 */
export class TokenPairDto {
  accessToken!: string;
  refreshToken!: string;
  /** How long this sign-in lasts (§279), so a screen can warn before it ends. */
  session!: SessionDto;
}

/**
 * How long a sign-in lasts (§279). The rules are per app — see
 * `session-policy.ts` — and said here so the screens never keep their own copy.
 */
export class SessionDto {
  /** Unused for this long, the sign-in ends. */
  idleMinutes!: number;
  /** The most it lasts however busy, in minutes; null when only idleness ends it. */
  maxMinutes!: number | null;
  /** However busy, it ends at this moment; null when only idleness ends it. */
  endsAt!: string | null;
}

/** A "confirm it is you" that went through (§279): send it as `X-Step-Up`. */
export class StepUpDto {
  stepUpToken!: string;
  /** Until when risky changes go through without asking again. */
  expiresAt!: string;
}

/** What signing in answers: the tokens, and who they belong to. */
export class SignedInDto extends TokenPairDto {
  user!: AuthenticatedUserDto;
}

/**
 * The reply to asking for a code.
 *
 * The SAME message whether or not the address has an account — otherwise this
 * endpoint would tell an unauthenticated caller which email addresses are
 * registered (§3.2).
 */
export class OtpRequestedDto {
  message!: string;
}

/** One sign-in, as "where you are signed in" lists it (§298). */
export class SignInSessionDto {
  id!: string;
  /** "Chrome on Mac", "the app on an iPhone". */
  device!: string;
  /** The address it signed in from. */
  ip!: string | null;
  createdAt!: string;
  lastUsedAt!: string;
  /** The one this request came from. */
  current!: boolean;
  /** An administrator's sign-in with an authenticator code. */
  twoStep!: boolean;
}

/** An administrator's two-step sign-in, as Security shows it (§298). */
export class TwoStepStatusDto {
  enabled!: boolean;
  enabledAt!: string | null;
  recoveryCodesLeft!: number;
  /** Every administrator must have it before using the console. */
  required!: boolean;
  /** This sign-in was made with the code. */
  thisSignIn!: boolean;
}

/** The secret for the authenticator app, shown once (§298). */
export class TwoStepSetupDto {
  /** In groups of four, for typing in by hand. */
  secret!: string;
  /** What the QR code holds. */
  otpauthUrl!: string;
}

export class RecoveryCodesDto {
  /** Shown once. Each works once, in place of the app's code. */
  recoveryCodes!: string[];
}

/** Turned on: the recovery codes, and new tokens for this sign-in, made with the code. */
export class TwoStepEnabledDto extends RecoveryCodesDto {
  tokens!: TokenPairDto;
}
