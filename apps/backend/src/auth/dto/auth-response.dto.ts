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
