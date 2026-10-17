import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthService } from '../auth.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/** The refusal a client answers by asking for a code and sending the request again (§279). */
export const STEP_UP_REQUIRED = 'STEP_UP_REQUIRED';

/**
 * A risky change needs a code typed recently (§279) — a sign-in in the last
 * few minutes, or a "confirm it is you" sent as `X-Step-Up`. A screen left
 * open is not enough to redirect a shop's money or let someone in.
 *
 * Runs after the class's own guards, so who may do it at all is answered
 * first: staff are refused for being staff, not asked for a code they could
 * never use.
 */
@Injectable()
export class RecentAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user: AuthenticatedUser; headers: Record<string, unknown> }>();
    const header = request.headers['x-step-up'];
    assertRecentlyConfirmed(this.auth, request.user, typeof header === 'string' ? header : undefined);
    return true;
  }
}

/**
 * The same check, for a route that must first answer who may do it from the
 * data — the payout number, which only the owner may set (§48.5).
 */
export function assertRecentlyConfirmed(auth: AuthService, user: AuthenticatedUser, stepUpToken?: string) {
  if (auth.isRecentlyConfirmed(user, stepUpToken)) return;
  throw new ForbiddenException({
    statusCode: 403,
    error: 'Forbidden',
    code: STEP_UP_REQUIRED,
    message: 'For your safety, confirm it is you first. We will email you a code.',
  });
}
