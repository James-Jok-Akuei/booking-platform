import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: 'BUSINESS' | 'CUSTOMER' | 'ADMIN';
  /** When this sign-in's code was typed, in seconds (§279); null on older tokens. */
  authTime?: number | null;
  /** The sign-in this request belongs to (§298); null on older tokens. */
  sessionId?: string | null;
  /** An administrator typed an authenticator code for this sign-in (§298). */
  twoStep?: boolean;
}

// Returns undefined on routes guarded by OptionalJwtAuthGuard when the caller
// is anonymous. On JwtAuthGuard-protected routes it is always populated — the
// guard rejects the request otherwise — so those handlers can keep annotating
// it as AuthenticatedUser without a null check.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
