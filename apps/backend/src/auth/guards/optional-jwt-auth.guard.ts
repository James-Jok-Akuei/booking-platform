import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Authenticates the caller if they present a valid token, and lets them through
 * anonymously if they do not.
 *
 * The pattern for endpoints that are **public but richer for the owner**. The
 * route stays reachable without a token, while a handler that cares can look at
 * `request.user` and decide what the caller is allowed to see.
 *
 * `JwtAuthGuard` rejects anything that is not a valid token; this one never
 * rejects. `handleRequest` is the single hook Passport routes every outcome
 * through — no header, an expired token, a malformed token, a signature
 * mismatch — so returning `undefined` instead of throwing turns every one of
 * those into "anonymous" rather than a 401.
 *
 * The safety property that makes this acceptable: a *bad* token is treated
 * exactly like *no* token. It can never authenticate anyone, so the worst a
 * forged or stale token achieves is the public view.
 *
 * Handlers using this guard MUST treat `request.user` as possibly undefined and
 * default to the public projection. Availability is the first consumer; the
 * gallery and service-catalogue endpoints are the obvious next ones when they
 * grow customer-facing reads.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  // Passport's AuthGuard would normally throw here on any failure. Swallowing
  // that is the entire behavioural difference from JwtAuthGuard.
  handleRequest<TUser>(_err: unknown, user: TUser | false): TUser | undefined {
    return user || undefined;
  }

  // canActivate is inherited unchanged; it still runs the jwt strategy, so a
  // valid token is verified exactly as strictly as on a protected route.
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
}
